// packages/backend/src/routes/codingProfile.ts
import { Router, Response } from 'express'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import { toApiParticipations, toPlatformEnum } from '../lib/platform'
import { syncUserContests, syncAllUsers } from '../services/syncEngine'
import { emitToUser, broadcastContestMutation, broadcastCodingProfileMutation } from '../services/socket'
import { fetchGithubContributions, getGithubCalendar, isValidGithubUsername } from '../services/githubActivity'
import { ACTIVITY_WINDOW_DAYS } from '../services/codingActivity'
import { checkAndClaimSyncThrottle, clearSyncThrottleStore } from '../services/syncThrottleStore'
import { logger } from '../utils/logger'

const router = Router()

// Per-user manual-sync throttle for POST /sync (60s window).
// Upgrade 3b: DB-backed via SyncThrottle table (multi-instance safe, survives
// restart) with the in-memory Map below as fast-path + fallback until the
// 20260910000000_sync_upgrades migration is applied. DB is authoritative:
// memory says throttled → 429 immediately; else DB is checked; claim writes
// both. Allows at most one background scrape job per user per 1-minute window.
const SYNC_THROTTLE_MS = 60 * 1000
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
    logger.error({ err: error }, 'github-calendar error')
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
    logger.error({ err: error }, 'github fetch error')
    res.status(500).json({ error: 'Failed to fetch GitHub calendar' })
  }
})

