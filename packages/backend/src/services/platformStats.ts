// packages/backend/src/services/platformStats.ts
// Track 4: PlatformStat kept here for compat; canonical ISP split lives in
// ./stats/types.ts (BaseStat + per-platform unions). fetchAllPlatformStats
// uses the OCP registry (one registration per platform).

import { PlatformRegistry } from './platforms/registry'
import { fetchCodeforcesJson } from './codeforcesGate'
import { logger } from '../utils/logger'
import { cache } from '../lib/cache'
import { memoizedSingleflight } from '../lib/singleflight'

export type { PlatformStat } from './stats/types'
import type { PlatformStat } from './stats/types'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const FETCH_TIMEOUT_MS = 5000
// Codeforces stats (user.info / user.status / user.rating fallback) use the
// contest-fetcher budget (10s), not the 5s scrape budget. LIVE root cause:
// 5s aborted healthy user.info from India while user.rating (10s) succeeded
// → 35 contests shown with stats valid 0/1 + "verify handle" loop after a
// fresh sync. Same 2s gate, no extra load on the happy path.
export const CF_STATS_TIMEOUT_MS = 10_000
// LeetCode GraphQL tail is slow from India — 5s FETCH_TIMEOUT aborted
// healthy syncs (AbortSignal timeout at _leetcodeStats). 12s covers the
// p95 tail without holding sync workers (per-platform isolation keeps
// other platforms on the tight 5s budget).
export const LEETCODE_STATS_TIMEOUT_MS = 12_000
export const LEETCODE_STATS_MAX_RETRIES = 1
/** Base + jitter ceiling for the single LeetCode retry (600..1100ms). */
export const LEETCODE_STATS_RETRY_BASE_MS = 600
export const LEETCODE_STATS_RETRY_JITTER_MS = 500
// P1-2: 60s → 5m. The hourly shard sync re-stats every stale user; a 60s TTL
// meant the batch-5 burst (plus React StrictMode doubles and concurrent cron
// + manual syncs) missed the in-memory coalesce and refetched per user.
// 5m covers a full shard burst + cross-replica memo (see statsMemoKey) while
// staying far fresher than the 6h valid-stats watermark (syncWatermark.ts).
const CACHE_TTL_MS = 5 * 60_000
const HANDLE_RE = /^[a-zA-Z0-9._-]+$/
function sanitizeHandleStat(handle: string): string | null {
  const s = String(handle || '').trim()
  if (!s || s.length > 50) return null
  if (!HANDLE_RE.test(s)) return null
  if (/[\s<>]/.test(s)) return null
  return s
}

// Coalescing cache for stats — same handle within TTL reuses promise, avoids hammering APIs on bulk sync
const statsCache = new Map<string, { promise: Promise<PlatformStat>; expiry: number }>()
// P1-4: generational shared-memo key. The cross-replica memo lives in the
// shared `cache` (Redis when configured) under `stats:memo:v{gen}:…`;
// `__clearStatsCacheForTests` bumps the generation so hermetic tests never
// observe another test's memo (old generations orphan with 5m TTL expiry,
// never KEYS-scanned).
let statsMemoGen = 0
/** Test-only: clear coalescing cache (retry tests need fresh fetch per handle). */
export function __clearStatsCacheForTests(): void {
  statsCache.clear()
  try {
    statsMemoGen++
  } catch {}
}
/** Shared memo key for a platform+handle (lowercased, tenant-free — handles are per-user inputs). Pure. */
export function statsMemoKey(platform: string, handle: string): string {
  try {
    return `stats:memo:v${statsMemoGen}:${String(platform || '').toLowerCase()}:${String(handle || '').trim().toLowerCase().slice(0, 80)}`
  } catch {
    return `stats:memo:v${statsMemoGen}:unknown:empty`
  }
}

