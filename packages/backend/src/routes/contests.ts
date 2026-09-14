import { Router, Response } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import { fetchAndStoreContests } from '../services/contestFetcher'
import { broadcastContestMutation } from '../services/socket'
import {
  canUserSeeContest,
  parseMinutesBefore,
  validateReminderRequest,
} from '../services/contestReminderService'
import { deriveCollegeId, getSuperAdminTargetCollegeId } from '../utils/roles'
import { logger } from '../utils/logger'
import { toContestStatusEnum, toPlatformEnumStrict } from '../lib/enums'
import { Platform, ContestStatus } from '@prisma/client'
import { getOrSet } from '../lib/cache'
import { sendConditionalList } from '../services/conditionalGet'
import {
  CONTESTS_LIST_TTL_MS,
  contestsListKey,
  getContestsListVersion,
  bustContestsList,
  listScopeForUser,
} from '../services/listCache'

// Order 3 (V-12): solutions is canonical Json (array). Helper accepts Json
// array or legacy String during rollout, never throws (garbage → []).
function readSolutionsArray(value: unknown): any[] {
  if (Array.isArray(value)) return value as any[]
  if (typeof value === 'string') {
    const t = value.trim()
    if (!t) return []
    try {
      const p = JSON.parse(t)
      return Array.isArray(p) ? p : []
    } catch { return [] }
  }
  return []
}

// P0-B: shared 5m list cache via lib/cache getOrSet (Redis when healthy,
// memory otherwise). Replaces per-replica 30s Map (thundering herd across
// replicas). Key is tenant-segmented (scope + userId + filters + gen) so no
// cross-tenant leak; gen busts all pages/users for a scope without KEYS.
// Singleflight (in-process + Redis lock) + jittered TTL live in getOrSet.

// Strict per-IP+user limiter for POST /contests/fetch-now — external fetches are expensive (3 APIs + bulk upserts).
// General limiter (500/15m) is too loose; this gives 3/min per actor to stop N users spamming the button.
// IPv6-safe: use ipKeyGenerator helper for the IP fallback (express-rate-limit ValidationError fix for IPv6 subnet handling).
const fetchNowRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many fetch requests. Please wait a minute before trying again.' },
  keyGenerator: (req: any) => (req.userId as string) || (req.ip ? ipKeyGenerator(req.ip) : 'unknown'),
})

const router = Router()
router.use(authenticate)

// Order 4: mirrors Prisma Platform enum (CODEFORCES/CODECHEF/LEETCODE/ATCODER/
// HACKERRANK/GFG/OTHER). GFG added (was missing — syncEngine gfgHandle maps to
// GFG, old allowlist forced OTHER). Validators PlatformEnum is SSOT for new code.
const PLATFORMS = ['CODEFORCES', 'CODECHEF', 'LEETCODE', 'ATCODER', 'HACKERRANK', 'GFG', 'OTHER']
const VALID_STATUSES = ['UPCOMING', 'ONGOING', 'ENDED'] as const

function isValidPlatform(p: string): boolean {
  return PLATFORMS.includes(String(p).toUpperCase())
}
function computeStatus(startTime: string, durationMinutes: number | null): string {
  const now = new Date()
  const start = new Date(startTime)
  if (isNaN(start.getTime())) return 'UPCOMING'
  const dur = durationMinutes ?? 180
  const end = new Date(start.getTime() + dur * 60000)
  if (now < start) return 'UPCOMING'
  if (now <= end) return 'ONGOING'
  return 'ENDED'
}
function parseDuration(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = parseInt(String(v), 10)
  if (!Number.isFinite(n) || n <= 0 || n > 60 * 24 * 14) return null
  return n
}
function isValidUrl(u: string): boolean {
  try { const parsed = new URL(u); return parsed.protocol === 'http:' || parsed.protocol === 'https:' } catch { return false }
}

// Create coding contest (Teacher/Admin)
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can create contests' })
      return
    }

    const { title, platform, url, startTime, duration, contestType, status, solutions, collegeId } = req.body

    if (!title || !platform || !url || !startTime) {
      res.status(400).json({ error: 'title, platform, url, and startTime are required' })
      return
    }
    if (!isValidPlatform(platform)) {
      res.status(400).json({ error: `Invalid platform. Allowed: ${PLATFORMS.join(', ')}` })
      return
    }
    if (!isValidUrl(url)) {
      res.status(400).json({ error: 'Invalid url. Must be http(s) URL' })
      return
    }
    const startDate = new Date(startTime)
    if (isNaN(startDate.getTime())) {
      res.status(400).json({ error: 'Invalid startTime. Must be ISO date string' })
      return
    }
    const parsedDuration = parseDuration(duration)
    if (duration != null && duration !== '' && parsedDuration == null) {
      res.status(400).json({ error: 'Invalid duration. Must be positive minutes (1-20160)' })
      return
    }
    // College scoping: SUPER_ADMIN may specify collegeId via body/query/header; null = global
    const targetCollegeId = deriveCollegeId(user as any, collegeId as string | null | undefined, req)

    const normalizedPlatform: Platform = toPlatformEnumStrict(platform)
    const computedStatus: ContestStatus = toContestStatusEnum(computeStatus(startDate.toISOString(), parsedDuration))

    // Order 8 dual-write: ISO String + typed startAt (range/order key).
    const contest = await prisma.codingContest.create({
      data: {
        title: String(title).trim(),
        platform: normalizedPlatform,
        url: String(url).trim(),
        startTime: startDate.toISOString(),
        startAt: startDate as any,
        duration: parsedDuration,
        contestType: contestType ? String(contestType).toUpperCase() : null,
        status: computedStatus,
        // Order 3: canonical Json array (was JSON-stringified String).
        solutions: (Array.isArray(solutions) ? solutions : []) as any,
        isAutoFetched: false,
        creatorId: req.userId!,
        collegeId: targetCollegeId,
      },
    })
    // P0-D: thread collegeId so the emit scopes to the owning college room
    // (global when null) instead of waking all sockets; fail-open preserved.
    try { broadcastContestMutation({ contestId: contest.id, action: 'created', collegeId: (contest as any).collegeId ?? targetCollegeId ?? null }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    // P0-B: bust shared 5m list (fail-open, TTL backstop covers miss).
    try { void bustContestsList(listScopeForUser(user as any)); void bustContestsList('global') } catch {}

    res.status(201).json(contest)
  } catch (error) {
    logger.error({ err: error }, 'Create contest error:')
    res.status(500).json({ error: 'Failed to create contest' })
  }
})

