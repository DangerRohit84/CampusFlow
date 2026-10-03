// opportunities/sources/lablab.ts — LabLab AI hackathons fetcher.
// WHY: lablab.ai (AI hackathons listings) like other platforms in fetch.
// Listing: https://lablab.ai/ai-hackathons (Next.js, JSON-LD ItemList + cards with
// <a href="/ai-hackathons/<slug>">, <h2>, <time datetime>, <span>SEP 1 - DEC 1</span>,
// badges LIVE/Register/Finished + Online/Hybrid, <p> description).
// Sitemap fallback: https://lablab.ai/server-sitemap/ai-hackathons/0 (slug enumeration).
// Detail: https://lablab.ai/ai-hackathons/<slug> (SSR, prize $ tiers + team size).
// Robots: /ai-hackathons allowed (only /dash /auth /judging /studio disallowed).
// Fail-open, rate-limited (scrapeCache 12h + fetchPage6k), cached, dedup by URL.
import prisma from '../../../config/db'
import { validateExternalUrl } from '../../../utils/secureUrl'
import { logger } from '../../../utils/logger'
import { scrapeCache } from '../cache'
import type { NormalizedOpportunity } from '../types'
import { stripHtml, isGenericTitle } from '../text'
import { isEnded } from '../dates'
import { UA, MAX_PAGES, fetchPage6k } from './context'
import {
  cleanDescription,
  extractPrizeTiers,
  extractUSDPrizeTiers,
  extractTeamSize,
  extractExplicitTeamSize,
  extractEligibility,
  extractScheduleText,
  extractStages,
} from './details'
import { decodeDuckDuckGoHref } from './searchFetch'

export const LABLAB_LISTING_URL = 'https://lablab.ai/ai-hackathons'
export const LABLAB_SITEMAP_URL = 'https://lablab.ai/server-sitemap/ai-hackathons/0'

const MONTH_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12',
}

function monthNum(m: string): string | null {
  const k = String(m || '').trim().toLowerCase().slice(0, 4)
  if (MONTH_MAP[k]) return MONTH_MAP[k]
  const short = k.slice(0, 3)
  return MONTH_MAP[short] || null
}

