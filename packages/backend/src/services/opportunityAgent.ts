// services/opportunityAgent.ts — opportunity fetch orchestrator (Track 4 C-3 split).
// WHY: this was a 4,638-line god module (10 platform scrapers + reputation
// scoring + AI enrich + DB dedup + caches in one file; adding platform #11
// meant modifying it — OCP violation). Platform fetchers now live in
// ./opportunities/sources/<site>.ts, enrich stages in ./opportunities/stages.ts,
// AI gates in ./opportunities/errors.ts, shared helpers in ./opportunities/*.
// This file keeps ONLY orchestration (Fetch All fan-out at p-limit 5 +
// per-platform dispatch via the OCP registry) plus backward-compat re-exports
// so existing routes (fetch/hackathons/internships/internalCron) keep working
// without import churn. AbortSignal timeouts stay inside each fetcher;
// withRetry stays explicit at DB call sites.

import { logger } from '../utils/logger'
import type { NormalizedOpportunity } from './opportunities/types'
import {
  extractPastYearFromTitle as extractPastYearFromTitleSSOT,
  isTitlePastYear as isTitlePastYearSSOT,
  inferDeadlineFromTitle as inferDeadlineFromTitleSSOT,
  isEnded as isEndedSSOT,
} from './opportunities/dates'
import {
  getPlatformFetcher,
  registerPlatform,
  registerPlatformFetcher,
  listFetchAllPlatforms,
  getPlatformType,
} from './opportunities/registry'
import { fetchDevfolio } from './opportunities/sources/devfolio'
import { fetchInternshala } from './opportunities/sources/internshala'
import { fetchDevpost } from './opportunities/sources/devpost'
import { fetchMLH } from './opportunities/sources/mlh'
import { fetchUnstop, fetchUnstopInternships } from './opportunities/sources/unstop'
import { fetchHack2Skill } from './opportunities/sources/hack2skill'
import { fetchDoraHacks } from './opportunities/sources/dorahacks'
import { fetchHackerEarth } from './opportunities/sources/hackerearth'
import { fetchWellfoundInternships } from './opportunities/sources/wellfound'

export type { NormalizedOpportunity } from './opportunities/types'
export type { BaseOpportunity, HackathonDetails, InternshipDetails } from './opportunities/types'
export { DYNAMIC_COMPANY_COLLEGE_INDICATORS } from './opportunities/reputation'

// Compat: AI sentinel + gates (canonical home ./opportunities/errors.ts).
export {
  AiRateLimitError,
  isRateLimitError,
  buildAiIssue,
  isGroqKeySet,
  isEnrichmentAIDisabled,
} from './opportunities/errors'
// Compat: enrich stages (canonical home ./opportunities/stages.ts).
export { enrichHackathonStaging, enrichInternshipStaging } from './opportunities/stages'
// Compat: search-driven Other Sources (canonical home ./opportunities/sources/search.ts).
export {
  fetchOtherHackathons,
  fetchOtherInternships,
  fetchPage6k,
  fetchGenericViaSearch,
  fetchDuckDuckGoHumanUrls,
  aiExtractSingleHackathon,
  aiExplodeAggregatedHackathons,
  aiExtractSingleInternship,
} from './opportunities/sources/search'
// Compat: per-platform fetchers (canonical homes ./opportunities/sources/<site>.ts).
export { fetchDevfolio } from './opportunities/sources/devfolio'
export { fetchInternshala } from './opportunities/sources/internshala'
export { fetchDevpost } from './opportunities/sources/devpost'
export { fetchMLH } from './opportunities/sources/mlh'
export { fetchUnstop, fetchUnstopInternships } from './opportunities/sources/unstop'
export { fetchHack2Skill, fetchHack2SkillRegistrationEnd } from './opportunities/sources/hack2skill'
export { fetchDoraHacks } from './opportunities/sources/dorahacks'
export { fetchHackerEarth } from './opportunities/sources/hackerearth'
export { fetchWellfoundInternships } from './opportunities/sources/wellfound'
export { fetchReskilllPage } from './opportunities/sources/reskilll'