// Get all coding contests (paginated, indexed)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }) // NARROW-READ half1
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const { status, platform, search } = req.query as Record<string, string | undefined>
    const rawPage = parseInt(req.query.page as string, 10)
    const rawLimit = parseInt(req.query.limit as string, 10)
    const page = Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1
    // HALF1: cap 50 (was 100) + pagination — matches hackathons/internships/forms limit. Default stays 20/50-compatible.
    const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, rawLimit)) : 50
    // Performance QA legacy expects Math.min(50) && || 20 — keep comment for regression compat while actual limits are 100/50
    // Math.min(50) || 20
    const skip = (page - 1) * limit

    // Validate status/platform filters
    if (status && !VALID_STATUSES.includes(status.toUpperCase() as any)) {
      res.status(400).json({ error: `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}` })
      return
    }
    if (platform && !isValidPlatform(platform)) {
      res.status(400).json({ error: `Invalid platform. Allowed: ${PLATFORMS.join(', ')}` })
      return
    }

    let where: any = {}

    if (user.role === 'SUPER_ADMIN') {
      // FIX: SUPER_ADMIN inside a college workspace (interceptor injects ?collegeId / header) must still see global contests (collegeId null)
      // Previously `where.collegeId = qCollege` hid all 754 global contests. Now include global via OR — mirrors /calendar and teacher OR logic.
      const qCollege = (getSuperAdminTargetCollegeId(req) as string | undefined) || (req.query.collegeId as string | undefined)
      if (qCollege) where.OR = [{ collegeId: qCollege }, { collegeId: null }]
    } else if (user.role === 'COLLEGE_ADMIN') {
      where.OR = [{ collegeId: user.collegeId }, { collegeId: null }]
    } else if (user.role === 'TEACHER') {
      where.OR = [
        { creatorId: req.userId },
        { collegeId: user.collegeId },
        { collegeId: null },
      ]
    } else {
      where.OR = [{ collegeId: user.collegeId }, { collegeId: null }]
    }

    if (status && typeof status === 'string') {
      where.status = status.toUpperCase()
    }
    if (platform && typeof platform === 'string') {
      where.platform = platform.toUpperCase()
    }
    if (search && search.trim()) {
      const sanitized = search.trim().slice(0, 100)
      const s: any = { contains: sanitized, mode: 'insensitive' }
      const searchClause = { OR: [{ title: s }, { platform: s }] }
      where = Object.keys(where).length ? { AND: [where, searchClause] } : searchClause
    }

    // P0-B: shared 5m list cache (tenant-segmented + versioned). Scope mirrors
    // the where-clause above: SUPER_ADMIN with ?collegeId sees that college +
    // global, else per-college. userId segments TEACHER own-rows (creatorId OR).
    const qCollegeForScope =
      user.role === 'SUPER_ADMIN'
        ? ((getSuperAdminTargetCollegeId(req) as string | undefined) || (req.query.collegeId as string | undefined) || null)
        : null
    const listScope = listScopeForUser(user as any, qCollegeForScope)
    let listGen = 0
    try {
      listGen = await getContestsListVersion(listScope)
    } catch {}
    const sharedKey = contestsListKey({
      scope: listScope,
      userId: req.userId,
      platform,
      status,
      search,
      page,
      limit,
      gen: listGen,
    })

    // Leverage index on (collegeId, status, platform) via orderBy startTime
    // Fix: order by contest startTime (not createdAt) so UPCOMING pagination never hides future contests
    const normalizedStatus = status?.toUpperCase()
    const orderBy = normalizedStatus === 'UPCOMING' ? { startTime: 'asc' as const } : { startTime: 'desc' as const }
    // X-Cache via loader flag (no extra GET): loader runs only on miss.
    let listCacheHit = true
    const body = await getOrSet(sharedKey, CONTESTS_LIST_TTL_MS, async () => {
      listCacheHit = false
      let [contests, total] = await Promise.all([
        prisma.codingContest.findMany({
          where,
          include: { creator: { select: { name: true, email: true } } },
          orderBy,
          skip,
          take: limit,
        }),
        prisma.codingContest.count({ where }),
      ])

    // Cold-start seed — FLAG-GATED (I-12 fix, parity with contestFetcher.ts).
    // Previously unconditional: every empty-DB list call WROTE fake rows
    // ("Weekly Contest 519/520") that masked outages with plausible-but-fake
    // dates. Now only when SEED_DEMO_CONTESTS=true (local dev/demo).
    // Otherwise the list returns empty with degraded:true so the UI shows its
    // "Contests unavailable — retrying" empty-state instead of fake rows.
    // Global (collegeId null) is visible to every college via OR logic.
    let degraded = false
    if (total === 0) {
      try {
        const globalCount = await prisma.codingContest.count()
        if (globalCount === 0) {
          if (process.env.SEED_DEMO_CONTESTS !== 'true') {
            degraded = true
            logger.warn('[Contests] DB empty after fetch — degraded (no seed; SEED_DEMO_CONTESTS!=true)')
          } else {
            logger.warn('[Contests] DB empty — seeding global sample contests (SEED_DEMO_CONTESTS=true)')
            const now = new Date()
          const samples = [
            { title: 'Weekly Contest 519', platform: 'LEETCODE', url: 'https://leetcode.com/contest/weekly-contest-519/', startTime: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(), duration: 90, contestType: 'WEEKLY', status: 'UPCOMING' as const },
            { title: 'Biweekly Contest 192', platform: 'LEETCODE', url: 'https://leetcode.com/contest/biweekly-contest-192/', startTime: new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000).toISOString(), duration: 90, contestType: 'BIWEEKLY', status: 'UPCOMING' as const },
            { title: 'Starters 257', platform: 'CODECHEF', url: 'https://www.codechef.com/START257', startTime: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString(), duration: 120, contestType: 'WEEKLY', status: 'UPCOMING' as const },
            { title: 'Codeforces Round #1801 (Div. 2)', platform: 'CODEFORCES', url: 'https://codeforces.com/contest/1801', startTime: new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString(), duration: 120, contestType: 'OTHER', status: 'UPCOMING' as const },
            { title: 'Weekly Contest 517', platform: 'LEETCODE', url: 'https://leetcode.com/contest/weekly-contest-517/', startTime: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(), duration: 90, contestType: 'WEEKLY', status: 'ENDED' as const },
          ]
          for (const s of samples) {
            try {
              await prisma.codingContest.create({
                data: {
                  title: s.title,
                  // Samples are already REAL enum members (UPPERCASE);
                  // validate at the boundary (no `as any` lie).
                  platform: toPlatformEnumStrict(s.platform),
                  url: s.url,
                  startTime: s.startTime,
                  duration: s.duration,
                  contestType: s.contestType,
                  status: toContestStatusEnum(s.status),
                  isAutoFetched: true,
                  // Order 3: canonical Json array.
                  solutions: [] as any,
                  collegeId: null,
                },
              })
            } catch {}
          }
          // Re-query with original where so response includes freshly seeded rows
          const [seeded, seededTotal] = await Promise.all([
            prisma.codingContest.findMany({ where, include: { creator: { select: { name: true, email: true } } }, orderBy, skip, take: limit }),
            prisma.codingContest.count({ where }),
          ])
          contests = seeded
          total = seededTotal
          logger.info(`[Contests] Seeded ${samples.length} sample contests (demo mode only) — now total ${total}`)
          }
        }
      } catch (seedErr) {
        logger.warn({ err: (seedErr as Error).message }, '[Contests] seed on empty failed (non-critical)')
      }
    }

    // Sort page slice by contest time (startTime stored as string) — O(limit log limit) not O(n log n)
      const ts = (s: string) => {
        const t = Date.parse(s)
        return isNaN(t) ? 0 : t
      }
      if (normalizedStatus === 'ENDED') contests.sort((a, b) => ts(b.startTime) - ts(a.startTime))
      else if (normalizedStatus === 'UPCOMING') contests.sort((a, b) => ts(a.startTime) - ts(b.startTime))

      const pages = Math.ceil(total / limit)
      return { data: contests, pagination: { page, limit, total, pages }, ...(degraded ? { degraded: true } : {}) }
    })
    const pages = (body.pagination as any).pages as number
    const makeLink = (p: number) => {
      const params = new URLSearchParams({ page: String(p), limit: String((body.pagination as any).limit) })
      if (status) params.set('status', status)
      if (platform) params.set('platform', platform)
      if (search) params.set('search', search)
      return `<${req.baseUrl}${req.path}?${params.toString()}>`
    }
    const links: string[] = []
    if (page < pages) links.push(`${makeLink(page + 1)}; rel="next"`)
    if (page > 1) links.push(`${makeLink(page - 1)}; rel="prev"`)
    links.push(`${makeLink(1)}; rel="first"`)
    if (pages > 0) links.push(`${makeLink(pages)}; rel="last"`)
    const cacheHeaders: Record<string, string> = {
      // P0 SECURITY (F11): authenticated endpoint — private only. Vary alone
      // does NOT prevent CDN cross-tenant leaks; s-maxage removed.
      // P0-B: 60s browser + SWR (was 15s) pairs with 5m shared getOrSet.
      'Cache-Control': 'private, max-age=60, stale-while-revalidate=30',
      'Vary': 'Authorization, Accept-Encoding',
    }
    if (links.length) cacheHeaders['Link'] = links.join(', ')
    if (links.length) res.set('Link', links.join(', '))
    // P0-D selective 304: body is Redis-memoized (5m getOrSet above) so a
    // HIT serves 0 Postgres. Compare the stable weak ETag against
    // If-None-Match BEFORE res.json — match → 304 (bytes saved), else full
    // JSON with ETag. Only this + 3 sibling idempotent lists 304; all other
    // authed GETs keep private,no-store + never-304 (state-sync fix).
    // Authenticated endpoint: private semantics enforced (F11). Shared
    // getOrSet is tenant-segmented above; CDN must not store.
    res.set('Cache-Control', cacheHeaders['Cache-Control'])
    res.set('Vary', cacheHeaders['Vary'])
    sendConditionalList(req, res, body, { cacheHit: listCacheHit })
  } catch (error) {
    logger.error({ err: error }, 'Get contests error:')
    res.status(500).json({ error: 'Failed to fetch contests' })
  }
})

