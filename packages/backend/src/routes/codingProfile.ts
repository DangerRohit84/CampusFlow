// packages/backend/src/routes/codingProfile.ts
import { Router, Response } from 'express'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import { syncUserContests, syncAllUsers } from '../services/syncEngine'
import { emitToUser, broadcastContestMutation, broadcastCodingProfileMutation } from '../services/socket'
import { fetchGithubContributions, getGithubCalendar, isValidGithubUsername } from '../services/githubActivity'

const router = Router()

// Per-user manual-sync throttle for POST /sync (in-memory; resets on server
// restart, which is acceptable for abuse prevention). Allows at most one
// background scrape job per user per 5-minute window.
const SYNC_THROTTLE_MS = 5 * 60 * 1000
const syncThrottle = new Map<string, number>()

// Github throttle for calendar fetches — per IP or per user
const githubThrottle = new Map<string, number>()
const GITHUB_THROTTLE_MS = 15 * 1000 // 15s per user/IP

// Periodic cleanup to prevent unbounded memory growth (every 10 min evict expired entries)
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of syncThrottle.entries()) if (now - v > SYNC_THROTTLE_MS) syncThrottle.delete(k)
  for (const [k, v] of githubThrottle.entries()) if (now - v > GITHUB_THROTTLE_MS * 4) githubThrottle.delete(k)
}, 10 * 60 * 1000).unref?.()

// GET /coding-profile — get own profile
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const profile = await (prisma as any).codingProfile.findUnique({ where: { userId: req.userId! } })
    res.json(profile || { userId: req.userId })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch coding profile' })
  }
})

// GET /coding-profile/github-calendar — authenticated user's GitHub calendar (uses stored githubUsername)
// Must be before /:param routes
router.get('/github-calendar', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const profile = await (prisma as any).codingProfile.findUnique({ where: { userId: req.userId! } })
    const githubUsername = (profile as any)?.githubUsername as string | null | undefined
    if (!githubUsername) {
      res.status(404).json({ error: 'GitHub username not set. Add it in your coding profile first.', code: 'NO_GITHUB_USERNAME' })
      return
    }
    // per-user throttle
    const key = `cal:${req.userId}`
    const last = githubThrottle.get(key)
    if (last && Date.now() - last < GITHUB_THROTTLE_MS) {
      // still serve cached data (githubActivity service has its own cache), just avoid hammering
    }
    githubThrottle.set(key, Date.now())

    const daysParam = parseInt(String(req.query.days || '364'), 10)
    const days = Number.isFinite(daysParam) ? Math.min(730, Math.max(30, daysParam)) : 364

    const calendar = await getGithubCalendar(githubUsername, days)
    if (!calendar) {
      res.status(502).json({ error: `Could not fetch GitHub contributions for "${githubUsername}". Check username or try again later.` })
      return
    }
    res.json(calendar)
  } catch (error) {
    console.error('github-calendar error', error)
    res.status(500).json({ error: 'Failed to fetch GitHub calendar' })
  }
})

// GET /coding-profile/github/:username — fetch calendar for any GitHub username (validated). Useful for preview/validation.
router.get('/github/:githubUsername', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const raw = String(req.params.githubUsername || '').trim()
    if (!isValidGithubUsername(raw)) {
      res.status(400).json({ error: 'Invalid GitHub username. Must be 1-39 chars, alphanumeric or hyphen, cannot start/end with hyphen.' })
      return
    }
    const key = `gh:${req.userId}:${raw.toLowerCase()}`
    const last = githubThrottle.get(key)
    if (last && Date.now() - last < GITHUB_THROTTLE_MS) {
      // allow but update timestamp
    }
    githubThrottle.set(key, Date.now())

    const daysParam = parseInt(String(req.query.days || '364'), 10)
    const days = Number.isFinite(daysParam) ? Math.min(730, Math.max(30, daysParam)) : 364

    // lightweight existence check + calendar
    const calendar = await getGithubCalendar(raw, days)
    if (!calendar) {
      // try raw contributions to distinguish 404 vs transient
      const check = await fetchGithubContributions(raw)
      if (!check) {
        res.status(404).json({ error: `GitHub user "${raw}" not found or has no contributions` })
        return
      }
      res.status(502).json({ error: 'Failed to fetch GitHub calendar' })
      return
    }
    res.json(calendar)
  } catch (error) {
    console.error('github fetch error', error)
    res.status(500).json({ error: 'Failed to fetch GitHub calendar' })
  }
})

