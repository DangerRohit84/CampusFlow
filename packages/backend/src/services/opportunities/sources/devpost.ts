// opportunities/sources/devpost.ts — Devpost platform fetcher (Track 4 C-3 split).
// WHY: /api/hackathons paging + date parsing, one home. formatLocalDate
// resolves to the dates.ts SSOT (identical output for Date inputs).
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
import { formatLocalDate } from '../dates'
import {
  cleanDescription,
  extractUSDPrizeTiers,
  extractPrizeTiers,
  extractWhoCanParticipate,
  extractScheduleText,
  extractStages,
  extractEligibility,
} from './details'

// ─── Devpost: pure helper (exported for hermetic regression test) ───

/**
 * Organizer from a Devpost /api/hackathons item (HIGH wart 2026-09-09).
 * Live API carries `organization_name` (e.g. RevenueCat / Google / Amazon) —
 * old `organizer_name` never matches → organizer/company always ''.
 * Prefers `organization_name`, falls back to legacy `organizer_name`,
 * honest-omit ('') when absent.
 */
export function extractDevpostOrganizer(h: unknown): string {
  if (!h || typeof h !== 'object') return ''
  const rec = h as Record<string, any>
  const v = rec.organization_name ?? rec.organizer_name ?? ''
  return typeof v === 'string' ? v.trim() : ''
}

// ─── Devpost: JSON API ────────────────────────────────────────────
export async function fetchDevpostPage(page: number, seen: Set<string>): Promise<NormalizedOpportunity[]> {
  try {
    const response = await fetch(`https://devpost.com/api/hackathons?page=${page}`, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) return []
    const data = await response.json() as any

    const opportunities: NormalizedOpportunity[] = []
    for (const h of (data.hackathons || [])) {
      const title = h.title?.trim() || ''
      if (!title || seen.has(title)) continue
      seen.add(title)

      // Parse submission period dates for deadline and start
      let deadline = ''
      let startDate = ''
      if (h.submission_period_dates) {
        const parts = h.submission_period_dates.split(' - ')
        if (parts.length === 2) {
          startDate = parseDevpostDate(parts[0].trim()) || ''
          deadline = parseDevpostDate(parts[1].trim()) || ''
        }
      }

      // Extract prize amount (strip HTML tags, omit absent — never ₹0/$0).
      const prizeRaw = h.prize_amount || ''
      const prizePool = prizeRaw.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

      // Themes
      const themes = (h.themes || []).map((t: any) => t.name).filter(Boolean)

      // Mode — venue preserved in location; HYBRID when physical venue present.
      const loc = h.displayed_location?.location || ''
      let mode = 'ONLINE'
      if (loc.toLowerCase().includes('online')) mode = 'ONLINE'
      else if (loc) mode = 'HYBRID'

      opportunities.push({
        type: 'HACKATHON',
        title,
        description: cleanDescription(h.tagline || '', { title, source: 'DEVPOST' }),
        url: h.url || '',
        source: 'DEVPOST',
        organizer: extractDevpostOrganizer(h),
        deadline,
        startDate,
        duration: h.time_left_to_submission || '',
        location: loc,
        mode,
        prizePool,
        stipend: '',
        company: extractDevpostOrganizer(h),
        role: '',
        themes,
        website: '',
        discord: '',
        participantsCount: h.registrations_count || 0,
        inviteOnly: h.invite_only || false,
      })
    }
    return opportunities
  } catch {
    return []
  }
}


export function parseDevpostDate(dateStr: string): string {
  // "May 19" or "Aug 17, 2026" or "Aug 17" — if no year, assume current year (do NOT bump past to next year; isEnded will filter completed correctly like Devfolio/Unstop)
  try {
    const cleaned = dateStr.replace(/\u003c[^>]*>/g, '').trim()
    const d = new Date(cleaned)
    if (!isNaN(d.getTime())) {
      const hasYear = /\b20\d{2}\b/.test(cleaned)
      if (!hasYear) {
        const y = d.getFullYear()
        if (y < 2024) {
          const now = new Date()
          const withYear = `${cleaned}, ${now.getFullYear()}`
          const d2 = new Date(withYear)
          if (!isNaN(d2.getTime())) return formatLocalDate(d2)
        }
      }
      return formatLocalDate(d)
    }
    const now = new Date()
    const withYear = `${cleaned}, ${now.getFullYear()}`
    const d2 = new Date(withYear)
    if (!isNaN(d2.getTime())) {
      return formatLocalDate(d2)
    }
  } catch {}
  return ''
}


