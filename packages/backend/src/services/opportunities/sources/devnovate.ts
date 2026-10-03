// opportunities/sources/devnovate.ts — DevNovate (devnovate.co) hackathon fetcher.
// WHY: devnovate.co (India college hackathons, HackWithIndia) like other platforms.
// Site: https://devnovate.co/events (Vite SPA, #root empty — no SSR listing).
// API: same-origin backend (e.g. /auth/status 401) but no documented /api/events
// (404 "Cannot find GET /api/events") — discovery via DuckDuckGo
// site:devnovate.co/event (same degraded-fallback pattern as dorahacks/hackerearth)
// + seed slugs (hackforge/hack-beyond/build-with-ai/hackwithdelhi-30).
// Detail pages are SPA shells (OG tags only) — list-level snippet mining carries
// prize ($500/$2,000), dates (05 March 2026 Ends 07 March 2026), venue
// (CMRIT Hyderabad / Microsoft Office), Type OFFLINE/Hybrid, Team Size 1-4/1-6.
// Correct site confirmed: devnovate.co (not .com/.io). Robots: Allow /.
// Fail-open, rate-limited (scrapeCache 600s DDG + 12h), cached, dedup by URL.
import prisma from '../../../config/db'
import { extractDeadlineFromContent } from '../../../utils/search'
import { validateExternalUrl } from '../../../utils/secureUrl'
import { logger } from '../../../utils/logger'
import { scrapeCache } from '../cache'
import type { NormalizedOpportunity } from '../types'
import { stripHtml, isGenericTitle } from '../text'
import { inferDeadlineFromTitle, isEnded } from '../dates'
import { UA, MAX_PAGES, fetchPage6k } from './context'
import { decodeDuckDuckGoHref } from './searchFetch'
import {
  cleanDescription,
  extractPrizeTiers,
  extractUSDPrizeTiers,
  extractTeamSize,
  extractExplicitTeamSize,
  extractEligibility,
  extractVenueMode,
  extractScheduleText,
  extractStages,
  extractISORegistrationEnd,
} from './details'

export const DEVNOVATE_LISTING_URL = 'https://devnovate.co/events'
export const DEVNOVATE_EVENT_BASE = 'https://devnovate.co/event/'

/** Seed slugs (recorded live 2026-10-03) when DDG yields 0. */
export const DEVNOVATE_SEED_SLUGS = [
  'hackforge',
  'hack-beyond',
  'build-with-ai',
  'hackwithdelhi-30',
  'deviathon',
]

