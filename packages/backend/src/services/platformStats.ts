// packages/backend/src/services/platformStats.ts
export interface PlatformStat {
  platform: string
  handle: string
  valid: boolean
  problemsSolved?: number | null
  easySolved?: number | null
  mediumSolved?: number | null
  hardSolved?: number | null
  totalProblems?: number | null
  rating?: number | null
  maxRating?: number | null
  rankTitle?: string | null
  maxRankTitle?: string | null
  globalRank?: number | null
  countryRank?: number | null
  stars?: number | null
  division?: string | null
  score?: number | null
  badges?: number | null
  contestCount?: number | null
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function leetcodeStats(handle: string): Promise<PlatformStat> {
  const stat: PlatformStat = { platform: 'leetcode', handle, valid: false }
  try {
    const resp = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Referer: 'https://leetcode.com' },
      body: JSON.stringify({
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
        variables: { username: handle },
      }),
    })
    const data: any = await resp.json()
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
  } catch (err) {
    console.error('LeetCode stats error:', err)
  }
  return stat
}

async function codeforcesStats(handle: string): Promise<PlatformStat> {
  const stat: PlatformStat = { platform: 'codeforces', handle, valid: false }
  try {
    const infoResp = await fetch(`https://codeforces.com/api/user.info?handles=${encodeURIComponent(handle)}&checkHistoricHandles=false&lang=en`)
    const infoData: any = await infoResp.json()
    if (infoData.status !== 'OK' || !infoData.result?.length) return stat
    const u = infoData.result[0]

    stat.valid = true
    stat.rating = u.rating ?? null
    stat.maxRating = u.maxRating ?? null
    stat.rankTitle = u.rank ? String(u.rank).replace(/^\w/, (c: string) => c.toUpperCase()) : null
    stat.maxRankTitle = u.maxRank ? String(u.maxRank).replace(/^\w/, (c: string) => c.toUpperCase()) : null
    stat.globalRank = u.rank != null && u.maxRating != null ? null : null

    // Count unique solved problems via user.status
    const statusResp = await fetch(`https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}&from=1&count=10000`)
    const statusData: any = await statusResp.json()
    if (statusData.status === 'OK') {
      const solved = new Set<string>()
      let contests = new Set<number>()
      for (const sub of statusData.result || []) {
        if (sub.verdict === 'OK') {
          solved.add(`${sub.problem.contestId}-${sub.problem.index}`)
          if (sub.contestId) contests.add(sub.contestId)
        }
      }
      stat.problemsSolved = solved.size
      stat.contestCount = contests.size
    }
  } catch (err) {
    console.error('Codeforces stats error:', err)
  }
  return stat
}

async function codechefStats(handle: string): Promise<PlatformStat> {
  const stat: PlatformStat = { platform: 'codechef', handle, valid: false }
  try {
    const resp = await fetch(`https://www.codechef.com/users/${handle}`, { headers: { 'User-Agent': UA } })
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
    console.error('CodeChef stats error:', err)
  }
  return stat
}

async function hackerrankStats(handle: string): Promise<PlatformStat> {
  const stat: PlatformStat = { platform: 'hackerrank', handle, valid: false }
  try {
    const resp = await fetch(`https://www.hackerrank.com/profile/${handle}`, { headers: { 'User-Agent': UA } })
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
    console.error('HackerRank stats error:', err)
  }
  return stat
}

async function gfgStats(handle: string): Promise<PlatformStat> {
  const stat: PlatformStat = { platform: 'gfg', handle, valid: false }
  try {
    const resp = await fetch(`https://www.geeksforgeeks.org/user/${handle}/`, { headers: { 'User-Agent': UA } })
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
    console.error('GFG stats error:', err)
  }
  return stat
}

export async function fetchAllPlatformStats(profile: {
  leetcodeHandle?: string | null
  codeforcesHandle?: string | null
  codechefHandle?: string | null
  hackerrankHandle?: string | null
  gfgHandle?: string | null
}): Promise<PlatformStat[]> {
  const jobs: Promise<PlatformStat>[] = []
  if (profile.leetcodeHandle) jobs.push(leetcodeStats(profile.leetcodeHandle))
  if (profile.codeforcesHandle) jobs.push(codeforcesStats(profile.codeforcesHandle))
  if (profile.codechefHandle) jobs.push(codechefStats(profile.codechefHandle))
  if (profile.hackerrankHandle) jobs.push(hackerrankStats(profile.hackerrankHandle))
  if (profile.gfgHandle) jobs.push(gfgStats(profile.gfgHandle))

  const settled = await Promise.allSettled(jobs)
  return settled
    .filter((r): r is PromiseFulfilledResult<PlatformStat> => r.status === 'fulfilled')
    .map((r) => r.value)
}
