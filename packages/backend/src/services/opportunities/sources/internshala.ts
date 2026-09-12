// opportunities/sources/internshala.ts — Internshala platform fetcher (Track 4 C-3 split).
// WHY: JSON-LD ItemList + detail-page enrichment, one home.
// Moved verbatim from opportunityAgent.ts; AbortSignal timeouts preserved.
import prisma from '../../../config/db'
import { searchDetails, parseSearchDate, extractDeadlineFromContent, hasRegistrationClosedIndicator } from '../../../utils/search'
import { validateExternalUrl } from '../../../utils/secureUrl'
import { logger } from '../../../utils/logger'
import { scrapeCache } from '../cache'
import type { NormalizedOpportunity } from '../types'
import { hasValue } from '../types'
import { stripHtml, isGenericTitle } from '../text'
import { extractPastYearFromTitle, isTitlePastYear, inferDeadlineFromTitle, isEnded } from '../dates'
import { isCompanyStartupCollegeOrganizer, getHackathonReputationScore, applyHighOrganizerTrustBoost, DYNAMIC_COMPANY_COLLEGE_INDICATORS } from '../reputation'
import { UA, MAX_PAGES, PER_PAGE } from './context'
import { cleanDescription } from './details'

// ─── Internshala: pure helpers (exported for hermetic regression tests) ───

