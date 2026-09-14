// opportunities/sources/wellfound.ts — Wellfound (AngelList) internship fetcher (Track 4 C-3 split).
// WHY: startup internships with salary disclosed, one home.
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

// --- Wellfound (AngelList Talent): Startup internships with salary disclosed ---
// API-first simple like Devfolio: 1 HTML/JSON fetch per page, no per-item fetchPage6k, windowText deadline/prize, target loop page<=10 && new<30
// HIGH W1 (2026-09-10 parity): `/role/r/intern` serves generic `/remote`
// ("Remote Tech & Startup Jobs", 11k+ results, pagination `/remote?page=`, 0 intern
// hits; `/role/intern` 404s; `/role/r/internship` + `/jobs?query=intern` also generic).
// No stable intern listing exists via simple GET today → fallback chain +
// explicit generic-remote guard: honestly return [] with logged reason instead of
// generic-remote pollution (never mix non-intern jobs as internships).

/** Ordered intern-listing candidates (primary canonical, then search fallbacks). */
export function buildWellfoundPageUrls(page: number): string[] {
  const p = Math.max(1, Math.floor(page) || 1)
  const paged = (base: string): string => (p === 1 ? base : base.includes('?') ? `${base}&page=${p}` : `${base}?page=${p}`)
  return [
    paged('https://wellfound.com/role/r/intern'),
    paged('https://wellfound.com/jobs?q=intern'),
    paged('https://wellfound.com/role/r/internship'),
  ]
}

/**
 * True when HTML is the generic-remote pollution page (not an intern listing).
 * Live shape 2026-09-10: `<title>Remote Tech & Startup Jobs | Wellfound</title>` +
 * `<h1>Remote Tech & Startup Jobs</h1>` + "results total" + pagination `/remote?page=`.
 * Real intern listings carry "intern" in title and lack this header.
 */
export function isGenericWellfoundRemotePage(html: unknown): boolean {
  if (typeof html !== 'string' || !html) return false
  const lower = html.toLowerCase()
  if (lower.includes('remote tech & startup jobs') || lower.includes('remote tech &amp; startup jobs')) return true
  return false
}

/**
 * Strict intern-word check (title/slug must contain intern as a word or `internship`).
 * Avoids false positives like "international" / "internally" in description text.
 */
export function isWellfoundInternTitle(text: unknown): boolean {
  if (typeof text !== 'string' || !text) return false
  const lower = text.toLowerCase()
  return /\bintern\b/.test(lower) || lower.includes('internship')
}

async function fetchWellfoundHtmlForPage(page: number): Promise<{ html: string; url: string } | null> {
  const urls = buildWellfoundPageUrls(page)
  const cacheKey = `wellfound:html:${page}`
  const cached = scrapeCache.get<string>(cacheKey)
  if (cached && !isGenericWellfoundRemotePage(cached)) return { html: cached, url: urls[0] }
  for (const url of urls) {
    try { await validateExternalUrl(url) } catch { continue }
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) })
      if (!res.ok) continue
      const txt = await res.text()
      const stripped = txt.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 6000)
      if (!(stripped.length > 100 || txt.length > 500)) continue
      // Generic-remote guard: never cache pollution; try next fallback.
      if (isGenericWellfoundRemotePage(txt)) {
        logger.debug({ url }, '[Wellfound] generic-remote page (not an intern listing), trying fallback')
        continue
      }
      scrapeCache.set(cacheKey, txt, 12 * 60 * 60) // P0-D: 12h aligns to 12h cron (was 6h)
      return { html: txt, url }
    } catch { continue }
  }
  return null
}

