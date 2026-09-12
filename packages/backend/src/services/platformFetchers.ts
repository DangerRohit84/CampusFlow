// packages/backend/src/services/platformFetchers.ts
// Track 4: PlatformContestResult stays here for compat; OCP registry lives in
// ./platforms/registry.ts. fetchAllPlatforms now delegates to the registry
// (new platform = one registration line, zero orchestrator edits).

import { PlatformRegistry } from './platforms/registry'
import { fetchCodeforcesJson } from './codeforcesGate'
import { logger } from '../utils/logger'

export interface PlatformContestResult {
  platform: string
  contestName: string
  contestUrl: string | null
  rank: number | null
  score: number | null
  rating: number | null
  ratingChange: number | null
  participatedAt: Date | null
}

// 10k scale: 10s per-fetch timeout (spec) + p-limit 5 concurrency.
// 10s covers cold Codeforces/LeetCode tails; longer would hold sync workers
// under burst. Concurrency is bounded via pLimit(5) in fetchAllPlatforms
// so 5 platform fetches overlap without bursting DB/socket pools.
export const FETCH_TIMEOUT_MS = 10_000
export const FETCH_CONCURRENCY = 5

/** Minimal p-limit (no new dep): run tasks with max `concurrency` in flight. */
export async function pLimit<T>(concurrency: number, tasks: Array<() => Promise<T>>): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length)
  let next = 0
  async function worker(): Promise<void> {
    while (true) {
      const i = next++
      if (i >= tasks.length) return
      try {
        const v = await tasks[i]()
        results[i] = { status: 'fulfilled', value: v } as PromiseFulfilledResult<T>
      } catch (e) {
        results[i] = { status: 'rejected', reason: e } as PromiseRejectedResult
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker())
  await Promise.all(workers)
  return results
}

// Per-process coalescing cache: avoid refetching same handle within TTL and
// de-duplicate concurrent in-flight requests for the same handle (helps syncAllUsers batch)
const fetchInflight = new Map<string, { promise: Promise<PlatformContestResult[]>; expiry: number }>()
const CACHE_TTL_MS = 60_000
function cacheKey(platform: string, handle: string): string {
  return `${platform}:${String(handle || '').trim().toLowerCase()}`
}
function getCached(platform: string, handle: string): Promise<PlatformContestResult[]> | null {
  const k = cacheKey(platform, handle)
  const e = fetchInflight.get(k)
  if (e && Date.now() < e.expiry) return e.promise
  if (e) fetchInflight.delete(k)
  return null
}
function setCached(platform: string, handle: string, promise: Promise<PlatformContestResult[]>): void {
  const k = cacheKey(platform, handle)
  fetchInflight.set(k, { promise, expiry: Date.now() + CACHE_TTL_MS })
  promise.finally(() => {
    setTimeout(() => {
      const cur = fetchInflight.get(k)
      if (cur && cur.promise === promise && Date.now() >= cur.expiry) fetchInflight.delete(k)
    }, CACHE_TTL_MS).unref?.()
  })
}

async function _fetchCodeforces(handle: string): Promise<PlatformContestResult[]> {
  const results: PlatformContestResult[] = []
  const sanitized = String(handle || '').trim()
  if (!sanitized || sanitized.length > 50 || !/^[a-zA-Z0-9._-]+$/.test(sanitized)) return results
  try {
    // Upgrade 1: shared 2s gate + 1 jittered retry (honors Retry-After/429).
    // Other platforms bypass the gate (no slowdown).
    const { data: ratingData, stillRateLimited } = await fetchCodeforcesJson<{
      status: string
      comment?: string
      result?: Array<{ contestId: number; rank: number; newRating: number; oldRating: number; contestName: string; ratingUpdateTimeSeconds?: number }>
    }>(`https://codeforces.com/api/user.rating?handle=${encodeURIComponent(sanitized)}`, { timeoutMs: FETCH_TIMEOUT_MS })
    if (stillRateLimited) {
      logger.warn(`[codeforces] rate limit persisted after 1 retry for ${sanitized} (skipping, no further retry)`)
      return results
    }
    if (!ratingData || ratingData.status !== 'OK') return results

    for (const entry of ratingData.result ?? []) {
      if (!entry.contestId || !entry.contestName) continue
      // ratingUpdateTimeSeconds is the contest end instant (CF API). Prior code
      // dropped it (participatedAt: null) → all CF rows had null dates →
      // bucketParticipationsByDay skipped everything → streak 0/0 + empty
      // heatmap despite 35-row history (danger_rohit84 repro). Map to Date
      // when finite+positive, else null (preserves prior null contract).
      const ts = (entry as any).ratingUpdateTimeSeconds
      const participatedAt =
        typeof ts === 'number' && Number.isFinite(ts) && ts > 0
          ? new Date(ts * 1000)
          : null
      results.push({
        platform: 'codeforces',
        contestName: String(entry.contestName).trim().slice(0, 300),
        contestUrl: `https://codeforces.com/contest/${entry.contestId}`,
        rank: Number.isInteger(entry.rank) && entry.rank > 0 ? entry.rank : null,
        score: null,
        rating: Number.isFinite(entry.newRating) ? Math.round(entry.newRating) : null,
        ratingChange: Number.isFinite(entry.newRating) && Number.isFinite(entry.oldRating) ? entry.newRating - entry.oldRating : null,
        participatedAt,
      })
    }
  } catch (err) {
    logger.error({ err }, 'Codeforces fetch error')
  }
  return results
}
export async function fetchCodeforces(handle: string): Promise<PlatformContestResult[]> {
  const cached = getCached('codeforces', handle)
  if (cached) return cached
  const p = _fetchCodeforces(handle)
  setCached('codeforces', handle, p)
  return p
}

async function _fetchLeetCode(handle: string): Promise<PlatformContestResult[]> {
  const results: PlatformContestResult[] = []
  const sanitized = String(handle || '').trim()
  if (!sanitized || sanitized.length > 50 || !/^[a-zA-Z0-9._-]+$/.test(sanitized)) return results
  try {
    const resp = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'CampusFlow/1.0' },
      body: JSON.stringify({
        query: `query userContestRankingHistory($username: String!) {
          userContestRankingHistory(username: $username) {
            attended
            trendDirection
            rating
            ranking
            contest {
              title
              titleSlug
              startTime
            }
          }
        }`,
        variables: { username: sanitized },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!resp.ok) return results
    const data = await resp.json() as any
    const history = data?.data?.userContestRankingHistory || []

    for (const entry of history) {
      if (!entry.attended) continue
      if (!entry.contest?.title || !entry.contest?.titleSlug || !entry.contest?.startTime) continue
      const startMs = Number(entry.contest.startTime) * 1000
      if (!Number.isFinite(startMs) || startMs <= 0) continue
      results.push({
        platform: 'leetcode',
        contestName: String(entry.contest.title).trim().slice(0, 300),
        contestUrl: `https://leetcode.com/contest/${entry.contest.titleSlug}`,
        rank: Number.isInteger(entry.ranking) && entry.ranking > 0 ? entry.ranking : null,
        score: null,
        rating: Number.isFinite(entry.rating) ? Math.round(entry.rating) : null,
        ratingChange: null,
        participatedAt: new Date(startMs),
      })
    }
  } catch (err) {
    logger.error({ err }, 'LeetCode fetch error')
  }
  return results
}
export async function fetchLeetCode(handle: string): Promise<PlatformContestResult[]> {
  const cached = getCached('leetcode', handle)
  if (cached) return cached
  const p = _fetchLeetCode(handle)
  setCached('leetcode', handle, p)
  return p
}

async function _fetchCodeChef(handle: string): Promise<PlatformContestResult[]> {
  const results: PlatformContestResult[] = []
  const sanitized = String(handle || '').trim()
  if (!sanitized || sanitized.length > 50 || !/^[a-zA-Z0-9._-]+$/.test(sanitized)) return results
  try {
    const resp = await fetch(`https://www.codechef.com/users/${encodeURIComponent(sanitized)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!resp.ok) throw new Error(`CodeChef profile error: ${resp.status}`)
    const html = await resp.text()

    // Extract rating history from embedded JS: var all_rating = [...];
    const match = html.match(/var\s+all_rating\s*=\s*(\[[\s\S]*?\])\s*;/)
    if (!match) {
      logger.warn(`CodeChef: no rating data found for ${sanitized}`)
      return results
    }

    let ratingHistory: Array<{
      code: string; getyear: string; getmonth: string; getday: string;
      rating: string; rank: string; name: string; end_date: string;
    }>
    try { ratingHistory = JSON.parse(match[1]) } catch { return results }
    if (!Array.isArray(ratingHistory)) return results

    // Build previous rating map for rating change calculation
    const prevRating = new Map<string, number>()
    for (let i = 1; i < ratingHistory.length; i++) {
      const prev = parseInt(ratingHistory[i - 1].rating)
      if (Number.isFinite(prev)) prevRating.set(ratingHistory[i].code, prev)
    }

    for (const entry of ratingHistory) {
      const rating = parseInt(entry.rating)
      if (!Number.isFinite(rating)) continue
      const oldRating = prevRating.get(entry.code) ?? rating
      const code = String(entry.code || '').replace(/D$/, '') // Strip trailing 'D' (DSA Monday suffix) for URL
      if (!code) continue
      const rankNum = parseInt(entry.rank)
      const endDate = entry.end_date ? new Date(entry.end_date) : null
      results.push({
        platform: 'codechef',
        contestName: String(entry.name || `CodeChef ${code}`).trim().slice(0, 300),
        contestUrl: `https://www.codechef.com/${code}`,
        rank: Number.isFinite(rankNum) && rankNum > 0 ? rankNum : null,
        score: null,
        rating,
        ratingChange: rating - oldRating,
        participatedAt: endDate && !isNaN(endDate.getTime()) ? endDate : null,
      })
    }
  } catch (err) {
    logger.error({ err }, 'CodeChef fetch error')
  }
  return results
}
export async function fetchCodeChef(handle: string): Promise<PlatformContestResult[]> {
  const cached = getCached('codechef', handle)
  if (cached) return cached
  const p = _fetchCodeChef(handle)
  setCached('codechef', handle, p)
  return p
}

