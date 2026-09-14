// opportunities/sources/hack2skill.ts — Hack2Skill platform fetcher (Track 4 C-3 split).
// WHY: SPA event pages expose registrationEnd only via event-details API.
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
import { UA, MAX_PAGES, PER_PAGE, fetchPage6k } from './context'
import { slugify } from './searchSlug'
import { cleanDescription, extractPrizeTiers, extractExplicitTeamSize, extractTeamSize, cleanTierLabel } from './details'

// ─── Hack2Skill mode derivation (HIGH wart 2026-09-09 REPORT-hack2skill.md wart 1) ───
// Item 1 Impactx26 event-details JSON proves IN_PERSON offline finale @ RNSIT Bengaluru,
// yet every sitemap item hardcodes mode ONLINE (travel-misleading, inverse of Internshala REMOTE-flip).
// The fetcher already downloads event-details per item for deadline — mode is one JSON parse away.
// Derive honestly: IN_PERSON→OFFLINE, HYBRID→HYBRID, ONLINE→ONLINE, else '' (omit, never hardcoded ONLINE).
export function mapHack2SkillModeValue(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  const t = String(raw).trim().toLowerCase().replace(/[\s_]+/g, '-')
  if (!t) return ''
  if (t === 'in-person' || t === 'inperson' || t === 'offline' || t === 'onsite' || t === 'on-site' || t === 'physical') return 'OFFLINE'
  if (t === 'hybrid') return 'HYBRID'
  if (t === 'online' || t === 'virtual') return 'ONLINE'
  if (t === 'remote') return 'ONLINE'
  return ''
}

export function deriveHack2SkillModeFromDetails(details: any): string {
  if (!details || typeof details !== 'object') return ''
  try {
    const tags: any = (details as any).tags || {}
    const modeVal = tags?.mode?.value ?? tags?.mode
    const mappedMode = mapHack2SkillModeValue(modeVal)
    if (mappedMode) return mappedMode
    // Finale IN_PERSON proves offline attendance even when mode tag missing/hidden.
    const finaleVal = tags?.finale?.value ?? tags?.finale
    const mappedFinale = mapHack2SkillModeValue(finaleVal)
    if (mappedFinale === 'OFFLINE' || mappedFinale === 'HYBRID') return mappedFinale
    if (mappedFinale === 'ONLINE') return 'ONLINE'
    // Text cues in already-downloaded sections (no extra fetch).
    // e.g. About: "24-hour national-level offline hackathon ... RNS Institute of Technology, Bengaluru".
    let hay = ''
    try {
      const sections: any[] = (details as any).sections || []
      const parts: string[] = []
      for (const sec of sections) {
        if (!sec || typeof sec !== 'object') continue
        parts.push(String((sec as any).title || ''))
        const cats: any[] = (sec as any).category || []
        for (const cat of cats) {
          const items: any[] = (cat as any)?.data || []
          for (const it of items) {
            if (!it || typeof it !== 'object') continue
            if ((it as any).description) parts.push(String((it as any).description))
            if ((it as any).title) parts.push(String((it as any).title))
          }
        }
      }
      hay = parts.join(' ')
    } catch { hay = '' }
    if (!hay) {
      try { hay = JSON.stringify((details as any).sections || '').slice(0, 8000) } catch { hay = '' }
    }
    if (!hay.trim()) return ''
    const stripped = hay.replace(/<[^>]+>/g, ' ')
    if (/\boffline\b|in[-\s]?person|on[-\s]?site|\bat\s+rnsit\b|rns\s+institute|rnsit\s+bengaluru/i.test(stripped)) return 'OFFLINE'
    if (/\bhybrid\b/i.test(stripped)) return 'HYBRID'
    if (/\bonline\b|\bvirtual\b/i.test(stripped)) return 'ONLINE'
    if (/\bremote\b/i.test(stripped)) return 'ONLINE'
    return ''
  } catch { return '' }
}

// ─── Hack2Skill rich fields from already-downloaded event-details (MEDIUMs 2-4 + LOWs 5-6) ───
// event-details JSON (already fetched per item for deadline/mode/timeline) carries:
// - sections[PRIZES] with `Rs. 75000/-` + 3×25000 cards (prize)
// - sections[About] multi-KB HTML (description)
// - tags.teamSize {min:2,max:4} (team)
// - organizer in explicit keys or About `Organized by` (org)
// - data.title `ImpactX'26` (casing, vs slug `impactx26` → `Impactx26 Hackathon`)
// All pure, no network/DB, omit absent (never invent). Shared cache → no extra fetch.

