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
      where.collegeId = user.collegeId
    } else if (user.role === 'TEACHER') {
      where.OR = [
        { creatorId: req.userId },
        { collegeId: user.collegeId },
      ]
    } else {
      // Students see contests from their college
      where.collegeId = user.collegeId
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
      where.collegeId = user.collegeId
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

// Get single coding contest
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const contest = await prisma.codingContest.findUnique({
      where: { id: req.params.id },
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

    const existing = await prisma.codingContest.findUnique({ where: { id: req.params.id } })
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
      where: { id: req.params.id },
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
    const contest = await prisma.codingContest.findUnique({ where: { id: req.params.id } })
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
      where: { id: req.params.id },
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
    const contest = await prisma.codingContest.findUnique({ where: { id: req.params.id } })
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

    await prisma.codingContest.delete({ where: { id: req.params.id } })
    res.json({ message: 'Contest deleted' })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete contest' })
  }
})

// Add solution to a contest
router.post('/:id/solutions', async (req: AuthRequest, res: Response) => {
  try {
    const contest = await prisma.codingContest.findUnique({ where: { id: req.params.id } })
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

    solutions.push({
      problemName,
      solutionUrl,
      language: language || '',
      addedBy: req.userId,
      addedAt: new Date().toISOString(),
    })

    const updated = await prisma.codingContest.update({
      where: { id: req.params.id },
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
    const contest = await prisma.codingContest.findUnique({ where: { id: req.params.id } })
    if (!contest) {
      res.status(404).json({ error: 'Contest not found' })
      return
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    const isOwner = contest.creatorId === req.userId
    const isAdmin = user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'

    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: 'You do not have permission to remove solutions' })
      return
    }

    const solutionIndex = parseInt(req.params.solutionIndex)
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
      where: { id: req.params.id },
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

    // Fetch from CodeChef upcoming contests
    try {
      const ccResp = await fetch('https://www.codechef.com/api/contests', {
        signal: AbortSignal.timeout(10000),
      })
      const ccData = await ccResp.json() as any
      if (ccData && ccData.present) {
        for (const [key, c] of Object.entries(ccData.present).slice(0, 5)) {
          const contest = c as any
          contests.push({
            title: contest.name || key,
            platform: 'CODECHEF',
            url: `https://www.codechef.com/${key}`,
            startTime: contest.start_date || new Date().toISOString(),
            duration: contest.duration ? Math.round(contest.duration / 60) : null,
            contestType: contest.type || 'Rating',
            status: 'ONGOING',
          })
        }
      }
      if (ccData && ccData.future) {
        for (const [key, c] of Object.entries(ccData.future).slice(0, 5)) {
          const contest = c as any
          contests.push({
            title: contest.name || key,
            platform: 'CODECHEF',
            url: `https://www.codechef.com/${key}`,
            startTime: contest.start_date || new Date().toISOString(),
            duration: contest.duration ? Math.round(contest.duration / 60) : null,
            contestType: contest.type || 'Rating',
            status: 'UPCOMING',
          })
        }
      }
    } catch (e) {
      console.log('CodeChef fetch failed:', e)
    }

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
