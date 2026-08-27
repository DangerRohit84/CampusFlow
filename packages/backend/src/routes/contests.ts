import { Router, Response } from 'express'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'

const router = Router()
router.use(authenticate)

const PLATFORMS = ['CODEFORCES', 'CODECHEF', 'LEETCODE', 'ATCODER', 'HACKERRANK', 'OTHER']

// Create coding contest (Teacher/Admin)
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can create contests' })
      return
    }

    const { title, platform, url, startTime, duration, contestType, status, solutions, collegeId } = req.body

    if (!title || !platform || !url || !startTime) {
      res.status(400).json({ error: 'title, platform, url, and startTime are required' })
      return
    }

    const contest = await prisma.codingContest.create({
      data: {
        title,
        platform,
        url,
        startTime,
        duration: duration ? parseInt(String(duration)) : null,
        contestType: contestType || null,
        status: status || 'UPCOMING',
        solutions: JSON.stringify(solutions || []),
        isAutoFetched: false,
        creatorId: req.userId!,
        collegeId: collegeId || user.collegeId,
      },
    })

    res.status(201).json(contest)
  } catch (error) {
    console.error('Create contest error:', error)
    res.status(500).json({ error: 'Failed to create contest' })
  }
})

// Get all coding contests (filtered by role)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const { status, platform } = req.query

    let where: any = {}

    if (user.role === 'SUPER_ADMIN') {
      // Super admin sees all
    } else if (user.role === 'COLLEGE_ADMIN') {
      where.OR = [{ collegeId: user.collegeId }, { collegeId: null }]
    } else if (user.role === 'TEACHER') {
      where.OR = [
        { creatorId: req.userId },
        { collegeId: user.collegeId },
        { collegeId: null },
      ]
    } else {
      // Students see contests from their college or global (null collegeId)
      where.OR = [{ collegeId: user.collegeId }, { collegeId: null }]
    }

    if (status && typeof status === 'string') {
      where.status = status
    }
    if (platform && typeof platform === 'string') {
      where.platform = platform
    }

    const contests = await prisma.codingContest.findMany({
      where,
      include: { creator: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    })

    // Sort by actual contest time (startTime is stored as a string)
    const ts = (s: string) => {
      const t = Date.parse(s)
      return isNaN(t) ? 0 : t
    }
    if (status === 'ENDED') {
      // Recently completed first
      contests.sort((a, b) => ts(b.startTime) - ts(a.startTime))
    } else if (status === 'UPCOMING') {
      // Soonest upcoming first
      contests.sort((a, b) => ts(a.startTime) - ts(b.startTime))
    }

    res.json(contests)
  } catch (error) {
    console.error('Get contests error:', error)
    res.status(500).json({ error: 'Failed to fetch contests' })
  }
})

// Get contests for calendar view (filtered by date range)
router.get('/calendar', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const { start, end } = req.query

    if (!start || !end) {
      res.status(400).json({ error: 'start and end query params are required' })
      return
    }

    let where: any = {}

    // Filter by college based on role
    if (user.role === 'SUPER_ADMIN') {
      // Super admin sees all
    } else if (user.collegeId) {
      where.OR = [{ collegeId: user.collegeId }, { collegeId: null }]
    }

    // Filter by date range
    where.startTime = {
      gte: start as string,
      lte: end as string,
    }

    const contests = await prisma.codingContest.findMany({
      where,
      include: {
        creator: { select: { name: true, email: true } },
      },
      orderBy: { startTime: 'asc' },
    })

    // Add registrations count (number of solutions as a proxy)
    const contestsWithCounts = contests.map((contest) => {
      let solutionsCount = 0
      try {
        const solutions = JSON.parse(contest.solutions || '[]')
        solutionsCount = solutions.length
      } catch {
        // ignore
      }
      return {
        ...contest,
        solutionsCount,
      }
    })

    res.json(contestsWithCounts)
  } catch (error) {
    console.error('Get calendar contests error:', error)
    res.status(500).json({ error: 'Failed to fetch calendar contests' })
  }
})