/** Normalize Rs./INR/₹-entity variants to ₹ so extractPrizeTiers (₹-only) recalls Rs prizes. */
function normalizeHack2SkillPrizeText(s: string): string {
  return String(s ?? '')
    .replace(/&#8377;|&#x20B9;|&#X20B9;|&rupee;/gi, '₹')
    .replace(/\bRs\.?\s*(?=₹?\s*[\d,])/gi, '₹ ')
    .replace(/\bINR\s*(?=₹?\s*[\d,])/gi, '₹ ')
    .replace(/₹\s*₹/g, '₹')
}

/** Flatten a sections[] array to text (titles + category data titles/descriptions). */
function flattenHack2SkillSections(details: any, wantTitleRe: RegExp): string {
  try {
    const sections: any[] = (details as any)?.sections || []
    const parts: string[] = []
    for (const sec of sections) {
      if (!sec || typeof sec !== 'object') continue
      const t = String((sec as any).title || '')
      const ty = String((sec as any).type || '')
      if (!wantTitleRe.test(t) && !wantTitleRe.test(ty)) continue
      const cats: any[] = (sec as any).category || []
      for (const cat of cats) {
        const items: any[] = (cat as any)?.data || []
        for (const it of items) {
          if (!it || typeof it !== 'object') continue
          if ((it as any).title) parts.push(String((it as any).title))
          if ((it as any).description) parts.push(stripHtml(String((it as any).description)))
          // Prize cards often carry amount/prize/value keys instead of description.
          for (const k of ['amount', 'prize', 'value', 'cash', 'reward']) {
            if ((it as any)[k] !== undefined && (it as any)[k] !== null && (it as any)[k] !== '') {
              parts.push(String((it as any)[k]))
            }
          }
        }
      }
      const secData: any[] = Array.isArray((sec as any).data) ? (sec as any).data : []
      for (const it of secData) {
        if (!it || typeof it !== 'object') continue
        if ((it as any).title) parts.push(String((it as any).title))
        if ((it as any).description) parts.push(stripHtml(String((it as any).description)))
      }
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim()
  } catch {
    return ''
  }
}

/**
 * Prizes from sections[PRIZES] (Rs. 75000/- + cards). Pure.
 * Returns {prizePool, tiers, perks} (omit when absent, never ₹0).
 *
 * NOTE: shared extractPrizeTiers primary requires 1+ chars BEFORE the rank
 * (`Campus Winner` works, bare `Winner ₹75000` does not) and its `cash prize
 * → 25000` bleed can win while 75000 stays invisible (blocking generic fallback
 * which only runs when primary finds nothing). H2S cards use bare `Winner` +
 * `Rs.` amounts, so supplement primary with a bare-rank pass merging by amount
 * (same dedupe-by-amount pattern as Unstop API+text merge). Never ₹0.
 */
export function extractHack2SkillPrizes(details: unknown): { prizePool: string; tiers: string[]; perks: string[] } {
  if (!details || typeof details !== 'object') return { prizePool: '', tiers: [], perks: [] }
  try {
    let blob = flattenHack2SkillSections(details, /prize/i)
    if (!blob) {
      // Fallback: top-level prize keys (prizePool/prize/prizes) when sections absent.
      const rec = details as Record<string, any>
      const tops: string[] = []
      for (const k of ['prizePool', 'prize', 'prizes', 'prizeMoney', 'cashPrize']) {
        if (rec[k] !== undefined && rec[k] !== null && rec[k] !== '') tops.push(String(rec[k]))
      }
      blob = tops.join(' ').trim()
    }
    if (!blob) return { prizePool: '', tiers: [], perks: [] }
    const normalized = normalizeHack2SkillPrizeText(blob)
    const out = extractPrizeTiers(normalized)
    // Supplement: bare `Winner/Runner Up ₹amount` missed by primary (no prefix).
    // Generic `([A-Za-z]... )₹ amount` handles `Winner ₹75000` (no colon) — run even
    // when primary found something, merging by amount digits (never dupes, never ₹0).
    try {
      const seen = new Set((out.tiers || []).map((t) => ((t.match(/₹([\d,]+)/) || [])[1] || '').replace(/,/g, '')).filter(Boolean))
      const extra: string[] = []
      const bareRe = /([A-Za-z][A-Za-z0-9 &\-]{1,29})₹\s*([\d,]{4,})/g
      let m: RegExpExecArray | null
      bareRe.lastIndex = 0
      while ((m = bareRe.exec(normalized)) !== null && out.tiers.length + extra.length < 10) {
        const rawLabel = (m[1] || '').trim().replace(/\s+/g, ' ')
        const amt = (m[2] || '').trim()
        if (!amt || /^0+$/.test(amt.replace(/,/g, ''))) continue
        const digits = amt.replace(/,/g, '')
        if (seen.has(digits)) continue
        const ctxStart = Math.max(0, (m.index ?? 0) - 40)
        const ctx = normalized.slice(ctxStart, (m.index ?? 0) + rawLabel.length)
        if (/fee|fees|registration|participation\s*fee|per\s*team/i.test(ctx)) continue
        // Only bare-rank labels (Winner/Runner/First/.../Prize) — never bleed nouns.
        if (!/(winner|first|second|third|1st|2nd|3rd|runner|champion|best|consolation|top|overall|grand|campus|national|prize|place|pool)/i.test(rawLabel)) continue
        let label = 'Prize'
        try {
          label = cleanTierLabel(rawLabel)
        } catch {
          label = 'Prize'
        }
        const entry = `${label}: ₹${amt}`
        if (!(out.tiers || []).includes(entry) && !extra.includes(entry)) {
          extra.push(entry)
          seen.add(digits)
        }
        if (m[0].length === 0) bareRe.lastIndex++
      }
      if (extra.length) {
        const tiers = [...out.tiers, ...extra].slice(0, 10)
        const perks = out.perks.slice(0, 10)
        const parts = [...tiers]
        if (perks.length) parts.push(`Perks: ${perks.join(', ')}`)
        return { prizePool: parts.join(', '), tiers, perks }
      }
    } catch {}
    return { prizePool: out.prizePool, tiers: out.tiers.slice(0, 10), perks: out.perks.slice(0, 10) }
  } catch {
    return { prizePool: '', tiers: [], perks: [] }
  }
}

/**
 * Description from sections[About/Overview] multi-KB HTML. Pure.
 * cleanDescription (cap 2000, never generic, '' when absent).
 */
export function extractHack2SkillDescription(details: unknown, opts?: { title?: string }): string {
  if (!details || typeof details !== 'object') return ''
  try {
    const blob = flattenHack2SkillSections(details, /about|overview|description|detail/i)
    if (!blob || blob.length < 20) return ''
    return cleanDescription(blob, { title: opts?.title, source: 'HACK2SKILL' })
  } catch {
    return ''
  }
}

function validHack2SkillTeam(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 20
}

/**
 * Team size from tags.teamSize {min,max} (max wins, 2/4 → 4) else About text mining. Pure.
 * Handles {min,max} + {minTeamSize,maxTeamSize} + {value} + string shapes.
 * Invalid (min>max, out of 1-20) → null (omit, never guess).
 */
export function extractHack2SkillTeamSize(details: unknown): number | null {
  if (!details || typeof details !== 'object') return null
  try {
    const tags: any = (details as any).tags || {}
    const ts: any = tags.teamSize ?? tags.teamsize ?? tags.team_size ?? null
    if (ts !== null && ts !== undefined) {
      if (typeof ts === 'number' && validHack2SkillTeam(ts)) return ts
      if (typeof ts === 'string') {
        const n = Number(ts.trim())
        if (validHack2SkillTeam(n)) return n
      }
      if (typeof ts === 'object') {
        const minRaw = (ts as any).min ?? (ts as any).minTeamSize ?? (ts as any).min_size ?? (ts as any).from
        const maxRaw = (ts as any).max ?? (ts as any).maxTeamSize ?? (ts as any).max_size ?? (ts as any).to
        const valueRaw = (ts as any).value
        const min = Number(minRaw)
        const max = Number(maxRaw)
        const minOk = validHack2SkillTeam(min)
        const maxOk = validHack2SkillTeam(max)
        if (minOk && maxOk) {
          if (min === max) return min
          if (min < max) return max
          return null
        }
        if (maxOk && !minOk) return max
        if (!maxOk && minOk) return min
        if (valueRaw !== undefined) {
          const v = Number(String(valueRaw).trim().split(/[-–—to]+/i).pop()?.trim())
          if (validHack2SkillTeam(v)) return v
          // Range string "2-4" → max.
          const range = String(valueRaw).match(/(\d+)\s*[-–—to]+\s*(\d+)/i)
          if (range) {
            const a = Number(range[1])
            const b = Number(range[2])
            if (validHack2SkillTeam(a) && validHack2SkillTeam(b)) return Math.max(a, b)
          }
        }
      }
    }
    // Fallback: mine About text (explicit max wins, else generic mining).
    const about = flattenHack2SkillSections(details, /about|overview|description|detail|rule|faq|info/i)
    if (about) {
      try {
        const explicit = extractExplicitTeamSize(about)
        if (explicit !== null) return explicit
      } catch {}
      try {
        return extractTeamSize(about)
      } catch {
        return null
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Organizer from explicit keys else strict `Organized/Hosted/Powered by X` in About. Pure.
 * WHY strict: About mining without a prefix bleeds (every college mention becomes org).
 * Returns '' when absent (caller keeps 'Hack2Skill' platform fallback, never invents).
 */
export function extractHack2SkillOrganizer(details: unknown): string {
  if (!details || typeof details !== 'object') return ''
  try {
    const rec = details as Record<string, any>
    for (const k of ['organizer', 'organisation', 'organization', 'organizerName', 'organiser', 'hostedBy', 'host', 'college', 'institute', 'university']) {
      const v = rec[k]
      if (typeof v === 'string' && v.trim().length >= 2 && v.trim().length <= 80) {
        const t = v.trim()
        if (t.toLowerCase() === 'hack2skill' || t.toLowerCase() === 'unknown') continue
        return t.slice(0, 80)
      }
      if (v && typeof v === 'object' && typeof (v as any).name === 'string') {
        const t = String((v as any).name).trim()
        if (t.length >= 2 && t.length <= 80 && t.toLowerCase() !== 'hack2skill' && t.toLowerCase() !== 'unknown') return t.slice(0, 80)
      }
    }
    // Tags organizer when present.
    const tags: any = (rec as any).tags || {}
    for (const k of ['organizer', 'organisation', 'organization', 'host']) {
      const v = tags[k]
      const s = typeof v === 'string' ? v : v?.value ?? v?.name ?? ''
      if (typeof s === 'string' && s.trim().length >= 2) {
        const t = s.trim().slice(0, 80)
        if (t.toLowerCase() !== 'hack2skill' && t.toLowerCase() !== 'unknown') return t
      }
    }
    // Strict About prefix mining only (never bare college mentions).
    const about = flattenHack2SkillSections(details, /about|overview|description|detail/i)
    if (about) {
      const m = about.match(/(?:organized\s+by|organised\s+by|hosted\s+by|presented\s+by|powered\s+by|in\s+collaboration\s+with)\s+([A-Z][A-Za-z0-9 &.'\-–]{2,80})/i)
      if (m) {
        const cand = m[1].replace(/\s+/g, ' ').trim().split(/[.;|]/)[0].trim().slice(0, 80)
        if (cand.length >= 3 && !isGenericTitle(cand)) return cand
      }
    }
    return ''
  } catch {
    return ''
  }
}

/**
 * Canonical title from event-details (preserves casing/apostrophe). Pure.
 * `ImpactX'26` (truth) vs slug-derived `Impactx26 Hackathon` (wart 6).
 * Returns '' when absent/generic (caller keeps slug title, never invents).
 */
export function extractHack2SkillTitleValue(details: unknown): string {
  if (!details || typeof details !== 'object') return ''
  try {
    const rec = details as Record<string, any>
    const raw = rec.title ?? rec.name ?? rec.eventName ?? rec.hackathonName ?? ''
    const t = String(raw ?? '').trim().slice(0, 150)
    if (!t || t.length < 3 || isGenericTitle(t)) return ''
    return t
  } catch {
    return ''
  }
}

/** Slug from a hack2skill event URL (shared by rich-field fetchers). Pure. */
export function extractHack2SkillSlug(url: unknown): string {
  try {
    if (typeof url !== 'string' || !url.toLowerCase().includes('hack2skill.com/event/')) return ''
    const part = url.toLowerCase().split('/event/')[1]
    if (!part) return ''
    const slug = part.split('/')[0].split('?')[0].split('#')[0].trim()
    return slug && slug.length >= 2 ? slug : ''
  } catch {
    return ''
  }
}

/**
 * Rich fields for one event URL via shared event-details cache (one fetch per slug
 * reuses deadline+mode+timeline JSON — no extra network). Never throws.
 */
export async function fetchHack2SkillRichFields(url: string): Promise<{
  title: string
  description: string
  prizePool: string
  prizeTiers: string[]
  perks: string[]
  teamSize: number | null
  organizer: string
}> {
  const empty = { title: '', description: '', prizePool: '', prizeTiers: [] as string[], perks: [] as string[], teamSize: null as number | null, organizer: '' }
  try {
    const slug = extractHack2SkillSlug(url)
    if (!slug) return empty
    const details = await getHack2SkillEventData(slug)
    if (!details) return empty
    const title = extractHack2SkillTitleValue(details)
    const description = extractHack2SkillDescription(details, { title: title || undefined })
    const prizes = extractHack2SkillPrizes(details)
    const teamSize = extractHack2SkillTeamSize(details)
    const organizer = extractHack2SkillOrganizer(details)
    return { title, description, prizePool: prizes.prizePool, prizeTiers: prizes.tiers, perks: prizes.perks, teamSize, organizer }
  } catch {
    return empty
  }
}

// Shared event-details JSON cache so deadline + mode reuse one fetch per slug.
async function getHack2SkillEventData(slug: string): Promise<any | null> {
  const key = `hack2skill:event:${slug}`
  try {
    const cached = scrapeCache.get<any>(key)
    if (cached !== undefined) return cached as any
  } catch {}
  const apiUrl = `https://hack2skill.com/api/v1/event/${slug}/event-details`
  try { await validateExternalUrl(apiUrl) } catch { return null }
  try {
    const res = await fetch(apiUrl, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') || ''
    if (!ct.includes('application/json')) return null
    const data = (await res.json()) as any
    const d = data?.data || null
    try { scrapeCache.set(key, d, d ? 12 * 60 * 60 : 600) } catch {} // P0-D: 12h aligns to 12h cron (was 6h; 600s negative kept)
    return d
  } catch { return null }
}

export async function fetchHack2SkillEventMode(url: string): Promise<string> {
  try {
    if (!url.toLowerCase().includes('hack2skill.com/event/')) return ''
    const slugPart = url.toLowerCase().split('/event/')[1]
    if (!slugPart) return ''
    const slug = slugPart.split('/')[0].split('?')[0].split('#')[0].trim()
    if (!slug || slug.length < 2) return ''
    const cacheKey = `hack2skill:mode:${slug}`
    try {
      const cached = scrapeCache.get<string>(cacheKey)
      if (cached !== undefined) return cached
    } catch {}
    const details = await getHack2SkillEventData(slug)
    const mode = deriveHack2SkillModeFromDetails(details)
    try { scrapeCache.set(cacheKey, mode, mode ? 12 * 60 * 60 : 600) } catch {} // P0-D: 12h (was 6h; 600s negative kept)
    return mode
  } catch { return '' }
}

// ─── Hack2Skill authoritative deadline via event-details API (SPA pages have no LAST DATE in HTML) ───
// Hack2skill detail pages are SPA shells; registrationEnd only via api/v1/event/{slug}/event-details.
// Without this, past events like HackwithChandigarh (registrationEnd 2024-09-18) return '' from HTML parsing
// and isEnded('','HackwithChandigarh Hackathon') => false (incorrectly active). This helper returns
// authoritative ISO datetime (e.g., 2026-09-25T14:29:00.000Z -> 19:59 IST) or '' so completed hackathons are filtered.
// Fix for fit_fest-hackathon-2026: Timeline 25 Aug 26 03:14 PM IST - 25 Sep 26 07:59 PM IST Registration must return 25 Sep end, not 25 Aug begin.
// Previous bug: fetchHack2SkillApiPage used HTML extraction before API, picking 25 Aug (earliest generic) and never calling API.
// Also search.ts failed to parse "25 Sep 26" (2-digit year) so proximity missed and generic fallback picked earliest 25 Aug.
export async function fetchHack2SkillRegistrationEnd(url: string): Promise<string> {
  try {
    if (!url.toLowerCase().includes('hack2skill.com/event/')) return ''
    const slugPart = url.toLowerCase().split('/event/')[1]
    if (!slugPart) return ''
    const slug = slugPart.split('/')[0].split('?')[0].split('#')[0].trim()
    if (!slug || slug.length < 2) return ''
    const cacheKey = `hack2skill:deadline:${slug}`
    const cached = scrapeCache.get<string>(cacheKey)
    if (cached !== undefined) return cached
    // Shared event-details fetch (also feeds mode derivation — one JSON parse per slug).
    const d = await getHack2SkillEventData(slug)
    if (!d) { try { scrapeCache.set(cacheKey, '', 600) } catch {} ; return '' }
    let raw: string = d.registrationEnd || d.registrationEndDate || d.registrationDeadline || d.endDate || d.deadline || ''
    // Timeline fallback: when top-level registrationEnd missing, check Timeline -> Registration item end (e.g., fit_fest: sections[Timeline].data[Registration].end)
    if (!raw) {
      try {
        const sections: any[] = d.sections || []
        for (const sec of sections) {
          const titleLower = String(sec.title || '').toLowerCase()
          const typeLower = String(sec.type || '').toLowerCase()
          if (titleLower === 'timeline' || typeLower === 'timeline') {
            const cats: any[] = sec.category || []
            for (const cat of cats) {
              const items: any[] = cat?.data || sec.data || []
              for (const it of items) {
                const itTitle = String(it.title || '').toLowerCase()
                const itType = String(it.type || '').toLowerCase()
                if (itTitle === 'registration' || itType === 'registration' || itTitle.includes('registration')) {
                  raw = it.end || it.start || ''
                  if (raw) break
                }
              }
              if (raw) break
            }
          }
          if (raw) break
        }
      } catch {}
    }
    let deadline = ''
    if (raw) {
      const dt = new Date(raw)
      if (!isNaN(dt.getTime())) {
        // Preserve exact deadline time (e.g., 2026-09-25T14:29:00.000Z = 2026-09-25 19:59 IST). Return full ISO, not date-only, to keep 07:59 PM IST.
        deadline = dt.toISOString()
      } else deadline = parseSearchDate(String(raw)) || ''
    }
    try { scrapeCache.set(cacheKey, deadline, deadline ? 12 * 60 * 60 : 600) } catch {} // P0-D: 12h (was 6h; 600s negative kept)
    return deadline
  } catch { return '' }
}


// ─── Hack2Skill Timeline → stages/dates (timeline gap 2026-09-09) ───
// event-details JSON already downloaded per item carries a 5-phase Timeline
// (Registration/Team Formation/Payment/Problem Statement/FINALE with starts/ends)
// but the fetcher emitted only registrationEnd (deadline). Map ALL Timeline entries
// to stages[] + dates[] (+ submissionStart/Finale dates via dates[] labels).
// Evidence: B.webfetch-event-details-impactx26.json (38,680 bytes):
// - Registration 2026-09-04→2026-10-02, Team Formation 2026-09-08→2026-10-02,
//   Payment Link 2026-09-08→2026-10-02, Problem Statement 2026-09-11→2026-10-02,
//   Finale 2026-10-08→2026-10-09; top submissionStart 2026-09-11T18:30:00Z.
// Pure, no network/DB — hermetic unit-testable. Omit absent (never invent).
export function extractHack2SkillTimeline(details: any): {
  stages: Array<{ title: string; date?: string }>
  dates: Array<{ label: string; date: string }>
} {
  if (!details || typeof details !== 'object') return { stages: [], dates: [] };
  try {
    const sections: any[] = (details as any).sections || [];
    let timelineSec: any = null;
    for (const sec of sections) {
      if (!sec || typeof sec !== 'object') continue;
      const t = String((sec as any).title || '').toLowerCase().trim();
      const ty = String((sec as any).type || '').toLowerCase().trim();
      if (t === 'timeline' || ty === 'timeline') {
        timelineSec = sec;
        break;
      }
    }
    if (!timelineSec) return { stages: [], dates: [] };
    const items: any[] = [];
    const cats: any[] = (timelineSec as any).category || [];
    for (const cat of cats) {
      const arr: any[] = (cat as any)?.data || [];
      for (const it of arr) items.push(it);
    }
    if (!items.length && Array.isArray((timelineSec as any).data)) {
      for (const it of (timelineSec as any).data) items.push(it);
    }
    if (!items.length) return { stages: [], dates: [] };
    const stages: Array<{ title: string; date?: string }> = [];
    const dates: Array<{ label: string; date: string }> = [];
    const seenStage = new Set<string>();
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const rawTitle = String((it as any).title || (it as any).type || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 120);
      if (!rawTitle) continue;
      const title = rawTitle;
      const key = title.toLowerCase();
      if (seenStage.has(key)) continue;
      seenStage.add(key);
      const startRaw = (it as any).start ? String((it as any).start).trim() : '';
      const endRaw = (it as any).end ? String((it as any).end).trim() : '';
      const startOk = startRaw && !isNaN(new Date(startRaw).getTime()) ? startRaw : '';
      const endOk = endRaw && !isNaN(new Date(endRaw).getTime()) ? endRaw : '';
      if (stages.length < 10) {
        const stageDate = endOk || startOk || undefined;
        if (stageDate) stages.push({ title, date: stageDate });
        else stages.push({ title });
      }
      const base =
        title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '')
          .slice(0, 60) || 'phase';
      if (startOk && dates.length < 20) {
        const label = `${base}_start`;
        if (!dates.some((d) => d.label === label)) dates.push({ label, date: startOk });
      }
      if (endOk && dates.length < 20) {
        const label = `${base}_end`;
        if (!dates.some((d) => d.label === label)) dates.push({ label, date: endOk });
      }
    }
    return { stages, dates };
  } catch {
    return { stages: [], dates: [] };
  }
}

export async function fetchHack2SkillTimeline(url: string): Promise<{
  stages: Array<{ title: string; date?: string }>
  dates: Array<{ label: string; date: string }>
}> {
  try {
    if (!url.toLowerCase().includes('hack2skill.com/event/')) return { stages: [], dates: [] };
    const slugPart = url.toLowerCase().split('/event/')[1];
    if (!slugPart) return { stages: [], dates: [] };
    const slug = slugPart.split('/')[0].split('?')[0].split('#')[0].trim();
    if (!slug || slug.length < 2) return { stages: [], dates: [] };
    // Shared event-details cache (one fetch per slug reuses deadline+mode JSON).
    const details = await getHack2SkillEventData(slug);
    if (!details) return { stages: [], dates: [] };
    return extractHack2SkillTimeline(details);
  } catch {
    return { stages: [], dates: [] };
  }
}


// --- Hack2Skill: API-first (innovator/public/event/list) ---
const HACK2SKILL_API_CACHE_KEY = 'hack2skill:api:page1'
const HACK2SKILL_API_TTL = 12 * 60 * 60 // P0-D: 12h aligns to 12h cron (was 6h)


export async function fetchHack2SkillApiPage(page: number, seen: Set<string>): Promise<NormalizedOpportunity[]> {
  // API-first for page 1 only; if API fails, fallback to sitemap for any page
  if (page === 1) {
    const apiUrl = 'https://hack2skill.com/innovator/public/event/list?page=1&records=100'
    try {
      await validateExternalUrl(apiUrl)
      const res = await fetch(apiUrl, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      })
      const ct = res.headers.get('content-type') || ''
      if (!res.ok || !ct.includes('application/json')) throw new Error('fallback sitemap')
    const data = (await res.json()) as any
    const flagship: any[] = data.flagship || data.data?.flagship || data.result?.flagship || []
    const community: any[] = data.community || data.data?.community || data.result?.community || []
    let combined: any[] = []
    if (flagship.length || community.length) combined = [...flagship, ...community]
    else {
      const list: any[] = data.data || data.events || data.hackathons || data.result || data.items || []
      if (Array.isArray(list) && list.length) combined = list
      else if (Array.isArray(data.data?.data)) combined = data.data.data
      else if (Array.isArray(data)) combined = data
      else combined = []
    }
    if (!combined.length) throw new Error('fallback sitemap')
    try { scrapeCache.set(HACK2SKILL_API_CACHE_KEY, combined, HACK2SKILL_API_TTL) } catch {}
    const start = (page - 1) * PER_PAGE
    const slice = combined.slice(start, start + PER_PAGE)
    const opps: NormalizedOpportunity[] = []
    for (const h of slice) {
      const title: string = (h.title || h.name || h.eventName || h.hackathonName || '').toString().trim()
      if (!title || isGenericTitle(title) || seen.has(title)) continue
      seen.add(title)
      const slug: string = h.slug || h.eventSlug || ''
      const customUrl: string = h.customEventUrl || h.eventUrl || h.url || ''
      let url: string
      if (customUrl && String(customUrl).startsWith('http')) url = String(customUrl)
      else if (customUrl) url = `https://hack2skill.com${String(customUrl).startsWith('/') ? '' : '/'}${String(customUrl)}`
      else if (slug) url = `https://hack2skill.com/event/${String(slug).replace(/^\/+/, '')}`
      else url = `https://hack2skill.com/event/${slugify(title)}`
      try { await validateExternalUrl(url) } catch { continue }
      // Authoritative Hack2Skill deadline — fetch BEFORE HTML so fit_fest picks 25 Sep end not 25 Aug begin (build mode fix)
      let apiDeadlineForHack2Skill = ''
      try { if (url.toLowerCase().includes('hack2skill.com/event/')) apiDeadlineForHack2Skill = await fetchHack2SkillRegistrationEnd(url) } catch {}
      let deadline = ''
      const rawDeadline: string = h.registrationEnd || h.registrationEndDate || h.endDate || h.deadline || h.registrationDeadline || h.regEndDate || ''
      if (rawDeadline) {
        const d = new Date(rawDeadline)
        deadline = !isNaN(d.getTime()) ? d.toISOString() : parseSearchDate(String(rawDeadline)) || ''
        if (apiDeadlineForHack2Skill) {
          try {
            const dApi = new Date(apiDeadlineForHack2Skill).getTime()
            const dRaw = new Date(deadline).getTime()
            if (!isNaN(dApi) && (isNaN(dRaw) || dApi !== dRaw)) deadline = apiDeadlineForHack2Skill
          } catch {}
        }
      } else if (apiDeadlineForHack2Skill) {
        deadline = apiDeadlineForHack2Skill
      }
      // Fallback: fetch detail page for LAST DATE TO REGISTER when neither list nor API had deadline (e.g., code4cause)
      // For hack2skill, API already tried; HTML extraction is fallback but if API exists it will override HTML mis-parse below.
      let strippedForFallback = ''
      if (!deadline) {
        try {
          const stripped = await fetchPage6k(url)
          strippedForFallback = stripped || ''
          if (stripped && stripped.length > 100) {
            const ext = extractDeadlineFromContent(stripped)
            if (ext) deadline = ext
            if (!deadline && hasRegistrationClosedIndicator(stripped)) {
              if (isEnded('', title) === false) deadline = ''
            }
          }
        } catch {}
        // If HTML gave a deadline but authoritative API exists and differs (e.g., HTML picked 25 Aug begin, API is 25 Sep end), prefer API
        if (deadline && apiDeadlineForHack2Skill && deadline !== apiDeadlineForHack2Skill) {
          deadline = apiDeadlineForHack2Skill
        } else if (!deadline && apiDeadlineForHack2Skill) {
          deadline = apiDeadlineForHack2Skill
        }
      } else if (apiDeadlineForHack2Skill && deadline !== apiDeadlineForHack2Skill) {
        // Even when raw existed, ensure API authoritative overrides any HTML-derived wrong date if still different
        // (covers case where raw was empty and HTML filled, but API is truer)
        const dHtml = new Date(deadline).getTime()
        const dApi = new Date(apiDeadlineForHack2Skill).getTime()
        if (!isNaN(dApi) && (isNaN(dHtml) || dApi !== dHtml)) {
          // Only override if HTML deadline looks like begin (earlier) and API is later end, or if HTML missing regist context
          // For fit_fest, HTML would be 2026-08-25 vs API 2026-09-25 -> override to API
          deadline = apiDeadlineForHack2Skill
        }
      }
      if (!deadline && !apiDeadlineForHack2Skill) {
        const apiDeadline = await fetchHack2SkillRegistrationEnd(url)
        if (apiDeadline) deadline = apiDeadline
      }
      if (!deadline && strippedForFallback && hasRegistrationClosedIndicator(strippedForFallback)) {
        // No deadline but page says Registration Closed => completed, skip
        continue
      }
      if (!deadline) deadline = inferDeadlineFromTitle(title, url)
      // isEnded correctly filters past deadlines; only active/upcoming with future deadline or no deadline but not past year are kept (Devfolio/Devpost/Unstop parity)
      // Also filter if Registration Closed indicator present even when deadline empty (covers SPA without API yet)
      if (isEnded(deadline, title)) continue
      if (!deadline && strippedForFallback && hasRegistrationClosedIndicator(strippedForFallback)) continue
      // HIGH fix: derive mode from event data (list value when evidenced, else event-details
      // tags.mode/finale/About cues). Default honest-omit '' — never hardcoded ONLINE.
      // IN_PERSON (offline finale @ RNSIT Bengaluru) must surface as OFFLINE, not ONLINE.
      let mode = mapHack2SkillModeValue((h as any).mode)
      if (!mode) {
        try { mode = await fetchHack2SkillEventMode(url) } catch { mode = '' }
      }
      // Timeline gap fix: map all 5 Timeline entries (already-downloaded event-details JSON)
      // to stages[] + dates[] (+ submissionStart/Finale via dates[] labels). Omit when absent.
      let apiStages: Array<{ title: string; date?: string }> = []
      let apiDates: Array<{ label: string; date: string }> | undefined
      let apiStartDate = h.startDate ? String(h.startDate).split('T')[0] : (h.startTime ? String(h.startTime).split('T')[0] : '')
      try {
        const tl = await fetchHack2SkillTimeline(url)
        if (tl.stages.length) apiStages = tl.stages
        if (tl.dates.length) apiDates = tl.dates
        if (!apiStartDate && tl.dates.length) {
          const regStart = tl.dates.find((d) => d.label === 'registration_start')
          if (regStart) apiStartDate = String(regStart.date).split('T')[0]
        }
      } catch {}
      // MEDIUMs 2-4 + LOWs 5-6 (safe part): prize/desc/team/org/title from the
      // same event-details JSON (shared cache, no extra fetch). All optional,
      // omit when absent (never invent ₹0/generic).
      let apiRich = { title: '', description: '', prizePool: '', prizeTiers: [] as string[], perks: [] as string[], teamSize: null as number | null, organizer: '' }
      try { apiRich = await fetchHack2SkillRichFields(url) } catch {}
      const oppApi: NormalizedOpportunity = {
        type: 'HACKATHON',
        title: title.slice(0, 150),
        description: apiRich.description || '',
        url,
        source: 'HACK2SKILL',
        organizer: (h.organizer || h.organisation || apiRich.organizer || 'Hack2Skill').toString().slice(0, 80) || 'Hack2Skill',
        deadline,
        startDate: apiStartDate,
        duration: h.duration || '',
        location: h.location || 'India',
        mode: mode || '',
        prizePool: apiRich.prizePool || '',
        stipend: '',
        company: '',
        role: '',
        themes: Array.isArray(h.themes) ? h.themes : [],
        website: h.website || '',
        discord: h.discord || '',
        participantsCount: h.participantsCount || 0,
        inviteOnly: !!h.inviteOnly,
        ...(apiRich.prizeTiers.length ? { prizeTiers: apiRich.prizeTiers } : {}),
        ...(apiRich.perks.length ? { perks: apiRich.perks } : {}),
        ...(apiRich.teamSize !== null ? { teamSize: apiRich.teamSize } : {}),
      }
      if (apiStages.length) oppApi.stages = apiStages
      if (apiDates?.length) oppApi.dates = apiDates
      opps.push(oppApi)
    }
    return opps
  } catch (_) {
    try {
      const sitemapKey = 'hack2skill:sitemap'
      let urls: string[] | undefined = scrapeCache.get<string[]>(sitemapKey)
      if (!urls) {
        const sitemapUrl = 'https://hack2skill.com/sitemap.xml'
        await validateExternalUrl(sitemapUrl)
        const res = await fetch(sitemapUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) })
        if (!res.ok) return []
        const xml = await res.text()
        const locRegex = /<loc>([^<]+)<\/loc>/g
        let m: RegExpExecArray | null
        const collected: string[] = []
        while ((m = locRegex.exec(xml)) !== null) {
          const loc = m[1].trim()
          if (!loc.includes('/event/')) continue
          collected.push(loc)
        }
        // Reverse so newest (future) events first — sitemap is oldest-first, but we need upcoming for target 10
        urls = [...collected].reverse()
        try { scrapeCache.set(sitemapKey, urls, 12 * 60 * 60) } catch {} // P0-D: 12h (was 6h)
      }
      if (!urls || urls.length === 0) return []
      const start = (page - 1) * PER_PAGE
      const pageUrls = urls.slice(start, start + PER_PAGE)
      const opps: NormalizedOpportunity[] = []
      for (const url of pageUrls) {
        try { await validateExternalUrl(url) } catch { continue }
        const slug = url.split('/event/')[1]?.split('/')[0]?.split('?')[0] || ''
        if (!slug) continue
        const rawTitle = slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()).trim()
        const title = rawTitle.toLowerCase().includes('hack') ? rawTitle : `${rawTitle} Hackathon`
        if (!title || title.length < 5 || isGenericTitle(title) || seen.has(title)) continue
        seen.add(title)
        // Prefer authoritative registrationEnd via event-details API BEFORE HTML (fix fit_fest 25 Aug vs 25 Sep)
        let apiDeadlineEarly = ''
        try { apiDeadlineEarly = await fetchHack2SkillRegistrationEnd(url) } catch {}
        let deadline = apiDeadlineEarly || ''
        let strippedForSitemap = ''
        try {
          const stripped = await fetchPage6k(url)
          strippedForSitemap = stripped || ''
          if (stripped && stripped.length > 100) {
            const ext = extractDeadlineFromContent(stripped)
            if (ext) {
              if (!deadline) deadline = ext
              else if (deadline !== ext) {
                // API authoritative overrides HTML mis-parse (e.g., HTML picked 25 Aug begin)
                deadline = apiDeadlineEarly || ext
              }
            }
          }
        } catch {}
        if (!deadline && apiDeadlineEarly) deadline = apiDeadlineEarly
        if (!deadline && !apiDeadlineEarly) {
          const apiDeadline = await fetchHack2SkillRegistrationEnd(url)
          if (apiDeadline) deadline = apiDeadline
        }
        if (!deadline && strippedForSitemap && hasRegistrationClosedIndicator(strippedForSitemap)) continue
        if (!deadline) deadline = inferDeadlineFromTitle(title, url)
        if (isEnded(deadline, title)) continue
        if (!deadline && strippedForSitemap && hasRegistrationClosedIndicator(strippedForSitemap)) continue
        // HIGH fix: sitemap path hardcoded ONLINE although event-details proves IN_PERSON offline.
        // Derive from event-details (tags.mode/finale/About); honest-omit '' when no evidence.
        let sitemapMode = ''
        try { sitemapMode = await fetchHack2SkillEventMode(url) } catch { sitemapMode = '' }
        // Timeline gap fix: same 5-phase mapping as API path (shared event-details cache, no extra fetch).
        let sitemapStages: Array<{ title: string; date?: string }> = []
        let sitemapDates: Array<{ label: string; date: string }> | undefined
        let sitemapStart = ''
        try {
          const tl = await fetchHack2SkillTimeline(url)
          if (tl.stages.length) sitemapStages = tl.stages
          if (tl.dates.length) {
            sitemapDates = tl.dates
            const regStart = tl.dates.find((d) => d.label === 'registration_start')
            if (regStart) sitemapStart = String(regStart.date).split('T')[0]
          }
        } catch {}
        // MEDIUMs 2-4 + LOWs 5-6: same rich fields as API path (shared cache).
        // Title prefers data.title casing (`ImpactX'26`) over slug casing
        // (`Impactx26 Hackathon`) when evidenced.
        let sitemapRich = { title: '', description: '', prizePool: '', prizeTiers: [] as string[], perks: [] as string[], teamSize: null as number | null, organizer: '' }
        try { sitemapRich = await fetchHack2SkillRichFields(url) } catch {}
        const sitemapFinalTitle = (sitemapRich.title || title).slice(0, 150)
        if (sitemapRich.title && sitemapRich.title !== title && seen.has(sitemapRich.title)) continue
        if (sitemapRich.title) seen.add(sitemapRich.title)
        const oppSitemap: NormalizedOpportunity = {
          type: 'HACKATHON',
          title: sitemapFinalTitle,
          description: sitemapRich.description || '',
          url,
          source: 'HACK2SKILL',
          organizer: (sitemapRich.organizer || 'Hack2Skill').slice(0, 80) || 'Hack2Skill',
          deadline,
          startDate: sitemapStart,
          duration: '',
          location: 'India',
          mode: sitemapMode || '',
          prizePool: sitemapRich.prizePool || '',
          stipend: '',
          company: '',
          role: '',
          themes: [],
          website: '',
          discord: '',
          participantsCount: 0,
          inviteOnly: false,
          ...(sitemapRich.prizeTiers.length ? { prizeTiers: sitemapRich.prizeTiers } : {}),
          ...(sitemapRich.perks.length ? { perks: sitemapRich.perks } : {}),
          ...(sitemapRich.teamSize !== null ? { teamSize: sitemapRich.teamSize } : {}),
        }
        if (sitemapStages.length) oppSitemap.stages = sitemapStages
        if (sitemapDates?.length) oppSitemap.dates = sitemapDates
        opps.push(oppSitemap)
      }
      return opps
    } catch { return [] }
  }
  }
  // Sitemap fallback for any page (including page>1 and when API fails on page 1)
  try {
    const sitemapKey = 'hack2skill:sitemap'
    let urls: string[] | undefined = scrapeCache.get<string[]>(sitemapKey)
    if (!urls) {
      const sitemapUrl = 'https://hack2skill.com/sitemap.xml'
      await validateExternalUrl(sitemapUrl)
      const res = await fetch(sitemapUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) })
      if (!res.ok) return []
      const xml = await res.text()
      const locRegex = /<loc>([^<]+)<\/loc>/g
      let m: RegExpExecArray | null
      const collected: string[] = []
      while ((m = locRegex.exec(xml)) !== null) {
        const loc = m[1].trim()
        if (!loc.includes('/event/')) continue
        collected.push(loc)
      }
      urls = [...collected].reverse()
      try { scrapeCache.set(sitemapKey, urls, 6 * 60 * 60) } catch {}
    }
    if (!urls || urls.length === 0) return []
    const start = (page - 1) * PER_PAGE
    const pageUrls = urls.slice(start, start + PER_PAGE)
    const opps: NormalizedOpportunity[] = []
    for (const url of pageUrls) {
      try { await validateExternalUrl(url) } catch { continue }
      const slug = url.split('/event/')[1]?.split('/')[0]?.split('?')[0] || ''
      if (!slug) continue
      const rawTitle = slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()).trim()
      const title = rawTitle.toLowerCase().includes('hack') ? rawTitle : `${rawTitle} Hackathon`
      if (!title || title.length < 5 || isGenericTitle(title) || seen.has(title)) continue
      seen.add(title)
      let apiDeadlineEarly2 = ''
      try { apiDeadlineEarly2 = await fetchHack2SkillRegistrationEnd(url) } catch {}
      let deadline = apiDeadlineEarly2 || ''
      let strippedForSitemap = ''
      try {
        const stripped = await fetchPage6k(url)
        strippedForSitemap = stripped || ''
        if (stripped && stripped.length > 100) {
          const ext = extractDeadlineFromContent(stripped)
          if (ext) {
            if (!deadline) deadline = ext
            else if (deadline !== ext) deadline = apiDeadlineEarly2 || ext
          }
        }
      } catch {}
      if (!deadline && apiDeadlineEarly2) deadline = apiDeadlineEarly2
      if (!deadline && !apiDeadlineEarly2) {
        const apiDeadline = await fetchHack2SkillRegistrationEnd(url)
        if (apiDeadline) deadline = apiDeadline
      }
      if (!deadline && strippedForSitemap && hasRegistrationClosedIndicator(strippedForSitemap)) continue
      if (!deadline) deadline = inferDeadlineFromTitle(title, url)
      if (isEnded(deadline, title)) continue
      if (!deadline && strippedForSitemap && hasRegistrationClosedIndicator(strippedForSitemap)) continue
      // HIGH fix: same honest mode derivation for page>1 sitemap path (never hardcoded ONLINE).
      let sitemapMode2 = ''
      try { sitemapMode2 = await fetchHack2SkillEventMode(url) } catch { sitemapMode2 = '' }
      // Timeline gap fix: same 5-phase mapping (shared cache, no extra fetch).
      let sitemapStages2: Array<{ title: string; date?: string }> = []
      let sitemapDates2: Array<{ label: string; date: string }> | undefined
      let sitemapStart2 = ''
      try {
        const tl = await fetchHack2SkillTimeline(url)
        if (tl.stages.length) sitemapStages2 = tl.stages
        if (tl.dates.length) {
          sitemapDates2 = tl.dates
          const regStart = tl.dates.find((d) => d.label === 'registration_start')
          if (regStart) sitemapStart2 = String(regStart.date).split('T')[0]
        }
      } catch {}
      // MEDIUMs 2-4 + LOWs 5-6: same rich fields (shared cache).
      let sitemapRich2 = { title: '', description: '', prizePool: '', prizeTiers: [] as string[], perks: [] as string[], teamSize: null as number | null, organizer: '' }
      try { sitemapRich2 = await fetchHack2SkillRichFields(url) } catch {}
      const sitemapFinalTitle2 = (sitemapRich2.title || title).slice(0, 150)
      if (sitemapRich2.title && sitemapRich2.title !== title && seen.has(sitemapRich2.title)) continue
      if (sitemapRich2.title) seen.add(sitemapRich2.title)
      const oppSitemap2: NormalizedOpportunity = {
        type: 'HACKATHON',
        title: sitemapFinalTitle2,
        description: sitemapRich2.description || '',
        url,
        source: 'HACK2SKILL',
        organizer: (sitemapRich2.organizer || 'Hack2Skill').slice(0, 80) || 'Hack2Skill',
        deadline,
        startDate: sitemapStart2,
        duration: '',
        location: 'India',
        mode: sitemapMode2 || '',
        prizePool: sitemapRich2.prizePool || '',
        stipend: '',
        company: '',
        role: '',
        themes: [],
        website: '',
        discord: '',
        participantsCount: 0,
        inviteOnly: false,
        ...(sitemapRich2.prizeTiers.length ? { prizeTiers: sitemapRich2.prizeTiers } : {}),
        ...(sitemapRich2.perks.length ? { perks: sitemapRich2.perks } : {}),
        ...(sitemapRich2.teamSize !== null ? { teamSize: sitemapRich2.teamSize } : {}),
      }
      if (sitemapStages2.length) oppSitemap2.stages = sitemapStages2
      if (sitemapDates2?.length) oppSitemap2.dates = sitemapDates2
      opps.push(oppSitemap2)
    }
    return opps
  } catch { return [] }
}


export async function fetchHack2Skill(limit?: number): Promise<NormalizedOpportunity[]> {
  const target = limit && limit > 0 ? limit : 30
  const seen = new Set<string>()
  const newItems: NormalizedOpportunity[] = []
  for (let page = 1; page <= MAX_PAGES && newItems.length < target; page++) {
    const results = await fetchHack2SkillApiPage(page, seen)
    // Don't break on 0 — sitemap filtering (isEnded) can yield 0 even when later pages have upcoming (sitemap is oldest-first, reversed newest-first but still many past). Continue scanning.
    if (results.length === 0) {
      // If we've exhausted sitemap (page beyond total urls), pageUrls will be empty and results 0 for remaining pages — continue still safe, loop will end at MAX_PAGES.
      if (page >= MAX_PAGES) break
      continue
    }
    const titles = results.map(r => r.title).filter(Boolean)
    let existingTitles = new Set<string>()
    if (titles.length) {
      try {
        const existing = await prisma.hackathonStaging.findMany({
          where: { title: { in: titles }, source: 'HACK2SKILL' },
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
  const sliced = newItems.slice(0, target)
  logger.info(`[Hack2Skill] Fetched ${sliced.length} hackathons (target ${limit || 30}) capped at ${MAX_PAGES} pages 10 fetches max`)
  return sliced
}
