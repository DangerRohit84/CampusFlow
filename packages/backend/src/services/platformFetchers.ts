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

export async function fetchCodeforces(handle: string): Promise<PlatformContestResult[]> {
  const results: PlatformContestResult[] = []
  try {
    const ratingResp = await fetch(`https://codeforces.com/api/user.rating?handle=${handle}`)
    const ratingData = await ratingResp.json() as { status: string; result?: Array<{ contestId: number; rank: number; newRating: number; oldRating: number; contestName: string }> }
    if (ratingData.status !== 'OK') return results

    for (const entry of ratingData.result ?? []) {
      results.push({
        platform: 'codeforces',
        contestName: entry.contestName || `Codeforces Round #${entry.contestId}`,
        contestUrl: `https://codeforces.com/contest/${entry.contestId}`,
        rank: entry.rank,
        score: null,
        rating: entry.newRating,
        ratingChange: entry.newRating - entry.oldRating,
        participatedAt: null,
      })
    }
  } catch (err) {
    console.error('Codeforces fetch error:', err)
  }
  return results
}

export async function fetchLeetCode(handle: string): Promise<PlatformContestResult[]> {
  const results: PlatformContestResult[] = []
  try {
    const resp = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
        variables: { username: handle },
      }),
    })
    const data = await resp.json() as any
    const history = data?.data?.userContestRankingHistory || []

    for (const entry of history) {
      if (!entry.attended) continue
      results.push({
        platform: 'leetcode',
        contestName: entry.contest.title,
        contestUrl: `https://leetcode.com/contest/${entry.contest.titleSlug}`,
        rank: entry.ranking,
        score: null,
        rating: Math.round(entry.rating),
        ratingChange: null,
        participatedAt: new Date(entry.contest.startTime * 1000),
      })
    }
  } catch (err) {
    console.error('LeetCode fetch error:', err)
  }
  return results
}

export async function fetchCodeChef(handle: string): Promise<PlatformContestResult[]> {
  const results: PlatformContestResult[] = []
  try {
    const resp = await fetch(`https://www.codechef.com/users/${handle}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })
    if (!resp.ok) throw new Error(`CodeChef profile error: ${resp.status}`)
    const html = await resp.text()

    // Extract rating history from embedded JS: var all_rating = [...];
    const match = html.match(/var\s+all_rating\s*=\s*(\[[\s\S]*?\])\s*;/)
    if (!match) {
      console.warn(`CodeChef: no rating data found for ${handle}`)
      return results
    }

    const ratingHistory: Array<{
      code: string; getyear: string; getmonth: string; getday: string;
      rating: string; rank: string; name: string; end_date: string;
    }> = JSON.parse(match[1])

    // Build previous rating map for rating change calculation
    const prevRating = new Map<string, number>()
    for (let i = 1; i < ratingHistory.length; i++) {
      prevRating.set(ratingHistory[i].code, parseInt(ratingHistory[i - 1].rating))
    }

    for (const entry of ratingHistory) {
      const rating = parseInt(entry.rating)
      const oldRating = prevRating.get(entry.code) ?? rating
      const code = entry.code.replace(/D$/, '') // Strip trailing 'D' (DSA Monday suffix) for URL

      results.push({
        platform: 'codechef',
        contestName: entry.name || `CodeChef ${code}`,
        contestUrl: `https://www.codechef.com/${code}`,
        rank: parseInt(entry.rank) || null,
        score: null,
        rating,
        ratingChange: rating - oldRating,
        participatedAt: new Date(entry.end_date),
      })
    }
  } catch (err) {
    console.error('CodeChef fetch error:', err)
  }
  return results
}

export async function fetchHackerRank(handle: string): Promise<PlatformContestResult[]> {
  const results: PlatformContestResult[] = []
  try {
    const resp = await fetch(`https://www.hackerrank.com/${handle}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })
    if (!resp.ok) return results
    const html = await resp.text()

    // Extract JSON from <script id="initialUserData"> (URL-encoded)
    const match = html.match(/<script[^>]*id="initialUserData"[^>]*>([\s\S]*?)<\/script>/)
    if (!match) return results

    const decoded = decodeURIComponent(match[1].trim())
    const userData = JSON.parse(decoded) as {
      contestHistory?: { list?: Array<{
        contest?: { slug?: string; name?: string }
        rank?: number
        score?: number
        date?: string
      }> }
      scores?: Record<string, number>
    }

    const contestList = userData?.contestHistory?.list || []
    for (const c of contestList) {
      results.push({
        platform: 'hackerrank',
        contestName: c.contest?.name || c.contest?.slug || 'HackerRank Contest',
        contestUrl: c.contest?.slug ? `https://www.hackerrank.com/contests/${c.contest.slug}` : null,
        rank: c.rank || null,
        score: c.score || null,
        rating: null,
        ratingChange: null,
        participatedAt: c.date ? new Date(c.date) : null,
      })
    }

    // If no contest history, create a profile summary entry from scores
    if (results.length === 0 && userData?.scores && Object.keys(userData.scores).length > 0) {
      const totalScore = Object.values(userData.scores).reduce((a, b) => a + b, 0)
      results.push({
        platform: 'hackerrank',
        contestName: 'HackerRank Overall Profile',
        contestUrl: `https://www.hackerrank.com/${handle}`,
        rank: null,
        score: totalScore,
        rating: null,
        ratingChange: null,
        participatedAt: null,
      })
    }
  } catch (err) {
    console.error('HackerRank fetch error:', err)
  }
  return results
}

export async function fetchGFG(handle: string): Promise<PlatformContestResult[]> {
  const results: PlatformContestResult[] = []
  try {
    const resp = await fetch(`https://www.geeksforgeeks.org/user/${handle}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })
    if (!resp.ok) return results
    const html = await resp.text()

    // Extract from self.__next_f.push() chunks — look for score/total_problems_solved
    // Data may have escaped quotes (\"\") or regular quotes ("")
    const scoreMatch = html.match(/\\?"score\\?"\s*:\s*(\d+)/)
    const problemsMatch = html.match(/\\?"total_problems_solved\\?"\s*:\s*(\d+)/)

    if (scoreMatch || problemsMatch) {
      results.push({
        platform: 'gfg',
        contestName: 'GFG Overall Profile',
        contestUrl: `https://www.geeksforgeeks.org/user/${handle}`,
        rank: null,
        score: scoreMatch ? parseInt(scoreMatch[1]) : null,
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
