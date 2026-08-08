// packages/backend/src/services/platformFetchers.ts

export interface PlatformContestResult {
  platform: string
  contestName: string
  contestUrl: string | null
  rank: number | null
  score: number | null
  rating: number | null
  ratingChange: number | null
  problemsSolved: number | null
  totalProblems: number | null
  participatedAt: Date | null
}

export async function fetchCodeforces(handle: string): Promise<PlatformContestResult[]> {
  const results: PlatformContestResult[] = []
  try {
    // Get user info for rating history
    const infoResp = await fetch(`https://codeforces.com/api/user.info?handles=${handle}`)
    const infoData = await infoResp.json() as { status: string; result?: unknown[] }
    if (infoData.status !== 'OK') return results

    // Get contest history
    const statusResp = await fetch(`https://codeforces.com/api/user.status?handle=${handle}&from=1&count=10000`)
    const statusData = await statusResp.json() as { status: string; result?: Array<{ contestId?: number; problem: { index: string } }> }
    if (statusData.status !== 'OK') return results

    // Group submissions by contest
    const contestMap = new Map<number, { name: string; url: string; problems: Set<string>; rank?: number; rating?: number }>()
    
    for (const submission of statusData.result ?? []) {
      if (!submission.contestId) continue
      const contestId = submission.contestId
      if (!contestMap.has(contestId)) {
        contestMap.set(contestId, {
          name: `Codeforces Round #${contestId}`,
          url: `https://codeforces.com/contest/${contestId}`,
          problems: new Set(),
        })
      }
      const contest = contestMap.get(contestId)!
      contest.problems.add(submission.problem.index)
    }

    // Get rating changes for rank/rating info
    const ratingResp = await fetch(`https://codeforces.com/api/user.rating?handle=${handle}`)
    const ratingData = await ratingResp.json() as { status: string; result?: Array<{ contestId: number; rank: number; newRating: number; oldRating: number }> }
    
    const ratingMap = new Map<number, { rank: number; rating: number; ratingChange: number }>()
    if (ratingData.status === 'OK') {
      for (const entry of ratingData.result ?? []) {
        ratingMap.set(entry.contestId, {
          rank: entry.rank,
          rating: entry.newRating,
          ratingChange: entry.newRating - entry.oldRating,
        })
      }
    }

    for (const [contestId, data] of contestMap) {
      const ratingInfo = ratingMap.get(contestId)
      results.push({
        platform: 'codeforces',
        contestName: data.name,
        contestUrl: data.url,
        rank: ratingInfo?.rank ?? null,
        score: data.problems.size,
        rating: ratingInfo?.rating ?? null,
        ratingChange: ratingInfo?.ratingChange ?? null,
        problemsSolved: data.problems.size,
        totalProblems: null,
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
        query: `
          query contestHistory($username: String!) {
            allContests {
              title
              titleSlug
              startTime
            }
            matchedUser(username: $username) {
              contestHistory {
                attended
                totalProblems
                trendingDirection
                finishTimeInSeconds
                rating
                ranking
                contest {
                  title
                  titleSlug
                  startTime
                }
              }
            }
          }
        `,
        variables: { username: handle },
      }),
    })
    const data = await resp.json() as { data?: { matchedUser?: { contestHistory?: Array<{
      attended: boolean
      totalProblems: number
      rating: number
      ranking: number
      contest: { title: string; titleSlug: string; startTime: number }
    }> } } }
    const history = data?.data?.matchedUser?.contestHistory || []
    
    for (const entry of history) {
      if (!entry.attended) continue
      results.push({
        platform: 'leetcode',
        contestName: entry.contest.title,
        contestUrl: `https://leetcode.com/contests/${entry.contest.titleSlug}`,
        rank: entry.ranking,
        score: entry.totalProblems,
        rating: Math.round(entry.rating),
        ratingChange: null,
        problemsSolved: entry.totalProblems,
        totalProblems: null,
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
    const resp = await fetch(`https://contest-hive.vercel.app/api/codechef/${handle}`)
    const data = await resp.json() as { contests?: any[]; ratingData?: any[] }
    const contests = data.contests || data.ratingData || []
    
    for (const c of contests) {
      results.push({
        platform: 'codechef',
        contestName: c.name || c.contestName || 'CodeChef Contest',
        contestUrl: c.url || null,
        rank: c.rank || c.place || null,
        score: c.score || null,
        rating: c.rating || c.newRating || null,
        ratingChange: c.ratingChange || (c.newRating && c.oldRating ? c.newRating - c.oldRating : null),
        problemsSolved: c.problemsSolved || null,
        totalProblems: null,
        participatedAt: c.date ? new Date(c.date) : null,
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
    const resp = await fetch(`https://www.hackerrank.com/rest/contests/by/${handle}/hackos_score`)
    if (!resp.ok) return results
    const data = await resp.json() as { models?: any[] }
    
    for (const c of data.models || []) {
      results.push({
        platform: 'hackerrank',
        contestName: c.name || 'HackerRank Contest',
        contestUrl: c.url ? `https://www.hackerrank.com${c.url}` : null,
        rank: c.rank || null,
        score: c.score || null,
        rating: null,
        ratingChange: null,
        problemsSolved: c.total || null,
        totalProblems: null,
        participatedAt: c.created_at ? new Date(c.created_at) : null,
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
    const resp = await fetch(`https://www.geeksforgeeks.org/user/${handle}`)
    if (!resp.ok) return results
    const html = await resp.text()
    
    // Extract coding score and problems from profile
    const scoreMatch = html.match(/Coding Score:\s*(\d+)/)
    const problemsMatch = html.match(/Problem[s] Solved:\s*(\d+)/)
    
    if (scoreMatch || problemsMatch) {
      results.push({
        platform: 'gfg',
        contestName: 'GFG Overall Profile',
        contestUrl: `https://www.geeksforgeeks.org/user/${handle}`,
        rank: null,
        score: scoreMatch ? parseInt(scoreMatch[1]) : null,
        rating: null,
        ratingChange: null,
        problemsSolved: problemsMatch ? parseInt(problemsMatch[1]) : null,
        totalProblems: null,
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