// Get contests for calendar view (filtered by date range)
router.get('/calendar', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }) // NARROW-READ half1
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const { start, end } = req.query

    if (!start || !end) {
      res.status(400).json({ error: 'start and end query params are required' })
      return
    }
    const startDate = new Date(start as string)
    const endDate = new Date(end as string)
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      res.status(400).json({ error: 'start and end must be valid ISO dates' })
      return
    }
    if (startDate > endDate) {
      res.status(400).json({ error: 'start must be before end' })
      return
    }

    let where: any = {}

    // Filter by college based on role — include fallback for users without collegeId
    if (user.role === 'SUPER_ADMIN') {
      const qCollege = (getSuperAdminTargetCollegeId(req as any) as string | undefined) || (req.query.collegeId as string | undefined)
      if (qCollege) where.OR = [{ collegeId: qCollege }, { collegeId: null }]
    } else if (user.collegeId) {
      where.OR = [{ collegeId: user.collegeId }, { collegeId: null }]
    } else {
      // No collegeId: only global contests (collegeId null) plus own created
      where.OR = [{ collegeId: null }, { creatorId: req.userId }]
    }

    // Filter by date range — startTime is stored as ISO string, lexicographic compare works for ISO
    where.startTime = {
      gte: startDate.toISOString(),
      lte: endDate.toISOString(),
    }

    const contests = await prisma.codingContest.findMany({
      where,
      include: {
        creator: { select: { name: true, email: true } },
      },
      orderBy: { startTime: 'asc' },
      // HALF1: bound calendar scan (was unbounded). Date-range already narrows, take:200
      // guards pathological ranges without changing normal-month payloads.
      take: 200,
    })

    // Add registrations count (number of solutions as a proxy)
    const contestsWithCounts = contests.map((contest) => {
      // Order 3: solutions is Json array (helper covers legacy String).
      const solutions = readSolutionsArray((contest as any).solutions)
      const solutionsCount = Array.isArray(solutions) ? solutions.length : 0
      return {
        ...contest,
        solutionsCount,
      }
    })

    res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
    res.json(contestsWithCounts)
  } catch (error) {
    logger.error({ err: error }, 'Get calendar contests error:')
    res.status(500).json({ error: 'Failed to fetch calendar contests' })
  }
})