// GET /coding-profile/activity — unified-heatmap daily activity.
// Returns the trailing-window CodingActivity snapshot (leetcode/codeforces
// per-day solves persisted by sync) + live GitHub days (cached, best-effort).
// Contests are NOT duplicated here — the frontend merges ContestParticipation
// dates (authoritative) with this payload. CodeChef/HackerRank/GFG have NO
// daily API and are honestly reported in `omitted` (totals stay in cards).
// Pre-migration safe: missing CodingActivity table returns stored: [] with
// live GitHub still served (never 500 for a missing table).
router.get('/activity', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const daysParam = parseInt(String(req.query.days || String(ACTIVITY_WINDOW_DAYS)), 10)
    const days = Number.isFinite(daysParam) ? Math.min(365, Math.max(30, daysParam)) : ACTIVITY_WINDOW_DAYS
    const since = new Date()
    since.setUTCDate(since.getUTCDate() - (days - 1))
    since.setUTCHours(0, 0, 0, 0)

    let stored: Array<{ date: string; source: string; count: number }> = []
    try {
      const delegate = (prisma as any)?.codingActivity
      if (delegate) {
        const rows: any[] = await delegate.findMany({
          where: { userId: req.userId!, date: { gte: since } },
          select: { date: true, source: true, count: true },
          orderBy: { date: 'asc' },
          take: 2000,
        })
        stored = (rows || [])
          .map((r: any) => {
            const d = r?.date instanceof Date ? r.date : new Date(r?.date)
            if (!Number.isFinite(d.getTime())) return null
            const key = d.toISOString().slice(0, 10)
            const count = Math.floor(Number(r?.count))
            if (!['leetcode', 'codeforces', 'github'].includes(String(r?.source))) return null
            if (!Number.isFinite(count) || count <= 0) return null
            return { date: key, source: String(r.source), count }
          })
          .filter(Boolean) as Array<{ date: string; source: string; count: number }>
      }
    } catch {
      // Pre-migration (or stale client): serve live GitHub only, never 500.
      stored = []
    }

    // Live GitHub overlay (cached 10min, best-effort): fresher than the last
    // sync snapshot; the frontend prefers live days when present.
    let github: Array<{ date: string; count: number; level: number }> = []
    let githubLive = false
    try {
      const profile = await (prisma as any).codingProfile.findUnique({ where: { userId: req.userId! } })
      const username = (profile as any)?.githubUsername as string | null | undefined
      if (username && isValidGithubUsername(username)) {
        const cal = await getGithubCalendar(username, days)
        if (cal && cal.length > 0) {
          github = cal
          githubLive = true
        }
      }
    } catch (err) {
      logger.warn({ err: (err as any)?.message || err }, 'activity github overlay failed (best-effort)')
      github = []
    }

    res.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=120')
    res.json({
      stored,
      github,
      githubLive,
      windowDays: days,
      // Honest source ledger: what the heatmap can and cannot show per day.
      sources: {
        leetcode: true,
        codeforces: true,
        github: true,
        contests: true,
      },
      omitted: ['codechef', 'hackerrank', 'gfg'],
      omittedReason: 'No public per-day activity API — totals are shown in platform cards, never faked into the heatmap.',
    })
  } catch (error) {
    logger.error({ err: error }, 'activity fetch error')
    res.status(500).json({ error: 'Failed to fetch daily activity' })
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
    let changedPlatforms: string[] = []

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
      changedPlatforms = changed

      if (changed.length > 0) {
        // Order 4: ContestParticipation.platform is the native Platform enum
        // (UPPERCASE). `changed` holds lowercase handle keys ('leetcode') —
        // normalize at the Prisma boundary (no `as any` cast).
        const changedEnums = changed.map((p) => toPlatformEnum(p))
        await prisma.contestParticipation.deleteMany({
          where: { userId: req.userId!, platform: { in: changedEnums } },
        })
        let stats: any[] = []
        try { const _ps: any = (existing as any).platformStats; stats = Array.isArray(_ps) ? _ps : JSON.parse(typeof _ps === 'string' ? (_ps || '[]') : '[]') } catch { stats = [] }
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
        ...(cleanedStats !== undefined && { platformStats: cleanedStats as any }),
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
    // Handle change invalidates the prior sync run: clear the per-user throttle
    // so an immediate re-sync for the NEW handles is not rejected as 429.
    // First-add (changedPlatforms empty) is unaffected — delete on a missing
    // key is a no-op — and Sync still reads the freshly saved handles.
    // Upgrade 3b: clear DB-backed throttle too (multi-instance).
    if (changedPlatforms.length > 0) {
      syncThrottle.delete(req.userId!)
      try {
        await clearSyncThrottleStore(req.userId!)
      } catch {}
    }
    try { broadcastCodingProfileMutation({ userId: req.userId, action: 'handles:updated' }) } catch {}
    res.json(profile)
  } catch (error) {
    logger.error({ err: error }, 'Update coding profile error:')
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
    // WHY: remaining seconds are returned so the UI can render a live
    // "Sync in Ns" countdown instead of a generic failure toast.
    // Upgrade 3b: in-memory fast-path first (no DB hit on spam), then DB
    // authoritative check+claim (multi-instance safe). 429 shape unchanged:
    // status 429 + Retry-After header + retryAfterSec body.
    const userId = req.userId!
    const lastStart = syncThrottle.get(userId)
    if (lastStart !== undefined && Date.now() - lastStart < SYNC_THROTTLE_MS) {
      const retryAfterSec = Math.max(
        1,
        Math.ceil((SYNC_THROTTLE_MS - (Date.now() - lastStart)) / 1000)
      )
      res.set('Retry-After', String(retryAfterSec))
      res.status(429).json({ error: `Sync already started recently. Try again in ${retryAfterSec}s.`, retryAfterSec })
      return
    }

    // DB-backed throttle (authoritative across replicas). Falls back to
    // memory when the SyncThrottle table is missing (pre-migration).
    try {
      const dbThrottle = await checkAndClaimSyncThrottle(userId, { windowMs: SYNC_THROTTLE_MS })
      if (!dbThrottle.allowed) {
        res.set('Retry-After', String(dbThrottle.retryAfterSec))
        res.status(429).json({ error: `Sync already started recently. Try again in ${dbThrottle.retryAfterSec}s.`, retryAfterSec: dbThrottle.retryAfterSec })
        return
      }
    } catch (e) {
      logger.warn({ err: (e as any)?.message || e }, '[sync] throttle DB check failed, using in-memory only')
    }

    // Record the start timestamp only after all guards pass, so rejected/skipped
    // requests never consume the user's throttle slot.
    syncThrottle.set(userId, Date.now())
    // Throttle-collapse: reuse the profile already fetched above (line 227) so
    // syncUserContests skips its own findUnique (3 pre-hits → 2).
    syncUserContests(userId, { profile })
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
      .catch((err) => logger.error({ err: err }, `Background coding-profile sync failed for ${userId}:`))
    res.status(202).json({ message: 'Sync started', userId, startedAt: new Date().toISOString() })
  } catch (error) {
    res.status(500).json({ error: 'Failed to sync' })
  }
})

