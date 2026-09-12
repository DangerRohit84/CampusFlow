// packages/backend/src/services/githubActivity.ts
// Fetches real GitHub contribution calendar via the public contributions page.
// No auth token required. Uses https://github.com/users/:username/contributions
// which returns an HTML page. Legacy markup: <rect data-date="YYYY-MM-DD" data-count="N" data-level="L">.
// Current (2024+) markup: <td data-date="YYYY-MM-DD" data-level="L" class="ContributionCalendar-day">
// + adjacent <tool-tip> string e.g. "5 contributions on Jan 1st." / "No contributions on Jan 2nd."
// GitHub table covers ~365 days (53 weeks). Header "X contributions in the last year" counts ~371 days (from/to attrs).
// We parse the table (365 cells) and sum data-count / tooltip counts (not levels) for the true total.

import { logger } from '../utils/logger'
export interface GithubDay {
  date: string // YYYY-MM-DD
  count: number
  level: number // 0..4
}

// In-memory cache: username(lower) -> { data, expiresAt }
const cache = new Map<string, { data: GithubDay[]; expires: number }>()
const CACHE_TTL_SUCCESS = 10 * 60 * 1000 // 10 minutes
const CACHE_TTL_FAIL = 60 * 1000 // 1 minute on failure (negative cache)
const negativeCache = new Map<string, number>() // username -> expires

const GITHUB_USERNAME_REGEX = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i

export function isValidGithubUsername(username: string): boolean {
  return GITHUB_USERNAME_REGEX.test(username.trim())
}

function normalizeUsername(u: string): string {
  return u.trim().toLowerCase()
}

function parseCountFromTooltip(text: string): number {
  const t = text.trim()
  if (/No contributions/i.test(t)) return 0
  const m = t.match(/([\d,]+)\s+contribution/i)
  if (!m) return 0
  const n = parseInt(m[1].replace(/,/g, ''), 10)
  return Number.isNaN(n) ? 0 : Math.max(0, n)
}

