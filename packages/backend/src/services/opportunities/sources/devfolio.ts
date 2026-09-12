// opportunities/sources/devfolio.ts — Devfolio platform fetcher (Track 4 C-3 split).
// WHY: Next.js __NEXT_DATA__ + HTML fallback parsing, one home.
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
} from './details'

// ─── Devfolio: Next.js __NEXT_DATA__ ──────────────────────────────
export async function fetchDevfolioPage(page: number, seen: Set<string>): Promise<NormalizedOpportunity[]> {
  try {
    const url = page === 1 ? 'https://devfolio.co/hackathons' : `https://devfolio.co/hackathons?page=${page}`
    const response = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) return []
    const html = await response.text()

    // Extract __NEXT_DATA__ which contains the hackathon data
    const nextDataMatch = html.match(/__NEXT_DATA__[^{]*({[\s\S]*?})\s*<\/script>/)
    if (!nextDataMatch) return []

    // Parse JSON from the match
    let jsonStr = nextDataMatch[1]
    let data: any
    try {
      data = JSON.parse(jsonStr)
    } catch {
      let depth = 0
      let start = jsonStr.indexOf('{')
      for (let i = start; i < jsonStr.length; i++) {
        if (jsonStr[i] === '{') depth++
        if (jsonStr[i] === '}') {
          depth--
          if (depth === 0) { jsonStr = jsonStr.substring(start, i + 1); break }
        }
      }
      data = JSON.parse(jsonStr)
    }

    const state = data.props?.pageProps?.dehydratedState
    if (!state?.queries) return []

    const opportunities: NormalizedOpportunity[] = []

    for (const query of state.queries) {
      const hackathons = query.state?.data?.open_hackathons
        || query.state?.data?.hackathons
        || (Array.isArray(query.state?.data) ? query.state.data : [])

      for (const h of hackathons) {
        if (!h.name) continue
        if (seen.has(h.name)) continue
        seen.add(h.name)

        const title = h.name
        const slug = h.slug
        const hackUrl = `https://${slug}.devfolio.co/`

        // Dates
        const startDate = h.starts_at ? h.starts_at.split('T')[0] : ''
        const regDeadline = h.settings?.reg_ends_at
          ? h.settings.reg_ends_at.split('T')[0]
          : ''
        const deadline = regDeadline || (h.ends_at ? h.ends_at.split('T')[0] : '')

        // Mode — preserve OFFLINE even when venue unknown (omit location, don't flip to ONLINE).
        let mode = 'ONLINE'
        if (h.is_online === false) mode = 'OFFLINE'
        else if (h.is_online === true) mode = 'ONLINE'

        const location = mode === 'OFFLINE' ? '' : 'Online'

        // Themes
        const themes = (h.themes || []).map((t: any) => t.theme?.name).filter(Boolean)

        // Extended fields
        const website = h.settings?.site || ''
        const discord = h.settings?.discord || ''
        const participantsCount = h.participants_count || 0

        opportunities.push({
          type: 'HACKATHON',
          title,
          description: cleanDescription(h.tagline || '', { title, source: 'DEVFOLIO' }),
          url: hackUrl,
          source: 'DEVFOLIO',
          organizer: '',
          deadline,
          startDate,
          duration: '',
          location,
          mode,
          prizePool: '',
          stipend: '',
          company: '',
          role: '',
          themes,
          website,
          discord,
          participantsCount,
          inviteOnly: false,
        })
      }
    }
    return opportunities
  } catch {
    return []
  }
}


export async function fetchDevfolio(limit?: number): Promise<NormalizedOpportunity[]> {
  const target = limit && limit > 0 ? limit : Number.MAX_SAFE_INTEGER
  const seen = new Set<string>()
  const newItems: NormalizedOpportunity[] = []
  for (let page = 1; page <= MAX_PAGES && newItems.length < target; page++) {
    const results = await fetchDevfolioPage(page, seen)
    if (results.length === 0) break
    // Batch dedup via DB
    const titles = results.map(r => r.title).filter(Boolean)
    let existingTitles = new Set<string>()
    if (titles.length) {
      try {
        const existing = await prisma.hackathonStaging.findMany({
          where: { title: { in: titles }, source: 'DEVFOLIO' },
          select: { title: true },
        })
        existing.forEach(e => existingTitles.add(e.title))
      } catch {}
    }
    for (const item of results) {
      if (newItems.length >= target) break
      if (existingTitles.has(item.title)) continue
      if (isEnded(item.deadline, item.title)) continue
      newItems.push(item)
    }
    if (newItems.length >= target) break
  }
  const sliced = target === Number.MAX_SAFE_INTEGER ? newItems : newItems.slice(0, target)
  // Bounded detail/tab enrichment (server-rendered <slug>.devfolio.co + /schedule + /prizes).
  // Failures never break list items (try/catch per item, keep list data).
  try {
    await enrichDevfolioItems(sliced)
  } catch {}
  logger.info(`[Devfolio] Fetched ${sliced.length} hackathons (target ${limit || 'all'}) capped at ${MAX_PAGES} pages`)
  return sliced
}


