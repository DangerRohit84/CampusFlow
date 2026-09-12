// opportunities/sources/searchFetch.ts — DDG discovery + page fetch (SRP extract from search.ts).
// WHY: search.ts mixed discovery + AI extract + orchestration in one 1086-line god.
// This file owns human-URL discovery (decode/slugify/DDG/generic). AbortSignal timeouts preserved.
import prisma from '../../../config/db'
import { searchDetails, parseSearchDate, extractDeadlineFromContent, hasRegistrationClosedIndicator } from '../../../utils/search'
import { validateExternalUrl } from '../../../utils/secureUrl'
import { logger } from '../../../utils/logger'
import { scrapeCache, isAiGloballyRateLimited, markAiRateLimited } from '../cache'
import type { NormalizedOpportunity } from '../types'
import { hasValue } from '../types'
import { stripHtml, isGenericTitle } from '../text'
import { extractPastYearFromTitle, isTitlePastYear, inferDeadlineFromTitle, isEnded } from '../dates'
import { isCompanyStartupCollegeOrganizer, getHackathonReputationScore, applyHighOrganizerTrustBoost, DYNAMIC_COMPANY_COLLEGE_INDICATORS } from '../reputation'
import { UA, MAX_PAGES, PER_PAGE, fetchPage6k } from './context'
import { chatCompletion, isAiRateLimitError, toAiIssueMessage } from '../../../ai/client'
import { AiRateLimitError, isRateLimitError, buildAiIssue, isGroqKeySet, isEnrichmentAIDisabled } from '../errors'
import { fetchHack2SkillRegistrationEnd } from './hack2skill'
import { slugify } from './searchSlug'
import { cleanDescription, extractPrizeTiers, extractTeamSize, extractEligibility, extractVenueMode, extractJudging, extractScheduleText, extractStages } from './details'
export { slugify } from './searchSlug'

/**
 * True when DDG HTML is the bot-challenge page (MEDIUM 2026-09-10 DDG-flake wart, safe part).
 * WHY: `site:` queries often trigger DDG `anomaly-modal` bot check; caching that
 * HTML poisons the 600s cache with 0 results. Dora already guards; generic/human
 * paths did not (they cached anomaly HTML as if it were results).
 * Pure, no network/DB. Callers must treat anomaly as no-content (return []),
 * never cache.
 */
export function isDuckDuckGoAnomalyPage(html: unknown): boolean {
  if (typeof html !== 'string' || !html) return false
  return html.toLowerCase().includes('anomaly-modal')
}

