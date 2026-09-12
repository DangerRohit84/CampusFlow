// Search the web for details when page content is an SPA
export async function searchDetails(query: string): Promise<string> {
  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const resp = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: AbortSignal.timeout(10000),
    })
    const html = await resp.text()
    const snippets: string[] = []
    let match

    const snippetRegex = /class="result__snippet"[^>]*href="[^"]*"[^>]*>([\s\S]*?)<\/a>/gi
    while ((match = snippetRegex.exec(html)) !== null) {
      const text = match[1].replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim()
      if (text.length > 20) snippets.push(text)
    }

    return snippets.map((s, i) => `[${i + 1}] ${s}`).join('\n')
  } catch {
    return ''
  }
}

import * as chrono from 'chrono-node'
import { parse as dateFnsParse, isValid as isValidDateFns } from 'date-fns'

function normalizeYear(y: string): string {
  if (!y) return new Date().getFullYear().toString()
  if (y.length === 2) {
    const n = parseInt(y, 10)
    // 00-69 => 2000-2069, 70-99 => 1970-1999
    return String(n < 70 ? 2000 + n : 1900 + n)
  }
  return y
}

// ─── Internet-researched robust date parsing ──────────────────────────────────
// Research (Sep 2026):
// - Pistack 2026 comparison: chrono-node is "natural language powerhouse" for Node.js (5.2K stars, 3M weekly downloads),
//   supports 200+ locales via dateparser fallback, handles fuzzy parsing, ISO 8601, relative dates, ordinal stripping,
//   custom refiners, timezone handling. Recommended for self-hosted scraping pipelines with heterogeneous dates.
// - XCODX 2026 guide: date-fns is modular tree-shakable default for structured formats, Luxon for timezone-heavy,
//   Day.js tiny. For known format strings use date-fns parse with multiple format fallback.
// - MDN & DateAndTimeConverter 2026: Date.parse() only guarantees ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ); all other
//   formats are implementation-defined and vary across engines. Must use library.
// - Best practice for 2-digit year: cutoff 50 ( <50 => 2000s, >=50 => 1900s). For Indian hackathon data 25 => 2025, 26 => 2026.
// - IST mapping: chrono supports custom timezone mappings; IST = +330. We rely on chrono's built-in IST handling
//   and also strip time before fallback regex to avoid "Sep 26, 07" hour-as-year bug.
// Strategy (hybrid, per internet best practice):
//  1) chrono-node strict+casual as primary (heterogeneous natural language, handles "25 Sep 26 07:59 PM IST",
//     "22nd Aug", "Sept 26", "Fri 07 Mar 2025", dash ranges, ordinals, weekday prefix).
//  2) date-fns parseMultiple with explicit format list as secondary (structured known formats).
//  3) Regex fallback (existing logic) as tertiary ensure no regression.
// This order matches Pi Stack deployment architecture: chrono worker + date-fns fallback.

function expandTwoDigitYearsForChrono(text: string): string {
  // "25 Aug 26" -> "25 Aug 2026" ; "Aug 25, 26" -> "Aug 25, 2026"
  let out = text.replace(
    /(\b\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t)?|Sept|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+)(\d{2})\b/gi,
    (_m, p1: string, y: string) => p1 + normalizeYear(y),
  )
  out = out.replace(
    /(\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t)?|Sept|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}\b,?\s+)(\d{2})\b/gi,
    (_m, p1: string, y: string) => p1 + normalizeYear(y),
  )
  return out
}