// Compat date wrappers (canonical home ./opportunities/dates.ts).
export function extractPastYearFromTitle(title?: string | null): number | null {
  return extractPastYearFromTitleSSOT(title)
}

export function isTitlePastYear(title?: string | null): boolean {
  return isTitlePastYearSSOT(title)
}

export function inferDeadlineFromTitle(title: string, fallbackUrl?: string): string {
  return inferDeadlineFromTitleSSOT(title, fallbackUrl)
}

export function isEnded(deadlineStr?: string | null, title?: string | null): boolean {
  return isEndedSSOT(deadlineStr, title)
}

// New high-signal sources: DoraHacks (global Web3/AI), HackerEarth (India college/corporate), Wellfound (startup internships with salary).
// OPERATIONAL MODE BUILD: Fetch All tick/target persisted via PlatformSettings (enabled/fetchLimit). When limits map is provided and non-empty, only platforms present in the map are fetched (missing = disabled/tick-off → skipped). When limits is undefined or empty, all 10 are fetched (legacy default).
//
// SSOT: platform list/type/enrichPages live in ./opportunities/registry.ts.
// Adding platform #11 = new sources/<site>.ts + ONE registerPlatform() below.
// Do NOT add another if (shouldFetch(...)) branch — fetchFromAllSources iterates
// listFetchAllPlatforms() so orchestrator/cron/fetch stay in sync.

export interface PlatformFetchResult {
  /** UPPER-CASE platform key, e.g. 'DEVFOLIO'. */
  platform: string;
  /** false when this platform's fetcher threw (isolated — siblings still succeed) */
  ok: boolean;
  /** wall-clock ms for this platform's fetcher (feeds SourceHealth latency) */
  latencyMs: number;
  /** items surviving isEnded filter (what flows to saveItems) */
  count: number;
  /** throw message when ok === false (feeds SourceHealth lastError) */
  error?: string;
}

export interface FetchAllDetailed {
  items: NormalizedOpportunity[];
  results: PlatformFetchResult[];
}

