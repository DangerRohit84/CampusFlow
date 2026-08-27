// packages/backend/src/routes/codingProfile.ts
import { Router, Response } from 'express'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import { syncUserContests, syncAllUsers } from '../services/syncEngine'
import { emitToUser } from '../services/socket'

const router = Router()

// Per-user manual-sync throttle for POST /sync (in-memory; resets on server
// restart, which is acceptable for abuse prevention). Allows at most one
// background scrape job per user per 5-minute window.
const SYNC_THROTTLE_MS = 5 * 60 * 1000
const syncThrottle = new Map<string, number>()

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
// If a platform's handle changes, purge that platform's stale participation
// rows and stats so History/leaderboard only reflect the CURRENT handles.
router.put('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const raw = {
      leetcode: req.body.leetcodeHandle,
      codeforces: req.body.codeforcesHandle,
      codechef: req.body.codechefHandle,
      hackerrank: req.body.hackerrankHandle,
      gfg: req.body.gfgHandle,
    }
    const handles: Record<string, string | null> = {}
    for (const [k, v] of Object.entries(raw)) handles[k] = typeof v === 'string' && v.trim() ? v.trim() : null

    const existing = await prisma.codingProfile.findUnique({ where: { userId: req.userId! } })
    let cleanedStats: any[] | undefined

    if (existing) {
      const oldHandles: Record<string, string | null> = {
        leetcode: existing.leetcodeHandle,
        codeforces: existing.codeforcesHandle,
        codechef: existing.codechefHandle,
        hackerrank: existing.hackerrankHandle,
        gfg: existing.gfgHandle,
      }
      const changed = Object.keys(handles).filter(
        (p) => (oldHandles[p] || null) !== handles[p] && !!oldHandles[p]
      )

      if (changed.length > 0) {
        await prisma.contestParticipation.deleteMany({
          where: { userId: req.userId!, platform: { in: changed } },
        })
        let stats: any[] = []
        try { stats = JSON.parse(existing.platformStats || '[]') } catch { stats = [] }
        cleanedStats = stats.filter((s: any) => !changed.includes(s.platform))
      }
    }

    const profile = await prisma.codingProfile.upsert({
      where: { userId: req.userId! },
      update: {
        leetcodeHandle: handles.leetcode,
        codeforcesHandle: handles.codeforces,
        codechefHandle: handles.codechef,
        hackerrankHandle: handles.hackerrank,
        gfgHandle: handles.gfg,
        ...(cleanedStats !== undefined && { platformStats: JSON.stringify(cleanedStats) }),
      },
      create: {
        userId: req.userId!,
        leetcodeHandle: handles.leetcode,
        codeforcesHandle: handles.codeforces,
        codechefHandle: handles.codechef,
        hackerrankHandle: handles.hackerrank,
        gfgHandle: handles.gfg,
      },
    })
    res.json(profile)
  } catch (error) {
    console.error('Update coding profile error:', error)
    res.status(500).json({ error: 'Failed to update coding profile' })
  }
})

// POST /coding-profile/sync — kick off own sync (non-blocking)
// ?auto=true → skip if synced within last 10 minutes (used by page-open background sync)
// Scraping up to 5 external platforms takes seconds, so the request is acknowledged
// immediately (202) and the sync runs in the background; completion is pushed to the
// user's socket room so other tabs/devices can react.
router.post('/sync', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const profile = await prisma.codingProfile.findUnique({ where: { userId: req.userId! } })

    if (req.query.auto === 'true') {
      if (profile?.lastSyncedAt && Date.now() - profile.lastSyncedAt.getTime() < 10 * 60 * 1000) {
        res.json({ skipped: true, synced: 0, platforms: [] })
        return
      }
    }

    // Without at least one handle the background sync would no-op without advancing
    // lastSyncedAt (syncEngine early-returns), leaving clients polling until timeout.
    // Answer immediately instead of starting a pointless job.
    const hasHandles = !!profile && !!(
      profile.leetcodeHandle ||
      profile.codeforcesHandle ||
      profile.codechefHandle ||
      profile.hackerrankHandle ||
      profile.gfgHandle
    )
    if (!hasHandles) {
      res.status(200).json({
        skipped: true,
        reason: 'no-handles',
        message: 'Add at least one coding platform handle first',
      })
      return
    }

    // Per-user throttle (checked after auto-skip and no-handles guards): reject
    // if this user already started a sync within the throttle window.
    const userId = req.userId!
    const lastStart = syncThrottle.get(userId)
    if (lastStart !== undefined && Date.now() - lastStart < SYNC_THROTTLE_MS) {
      res.status(429).json({ error: 'Sync already started recently. Try again in a few minutes.' })
      return
    }

    // Record the start timestamp only after all guards pass, so rejected/skipped
    // requests never consume the user's throttle slot.
    syncThrottle.set(userId, Date.now())
    syncUserContests(userId)
      .then((result) => {
        try {
          emitToUser(userId, 'profile-sync', {
            userId,
            status: 'completed',
            synced: result.synced,
            platforms: result.platforms,
            completedAt: new Date().toISOString(),
          })
        } catch { /* socket.io not initialized — push is best-effort */ }
      })
      .catch((err) => console.error(`Background coding-profile sync failed for ${userId}:`, err))
    res.status(202).json({ message: 'Sync started', userId, startedAt: new Date().toISOString() })
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