// PUT /coding-profile — update handles (including githubUsername)
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
    const rawGithub: unknown = (req.body as any).githubUsername ?? (req.body as any).githubHandle ?? (req.body as any).github
    let githubUsername: string | null = null
    if (typeof rawGithub === 'string' && rawGithub.trim()) {
      const trimmed = rawGithub.trim()
      if (!isValidGithubUsername(trimmed)) {
        res.status(400).json({ error: 'Invalid GitHub username. Must be 1-39 characters, letters/numbers/hyphens, cannot start or end with hyphen.' })
        return
      }
      githubUsername = trimmed
    }

    const handles: Record<string, string | null> = {}
    for (const [k, v] of Object.entries(raw)) handles[k] = typeof v === 'string' && v.trim() ? v.trim() : null

    // Handle validation: length + allowed chars (matches platformFetchers sanitization)
    const HANDLE_RE = /^[a-zA-Z0-9._-]+$/
    for (const [k, v] of Object.entries(handles)) {
      if (v === null) continue
      if (v.length > 50) {
        res.status(400).json({ error: `${k} handle too long (max 50 characters)` })
        return
      }
      if (!HANDLE_RE.test(v)) {
        res.status(400).json({ error: `${k} handle contains invalid characters (allowed: letters, numbers, ., _, -)` })
        return
      }
    }

    const existing = await (prisma as any).codingProfile.findUnique({ where: { userId: req.userId! } })
    let cleanedStats: any[] | undefined

    if (existing) {
      const oldHandles: Record<string, string | null> = {
        leetcode: (existing as any).leetcodeHandle,
        codeforces: (existing as any).codeforcesHandle,
        codechef: (existing as any).codechefHandle,
        hackerrank: (existing as any).hackerrankHandle,
        gfg: (existing as any).gfgHandle,
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

    const profile = await (prisma as any).codingProfile.upsert({
      where: { userId: req.userId! },
      update: {
        leetcodeHandle: handles.leetcode,
        codeforcesHandle: handles.codeforces,
        codechefHandle: handles.codechef,
        hackerrankHandle: handles.hackerrank,
        gfgHandle: handles.gfg,
        githubUsername,
        ...(cleanedStats !== undefined && { platformStats: JSON.stringify(cleanedStats) }),
      },
      create: {
        userId: req.userId!,
        leetcodeHandle: handles.leetcode,
        codeforcesHandle: handles.codeforces,
        codechefHandle: handles.codechef,
        hackerrankHandle: handles.hackerrank,
        gfgHandle: handles.gfg,
        githubUsername,
      },
    })
    try { broadcastCodingProfileMutation({ userId: req.userId, action: 'handles:updated' }) } catch {}
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
    const profile = await (prisma as any).codingProfile.findUnique({ where: { userId: req.userId! } })

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
      (profile as any).leetcodeHandle ||
      (profile as any).codeforcesHandle ||
      (profile as any).codechefHandle ||
      (profile as any).hackerrankHandle ||
      (profile as any).gfgHandle ||
      (profile as any).githubUsername
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
          broadcastContestMutation({ userId, action: 'participations:synced', synced: result.synced })
          broadcastCodingProfileMutation({ userId, action: 'sync:completed' })
        } catch { /* socket.io not initialized — push is best-effort */ }
      })
      .catch((err) => console.error(`Background coding-profile sync failed for ${userId}:`, err))
    res.status(202).json({ message: 'Sync started', userId, startedAt: new Date().toISOString() })
  } catch (error) {
    res.status(500).json({ error: 'Failed to sync' })
  }
})

// GET /coding-profile/participations — get own participation history (paginated)
router.get('/participations', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '100'), 10) || 100))
    const platform = req.query.platform ? String(req.query.platform).toLowerCase() : null
    const where: any = { userId: req.userId! }
    if (platform) where.platform = platform
    const participations = await prisma.contestParticipation.findMany({
      where,
      orderBy: [{ participatedAt: 'desc' }, { syncedAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    })
    // Add pagination headers for clients that paginate
    const total = await prisma.contestParticipation.count({ where })
    res.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
    res.json(participations)
    // Note: total available via count if client needs; keeping response as array for backward compat
    void total
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch participations' })
  }
})