/** Detailed Fetch All fan-out with per-platform ok/latency/count (feeds SourceHealth). */
export async function fetchFromAllSourcesWithResults(limits?: Record<string, number | undefined>): Promise<FetchAllDetailed> {
  // Respect per-platform target limits during fetch (target-driven loop capped at MAX_PAGES = 10)
  // NOTE: OTHER_HACKATHON / OTHER_INTERNSHIP are DELIBERATELY excluded here (detached per user request).
  // Use manual Other Sources endpoints via POST /fetch/other/* for manual triggers only.
  const hasLimits = !!(limits && Object.keys(limits).length > 0)
  const normLimits = new Map<string, number | undefined>()
  if (limits) {
    for (const [k, v] of Object.entries(limits)) normLimits.set(String(k).toUpperCase(), v)
  }
  const shouldFetch = (key: string): boolean => {
    if (!hasLimits) return true
    return normLimits.has(String(key).toUpperCase())
  }
  // UNSTOP_INTERNSHIP inherits UNSTOP limit when UNSTOP_INTERNSHIP not explicitly present but UNSTOP is (backward compat)
  const hasUnstopInternKey = hasLimits
    ? normLimits.has('UNSTOP_INTERNSHIP') || normLimits.has('UNSTOP_INTERNSHIPS')
    : true
  const hasUnstopFallback = hasLimits ? normLimits.has('UNSTOP') : false
  const shouldFetchUnstopIntern = hasLimits ? hasUnstopInternKey || hasUnstopFallback : true
  const resolveLimit = (key: string): number | undefined => normLimits.get(String(key).toUpperCase())
  const unstopInternLimit: number | undefined = hasUnstopInternKey
    ? (resolveLimit('UNSTOP_INTERNSHIP') ?? resolveLimit('UNSTOP_INTERNSHIPS'))
    : hasUnstopFallback
      ? resolveLimit('UNSTOP')
      : undefined

  // 10k scale: p-limit 5 — at most 5 platform fetchers in flight.
  // Each fetcher already carries its own AbortSignal timeout (10-30s per
  // source); bounding concurrency prevents 10-way bursts from exhausting
  // sockets/DB under Fetch All. Tasks are lazy closures so no fetch starts
  // before a worker slot frees.
  const FETCH_ALL_CONCURRENCY = 5
  const tasks: Array<{ platform: string; run: () => Promise<NormalizedOpportunity[]> }> = []
  // Registry-driven fan-out (no per-platform if-chain to edit for #11).
  // UNSTOP_INTERNSHIP handled after the loop for backward-compat alias/limit inheritance.
  for (const key of listFetchAllPlatforms()) {
    if (key === 'UNSTOP_INTERNSHIP') continue
    if (!shouldFetch(key)) continue
    const fn = getPlatformFetcher(key)
    if (!fn) {
      logger.warn(`[FetchAll] no fetcher registered for ${key} (skipped)`)
      continue
    }
    const limit = resolveLimit(key)
    const captured = fn
    const capturedLimit = limit
    tasks.push({ platform: key, run: () => captured(capturedLimit) })
  }
  if (shouldFetchUnstopIntern) {
    const fn = getPlatformFetcher('UNSTOP_INTERNSHIP')
    if (fn) {
      const captured = fn
      tasks.push({ platform: 'UNSTOP_INTERNSHIP', run: () => captured(unstopInternLimit) })
    }
  }

  if (tasks.length === 0) {
    logger.info('[FetchAll] No platforms enabled — skipping all fetchers (all ticks off)')
    return { items: [], results: [] }
  }
  // Bounded-concurrency runner (p-limit 5 without new dep). Each task timed
  // so SourceHealth gets real per-platform latency even under concurrency.
  const settled: Array<
    | { platform: string; status: 'fulfilled'; value: NormalizedOpportunity[]; latencyMs: number }
    | { platform: string; status: 'rejected'; reason: unknown; latencyMs: number }
  > = new Array(tasks.length)
  let next = 0
  async function worker(): Promise<void> {
    while (true) {
      const i = next++
      if (i >= tasks.length) return
      const t0 = Date.now()
      try {
        const value = await tasks[i].run()
        settled[i] = { platform: tasks[i].platform, status: 'fulfilled', value, latencyMs: Date.now() - t0 }
      } catch (e) {
        settled[i] = { platform: tasks[i].platform, status: 'rejected', reason: e, latencyMs: Date.now() - t0 }
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(FETCH_ALL_CONCURRENCY, tasks.length) }, () => worker())
  )
  const results: PlatformFetchResult[] = []
  const kept: NormalizedOpportunity[][] = []
  // Log per-platform failures without failing the whole Fetch All (parity with old Promise.all behavior
  // which would reject everything on one throw — now isolated per platform).
  for (const s of settled) {
    if (s.status === 'rejected') {
      const reason: any = (s as { reason: unknown }).reason
      const msg = String(reason?.message || reason || 'Fetch failed').slice(0, 500)
      logger.warn({ err: msg }, `[FetchAll] ${s.platform} failed (isolated)`)
      results.push({ platform: s.platform, ok: false, latencyMs: s.latencyMs, count: 0, error: msg })
    } else {
      const ok = s as { platform: string; status: 'fulfilled'; value: NormalizedOpportunity[]; latencyMs: number }
      const filtered = (ok.value || []).filter(opp => !isEnded(opp.deadline, opp.title))
      kept.push(filtered)
      results.push({ platform: ok.platform, ok: true, latencyMs: ok.latencyMs, count: filtered.length })
    }
  }
  // Deterministic order for tests/UI (workers complete out of order).
  results.sort((a, b) => a.platform.localeCompare(b.platform))
  return { items: kept.flat(), results }
}

/** Compat: flat items only (internalCron + legacy callers). */
export async function fetchFromAllSources(limits?: Record<string, number | undefined>): Promise<NormalizedOpportunity[]> {
  return (await fetchFromAllSourcesWithResults(limits)).items
}

