// opportunities/sources/mlh.ts — MLH platform fetcher (Track 4 C-3 split).
// WHY: season events + GHW slug resolution, one home.
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
import { cleanDescription, extractSponsorChallengeTiers, extractUSDPrizeTiers } from './details'

// ─── MLH URL resolver — fixes GHW 404 (https://www.mlh.com/events/global-hack-week-data → Page Not Found) ───
// GHW events live at https://ghw.mlh.io + https://events.mlh.io/events/<id>-<slug> (verified 200),
// while season listing at https://mlh.io/seasons/{season}/events returns GHW slugs like
// global-hack-week-hacking-for-good-ec with url "/events/.../prizes" which 404s at mlh.io.
// Regular MLH events live at https://mlh.io/events/<slug>/prizes (200) but plain /events/<slug> 404s.
// This resolver: GHW → prefer websiteUrl (events.mlh.io/organize.mlh.io) else ghw.mlh.io/events/<short> (e.g. global-hack-week-data → data-week).
// Regular → use event.url (mlh.io + /events/<slug>/prizes) which is 200.
export function resolveMLHEventUrl(event: any): string {
  const slug: string = (event.slug || '').toString().trim()
  const name: string = (event.name || '').toString()
  const websiteUrl: string = (event.websiteUrl || '').toString().trim()
  const eventUrl: string = (event.url || '').toString().trim()
  const isGHW =
    /global-hack-week/i.test(slug) ||
    /global hack week/i.test(name) ||
    (websiteUrl && /events\.mlh\.io|organize\.mlh\.io|ghw\.mlh/i.test(websiteUrl)) ||
    (eventUrl && /global-hack-week/i.test(eventUrl))

  if (isGHW) {
    if (websiteUrl) {
      try {
        const u = new URL(websiteUrl)
        const host = u.hostname.toLowerCase()
        if (host.includes('events.mlh.io') || host.includes('organize.mlh.io') || host.includes('ghw.mlh')) {
          return websiteUrl
        }
      } catch {}
    }
    // Map GHW season slug to GHW site short slug (verified via ghw.mlh.io/sitemap.xml + events.mlh.io 200s)
    // e.g. global-hack-week-hacking-for-good-ec → hacking-for-good → https://ghw.mlh.io/events/hacking-for-good (200)
    //      global-hack-week-data-week-a0 → data-week → https://ghw.mlh.io/events/data-week (200)
    //      global-hack-week-data → data → data-week → https://ghw.mlh.io/events/data-week (200) fixes https://www.mlh.com/events/global-hack-week-data 404
    let short = slug.replace(/^global-hack-week-/i, '')
    short = short.replace(/-[a-f0-9]{2}$/i, '')
    short = short.replace(/-\d{1,2}$/, '')
    const lower = short.toLowerCase()
    const ghwMap: Record<string, string> = {
      'genai': 'generative-ai',
      'generative-ai': 'generative-ai',
      'data': 'data-week',
      'data-week': 'data-week',
      'beginners': 'beginners-week2',
      'beginners-week': 'beginners-week2',
      'season-launch': 'season-launch',
      'hacking-for-good': 'hacking-for-good',
      'api': 'api-week',
      'api-week': 'api-week',
      'cloud': 'cloud',
      'ai-ml-week': 'ai-ml',
      'ai-ml': 'ai-ml',
      'open-source-week': 'open-source',
      'open-source': 'open-source',
      'builders-week': 'builders-week',
      'builders': 'builders-week',
    }
    if (ghwMap[lower]) short = ghwMap[lower]
    if (!short || short.length < 2) return 'https://ghw.mlh.io'
    const knownGhw = new Set([
      'data-week','open-source','builders-week','hacking-for-good','generative-ai','api-week','cloud','ai','season-launch','agents','career-week','web3','security-week','game-week','beginners-week2','ai-ml','api','builders',
    ])
    if (knownGhw.has(short)) return `https://ghw.mlh.io/events/${short}`
    // Fallback for GHW without known mapping: still ghw site with short, evita 404 on www.mlh.com/events/global-hack-week-data
    return `https://ghw.mlh.io/events/${short}`
  } else {
    // Regular MLH event: event.url already contains correct path "/events/<slug>/prizes" → https://mlh.io/events/<slug>/prizes (200)
    // Plain https://mlh.io/events/${slug} without /prizes is 404 (verified for hackprix, jamhacks, kenthackit) — use websiteUrl fallback if eventUrl missing
    if (eventUrl) {
      if (eventUrl.startsWith('http')) return eventUrl
      if (eventUrl.startsWith('/')) return `https://mlh.io${eventUrl}`
      return `https://mlh.io/events/${eventUrl}`
    }
    if (websiteUrl && websiteUrl.startsWith('http')) {
      try { new URL(websiteUrl); return websiteUrl } catch {}
    }
    return `https://mlh.io/events/${slug}`
  }
}


