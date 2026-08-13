// packages/backend/src/routes/codingProfile.ts
import { Router, Response } from 'express'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import { syncUserContests, syncAllUsers } from '../services/syncEngine'

const router = Router()

// GET /coding-profile — get own profile
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const profile = await prisma.codingProfile.findUnique({ where: { userId: req.userId! } })
    res.json(profile || { userId: req.userId })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch coding profile' })
  }
})

// PUT /coding-profile — update handles
router.put('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { leetcodeHandle, codeforcesHandle, codechefHandle, hackerrankHandle, gfgHandle } = req.body
    const profile = await prisma.codingProfile.upsert({
      where: { userId: req.userId! },
      update: { leetcodeHandle, codeforcesHandle, codechefHandle, hackerrankHandle, gfgHandle },
      create: {
        userId: req.userId!,
        leetcodeHandle, codeforcesHandle, codechefHandle, hackerrankHandle, gfgHandle,
      },
    })
    res.json(profile)
  } catch (error) {
    res.status(500).json({ error: 'Failed to update coding profile' })
  }
})

// POST /coding-profile/sync — sync own data
router.post('/sync', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await syncUserContests(req.userId!)
    res.json(result)
  } catch (error) {
    res.status(500).json({ error: 'Failed to sync' })
  }
})

// GET /coding-profile/participations — get own participation history
router.get('/participations', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const participations = await prisma.contestParticipation.findMany({
      where: { userId: req.userId! },
      orderBy: { participatedAt: 'desc' },
    })
    res.json(participations)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch participations' })
  }
})

// GET /coding-profile/leaderboard — overall leaderboard
router.get('/leaderboard', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { platform, departmentId, year } = req.query

    const where: any = {}
    if (platform) where.platform = String(platform)

    const userWhere: any = {}
    if (departmentId) userWhere.departmentId = departmentId as string
    if (year) userWhere.incomingYear = parseInt(year as string)

    const participations = await prisma.contestParticipation.findMany({
      where,
      include: { user: { include: { department: true } } },
    })

    const userStats = new Map<string, {
      userId: string; name: string; department: string; avatar: string | null
      totalContests: number; avgRank: number; bestRating: number
    }>()

    for (const p of participations) {
      if (departmentId && p.user.departmentId !== departmentId) continue
      if (year && p.user.incomingYear !== parseInt(year as string)) continue

      const existing = userStats.get(p.userId)
      if (existing) {
        existing.totalContests++
        if (p.rating && p.rating > existing.bestRating) existing.bestRating = p.rating
      } else {
        userStats.set(p.userId, {
          userId: p.userId,
          name: p.user.name,
          department: p.user.department?.name || '',
          avatar: p.user.avatar,
          totalContests: 1,
          avgRank: p.rank || 0,
          bestRating: p.rating || 0,
        })
      }
    }

    const leaderboard = Array.from(userStats.values())
      .sort((a, b) => b.totalContests - a.totalContests || b.bestRating - a.bestRating)

    res.json(leaderboard)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch leaderboard' })
  }
})

// GET /coding-profile/contest/:contestId/participants — per-contest participants
router.get('/contest/:contestId/participants', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const contestId = String(req.params.contestId)

    // First try direct contestId lookup
    let participations: any[] = await prisma.contestParticipation.findMany({
      where: { contestId },
      include: { user: { include: { department: true } } },
      orderBy: { rank: 'asc' },
    })

    // Fallback: if no results via contestId, try matching by platform + contestName or URL
    if (participations.length === 0) {
      const contest = await prisma.codingContest.findUnique({ where: { id: contestId } })
      if (contest) {
        const allForPlatform = await prisma.contestParticipation.findMany({
          where: { platform: contest.platform.toLowerCase() },
          include: { user: { include: { department: true } } },
          orderBy: { rank: 'asc' },
        })
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
        const normUrl = (u: string) => u.replace(/\/+$/, '').toLowerCase()
        const cTitle = normalize(contest.title)
        const cUrl = normUrl(contest.url)
        participations = allForPlatform.filter((p) => {
          // Match by title
          const pName = normalize(p.contestName)
          if (pName === cTitle || pName.includes(cTitle) || cTitle.includes(pName)) return true
          // Match by URL (most reliable)
          if (p.contestUrl && normUrl(p.contestUrl) === cUrl) return true
          return false
        })
      }
    }

    res.json(participations)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch participants' })
  }
})

// POST /coding-profile/sync-all — sync all students (teacher only)
router.post('/sync-all', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can sync all users' })
      return
    }
    const result = await syncAllUsers()
    res.json(result)
  } catch (error) {
    res.status(500).json({ error: 'Failed to sync all users' })
  }
})

export default router