// Get contests by date (stub - returns empty for now)
router.get('/by-date/:date', async (req: AuthRequest, res: Response) => {
  try {
    const _user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!_user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    // Stub: return empty array
    res.json([])
  } catch (error) {
    console.error('Get contests by date error:', error)
    res.status(500).json({ error: 'Failed to fetch contests by date' })
  }
})

// Participant count per ENDED contest (bulk, fuzzy-matched same as per-contest endpoint)
router.get('/participant-counts', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const [contests, participations] = await Promise.all([
      prisma.codingContest.findMany({
        where: { status: 'ENDED' },
        select: { id: true, title: true, url: true, platform: true },
      }),
      prisma.contestParticipation.findMany({
        select: { platform: true, contestName: true, contestUrl: true },
      }),
    ])

    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
    const normUrl = (u: string) => u.replace(/\/+$/, '').toLowerCase()

    const byPlatform = new Map<string, { n: string; u: string | null }[]>()
    for (const p of participations) {
      const key = (p.platform || '').toLowerCase()
      if (!byPlatform.has(key)) byPlatform.set(key, [])
      byPlatform.get(key)!.push({ n: normalize(p.contestName), u: p.contestUrl ? normUrl(p.contestUrl) : null })
    }

    const counts: Record<string, number> = {}
    for (const c of contests) {
      const list = byPlatform.get(c.platform.toLowerCase()) || []
      const ct = normalize(c.title)
      const cu = normUrl(c.url)
      counts[c.id] = list.filter(
        (p) => p.n === ct || p.n.includes(ct) || ct.includes(p.n) || (!!p.u && p.u === cu)
      ).length
    }
    res.json(counts)
  } catch (error) {
    console.error('Participant counts error:', error)
    res.status(500).json({ error: 'Failed to compute participant counts' })
  }
})

// Get single coding contest
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const contest = await prisma.codingContest.findUnique({
      where: { id: req.params.id as string },
      include: { creator: { select: { name: true, email: true, role: true } } },
    })

    if (!contest) {
      res.status(404).json({ error: 'Contest not found' })
      return
    }

    res.json(contest)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch contest' })
  }
})

// Update coding contest
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const existing = await prisma.codingContest.findUnique({ where: { id: req.params.id as string } })
    if (!existing) {
      res.status(404).json({ error: 'Contest not found' })
      return
    }

    const isOwner = existing.creatorId === req.userId
    const isAdmin = user.role === 'COLLEGE_ADMIN' || user.role === 'SUPER_ADMIN'

    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: 'You do not have permission to edit this contest' })
      return
    }

    const { title, platform, url, startTime, duration, contestType, status, solutions } = req.body

    const updated = await prisma.codingContest.update({
      where: { id: req.params.id as string },
      data: {
        ...(title !== undefined && { title }),
        ...(platform !== undefined && { platform }),
        ...(url !== undefined && { url }),
        ...(startTime !== undefined && { startTime }),
        ...(duration !== undefined && { duration: duration ? parseInt(String(duration)) : null }),
        ...(contestType !== undefined && { contestType }),
        ...(status !== undefined && { status }),
        ...(solutions !== undefined && { solutions: JSON.stringify(solutions) }),
      },
    })

    res.json(updated)
  } catch (error) {
    console.error('Update contest error:', error)
    res.status(500).json({ error: 'Failed to update contest' })
  }
})