/**
 * P1-4 shared stats fetch: L1 Map (0-op fast path) + cross-replica
 * singleflight with 5m shared memo (memoizedSingleflight → P0-B getOrSet).
 *
 * Validity-tiered: VALID stats memoize 5m in both layers; INVALID stats
 * (typo/deleted/just-created handles) evict both layers after resolving so
 * the next sync revalidates immediately (no stuck "verify handle" loop —
 * the just-created-account case refetches instead of serving 5m-stale
 * invalid). Concurrent invalid callers still share the in-flight promise.
 * Never throws for cache blips (fail-open); loaders never throw by contract
 * (each `_xStats` catches internally and returns an invalid stat).
 */
async function statsWithSharedMemo(platform: string, handle: string, loader: () => Promise<PlatformStat>): Promise<PlatformStat> {
  const cached = getStatsCached(platform, handle)
  if (cached) return cached
  const memoKey = statsMemoKey(platform, handle)
  const p = memoizedSingleflight(memoKey, CACHE_TTL_MS, loader)
  setStatsCached(platform, handle, p)
  const stat = await p
  try {
    if (!stat?.valid) {
      try {
        statsCache.delete(statsCacheKey(platform, handle))
      } catch {}
      try {
        await cache.del(memoKey)
      } catch {}
    }
  } catch {}
  return stat
}
function statsCacheKey(platform: string, handle: string): string {
  return `stat:${platform}:${String(handle || '').trim().toLowerCase()}`
}
function getStatsCached(platform: string, handle: string): Promise<PlatformStat> | null {
  const k = statsCacheKey(platform, handle)
  const e = statsCache.get(k)
  if (e && Date.now() < e.expiry) return e.promise
  if (e) statsCache.delete(k)
  return null
}
function setStatsCached(platform: string, handle: string, promise: Promise<PlatformStat>): void {
  const k = statsCacheKey(platform, handle)
  statsCache.set(k, { promise, expiry: Date.now() + CACHE_TTL_MS })
  promise.finally(() => {
    setTimeout(() => {
      const cur = statsCache.get(k)
      if (cur && cur.promise === promise && Date.now() >= cur.expiry) statsCache.delete(k)
    }, CACHE_TTL_MS).unref?.()
  })
}

/** True for timeout/abort throws only — the sole retryable class for LeetCode. */
export function isLeetcodeRetryableError(err: unknown): boolean {
  const name = (err as any)?.name
  if (name === 'TimeoutError' || name === 'AbortError') return true
  // Fallback for runtimes that surface abort as generic Error with timeout text.
  const msg = String((err as any)?.message || err || '').toLowerCase()
  if (/(aborted|aborterror|timeout|timed out|operation was aborted)/.test(msg)) {
    // Avoid retrying validation/404 text — only abort/timeout phrasing.
    return true
  }
  return false
}

/**
 * Single-retry delay: base + 0..jitterMs. `rand` injectable for deterministic tests.
 */
export function getLeetcodeRetryDelayMs(rand: () => number = Math.random): number {
  let jitter = 0
  try {
    const r = rand()
    if (Number.isFinite(r) && r >= 0 && r < 1) jitter = Math.floor(r * LEETCODE_STATS_RETRY_JITTER_MS)
  } catch {
    jitter = 0
  }
  return LEETCODE_STATS_RETRY_BASE_MS + jitter
}

export interface LeetcodeStatsDeps {
  fetchFn?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  random?: () => number
}

const defaultLeetcodeSleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms))