/** Live event-link predicate for lablab.ai (listing cards + sitemap slugs). */
export function isLablabEventUrl(href: unknown): boolean {
  if (typeof href !== 'string') return false
  const t = href.trim()
  if (!t || t.length < 8) return false
  try {
    const absolute = t.startsWith('/') ? `https://lablab.ai${t}` : t
    const u = new URL(absolute)
    const host = u.hostname.toLowerCase()
    if (host !== 'lablab.ai' && !host.endsWith('.lablab.ai')) return false
    const path = u.pathname || '/'
    const m = path.match(/^\/ai-hackathons\/([^/?#]+)\/?$/i)
    if (!m) return false
    const slug = (m[1] || '').trim()
    if (slug.length < 2) return false
    return true
  } catch { return false }
}

/** Canonical URL for dedup by URL (lowercase slug, no trailing/query). */
export function normalizeLablabUrl(url: unknown): string {
  try {
    if (typeof url !== 'string' || !url.trim()) return ''
    const t = url.trim()
    const absolute = t.startsWith('/') ? `https://lablab.ai${t}` : t
    const u = new URL(absolute)
    const host = u.hostname.toLowerCase()
    if (host !== 'lablab.ai' && !host.endsWith('.lablab.ai')) return ''
    const m = (u.pathname || '/').match(/^\/ai-hackathons\/([^/?#]+)\/?$/i)
    if (!m) return ''
    const slug = (m[1] || '').trim().toLowerCase().replace(/\/+$/, '')
    if (!slug || slug.length < 2) return ''
    return `https://lablab.ai/ai-hackathons/${slug}`
  } catch { return '' }
}

/** Mode from badge/description cues (HYBRID first — hybrid cards contain Online too). */
export function parseLablabMode(text: unknown): string {
  const s = String(text ?? '')
  if (!s.trim()) return ''
  if (/hybrid/i.test(s)) return 'HYBRID'
  if (/on-site|onsite|in-person|\boffline\b/i.test(s)) return 'OFFLINE'
  if (/online|virtual|remote/i.test(s)) return 'ONLINE'
  return ''
}

/**
 * Date range from card label + <time datetime>.
 * Labels: "SEP 1 - DEC 1", "NOV 3 - 8", "SEP 1 - 30", "OCT 12 - 18", "SEP 26 - OCT 6".
 * datetime is the start ISO (e.g. 2026-11-03T15:00:00.000Z); deadline = label end.
 * Year: datetime year when present, else current year; end wraps to +1y when month < start.
 */
export function parseLablabDateRange(
  label: unknown,
  datetimeAttr?: unknown,
): { startDate: string; deadline: string } {
  const empty = { startDate: '', deadline: '' }
  try {
    const lab = String(label ?? '').trim()
    const dtRaw = String(datetimeAttr ?? '').trim()
    let baseYear: number | null = null
    let dtDate = ''
    if (dtRaw) {
      const d = new Date(dtRaw)
      if (!isNaN(d.getTime())) {
        baseYear = d.getUTCFullYear()
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
        const dd = String(d.getUTCDate()).padStart(2, '0')
        dtDate = `${baseYear}-${mm}-${dd}`
      }
    }
    if (!baseYear) baseYear = new Date().getFullYear()
    const m = lab.match(/([A-Za-z]{3,9})\s*(\d{1,2})\s*[-–—]\s*(?:([A-Za-z]{3,9})\s*)?(\d{1,2})/)
    if (!m) {
      // No range label: start from datetime when present, else omit.
      if (dtDate) return { startDate: dtDate, deadline: '' }
      return empty
    }
    const startMon = monthNum(m[1])
    const startDay = String(m[2]).padStart(2, '0')
    const endMon = m[3] ? monthNum(m[3]) : startMon
    const endDay = String(m[4]).padStart(2, '0')
    if (!startMon || !endMon) {
      if (dtDate) return { startDate: dtDate, deadline: '' }
      return empty
    }
    const startDate = `${baseYear}-${startMon}-${startDay}`
    let endYear = baseYear
    if (Number(endMon) < Number(startMon)) endYear = baseYear + 1
    const deadline = `${endYear}-${endMon}-${endDay}`
    // Prefer datetime start when it matches label start month/day (authoritative ISO).
    if (dtDate && dtDate.slice(5) === startDate.slice(5)) {
      return { startDate: dtDate, deadline }
    }
    return { startDate, deadline }
  } catch { return empty }
}

export interface LablabCard {
  title: string
  url: string
  description: string
  dateLabel: string
  datetime: string
  modeBadge: string
  statusBadge: string
}

/**
 * Pure listing parser (no network — hermetic unit-testable).
 * Cards first (<a href="/ai-hackathons/<slug>"> + h2/time/p), JSON-LD ItemList fallback.
 */
export function parseLablabListing(html: unknown): LablabCard[] {
  const raw = String(html ?? '')
  if (!raw.trim()) return []
  const out: LablabCard[] = []
  const seen = new Set<string>()
  try {
    const anchorRe = /<a[^>]+href="([^"]*\/ai-hackathons\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
    let am: RegExpExecArray | null
    while ((am = anchorRe.exec(raw)) !== null && out.length < 60) {
      const href = (am[1] || '').trim()
      const inner = am[2] || ''
      const norm = normalizeLablabUrl(href)
      if (!norm || seen.has(norm)) continue
      const h2 = inner.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)
      const title = h2 ? stripHtml(h2[1]).slice(0, 150).trim() : ''
      if (!title || title.length < 3 || isGenericTitle(title)) continue
      const timeDt = inner.match(/<time[^>]*datetime="([^"]+)"[^>]*>/i)
      const datetime = timeDt ? timeDt[1].trim() : ''
      const timeSpan = inner.match(/<time[^>]*>[\s\S]*?<span[^>]*>([^<]{2,40})<\/span>/i)
      const dateLabel = timeSpan ? stripHtml(timeSpan[1]).trim().slice(0, 40) : ''
      const p = inner.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
      const description = p ? stripHtml(p[1]).replace(/\s+/g, ' ').trim().slice(0, 1000) : ''
      const badgeTexts = [...inner.matchAll(/<span[^>]*>([^<]{2,30})<\/span>/gi)]
        .map((x) => stripHtml(x[1]).trim())
        .filter(Boolean)
      let modeBadge = ''
      for (const b of badgeTexts) {
        if (/^(online|hybrid|on-site|onsite|in-person|offline)$/i.test(b)) { modeBadge = b; break }
      }
      if (!modeBadge) {
        const cue = inner.match(/(online|hybrid|on-site|onsite|in-person|offline)/i)
        if (cue) modeBadge = cue[1]
      }
      let statusBadge = ''
      for (const b of badgeTexts) {
        if (/^(live|register|finished|ended|closed)$/i.test(b)) { statusBadge = b; break }
      }
      seen.add(norm)
      out.push({ title, url: norm, description, dateLabel, datetime, modeBadge, statusBadge })
    }
    if (out.length > 0) return out
    // Fallback: JSON-LD ItemList (name + url only).
    const ldRe = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
    let lm: RegExpExecArray | null
    while ((lm = ldRe.exec(raw)) !== null && out.length < 60) {
      try {
        const data = JSON.parse(lm[1])
        const graphs = Array.isArray(data?.['@graph']) ? data['@graph'] : [data]
        for (const g of graphs) {
          const elements = g?.itemListElement || g?.['@graph'] || []
          const list = Array.isArray(elements) ? elements : []
          for (const el of list) {
            const name = String(el?.name || '').trim().slice(0, 150)
            const u = String(el?.url || '').trim()
            const norm = normalizeLablabUrl(u.startsWith('/') ? `https://lablab.ai${u}` : u)
            if (!name || !norm || seen.has(norm)) continue
            if (isGenericTitle(name)) continue
            seen.add(norm)
            out.push({ title: name, url: norm, description: '', dateLabel: '', datetime: '', modeBadge: '', statusBadge: '' })
          }
        }
      } catch { continue }
    }
  } catch { /* fail-open */ }
  return out
}

/**
 * Pure detail parser (no network — hermetic unit-testable).
 * Detail pages are SSR with prize $ tiers + team size + schedule.
 */
export function parseLablabDetail(
  html: unknown,
  opts?: { title?: string },
): {
  description: string
  prizePool: string
  prizeTiers: string[]
  perks: string[]
  teamSize: number | null
  eligibility: string
  schedule: string
  stages: Array<{ title: string; date?: string }>
} {
  const raw = String(html ?? '')
  if (!raw.trim()) {
    return { description: '', prizePool: '', prizeTiers: [], perks: [], teamSize: null, eligibility: '', schedule: '', stages: [] }
  }
  const stripped = stripHtml(raw).replace(/\s+/g, ' ').trim()
  const description = cleanDescription(stripped, { title: opts?.title, source: 'LABLAB' })
  const usd = (() => { try { return extractUSDPrizeTiers(stripped) } catch { return { prizePool: '', tiers: [] as string[], perks: [] as string[] } } })()
  const inr = (() => { try { return extractPrizeTiers(stripped) } catch { return { prizePool: '', tiers: [] as string[], perks: [] as string[] } } })()
  const tiers: string[] = [...usd.tiers]
  const seenAmt = new Set(tiers.map((t) => (t.match(/\$([\d,]+)/) || [])[1]?.replace(/,/g, '')).filter(Boolean))
  for (const t of inr.tiers) {
    const amt = (t.match(/₹([\d,]+)/) || [])[1]?.replace(/,/g, '')
    if (amt && seenAmt.has(amt)) continue
    if (!tiers.includes(t)) { tiers.push(t); if (amt) seenAmt.add(amt) }
  }
  const perks = [...usd.perks]
  for (const p of inr.perks) if (!perks.includes(p)) perks.push(p)
  const parts = [...tiers]
  if (perks.length) parts.push(`Perks: ${perks.join(', ')}`)
  const prizePool = parts.join(', ')
  let teamSize: number | null = null
  try { teamSize = extractExplicitTeamSize(stripped) ?? extractTeamSize(stripped) } catch { teamSize = null }
  let eligibility = ''
  try { eligibility = extractEligibility(stripped) } catch {}
  let schedule = ''
  try { schedule = extractScheduleText(stripped) } catch {}
  let stages: Array<{ title: string; date?: string }> = []
  try { stages = extractStages(stripped) } catch { stages = [] }
  return { description, prizePool, prizeTiers: tiers.slice(0, 10), perks: perks.slice(0, 10), teamSize, eligibility, schedule, stages }
}

/** Fetch one LabLab detail (single fetchPage6k, cached). Never throws. */
export async function fetchLablabDetail(url: string): Promise<Partial<NormalizedOpportunity> | null> {
  try {
    if (!url || typeof url !== 'string' || !normalizeLablabUrl(url)) return null
    const text = await fetchPage6k(url)
    if (!text || text.length <= 100) return null
    const parsed = parseLablabDetail(text)
    const out: Partial<NormalizedOpportunity> = {}
    if (parsed.description && parsed.description.length > 40) out.description = parsed.description
    if (parsed.prizePool) out.prizePool = parsed.prizePool
    if (parsed.prizeTiers.length) (out as any).prizeTiers = parsed.prizeTiers
    if (parsed.perks.length) (out as any).perks = parsed.perks
    if (parsed.teamSize !== null) (out as any).teamSize = parsed.teamSize
    if (parsed.eligibility) (out as any).eligibility = parsed.eligibility
    if (parsed.schedule) (out as any).schedule = parsed.schedule
    if (parsed.stages.length) (out as any).stages = parsed.stages
    if (!Object.keys(out).length) return null
    return out
  } catch { return null }
}

/** Bounded enrichment (concurrency 3, fill-absent only, never fakes). */
export async function enrichLablabItems(items: NormalizedOpportunity[]): Promise<void> {
  if (!items.length) return
  const CONCURRENCY = 3
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY)
    const settled = await Promise.allSettled(batch.map((it) => fetchLablabDetail(it.url)))
    for (let j = 0; j < settled.length; j++) {
      try {
        const r = settled[j]
        if (r.status !== 'fulfilled' || !r.value) continue
        const detail = r.value as Partial<NormalizedOpportunity>
        const target = batch[j]
        if (detail.description && !target.description) target.description = detail.description
        if (detail.prizePool && !target.prizePool) {
          target.prizePool = detail.prizePool
          if ((detail as any).prizeTiers?.length && !(target as any).prizeTiers?.length) (target as any).prizeTiers = (detail as any).prizeTiers
          if ((detail as any).perks?.length && !(target as any).perks?.length) (target as any).perks = (detail as any).perks
        } else if ((detail as any).prizeTiers?.length && !(target as any).prizeTiers?.length) {
          (target as any).prizeTiers = (detail as any).prizeTiers
          if ((detail as any).perks?.length && !(target as any).perks?.length) (target as any).perks = (detail as any).perks
        }
        if ((detail as any).teamSize !== undefined && (target as any).teamSize === undefined) (target as any).teamSize = (detail as any).teamSize
        if ((detail as any).eligibility && !(target as any).eligibility) (target as any).eligibility = (detail as any).eligibility
        if ((detail as any).schedule && !(target as any).schedule) (target as any).schedule = (detail as any).schedule
        if ((detail as any).stages?.length && !(target as any).stages?.length) (target as any).stages = (detail as any).stages
      } catch { continue }
    }
  }
}

async function fetchLablabListingHtml(): Promise<string> {
  const cacheKey = 'lablab:html:listing'
  try {
    const cached = scrapeCache.get<string>(cacheKey)
    if (cached) return cached
  } catch {}
  try { await validateExternalUrl(LABLAB_LISTING_URL) } catch { return '' }
  try {
    const res = await fetch(LABLAB_LISTING_URL, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) })
    if (!res.ok) return ''
    const html = await res.text()
    if (html && html.length > 500) {
      try { scrapeCache.set(cacheKey, html, 12 * 60 * 60) } catch {}
      return html
    }
    return ''
  } catch { return '' }
}