async function _fetchHackerRank(handle: string): Promise<PlatformContestResult[]> {
  const results: PlatformContestResult[] = []
  const sanitized = String(handle || '').trim()
  if (!sanitized || sanitized.length > 50 || !/^[a-zA-Z0-9._-]+$/.test(sanitized)) return results
  try {
    const resp = await fetch(`https://www.hackerrank.com/${encodeURIComponent(sanitized)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!resp.ok) return results
    const html = await resp.text()

    // Extract JSON from <script id="initialUserData"> (URL-encoded)
    const match = html.match(/<script[^>]*id="initialUserData"[^>]*>([\s\S]*?)<\/script>/)
    if (!match) return results

    let userData: any
    try {
      const decoded = decodeURIComponent(match[1].trim())
      userData = JSON.parse(decoded) as {
        contestHistory?: { list?: Array<{
          contest?: { slug?: string; name?: string }
          rank?: number
          score?: number
          date?: string
        }> }
        scores?: Record<string, number>
      }
    } catch { return results }

    const contestList = userData?.contestHistory?.list || []
    for (const c of contestList) {
      const slug = c.contest?.slug ? String(c.contest.slug).trim() : null
      results.push({
        platform: 'hackerrank',
        contestName: String(c.contest?.name || slug || 'HackerRank Contest').trim().slice(0, 300),
        contestUrl: slug ? `https://www.hackerrank.com/contests/${slug}` : null,
        rank: Number.isInteger(c.rank) && (c.rank as number) > 0 ? c.rank : null,
        score: typeof c.score === 'number' && Number.isFinite(c.score) ? c.score : null,
        rating: null,
        ratingChange: null,
        participatedAt: c.date ? new Date(c.date) : null,
      })
    }

    // If no contest history, create a profile summary entry from scores
    if (results.length === 0 && userData?.scores && Object.keys(userData.scores).length > 0) {
      const vals = Object.values(userData.scores).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      const totalScore = vals.reduce((a, b) => a + b, 0)
      if (totalScore > 0) {
        results.push({
          platform: 'hackerrank',
          contestName: 'HackerRank Overall Profile',
          contestUrl: `https://www.hackerrank.com/${encodeURIComponent(sanitized)}`,
          rank: null,
          score: totalScore,
          rating: null,
          ratingChange: null,
          participatedAt: null,
        })
      }
    }
  } catch (err) {
    logger.error({ err }, 'HackerRank fetch error')
  }
  return results
}
export async function fetchHackerRank(handle: string): Promise<PlatformContestResult[]> {
  const cached = getCached('hackerrank', handle)
  if (cached) return cached
  const p = _fetchHackerRank(handle)
  setCached('hackerrank', handle, p)
  return p
}