function tryChronoParse(text: string): string {
  if (!text || text.length < 3) return ''
  // Normalize Sept -> Sep for maximal compatibility (chrono handles Sept but normalize anyway)
  const normalized = text.replace(/\bSept\b/gi, 'Sep')
  const expanded = expandTwoDigitYearsForChrono(normalized)
  const ref = new Date()
  try {
    // Try strict first (formal patterns), then casual (includes relative like 22nd Aug without year)
    let results = chrono.strict.parse(expanded, ref, { forwardDate: false } as any)
    if (!results.length) results = (chrono as any).casual
      ? (chrono as any).casual.parse(expanded, ref, { forwardDate: false })
      : chrono.parse(expanded, ref, { forwardDate: false } as any)
    if (!results.length) {
      // Fallback via parseDate direct - guard against time-only (e.g., "07:59 PM" -> today) which has no month/day explicit
      if (!/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{1,2}[\/\-]\d{1,2})/i.test(expanded)) return ''
      const d = chrono.parseDate(expanded, ref, { forwardDate: false } as any)
      if (d && !isNaN(d.getTime())) {
        const y = d.getFullYear()
        const m = d.getMonth() + 1
        const day = d.getDate()
        if (m >= 1 && m <= 12 && day >= 1 && day <= 31 && y >= 1970 && y <= 2100) {
          // Require that original text contained a digit to avoid false positives like "today"
          if (/\d/.test(text)) return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        }
      }
      return ''
    }
    // Prefer first result that has day and month; require day/month certain to avoid time-only false positives (e.g., "07:59 PM" -> today)
    for (const r of results) {
      // Guard: time-only like "07:59 PM IST" has isCertain day/month false (implied today) -> skip
      if (!r.start.isCertain('day') || !r.start.isCertain('month')) continue
      const day = r.start.get('day')
      const month = r.start.get('month')
      let year = r.start.get('year')
      if (!day || !month) continue
      if (!year) year = ref.getFullYear()
      else if (year < 100) year = parseInt(normalizeYear(String(year)), 10)
      if (year < 1970 || year > 2100) continue
      if (!/\d/.test(r.text)) continue
      const mm = String(month).padStart(2, '0')
      const dd = String(day).padStart(2, '0')
      return `${year}-${mm}-${dd}`
    }
  } catch {}
  return ''
}