/** Title-Case a slug-derived company ("scalar tech media" → "Scalar Tech Media"). */
function toTitleCaseCompany(s: string): string {
  return String(s || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Company from an Internshala detail slug (live `-at-` shape).
 * Live: `...-internship-in-mumbai-at-scalar-tech-media1788759455`
 *   → last `-at-` → strip trailing numeric id → dashes→spaces → Title-Case.
 * Legacy `/at-` shape kept for compat. Returns '' (honest-omit) when absent —
 * never 'Unknown'.
 */
export function extractCompanyFromInternshalaUrl(url: unknown): string {
  if (typeof url !== 'string' || !url) return ''
  const noFrag = url.split(/[?#]/)[0] ?? ''
  if (!noFrag) return ''
  const seg = noFrag.split('/').filter(Boolean).pop() ?? noFrag
  let raw = ''
  const dashIdx = seg.lastIndexOf('-at-')
  if (dashIdx >= 0) {
    // Guard against generic `-at-` false positives (e.g. `no-at-marker`):
    // only treat as company slug on Internshala detail/internship shapes.
    const isDetailShape =
      noFrag.includes('/detail/') ||
      noFrag.includes('internshala.com') ||
      noFrag.includes('-internship-')
    if (!isDetailShape) return ''
    raw = seg.slice(dashIdx + 4)
  } else {
    // Legacy slash shape (pre-2026): `.../at-company123`
    const legacyIdx = noFrag.lastIndexOf('/at-')
    if (legacyIdx < 0) return ''
    raw = (noFrag.slice(legacyIdx + 4).split('/')[0] ?? '').trim()
  }
  raw = raw.replace(/\d+$/, '').replace(/^[-_]+|[-_]+$/g, '').trim()
  if (!raw) return ''
  const spaced = raw.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!spaced || spaced.length < 2) return ''
  if (/^multiple locations$/i.test(spaced)) return ''
  const titled = toTitleCaseCompany(spaced)
  if (!titled || titled.toLowerCase() === 'unknown' || titled.toLowerCase() === 'internship') return ''
  return titled
}

function pickCompanyString(v: unknown): string {
  if (typeof v !== 'string') return ''
  const t = v.replace(/\s+/g, ' ').trim()
  if (!t || t.toLowerCase() === 'unknown') return ''
  // Guard against role-echo generics leaking as company
  if (/^internship$/i.test(t) || /^internshala$/i.test(t)) return ''
  return t
}

/**
 * Company for a listing ItemList entry.
 * Prefers explicit structured org fields when present, else live `-at-` slug.
 * Unwraps ListItem `{ item: {...} }` shapes. Returns '' when truly absent
 * (honest-omit — never 'Unknown' when a real name exists, never 'Unknown' at all).
 */
export function extractInternshalaCompany(item: unknown, itemUrl: unknown): string {
  const rec = (item ?? {}) as Record<string, any>
  const inner =
    rec.item && typeof rec.item === 'object' ? (rec.item as Record<string, any>) : null
  const src = inner ?? rec
  const candidates: unknown[] = [
    (src as any).hiringOrganization?.name,
    (src as any).hiringOrganization?.legalName,
    (src as any).hiringOrganization,
    (src as any).company,
    (src as any).companyName,
    (src as any).company_name,
    (src as any).brand?.name,
    (src as any).brand,
    (src as any).organization?.name,
    (src as any).organizer,
    (src as any).employer?.name,
    (src as any).hirer?.name,
  ]
  for (const c of candidates) {
    const v = pickCompanyString(c)
    if (v) return v
  }
  const urlStr =
    typeof itemUrl === 'string' && itemUrl
      ? itemUrl
      : typeof (src as any).url === 'string'
        ? (src as any).url
        : typeof rec.url === 'string'
          ? rec.url
          : ''
  const slugCompany = extractCompanyFromInternshalaUrl(urlStr)
  if (slugCompany) return slugCompany
  // Last resort: `name` shaped as "Role at Company" (not the usual "Role - Internship").
  const name = typeof (src as any).name === 'string' ? (src as any).name : ''
  if (name && /\s+at\s+/i.test(name)) {
    const afterAt = name.split(/\s+at\s+/i).pop()?.trim() ?? ''
    // Reject the common "X - Internship" echo and bare "Internship".
    const v = pickCompanyString(afterAt)
    if (v && !/^internship/i.test(v)) return toTitleCaseCompany(v)
  }
  return ''
}

/** True when a stipend candidate window looks like marketing modal/popup (ignore). */
function stipendWindowIsPopup(windowText: string): boolean {
  // Marketing copy never appears near a real salary block; popup class names
  // can appear in nearby tags on compact pages, so the caller passes a TIGHT
  // ±200-char window — a real stipend 250+ chars from the popup is not skipped.
  if (/AI Career Guide|Sign up now to unlock|Sign up with/i.test(windowText)) return true
  return /subscription-popup|subscription_popup|modal-overlay|modal|popup|overlay/i.test(windowText)
}

/** True when a ₹ candidate is a plausible monthly/weekly stipend (excludes ₹599 dust). */
function isPlausibleStipendAmount(cand: string): boolean {
  const nums = cand
    .replace(/₹/g, ' ')
    .replace(/,/g, '')
    .match(/\d+/g)
    ?.map(Number) ?? []
  if (!nums.length) return false
  const max = Math.max(...nums)
  if (!Number.isFinite(max) || max <= 0) return false
  if (max < 1000) return false // popup/guide price (₹599), filters, dust
  return true
}

/**
 * Scoped stipend fallback for detail HTML (HIGH wart 2 fix).
 * - Strips script/style/comments (₹ in JS/config must not bleed).
 * - Prefers ₹ amounts in `stipend|salary|compensation` vicinity with a
 *   period suffix (`/month|/week|per month`) — the real salary-block shape.
 * - Falls back to any period-suffixed ₹ on page (popup ₹599 has no period).
 * - Skips candidates whose TIGHT ±200-char window is modal/popup/subscription
 *   (wide windows over-filter on compact pages where the popup div sits just
 *   above the salary block).
 * - Honest-omit ('') when no salary-shaped amount exists — never first-₹-on-page.
 *
 * MEDIUM 2026-09-10 Rs-variants fix (safe part): live raw HTML is UTF-8 `₹`
 * but some pages/caches carry `Rs`/`Rs.`/`INR`/`&#8377;`/`&#x20B9;` variants.
 * Normalize all to `₹` BEFORE matching so `Rs. 5,000/month` is not missed.
 * Still requires period suffix + plausibility + popup guard (popup `₹599`
 * / `Rs. 599` without period never matches).
 */
export function extractInternshalaStipend(html: unknown): string {
  if (typeof html !== 'string' || !html) return ''
  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
  // Strip modal/popup/subscription nodes FIRST so their ₹ never competes.
  // Non-greedy to the first close (popups are flat marketing blocks — see
  // `AI Career Guide worth ₹599` + `Sign up now to unlock` in live evidence).
  // Residual defense below (tight-window popup check) covers nested leftovers.
  const withoutPopupsRaw = clean.replace(
    /<div[^>]*class="[^"]*(?:subscription-popup|modal-overlay|modal|popup|overlay|signup)[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    ' ',
  )
  // Rs-variant normalization (safe: only expands ₹ recall, period+plausibility still gate).
  const withoutPopups = withoutPopupsRaw
    .replace(/&#8377;|&#x20B9;|&#X20B9;|&rupee;|&#x20b9;/gi, '₹')
    .replace(/\bRs\.?\s*(?=₹?\s*[\d,])/gi, '₹ ')
    .replace(/\bINR\s*(?=₹?\s*[\d,])/gi, '₹ ')
    .replace(/₹\s*₹/g, '₹')
  const periodReSrc =
    '₹\\s*[\\d,]+(?:\\s*-\\s*₹?\\s*[\\d,]+)?\\s*(?:\\/\\s*(?:month|week|day)|per\\s+(?:month|week|day))'

  // 1. Salary-labeled windows first (most precise: label + salary shape nearby).
  const labelRe = /stipend|salary|compensation/gi
  let lm: RegExpExecArray | null
  labelRe.lastIndex = 0
  while ((lm = labelRe.exec(withoutPopups)) !== null) {
    const idx = lm.index ?? 0
    const winStart = Math.max(0, idx - 300)
    const window = withoutPopups.slice(winStart, idx + 1500)
    const innerRe = new RegExp(periodReSrc, 'gi')
    let im: RegExpExecArray | null
    while ((im = innerRe.exec(window)) !== null) {
      const cand = im[0].trim()
      const globalIdx = winStart + (im.index ?? 0)
      const ctx = withoutPopups.slice(Math.max(0, globalIdx - 200), globalIdx + 200)
      if (stipendWindowIsPopup(ctx)) continue
      if (!isPlausibleStipendAmount(cand)) continue
      return cand
    }
    if (window.length > 10000) break // safety: never scan unbounded on pathological pages
  }

  // 2. Any period-suffixed ₹ on page (real stipends carry /month), skipping popups.
  const globalRe = new RegExp(periodReSrc, 'gi')
  let gm: RegExpExecArray | null
  while ((gm = globalRe.exec(withoutPopups)) !== null) {
    const cand = gm[0].trim()
    const idx = gm.index ?? 0
    const ctx = withoutPopups.slice(Math.max(0, idx - 200), idx + 200)
    if (stipendWindowIsPopup(ctx)) continue
    if (!isPlausibleStipendAmount(cand)) continue
    return cand
  }

  // 3. Honest-omit: no salary-shaped amount (popup bare ₹599 must NOT bleed).
  return ''
}

/**
 * Join all JobPosting `jobLocation[]` entries (MEDIUM wart 3, low-risk part).
 * Handles array and single-object shapes; dedupes; '' when absent.
 * Single-entry output stays byte-identical to the old `[0]` behavior
 * ("Mumbai, Maharashtra").
 */
export function extractInternshalaLocations(jobLocation: unknown): string {
  const arr = Array.isArray(jobLocation) ? jobLocation : jobLocation ? [jobLocation] : []
  const locs: string[] = []
  for (const loc of arr) {
    if (typeof loc === 'string') {
      const t = loc.trim()
      if (t) locs.push(t)
      continue
    }
    if (!loc || typeof loc !== 'object') continue
    const rec = loc as Record<string, any>
    const addr = rec.address
    if (typeof addr === 'string') {
      const t = addr.trim()
      if (t) locs.push(t)
      continue
    }
    if (addr && typeof addr === 'object') {
      const locality = String(addr.addressLocality ?? '').trim()
      const region = String(addr.addressRegion ?? '').trim()
      const combined = [locality, region].filter(Boolean).join(', ')
      if (combined) locs.push(combined)
      continue
    }
    // Address fields directly on the entry (non-standard shape).
    const locality = String(rec.addressLocality ?? '').trim()
    const region = String(rec.addressRegion ?? '').trim()
    const combined = [locality, region].filter(Boolean).join(', ')
    if (combined) locs.push(combined)
  }
  const seen = new Set<string>()
  const uniq: string[] = []
  for (const l of locs) {
    const k = l.toLowerCase()
    if (!seen.has(k) && l) {
      seen.add(k)
      uniq.push(l)
    }
  }
  return uniq.join(', ')
}

// ─── Internshala: JSON-LD ItemList + detail page JSON-LD ───────────
export async function fetchInternshalaPage(page: number, seen: Set<string>): Promise<NormalizedOpportunity[]> {
  try {
    const response = await fetch(`https://internshala.com/internships/page-${page}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) return []
    const html = await response.text()

    const opportunities: NormalizedOpportunity[] = []
    const jsonLdRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
    let match

    while ((match = jsonLdRegex.exec(html)) !== null) {
      try {
        const data = JSON.parse(match[1])
        if (data['@type'] === 'ItemList' && data.itemListElement) {
          for (const item of data.itemListElement) {
            const inner =
              (item as any)?.item && typeof (item as any).item === 'object'
                ? (item as any).item
                : item
            const name = (inner as any).name || (item as any).name || ''
            const itemUrl = (inner as any).url || (item as any).url || ''

            if (seen.has(name)) continue
            seen.add(name)

            const parts = String(name).split(' - ')
            const role = parts[0]?.trim() || name
            // HIGH wart 1: live slugs use `-at-` (dash), not `/at-` (slash).
            // Helper prefers explicit org fields, else slug; honest-omit ('') when absent.
            const company = extractInternshalaCompany(item, itemUrl)

            opportunities.push({
              type: 'INTERNSHIP',
              title: name,
              description: '',
              url: itemUrl,
              source: 'INTERNSHALA',
              organizer: company,
              deadline: '',
              startDate: '',
              duration: '',
              location: '',
              mode: 'REMOTE',
              prizePool: '',
              stipend: '',
              company,
              role,
              themes: [],
              website: '',
              discord: '',
              participantsCount: 0,
              inviteOnly: false,
            })
          }
        }
      } catch { /* skip malformed JSON */ }
    }
    return opportunities
  } catch {
    return []
  }
}


export async function fetchInternshala(limit?: number): Promise<NormalizedOpportunity[]> {
  const target = limit && limit > 0 ? limit : Number.MAX_SAFE_INTEGER
  const seen = new Set<string>()
  const newItems: NormalizedOpportunity[] = []

  for (let page = 1; page <= MAX_PAGES && newItems.length < target; page++) {
    const results = await fetchInternshalaPage(page, seen)
    if (results.length === 0) break

    // Enrich this page's items with detail pages to get deadline etc before filtering
    // Process in batches of 5 to avoid overwhelming
    const toEnrich = results
    for (let i = 0; i < toEnrich.length; i += 5) {
      const batch = toEnrich.slice(i, i + 5)
      const settled = await Promise.allSettled(
        batch.map(opp => fetchInternshalaDetail(opp.url))
      )
      for (let j = 0; j < settled.length; j++) {
        const result = settled[j]
        if (result.status === 'fulfilled' && result.value) {
          const details = result.value
          toEnrich[i + j].deadline = details.deadline || ''
          toEnrich[i + j].startDate = details.startDate || ''
          toEnrich[i + j].duration = details.duration || ''
          toEnrich[i + j].location = details.location || ''
          toEnrich[i + j].stipend = details.stipend || ''
          if (details.mode) toEnrich[i + j].mode = details.mode
          // MEDIUM wart 4: map detail JD (JobPosting description via
          // cleanDescription) — '' when absent, never generic.
          if ((details as { description?: string }).description) {
            toEnrich[i + j].description = (details as { description?: string }).description || ''
          }
        }
      }
    }

    // Batch dedup via DB for this page
    const titles = toEnrich.map(r => r.title).filter(Boolean)
    let existingTitles = new Set<string>()
    if (titles.length) {
      try {
        const existing = await prisma.internshipStaging.findMany({
          where: { title: { in: titles }, source: 'INTERNSHALA' },
          select: { title: true },
        })
        existing.forEach(e => existingTitles.add(e.title))
      } catch {}
    }

    for (const item of toEnrich) {
      if (newItems.length >= target) break
      if (existingTitles.has(item.title)) continue
      if (isEnded(item.deadline, item.title)) continue
      newItems.push(item)
    }
    if (newItems.length >= target) break
  }

  const sliced = target === Number.MAX_SAFE_INTEGER ? newItems : newItems.slice(0, target)
  logger.info(`[Internshala] Fetched ${sliced.length} internships (target ${limit || 'all'}) capped at ${MAX_PAGES} pages`)
  return sliced
}


export async function fetchInternshalaDetail(url: string, retries = 2): Promise<{
  deadline: string; startDate: string; duration: string; location: string; stipend: string; mode: string; description: string
} | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(30000),
      })
    if (!res.ok) return null
    const html = await res.text()

    // Extract JSON-LD JobPosting
    const jsonLdRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
    let match
    while ((match = jsonLdRegex.exec(html)) !== null) {
      try {
        const data = JSON.parse(match[1])
        if (data['@type'] === 'JobPosting') {
          const deadline = data.validThrough || '' // "2026-09-05 23:59:59"
          const startDate = data.datePosted || '' // "2026-08-06"
          const stipend = data.baseSalary
            ? `${data.baseSalary.value?.minValue || ''}-${data.baseSalary.value?.maxValue || ''} ${data.baseSalary.value?.unitText || ''}`
            : ''
          // MEDIUM wart 3 (low-risk part): join ALL jobLocation[] (was [0]-only,
          // so multi-location roles collapsed to ''/REMOTE). Single-entry output
          // stays "Locality, Region".
          const location = extractInternshalaLocations((data as any).jobLocation)
          const duration = html.match(/(\d+)\s*months?/i)?.[0] || ''
          // MEDIUM wart 4 (low-risk part): map detail JD to description via
          // shared cleanDescription (cap 2000, never generic, '' when absent).
          const description = cleanDescription((data as any).description ?? '', {
            title: (data as any).title,
            source: 'INTERNSHALA',
          })

          // Determine mode from employment type or location.
          // MEDIUM 2026-09-10 location-default fix (safe part): honest-omit ''
          // when no evidence (old `REMOTE` default invented REMOTE for missing
          // location; fallback path invented OFFLINE — inconsistent + wrong).
          // WFH → REMOTE (evidenced), location → OFFLINE (evidenced), else ''.
          let mode = ''
          if (html.includes('Work From Home') || html.includes('work from home')) mode = 'REMOTE'
          else if (location) mode = 'OFFLINE'

          return { deadline, startDate, duration, location, stipend, mode, description }
        }
      } catch { /* skip */ }
    }

    // Fallback: extract dates from HTML patterns (no JobPosting JSON-LD).
    // HIGH wart 2: old `html.match(/₹.../)` grabbed the FIRST ₹ on page —
    // the `AI Career Guide worth ₹599` marketing popup — on 2/5 live items.
    // Scoped fallback below only accepts salary-block ₹ with a period suffix
    // and skips modal/popup windows; honest-omit ('') otherwise.
    const deadlineMatch = html.match(/APPLY BY[^<]*?(\w+ \d{1,2},?\s*\d{4})/i)
    const startDateMatch = html.match(/Start Date[^<]*?(\w+ \d{1,2},?\s*\d{4})/i)

    return {
      deadline: deadlineMatch?.[1] || '',
      startDate: startDateMatch?.[1] || '',
      duration: html.match(/(\d+)\s*months?/i)?.[0] || '',
      // Location fallback stays honest-omit (''): JobPosting is authoritative;
      // card-list location text is not available to the detail fetcher, and
      // HTML-vicinity mining bleeds the same way stipend did (see report §left-as-note).
      location: '',
      stipend: extractInternshalaStipend(html),
      // MEDIUM location-default fix: honest-omit '' when no WFH evidence
      // (old `OFFLINE` default invented OFFLINE for location-'' pages).
      mode: html.includes('Work From Home') ? 'REMOTE' : '',
      description: '',
    }
  } catch {
    if (attempt < retries) {
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
      continue
    }
    return null
  }
  }
  return null
}