async function fetchLablabSitemapUrls(): Promise<string[]> {
  const cacheKey = 'lablab:sitemap'
  try {
    const cached = scrapeCache.get<string[]>(cacheKey)
    if (cached) return cached
  } catch {}
  try { await validateExternalUrl(LABLAB_SITEMAP_URL) } catch { return [] }
  try {
    const res = await fetch(LABLAB_SITEMAP_URL, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) })
    if (!res.ok) return []
    const xml = await res.text()
    const locRe = /<loc>([^<]+)<\/loc>/g
    let m: RegExpExecArray | null
    const out: string[] = []
    while ((m = locRe.exec(xml)) !== null && out.length < 200) {
      const loc = m[1].trim()
      if (!isLablabEventUrl(loc)) continue
      const norm = normalizeLablabUrl(loc)
      if (norm) out.push(norm)
    }
    // Newest first (sitemap is oldest-first for 2023 recaps; listing order is newest).
    const reversed = [...out].reverse()
    try { scrapeCache.set(cacheKey, reversed, 12 * 60 * 60) } catch {}
    return reversed
  } catch { return [] }
}

export async function fetchLablabPage(page: number, seen: Set<string>): Promise<NormalizedOpportunity[]> {
  try {
    // Single listing page (145 items, no pagination) — page>1 via sitemap slice.
    if (page === 1) {
      const html = await fetchLablabListingHtml()
      if (!html) return []
      const cards = parseLablabListing(html)
      const opps: NormalizedOpportunity[] = []
      for (const c of cards) {
        const url = normalizeLablabUrl(c.url)
        if (!url) continue
        const dedupKey = `${url.toLowerCase()}::${c.title.trim().toLowerCase()}`
        if (seen.has(dedupKey) || seen.has(c.title)) continue
        seen.add(dedupKey)
        seen.add(c.title)
        // Finished badge = past event — drop before date parse (never fabricate future).
        if (/^(finished|ended|closed)$/i.test((c.statusBadge || '').trim())) {
          // Still allow when deadline is future (badge lag); check dates below.
        }
        const { startDate, deadline } = parseLablabDateRange(c.dateLabel, c.datetime)
        const finalDeadline = deadline || ''
        if (isEnded(finalDeadline, c.title)) {
          // Past Finished (e.g. SEP 1-30 by Oct) drops here.
          continue
        }
        // Drop Finished with no date evidence (recap pages evade isEnded('')).
        if (/^(finished|ended|closed)$/i.test((c.statusBadge || '').trim()) && !finalDeadline) continue
        const mode = parseLablabMode(`${c.modeBadge} ${c.description}`)
        const location = mode === 'ONLINE' ? 'Online' : mode === 'HYBRID' ? 'Hybrid' : mode === 'OFFLINE' ? '' : 'Online'
        const usd = (() => { try { return extractUSDPrizeTiers(`${c.title} ${c.description}`) } catch { return { prizePool: '', tiers: [] as string[], perks: [] as string[] } } })()
        const inr = (() => { try { return extractPrizeTiers(`${c.title} ${c.description}`) } catch { return { prizePool: '', tiers: [] as string[], perks: [] as string[] } } })()
        const tiers = [...usd.tiers]
        for (const t of inr.tiers) if (!tiers.includes(t)) tiers.push(t)
        const perks = [...usd.perks]
        for (const p of inr.perks) if (!perks.includes(p)) perks.push(p)
        const prizePool = [...tiers, ...(perks.length ? [`Perks: ${perks.join(', ')}`] : [])].join(', ')
        const description = cleanDescription(c.description, { title: c.title, source: 'LABLAB' })
        const opp: NormalizedOpportunity = {
          type: 'HACKATHON',
          title: c.title.slice(0, 150),
          description,
          url,
          source: 'LABLAB',
          organizer: 'lablab.ai',
          deadline: finalDeadline,
          startDate,
          duration: c.dateLabel || '',
          location,
          mode: mode || 'ONLINE',
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
        }
        opps.push(opp)
        if (opps.length >= 30) break
      }
      return opps
    }
    // Sitemap slices for page>1 (older recaps — mostly past, isEnded filters).
    const urls = await fetchLablabSitemapUrls()
    if (!urls.length) return []
    const PER = 18
    const slice = urls.slice((page - 1) * PER, page * PER)
    const opps: NormalizedOpportunity[] = []
    for (const url of slice) {
      const norm = normalizeLablabUrl(url)
      if (!norm) continue
      const slugTitle = norm.split('/').pop()!.replace(/[-_]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()).trim()
      const title = slugTitle.toLowerCase().includes('hack') ? slugTitle : `${slugTitle} Hackathon`
      if (!title || isGenericTitle(title)) continue
      const dedupKey = `${norm.toLowerCase()}::${title.toLowerCase()}`
      if (seen.has(dedupKey)) continue
      seen.add(dedupKey)
      let deadline = ''
      try {
        const stripped = await fetchPage6k(norm)
        if (stripped && stripped.length > 100) {
          const { extractDeadlineFromContent } = await import('../../../utils/search')
          deadline = extractDeadlineFromContent(stripped) || ''
        }
      } catch {}
      if (!deadline) {
        const { inferDeadlineFromTitle } = await import('../dates')
        deadline = inferDeadlineFromTitle(title, norm)
      }
      const { isEnded: isEndedFn } = await import('../dates')
      if (isEndedFn(deadline, title)) continue
      if (!deadline) continue // sitemap recaps without date evidence → honest-omit
      opps.push({
        type: 'HACKATHON',
        title: title.slice(0, 150),
        description: '',
        url: norm,
        source: 'LABLAB',
        organizer: 'lablab.ai',
        deadline,
        startDate: '',
        duration: '',
        location: 'Online',
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
    return opps
  } catch { return [] }
}

export async function fetchLablab(limit?: number): Promise<NormalizedOpportunity[]> {
  const target = limit && limit > 0 ? limit : 30
  const seen = new Set<string>()
  const newItems: NormalizedOpportunity[] = []
  try {
    for (let page = 1; page <= MAX_PAGES && newItems.length < target; page++) {
      const results = await fetchLablabPage(page, seen)
      if (results.length === 0) {
        if (page === 1) {
          // Listing empty (WAF/SSR miss) — try sitemap pages before giving up.
          continue
        }
        break
      }
      const titles = results.map((r) => r.title).filter(Boolean)
      let existingTitles = new Set<string>()
      if (titles.length) {
        try {
          const existing = await prisma.hackathonStaging.findMany({
            where: { title: { in: titles }, source: 'LABLAB' },
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
      // Listing page 1 carries all live cards — one page is usually enough.
      if (page === 1 && newItems.length > 0 && results.length < 18) break
    }
  } catch (e) {
    logger.error({ err: e }, 'Lablab fetch error:')
  }
  const sliced = newItems.slice(0, target)
  try { await enrichLablabItems(sliced) } catch {}
  logger.info(`[Lablab] Fetched ${sliced.length} hackathons (target ${limit || 30}) capped at ${MAX_PAGES} pages`)
  return sliced
}

// DDG helper re-export for parity (unused — listing is SSR, no DDG needed).
export { decodeDuckDuckGoHref }