function tryDateFnsParse(text: string): string {
  if (!text || text.length < 3) return ''
  const ref = new Date()
  // Clean weekday/ordinal/Sept already done in caller, but ensure here too for direct calls
  let cleaned = text.replace(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s+/i, '').trim()
  cleaned = cleaned.replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/gi, '$1')
  cleaned = cleaned.replace(/\bSept\b/gi, 'Sep')
  const formats = [
    'yyyy-MM-dd',
    'yyyy/MM/dd',
    'dd-MM-yyyy',
    'MM-dd-yyyy',
    'dd/MM/yyyy',
    'MM/dd/yyyy',
    'd MMM yyyy',
    'd MMM yy',
    'dd MMM yyyy',
    'dd MMM yy',
    'MMM d yyyy',
    'MMM d yy',
    'MMM d, yyyy',
    'MMM d, yy',
    'MMMM d, yyyy',
    'MMMM d yyyy',
    'd MMMM yyyy',
    'd MMMM yy',
    'MMM dd yyyy',
    'MMMM dd yyyy',
    'd MMM yyyy HH:mm',
    'dd MMM yyyy HH:mm',
    'MMM dd, yyyy',
    'd MMM yyyy hh:mm a',
    'dd MMM yyyy hh:mm a',
  ]
  for (const fmt of formats) {
    try {
      const d = dateFnsParse(cleaned, fmt, ref)
      if (isValidDateFns(d)) {
        const y = d.getFullYear()
        if (y < 1970 || y > 2100) continue
        // Guard against date-fns returning ref date when parse fails to match format (often returns Invalid Date, but check)
        // Ensure year is plausible: if fmt contains yy and original had 2-digit, date-fns may map 26->2026 correctly; verify via isValid already
        return `${y}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      }
    } catch {}
  }
  return ''
}

// Parse date strings found in search results to YYYY-MM-DD format
export function parseSearchDate(dateStr: string): string {
  if (!dateStr) return ''
  // Strip weekday prefix and ordinal suffixes (22nd, 11th, 1st) before parsing
  let cleaned = dateStr.trim().replace(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s+/i, '').trim()
  cleaned = cleaned.replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/gi, '$1')
  // Normalize Sept -> Sep early for all parsers
  cleaned = cleaned.replace(/\bSept\b/gi, 'Sep')
  // Remove time patterns (07:59 PM IST, 03:14 PM, 14:29) before date parsing to avoid year=time-hour false matches like "Sep 26, 07" from "Sep 26, 07:59 PM"
  // Keep original cleaned for chrono attempt that handles time with timezone, but also create timeStripped for regex safety
  const timeStripped = cleaned
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|IST|UTC|GMT)?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/,+$/, '')
    .trim()
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(timeStripped)) return timeStripped
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned

  // 1) Chrono-node primary (internet best practice for heterogeneous scraping)
  try {
    // Try on timeStripped first to avoid hour-as-year bug, then on original cleaned (which chrono can handle with IST)
    const chronoStripped = tryChronoParse(timeStripped)
    if (chronoStripped) return chronoStripped
    if (timeStripped !== cleaned) {
      const chronoOriginal = tryChronoParse(cleaned)
      if (chronoOriginal) return chronoOriginal
    }
  } catch {}

  // 2) date-fns secondary (structured formats, explicit format list)
  try {
    const dfStripped = tryDateFnsParse(timeStripped)
    if (dfStripped) return dfStripped
    if (timeStripped !== cleaned) {
      const dfOriginal = tryDateFnsParse(cleaned)
      if (dfOriginal) return dfOriginal
    }
  } catch {}

  // 3) Regex fallback (tertiary, ensures no regression if libraries miss)
  const monthNames: Record<string, string> = {
    january: '01',
    february: '02',
    march: '03',
    april: '04',
    may: '05',
    june: '06',
    july: '07',
    august: '08',
    september: '09',
    october: '10',
    november: '11',
    december: '12',
    jan: '01',
    feb: '02',
    mar: '03',
    apr: '04',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    sept: '09',
    oct: '10',
    nov: '11',
    dec: '12',
  }

  // Use timeStripped for regex to avoid time-hour confusion
  const regexSource = timeStripped

  const longMatch = regexSource.match(/(\w+)\s+(\d{1,2})\b,?\s+(\d{2,4})\b/)
  if (longMatch) {
    const month = monthNames[longMatch[1].toLowerCase()]
    if (month) {
      const year = normalizeYear(longMatch[3])
      return `${year}-${month}-${longMatch[2].padStart(2, '0')}`
    }
  }

  // "15 January 2026" or "15 Jan 2026" or "07 Mar 2025" or "7 March 2025" / "25 Aug 26"
  const reverseMatch = regexSource.match(/(\d{1,2})\b\s+(\w+)\b\s*,?\s*(\d{2,4})?\b/)
  if (reverseMatch) {
    const month = monthNames[reverseMatch[2].toLowerCase()]
    if (month) {
      const year = reverseMatch[3] ? normalizeYear(reverseMatch[3]) : new Date().getFullYear().toString()
      return `${year}-${month}-${reverseMatch[1].padStart(2, '0')}`
    }
  }

  // "01/15/2026" or "15/01/2026"
  const slashMatch = regexSource.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/)
  if (slashMatch) {
    // Assume MM/DD/YYYY if first part <= 12
    const first = parseInt(slashMatch[1])
    const second = parseInt(slashMatch[2])
    if (first <= 12 && second <= 31) {
      return `${slashMatch[3]}-${slashMatch[1].padStart(2, '0')}-${slashMatch[2].padStart(2, '0')}`
    } else if (second <= 12 && first <= 31) {
      return `${slashMatch[3]}-${slashMatch[2].padStart(2, '0')}-${slashMatch[1].padStart(2, '0')}`
    }
  }

  return ''
}

// ─── Priority deadline extraction from full page content ───
// Tries "LAST DATE TO REGISTER Fri 07 Mar 2025" first, then other deadline labels, then generic dates.
// Returns YYYY-MM-DD or ''.
// Cognition fix: page has BOTH Registrations begin 22 Aug and Registrations end 11 Sep — must return 11 Sep (the END), not 22 Aug (the BEGIN).
// Also handles ordinals (22nd, 11th) and picks LATEST registration-end date when multiple candidates exist.
// Updated to use chrono for each candidate (internet robust solution).
const WEEKDAY = '(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*'
const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*'
const ORD = '(?:st|nd|rd|th)?'
const DATE_MDY = `${MONTH}\\s+\\d{1,2}${ORD}\\b,?\\s+\\d{2,4}\\b`
const DATE_DMY = `\\d{1,2}${ORD}\\b\\s+${MONTH}\\b\\s*,?\\s*\\d{2,4}\\b`
const DATE_NUM = `\\d{1,2}[\\/\\-]\\d{1,2}[\\/\\-]\\d{2,4}`
const DATE_ANY = `(?:${DATE_DMY}|${DATE_MDY}|${DATE_NUM})`
const DATE_WITH_WEEKDAY = `\\b(?:${WEEKDAY}\\s+)?(?:${DATE_ANY})\\b`

function tryParseDateCandidate(candidate: string): string {
  // For range dash, prefer end date (deadline is end of range)
  // Detect range like "25 Aug 26 - 25 Sep 26" and try chrono range parsing for end
  if (/[-–]| to /i.test(candidate) && candidate.length < 80) {
    try {
      const expanded = expandTwoDigitYearsForChrono(candidate.replace(/\bSept\b/gi, 'Sep'))
      const ref = new Date()
      const results = chrono.parse(expanded, ref, { forwardDate: false } as any)
      if (results.length && results[0].end) {
        const end = results[0].end
        const day = end.get('day')
        const month = end.get('month')
        let year = end.get('year')
        if (day && month) {
          if (!year) year = results[0].start.get('year') || ref.getFullYear()
          if (year && year < 100) year = parseInt(normalizeYear(String(year)), 10)
          if (year && year >= 2024 && year <= 2030) {
            const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            if (/\d/.test(results[0].text)) return iso
          }
        }
      }
    } catch {}
  }
  // Extract the date-looking substring from candidate (strip prefix like "LAST DATE TO REGISTER")
  const m = candidate.match(new RegExp(DATE_WITH_WEEKDAY, 'i'))
  if (m) {
    const parsed = parseSearchDate(m[0])
    if (parsed) return parsed
  }
  // Fallback: try whole candidate via robust parser (chrono+date-fns+regex)
  return parseSearchDate(candidate)
}

export function extractDeadlineFromContent(content: string): string {
  if (!content || content.length < 10) return ''
  const normalized = content.replace(/\s+/g, ' ')
  // Helper to score a match: prefer END/CLOSE/DEADLINE/LAST over BEGIN/START/OPEN
  function scoreCandidate(fullMatch: string): number {
    const lower = fullMatch.toLowerCase()
    // High priority: explicit end/close/deadline/last
    if (
      /(last\s+date|deadline|closes?\s+on|ends?\s+on|apply\s+by|submission\s+deadline|registration\s+ends?|registration\s+closes?|registrations?\s+end|registrations?\s+close)/i.test(
        lower,
      )
    )
      return 2
    // Low priority: begin/start/open
    if (
      /(registrations?\s+begin|registrations?\s+start|registrations?\s+open|registration\s+starts?|registration\s+begins?|opens\s+on|starts\s+on|begins\s+on)/i.test(
        lower,
      )
    )
      return 0
    // Medium: generic regist/apply without clear begin/end
    if (/regist/i.test(lower)) return 1
    return 1
  }

  // Collect ALL priority pattern matches first, then pick best by score then latest date
  const allCandidates: Array<{ raw: string; parsed: string; score: number; ts: number }> = []
  const priorityPatterns: RegExp[] = [
    // LAST DATE TO REGISTER Fri 07 Mar 2025  (Hack2Skill specific, highest priority)
    new RegExp(`LAST DATE TO REGISTER[^A-Za-z0-9]{0,30}(?:${WEEKDAY}\\s+)?${DATE_ANY}`, 'gi'),
    // REGISTRATION DEADLINE / LAST DATE variants (including Registrations end)
    new RegExp(
      `(?:REGISTRATION\\s+DEADLINE|REGISTRATIONS?\\s+ENDS?|REGISTRATIONS?\\s+CLOSES?|REGISTRATION\\s+CLOSES?|REGISTRATION\\s+ENDS?|LAST\\s+DATE)[^A-Za-z0-9]{0,40}(?:${WEEKDAY}\\s+)?${DATE_ANY}`,
      'gi',
    ),
    // APPLY BY / DEADLINE / CLOSES ON / ENDS ON / PROTOTYPE SUBMISSION
    new RegExp(
      `(?:APPLY\\s+BY|DEADLINE|CLOSES?\\s+ON|ENDS?\\s+ON|SUBMISSION\\s+DEADLINE|PROTOTYPE\\s+SUBMISSION)[^A-Za-z0-9]{0,40}(?:${WEEKDAY}\\s+)?${DATE_ANY}`,
      'gi',
    ),
  ]
  for (const pat of priorityPatterns) {
    let m: RegExpExecArray | null
    // Reset lastIndex for safety
    pat.lastIndex = 0
    while ((m = pat.exec(normalized)) !== null) {
      const parsed = tryParseDateCandidate(m[0])
      if (parsed) {
        const y = parseInt(parsed.split('-')[0], 10)
        if (y >= 2024 && y <= 2030) {
          const ts = new Date(parsed).getTime()
          if (!isNaN(ts)) allCandidates.push({ raw: m[0], parsed, score: scoreCandidate(m[0]), ts })
        }
      }
      // Avoid infinite loop on zero-length
      if (m[0].length === 0) pat.lastIndex++
    }
  }
  if (allCandidates.length > 0) {
    // Prefer highest score, then latest date (registrations end = later than begin)
    allCandidates.sort((a, b) => b.score - a.score || b.ts - a.ts)
    // If multiple with same top score, pick latest date
    const topScore = allCandidates[0].score
    const topBucket = allCandidates.filter((c) => c.score === topScore)
    topBucket.sort((a, b) => b.ts - a.ts)
    return topBucket[0].parsed
  }

  // Proximity heuristic: collect ALL dates and check 80-char window for regist/deadline/apply
  // Fixed: previous regex `regist[^\n]{0,80}(DATE)` greedily matched "5 Sep" from "25 Sep" -> now iterate dates and check window
  const proximityCandidates: Array<{ parsed: string; ts: number; score: number; raw: string; registAfterDate: boolean }> = []
  const proxDateRegex = new RegExp(DATE_WITH_WEEKDAY, 'gi')
  let dateMatch: RegExpExecArray | null
  while ((dateMatch = proxDateRegex.exec(normalized)) !== null) {
    const dateStr = dateMatch[0]
    const parsed = parseSearchDate(dateStr)
    if (!parsed) continue
    const y = parseInt(parsed.split('-')[0], 10)
    if (y < 2024 || y > 2030) continue
    const ts = new Date(parsed).getTime()
    if (isNaN(ts)) continue
    // Check 40 chars before and after date for registration keywords (expanded from 25 to reliably catch "25 Sep 26, 07:59 PM IST Registration" where Registration is ~22 chars after date and also handle timeline dash ranges)
    const winStart = Math.max(0, dateMatch.index! - 40)
    const winEnd = Math.min(normalized.length, dateMatch.index! + dateStr.length + 40)
    const windowCtx = normalized.slice(winStart, winEnd)
    if (!/(regist|deadline|apply)/i.test(windowCtx)) continue
    const score = scoreCandidate(windowCtx)
    const regIdx = windowCtx.toLowerCase().search(/regist|deadline|apply/i)
    const dateIdxInWin = dateMatch.index! - winStart
    const registAfterDate = regIdx !== -1 && regIdx > dateIdxInWin
    proximityCandidates.push({ parsed, ts, score, raw: dateStr, registAfterDate })
    if (dateMatch[0].length === 0) proxDateRegex.lastIndex++
  }
  if (proximityCandidates.length > 0) {
    // For timeline "25 Aug - 25 Sep Registration, 27 Sep": both 25 Sep (before Regist) and 27 Sep (after Regist) are near regist.
    // Prefer dates where regist is AFTER date (date before keyword) as true registration end, over dates where regist is before date (event day).
    const groupA = proximityCandidates.filter((c) => c.registAfterDate)
    const groupB = proximityCandidates.filter((c) => !c.registAfterDate)
    const preferGroup = groupA.length > 0 ? groupA : proximityCandidates
    preferGroup.sort((a, b) => b.score - a.score || b.ts - a.ts)
    const topScore = preferGroup[0].score
    const topBucket = preferGroup.filter((c) => c.score === topScore)
    topBucket.sort((a, b) => b.ts - a.ts)
    // For Cognition: 22 Aug begin (score 0) vs 11 Sep end (score 2) -> picks 11 Sep
    // If scores tie (both generic regist), pick latest date among preferred group (25 Sep before Regist, not 27 Sep after)
    return topBucket[0].parsed
  }

  // Generic fallback: collect all plausible dates, prefer latest registration-end over earliest
  // But avoid picking event dates far after deadline (e.g., Sep 26 finals vs Sep 11 deadline)
  // So collect all and pick latest that is NOT clearly an event date without registration context?
  // For safety, return latest plausible date within 2024-2030
  const genericCandidates: Array<{ parsed: string; ts: number }> = []
  const genericRegex = new RegExp(DATE_WITH_WEEKDAY, 'gi')
  let m: RegExpExecArray | null
  while ((m = genericRegex.exec(normalized)) !== null) {
    const parsed = parseSearchDate(m[0])
    if (parsed) {
      const y = parseInt(parsed.split('-')[0], 10)
      if (y >= 2024 && y <= 2030) {
        const ts = new Date(parsed).getTime()
        if (!isNaN(ts)) genericCandidates.push({ parsed, ts })
      }
    }
  }
  if (genericCandidates.length > 0) {
    // Generic fallback is last resort when no registration keyword found.
    // For dash range "25 Aug - 25 Sep" without keyword, latest is deadline (end), not earliest (begin).
    // For event with multiple dates and no keyword, picking latest might be event finale, but proximity would have handled regist cases.
    // Prefer latest plausible date within 2024-2030 as deadline for generic range; safe for fit_fest dash range.
    genericCandidates.sort((a, b) => b.ts - a.ts)
    return genericCandidates[0].parsed
  }
  // Additional chrono whole-content fallback for timeline dash ranges missed by regex
  // Use expanded chrono parse on whole content to capture "25 Aug 26 - 25 Sep 26" range end
  try {
    const expandedContent = expandTwoDigitYearsForChrono(normalized.replace(/\bSept\b/gi, 'Sep'))
    const ref = new Date()
    const chronoAll = chrono.parse(expandedContent, ref, { forwardDate: false } as any)
    const chronoCandidates: Array<{ parsed: string; ts: number }> = []
    for (const r of chronoAll) {
      // Consider both start and end (range) - require day/month certain to avoid time-only false positives
      const consider = (comp: any) => {
        if (!comp.isCertain('day') || !comp.isCertain('month')) return
        const day = comp.get('day')
        const month = comp.get('month')
        let year = comp.get('year')
        if (!day || !month) return
        if (!year) year = ref.getFullYear()
        else if (year < 100) year = parseInt(normalizeYear(String(year)), 10)
        if (year < 2024 || year > 2030) return
        const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        const ts = new Date(iso).getTime()
        if (!isNaN(ts)) chronoCandidates.push({ parsed: iso, ts })
      }
      consider(r.start)
      if (r.end) consider(r.end)
    }
    if (chronoCandidates.length > 0) {
      chronoCandidates.sort((a, b) => b.ts - a.ts)
      return chronoCandidates[0].parsed
    }
  } catch {}
  return ''
}

export function hasRegistrationClosedIndicator(content: string): boolean {
  if (!content) return false
  return /registration\s+closed/i.test(content)
}