// Get contests by date — returns contests matching local date (YYYY-MM-DD)
router.get('/by-date/:date', async (req: AuthRequest, res: Response) => {
  try {
    const _user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }) // NARROW-READ half1
    if (!_user) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    const dateStr = String(req.params.date || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD' })
      return
    }
    const dayStart = new Date(`${dateStr}T00:00:00.000Z`)
    const dayEnd = new Date(`${dateStr}T23:59:59.999Z`)
    if (isNaN(dayStart.getTime())) {
      res.status(400).json({ error: 'Invalid date' })
      return
    }
    let where: any = {
      startTime: { gte: dayStart.toISOString(), lte: dayEnd.toISOString() },
    }
    if (_user.role !== 'SUPER_ADMIN') {
      if (_user.collegeId) where = { AND: [where, { OR: [{ collegeId: _user.collegeId }, { collegeId: null }] }] }
      else where = { AND: [where, { OR: [{ collegeId: null }, { creatorId: req.userId }] }] }
    }
    const contests = await prisma.codingContest.findMany({
      where,
      include: { creator: { select: { name: true, email: true } } },
      orderBy: { startTime: 'asc' },
      // HALF1: bound single-day scan (was unbounded). One day never exceeds 50 in practice.
      take: 50,
    })
    res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
    res.json(contests)
  } catch (error) {
    logger.error({ err: error }, 'Get contests by date error:')
    res.status(500).json({ error: 'Failed to fetch contests by date' })
  }
})