// GET /coding-profile/participations — get own participation history (take:50 + count)
// 10k scale: take capped 50 (was 200), count exposed via X-Total-Count header
// + envelope when paged. Array body kept for backward compat.
router.get('/participations', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50))
    const rawPlatform = req.query.platform ? String(req.query.platform) : null
    const where: any = { userId: req.userId! }
    // Order 4: platform is the native enum (UPPERCASE). Accept lowercase from
    // the query (frontend sends 'codechef') and normalize at the boundary.
    // 400 on unknown (mirrors contests.ts isValidPlatform); 'all' = no filter.
    if (rawPlatform && rawPlatform.toLowerCase() !== 'all') {
      try {
        where.platform = toPlatformEnum(rawPlatform)
      } catch {
        res.status(400).json({ error: `Invalid platform. Allowed: CODEFORCES, CODECHEF, LEETCODE, ATCODER, HACKERRANK, GFG, OTHER` })
        return
      }
    }
    const [rows, total] = await Promise.all([
      prisma.contestParticipation.findMany({
        where,
        orderBy: [{ participatedAt: 'desc' }, { syncedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.contestParticipation.count({ where }),
    ])
    // API shape stable: frontend keys on lowercase ('codechef',
    // PlatformLogo/history filter/platformColors) — map DB UPPERCASE back.
    const participations = toApiParticipations(rows as any)
    res.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
    res.set('X-Total-Count', String(total))
    const wantsPaged = req.query.page != null || req.query.limit != null
    if (wantsPaged) {
      res.json({ data: participations, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
      return
    }
    res.json(participations)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch participations' })
  }
})

// GET /coding-profile/leaderboard — overall leaderboard (college-scoped, paginated)
// 10k scale: DB GROUP BY (not in-memory agg over 1M participations).
// BEFORE: findMany(all participations + include user+department) → JS Map → sort → slice.
//   10k users × 100 contests = 1M rows with includes → OOM.
// AFTER: single groupBy(userId) with _count/_avg/_max at DB → fetch user
//   details for the page slice only (≤50 rows). Total = groups length
//   (≤10k small rows, no includes). Same response shape (API compat).
router.get('/leaderboard', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { platform, departmentId, year } = req.query as Record<string, string | undefined>
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
    const limitParam = parseInt(String(req.query.limit || '50'), 10)
    const limit = Number.isFinite(limitParam) ? Math.min(50, Math.max(1, limitParam)) : 50
    // NARROW-READ: leaderboard auth needs id/role/collegeId only (was full row).
    const requester = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } })
    if (!requester) { res.status(404).json({ error: 'User not found' }); return }

    const where: any = {}
    // Order 4: platform is the native enum (UPPERCASE). Frontend sends
    // lowercase ids ('codeforces') — normalize at the boundary, 400 on ghost.
    if (platform && platform !== 'all') {
      try {
        where.platform = toPlatformEnum(platform)
      } catch {
        res.status(400).json({ error: `Invalid platform. Allowed: CODEFORCES, CODECHEF, LEETCODE, ATCODER, HACKERRANK, GFG, OTHER` })
        return
      }
    }
    const collegeFilter: any = {}
    if (requester.role !== 'SUPER_ADMIN' && requester.collegeId) {
      collegeFilter.collegeId = requester.collegeId
    }
    const userFilter: any = { ...collegeFilter }
    if (departmentId && departmentId !== 'all') userFilter.departmentId = departmentId
    if (year && year !== 'all') {
      const y = parseInt(year, 10)
      if (Number.isFinite(y)) userFilter.incomingYear = y
    }
    if (Object.keys(userFilter).length) where.user = userFilter

    // Single DB aggregation — GROUP BY userId (replaces in-memory Map over all rows).
    const groups: any[] = await prisma.contestParticipation.groupBy({
      by: ['userId'],
      where,
      _count: { _all: true },
      _avg: { rank: true },
      _max: { rating: true },
    } as any)

    // Sort at DB-equivalent order (totalContests desc, bestRating desc).
    // groupBy orderBy on aggregates varies by provider; sort in JS over
    // ≤10k small group rows (not 1M full rows) for deterministic output.
    groups.sort((a: any, b: any) => {
      const ca = a._count?._all ?? 0
      const cb = b._count?._all ?? 0
      if (cb !== ca) return cb - ca
      return (b._max?.rating ?? 0) - (a._max?.rating ?? 0)
    })

    const total = groups.length
    const pages = Math.ceil(total / limit)
    const start = (page - 1) * limit
    const pageGroups = groups.slice(start, start + limit)

    // Participant details for the page only (single lookup, not N+1).
    // NARROW-READ: was include:{department:true} (full user incl. passwordHash +
    // full department). AFTER: select display cols only — same mapped payload
    // {name,department,departmentId,incomingYear,avatar} (sensitive cols dropped).
    const userIds = pageGroups.map((g: any) => g.userId)
    const users: any[] = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, avatar: true, departmentId: true, incomingYear: true, department: { select: { id: true, name: true } } },
        })
      : []
    const userMap = new Map(users.map((u: any) => [u.id, u]))

    const paged = pageGroups.map((g: any) => {
      const u = userMap.get(g.userId) as any
      return {
        userId: g.userId,
        name: u?.name ?? '',
        department: u?.department?.name || '',
        departmentId: u?.departmentId || null,
        incomingYear: u?.incomingYear ?? null,
        avatar: u?.avatar ?? null,
        totalContests: g._count?._all ?? 0,
        avgRank: g._avg?.rank != null ? Math.round(g._avg.rank) : 0,
        bestRating: g._max?.rating ?? 0,
      }
    })

    res.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
    // Backward compat: if client didn't request pagination, return array directly; else return paginated object
    const wantsPaged = req.query.page != null || req.query.limit != null
    if (wantsPaged) {
      res.json({ data: paged, pagination: { page, limit, total, pages } })
    } else {
      res.json(paged)
    }
  } catch (error) {
    logger.error({ err: error }, 'Leaderboard error:')
    res.status(500).json({ error: 'Failed to fetch leaderboard' })
  }
})