export async function _leetcodeStats(handle: string, deps: LeetcodeStatsDeps = {}): Promise<PlatformStat> {
  const stat: PlatformStat = { platform: 'leetcode', handle, valid: false }
  const sanitized = sanitizeHandleStat(handle)
  if (!sanitized || !HANDLE_RE.test(sanitized)) return stat
  const fetchFn = deps.fetchFn ?? globalThis.fetch
  const sleep = deps.sleep ?? defaultLeetcodeSleep
  const random = deps.random ?? Math.random
  const body = JSON.stringify({
    query: `query userPublicProfile($username: String!) {
          allQuestionsCount { difficulty count }
          matchedUser(username: $username) {
            username
            profile { ranking reputation }
            submitStatsGlobal {
              acSubmissionNum { difficulty count }
            }
          }
        }`,
    variables: { username: sanitized },
  })
  const maxAttempts = LEETCODE_STATS_MAX_RETRIES + 1
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Fresh AbortSignal per attempt: reusing a timed-out signal would abort
      // the retry immediately (same pattern as codeforcesGate.ts).
      const resp = await fetchFn('https://leetcode.com/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Referer: 'https://leetcode.com' },
        body,
        signal: AbortSignal.timeout(LEETCODE_STATS_TIMEOUT_MS),
      } as RequestInit)
      const data: any = await (resp as Response).json()
      const user = data?.data?.matchedUser
      if (!user) return stat

      const all = data.data.allQuestionsCount || []
      const ac = user.submitStatsGlobal?.acSubmissionNum || []
      const find = (arr: any[], d: string) => arr.find((x: any) => x.difficulty === d)?.count ?? 0

      stat.valid = true
      stat.easySolved = find(ac, 'Easy')
      stat.mediumSolved = find(ac, 'Medium')
      stat.hardSolved = find(ac, 'Hard')
      stat.problemsSolved = (stat.easySolved ?? 0) + (stat.mediumSolved ?? 0) + (stat.hardSolved ?? 0)
      stat.totalProblems = find(all, 'All')
      stat.globalRank = user.profile?.ranking || null
      stat.score = user.profile?.reputation || null
      return stat
    } catch (err) {
      const retryable = isLeetcodeRetryableError(err)
      const lastAttempt = attempt >= maxAttempts
      // 404/validation never throw here (early return above) — only
      // timeout/abort is retried once; anything else returns stale immediately.
      if (retryable && !lastAttempt) {
        logger.debug({ handle: sanitized, attempt }, 'LeetCode stats timeout, retrying once')
        await sleep(getLeetcodeRetryDelayMs(random))
        continue
      }
      // Per-platform isolation: never throw — return invalid stat so
      // fetchAllPlatformStats (allSettled) keeps other platforms fresh.
      // Warn (not error) to avoid error-spam on an expected India-network tail.
      if (retryable) {
        logger.warn({ handle: sanitized, attempts: attempt }, 'LeetCode stats timeout after retry, returning stale')
      } else {
        logger.warn({ handle: sanitized, err: (err as any)?.message || err }, 'LeetCode stats error, returning stale')
      }
      return stat
    }
  }
  return stat
}
async function leetcodeStats(handle: string): Promise<PlatformStat> {
  return statsWithSharedMemo('leetcode', handle, () => _leetcodeStats(handle))
}

/**
 * Fallback validity + rating probe via user.rating (same endpoint/size as the
 * contest fetcher, same gate/timeout). Used ONLY when user.info fails.
 *
 * LIVE: contests showed 35 rows (user.rating OK) while stats stayed valid
 * 0/1 with Problems 0 + Best Rating empty — user.info had flaked (5s timeout
 * vs 10s fetcher budget, or a transient 429/503) and validity depended on
 * info alone. Non-empty rating OK proves the handle exists: valid true with
 * rating = last newRating, maxRating = max, contestCount = history length.
 * Rating OK + empty result also proves existence (0-contest account): valid
 * true with null rating and contestCount 0. problemsSolved stays best-effort
 * via user.status (undefined when status also fails so the UI renders 0/—
 * honestly, valid already proven). 400/404/FAILED/rate-limit/throw on rating
 * too → invalid (honest 0/1, e.g. deleted handle).
 */