// Bulk replace solutions for a contest
router.put('/:id/solutions', async (req: AuthRequest, res: Response) => {
  try {
    const contest = await prisma.codingContest.findUnique({ where: { id: req.params.id as string } })
    if (!contest) {
      res.status(404).json({ error: 'Contest not found' })
      return
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    const isOwner = contest.creatorId === req.userId
    const isAdmin = user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'
    const isTeacher = user?.role === 'TEACHER'

    if (!isOwner && !isAdmin && !isTeacher) {
      res.status(403).json({ error: 'Only teachers can update solutions' })
      return
    }

    const { solutions } = req.body

    if (!Array.isArray(solutions)) {
      res.status(400).json({ error: 'solutions must be an array' })
      return
    }

    const updated = await prisma.codingContest.update({
      where: { id: req.params.id as string },
      data: { solutions: JSON.stringify(solutions) },
    })

    res.json(updated)
  } catch (error) {
    console.error('Bulk replace solutions error:', error)
    res.status(500).json({ error: 'Failed to replace solutions' })
  }
})

// Delete coding contest
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const contest = await prisma.codingContest.findUnique({ where: { id: req.params.id as string } })
    if (!contest) {
      res.status(404).json({ error: 'Contest not found' })
      return
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    const isOwner = contest.creatorId === req.userId
    const isAdmin = user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'

    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: 'You do not have permission to delete this contest' })
      return
    }

    await prisma.codingContest.delete({ where: { id: req.params.id as string } })
    res.json({ message: 'Contest deleted' })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete contest' })
  }
})

// Add solution to a contest
// Extract YouTube video id from any common URL form
function extractYouTubeId(urlStr: string): string | null {
  try {
    const u = new URL(urlStr)
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0] || null
    if (u.searchParams.get('v')) return u.searchParams.get('v')
    const m = u.pathname.match(/\/(shorts|embed|live)\/([\w-]{6,})/)
    if (m) return m[2]
  } catch { /* not a URL */ }
  return null
}

// Best-effort metadata fetch for a YouTube link (no API key needed).
// Returns { title?, thumbnail, duration? } — duration in seconds.
async function fetchYouTubeMeta(urlStr: string): Promise<{ title?: string; thumbnail?: string; duration?: number }> {
  const videoId = extractYouTubeId(urlStr)
  const meta: { title?: string; thumbnail?: string; duration?: number } = {}
  if (!videoId) return meta

  meta.thumbnail = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
  try {
    const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(6000),
    })
    if (resp.ok) {
      const html = await resp.text()
      const len = html.match(/"lengthSeconds":"(\d+)"/)
      if (len) meta.duration = parseInt(len[1])
      const title = html.match(/<meta name="title" content="([^"]+)"/)
        || html.match(/"<title>([^<]+)<\/title>/)
        || html.match(/<title>([^<]+)<\/title>/)
      if (title) meta.title = title[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim()
    }
  } catch { /* offline/blocked — thumbnail still works */ }
  return meta
}