/** Decode snippet entities without losing ₹/dash (same safe parts as text.ts stripHtml). */
function decodeSnippetEntities(s: string): string {
  return String(s ?? '')
    .replace(/&#8377;|&#x20B9;|&#X20B9;/g, '₹')
    .replace(/&#8211;|&#8212;|&#45;/g, '-')
    .replace(/&(ndash|mdash|minus|hyphen);/gi, '-')
    .replace(/&(rupee|Rs);/gi, '₹')
    .replace(/&#x27;|&#39;|&apos;/gi, "'")
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function decodeDuckDuckGoHref(href: string): string {
  if (!href) return ''
  // handle //duckduckgo.com/l/?uddg=https%3A%2F%2F...
  try {
    if (href.startsWith('//')) href = 'https:' + href
    const u = new URL(href)
    const uddg = u.searchParams.get('uddg')
    if (uddg) return decodeURIComponent(uddg)
    // also handle param 'uddg' encoded differently or 'url'
    return href
  } catch (err) { logger.debug({ err }, '[searchFetch] non-fatal (treated as empty/skip)');
    // fallback: extract uddg= manually
    const m = href.match(/[?&]uddg=([^&]+)/)
    if (m) {
      try { return decodeURIComponent(m[1]) } catch (err) { logger.debug({ err }, '[searchFetch] non-fatal (treated as empty/skip)'); return m[1] }
    }
    return href
  }
}


export async function fetchGenericViaSearch(query: string, page: number, seen: Set<string>, source: 'OTHER_HACKATHON' | 'OTHER_INTERNSHIP', type: 'HACKATHON' | 'INTERNSHIP'): Promise<NormalizedOpportunity[]> {
  // DuckDuckGo html search - generic listing with India 2026 focus
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&p=${page}`
  const cacheKey = `ddg:${source}:${query}:${page}`
  let html: string | undefined = scrapeCache.get<string>(cacheKey)
  if (!html) {
    // ddg is hardcoded allowlist, no need for validateExternalUrl but keep timeout
    try {
      const res = await fetch(searchUrl, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) return []
      html = await res.text()
      // DDG-flake guard (safe part): never cache anomaly-modal bot-check HTML.
      if (html && isDuckDuckGoAnomalyPage(html)) return []
      const stripped = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 6000)
      if (stripped.length > 100) scrapeCache.set(cacheKey, html)
    } catch (err) { logger.debug({ err }, '[searchFetch] non-fatal (treated as empty/skip)'); return [] }
    if (!html) return []
  } else if (isDuckDuckGoAnomalyPage(html)) {
    // Cached anomaly (pre-fix) must not be treated as results.
    return []
  }
  const opportunities: NormalizedOpportunity[] = []
  // Parse result links: class="result__a" and snippets class="result__snippet"
  const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  const snippetRegex = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi
  // Collect snippets in order to pair with links
  const snippets: string[] = []
  let sMatch: RegExpExecArray | null
  while ((sMatch = snippetRegex.exec(html)) !== null) {
    const txt = decodeSnippetEntities(sMatch[1].replace(/<[^>]+>/g, ' '))
    if (txt.length > 20) snippets.push(txt)
  }
  let idx = 0
  let match: RegExpExecArray | null
  while ((match = linkRegex.exec(html)) !== null && opportunities.length < 15) {
    let href = match[1] || ''
    const titleHtml = match[2] || ''
    href = decodeDuckDuckGoHref(href)
    // DDG-flake pairing fix (safe part): every skipped link must still advance
    // the snippet cursor, else snippets misalign (old code advanced only on
    // title-skip, not href/validate-skip → wrong snippet paired with title).
    if (!href || href.includes('duckduckgo.com')) { idx++; continue }
    // validate external url for each result
    try { await validateExternalUrl(href) } catch (err) { logger.debug({ err }, '[searchFetch] non-fatal (treated as empty/skip)'); idx++; continue }
    const title = decodeSnippetEntities(titleHtml.replace(/<[^>]+>/g, ' ')).slice(0, 150)
    if (!title || title.length < 5 || isGenericTitle(title) || seen.has(title)) { idx++; continue }
    // Heuristic: for hackathons, title should contain hackathon/hack; for internships, internship
    const lowerTitle = title.toLowerCase()
    const lowerHref = href.toLowerCase()
    const snippet = snippets[idx] || ''
    const combined = `${title} ${snippet} ${href}`.toLowerCase()
    if (type === 'HACKATHON') {
      if (!combined.includes('hackathon') && !combined.includes('hack ')) { idx++; continue }
    } else {
      if (!combined.includes('internship') && !combined.includes('intern ')) { idx++; continue }
    }
    seen.add(title)
    // ─── Deadline: always fetch link page for authoritative date (priority: LAST DATE TO REGISTER) ───
    // Previous fix only used snippet/title regex; now we also fetch page and parse LAST DATE TO REGISTER / Registration Closed.
    let deadline = extractDeadlineFromContent(`${title} ${snippet}`)
    try {
      const strippedPage = await fetchPage6k(href)
      if (strippedPage && strippedPage.length > 80) {
        const pageDeadline = extractDeadlineFromContent(strippedPage)
        if (pageDeadline) deadline = pageDeadline
        // Registration Closed without date still implies past, but deadline stays as extracted or fallback
      }
    } catch (err) { logger.debug({ err }, '[searchFetch] non-fatal (treated as empty/skip)');}
    if (!deadline) {
      const inferred = inferDeadlineFromTitle(title, href)
      if (inferred) deadline = inferred
    }
    if (isEnded(deadline, title)) { idx++; continue }
    const description = cleanDescription(snippet || '', { title, source })
    if (type === 'HACKATHON') {
      opportunities.push({
        type: 'HACKATHON',
        title,
        description,
        url: href,
        source,
        organizer: '',
        deadline,
        startDate: '',
        duration: '',
        location: query.toLowerCase().includes('india') ? 'India' : 'Online',
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
    } else {
      // Internship mapping
      const parts = title.split(' - ')
      const role = parts[0]?.trim() || title
      // MEDIUM 2026-09-10 Unknown fix: honest-omit '' (matches Unstop/Wellfound/Internshala).
      let company = ''
      if (title.includes(' at ')) company = title.split(' at ').pop()?.trim() || ''
      else if (title.includes(' @ ')) company = title.split(' @ ').pop()?.trim() || ''
      else if (parts.length > 1) company = parts[1]?.trim() || ''
      // also try to extract from href domain as fallback company hint
      if (!company || company.length < 2) {
        try {
          const host = new URL(href).hostname.replace('www.', '').split('.')[0]
          if (host && host.length > 2) company = host.charAt(0).toUpperCase() + host.slice(1)
        } catch (err) { logger.debug({ err }, '[searchFetch] non-fatal (treated as empty/skip)');}
      }
      opportunities.push({
        type: 'INTERNSHIP',
        title,
        description,
        url: href,
        source,
        organizer: company,
        deadline,
        startDate: '',
        duration: '',
        location: query.toLowerCase().includes('india') ? 'India' : '',
        mode: href.toLowerCase().includes('remote') || snippet.toLowerCase().includes('remote') ? 'REMOTE' : 'REMOTE',
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
    idx++
  }
  return opportunities
}


// slugify lives in ./searchSlug.ts (no-cycle leaf). Re-exported above for compat.


export async function fetchDuckDuckGoHumanUrls(query: string, page: number): Promise<Array<{ url: string; title: string; snippet: string }>> {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&p=${page}`
  const cacheKey = `ddg:human:${query}:${page}`
  let html: string | undefined = scrapeCache.get<string>(cacheKey)
  if (!html) {
    try {
      const res = await fetch(searchUrl, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) return []
      html = await res.text()
      // DDG-flake guard: never cache anomaly-modal bot-check HTML.
      if (html && isDuckDuckGoAnomalyPage(html)) return []
      if (html && html.length > 1000) scrapeCache.set(cacheKey, html)
      else return []
    } catch (err) { logger.debug({ err }, '[searchFetch] non-fatal (treated as empty/skip)'); return [] }
    if (!html) return []
  } else if (isDuckDuckGoAnomalyPage(html)) {
    return []
  }
  const results: Array<{ url: string; title: string; snippet: string }> = []
  const snippets: string[] = []
  const snippetRegex = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|span|div)>/gi
  let sMatch: RegExpExecArray | null
  while ((sMatch = snippetRegex.exec(html)) !== null) {
    const txt = decodeSnippetEntities(sMatch[1].replace(/<[^>]+>/g, ' '))
    if (txt.length > 20) snippets.push(txt)
  }
  if (snippets.length === 0) {
    const altSnippetRegex = /class="result__snippet"[^>]*href="[^"]*"[^>]*>([\s\S]*?)<\/a>/gi
    while ((sMatch = altSnippetRegex.exec(html)) !== null) {
      const txt = decodeSnippetEntities(sMatch[1].replace(/<[^>]+>/g, ' '))
      if (txt.length > 20) snippets.push(txt)
    }
  }
  const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  let idx = 0
  while ((match = linkRegex.exec(html)) !== null && results.length < 10) {
    let href = match[1] || ''
    const titleHtml = match[2] || ''
    href = decodeDuckDuckGoHref(href)
    if (!href || href.includes('duckduckgo.com')) { idx++; continue }
    try { await validateExternalUrl(href) } catch (err) { logger.debug({ err }, '[searchFetch] non-fatal (treated as empty/skip)'); idx++; continue }
    const title = decodeSnippetEntities(titleHtml.replace(/<[^>]+>/g, ' ')).slice(0, 150)
    if (!title || title.length < 5 || isGenericTitle(title)) { idx++; continue }
    const snippet = snippets[idx] || ''
    results.push({ url: href, title, snippet })
    idx++
  }
  if (results.length === 0) {
    const urlRegex = /class="result__url"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
    idx = 0
    while ((match = urlRegex.exec(html)) !== null && results.length < 10) {
      let href = match[1] || ''
      href = decodeDuckDuckGoHref(href)
      if (!href || href.includes('duckduckgo.com')) { idx++; continue }
      try { await validateExternalUrl(href) } catch (err) { logger.debug({ err }, '[searchFetch] non-fatal (treated as empty/skip)'); idx++; continue }
      const title = decodeSnippetEntities((match[2] || href).replace(/<[^>]+>/g, ' ')).slice(0, 150)
      if (!title || title.length < 5 || isGenericTitle(title)) { idx++; continue }
      const snippet = snippets[idx] || ''
      results.push({ url: href, title, snippet })
      idx++
    }
  }
  return results
}