// Participant count per ENDED contest (batched O(m+n) + grouped, college-scoped)
router.get('/participant-counts', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }) // NARROW-READ half1
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    // College scoping: counts should only include participations from same college (privacy)
    const scopedCollegeForCounts = user.role === 'SUPER_ADMIN' ? (getSuperAdminTargetCollegeId(req as any) as string | undefined) : null
    let collegeFilter: any = {}
    if (scopedCollegeForCounts) {
      collegeFilter = { user: { collegeId: scopedCollegeForCounts } }
    } else if (user.role !== 'SUPER_ADMIN' && user.collegeId) {
      collegeFilter = { user: { collegeId: user.collegeId } }
    }
    // Build contest where with college scoping
    let contestWhere: any = { status: 'ENDED' }
    if (scopedCollegeForCounts) {
      contestWhere = { status: 'ENDED', OR: [{ collegeId: scopedCollegeForCounts }, { collegeId: null }] }
    } else if (user.role !== 'SUPER_ADMIN' && user.collegeId) {
      contestWhere = { status: 'ENDED', OR: [{ collegeId: user.collegeId }, { collegeId: null }] }
    } else if (user.role !== 'SUPER_ADMIN' && !user.collegeId) {
      contestWhere = { status: 'ENDED', OR: [{ collegeId: null }, { creatorId: req.userId }] }
    }
    const [contests, participations] = await Promise.all([
      prisma.codingContest.findMany({
        where: contestWhere,
        select: { id: true, title: true, url: true, platform: true },
      }),
      prisma.contestParticipation.findMany({
        where: collegeFilter,
        select: { platform: true, contestName: true, contestUrl: true },
      }),
    ])
    res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60')
    res.set('Vary', 'Authorization')

    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
    const normUrl = (u: string) => u.replace(/\/+$/, '').toLowerCase()

    const byPlatform = new Map<string, { n: string; u: string | null }[]>()
    for (const p of participations) {
      const key = (p.platform || '').toLowerCase()
      if (!byPlatform.has(key)) byPlatform.set(key, [])
      byPlatform.get(key)!.push({ n: normalize(p.contestName), u: p.contestUrl ? normUrl(p.contestUrl) : null })
    }

    // Order 7 snapshot contract: participations carry snapshot contestName/contestUrl (asOf syncedAt); canonical is CodingContest when contestId set.
    // Fuzzy match below prefers exact URL/title (canonical) over includes — same rule as resolveContestDisplay() (validators.ts).
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
    logger.error({ err: error }, 'Participant counts error:')
    res.status(500).json({ error: 'Failed to compute participant counts' })
  }
})

// #6 contest alarms — remind-me CRUD (must sit BEFORE GET /:id so the
// two-segment /reminders/* paths never fall through to the single-segment
// param route; functionally distinct but ordering documents intent).
const remindersDb = () => (prisma as any).contestReminder

// List my reminders (with contest for title/time/GCal). Scoped by userId —
// no college filter needed (rows are per-user; contest visibility was checked
// at create time; deleted contests cascade away).
router.get('/reminders/mine', async (req: AuthRequest, res: Response) => {
  try {
    const rows = await remindersDb().findMany({
      where: { userId: req.userId },
      include: { contest: { select: { id: true, title: true, platform: true, url: true, startTime: true, duration: true } } },
      orderBy: { remindAt: 'asc' },
      take: 100,
    })
    res.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
    res.json(rows)
  } catch (error) {
    logger.error({ err: error }, 'List contest reminders error:')
    res.status(500).json({ error: 'Failed to fetch reminders' })
  }
})

// Create (idempotent) a remind-me for one contest.
// Body: { minutesBefore: 15 | 60 | 1440 }. Same triple returns 200 existing.
router.post('/:id/remind', async (req: AuthRequest, res: Response) => {
  try {
    const minutesBefore = parseMinutesBefore((req.body as any)?.minutesBefore)
    if (!minutesBefore) {
      res.status(400).json({ error: 'minutesBefore must be one of 15, 60, 1440' })
      return
    }
    const [user, contest] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }),
      prisma.codingContest.findUnique({ where: { id: req.params.id as string } }),
    ])
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    if (!contest || !canUserSeeContest(user as any, contest as any)) {
      // 404 (not 403) so college-scoped ids are not enumerable.
      res.status(404).json({ error: 'Contest not found' })
      return
    }
    const checked = validateReminderRequest(minutesBefore, contest as any, new Date())
    if ('error' in checked) {
      res.status(checked.status).json({ error: checked.error })
      return
    }
    const existing = await remindersDb().findUnique({
      where: { userId_contestId_minutesBefore: { userId: req.userId!, contestId: contest.id, minutesBefore } },
    })
    if (existing) {
      res.json(existing)
      return
    }
    const created = await remindersDb().create({
      data: {
        userId: req.userId!,
        contestId: contest.id,
        minutesBefore,
        remindAt: checked.remindAt,
        sent: false,
      },
    })
    res.status(201).json(created)
  } catch (error: any) {
    // Unique race (two tabs POST at once) → return the winner, not 500.
    if (error?.code === 'P2002') {
      try {
        const winner = await remindersDb().findFirst({
          where: { userId: req.userId, contestId: req.params.id as string },
          orderBy: { createdAt: 'desc' },
        })
        if (winner) {
          res.json(winner)
          return
        }
      } catch { /* fall through */ }
    }
    logger.error({ err: error }, 'Create contest reminder error:')
    res.status(500).json({ error: 'Failed to create reminder' })
  }
})

