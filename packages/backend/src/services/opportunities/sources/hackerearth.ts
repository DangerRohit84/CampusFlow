// opportunities/sources/hackerearth.ts — HackerEarth platform fetcher (Track 4 C-3 split).
// WHY: India college/corporate challenges, one home.
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
import { decodeDuckDuckGoHref } from './searchFetch'
import {
  cleanDescription,
  extractPrizeTiers,
  extractUSDPrizeTiers,
  extractTeamSize,
  extractExplicitTeamSize,
  extractEligibility,
  extractJudging,
  extractScheduleText,
  extractStages,
  extractJudgesList,
  resolveHackerEarthTeamSize,
} from './details'

// --- HackerEarth: India college/corporate hackathons ---
// FIX: HTML at /challenges/hackathon/ returns Next.js shell with no data (requires JS hydration) -> anchorRegex 0.
// Correct is JSON API /api/community/challenges/compete/ which returns {data: [...], total:50} with type Hackathon.
// HIGH wart 2026-09-09 (REPORT-hackerearth.md wart 1, evidence A.json items 4-6):
// page-2+ DDG/HTML fallback leaked non-event artifacts (bare list URL with deadline '',
// sprint/amplified subdomains). Require canonical event URL shape + non-empty deadline.
export function isHackerEarthEventUrl(href: string): boolean {
  try {
    if (!href || typeof href !== 'string') return false
    const u = new URL(href)
    const host = u.hostname.toLowerCase()
    // Canonical challenge URLs live on www.hackerearth.com only.
    // sprint/amplified microsites (promo hubs, not events) + any other subdomain → drop.
    if (host !== 'www.hackerearth.com' && host !== 'hackerearth.com') return false
    const path = u.pathname.replace(/\/+$/, '') || '/'
    // Bare list pages (no event slug) — same guard as dorahacks.ts:159-164.
    if (path === '/challenges/hackathon' || path === '/challenges' || path === '/' || path === '') return false
    const lowerPath = path.toLowerCase()
    if (lowerPath.startsWith('/challenges/hackathon/')) {
      const slug = path.slice('/challenges/hackathon/'.length).split('/')[0].trim()
      return slug.length >= 3
    }
    if (lowerPath.startsWith('/challenges/')) {
      const rest = path.slice('/challenges/'.length).split('/')[0].trim()
      if (rest.toLowerCase() === 'hackathon') return false
      return rest.length >= 3
    }
    return false
  } catch { return false }
}
export async function fetchHackerEarthPage(page: number, seen: Set<string>): Promise<NormalizedOpportunity[]> {
  // 1) API-first on page 1 (pagination not supported by API; filtered locally)
  if (page === 1) {
    const apiUrl = 'https://www.hackerearth.com/api/community/challenges/compete/'
    try {
      await validateExternalUrl(apiUrl)
      const res = await fetch(apiUrl, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) {
        const text = await res.text()
        try {
          const data = JSON.parse(text) as any
          const list: any[] = data.data || data.hackathons || data.list || []
          if (Array.isArray(list) && list.length > 0) {
            const opps: NormalizedOpportunity[] = []
            for (const h of list) {
              const type = (h.type || '').toString().toLowerCase()
              // Strict: only Hackathon type for HackerEarth source (Competitive/Hiring belong to other logic)
              if (type && type !== 'hackathon') continue
              const title: string = (h.title || h.name || '').toString().trim()
              if (!title || isGenericTitle(title) || seen.has(title)) continue
              // Lower combined hiring filter but keep hackathon hiring combos
              const lowerTitle = title.toLowerCase()
              if (lowerTitle.includes('hiring') && !lowerTitle.includes('hackathon') && !lowerTitle.includes('hack')) continue
              seen.add(title)
              let href: string = (h.url || '').toString().trim()
              if (!href) {
                const slug = (h.slug || '').toString().trim()
                if (slug) href = `https://www.hackerearth.com/challenges/hackathon/${slug.replace(/^\/+/, '')}/`
                else href = 'https://www.hackerearth.com/challenges/hackathon/'
              } else if (href.startsWith('/')) href = `https://www.hackerearth.com${href}`
              else if (!href.startsWith('http')) href = `https://www.hackerearth.com/${href.replace(/^\/+/, '')}`
              try { await validateExternalUrl(href) } catch { continue }
              let deadline = ''
              const rawEnd: string = h.end || h.end_str || h.deadline || ''
              if (rawEnd) {
                const d = new Date(rawEnd)
                if (!isNaN(d.getTime())) deadline = d.toISOString().split('T')[0]
                else deadline = parseSearchDate(String(rawEnd)) || ''
              }
              if (!deadline) deadline = inferDeadlineFromTitle(title, href)
              if (isEnded(deadline, title)) continue
              const startDate = h.start ? String(h.start).split('T')[0] : ''
              const organizer = (h.company_name || h.organization || 'HackerEarth').toString().slice(0, 80) || 'HackerEarth'
              const description = cleanDescription(h.description || '', { title, source: 'HACKEREARTH' })
              const textPrizes = extractPrizeTiers(`${title} ${stripHtml(h.description || '')}`)
              // List-level team size: API carries max_team_size/min_team_size (e.g. 1/1) — map honestly.
              // MEDIUM wart 2 (REPORT-hackerearth.md): fetcher dropped them although all upcoming items carry 1/1.
              const listTeamSize = resolveHackerEarthTeamSize(
                (h as any).max_team_size,
                (h as any).min_team_size,
                `${title} ${stripHtml(h.description || '')}`,
              )
              opps.push({
                type: 'HACKATHON',
                title: title.slice(0, 150),
                description,
                url: href,
                source: 'HACKEREARTH',
                organizer,
                deadline,
                startDate,
                duration: '',
                location: 'India',
                mode: 'ONLINE',
                prizePool: textPrizes.prizePool || '',
                stipend: '',
                company: '',
                role: '',
                themes: [],
                website: '',
                discord: '',
                participantsCount: h.subscription_count || 0,
                inviteOnly: false,
                ...(textPrizes.tiers.length ? { prizeTiers: textPrizes.tiers } : {}),
                ...(textPrizes.perks.length ? { perks: textPrizes.perks } : {}),
                ...(listTeamSize !== null ? { teamSize: listTeamSize } : {}),
              })
            }
            if (opps.length > 0) return opps
          }
        } catch {}
      }
    } catch {}
  }

  // 2) DuckDuckGo degraded fallback for HackerEarth when API yields 0 or for pagination page>1
  try {
    const ddgQuery = page === 1 ? 'site:hackerearth.com hackathon' : `site:hackerearth.com hackathon 2026 page ${page}`
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(ddgQuery)}&p=${page}`
    const cacheKey = `hackerearth:ddg:${page}`
    let ddgHtml: string | undefined = scrapeCache.get<string>(cacheKey)
    if (!ddgHtml) {
      const res = await fetch(searchUrl, {
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.5' },
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) {
        ddgHtml = await res.text()
        // DDG-flake guard (safe part): never cache anomaly-modal bot-check HTML.
        if (ddgHtml && ddgHtml.toLowerCase().includes('anomaly-modal')) ddgHtml = undefined
        else if (ddgHtml && ddgHtml.length > 1000) try { scrapeCache.set(cacheKey, ddgHtml, 600) } catch {}
      }
    } else if (ddgHtml.toLowerCase().includes('anomaly-modal')) {
      ddgHtml = undefined
    }
    if (ddgHtml) {
      const opportunities: NormalizedOpportunity[] = []
      const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
      const snippetRegex = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi
      const snippets: string[] = []
      let sMatch: RegExpExecArray | null
      while ((sMatch = snippetRegex.exec(ddgHtml)) !== null) {
        const txt = stripHtml(sMatch[1])
        if (txt.length > 20) snippets.push(txt)
      }
      let idx = 0
      let match: RegExpExecArray | null
      while ((match = linkRegex.exec(ddgHtml)) !== null && opportunities.length < 20) {
        let href = match[1] || ''
        const titleHtml = match[2] || ''
        href = decodeDuckDuckGoHref(href)
        if (!href || href.includes('duckduckgo.com')) { idx++; continue }
        if (!href.includes('hackerearth.com')) { idx++; continue }
        // HIGH fix: drop non-event artifacts (bare list URL, sprint/amplified subdomains).
        if (!isHackerEarthEventUrl(href)) { idx++; continue }
        try { await validateExternalUrl(href) } catch { idx++; continue }
        const title = stripHtml(titleHtml).slice(0, 150)
        if (!title || title.length < 5 || isGenericTitle(title) || seen.has(title)) { idx++; continue }
        const lowerCombined = `${title} ${href}`.toLowerCase()
        if (lowerCombined.includes('hiring') && !lowerCombined.includes('hackathon') && !lowerCombined.includes('hack')) { idx++; continue }
        if (!lowerCombined.includes('hack') && !lowerCombined.includes('challenge') && !lowerCombined.includes('contest')) { idx++; continue }
        seen.add(title)
        const snippet = snippets[idx] || ''
        let deadline = extractDeadlineFromContent(`${title} ${snippet}`) || ''
        // MEDIUM prize/team fix (safe part): keep detail text for prize/team mining
        // (old code discarded it after deadline — DDG items stayed prize '' always).
        let detailForMining = ''
        if (!deadline) {
          try {
            const stripped = await fetchPage6k(href)
            if (stripped && stripped.length > 100) {
              detailForMining = stripped
              const ext = extractDeadlineFromContent(stripped)
              if (ext) deadline = ext
            }
          } catch {}
        }
        if (!deadline) deadline = inferDeadlineFromTitle(title, href)
        if (isEnded(deadline, title)) { idx++; continue }
        // HIGH fix: fallback must have date evidence — dateless non-events (bare list URL)
        // evade isEnded('') and would never expire. Honest-omit (drop), never emit.
        if (!deadline) { idx++; continue }
        // MEDIUM prize/team (safe): mine snippet + detail text (tiers/perks + teamSize).
        // Detail enrichment (enrichHackerEarthItems) later fills more, but list-level
        // must not stay prize '' when the cue is already in hand.
        const mineText = `${title} ${snippet} ${detailForMining}`.slice(0, 6000)
        const ddgPrizes = extractPrizeTiers(mineText)
        const ddgTeam = (() => {
          try {
            return resolveHackerEarthTeamSize(undefined, undefined, mineText)
          } catch {
            return null
          }
        })()
        opportunities.push({
          type: 'HACKATHON',
          title: title.slice(0, 150),
          description: cleanDescription(snippet, { title, source: 'HACKEREARTH' }),
          url: href,
          source: 'HACKEREARTH',
          organizer: 'HackerEarth',
          deadline,
          startDate: '',
          duration: '',
          location: 'India',
          mode: 'ONLINE',
          prizePool: ddgPrizes.prizePool || '',
          stipend: '',
          company: '',
          role: '',
          themes: [],
          website: '',
          discord: '',
          participantsCount: 0,
          inviteOnly: false,
          ...(ddgPrizes.tiers.length ? { prizeTiers: ddgPrizes.tiers } : {}),
          ...(ddgPrizes.perks.length ? { perks: ddgPrizes.perks } : {}),
          ...(ddgTeam !== null ? { teamSize: ddgTeam } : {}),
        })
        idx++
      }
      if (opportunities.length > 0) return opportunities
    }
  } catch {}

  // 3) Last resort: original HTML shell scrape (kept for completeness but will likely return 0)
  const url = page === 1 ? 'https://www.hackerearth.com/challenges/hackathon/' : `https://www.hackerearth.com/challenges/hackathon/?page=${page}`
  const cacheKey = `hackerearth:html:${page}`
  let html: string | undefined = scrapeCache.get<string>(cacheKey)
  if (!html) {
    try { await validateExternalUrl(url) } catch { return [] }
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) })
      if (!res.ok) return []
      const txt = await res.text()
      if (txt.length < 500) return []
      html = txt
      try { scrapeCache.set(cacheKey, html, 6 * 60 * 60) } catch {}
    } catch { return [] }
    if (!html) return []
  }
  if (/No\s+Hiring\s+Challenges/i.test(html)) return []
  const opportunities: NormalizedOpportunity[] = []
  const anchorRegex = /<a[^>]+href="([^"]*\/challenges?\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = anchorRegex.exec(html)) !== null && opportunities.length < 20) {
    let href = match[1]?.trim() || ''
    const inner = match[2] || ''
    if (!href) continue
    if (href.startsWith('/')) href = `https://www.hackerearth.com${href}`
    if (!href.includes('hackerearth.com')) continue
    // HIGH fix: same event-shape guard as DDG fallback (bare list + subdomains → drop).
    if (!isHackerEarthEventUrl(href)) continue
    try { await validateExternalUrl(href) } catch { continue }
    const titleRaw = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150)
    const title = titleRaw.split('\n')[0]?.trim() || ''
    if (!title || title.length < 5 || isGenericTitle(title) || seen.has(title)) continue
    const lowerCombined = `${title} ${href}`.toLowerCase()
    if (lowerCombined.includes('hiring')) continue
    if (!lowerCombined.includes('hack') && !lowerCombined.includes('challenge') && !lowerCombined.includes('contest')) continue
    seen.add(title)
    const windowStart = Math.max(0, (match.index || 0) - 800)
    const windowEnd = Math.min(html.length, (match.index || 0) + 1500)
    const windowText = html.substring(windowStart, windowEnd).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    let deadline = extractDeadlineFromContent(windowText) || ''
    if (!deadline) {
      try {
        const stripped = await fetchPage6k(href)
        if (stripped && stripped.length > 100) {
          const ext = extractDeadlineFromContent(stripped)
          if (ext) deadline = ext
        }
      } catch {}
    }
    if (!deadline) deadline = inferDeadlineFromTitle(title, href)
    if (isEnded(deadline, title)) continue
    // HIGH fix: fallback must have date evidence (dateless shell artifacts → honest-omit).
    if (!deadline) continue
    let prizePool = ''
    const prizeMatch = windowText.match(/(?:prize|reward|cash|pool)\s*[:\-]?\s*[?$]?\s*[\d,]+(?:\s*(?:lakh|crore|k|USD|INR))?/i)
    if (prizeMatch) prizePool = prizeMatch[0].trim().slice(0, 300)
    const windowPrizes = extractPrizeTiers(windowText)
    if (!prizePool && windowPrizes.prizePool) prizePool = windowPrizes.prizePool
    // MEDIUM team fix (safe part): list-level teamSize was dropped although the
    // window often carries `Team size: 1-4` (API path already maps max/min).
    // Detail enrichment later fills more, but list must not stay empty-handed.
    const anchorTeam = (() => {
      try {
        return resolveHackerEarthTeamSize(undefined, undefined, `${title} ${windowText}`)
      } catch {
        return null
      }
    })()
    opportunities.push({
      type: 'HACKATHON',
      title: title.slice(0, 150),
      description: '',
      url: href,
      source: 'HACKEREARTH',
      organizer: 'HackerEarth',
      deadline,
      startDate: '',
      duration: '',
      location: 'India',
      mode: 'ONLINE',
      prizePool,
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
      ...(anchorTeam !== null ? { teamSize: anchorTeam } : {}),
    })
  }
  if (opportunities.length === 0) {
    const hRegex = /<h[2-3][^>]*>([^<]{5,120})<\/h[2-3]>/gi
    while ((match = hRegex.exec(html)) !== null && opportunities.length < 10) {
      const title = match[1].trim()
      if (!title || isGenericTitle(title) || seen.has(title)) continue
      if (title.toLowerCase().includes('hiring')) continue
      if (!title.toLowerCase().includes('hack') && !title.toLowerCase().includes('challenge')) continue
      seen.add(title)
      const windowStart = Math.max(0, (match.index || 0) - 800)
      const windowEnd = Math.min(html.length, (match.index || 0) + 1500)
      const windowText = html.substring(windowStart, windowEnd).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      let deadline = extractDeadlineFromContent(windowText) || ''
      if (!deadline) {
        try {
          const stripped = await fetchPage6k(url)
          if (stripped && stripped.length > 100) {
            const ext = extractDeadlineFromContent(stripped)
            if (ext) deadline = ext
          }
        } catch {}
      }
      if (!deadline) deadline = inferDeadlineFromTitle(title, url)
      if (isEnded(deadline, title)) continue
      // HIGH fix: h2/h3 fallback URL is the bare list page by construction (no event slug).
      // It cannot satisfy event URL shape, so honest-omit (drop) — never emit bare-URL items.
      // Date guard also applies: dateless headings are nav/promo, not events.
      if (!deadline) continue
      if (!isHackerEarthEventUrl(url)) continue
      opportunities.push({
        type: 'HACKATHON',
        title: title.slice(0, 150),
        description: '',
        url,
        source: 'HACKEREARTH',
        organizer: 'HackerEarth',
        deadline,
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


export async function fetchHackerEarth(limit?: number): Promise<NormalizedOpportunity[]> {
  const target = limit && limit > 0 ? limit : 30
  const seen = new Set<string>()
  const newItems: NormalizedOpportunity[] = []
  for (let page = 1; page <= MAX_PAGES && newItems.length < target; page++) {
    const results = await fetchHackerEarthPage(page, seen)
    if (results.length === 0) {
      if (page === 1) continue
      break
    }
    const titles = results.map(r => r.title).filter(Boolean)
    let existingTitles = new Set<string>()
    if (titles.length) {
      try {
        const existing = await prisma.hackathonStaging.findMany({
          where: { title: { in: titles }, source: 'HACKEREARTH' },
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
  // Bounded detail/tab enrichment (canonical /challenges/... tabs). Failures never break list items.
  try {
    await enrichHackerEarthItems(sliced)
  } catch {}
  logger.info(`[HackerEarth] Fetched ${sliced.length} hackathons (target ${limit || 30}) capped at ${MAX_PAGES} pages 10 fetches max`)
  return sliced
}

// ─── HackerEarth detail/tab enrichment (B.raw.md:24 tab bar) ───────────
// Detail base (e.g. https://hackcbs4.hackerearth.com/ or canonical
// https://www.hackerearth.com/challenges/hackathon/<slug>/) carries the tab bar:
// "Overview Themes Prizes Evaluation Criteria Rules Judges Teams Submissions
//  Sponsors Webinars Submission Guideline Resources Discussion" + "Team size: 1 - 4"
// + "Online · Team: 1–4 · 2.5K registrations". API has NO description/prize keys
// (honest '' at list level) but detail has the value cue (B.webfetch-detail.md:
// "up to ₹85,000 per repository"). This bounded enrichment fetches canonical tabs
// (/prizes, /rules, /judges, /teams — the slugs that exist; '/details' is a wrong
// slug, fixed in registry) and fills: prize tiers (₹ + $), evaluation criteria +
// judges → judging, team size (explicit max wins), eligibility/schedule/stages.
// All optional, omit when absent (never fake); failures keep list data.

/** Canonical tab slugs that exist on HackerEarth challenge pages (registry SSOT mirrors this). */
export const HACKEREARTH_DETAIL_TABS = ['/prizes', '/rules', '/judges', '/teams'] as const;

/**
 * Pure HackerEarth detail parser (no network/DB — hermetic unit-testable).
 * Accepts raw HTML or stripped text (overview + tabs combined); returns only evidenced fields.
 */
export function parseHackerEarthDetail(
  html: unknown,
  opts?: { title?: string },
): {
  description: string;
  prizePool: string;
  prizeTiers: string[];
  perks: string[];
  teamSize: number | null;
  eligibility: string;
  judging: string;
  schedule: string;
  stages: Array<{ title: string; date?: string }>;
} {
  const raw = String(html ?? '');
  if (!raw.trim()) {
    return { description: '', prizePool: '', prizeTiers: [], perks: [], teamSize: null, eligibility: '', judging: '', schedule: '', stages: [] };
  }
  const stripped = stripHtml(raw).replace(/\s+/g, ' ').trim();
  const description = cleanDescription(stripped, { title: opts?.title, source: 'HACKEREARTH' });
  // Prizes: ₹ tiers + $ tiers merged (e.g. "up to ₹85,000 per repository" → "Prize: ₹85,000").
  const inr = (() => {
    try {
      return extractPrizeTiers(stripped);
    } catch {
      return { prizePool: '', tiers: [] as string[], perks: [] as string[] };
    }
  })();
  const usd = (() => {
    try {
      return extractUSDPrizeTiers(stripped);
    } catch {
      return { prizePool: '', tiers: [] as string[], perks: [] as string[] };
    }
  })();
  const tiers: string[] = [...inr.tiers];
  const seenAmt = new Set(
    tiers.map((t) => (t.match(/₹([\d,]+)/) || t.match(/\$([\d,]+)/) || [])[1]?.replace(/,/g, '')).filter(Boolean),
  );
  for (const t of usd.tiers) {
    const amt = (t.match(/\$([\d,]+)/) || [])[1]?.replace(/,/g, '');
    if (amt && seenAmt.has(amt)) continue;
    if (!tiers.includes(t)) {
      tiers.push(t);
      if (amt) seenAmt.add(amt);
    }
  }
  const perks = [...inr.perks];
  for (const p of usd.perks) if (!perks.includes(p)) perks.push(p);
  const parts = [...tiers];
  if (perks.length) parts.push(`Perks: ${perks.join(', ')}`);
  const prizePool = parts.join(', ');
  // Team size: explicit "Team size: 1 - 4" → 4 (max), "Team: 1–4" likewise; else mining fallback.
  let teamSize: number | null = null;
  try {
    teamSize = extractExplicitTeamSize(stripped) ?? extractTeamSize(stripped);
  } catch {
    teamSize = null;
  }
  let eligibility = '';
  try {
    eligibility = extractEligibility(stripped);
  } catch {}
  // Judging: Evaluation Criteria section preferred; Judges list folded with prefix (no schema field).
  let judging = '';
  try {
    judging = extractJudging(stripped);
  } catch {}
  // Evaluation Criteria is HackerEarth's label for judging (tab bar: "Evaluation Criteria").
  // Require an explicit colon/dash after the heading — the overview tab bar carries
  // "Evaluation Criteria Rules Judges ..." (no colon) and must not become judging="Rules".
  if (!judging) {
    try {
      const m = stripped.match(/evaluation\s*criteria\s*[:\-–—]\s*(.+?)(?=\s*(?:rules?|judges?|teams?|submissions?|sponsors?|webinars?|resources?|discussion|prizes?|overview|themes?)\s*[:\-–—]?|$)/is);
      if (m) {
        const v = m[1].replace(/\s+/g, ' ').trim().slice(0, 800);
        if (v.length >= 5) judging = v;
      }
    } catch {}
  }
  try {
    const judges = extractJudgesList(stripped);
    if (judges) {
      const judgesLine = `Judges: ${judges}`.slice(0, 800);
      if (judging) {
        if (!judging.toLowerCase().includes(judges.toLowerCase().slice(0, 20))) {
          judging = `${judging}; ${judgesLine}`.slice(0, 800);
        }
      } else {
        judging = judgesLine;
      }
    }
  } catch {}
  let schedule = '';
  try {
    schedule = extractScheduleText(stripped);
  } catch {}
  let stages: Array<{ title: string; date?: string }> = [];
  try {
    stages = extractStages(stripped);
  } catch {
    stages = [];
  }
  return { description, prizePool, prizeTiers: tiers, perks, teamSize, eligibility, judging, schedule, stages };
}

/**
 * Fetch one HackerEarth detail (overview + existing tab slugs, sequential via fetchPage6k).
 * - Canonical /challenges/... URLs: base + /prizes + /rules + /judges + /teams (bounded 5 max, cached).
 * - Microsite URLs (subdomain.hackerearth.com, e.g. hackcbs4): base only (tab shape unknown).
 * Cached, small timeouts, never throws — null when no evidenced fields.
 */
export async function fetchHackerEarthDetail(url: string): Promise<Partial<NormalizedOpportunity> | null> {
  try {
    if (!url || typeof url !== 'string' || !url.toLowerCase().includes('hackerearth.com')) return null;
    const isCanonical = /\/challenges?\//i.test(url);
    const base = url.replace(/\/$/, '');
    const suffixes: string[] = isCanonical ? ['', ...HACKEREARTH_DETAIL_TABS] : [''];
    const chunks: string[] = [];
    for (const suffix of suffixes) {
      try {
        const tabUrl = suffix ? `${base}${suffix}` : base;
        const text = await fetchPage6k(tabUrl);
        if (text && text.length > 100) {
          const name = suffix ? suffix.replace(/^\//, '') : 'overview';
          chunks.push(`\n--- ${name.toUpperCase()} PAGE ---\n${text}`);
        }
      } catch {
        continue;
      }
    }
    if (!chunks.length) return null;
    const combined = chunks.join('\n');
    const parsed = parseHackerEarthDetail(combined);
    const out: Partial<NormalizedOpportunity> = {};
    // Description: API has no description key — detail campaign copy fills when list missed it.
    // Overview tab text is nav-heavy; only attach when it carries substance (>100 chars) to avoid
    // stuffing "Dashboard Learn Practice ..." shells as description.
    if (parsed.description && parsed.description.length > 100) out.description = parsed.description;
    if (parsed.prizePool) out.prizePool = parsed.prizePool;
    if (parsed.prizeTiers.length) (out as any).prizeTiers = parsed.prizeTiers;
    if (parsed.perks.length) (out as any).perks = parsed.perks;
    if (parsed.teamSize !== null) (out as any).teamSize = parsed.teamSize;
    if (parsed.eligibility) (out as any).eligibility = parsed.eligibility;
    if (parsed.judging) (out as any).judging = parsed.judging;
    if (parsed.schedule) (out as any).schedule = parsed.schedule;
    if (parsed.stages.length) (out as any).stages = parsed.stages;
    // Strip thin description-only hits (tab-bar shells with no rich fields are noise, not detail).
    const hasRich = Boolean(
      (out as any).prizeTiers?.length ||
        (out as any).perks?.length ||
        (out as any).teamSize !== undefined ||
        (out as any).eligibility ||
        (out as any).judging ||
        (out as any).schedule ||
        (out as any).stages?.length,
    );
    if (!hasRich) {
      // PrizePool alone (e.g. single "Prize: ₹85,000") counts as rich — keep it.
      if (!out.prizePool) return null;
    }
    if (!Object.keys(out).length) return null;
    return out;
  } catch {
    return null;
  }
}

/**
 * Bounded enrichment for a sliced list (small concurrency, per-item try/catch).
 * Only fills absent list fields (never overwrites list data with '' / never fakes).
 */
export async function enrichHackerEarthItems(items: NormalizedOpportunity[]): Promise<void> {
  if (!items.length) return;
  // HackerEarth tabs are 5 fetches/item worst-case — keep item concurrency at 2 to respect rate.
  const CONCURRENCY = 2;
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((it) => fetchHackerEarthDetail(it.url)));
    for (let j = 0; j < settled.length; j++) {
      try {
        const r = settled[j];
        if (r.status !== 'fulfilled' || !r.value) continue;
        const detail = r.value as Partial<NormalizedOpportunity>;
        const target = batch[j];
        if (detail.description && !target.description) target.description = detail.description;
        if (detail.prizePool && !target.prizePool) {
          target.prizePool = detail.prizePool;
          if ((detail as any).prizeTiers?.length && !(target as any).prizeTiers?.length) {
            (target as any).prizeTiers = (detail as any).prizeTiers;
          }
          if ((detail as any).perks?.length && !(target as any).perks?.length) {
            (target as any).perks = (detail as any).perks;
          }
        } else if ((detail as any).prizeTiers?.length && !(target as any).prizeTiers?.length) {
          (target as any).prizeTiers = (detail as any).prizeTiers;
          if ((detail as any).perks?.length && !(target as any).perks?.length) {
            (target as any).perks = (detail as any).perks;
          }
        }
        if ((detail as any).teamSize !== undefined && (target as any).teamSize === undefined) {
          (target as any).teamSize = (detail as any).teamSize;
        }
        if ((detail as any).eligibility && !(target as any).eligibility) {
          (target as any).eligibility = (detail as any).eligibility;
        }
        if ((detail as any).judging && !(target as any).judging) {
          (target as any).judging = (detail as any).judging;
        }
        if ((detail as any).schedule && !(target as any).schedule) {
          (target as any).schedule = (detail as any).schedule;
        }
        if ((detail as any).stages?.length && !(target as any).stages?.length) {
          (target as any).stages = (detail as any).stages;
        }
      } catch {
        continue;
      }
    }
  }
}