// ─── MLH: upcoming hackathons ────────────────────────────────────
// Verifies 2026 season has only ~1 pending left (all past by Sep 2026) -> fetches 2027 as well. API-first simple: 1 HTML fetch per season, eventRegex, isEnded, batch dedup, target loop.
/**
 * True when an MLH event is a test/demo fixture (MEDIUM 2026-09-10 test-event wart).
 * WHY: season JSON includes `Jon Test Event` (+ other test/demo/sample fixtures)
 * with status upcoming + future dates — `isEnded` + `status==='ended'` never drop
 * them, and `isGenericTitle` is substring (`contest` contains `test` → false
 * positive) so fetchMLH could not use it. Word-boundary only: `test/demo/sample/
 * example/placeholder` as whole words (case-insensitive) in title or slug.
 * `Contest/Latest/Greatest` (substring `test` inside a word) must NOT match.
 * Pure, no network/DB.
 */
export function isMLHTestEvent(title: unknown, slug?: unknown): boolean {
  const t = String(title ?? '').toLowerCase()
  const s = String(slug ?? '').toLowerCase()
  const combined = `${t} ${s}`
  if (!combined.trim()) return false
  return /\b(test|tests|testing|demo|sample|dummy|example|placeholder|lorem)\b/.test(combined)
}
export async function fetchMLH(limit?: number): Promise<NormalizedOpportunity[]> {
  try {
    const target = limit && limit > 0 ? limit : Number.MAX_SAFE_INTEGER
    const curYear = new Date().getFullYear()
    // 2026 season ends mid-2026 (only 1 pending left which is past by Sep), so also fetch 2027 to satisfy target 10. Keep both for coverage.
    const seasons = [String(curYear), String(curYear + 1)]
    // Ensure 2026/2027 are covered even if curYear moves (keep deterministic for 2026-09 verify)
    if (!seasons.includes('2026')) seasons.unshift('2026')
    if (!seasons.includes('2027')) seasons.push('2027')
    // Deduplicate seasons preserve order
    const uniqSeasons = [...new Set(seasons)]
    const opportunities: NormalizedOpportunity[] = []
    const seen = new Set<string>()
    let totalParsed = 0
    for (const season of uniqSeasons) {
      try {
        const response = await fetch(`https://mlh.io/seasons/${season}/events`, {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(15000),
        })
        if (!response.ok) {
          logger.warn(`[MLH] season ${season} fetch ${response.status}`)
          continue
        }
        const html = await response.text()
        const eventRegex = /\{"id":"[^"]+","slug":"[^"]+","name":"[^"]+","status":"[^"]+","startsAt":"[^"]+","endsAt":"[^"]+","dateRange":"[^"]*","url":"[^"]*","location":"[^"]*","formatType":"[^"]*"/g
        let match
        let seasonParsed = 0
        let seasonKept = 0
        while ((match = eventRegex.exec(html)) !== null) {
          const start = match.index
          let depth = 0
          let end = start
          for (let i = start; i < html.length && i < start + 2000; i++) {
            if (html[i] === '{') depth++
            if (html[i] === '}') {
              depth--
              if (depth === 0) { end = i + 1; break }
            }
          }
          try {
            const event = JSON.parse(html.substring(start, end))
            seasonParsed++
            totalParsed++
            if (event.status === 'ended') continue
            const title = event.name
            if (!title || seen.has(title)) continue
            const slug = event.slug
            // MEDIUM test-event filter: drop Jon Test Event + fixtures (word-boundary,
            // never substring `contest` → `test` false positive).
            if (isMLHTestEvent(title, slug)) continue
            seen.add(title)
            const url = resolveMLHEventUrl(event)
            const startDate = event.startsAt ? event.startsAt.split('T')[0] : ''
            const deadline = event.endsAt ? event.endsAt.split('T')[0] : ''
            if (isEnded(deadline, title)) continue
            const venueAddress = event.venueAddress
            const fullLocation = venueAddress ? [venueAddress.city, venueAddress.state, venueAddress.country].filter(Boolean).join(', ') : (event.location || '')
            let mode = 'ONLINE'
            if (event.formatType === 'physical' || event.formatType === 'in-person') mode = 'OFFLINE'
            else if (event.formatType === 'hybrid') mode = 'HYBRID'
            opportunities.push({
              type: 'HACKATHON',
              title,
              description: '',
              url,
              source: 'MLH',
              organizer: 'MLH',
              deadline,
              startDate,
              duration: event.dateRange || '',
              location: fullLocation,
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
            seasonKept++
          } catch {}
        }
        logger.info(`[MLH] season ${season} parsed ${seasonParsed} kept ${seasonKept} upcoming`)
        // Early exit if we already have enough for target before dedup (conservative)
        if (opportunities.length >= target && target !== Number.MAX_SAFE_INTEGER) {
          // continue to dedup after loop, but break season loop early
          if (opportunities.length >= target * 1.5) break
        }
      } catch (e) {
        logger.warn({ err: (e as any)?.message || e }, `[MLH] season ${season} error`)
        continue
      }
    }

    // Batch dedup against DB (single query for all)
    let deduped = opportunities
    if (opportunities.length) {
      try {
        const titles = opportunities.map(o => o.title)
        const existing = await prisma.hackathonStaging.findMany({
          where: { title: { in: titles }, source: 'MLH' },
          select: { title: true },
        })
        const existingSet = new Set(existing.map(e => e.title))
        deduped = opportunities.filter(o => !existingSet.has(o.title))
      } catch {}
    }

    const sliced = target === Number.MAX_SAFE_INTEGER ? deduped : deduped.slice(0, target)
    // Bounded detail/tab enrichment: fetch the /prizes URL the resolver already builds
    // (mlh.ts:80-90 — regular events already end in /prizes, GHW resolves to ghw/events).
    // Season JSON carries no prize keys (prizePool '' honest at list level) but detail HAS
    // sponsor challenges (Gemini Swag Kits, MongoDB M5Stack IoT Kit). Failures never break list.
    try {
      await enrichMLHItems(sliced)
    } catch {}
    logger.info(`[MLH] Fetched ${sliced.length} upcoming hackathons (target ${limit || 'all'}) seasons ${uniqSeasons.join(',')} totalParsed ${totalParsed} kept ${opportunities.length}`)
    return sliced
  } catch (error) {
    logger.error({ err: error }, 'MLH fetch error:')
    return []
  }
}

// ─── MLH detail/tab enrichment (B.webfetch-detail.md:3,10-18 prizes) ───
// Detail URL is the /prizes URL resolveMLHEventUrl already builds:
//   regular → https://mlh.io/events/<slug>/prizes (200; plain /events/<slug> 404s)
//   GHW → websiteUrl (events.mlh.io/organize.mlh.io) else ghw.mlh.io/events/<short>
// Detail proves sponsor challenge tiers (Best Use of Gemini API: Google Swag Kits,
// Best Use of MongoDB Atlas: M5Stack IoT Kit) while season JSON has no prize keys.
// This bounded enrichment fills prizePool/tiers (+ short description from challenge
// copy when list description absent) — all optional, omit when absent (never fake).

/**
 * Pure MLH prizes parser (no network/DB — hermetic unit-testable).
 * Accepts raw HTML or stripped text from the /prizes page.
 */
export function parseMLHPrizes(
  html: unknown,
): { prizePool: string; prizeTiers: string[]; description: string } {
  const raw = String(html ?? '');
  if (!raw.trim()) return { prizePool: '', prizeTiers: [], description: '' };
  const stripped = stripHtml(raw).replace(/\s+/g, ' ').trim();
  // Sponsor challenges (swag/kits, no cash amounts) + $ tiers when cash appears.
  let tiers: string[] = [];
  try {
    tiers = extractSponsorChallengeTiers(stripped).tiers;
  } catch {
    tiers = [];
  }
  try {
    const usd = extractUSDPrizeTiers(stripped);
    const seenAmt = new Set(
      tiers.map((t) => (t.match(/\$([\d,]+)/) || [])[1]?.replace(/,/g, '')).filter(Boolean),
    );
    for (const t of usd.tiers) {
      const amt = (t.match(/\$([\d,]+)/) || [])[1]?.replace(/,/g, '');
      if (amt && seenAmt.has(amt)) continue;
      if (!tiers.includes(t)) {
        tiers.push(t);
        if (amt) seenAmt.add(amt);
      }
    }
  } catch {}
  tiers = tiers.slice(0, 10);
  const prizePool = tiers.join(', ');
  // Short description from challenge copy (only when list description absent — caller merges).
  let description = '';
  try {
    const d = cleanDescription(stripped, { source: 'MLH' });
    // Prizes pages are challenge-copy only (no event overview) — keep short honest slice,
    // never generic. Cap 500 to avoid stuffing footer ("Major League Hacking ...") as description.
    if (d && d.length > 40) {
      const head = d.slice(0, 500);
      // Require a challenge cue (Best/prize/swag/challenge) — footers alone must not become description.
      if (/best|prize|swag|challenge|win awesome/i.test(head)) description = head;
    }
  } catch {}
  return { prizePool, prizeTiers: tiers, description };
}

/**
 * Fetch one MLH detail (the resolved /prizes URL as-is, single fetchPage6k).
 * Cached, small timeouts, never throws — null when no evidenced fields.
 */
export async function fetchMLHDetail(url: string): Promise<Partial<import('../types').NormalizedOpportunity> | null> {
  try {
    if (!url || typeof url !== 'string') return null;
    const lower = url.toLowerCase();
    if (!lower.includes('mlh.io')) return null;
    const text = await fetchPage6k(url);
    if (!text || text.length <= 100) return null;
    const parsed = parseMLHPrizes(text);
    if (!parsed.prizeTiers.length && !parsed.description) return null;
    const out: Partial<import('../types').NormalizedOpportunity> = {};
    if (parsed.prizePool) out.prizePool = parsed.prizePool;
    if (parsed.prizeTiers.length) (out as any).prizeTiers = parsed.prizeTiers;
    if (parsed.description) out.description = parsed.description;
    if (!Object.keys(out).length) return null;
    return out;
  } catch {
    return null;
  }
}

/**
 * Bounded enrichment for a sliced list (small concurrency, per-item try/catch).
 * Only fills absent list fields (season JSON has no prize/desc keys — detail fills).
 */
export async function enrichMLHItems(items: import('../types').NormalizedOpportunity[]): Promise<void> {
  if (!items.length) return;
  const CONCURRENCY = 3;
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((it) => fetchMLHDetail(it.url)));
    for (let j = 0; j < settled.length; j++) {
      try {
        const r = settled[j];
        if (r.status !== 'fulfilled' || !r.value) continue;
        const detail = r.value as Partial<import('../types').NormalizedOpportunity>;
        const target = batch[j];
        if (detail.prizePool && !target.prizePool) {
          target.prizePool = detail.prizePool;
          if ((detail as any).prizeTiers?.length && !(target as any).prizeTiers?.length) {
            (target as any).prizeTiers = (detail as any).prizeTiers;
          }
        } else if ((detail as any).prizeTiers?.length && !(target as any).prizeTiers?.length) {
          (target as any).prizeTiers = (detail as any).prizeTiers;
        }
        if (detail.description && !target.description) target.description = detail.description;
      } catch {
        continue;
      }
    }
  }
}