async function _fetchGFG(handle: string): Promise<PlatformContestResult[]> {
  const results: PlatformContestResult[] = []
  const sanitized = String(handle || '').trim()
  if (!sanitized || sanitized.length > 50 || !/^[a-zA-Z0-9._-]+$/.test(sanitized)) return results
  try {
    const resp = await fetch(`https://www.geeksforgeeks.org/user/${encodeURIComponent(sanitized)}/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!resp.ok) return results
    const html = await resp.text()

    // Extract from self.__next_f.push() chunks — look for score/total_problems_solved
    // Data may have escaped quotes (\"\") or regular quotes ("")
    const scoreMatch = html.match(/\\?"score\\?"\s*:\s*(\d+)/)
    const problemsMatch = html.match(/\\?"total_problems_solved\\?"\s*:\s*(\d+)/)

    if (scoreMatch || problemsMatch) {
      const scoreVal = scoreMatch ? parseInt(scoreMatch[1], 10) : null
      results.push({
        platform: 'gfg',
        contestName: 'GFG Overall Profile',
        contestUrl: `https://www.geeksforgeeks.org/user/${encodeURIComponent(sanitized)}/`,
        rank: null,
        score: Number.isFinite(scoreVal as number) ? scoreVal : null,
        rating: null,
        ratingChange: null,
        participatedAt: null,
      })
    }
  } catch (err) {
    logger.error({ err }, 'GFG fetch error')
  }
  return results
}
export async function fetchGFG(handle: string): Promise<PlatformContestResult[]> {
  const cached = getCached('gfg', handle)
  if (cached) return cached
  const p = _fetchGFG(handle)
  setCached('gfg', handle, p)
  return p
}

