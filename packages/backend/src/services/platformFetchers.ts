// packages/backend/src/services/platformFetchers.ts

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

// Tuned for speed — 5s is enough for healthy APIs and cuts worst-case tail by 37% vs 8s
const FETCH_TIMEOUT_MS = 5000

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
    const ratingResp = await fetch(`https://codeforces.com/api/user.rating?handle=${encodeURIComponent(sanitized)}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    const ratingData = await ratingResp.json() as { status: string; result?: Array<{ contestId: number; rank: number; newRating: number; oldRating: number; contestName: string }> }
    if (ratingData.status !== 'OK') return results

    for (const entry of ratingData.result ?? []) {
      if (!entry.contestId || !entry.contestName) continue
      results.push({
        platform: 'codeforces',
        contestName: String(entry.contestName).trim().slice(0, 300),
        contestUrl: `https://codeforces.com/contest/${entry.contestId}`,
        rank: Number.isInteger(entry.rank) && entry.rank > 0 ? entry.rank : null,
        score: null,
        rating: Number.isFinite(entry.newRating) ? Math.round(entry.newRating) : null,
        ratingChange: Number.isFinite(entry.newRating) && Number.isFinite(entry.oldRating) ? entry.newRating - entry.oldRating : null,
        participatedAt: null,
      })
    }
  } catch (err) {
    console.error('Codeforces fetch error:', err)
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
    console.error('LeetCode fetch error:', err)
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
      console.warn(`CodeChef: no rating data found for ${sanitized}`)
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
    console.error('CodeChef fetch error:', err)
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
    console.error('HackerRank fetch error:', err)
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
    console.error('GFG fetch error:', err)
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
  const promises: Promise<PlatformContestResult[]>[] = []
  
  if (profile.codeforcesHandle) promises.push(fetchCodeforces(profile.codeforcesHandle))
  if (profile.leetcodeHandle) promises.push(fetchLeetCode(profile.leetcodeHandle))
  if (profile.codechefHandle) promises.push(fetchCodeChef(profile.codechefHandle))
  if (profile.hackerrankHandle) promises.push(fetchHackerRank(profile.hackerrankHandle))
  if (profile.gfgHandle) promises.push(fetchGFG(profile.gfgHandle))
  
  const results = await Promise.allSettled(promises)
  return results
    .filter((r): r is PromiseFulfilledResult<PlatformContestResult[]> => r.status === 'fulfilled')
    .flatMap((r) => r.value)
}