async function fetchGithubContributionsRaw(username: string): Promise<GithubDay[] | null> {
  const user = normalizeUsername(username)
  if (!isValidGithubUsername(user)) return null

  // check negative cache
  const neg = negativeCache.get(user)
  if (neg && Date.now() < neg) return null

  // check success cache
  const hit = cache.get(user)
  if (hit && Date.now() < hit.expires) return hit.data

  const url = `https://github.com/users/${encodeURIComponent(user)}/contributions`
  // GitHub sometimes respects ?from= &to= ; without params it returns last year
  // request HTML
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'CampusFlow/1.0 (+https://campusflow.app)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
    })

    if (resp.status === 404) {
      negativeCache.set(user, Date.now() + CACHE_TTL_FAIL)
      return null
    }
    if (!resp.ok) {
      negativeCache.set(user, Date.now() + CACHE_TTL_FAIL)
      return null
    }

    const html = await resp.text()

    // --- Attempt 1: legacy <rect> with data-count ---
    const days: GithubDay[] = []
    const rectTagRegex = /<rect[^>]*>/g
    for (const tagMatch of html.matchAll(rectTagRegex)) {
      const tag = tagMatch[0]
      const dateM = tag.match(/data-date="([^"]+)"/)
      const countM = tag.match(/data-count="([^"]+)"/)
      const levelM = tag.match(/data-level="([^"]+)"/)
      if (!dateM || !countM || !levelM) continue
      const date = dateM[1]
      const count = parseInt(countM[1].replace(/,/g, ''), 10)
      const level = parseInt(levelM[1], 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
      if (Number.isNaN(count) || Number.isNaN(level)) continue
      days.push({ date, count: Math.max(0, count), level: Math.max(0, Math.min(4, level)) })
    }

    // Legacy fallback: <rect> order variants with count/level
    if (days.length === 0) {
      const fallbackRegex = /data-date="(\d{4}-\d{2}-\d{2})"[^>]*data-count="([\d,]+)"[^>]*data-level="(\d)"/g
      let f: RegExpExecArray | null
      while ((f = fallbackRegex.exec(html)) !== null) {
        const [, date, countStr, levelStr] = f
        const count = parseInt(countStr.replace(/,/g, ''), 10)
        days.push({ date, count: Number.isNaN(count) ? 0 : count, level: parseInt(levelStr, 10) })
      }
    }

    // --- Attempt 2: current GitHub markup (<td data-date + data-level> + adjacent <tool-tip>) ---
    // This is the primary path as of 2024-2026: no data-count attribute, counts are inside tooltip text.
    // Example: <td data-date="2026-01-04" data-level="1" class="ContributionCalendar-day"></td><tool-tip>7 contributions on January 4th.</tool-tip>
    // We must sum tooltip counts (not levels) and preserve levels 0-4 as GitHub's quartile buckets.
    if (days.length < 30) {
      // Clear tentative <rect> results if too few (false positive on unrelated rects)
      if (days.length > 0 && days.length < 30) days.length = 0

      // Primary: capture <td> + immediate <tool-tip> in one regex (most reliable)
      const tdTooltipRegex = /<td[^>]*data-date="(\d{4}-\d{2}-\d{2})"[^>]*data-level="(\d)"[^>]*>[\s\S]*?<\/td>\s*<tool-tip[^>]*>([^<]+)<\/tool-tip>/g
      let m: RegExpExecArray | null
      const tdDays: GithubDay[] = []
      while ((m = tdTooltipRegex.exec(html)) !== null) {
        const [, date, levelStr, tip] = m
        const count = parseCountFromTooltip(tip)
        const level = parseInt(levelStr, 10)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
        if (Number.isNaN(level)) continue
        tdDays.push({ date, count, level: Math.max(0, Math.min(4, level)) })
      }

      if (tdDays.length >= 30) {
        // Prefer td+tooltip results (365 cells). They are the source of truth for counts in new markup.
        days.push(...tdDays)
      } else if (tdDays.length === 0) {
        // Fallback zip: collect dates/levels and tooltips in document order and zip them
        // Useful if whitespace or intervening nodes break the combined regex.
        const dateLevelRegex = /<td[^>]*data-date="(\d{4}-\d{2}-\d{2})"[^>]*data-level="(\d)"[^>]*>/g
        const tooltipRegex = /<tool-tip[^>]*>([^<]+)<\/tool-tip>/g
        const dates: Array<{ date: string; level: number; index: number }> = []
        let d: RegExpExecArray | null
        while ((d = dateLevelRegex.exec(html)) !== null) {
          const [, date, levelStr] = d
          // Only keep ContributionCalendar-day cells (avoid legend spurious matches)
          // Heuristic: day cells have id="contribution-day-component-*" or class ContributionCalendar-day
          const snippet = html.slice(Math.max(0, d.index - 200), d.index + 500)
          const isDayCell = /ContributionCalendar-day/.test(snippet) || /contribution-day-component/.test(snippet)
          if (!isDayCell) {
            // Still check count — if data-date exists on a day cell it will usually have tooltip nearby;
            // legend levels are not paired with data-date, so they won't match dateLevelRegex anyway.
          }
          dates.push({ date, level: parseInt(levelStr, 10), index: d.index })
        }
        const tips: string[] = []
        let t: RegExpExecArray | null
        while ((t = tooltipRegex.exec(html)) !== null) tips.push(t[1])

        // Zip only if lengths plausibly match (GitHub renders 1 tooltip per day cell)
        if (dates.length >= 30 && tips.length >= dates.length - 5 && tips.length <= dates.length + 10) {
          // For safety, align by order: Nth day ↔ Nth tooltip where tooltip contains date-like or contribution text
          // Filter tips to only those that look like contribution strings
          const contribTips = tips.filter(tip => /contribution/i.test(tip))
          const n = Math.min(dates.length, contribTips.length)
          for (let i = 0; i < n; i++) {
            const { date, level } = dates[i]
            const count = parseCountFromTooltip(contribTips[i])
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
            if (Number.isNaN(level)) continue
            days.push({ date, count, level: Math.max(0, Math.min(4, level)) })
          }
        }

        // Last resort: scan each data-date and look ahead 800 chars for its tooltip (handles fragmented DOM)
        if (days.length === 0 && dates.length > 0) {
          const seen = new Set<string>()
          for (const entry of dates) {
            if (seen.has(entry.date)) continue
            const slice = html.slice(entry.index, entry.index + 2000)
            const tipM = slice.match(/<tool-tip[^>]*>([^<]+)<\/tool-tip>/)
            if (tipM) {
              seen.add(entry.date)
              const count = parseCountFromTooltip(tipM[1])
              days.push({ date: entry.date, count, level: Math.max(0, Math.min(4, entry.level)) })
            }
          }
        }
      }
    }

    if (days.length === 0) {
      // Still nothing: try generic scan for data-date + count/level lookahead (legacy compatibility)
      const altRegex = /data-date="(\d{4}-\d{2}-\d{2})"/g
      let alt: RegExpExecArray | null
      const seen = new Set<string>()
      while ((alt = altRegex.exec(html)) !== null) {
        const date = alt[1]
        if (seen.has(date)) continue
        const slice = html.slice(alt.index, alt.index + 2000)
        // Prefer tooltip count if data-count missing
        const tipM = slice.match(/<tool-tip[^>]*>([^<]+)<\/tool-tip>/)
        const cM = slice.match(/data-count="([\d,]+)"/)
        const lM = slice.match(/data-level="(\d)"/)
        if (lM && (cM || tipM)) {
          seen.add(date)
          const count = cM ? parseInt(cM[1].replace(/,/g, ''), 10) : parseCountFromTooltip(tipM![1])
          if (!Number.isNaN(count)) days.push({ date, count: Math.max(0, count), level: Math.max(0, Math.min(4, parseInt(lM[1], 10))) })
        }
      }
    }

    if (days.length === 0) {
      negativeCache.set(user, Date.now() + CACHE_TTL_FAIL)
      return null
    }

    // Deduplicate by date (last wins) and filter to valid dates
    const byDate = new Map<string, GithubDay>()
    for (const d of days) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) continue
      byDate.set(d.date, { date: d.date, count: Math.max(0, d.count), level: Math.max(0, Math.min(4, d.level)) })
    }
    const deduped = Array.from(byDate.values())
    deduped.sort((a, b) => a.date.localeCompare(b.date))

    // Must have ~ 300+ days to be considered a valid yearly calendar; otherwise treat as parse failure
    // and let fallback (events API) decide. For new users with <30 days history, 365 cells still exist (mostly zeros).
    if (deduped.length < 30) {
      negativeCache.set(user, Date.now() + CACHE_TTL_FAIL)
      return null
    }

    cache.set(user, { data: deduped, expires: Date.now() + CACHE_TTL_SUCCESS })
    return deduped
  } catch (err) {
    logger.warn({ err: (err as any)?.message || err }, `[githubActivity] fetch failed for ${user}:`)
    negativeCache.set(normalizeUsername(username), Date.now() + CACHE_TTL_FAIL)
    return null
  }
}

