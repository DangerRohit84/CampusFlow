// opportunities/sources/reskilll.ts — Reskilll page parser (Track 4 C-3 split).
// WHY: dormant helper (defined but never called by Fetch All) gets a
// clearly-marked home instead of hiding in the god module. Exported for
// explicit opt-in only; NOT registered in Fetch All (no behavior change).
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
import { UA, MAX_PAGES, PER_PAGE, fetchPage6k } from './context'
import { cleanDescription, extractPrizeTiers, extractTeamSize, extractEligibility, extractVenueMode, extractJudging, extractScheduleText, extractStages, extractISORegistrationEnd, hasReskilllClosedBadge } from './details'

export const RESKILLL_LISTING_BASE = 'https://reskilll.com/allhacks'

/** Listing URL for a page (HIGH R1: /hackathons 404s → /allhacks carries 178 cards). */
export function buildReskilllListingUrl(page: number): string {
  const p = Math.max(1, Math.floor(page) || 1)
  return p === 1 ? RESKILLL_LISTING_BASE : `${RESKILLL_LISTING_BASE}?page=${p}`
}

/**
 * Live event-link predicate (HIGH R2: `/hackathon` matched 4 vs 161 `/hack/` links).
 * Accepts live `/hack/<slug>` + legacy `/hackathon/<slug>` (slug ≥2 chars)
 * on the main host, PLUS subdomain microsites (`*.reskilll.com` event roots
 * like `https://iqoo.reskilll.com/`, `https://healthathon.reskilll.com/` —
 * the only 2 truly-live 2026-09-10 events, missed before).
 * Drops bare list URLs (`/allhacks`, `/hackathons`, `/hack/`), nav, non-reskilll, garbage.
 * NOTE: `*.mastryhub.com` externals (e.g. btw.mastryhub.com, past/closed) stay
 * out of scope — different domain + detail shape (see fix report).
 */