router.post('/:id/solutions', async (req: AuthRequest, res: Response) => {
  try {
    const contest = await prisma.codingContest.findUnique({ where: { id: req.params.id as string } })
    if (!contest) {
      res.status(404).json({ error: 'Contest not found' })
      return
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    const isOwner = contest.creatorId === req.userId
    const isAdmin = user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'
    const isTeacher = user?.role === 'TEACHER'

    if (!isOwner && !isAdmin && !isTeacher) {
      res.status(403).json({ error: 'Only teachers can add solutions' })
      return
    }

    const { problemName, solutionUrl, language } = req.body

    if (!problemName || !solutionUrl) {
      res.status(400).json({ error: 'problemName and solutionUrl are required' })
      return
    }

    let solutions: any[]
    try {
      solutions = JSON.parse(contest.solutions || '[]')
    } catch {
      solutions = []
    }

    const meta = await fetchYouTubeMeta(solutionUrl)

    solutions.push({
      problemName,
      solutionUrl,
      url: solutionUrl,
      title: problemName,
      videoId: extractYouTubeId(solutionUrl) || undefined,
      thumbnail: meta.thumbnail || '',
      duration: meta.duration ?? null,
      autoTitle: meta.title || '',
      language: language || '',
      addedBy: req.userId,
      addedAt: new Date().toISOString(),
    })

    const updated = await prisma.codingContest.update({
      where: { id: req.params.id as string },
      data: { solutions: JSON.stringify(solutions) },
    })

    res.json(updated)
  } catch (error) {
    console.error('Add solution error:', error)
    res.status(500).json({ error: 'Failed to add solution' })
  }
})

// Remove solution from a contest
router.delete('/:id/solutions/:solutionIndex', async (req: AuthRequest, res: Response) => {
  try {
    const contest = await prisma.codingContest.findUnique({ where: { id: req.params.id as string } })
    if (!contest) {
      res.status(404).json({ error: 'Contest not found' })
      return
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    const isOwner = contest.creatorId === req.userId
    const isAdmin = user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'

    let solutionsArr: any[] = []
    try { solutionsArr = JSON.parse(contest.solutions || '[]') } catch { solutionsArr = [] }
    const idxNum = parseInt(req.params.solutionIndex as string)
    const isAdder = Number.isInteger(idxNum) && solutionsArr[idxNum]?.addedBy === req.userId

    if (!isOwner && !isAdmin && !isAdder) {
      res.status(403).json({ error: 'You do not have permission to remove solutions' })
      return
    }

    const solutionIndex = parseInt(req.params.solutionIndex as string)
    let solutions: any[]
    try {
      solutions = JSON.parse(contest.solutions || '[]')
    } catch {
      solutions = []
    }

    if (solutionIndex < 0 || solutionIndex >= solutions.length) {
      res.status(400).json({ error: 'Invalid solution index' })
      return
    }

    solutions.splice(solutionIndex, 1)

    const updated = await prisma.codingContest.update({
      where: { id: req.params.id as string },
      data: { solutions: JSON.stringify(solutions) },
    })

    res.json(updated)
  } catch (error) {
    console.error('Remove solution error:', error)
    res.status(500).json({ error: 'Failed to remove solution' })
  }
})

// Auto-fetch upcoming contests from competitive programming platforms
router.post('/fetch-now', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can auto-fetch contests' })
      return
    }

    const contests: any[] = []

    // Fetch from Codeforces API
    try {
      const cfResp = await fetch('https://codeforces.com/api/contest.list', {
        signal: AbortSignal.timeout(10000),
      })
      const cfData = await cfResp.json() as any
      if (cfData.status === 'OK') {
        for (const c of cfData.result.slice(0, 10)) {
          contests.push({
            title: c.name,
            platform: 'CODEFORCES',
            url: `https://codeforces.com/contest/${c.id}`,
            startTime: new Date(c.startTimeSeconds * 1000).toISOString(),
            duration: c.durationSeconds ? Math.round(c.durationSeconds / 60) : null,
            contestType: c.type || 'CF',
            status: c.phase === 'BEFORE' ? 'UPCOMING' : c.phase === 'CODING' ? 'ONGOING' : 'PAST',
          })
        }
      }
    } catch (e) {
      console.log('Codeforces fetch failed:', e)
    }

    // CodeChef API is deprecated/unreliable — skipped

    if (contests.length === 0) {
      res.json({ message: 'No contests found from external sources', contests: [] })
      return
    }

    // Save fetched contests to database
    const savedContests = []
    for (const c of contests) {
      // Check for duplicates by URL
      const existing = await prisma.codingContest.findFirst({ where: { url: c.url } })
      if (existing) continue

      const saved = await prisma.codingContest.create({
        data: {
          title: c.title,
          platform: c.platform,
          url: c.url,
          startTime: c.startTime,
          duration: c.duration,
          contestType: c.contestType,
          status: c.status,
          solutions: '[]',
          isAutoFetched: true,
          creatorId: req.userId!,
          collegeId: user.collegeId,
        },
      })
      savedContests.push(saved)
    }

    res.json({
      message: `Fetched ${savedContests.length} new contests (${contests.length - savedContests.length} duplicates skipped)`,
      contests: savedContests,
    })
  } catch (error) {
    console.error('Auto-fetch contests error:', error)
    res.status(500).json({ error: 'Failed to auto-fetch contests' })
  }
})

export default router