export async function fetchWellfoundPage(page: number, seen: Set<string>): Promise<NormalizedOpportunity[]> {
  // Single URL per page — API-first via __NEXT_DATA__ JSON (apolloState), fallback to simple HTML anchor parse
  const fetched = await fetchWellfoundHtmlForPage(page)
  if (!fetched) {
    logger.info('[Wellfound] no stable intern listing (role/r/intern serves generic remote); returning [] honestly (never mix non-intern jobs)')
    return []
  }
  const { html, url } = fetched

  const opportunities: NormalizedOpportunity[] = []

  // 1) API-first: parse __NEXT_DATA__ apolloState (like Devfolio) — 1 JSON/page, no per-item fetch
  try {
    const nextMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
    if (nextMatch) {
      const data = JSON.parse(nextMatch[1])
      const apollo = data?.props?.pageProps?.apolloState?.data as Record<string, any> | undefined
      if (apollo) {
        const candidates: any[] = []
        for (const [k, v] of Object.entries(apollo)) {
          if (k.startsWith('JobListingSearchResult:') || (k.startsWith('JobListing:') && !k.includes('RemoteConfig'))) {
            candidates.push(v)
          }
        }
        for (const job of candidates) {
          const rawTitle: string = (job.title || job.slug || '').toString().trim()
          if (!rawTitle || rawTitle.length < 5 || isGenericTitle(rawTitle) || seen.has(rawTitle)) continue
          // Strict intern check: title/slug must contain intern as word (avoid false positives like "international", "internally" in description)
          if (!isWellfoundInternTitle(`${rawTitle} ${job.slug || ''}`)) continue
          seen.add(rawTitle)
          const title = rawTitle.slice(0, 150)
          const slug: string = job.slug || ''
          const href: string = slug ? `https://wellfound.com/jobs/${String(slug).replace(/^\/+/, '')}` : url
          try { await validateExternalUrl(href) } catch { continue }
          const companyRef = (job as any).startup?.__ref || (job as any).company?.__ref
          // MEDIUM 2026-09-10 Unknown fix (safe part): honest-omit '' when no org
          // (old `'Unknown'` leaked as real company; matches Internshala/Unstop fix).
          let company = ''
          if (companyRef && apollo[companyRef]?.name) company = String(apollo[companyRef].name).trim().slice(0, 40)
          else if ((job as any).companyName) company = String((job as any).companyName).trim().slice(0, 40)
          else if (title.includes(' at ')) company = title.split(' at ').pop()?.trim().slice(0, 40) || ''
          let stipend = ''
          if (job.compensation) stipend = String(job.compensation).trim().slice(0, 40)
          else if ((job as any).salary) stipend = String((job as any).salary).trim().slice(0, 40)
          const snippet = cleanDescription(job.description || '', { title, source: 'WELLFOUND' })
          // windowText only, no per-item fetchPage6k
          let deadline = extractDeadlineFromContent(`${title} ${snippet} ${job.description || ''}`) || ''
          if (!deadline) {
            const inferred = inferDeadlineFromTitle(title, href)
            if (inferred) deadline = inferred
          }
          if (isEnded(deadline, title)) continue
          let location = ''
          let mode: string = 'REMOTE'
          if (job.remote === true || /remote/i.test(snippet)) { mode = 'REMOTE'; location = 'Remote' }
          else if (job.locationNames?.[0]) { location = String(job.locationNames[0]).trim(); mode = 'OFFLINE' }
          const durationMatch = `${title} ${snippet}`.match(/(\d+\s*(?:months?|weeks?|days?))/i)
          const duration = durationMatch ? durationMatch[0].trim().slice(0, 20) : ''
          opportunities.push({
            type: 'INTERNSHIP',
            title,
            description: snippet,
            url: href,
            source: 'WELLFOUND',
            organizer: company,
            deadline,
            startDate: '',
            duration,
            location,
            mode,
            prizePool: '',
            stipend,
            company,
            role: title.split(' at ')[0]?.trim() || title,
            themes: [],
            website: '',
            discord: '',
            participantsCount: 0,
            inviteOnly: false,
          })
          if (opportunities.length >= 20) break
        }
        if (opportunities.length > 0) return opportunities
      }
    }
  } catch {}

  // 2) Simple HTML fallback: 1 fetch, no per-item fetchPage6k, parse windowText for deadline/prize
  const anchorRegex = /<a[^>]+href="([^"]*(?:\/jobs?\/|\/company\/[^"]*\/jobs)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = anchorRegex.exec(html)) !== null && opportunities.length < 20) {
    let href = match[1]?.trim() || ''
    const inner = match[2] || ''
    if (!href) continue
    if (href.startsWith('/')) href = `https://wellfound.com${href}`
    if (!href.includes('wellfound.com')) continue
    try { await validateExternalUrl(href) } catch { continue }
    const titleRaw = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150)
    let title = titleRaw.split('\n')[0]?.trim() || ''
    if (!title || title.length < 5 || isGenericTitle(title) || seen.has(title)) continue
    // Strict intern filter: title or href/slug must contain intern as a word
    // (not windowText which includes page header and would cause false positives;
    // not bare `includes('intern')` which leaks "International").
    if (!isWellfoundInternTitle(`${title} ${href}`)) continue
    const windowStart = Math.max(0, (match.index || 0) - 800)
    const windowEnd = Math.min(html.length, (match.index || 0) + 1500)
    const windowText = html.substring(windowStart, windowEnd).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    seen.add(title)
    let company = ''
    if (title.includes(' at ')) company = title.split(' at ').pop()?.trim() || ''
    else if (title.includes(' @ ')) company = title.split(' @ ').pop()?.trim() || ''
    else {
      const companyMatch = windowText.match(/(?:at|@)\s+([A-Z][A-Za-z0-9\s&.,'-]{2,40})/)
      if (companyMatch) {
        const cand = companyMatch[1].trim().split(' ').slice(0, 4).join(' ').slice(0, 40)
        if (cand.length > 2 && !isGenericTitle(cand)) company = cand
      }
    }
    if (!company || company.length < 2) {
      const slugPart = href.split('/jobs/')[1] || ''
      const atPart = slugPart.split('-at-')[1]
      if (atPart) {
        const cand = atPart.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()).trim().slice(0, 40)
        if (cand.length > 2 && !isGenericTitle(cand)) company = cand
      }
    }
    const role = title.split(' at ')[0]?.trim() || title.split(' @ ')[0]?.trim() || title
    let stipend = ''
    const stipendMatch = windowText.match(/[?$]\s*[\d,]+(?:\s*-\s*[?$]?\s*[\d,]+)?\s*(?:\/\s*(?:month|week|hour)|per\s+month|monthly|\s*k)?/i)
    if (stipendMatch) stipend = stipendMatch[0].trim().slice(0, 40)
    else {
      const salaryMatch = windowText.match(/(?:salary|stipend|pay)\s*[:\-]?\s*[?$]?\s*[\d,]+(?:\s*-\s*[\d,]+)?/i)
      if (salaryMatch) stipend = salaryMatch[0].trim().slice(0, 40)
    }
    let duration = ''
    const durationMatch = windowText.match(/(\d+\s*(?:months?|weeks?|days?))/i)
    if (durationMatch) duration = durationMatch[0].trim().slice(0, 20)
    let location = ''
    let mode: string = 'REMOTE'
    if (/remote/i.test(windowText) || /work from home/i.test(windowText) || href.toLowerCase().includes('remote')) {
      mode = 'REMOTE'
      location = 'Remote'
    } else {
      const locMatch = windowText.match(/(Bengaluru|Bangalore|Mumbai|Delhi|Hyderabad|Chennai|Pune|Kolkata|India)/i)
      if (locMatch) {
        location = locMatch[0].trim()
        mode = 'OFFLINE'
      }
    }
    // No per-item fetchPage6k — windowText only + title inference (like Devfolio/Unstop)
    let deadline = extractDeadlineFromContent(windowText) || extractDeadlineFromContent(`${title} ${windowText}`)
    if (!deadline) {
      const inferred = inferDeadlineFromTitle(title, href)
      if (inferred) deadline = inferred
    }
    if (isEnded(deadline, title)) continue
    const snippet = cleanDescription(windowText.slice(0, 2000), { title, source: 'WELLFOUND' })
    opportunities.push({
      type: 'INTERNSHIP',
      title: title.slice(0, 150),
      description: snippet,
      url: href,
      source: 'WELLFOUND',
      organizer: company,
      deadline,
      startDate: '',
      duration,
      location,
      mode,
      prizePool: '',
      stipend,
      company,
      role,
      themes: [],
      website: '',
      discord: '',
      participantsCount: 0,
      inviteOnly: false,
    })
  }
  // Final fallback: h3/h4 titles containing intern (still no per-item fetch)
  if (opportunities.length === 0) {
    const hRegex = /<h[2-4][^>]*>([^<]{5,120})<\/h[2-4]>/gi
    while ((match = hRegex.exec(html)) !== null && opportunities.length < 10) {
      const title = match[1].trim()
      if (!title || isGenericTitle(title) || seen.has(title)) continue
      if (!title.toLowerCase().includes('intern')) continue
      seen.add(title)
      let company = ''
      if (title.includes(' at ')) company = title.split(' at ').pop()?.trim() || ''
      opportunities.push({
        type: 'INTERNSHIP',
        title: title.slice(0, 150),
        description: '',
        url,
        source: 'WELLFOUND',
        organizer: company,
        deadline: '',
        startDate: '',
        duration: '',
        location: 'Remote',
        mode: 'REMOTE',
        prizePool: '',
        stipend: '',
        company,
        role: title.split(' at ')[0]?.trim() || title,
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


export async function fetchWellfoundInternships(limit?: number): Promise<NormalizedOpportunity[]> {
  const target = limit && limit > 0 ? limit : Number.MAX_SAFE_INTEGER
  const seen = new Set<string>()
  const newItems: NormalizedOpportunity[] = []
  for (let page = 1; page <= MAX_PAGES && newItems.length < target; page++) {
    const results = await fetchWellfoundPage(page, seen)
    if (results.length === 0) break
    const titles = results.map(r => r.title).filter(Boolean)
    let existingTitles = new Set<string>()
    if (titles.length) {
      try {
        const existing = await prisma.internshipStaging.findMany({
          where: { title: { in: titles }, source: 'WELLFOUND' },
          select: { title: true },
        })
        existing.forEach(e => existingTitles.add(e.title))
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
  const sliced = target === Number.MAX_SAFE_INTEGER ? newItems : newItems.slice(0, target)
  logger.info(`[Wellfound] Fetched ${sliced.length} internships (target ${limit || 'all'}) capped at ${MAX_PAGES} pages`)
  return sliced
}