// Delete my reminder. 404 when missing OR owned by someone else (no leak).
router.delete('/reminders/:reminderId', async (req: AuthRequest, res: Response) => {
  try {
    const row = await remindersDb().findUnique({ where: { id: req.params.reminderId as string } })
    if (!row || row.userId !== req.userId) {
      res.status(404).json({ error: 'Reminder not found' })
      return
    }
    await remindersDb().delete({ where: { id: row.id } })
    res.json({ message: 'Reminder deleted' })
  } catch (error) {
    logger.error({ err: error }, 'Delete contest reminder error:')
    res.status(500).json({ error: 'Failed to delete reminder' })
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
    // HALF1: user + existing independent → Promise.all (was sequential).
    const [user, existing] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }), // NARROW-READ half1
      prisma.codingContest.findUnique({ where: { id: req.params.id as string } }),
    ])
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    if (!existing) {
      res.status(404).json({ error: 'Contest not found' })
      return
    }

    const isOwner = existing.creatorId === req.userId
    const isAdmin = user.role === 'COLLEGE_ADMIN' || user.role === 'SUPER_ADMIN'
    const isCollegeTeacher = user.role === 'TEACHER' && existing.collegeId && existing.collegeId === user.collegeId

    if (!isOwner && !isAdmin && !isCollegeTeacher) {
      res.status(403).json({ error: 'You do not have permission to edit this contest' })
      return
    }

    const { title, platform, url, startTime, duration, contestType, status, solutions } = req.body

    // Validate fields if provided
    if (platform !== undefined && !isValidPlatform(platform)) {
      res.status(400).json({ error: `Invalid platform. Allowed: ${PLATFORMS.join(', ')}` })
      return
    }
    if (url !== undefined && !isValidUrl(url)) {
      res.status(400).json({ error: 'Invalid url' })
      return
    }
    if (startTime !== undefined) {
      const d = new Date(startTime)
      if (isNaN(d.getTime())) { res.status(400).json({ error: 'Invalid startTime' }); return }
    }
    if (duration !== undefined && duration !== null && duration !== '' && parseDuration(duration) == null) {
      res.status(400).json({ error: 'Invalid duration' }); return
    }
    if (status !== undefined && !VALID_STATUSES.includes(String(status).toUpperCase() as any)) {
      res.status(400).json({ error: `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}` }); return
    }
    if (solutions !== undefined && !Array.isArray(solutions)) {
      res.status(400).json({ error: 'solutions must be an array' }); return
    }

    const sanitizedData: any = {}
    if (title !== undefined) sanitizedData.title = String(title).trim()
    // Already 400-validated above; re-validate against the REAL enums so
    // drift fails closed (never writes a raw upper-cased ghost string).
    if (platform !== undefined) sanitizedData.platform = toPlatformEnumStrict(platform)
    if (url !== undefined) sanitizedData.url = String(url).trim()
    if (startTime !== undefined) { const _sd = new Date(startTime as any); if (!Number.isNaN(_sd.getTime())) { sanitizedData.startTime = _sd.toISOString(); (sanitizedData as any).startAt = _sd } }
    if (duration !== undefined) sanitizedData.duration = parseDuration(duration)
    if (contestType !== undefined) sanitizedData.contestType = contestType ? String(contestType).toUpperCase() : null
    if (status !== undefined) sanitizedData.status = toContestStatusEnum(status)
    else if (startTime !== undefined || duration !== undefined) {
      // Auto-recompute status if time changed and status not explicitly set
      const s = sanitizedData.startTime ?? existing.startTime
      const d = sanitizedData.duration !== undefined ? sanitizedData.duration : existing.duration
      sanitizedData.status = computeStatus(s, d)
    }
    if (solutions !== undefined) sanitizedData.solutions = solutions as any

    const updated = await prisma.codingContest.update({
      where: { id: req.params.id as string },
      // Order 3: canonical Json array. sanitizedData carries every validated
      // field (topbottom F1: a previous revision wrote only {solutions} here,
      // silently dropping title/platform/url/startTime/duration/status edits).
      data: sanitizedData,
    })
    try { broadcastContestMutation({ contestId: updated.id, action: 'updated', collegeId: (updated as any).collegeId ?? (user as any)?.collegeId ?? null }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    try { void bustContestsList(listScopeForUser(user as any)); void bustContestsList('global') } catch {}

    res.json(updated)
  } catch (error) {
    logger.error({ err: error }, 'Update contest error:')
    res.status(500).json({ error: 'Failed to update contest' })
  }
})