async function codeforcesRatingFallbackStat(sanitized: string, stat: PlatformStat): Promise<PlatformStat> {
  try {
    const rating = await fetchCodeforcesJson<any>(
      `https://codeforces.com/api/user.rating?handle=${encodeURIComponent(sanitized)}`,
      { timeoutMs: CF_STATS_TIMEOUT_MS }
    )
    if (rating.stillRateLimited) return stat
    if (rating.status === 404 || (rating.status as number) === 400) return stat
    const data: any = rating.data
    if (!data || data.status !== 'OK' || !Array.isArray(data.result)) return stat
    const ratings: number[] = []
    for (const r of data.result) {
      if (Number.isFinite((r as any)?.newRating)) ratings.push(Math.round((r as any).newRating))
    }
    // OK + empty history = valid handle with zero rated contests (do not
    // confuse with 400-invalid). Rating stays null, contestCount 0.
    if (ratings.length === 0 && data.result.length === 0) {
      stat.valid = true
      stat.rating = null
      stat.maxRating = null
      stat.contestCount = 0
    } else {
      if (ratings.length === 0) return stat
      stat.valid = true
      stat.rating = ratings[ratings.length - 1]
      let peak = ratings[0]
      for (let i = 1; i < ratings.length; i++) if (ratings[i] > peak) peak = ratings[i]
      stat.maxRating = peak
      stat.contestCount = data.result.length
    }
    // problemsSolved best-effort (never demotes valid back to false).
    try {
      const status = await fetchCodeforcesJson<any>(
        `https://codeforces.com/api/user.status?handle=${encodeURIComponent(sanitized)}&from=1&count=10000`,
        { timeoutMs: CF_STATS_TIMEOUT_MS }
      )
      if (status.stillRateLimited) return stat
      if (status.status === 404 || (status.status as number) === 400) return stat
      const statusData: any = status.data
      if (statusData && statusData.status === 'OK') {
        const solved = new Set<string>()
        for (const sub of statusData.result || []) {
          if (sub?.verdict === 'OK' && sub?.problem?.contestId != null && sub?.problem?.index != null) {
            solved.add(`${sub.problem.contestId}-${sub.problem.index}`)
          }
        }
        stat.problemsSolved = solved.size
      }
    } catch {
      // solves best-effort; rating/valid already proven
    }
  } catch {
    // rating probe best-effort; invalid stays honest
  }
  return stat
}

async function _codeforcesStats(handle: string): Promise<PlatformStat> {
  const stat: PlatformStat = { platform: 'codeforces', handle, valid: false }
  const sanitized = sanitizeHandleStat(handle)
  if (!sanitized || !HANDLE_RE.test(sanitized)) return stat
  try {
    // Upgrade 1: shared 2s gate + 1 jittered retry (same gate as contests).
    const info = await fetchCodeforcesJson<any>(
      `https://codeforces.com/api/user.info?handles=${encodeURIComponent(sanitized)}&checkHistoricHandles=false&lang=en`,
      { timeoutMs: CF_STATS_TIMEOUT_MS }
    )
    // 404/400, FAILED body, timeout (status 0, data null), or persistent
    // 429/503 after 1 retry → fall back to user.rating before giving up.
    // CF returns HTTP 400 + {status:FAILED} for unknown handles (not 404).
    // Only when rating ALSO fails does valid stay false (0/1 honest).
    if (!info.stillRateLimited && info.status !== 404 && (info.status as number) !== 400) {
      const infoData: any = info.data
      if (infoData && infoData.status === 'OK' && infoData.result?.length) {
        const u = infoData.result[0]

        stat.valid = true
        stat.rating = u.rating ?? null
        stat.maxRating = u.maxRating ?? null
        stat.rankTitle = u.rank ? String(u.rank).replace(/^\w/, (c: string) => c.toUpperCase()) : null
        stat.maxRankTitle = u.maxRank ? String(u.maxRank).replace(/^\w/, (c: string) => c.toUpperCase()) : null
        stat.globalRank = u.rank != null && u.maxRating != null ? null : null

        // Count unique solved problems via user.status — isolated, timeout guarded.
        // Same CF gate (3rd CF call in a full sync still spaced 2s).
        try {
          const status = await fetchCodeforcesJson<any>(
            `https://codeforces.com/api/user.status?handle=${encodeURIComponent(sanitized)}&from=1&count=10000`,
            { timeoutMs: CF_STATS_TIMEOUT_MS }
          )
          if (status.stillRateLimited) return stat
          if (status.status === 404 || (status.status as number) === 400) return stat
          const statusData: any = status.data
          if (statusData && statusData.status === 'OK') {
            const solved = new Set<string>()
            let contests = new Set<number>()
            for (const sub of statusData.result || []) {
              // Guard malformed rows (missing problem) — one bad submission must
              // not wipe the whole solved count (stats must populate when data
              // exists). valid stays true (rating already proven by user.info).
              if (sub?.verdict === 'OK' && sub?.problem?.contestId != null && sub?.problem?.index != null) {
                solved.add(`${sub.problem.contestId}-${sub.problem.index}`)
                if (sub.contestId) contests.add(sub.contestId)
              }
            }
            stat.problemsSolved = solved.size
            stat.contestCount = contests.size
          }
        } catch {
          // status fetch is best-effort; keep stat without solved count
        }
        return stat
      }
    }
    if (info.stillRateLimited) {
      logger.warn(`[codeforces] stats rate limit persisted after 1 retry for ${sanitized}`)
    }
    // Primary probe failed — user.rating (the contests endpoint) is the
    // fallback validity proof.
    return await codeforcesRatingFallbackStat(sanitized, stat)
  } catch (err) {
    logger.error({ err }, 'Codeforces stats error')
  }
  return stat
}
async function codeforcesStats(handle: string): Promise<PlatformStat> {
  return statsWithSharedMemo('codeforces', handle, () => _codeforcesStats(handle))
}