export function isReskilllHackUrl(href: unknown): boolean {
  if (typeof href !== 'string') return false
  const t = href.trim()
  if (!t || t.length < 8) return false
  try {
    const absolute = t.startsWith('/') ? `https://reskilll.com${t}` : t
    const u = new URL(absolute)
    const host = u.hostname.toLowerCase()
    if (host !== 'reskilll.com' && !host.endsWith('.reskilll.com')) return false
    // Subdomain microsites are event roots — accept any path including '/'
    // (cards link to `https://<sub>.reskilll.com/`). Main-site nav never lives
    // on a subdomain, so no bare-list guard needed here.
    if (host !== 'reskilll.com' && host.endsWith('.reskilll.com')) return true
    const path = u.pathname || '/'
    const m = path.match(/^\/(hack|hackathon)\/([^/?#]+)\/?$/i)
    if (!m) return false
    const slug = (m[2] || '').trim()
    if (slug.length < 2) return false
    return true
  } catch { return false }
}

export async function fetchReskilllPage(page: number, seen: Set<string>): Promise<NormalizedOpportunity[]> {
  const url = buildReskilllListingUrl(page)
  const cacheKey = `reskilll:html:${page}`
  let html: string | undefined = scrapeCache.get<string>(cacheKey)
  if (!html) {
    try { await validateExternalUrl(url) } catch { return [] }
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) })
      if (!res.ok) return []
      html = await res.text()
      // 6k strip for cache check but keep raw for parsing; cache raw truncated to avoid bloat
      const stripped = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 6000)
      if (stripped.length > 100) scrapeCache.set(cacheKey, html)
      else if (html.length > 500) scrapeCache.set(cacheKey, html)
    } catch { return [] }
    if (!html) return []
  }
  const opportunities: NormalizedOpportunity[] = []
  // Reskilll cards: live internal links use /hack/<slug> (161 links); legacy
  // /hackathon/<slug> kept for compat (4 links); subdomain microsites
  // (*.reskilll.com roots like iqoo/healthathon — the only 2 truly-live)
  // carry no /hack/ path. Broad regex captures any reskilll.com anchor;
  // predicate filters to live shapes (bare list/nav dropped).
  const anchorRegex = /<a[^>]+href="([^"]*(?:reskilll\.com|\/hack(?:athon)?\/)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  // Subdomain cards carry TWO anchors with the same href (title + `Register Now`
  // CTA). Track emitted URLs locally so the CTA duplicate never becomes a junk
  // `Register Now` item alongside the real event.
  const seenUrls = new Set<string>()
  while ((match = anchorRegex.exec(html)) !== null && opportunities.length < 20) {
    let href = match[1]?.trim() || ''
    const inner = match[2] || ''
    if (!href) continue
    // HIGH R2 guard: drop bare list URLs/nav that match the loose regex shape.
    if (!isReskilllHackUrl(href)) continue
    if (href.startsWith('/')) href = `https://reskilll.com${href}`
    // validate external url
    try { await validateExternalUrl(href) } catch { continue }
    const titleRaw = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150)
    const title = titleRaw.split('\n')[0]?.trim() || ''
    if (!title || title.length < 5 || isGenericTitle(title) || seen.has(title)) continue
    // CTA/nav anchor text (never an event title) — drops `Register Now` dupes.
    if (/^(register\s+now|registration\s+closed|sign\s*in|blogs?|login|register)$/i.test(title)) continue
    if (seenUrls.has(href.toLowerCase())) continue
    seen.add(title)
    const snippet = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 300)
    // try to find deadline nearby in html window — use priority extractor (LAST DATE TO REGISTER etc.)
    const windowStart = Math.max(0, (match.index || 0) - 600)
    const windowEnd = Math.min(html.length, (match.index || 0) + 1200)
    const windowText = html.substring(windowStart, windowEnd).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    // Tight own-card window (anchor → +600 chars): own Registration Start/End +
    // own Closed badge live here; wide-window neighbours bleed into windowText
    // (past card near live iQOO would see its future ISO, live card would see a
    // neighbour's Closed badge). Tight-first avoids both false-keep/drop.
    const tightEnd = Math.min(html.length, (match.index || 0) + 600)
    const tightText = html.substring(match.index || 0, tightEnd).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    // QA 2026-09-10 re-run: past cards carry an explicit `Registration Closed`
    // badge — drop immediately when it is the card's OWN badge (tight window),
    // never extract/fabricate a deadline for them.
    // Prevents bare month-day year-bump (`December 14` → current-year future).
    if (hasReskilllClosedBadge(tightText) || hasReskilllClosedBadge(`${title} ${snippet}`)) continue
    // ISO-first (tight own-card, then wide): listing Registration End is
    // YYYY-MM-DD (invisible to the generic month-name extractor). Keep the TRUE
    // parsed date — past ISO stays past and isEnded drops it below; never roll
    // into the future.
    const tightISO = extractISORegistrationEnd(tightText) || extractISORegistrationEnd(`${title} ${snippet}`)
    if (tightISO && isEnded(tightISO, title)) continue
    let deadline = tightISO || extractISORegistrationEnd(windowText) || extractDeadlineFromContent(windowText) || extractDeadlineFromContent(`${title} ${snippet}`)
    // Fallback: fetch link page for authoritative deadline if window had none
    if (!deadline) {
      try {
        const strippedPage = await fetchPage6k(href)
        if (strippedPage) {
          // Detail also badges closed past events — drop before any date parse.
          if (hasReskilllClosedBadge(strippedPage)) continue
          deadline = extractISORegistrationEnd(strippedPage) || extractDeadlineFromContent(strippedPage) || ''
        }
      } catch {}
    }
    if (!deadline) {
      // inferDeadlineFromTitle returns past Dec-31 for past-year titles (safe:
      // stays past, filtered below) else '' (honest-omit). Never future.
      const inferred = inferDeadlineFromTitle(title, href)
      if (inferred) deadline = inferred
    }
    if (isEnded(deadline, title)) continue
    // Shared rules: full snippet (not 300-truncated generic), prize tiers + rich fields from window.
    const description = cleanDescription(snippet || windowText.slice(0, 1000), { title, source: 'OTHER_HACKATHON' })
    const windowPrizes = extractPrizeTiers(windowText)
    const teamSize = extractTeamSize(windowText)
    const eligibility = extractEligibility(windowText)
    const venueMode = extractVenueMode(windowText, { city: 'India' })
    const judging = extractJudging(windowText)
    const schedule = extractScheduleText(windowText)
    const stages = extractStages(windowText)
    opportunities.push({
      type: 'HACKATHON',
      title,
      description,
      url: href,
      source: 'OTHER_HACKATHON',
      organizer: 'Reskilll',
      deadline,
      startDate: '',
      duration: '',
      location: venueMode.venue || 'India',
      mode: venueMode.venue ? venueMode.mode : 'ONLINE',
      prizePool: windowPrizes.prizePool || '',
      stipend: '',
      company: '',
      role: '',
      themes: [],
      website: '',
      discord: '',
      participantsCount: 0,
      inviteOnly: false,
      ...(windowPrizes.tiers.length ? { prizeTiers: windowPrizes.tiers } : {}),
      ...(windowPrizes.perks.length ? { perks: windowPrizes.perks } : {}),
      ...(teamSize !== null ? { teamSize } : {}),
      ...(eligibility ? { eligibility } : {}),
      ...(venueMode.venue ? { venue: venueMode.venue } : {}),
      ...(judging ? { judging } : {}),
      ...(schedule ? { schedule } : {}),
      ...(stages.length ? { stages } : {}),
    })
    seenUrls.add(href.toLowerCase())
  }
  // Fallback: h2/h3 titles if no anchors (never emit past-year titles as live)
  if (opportunities.length === 0) {
    const hRegex = /<h[2-3][^>]*>([^<]{5,120})<\/h[2-3]>/gi
    while ((match = hRegex.exec(html)) !== null && opportunities.length < 10) {
      const title = match[1].trim()
      if (!title || isGenericTitle(title) || seen.has(title)) continue
      if (isEnded('', title)) continue
      seen.add(title)
      opportunities.push({
        type: 'HACKATHON',
        title,
        description: '',
        url,
        source: 'OTHER_HACKATHON',
        organizer: 'Reskilll',
        deadline: '',
        startDate: '',
        duration: '',
        location: 'India',
        mode: 'ONLINE',
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
    }
  }
  return opportunities
}