// ─── Devfolio detail/tab enrichment (B.raw.md:42 tabs) ─────────────────
// Detail pages are server-rendered at https://<slug>.devfolio.co/ with tabs
// Overview (= base) + Prizes + Schedule (evidence: "Overview Prizes Schedule"
// repeated 4x on WebCraft24 detail). Fetcher is list-only by design (tagline
// absent in __NEXT_DATA__, prize keys absent) — detail proves a `miss` vs
// detail-level raw (REPORT-devfolio.md). This bounded enrichment fills:
// prize tiers (₹ + $), schedule text/stages, team size, rules→judging,
// eligibility, full description — all optional, omit when absent (never fake).
// Evidence anchors: "Runs from Sep 25 - 26, 2026", "Greater Noida, India",
// "Team Size: 2 to 4 members", "$500+ Prize Pool", "Registration Deadline:
// September 1st, 2026", "Rules Follow the Code of Conduct".

/** Strip nav noise ("Overview Prizes Schedule" repeats) before description mining. */
function stripDevfolioNav(text: string): string {
  return String(text ?? '')
    .replace(/(Overview\s+Prizes\s+Schedule\s*)+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Rules section → judging (schema has no `rules` field; judging is closest). */
export function extractDevfolioRules(text: unknown): string {
  const s = String(text ?? '');
  if (!s.trim()) return '';
  const m = s.match(/rules?\s*[:\-–—]?\s*(.+?)(?=\s*(?:schedule|prizes?|overview|team|eligibility|venue|mode|judging|dates?|stages?|sponsors?|faq)\s*[:\-–—]?|$)/is);
  if (m) {
    const v = m[1].replace(/\s+/g, ' ').trim().slice(0, 800);
    // Require substance (>=10 chars): bare "here xyz" (8) is passing mention, not a rules section.
    if (v.length >= 10) return v;
  }
  return '';
}

/**
 * Pure Devfolio detail parser (no network/DB — hermetic unit-testable).
 * Accepts raw HTML or stripped text; returns only evidenced fields.
 */
export function parseDevfolioDetail(
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
  // Nav ("Overview Prizes Schedule" x4) pollutes section mining (first "Schedule" in nav
  // yields schedule="Overview"). Mine eligibility/judging/schedule/stages from nav-clean text.
  const navClean = stripDevfolioNav(stripped);
  const mineText = navClean.length > 100 ? navClean : stripped;
  const description = cleanDescription(navClean, { title: opts?.title, source: 'DEVFOLIO' });
  // Prizes: ₹ tiers + $ tiers (e.g. "$500+ Prize Pool"), merged + deduped by amount digits.
  const inr = extractPrizeTiers(stripped);
  const usd = extractUSDPrizeTiers(stripped);
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
  // Team size: explicit "Team Size: 2 to 4" → 4 (max), else mining fallback (nav-clean).
  let teamSize: number | null = null;
  try {
    teamSize = extractExplicitTeamSize(mineText) ?? extractTeamSize(mineText);
  } catch {
    teamSize = null;
  }
  let eligibility = '';
  try {
    eligibility = extractEligibility(mineText);
  } catch {}
  // Judging: Rules section is authoritative for Devfolio (WebCraft24 "Rules Follow the
  // Code of Conduct"). Generic extractJudging misfires on schedule text ("Day 2 judging
  // + results." → "+ results."), so prefer Rules when Judging looks like schedule bleed
  // (short <20 chars or contains "result").
  let judging = '';
  let judgingViaJudging = '';
  let judgingViaRules = '';
  try {
    judgingViaJudging = extractJudging(mineText);
  } catch {}
  try {
    judgingViaRules = extractDevfolioRules(mineText);
  } catch {}
  if (judgingViaRules && (!judgingViaJudging || judgingViaJudging.length < 20 || /result/i.test(judgingViaJudging))) {
    judging = judgingViaRules;
  } else {
    judging = judgingViaJudging || judgingViaRules;
  }
  let schedule = '';
  try {
    schedule = extractScheduleText(mineText);
  } catch {}
  let stages: Array<{ title: string; date?: string }> = [];
  try {
    stages = extractStages(mineText);
  } catch {
    stages = [];
  }
  return { description, prizePool, prizeTiers: tiers, perks, teamSize, eligibility, judging, schedule, stages };
}

/**
 * Fetch one Devfolio detail (base + /schedule + /prizes, sequential via fetchPage6k).
 * Cached (fetchPage6k scrapeCache), small timeouts (fetchPage6k 15s gate), never throws —
 * returns null when no evidenced fields (caller keeps list data).
 */
export async function fetchDevfolioDetail(url: string): Promise<Partial<NormalizedOpportunity> | null> {
  try {
    if (!url || typeof url !== 'string' || !url.toLowerCase().includes('.devfolio.co')) return null;
    const base = url.replace(/\/$/, '');
    const tabs = ['', '/schedule', '/prizes'];
    const chunks: string[] = [];
    // Sequential (rate-respecting) — 3 small fetches max per item, cached.
    for (const suffix of tabs) {
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
    const parsed = parseDevfolioDetail(combined);
    const out: Partial<NormalizedOpportunity> = {};
    if (parsed.description) out.description = parsed.description;
    if (parsed.prizePool) out.prizePool = parsed.prizePool;
    if (parsed.prizeTiers.length) out.prizeTiers = parsed.prizeTiers;
    if (parsed.perks.length) out.perks = parsed.perks;
    if (parsed.teamSize !== null) out.teamSize = parsed.teamSize;
    if (parsed.eligibility) out.eligibility = parsed.eligibility;
    if (parsed.judging) out.judging = parsed.judging;
    if (parsed.schedule) out.schedule = parsed.schedule;
    if (parsed.stages.length) out.stages = parsed.stages;
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
export async function enrichDevfolioItems(items: NormalizedOpportunity[]): Promise<void> {
  if (!items.length) return;
  const CONCURRENCY = 3;
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((it) => fetchDevfolioDetail(it.url)));
    for (let j = 0; j < settled.length; j++) {
      try {
        const r = settled[j];
        if (r.status !== 'fulfilled' || !r.value) continue;
        const detail = r.value as Partial<NormalizedOpportunity>;
        const target = batch[j];
        if (detail.description && !target.description) target.description = detail.description;
        if (detail.prizePool && !target.prizePool) {
          target.prizePool = detail.prizePool;
          if (detail.prizeTiers?.length && !(target as any).prizeTiers?.length) (target as any).prizeTiers = detail.prizeTiers;
          if (detail.perks?.length && !(target as any).perks?.length) (target as any).perks = detail.perks;
        } else if (detail.prizeTiers?.length && !(target as any).prizeTiers?.length) {
          // Headline prizePool present but tiers missing — attach tiers without clobbering headline.
          (target as any).prizeTiers = detail.prizeTiers;
          if (detail.perks?.length && !(target as any).perks?.length) (target as any).perks = detail.perks;
        }
        if (detail.teamSize !== undefined && detail.teamSize !== null && (target.teamSize === undefined || target.teamSize === null)) {
          (target as any).teamSize = detail.teamSize;
        }
        if (detail.eligibility && !(target as any).eligibility) (target as any).eligibility = detail.eligibility;
        if (detail.judging && !(target as any).judging) (target as any).judging = detail.judging;
        if (detail.schedule && !(target as any).schedule) (target as any).schedule = detail.schedule;
        if (detail.stages?.length && !(target as any).stages?.length) (target as any).stages = detail.stages;
      } catch {
        continue;
      }
    }
  }
}

export function fetchDevfolioFromHTML(html: string): NormalizedOpportunity[] {
  const opportunities: NormalizedOpportunity[] = []
  const cardRegex = /href="(https:\/\/[^"]*\.devfolio\.co\/?)"[^>]*>([\s\S]*?)<\/a>/g
  let match
  while ((match = cardRegex.exec(html)) !== null && opportunities.length < 20) {
    const section = match[2]
    const titleMatch = section.match(/<h3[^>]*>([^<]+)<\/h3>/)
    if (!titleMatch) continue
    const title = titleMatch[1].trim()
    const url = match[1]
    const onlineMatch = section.match(/Online/i)
    const offlineMatch = section.match(/Offline/i)
    opportunities.push({
      type: 'HACKATHON',
      title,
      description: '',
      url,
      source: 'DEVFOLIO',
      organizer: '',
      deadline: '',
      startDate: '',
      duration: '',
      location: '',
      mode: onlineMatch ? 'ONLINE' : offlineMatch ? 'OFFLINE' : 'ONLINE',
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
  return opportunities
}