export async function fetchDevpost(limit?: number): Promise<NormalizedOpportunity[]> {
  const target = limit && limit > 0 ? limit : Number.MAX_SAFE_INTEGER
  const seen = new Set<string>()
  const newItems: NormalizedOpportunity[] = []
  for (let page = 1; page <= MAX_PAGES && newItems.length < target; page++) {
    const results = await fetchDevpostPage(page, seen)
    if (results.length === 0) break
    const titles = results.map(r => r.title).filter(Boolean)
    let existingTitles = new Set<string>()
    if (titles.length) {
      try {
        const existing = await prisma.hackathonStaging.findMany({
          where: { title: { in: titles }, source: 'DEVPOST' },
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
  // Bounded detail/tab enrichment (h.url + /rules). Failures never break list items.
  try {
    await enrichDevpostItems(sliced)
  } catch {}
  logger.info(`[Devpost] Fetched ${sliced.length} hackathons (target ${limit || 'all'}) capped at ${MAX_PAGES} pages`)
  return sliced
}

// ─── Devpost detail/tab enrichment (B.raw.md:54 + B.webfetch-detail.md:17,32-37) ───
// List API carries headline prize ($740,000), themes, participants — but NO tagline
// (description '' honest at list level) and NO eligibility keys. Detail proves rich copy:
// overview ("Ship apps and start making money." + multi-KB body), "Who can participate:
// Ages 13 to 99 only; Specific countries/territories excluded [View full rules](/rules)",
// nav "Overview My projects Participants (24744) Resources Rules Project gallery ...".
// This bounded enrichment fetches h.url (overview) + /rules (full rules fragment),
// then fills: full description, eligibility, prize breakdown beyond headline ($ tiers),
// schedule text/stages when evidenced. All optional, omit when absent (never fake).

/**
 * Pure Devpost detail parser (no network/DB — hermetic unit-testable).
 * Accepts raw HTML or stripped text (overview + /rules combined); returns only evidenced fields.
 */
export function parseDevpostDetail(
  html: unknown,
  opts?: { title?: string },
): {
  description: string;
  eligibility: string;
  prizePool: string;
  prizeTiers: string[];
  schedule: string;
  stages: Array<{ title: string; date?: string }>;
} {
  const raw = String(html ?? '');
  if (!raw.trim()) {
    return { description: '', eligibility: '', prizePool: '', prizeTiers: [], schedule: '', stages: [] };
  }
  const stripped = stripHtml(raw).replace(/\s+/g, ' ').trim();
  // Description: full overview (not tagline-only, not 400-truncated — cap 2000 shared rule).
  const description = cleanDescription(stripped, { title: opts?.title, source: 'DEVPOST' });
  // Eligibility: prefer "Who can participate" (Ages 13-99), else generic eligibility sentences.
  let eligibility = '';
  try {
    eligibility = extractWhoCanParticipate(stripped);
  } catch {}
  if (!eligibility) {
    try {
      eligibility = extractEligibility(stripped);
    } catch {}
  }
  // Prizes: $ tiers beyond headline + ₹ fallback (dedupe by amount).
  const usd = (() => {
    try {
      return extractUSDPrizeTiers(stripped);
    } catch {
      return { prizePool: '', tiers: [] as string[], perks: [] as string[] };
    }
  })();
  const inr = (() => {
    try {
      return extractPrizeTiers(stripped);
    } catch {
      return { prizePool: '', tiers: [] as string[], perks: [] as string[] };
    }
  })();
  const tiers: string[] = [...usd.tiers];
  const seenAmt = new Set(
    tiers.map((t) => (t.match(/\$([\d,]+)/) || [])[1]?.replace(/,/g, '')).filter(Boolean),
  );
  for (const t of inr.tiers) {
    const amt = (t.match(/₹([\d,]+)/) || [])[1]?.replace(/,/g, '');
    if (amt && seenAmt.has(amt)) continue;
    if (!tiers.includes(t)) {
      tiers.push(t);
      if (amt) seenAmt.add(amt);
    }
  }
  const prizePool = tiers.length ? tiers.join(', ') : '';
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
  return { description, eligibility, prizePool, prizeTiers: tiers, schedule, stages };
}

/**
 * Fetch one Devpost detail (base + /rules fragment, sequential via fetchPage6k).
 * Cached, small timeouts, never throws — null when no evidenced fields.
 */
export async function fetchDevpostDetail(url: string): Promise<Partial<NormalizedOpportunity> | null> {
  try {
    if (!url || typeof url !== 'string' || !url.toLowerCase().includes('devpost.com')) return null;
    const base = url.replace(/\/$/, '');
    const tabs = ['', '/rules'];
    const chunks: string[] = [];
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
    const parsed = parseDevpostDetail(combined);
    const out: Partial<NormalizedOpportunity> = {};
    if (parsed.description) out.description = parsed.description;
    if (parsed.eligibility) out.eligibility = parsed.eligibility;
    // Prize breakdown beyond headline: attach tiers when evidenced; prizePool only when list missed it
    // (caller merges — headline $740,000 preserved, tiers appended without clobber).
    if (parsed.prizeTiers.length) out.prizeTiers = parsed.prizeTiers;
    if (parsed.prizePool) out.prizePool = parsed.prizePool;
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
 * Only fills absent list fields (never overwrites headline prizePool with '' / never fakes).
 */
export async function enrichDevpostItems(items: NormalizedOpportunity[]): Promise<void> {
  if (!items.length) return;
  const CONCURRENCY = 3;
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((it) => fetchDevpostDetail(it.url)));
    for (let j = 0; j < settled.length; j++) {
      try {
        const r = settled[j];
        if (r.status !== 'fulfilled' || !r.value) continue;
        const detail = r.value as Partial<NormalizedOpportunity>;
        const target = batch[j];
        if (detail.description && !target.description) target.description = detail.description;
        if (detail.eligibility && !(target as any).eligibility) (target as any).eligibility = detail.eligibility;
        if (detail.prizeTiers?.length && !(target as any).prizeTiers?.length) {
          (target as any).prizeTiers = detail.prizeTiers;
          // Keep headline prizePool ($740,000) — append tiers only when they add new amounts.
          if (detail.prizePool && target.prizePool) {
            const extra = (detail.prizeTiers || []).filter((t) => !String(target.prizePool).includes(t));
            if (extra.length) target.prizePool = `${target.prizePool}, ${extra.join(', ')}`;
          } else if (detail.prizePool && !target.prizePool) {
            target.prizePool = detail.prizePool;
          }
        } else if (detail.prizePool && !target.prizePool) {
          target.prizePool = detail.prizePool;
        }
        if (detail.schedule && !(target as any).schedule) (target as any).schedule = detail.schedule;
        if (detail.stages?.length && !(target as any).stages?.length) (target as any).stages = detail.stages;
      } catch {
        continue;
      }
    }
  }
}