// GET /coding-profile/contest/:contestId/participants — per-contest participants
// 10k scale: cursor/offset pagination (take:50 max) + count via _count/groupBy.
// BEFORE: unbounded findMany with includes (could ship 10k rows).
// AFTER: take:50 + total count in parallel; array shape kept when no
// pagination query (compat, capped 50), envelope when paged.
router.get('/contest/:contestId/participants', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const contestId = String(req.params.contestId)
    const wantsPaged = req.query.page != null || req.query.limit != null || req.query.cursor != null
    const limitParam = parseInt(String(req.query.limit || '50'), 10)
    const limit = Number.isFinite(limitParam) ? Math.min(50, Math.max(1, limitParam)) : 50
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
    const skip = (page - 1) * limit
    const cursorId = req.query.cursor ? String(req.query.cursor) : null
    const cursorClause: any = cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}

    // First try direct contestId lookup (paginated + counted in parallel)
    // NARROW-READ: was include:{user:{include:{department:true}}} (full user incl.
    // passwordHash + full department per row). AFTER: select display cols only —
    // same functional payload (id/name/avatar/dept), sensitive cols dropped.
    // PARALLEL (keeps 322-330 pattern): page + count via ONE Promise.all (was sequential).
    const narrowUserSelect = { id: true, name: true, avatar: true, departmentId: true, incomingYear: true, department: { select: { id: true, name: true } } } as const
    const pageArgs: any = {
      where: { contestId },
      include: { user: { select: narrowUserSelect } },
      orderBy: [{ rank: 'asc' }, { id: 'asc' }],
      take: limit,
      ...cursorClause,
      ...(cursorId ? {} : { skip }),
    }
    let participations: any[]
    let total: number | null = null
    if (wantsPaged) {
      const [pageRows, pageTotal] = await Promise.all([
        prisma.contestParticipation.findMany(pageArgs),
        prisma.contestParticipation.count({ where: { contestId } }),
      ])
      participations = pageRows as any[]
      total = pageTotal
    } else {
      participations = await prisma.contestParticipation.findMany(pageArgs)
    }

    // Fallback: if no results via contestId, try matching by platform + contestName or URL (college-scoped)
    // 10k guard: cap scan to 50 best-ranked rows (was 1000) with pagination slice —
    // fuzzy match needs in-memory normalize, but bounded input keeps it O(50) not O(1000).
    // PARALLEL: contest + requester are independent (was 2 sequential awaits).
    if (participations.length === 0) {
      const [contest, requester] = await Promise.all([
        prisma.codingContest.findUnique({ where: { id: contestId } }),
        prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }),
      ])
      if (contest) {
        // Order 4: contest.platform is already the native enum (UPPERCASE) —
        // use it directly at the Prisma boundary (never .toLowerCase(), which
        // reintroduces the live enum-rejection bug).
        const platformWhere: any = { platform: toPlatformEnum(contest.platform) }
        // College scoping for fallback
        if (requester?.role !== 'SUPER_ADMIN' && requester?.collegeId) {
          platformWhere.user = { collegeId: requester.collegeId }
        }
        const allForPlatform = await prisma.contestParticipation.findMany({
          where: platformWhere,
          include: { user: { select: narrowUserSelect } },
          orderBy: [{ rank: 'asc' }, { id: 'asc' }],
          take: 50,
        })
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
        const normUrl = (u: string) => u.replace(/\/+$/, '').toLowerCase()
        const cTitle = normalize(contest.title)
        const cUrl = normUrl(contest.url)
        // Order 7 snapshot contract: exact URL/title (canonical CodingContest) outranks fuzzy snapshot includes — mirrors resolveContestDisplay().
        // Rank exact matches first, then includes, to avoid false positives from substring
        const exact: any[] = []
        const fuzzy: any[] = []
        for (const p of allForPlatform) {
          const pName = normalize(p.contestName)
          if (pName === cTitle || (p.contestUrl && normUrl(p.contestUrl) === cUrl)) exact.push(p)
          else if (pName.includes(cTitle) || cTitle.includes(pName)) fuzzy.push(p)
        }
        const matched = exact.length ? exact : fuzzy
        if (wantsPaged) total = matched.length
        participations = cursorId
          ? matched.slice(0, limit)
          : matched.slice(skip, skip + limit)
      }
    }

    if (wantsPaged) {
      const pages = total != null ? Math.ceil(total / limit) : 1
      const nextCursor =
        participations.length === limit ? participations[participations.length - 1]?.id ?? null : null
      res.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
      // API shape stable: map DB UPPERCASE back to lowercase for the client.
      res.json({ data: toApiParticipations(participations as any), pagination: { page, limit, total: total ?? participations.length, pages, nextCursor } })
      return
    }
    res.json(toApiParticipations(participations as any))
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch participants' })
  }
})

// POST /coding-profile/sync-all — sync all students (teacher only)
router.post('/sync-all', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // NARROW-READ: role check needs id/role only (was full row).
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true } })
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