// Fallback via GitHub REST events API — approximates daily contribution counts by event frequency.
// Used only if SVG fetch fails but user exists (detected via 200 on events). Returns sparse days (days with events get count/level).
async function fetchGithubViaEvents(username: string): Promise<GithubDay[] | null> {
  const user = normalizeUsername(username)
  try {
    const resp = await fetch(`https://api.github.com/users/${encodeURIComponent(user)}/events/public?per_page=100`, {
      headers: {
        'User-Agent': 'CampusFlow/1.0',
        Accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
    })
    if (!resp.ok) return null
    const events = (await resp.json()) as Array<{ created_at: string; type: string }>
    if (!Array.isArray(events) || events.length === 0) return null

    const countMap = new Map<string, number>()
    for (const ev of events) {
      if (!ev.created_at) continue
      const date = new Date(ev.created_at).toISOString().slice(0, 10)
      countMap.set(date, (countMap.get(date) || 0) + 1)
    }

    const days: GithubDay[] = Array.from(countMap.entries()).map(([date, count]) => {
      let level = 0
      if (count >= 1) level = 1
      if (count >= 3) level = 2
      if (count >= 6) level = 3
      if (count >= 10) level = 4
      return { date, count, level }
    })
    days.sort((a, b) => a.date.localeCompare(b.date))
    return days.length ? days : null
  } catch {
    return null
  }
}

export async function fetchGithubContributions(username: string): Promise<GithubDay[] | null> {
  if (!username || !isValidGithubUsername(username)) return null
  const days = await fetchGithubContributionsRaw(username)
  if (days && days.length >= 30) return days
  // SVG fetch succeeded but parsing yielded too few days (<30) → treat as failure
  // Fallback to events API ONLY when SVG truly unavailable (e.g., private profile, rate-limited,
  // or markup changed). Events API is paginated (per_page=100 → max ~100 events → ~30-90 contributions)
  // and cannot represent 782 yearly contributions; we must not use it when SVG works.
  if (days && days.length > 0 && days.length < 30) {
    // Suspiciously small SVG parse result — try events as better than nothing, but log
    logger.warn(`[githubActivity] SVG parse for ${username} yielded only ${days.length} days, falling back to events`)
  }
  const fallback = await fetchGithubViaEvents(username)
  // If fallback also fails, return the small SVG result if we have one
  if (!fallback || fallback.length === 0) return days && days.length ? days : null
  // If SVG gave us a full calendar (≥30 days) we already returned above; this path is only when SVG failed
  return fallback
}

// Build a normalized calendar of `days` (e.g., 364) ending today, filling gaps with 0.
// If GitHub returns ~365-371 days, we trim/extend to requested window.
// Uses UTC day math to avoid local-timezone off-by-one (GitHub dates are YYYY-MM-DD in UTC).
export async function getGithubCalendar(username: string, days = 364): Promise<GithubDay[] | null> {
  const raw = await fetchGithubContributions(username)
  if (!raw || raw.length === 0) return null

  const map = new Map<string, GithubDay>()
  for (const d of raw) map.set(d.date, d)

  // Use UTC midnight for "today" so toISOString slicing is stable regardless of server TZ (Render=UTC, local dev=IST)
  const now = Date.now()
  const out: GithubDay[] = []
  for (let i = days - 1; i >= 0; i--) {
    const ts = now - i * 24 * 60 * 60 * 1000
    const iso = new Date(ts).toISOString().slice(0, 10)
    const found = map.get(iso)
    if (found) out.push(found)
    else out.push({ date: iso, count: 0, level: 0 })
  }
  return out
}

// Optional helper to clear cache (for testing)
export function clearGithubCache() {
  cache.clear()
  negativeCache.clear()
}