async function _codechefStats(handle: string): Promise<PlatformStat> {
  const stat: PlatformStat = { platform: 'codechef', handle, valid: false }
  const sanitized = sanitizeHandleStat(handle)
  if (!sanitized) return stat
  try {
    const resp = await fetch(`https://www.codechef.com/users/${encodeURIComponent(sanitized)}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!resp.ok) return stat
    const html = await resp.text()

    const num = (re: RegExp): number | null => {
      const m = html.match(re)
      return m ? parseInt(m[1].replace(/,/g, '')) : null
    }

    stat.valid = true
    stat.problemsSolved = num(/Total Problems Solved:\s*([\d,]+)/i)
    stat.rating = num(/rating-number[^>]*>\s*(\d+)/) ?? num(/"current_rating[^"]*"\s*:\s*"?(\d+)/)
    stat.stars = (() => {
      const m = html.match(/rating-star[\s\S]{0,300}?<\/div>/)
      if (!m) return null
      const starCount = (m[0].match(/&#9733;|★/g) || []).length
      return starCount || null
    })()
    stat.division = (() => {
      const m = html.match(/\(Div\s*(\d)\)/i)
      return m ? `Div ${m[1]}` : null
    })()
    stat.globalRank = num(/Global rank[^>]*>[^\d]*(\d+)/i) ?? num(/global_rank[^_][^"]*"?\s*:\s*"?(\d+)/)
    stat.countryRank = num(/Country rank[^>]*>[^\d]*(\d+)/i)
    stat.contestCount = num(/contest_participate\\?"?\s*:\s*(\d+)/)

    // Fallback rating from all_rating array
    if (!stat.rating) {
      const m = html.match(/var\s+all_rating\s*=\s*(\[[\s\S]*?\])\s*;/)
      if (m) {
        try {
          const hist = JSON.parse(m[1])
          if (hist.length) stat.rating = parseInt(hist[hist.length - 1].rating)
        } catch {}
      }
    }
  } catch (err) {
    logger.error({ err }, 'CodeChef stats error')
  }
  return stat
}
async function codechefStats(handle: string): Promise<PlatformStat> {
  return statsWithSharedMemo('codechef', handle, () => _codechefStats(handle))
}

async function _hackerrankStats(handle: string): Promise<PlatformStat> {
  const stat: PlatformStat = { platform: 'hackerrank', handle, valid: false }
  const sanitized = sanitizeHandleStat(handle)
  if (!sanitized) return stat
  try {
    const resp = await fetch(`https://www.hackerrank.com/profile/${encodeURIComponent(sanitized)}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!resp.ok) return stat
    const html = await resp.text()

    const match = html.match(/<script[^>]*id="initialUserData"[^>]*>([\s\S]*?)<\/script>/)
    if (!match) return stat

    const decoded = decodeURIComponent(match[1].trim())
    const userData = JSON.parse(decoded) as {
      scores?: Record<string, number>
      badges_count?: number
      contest_count?: number
    }

    stat.valid = true
    const scores = userData.scores || {}
    const totalScore = Object.values(scores).reduce((a, b) => a + b, 0)
    if (totalScore === 0 && !userData.badges_count) {
      stat.valid = false
      return stat
    }
    stat.problemsSolved = Object.keys(scores).length > 0
      ? Math.round(totalScore / 100)
      : null
    stat.score = totalScore || null
    stat.badges = userData.badges_count ?? null
    stat.contestCount = userData.contest_count ?? null
  } catch (err) {
    logger.error({ err }, 'HackerRank stats error')
  }
  return stat
}
async function hackerrankStats(handle: string): Promise<PlatformStat> {
  return statsWithSharedMemo('hackerrank', handle, () => _hackerrankStats(handle))
}

async function _gfgStats(handle: string): Promise<PlatformStat> {
  const stat: PlatformStat = { platform: 'gfg', handle, valid: false }
  const sanitized = sanitizeHandleStat(handle)
  if (!sanitized) return stat
  try {
    const resp = await fetch(`https://www.geeksforgeeks.org/user/${encodeURIComponent(sanitized)}/`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!resp.ok) return stat
    const html = await resp.text()

    const num = (name: string): number | null => {
      const re = new RegExp(`\\\\?"${name}\\\\?"\\s*:\\s*\\\\?"?(\\d+)`)
      const m = html.match(re)
      return m ? parseInt(m[1]) : null
    }

    const problems = num('total_problems_solved')
    const score = num('score')
    if (problems == null && score == null) return stat

    stat.valid = true
    stat.problemsSolved = problems
    stat.score = score
    stat.globalRank = num('over_all_rank') ?? num('overall_coding_score') != null ? num('over_all_rank') : null
    stat.countryRank = num('institute_rank')
  } catch (err) {
    logger.error({ err }, 'GFG stats error')
  }
  return stat
}
async function gfgStats(handle: string): Promise<PlatformStat> {
  return statsWithSharedMemo('gfg', handle, () => _gfgStats(handle))
}

export async function fetchAllPlatformStats(profile: {
  leetcodeHandle?: string | null
  codeforcesHandle?: string | null
  codechefHandle?: string | null
  hackerrankHandle?: string | null
  gfgHandle?: string | null
}): Promise<PlatformStat[]> {
  // OCP registry — new platform = one register() line (was 5 if-branches).
  const registry = new PlatformRegistry<PlatformStat>()
  registry.register({ profileKey: 'leetcodeHandle', code: 'leetcode', fetch: (h) => leetcodeStats(h) })
  registry.register({ profileKey: 'codeforcesHandle', code: 'codeforces', fetch: (h) => codeforcesStats(h) })
  registry.register({ profileKey: 'codechefHandle', code: 'codechef', fetch: (h) => codechefStats(h) })
  registry.register({ profileKey: 'hackerrankHandle', code: 'hackerrank', fetch: (h) => hackerrankStats(h) })
  registry.register({ profileKey: 'gfgHandle', code: 'gfg', fetch: (h) => gfgStats(h) })
  const jobs: Promise<PlatformStat>[] = registry
    .tasksFor(profile as Record<string, string | null | undefined>)
    .map((task) => task())

  const settled = await Promise.allSettled(jobs)
  return settled
    .filter((r): r is PromiseFulfilledResult<PlatformStat> => r.status === 'fulfilled')
    .map((r) => r.value)
}