/** Live event-link predicate (accepts /event/<slug> + /events/<slug> on devnovate.co). */
export function isDevnovateEventUrl(href: unknown): boolean {
  if (typeof href !== 'string') return false
  const t = href.trim()
  if (!t || t.length < 8) return false
  try {
    const absolute = t.startsWith('/') ? `https://devnovate.co${t}` : t
    const u = new URL(absolute)
    const host = u.hostname.toLowerCase()
    if (host !== 'devnovate.co' && !host.endsWith('.devnovate.co')) return false
    const path = u.pathname || '/'
    const m = path.match(/^\/(event|events)\/([^/?#]+)\/?$/i)
    if (!m) return false
    const slug = (m[2] || '').trim()
    if (slug.length < 2) return false
    return true
  } catch { return false }
}

/** Canonical URL for dedup by URL (/events → /event, lowercase slug, no trailing/query). */
export function normalizeDevnovateUrl(url: unknown): string {
  try {
    if (typeof url !== 'string' || !url.trim()) return ''
    const t = url.trim()
    const absolute = t.startsWith('/') ? `https://devnovate.co${t}` : t
    const u = new URL(absolute)
    const host = u.hostname.toLowerCase()
    if (host !== 'devnovate.co' && !host.endsWith('.devnovate.co')) return ''
    const m = (u.pathname || '/').match(/^\/(event|events)\/([^/?#]+)\/?$/i)
    if (!m) return ''
    const slug = (m[2] || '').trim().toLowerCase().replace(/\/+$/, '')
    if (!slug || slug.length < 2) return ''
    return `https://devnovate.co/event/${slug}`
  } catch { return '' }
}

/** Mode from Type/venue cues (HYBRID first — hybrid text contains offline cues too). */
export function parseDevnovateMode(text: unknown): string {
  const s = String(text ?? '')
  if (!s.trim()) return ''
  if (/hybrid/i.test(s)) return 'HYBRID'
  if (/offline|on-site|onsite|in-person|cmrit|hyderabad|microsoft office|venue|bengaluru|delhi|mumbai|chennai|kolkata/i.test(s)) return 'OFFLINE'
  if (/online|virtual|remote/i.test(s)) return 'ONLINE'
  return ''
}

/**
 * Team size from "Team Size 3-4" / "minimum of 1 and a maximum of 4" / explicit labels.
 * Range → max (convention), single → value, invalid/absent → null (omit, never guess).
 */
export function parseDevnovateTeamSize(text: unknown): number | null {
  const s = String(text ?? '')
  if (!s.trim()) return null
  const valid = (n: number) => Number.isFinite(n) && n > 0 && n <= 20
  try {
    const range = s.match(/team\s*size\s*[:\-]?\s*(\d+)\s*[-–—to]+\s*(\d+)/i)
    if (range) {
      const a = Number(range[1]); const b = Number(range[2])
      if (valid(a) && valid(b)) return Math.max(a, b)
    }
    const minmax = s.match(/minimum\s*(?:of\s*)?(\d+).*?maximum\s*(?:of\s*)?(\d+)/i)
    if (minmax) {
      const a = Number(minmax[1]); const b = Number(minmax[2])
      if (valid(a) && valid(b)) return Math.max(a, b)
    }
    const single = s.match(/team\s*size\s*[:\-]?\s*(\d+)/i)
    if (single) {
      const n = Number(single[1])
      if (valid(n)) return n
    }
  } catch { /* fall through to shared miners */ }
  try {
    const explicit = extractExplicitTeamSize(s)
    if (explicit !== null) return explicit
  } catch {}
  try { return extractTeamSize(s) } catch { return null }
}

/** Organizer from strict Organized-by mining, else platform fallback. */
export function extractDevnovateOrganizer(text: unknown): string {
  const s = String(text ?? '')
  if (!s.trim()) return ''
  try {
    const m = s.match(/(?:organized\s+by|organised\s+by|hosted\s+by|presented\s+by|powered\s+by)\s+([A-Z][A-Za-z0-9 &.'\-–]{2,80})/i)
    if (m) {
      const cand = m[1].replace(/\s+/g, ' ').trim().split(/[.;|]/)[0].trim().slice(0, 80)
      if (cand.length >= 3 && !isGenericTitle(cand)) return cand
    }
  } catch {}
  return ''
}

async function fetchDevnovateDdgHtml(page: number): Promise<string | undefined> {
  const ddgQuery = page === 1 ? 'site:devnovate.co event' : `site:devnovate.co event 2026 page ${page}`
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(ddgQuery)}&p=${page}`
  const cacheKey = `devnovate:ddg:${page}`
  try {
    const cached = scrapeCache.get<string>(cacheKey)
    if (cached && !cached.toLowerCase().includes('anomaly-modal')) return cached
  } catch {}
  try { await validateExternalUrl(searchUrl) } catch { /* DDG allowlisted via no-allowlist dev; prod allowlist blocks DDG — fail-open to seeds */ }
  try {
    const res = await fetch(searchUrl, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.5' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return undefined
    const html = await res.text()
    if (!html || html.length < 1000) return undefined
    if (html.toLowerCase().includes('anomaly-modal')) return undefined
    try { scrapeCache.set(cacheKey, html, 600) } catch {}
    return html
  } catch { return undefined }
}

function parseDdgResults(ddgHtml: string): Array<{ href: string; title: string; snippet: string }> {
  const out: Array<{ href: string; title: string; snippet: string }> = []
  try {
    const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
    const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi
    const snippets: string[] = []
    let sm: RegExpExecArray | null
    while ((sm = snippetRe.exec(ddgHtml)) !== null) {
      const txt = stripHtml(sm[1])
      if (txt.length > 20) snippets.push(txt)
    }
    let idx = 0
    let m: RegExpExecArray | null
    while ((m = linkRe.exec(ddgHtml)) !== null && out.length < 20) {
      const rawHref = m[1] || ''
      const titleHtml = m[2] || ''
      const href = decodeDuckDuckGoHref(rawHref)
      const title = stripHtml(titleHtml).slice(0, 150).trim()
      const snippet = snippets[idx] || ''
      idx++
      if (!href || !title) continue
      out.push({ href, title, snippet })
    }
  } catch {}
  return out
}

export async function fetchDevnovatePage(page: number, seen: Set<string>): Promise<NormalizedOpportunity[]> {
  const opps: NormalizedOpportunity[] = []
  try {
    const ddgHtml = await fetchDevnovateDdgHtml(page)
    if (ddgHtml) {
      const results = parseDdgResults(ddgHtml)
      let idx = 0
      for (const r of results) {
        try {
          if (!r.href.includes('devnovate.co')) { idx++; continue }
          if (!isDevnovateEventUrl(r.href)) { idx++; continue }
          const url = normalizeDevnovateUrl(r.href)
          if (!url) { idx++; continue }
          try { await validateExternalUrl(url) } catch { idx++; continue }
          let title = r.title.slice(0, 150).trim()
          if (!title || title.length < 5 || isGenericTitle(title)) { idx++; continue }
          // Require hack/event cue (avoid privacy/cookie pages leaking via site: search).
          const combined = `${title} ${url} ${r.snippet}`.toLowerCase()
          if (!combined.includes('hack') && !combined.includes('event') && !combined.includes('challenge') && !combined.includes('build')) { idx++; continue }
          const dedupKey = `${url.toLowerCase()}::${title.toLowerCase()}`
          if (seen.has(dedupKey) || seen.has(url.toLowerCase())) { idx++; continue }
          seen.add(dedupKey)
          seen.add(url.toLowerCase())
          const mineText = `${title} ${r.snippet}`.slice(0, 6000)
          let deadline = extractISORegistrationEnd(mineText) || extractDeadlineFromContent(mineText) || ''
          if (!deadline) {
            try {
              const stripped = await fetchPage6k(url)
              if (stripped && stripped.length > 100) {
                deadline = extractISORegistrationEnd(stripped) || extractDeadlineFromContent(stripped) || ''
              }
            } catch {}
          }
          if (!deadline) deadline = inferDeadlineFromTitle(title, url)
          if (isEnded(deadline, title)) { idx++; continue }
          // Registration-closed SPA shells (HackWithDelhi 3.0 "Registration is closed") drop.
          if (/registration\s+is\s+closed|registrations?\s+closed/i.test(mineText) && !deadline) { idx++; continue }
          const mode = parseDevnovateMode(mineText) || 'ONLINE'
          const venueMode = (() => { try { return extractVenueMode(mineText, { city: 'India' }) } catch { return { venue: '', location: 'India', mode } } })()
          const location = venueMode.venue || 'India'
          const finalMode = venueMode.venue ? venueMode.mode : mode
          const usd = (() => { try { return extractUSDPrizeTiers(mineText) } catch { return { prizePool: '', tiers: [] as string[], perks: [] as string[] } } })()
          const inr = (() => { try { return extractPrizeTiers(mineText) } catch { return { prizePool: '', tiers: [] as string[], perks: [] as string[] } } })()
          const tiers = [...usd.tiers]
          for (const t of inr.tiers) if (!tiers.includes(t)) tiers.push(t)
          const perks = [...usd.perks]
          for (const p of inr.perks) if (!perks.includes(p)) perks.push(p)
          const prizePool = [...tiers, ...(perks.length ? [`Perks: ${perks.join(', ')}`] : [])].join(', ')
          const teamSize = parseDevnovateTeamSize(mineText)
          const eligibility = (() => { try { return extractEligibility(mineText) } catch { return '' } })()
          const schedule = (() => { try { return extractScheduleText(mineText) } catch { return '' } })()
          const stages = (() => { try { return extractStages(mineText) } catch { return [] as Array<{ title: string; date?: string }> } })()
          const organizer = extractDevnovateOrganizer(mineText) || 'Devnovate'
          const description = cleanDescription(r.snippet || mineText.slice(0, 1000), { title, source: 'DEVNOVATE' })
          const opp: NormalizedOpportunity = {
            type: 'HACKATHON',
            title: title.slice(0, 150),
            description,
            url,
            source: 'DEVNOVATE',
            organizer: organizer.slice(0, 80),
            deadline,
            startDate: '',
            duration: '',
            location,
            mode: finalMode || 'ONLINE',
            prizePool,
            stipend: '',
            company: '',
            role: '',
            themes: [],
            website: '',
            discord: '',
            participantsCount: 0,
            inviteOnly: false,
            ...(tiers.length ? { prizeTiers: tiers.slice(0, 10) } : {}),
            ...(perks.length ? { perks: perks.slice(0, 10) } : {}),
            ...(teamSize !== null ? { teamSize } : {}),
            ...(eligibility ? { eligibility } : {}),
            ...(venueMode.venue ? { venue: venueMode.venue } : {}),
            ...(schedule ? { schedule } : {}),
            ...(stages.length ? { stages } : {}),
          }
          opps.push(opp)
        } catch { idx++; continue }
        if (opps.length >= 18) break
      }
      if (opps.length > 0) return opps
    }
    // Seed fallback (page 1 only): known live slugs so Fetch All never yields 0 when DDG flakes.
    if (page === 1) {
      for (const slug of DEVNOVATE_SEED_SLUGS) {
        try {
          const url = normalizeDevnovateUrl(`https://devnovate.co/event/${slug}`)
          if (!url) continue
          const dedupKey = `${url.toLowerCase()}::${slug}`
          if (seen.has(dedupKey)) continue
          seen.add(dedupKey)
          const rawTitle = slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim()
          const title = rawTitle.toLowerCase().includes('hack') || rawTitle.toLowerCase().includes('build') ? rawTitle : `${rawTitle} Hackathon`
          if (!title || isGenericTitle(title) || seen.has(title)) continue
          seen.add(title)
          let deadline = ''
          let mineText = `${title} Devnovate`
          try {
            const stripped = await fetchPage6k(url)
            if (stripped && stripped.length > 100) {
              mineText = `${title} ${stripped}`.slice(0, 6000)
              deadline = extractISORegistrationEnd(stripped) || extractDeadlineFromContent(stripped) || ''
            }
          } catch {}
          if (!deadline) deadline = inferDeadlineFromTitle(title, url)
          if (isEnded(deadline, title)) continue
          const mode = parseDevnovateMode(mineText) || 'ONLINE'
          opps.push({
            type: 'HACKATHON',
            title: title.slice(0, 150),
            description: cleanDescription(mineText.slice(0, 1000), { title, source: 'DEVNOVATE' }),
            url,
            source: 'DEVNOVATE',
            organizer: 'Devnovate',
            deadline,
            startDate: '',
            duration: '',
            location: 'India',
            mode,
            prizePool: '',
            stipend: '',
            company: '',
            role: '',
            themes: [],
            website: '',
            discord: '',
            participantsCount: 0,
            inviteOnly: false,
          })
        } catch { continue }
      }
    }
    return opps
  } catch { return opps }
}

export async function fetchDevnovate(limit?: number): Promise<NormalizedOpportunity[]> {
  const target = limit && limit > 0 ? limit : 30
  const seen = new Set<string>()
  const newItems: NormalizedOpportunity[] = []
  try {
    for (let p = 1; p <= MAX_PAGES && newItems.length < target; p++) {
      const results = await fetchDevnovatePage(p, seen)
      if (results.length === 0) {
        if (p === 1) continue
        break
      }
      const titles = results.map((r) => r.title).filter(Boolean)
      let existingTitles = new Set<string>()
      if (titles.length) {
        try {
          const existing = await prisma.hackathonStaging.findMany({
            where: { title: { in: titles }, source: 'DEVNOVATE' },
            select: { title: true },
          })
          existing.forEach((e) => existingTitles.add(e.title))
        } catch {}
      }
      for (const item of results) {
        if (newItems.length >= target) break
        if (!item.title || isGenericTitle(item.title)) continue
        if (existingTitles.has(item.title)) continue
        if (isEnded(item.deadline, item.title)) continue
        newItems.push(item)
      }
      if (newItems.length >= target) break
    }
  } catch (e) {
    logger.error({ err: e }, 'Devnovate fetch error:')
  }
  const sliced = newItems.slice(0, target)
  logger.info(`[Devnovate] Fetched ${sliced.length} hackathons (target ${limit || 30}) capped at ${MAX_PAGES} pages`)
  return sliced
}