export async function fetchAllPlatforms(profile: {
  leetcodeHandle?: string | null
  codeforcesHandle?: string | null
  codechefHandle?: string | null
  hackerrankHandle?: string | null
  gfgHandle?: string | null
}): Promise<PlatformContestResult[]> {
  // OCP Strategy registry: adding a platform registers one entry below.
  // Behavior identical to the previous if-chain (lazy tasks + pLimit 5).
  const registry = new PlatformRegistry<PlatformContestResult[]>()
  registry.register({ profileKey: 'codeforcesHandle', code: 'codeforces', fetch: (h) => fetchCodeforces(h) })
  registry.register({ profileKey: 'leetcodeHandle', code: 'leetcode', fetch: (h) => fetchLeetCode(h) })
  registry.register({ profileKey: 'codechefHandle', code: 'codechef', fetch: (h) => fetchCodeChef(h) })
  registry.register({ profileKey: 'hackerrankHandle', code: 'hackerrank', fetch: (h) => fetchHackerRank(h) })
  registry.register({ profileKey: 'gfgHandle', code: 'gfg', fetch: (h) => fetchGFG(h) })
  const tasks = registry.tasksFor(profile as Record<string, string | null | undefined>)

  // Bounded concurrency (p-limit 5): same parallelism for typical ≤5 tasks,
  // bounded tail when handles fan out. Each fetch already has 10s timeout.
  const results = await pLimit(FETCH_CONCURRENCY, tasks)
  const failed = results.filter((r) => r.status === 'rejected').length
  if (failed > 0) logger.debug({ failed }, '[platforms] isolated fetch failures (non-critical)')
  return results
    .filter((r): r is PromiseFulfilledResult<PlatformContestResult[]> => r.status === 'fulfilled')
    .flatMap((r) => r.value)
}

export { PlatformRegistry }