const platformFetchers: Record<string, (limit?: number, opts?: { signal?: AbortSignal }) => Promise<NormalizedOpportunity[]>> = {
  DEVFOLIO: fetchDevfolio,
  DEVPOST: fetchDevpost,
  INTERNSHALA: fetchInternshala,
  MLH: fetchMLH,
  UNSTOP: fetchUnstop,
  HACK2SKILL: fetchHack2Skill,
  DORAHACKS: fetchDoraHacks,
  HACKEREARTH: fetchHackerEarth,
  UNSTOP_INTERNSHIP: fetchUnstopInternships,
  UNSTOP_INTERNSHIPS: fetchUnstopInternships,
  WELLFOUND: fetchWellfoundInternships,
}

// OCP: single registration site — new platform = new sources/<site>.ts file +
// ONE registerPlatform() entry below (fetch + type + enrichPages travel together).
// fetchFromAllSources / fetch.ts / internalCron / stages all read the registry,
// so no orchestrator/fetch/cron/enrich edits are needed for platform #11.
registerPlatform({ key: 'DEVFOLIO', type: 'HACKATHON', fetcher: fetchDevfolio, enrichPages: ['', '/schedule', '/prizes', '/judges'] })
registerPlatform({ key: 'DEVPOST', type: 'HACKATHON', fetcher: fetchDevpost, enrichPages: ['', '/rules', '/prizes', '/judges'] })
registerPlatform({ key: 'MLH', type: 'HACKATHON', fetcher: fetchMLH, enrichPages: ['', '/schedule', '/faq', '/prizes'] })
registerPlatform({ key: 'UNSTOP', type: 'HACKATHON', fetcher: fetchUnstop, enrichPages: ['', '/problem-statement', '/timeline', '/prizes'] })
registerPlatform({ key: 'HACK2SKILL', type: 'HACKATHON', fetcher: fetchHack2Skill, enrichPages: [''] })
registerPlatform({ key: 'DORAHACKS', type: 'HACKATHON', fetcher: fetchDoraHacks, enrichPages: ['', '/details'] })
registerPlatform({ key: 'HACKEREARTH', type: 'HACKATHON', fetcher: fetchHackerEarth, enrichPages: ['', '/prizes', '/rules', '/judges', '/teams'] })
registerPlatform({ key: 'INTERNSHALA', type: 'INTERNSHIP', fetcher: fetchInternshala, enrichPages: ['', '/perks'] })
registerPlatform({ key: 'UNSTOP_INTERNSHIP', type: 'INTERNSHIP', fetcher: fetchUnstopInternships, enrichPages: ['', '/problem-statement', '/timeline', '/prizes'] })
registerPlatform({ key: 'WELLFOUND', type: 'INTERNSHIP', fetcher: fetchWellfoundInternships, enrichPages: [''] })
// Compat: keep legacy fetcher map populated for direct platformFetcherMap() readers.
for (const [name, fn] of Object.entries(platformFetchers)) registerPlatformFetcher(name, fn)

// Re-export SSOT helpers so routes import from ONE place (no local copies).
export { listFetchAllPlatforms, getPlatformType, getPlatformMeta, getEnrichPagesForRecord, platformTypeMap } from './opportunities/registry'


export async function fetchFromPlatform(platform: string, limit?: number, opts?: { signal?: AbortSignal }): Promise<NormalizedOpportunity[]> {
  return (await fetchFromPlatformWithMeta(platform, limit, opts)).items
}

/** Single-platform fetch with timing (feeds SourceHealth latency/error). Never swallows — throws on failure. */
export async function fetchFromPlatformWithMeta(
  platform: string,
  limit?: number,
  opts?: { signal?: AbortSignal },
): Promise<{ items: NormalizedOpportunity[]; latencyMs: number }> {
  const key = String(platform || '').toUpperCase()
  const fn = getPlatformFetcher(key) ?? platformFetchers[key]
  if (!fn) throw new Error(`Unknown platform: ${platform}`)
  const t0 = Date.now()
  const results = await fn(limit, opts)
  const latencyMs = Date.now() - t0
  const filtered = results.filter(opp => !isEnded(opp.deadline, opp.title))
  // Ensure limit respected exactly (fetcher already caps, but slice as safety)
  if (limit && limit > 0) return { items: filtered.slice(0, limit), latencyMs }
  return { items: filtered, latencyMs }
}