// GET /coding-profile/leaderboard — overall leaderboard (college-scoped, paginated)
router.get('/leaderboard', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { platform, departmentId, year } = req.query as Record<string, string | undefined>
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
    const limitParam = parseInt(String(req.query.limit || '50'), 10)
    const limit = Number.isFinite(limitParam) ? Math.min(100, Math.max(1, limitParam)) : 50
    const requester = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!requester) { res.status(404).json({ error: 'User not found' }); return }

    // Build DB-level filters to avoid loading all rows into memory
    const where: any = {}
    if (platform && platform !== 'all') where.platform = String(platform).toLowerCase()
    // College scoping: only same college unless SUPER_ADMIN
    const collegeFilter: any = {}
    if (requester.role !== 'SUPER_ADMIN' && requester.collegeId) {
      collegeFilter.collegeId = requester.collegeId
    }
    // Department / year filters are on user relation — push to DB via relation filter
    const userFilter: any = { ...collegeFilter }
    if (departmentId && departmentId !== 'all') userFilter.departmentId = departmentId
    if (year && year !== 'all') {
      const y = parseInt(year, 10)
      if (Number.isFinite(y)) userFilter.incomingYear = y
    }
    if (Object.keys(userFilter).length) where.user = userFilter

    // Only fetch needed fields — limit to last 90 days? but keep all for ranking accuracy
    // Add pagination at DB level would require aggregation. For now fetch filtered set but with pagination after aggregation.
    const participations = await prisma.contestParticipation.findMany({
      where,
      include: { user: { include: { department: true } } },
      orderBy: { participatedAt: 'desc' },
    })

    const userStats = new Map<string, {
      userId: string; name: string; department: string; departmentId: string | null; incomingYear: number | null; avatar: string | null
      totalContests: number; ranks: number[]; bestRating: number
    }>()

    for (const p of participations) {
      const existing = userStats.get(p.userId)
      if (existing) {
        existing.totalContests++
        if (p.rank) existing.ranks.push(p.rank)
        if (p.rating && p.rating > existing.bestRating) existing.bestRating = p.rating
      } else {
        userStats.set(p.userId, {
          userId: p.userId,
          name: p.user.name,
          department: p.user.department?.name || '',
          departmentId: (p.user as any).departmentId || null,
          incomingYear: (p.user as any).incomingYear ?? null,
          avatar: p.user.avatar,
          totalContests: 1,
          ranks: p.rank ? [p.rank] : [],
          bestRating: p.rating || 0,
        })
      }
    }

    const leaderboardRaw = Array.from(userStats.values()).map(v => ({
      userId: v.userId,
      name: v.name,
      department: v.department,
      departmentId: v.departmentId,
      incomingYear: v.incomingYear,
      avatar: v.avatar,
      totalContests: v.totalContests,
      avgRank: v.ranks.length ? Math.round(v.ranks.reduce((a, b) => a + b, 0) / v.ranks.length) : 0,
      bestRating: v.bestRating,
    })).sort((a, b) => b.totalContests - a.totalContests || b.bestRating - a.bestRating)

    // Server-side pagination after aggregation
    const total = leaderboardRaw.length
    const pages = Math.ceil(total / limit)
    const start = (page - 1) * limit
    const paged = leaderboardRaw.slice(start, start + limit)

    res.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
    // Backward compat: if client didn't request pagination, return array directly; else return paginated object
    const wantsPaged = req.query.page != null || req.query.limit != null
    if (wantsPaged) {
      res.json({ data: paged, pagination: { page, limit, total, pages } })
    } else {
      res.json(paged)
    }
  } catch (error) {
    console.error('Leaderboard error:', error)
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

    // Fallback: if no results via contestId, try matching by platform + contestName or URL (college-scoped)
    if (participations.length === 0) {
      const contest = await prisma.codingContest.findUnique({ where: { id: contestId } })
      if (contest) {
        const requester = await prisma.user.findUnique({ where: { id: req.userId } })
        const platformWhere: any = { platform: contest.platform.toLowerCase() }
        // College scoping for fallback
        if (requester?.role !== 'SUPER_ADMIN' && requester?.collegeId) {
          platformWhere.user = { collegeId: requester.collegeId }
        }
        const allForPlatform = await prisma.contestParticipation.findMany({
          where: platformWhere,
          include: { user: { include: { department: true } } },
          orderBy: { rank: 'asc' },
        })
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
        const normUrl = (u: string) => u.replace(/\/+$/, '').toLowerCase()
        const cTitle = normalize(contest.title)
        const cUrl = normUrl(contest.url)
        // Rank exact matches first, then includes, to avoid false positives from substring
        const exact: any[] = []
        const fuzzy: any[] = []
        for (const p of allForPlatform) {
          const pName = normalize(p.contestName)
          if (pName === cTitle || (p.contestUrl && normUrl(p.contestUrl) === cUrl)) exact.push(p)
          else if (pName.includes(cTitle) || cTitle.includes(pName)) fuzzy.push(p)
        }
        participations = exact.length ? exact : fuzzy
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