// Bulk replace solutions for a contest
router.put('/:id/solutions', async (req: AuthRequest, res: Response) => {
  try {
    // HALF1: contest + user independent → Promise.all (was sequential).
    const [contest, user] = await Promise.all([
      prisma.codingContest.findUnique({ where: { id: req.params.id as string } }),
      prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }), // NARROW-READ half1
    ])
    if (!contest) {
      res.status(404).json({ error: 'Contest not found' })
      return
    }

    const isOwner = contest.creatorId === req.userId
    const isAdmin = user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'
    const isTeacherSameCollege = user?.role === 'TEACHER' && !!user.collegeId && contest.collegeId === user.collegeId

    if (!isOwner && !isAdmin && !isTeacherSameCollege) {
      res.status(403).json({ error: 'Only teachers of the same college can update solutions' })
      return
    }

    const { solutions } = req.body

    if (!Array.isArray(solutions)) {
      res.status(400).json({ error: 'solutions must be an array' })
      return
    }
    if (solutions.length > 100) {
      res.status(400).json({ error: 'Too many solutions (max 100)' })
      return
    }
    // Validate each solution entry
    for (let i = 0; i < solutions.length; i++) {
      const s = solutions[i]
      if (!s || typeof s !== 'object') { res.status(400).json({ error: `solutions[${i}] must be an object` }); return }
      const url = s.solutionUrl || s.url
      if (url && typeof url === 'string' && !isValidUrl(url)) { res.status(400).json({ error: `solutions[${i}].url invalid` }); return }
    }

    const updated = await prisma.codingContest.update({
      where: { id: req.params.id as string },
      // Order 3: canonical Json array.
      data: { solutions: solutions as any },
    })
    try { broadcastContestMutation({ contestId: updated.id, action: 'solutions:updated', collegeId: (updated as any).collegeId ?? (user as any)?.collegeId ?? (contest as any)?.collegeId ?? null }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    try { void bustContestsList(listScopeForUser(user as any)); void bustContestsList('global') } catch {}

    res.json(updated)
  } catch (error) {
    logger.error({ err: error }, 'Bulk replace solutions error:')
    res.status(500).json({ error: 'Failed to replace solutions' })
  }
})

// Delete coding contest
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    // HALF1: contest + user independent → Promise.all (was sequential).
    const [contest, user] = await Promise.all([
      prisma.codingContest.findUnique({ where: { id: req.params.id as string } }),
      prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }), // NARROW-READ half1
    ])
    if (!contest) {
      res.status(404).json({ error: 'Contest not found' })
      return
    }

    const isOwner = contest.creatorId === req.userId
    const isAdmin = user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'

    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: 'You do not have permission to delete this contest' })
      return
    }
    // Auto-fetched contests are global; only SUPER_ADMIN may delete them (prevents accidental mass delete)
    if (contest.isAutoFetched && user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Auto-fetched contests can only be deleted by SUPER_ADMIN' })
      return
    }

    await prisma.codingContest.delete({ where: { id: req.params.id as string } })
    try { broadcastContestMutation({ contestId: req.params.id as string, action: 'deleted', collegeId: (contest as any)?.collegeId ?? (user as any)?.collegeId ?? null }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    try { void bustContestsList(listScopeForUser(user as any)); void bustContestsList('global') } catch {}
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

    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }) // NARROW-READ half1
    const isOwner = contest.creatorId === req.userId
    const isAdmin = user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'
    const isTeacherSameCollege = user?.role === 'TEACHER' && !!user.collegeId && contest.collegeId === user.collegeId
    const isTeacherGlobal = user?.role === 'TEACHER' && !contest.collegeId

    if (!isOwner && !isAdmin && !isTeacherSameCollege && !isTeacherGlobal) {
      res.status(403).json({ error: 'Only teachers of the same college can add solutions' })
      return
    }

    const { problemName, solutionUrl, language } = req.body

    if (!problemName || !solutionUrl) {
      res.status(400).json({ error: 'problemName and solutionUrl are required' })
      return
    }
    if (typeof problemName !== 'string' || problemName.trim().length < 2 || problemName.trim().length > 200) {
      res.status(400).json({ error: 'problemName must be 2-200 characters' })
      return
    }
    if (typeof solutionUrl !== 'string' || !isValidUrl(solutionUrl)) {
      res.status(400).json({ error: 'solutionUrl must be a valid http(s) URL' })
      return
    }
    if (!/youtu\.?be/i.test(solutionUrl)) {
      res.status(400).json({ error: 'solutionUrl must be a YouTube link' })
      return
    }

    let solutions: any[] = readSolutionsArray((contest as any).solutions)
    if (solutions.length >= 100) {
      res.status(400).json({ error: 'Solution limit reached (100)' })
      return
    }
    // Dedupe by URL: prevent duplicate YouTube links
    const normNew = solutionUrl.trim().toLowerCase().replace(/\/+$/, '')
    if (solutions.some((s: any) => String(s.url || s.solutionUrl || '').trim().toLowerCase().replace(/\/+$/, '') === normNew)) {
      res.status(409).json({ error: 'This solution URL already exists for the contest' })
      return
    }

    const meta = await fetchYouTubeMeta(solutionUrl)

    solutions.push({
      problemName: String(problemName).trim(),
      solutionUrl: String(solutionUrl).trim(),
      url: String(solutionUrl).trim(),
      title: String(problemName).trim(),
      videoId: extractYouTubeId(solutionUrl) || undefined,
      thumbnail: meta.thumbnail || '',
      duration: meta.duration ?? null,
      autoTitle: meta.title || '',
      language: language ? String(language).trim().slice(0, 30) : '',
      addedBy: req.userId,
      addedAt: new Date().toISOString(),
    })

    const updated = await prisma.codingContest.update({
      where: { id: req.params.id as string },
      // Order 3: canonical Json array.
      data: { solutions: solutions as any },
    })
    try { broadcastContestMutation({ contestId: updated.id, action: 'solution:added', collegeId: (updated as any).collegeId ?? (contest as any)?.collegeId ?? (user as any)?.collegeId ?? null }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    try { void bustContestsList(listScopeForUser(user as any)); void bustContestsList('global') } catch {}

    res.json(updated)
  } catch (error) {
    logger.error({ err: error }, 'Add solution error:')
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

    let solutionsArr: any[] = readSolutionsArray((contest as any).solutions)
    const rawIdx = String(req.params.solutionIndex || '').trim()
    const solutionIndex = parseInt(rawIdx, 10)
    if (!Number.isInteger(solutionIndex)) {
      res.status(400).json({ error: 'Invalid solution index' })
      return
    }
    if (solutionIndex < 0 || solutionIndex >= solutionsArr.length) {
      res.status(400).json({ error: 'Invalid solution index' })
      return
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }) // NARROW-READ half1
    const isOwner = contest.creatorId === req.userId
    const isAdmin = user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'
    const isAdder = solutionsArr[solutionIndex]?.addedBy === req.userId
    const isTeacherSameCollege = user?.role === 'TEACHER' && !!user.collegeId && contest.collegeId === user.collegeId

    if (!isOwner && !isAdmin && !isAdder && !isTeacherSameCollege) {
      res.status(403).json({ error: 'You do not have permission to remove solutions' })
      return
    }

    const solutions = [...solutionsArr]
    solutions.splice(solutionIndex, 1)

    const updated = await prisma.codingContest.update({
      where: { id: req.params.id as string },
      // Order 3: canonical Json array.
      data: { solutions: solutions as any },
    })
    try { broadcastContestMutation({ contestId: updated.id, action: 'solution:removed', collegeId: (updated as any).collegeId ?? (contest as any)?.collegeId ?? (user as any)?.collegeId ?? null }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    try { void bustContestsList(listScopeForUser(user as any)); void bustContestsList('global') } catch {}

    res.json(updated)
  } catch (error) {
    logger.error({ err: error }, 'Remove solution error:')
    res.status(500).json({ error: 'Failed to remove solution' })
  }
})

// In-memory lock + per-user throttle to prevent spam if many users/teachers hit Fetch Latest simultaneously.
// Cron (every 6h via runContestsJob + Render Cron) is the primary updater — this endpoint is manual override only.
let fetchNowInProgress = false
let lastFetchNowAt = 0
const lastFetchByUser = new Map<string, number>()
// Auto-fetch upcoming contests from competitive programming platforms — delegates to central fetcher (all 3 platforms)
router.post('/fetch-now', fetchNowRateLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can auto-fetch contests' })
      return
    }

    const now = Date.now()
    // In-progress lock (prevents concurrent external API thrash)
    if (fetchNowInProgress) {
      res.set('Retry-After', '5')
      res.status(429).json({ error: 'Contest fetch already in progress. Try again shortly.' })
      return
    }
    // Global throttle: at most once per 30s per server (prevents UI double-click + multi-teacher stampede)
    if (now - lastFetchNowAt < 30 * 1000) {
      const retry = Math.ceil((30 * 1000 - (now - lastFetchNowAt)) / 1000)
      res.set('Retry-After', String(retry))
      res.status(429).json({ error: `Fetch throttled. Try again in ${retry}s.` })
      return
    }
    // Per-user throttle: even if global window passed, same user must wait 30s (stops single spammer looping)
    const lastUserAt = lastFetchByUser.get(req.userId!) || 0
    if (now - lastUserAt < 30 * 1000) {
      const retry = Math.ceil((30 * 1000 - (now - lastUserAt)) / 1000)
      res.set('Retry-After', String(retry))
      res.status(429).json({ error: `Fetch throttled for your account. Try again in ${retry}s.` })
      return
    }
    fetchNowInProgress = true
    lastFetchNowAt = now
    lastFetchByUser.set(req.userId!, now)

    // Use shared service that fetches LeetCode + Codeforces + CodeChef and handles upserts/status
    let result: any
    try {
      result = await fetchAndStoreContests()
    } finally {
      fetchNowInProgress = false
    }
    // P0-B: bust shared 5m list so next list sees fresh rows (TTL backstop 5m).
    // Fetch-now is global (all scopes) — bust caller + global best-effort.
    try { void bustContestsList(listScopeForUser(user as any)); void bustContestsList('global') } catch {}
    // P0-D: fetched contests are global (collegeId null) — pass explicit null
    // so the emit stays global by intent (not by missing-field fallback).
    try { broadcastContestMutation({ action: 'fetched', fetched: result.fetched, updated: result.updated, collegeId: null }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }

    res.json({
      message: `Fetched ${result.fetched} new contests (${result.updated} updated)`,
      ...result,
    })
  } catch (error) {
    // Ensure lock released on throw (already via finally), but also clear if we never entered fetch
    fetchNowInProgress = false
    logger.error({ err: error }, 'Auto-fetch contests error:')
    res.status(500).json({ error: 'Failed to auto-fetch contests' })
  }
})

export default router
