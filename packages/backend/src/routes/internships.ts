import { Router, Response } from 'express'
import rateLimit from 'express-rate-limit'
import prisma, { withRetry } from '../config/db'
import { cache, createCacheRateLimitStore, getOrSet } from '../lib/cache'

// PERF (prod burst fix): staging counts cache — this endpoint ran an unbounded
// full-table findMany scan per call, polled per viewer. Now computed at most
// 1×/60s per scope (shared via Redis when healthy, memory otherwise — same seam
// as super-dashboard). Exact same numbers; TTL-only expiry.
const STAGING_COUNTS_CACHE_TTL_MS = 60_000
import { coerceDeadline, normalizeDepartments, normalizeYears, parseJsonArraySafe, parseJsonNumberArraySafe, coerceStartAt } from '../lib/validators'
import { authenticate, AuthRequest } from '../middleware/auth'
import ExcelJS from 'exceljs'
import { chatCompletion } from '../ai/client'
import { canAccessCollege, deriveCollegeId, getSuperAdminTargetCollegeId, safeFilename, escapeExcelValue, contentDisposition } from '../utils/roles'
import { validateExternalUrl } from '../utils/secureUrl'
import { broadcastInternshipMutation } from '../services/socket'
import {
  stagingCountsKey,
  scopeForUser,
  buildCountsEtag,
  isCountsNotModified,
  bustStagingCountsForUser,
} from '../services/stagingCounts'
import {
  INTERNSHIPS_LIST_TTL_MS,
  internshipsListKey,
  getInternshipsListVersion,
  bustInternshipsList,
  listScopeForUser,
} from '../services/listCache'
import { logger } from '../utils/logger'
import { parseStagingParams, buildStagingWhere, buildStagingFindArgs, buildStagingPage } from '../services/opportunities/staging'
import { normalizeSource } from '../services/opportunities/dedup'
import { resolveDecisionCollegeId, canDecideForCollege, canAccessDecisionCollege, buildOwnPublishedWhere, findDecision, upsertDecision, listDecisionsForCollege } from '../services/opportunities/decisions'
import { notifyUsers } from '../services/notificationService'
import { parseMineParam, applyMineFilter, unregisterRoleError, remindRoleError, validateRemindMessage, buildRemindNotification, registeredUserIds } from '../services/opportunities/registrations'
import { stagingStore } from '../repositories/stagingRepository'
import { buildFetchDetailsPrompt, validateFetchDetails, buildInternshipDeterministicFallback, searchOpportunityDetails, toFetchDetailsEnvelope, isAiNotConfiguredResponse } from '../services/opportunities/fetchDetails'
import { sendConditionalList } from '../services/conditionalGet'

const router = Router()
router.use(authenticate)

// SSRF fetch-details rate limit: 10/hour per IP+user (audit HIGH #2)
// Redis-ready: shared cache backend (single InMemory now, Redis later).
const fetchLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: createCacheRateLimitStore(cache, 60 * 60 * 1000, 'rl:intern-fetch:'),
  message: { error: 'Too many fetch attempts, please try again later' },
})

// AI now uses AI Manager routing via src/ai/client.ts

// GET / - List internships (paginated, indexed, eligibility-aware)
// SUPER_ADMIN: global view (or ?collegeId= filter), bypasses tenant isolation
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const isSuper = user.role === 'SUPER_ADMIN'
    const filterCollegeId = isSuper ? ((getSuperAdminTargetCollegeId(req) as string | undefined) || (req.query.collegeId as string | undefined)) : undefined

    if (!isSuper && !user.collegeId) {
      res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
      res.json({ data: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } })
      return
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20))
    const skip = (page - 1) * limit
    const search = (req.query.search as string)?.trim()

    let where: any = {}
    if (isSuper) {
      if (filterCollegeId) where = { collegeId: filterCollegeId }
      // else {} — global across all colleges, plus null global internships
    } else {
      where = { collegeId: user.collegeId }
    }
    if (search) {
      const s: any = { contains: search, mode: 'insensitive' }
      const searchClause = { OR: [{ title: s }, { company: s }, { role: s }] } as any
      if (isSuper && !filterCollegeId) {
        where = searchClause
      } else {
        const baseCollege = isSuper && filterCollegeId ? { collegeId: filterCollegeId } : { collegeId: user.collegeId }
        where = { AND: [baseCollege, searchClause] }
      }
    }

    // ?mine=true — own registrations only (register leftovers #5).
    // ANDs the college/search where with `{ registrations: { some: { userId } } }`.
    // Mine view skips eligibility filtering below so students always see their
    // own registrations even if targeting changed after they registered.
    const mineOnly = parseMineParam(req.query)
    where = applyMineFilter(where, req.userId!, mineOnly)

    // P0-B: shared 5m list cache (tenant-segmented + versioned). userId segments
    // STUDENT eligibility filtering + ?mine=true (per-user where).
    const listScope = listScopeForUser(user as any, filterCollegeId || null)
    let listGen = 0
    try {
      listGen = await getInternshipsListVersion(listScope)
    } catch {}
    const sharedKey = internshipsListKey({
      scope: listScope,
      userId: req.userId,
      search,
      mine: mineOnly ? 'true' : '',
      page,
      limit,
      gen: listGen,
    })
    let listCacheHit = true
    const cachedBody = await getOrSet(sharedKey, INTERNSHIPS_LIST_TTL_MS, async () => {
      listCacheHit = false
      // Use _count instead of loading full registrations arrays; include only current user's registration flag via _count filtered?
      // Fetch total + page data with count aggregation
      const [all, totalRaw] = await Promise.all([
        prisma.internship.findMany({
          where,
          include: {
            _count: { select: { registrations: true } },
            registrations: { where: { userId: req.userId }, select: { id: true, status: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.internship.count({ where }),
      ])

      // Eligibility filtering must happen before pagination for correctness, but doing in DB is not possible with JSON strings.
      // Optimized: fetch count-aware page then filter, and if student filtering reduces too much, fetch extra.
      // For now filter the page slice (fast path); total will be adjusted for student view.
      let internships: any[] = all
      let total = totalRaw
      if (user.role === 'STUDENT' && user.departmentId && !mineOnly) {
        // AI-code aware (CSE/IT/ALL → departmentIds); direct includes() misses enriched rows.
        const { isDepartmentEligible, getCollegeDepartments } = await import('../utils/eligibility')
        const collegeDepts = await getCollegeDepartments(user.collegeId)
        // Order 3: canonical Json arrays (helpers accept Json or legacy String, never throw).
        const isEligibleRow = (tDepts: unknown, tYears: unknown, enabled: boolean) => {
          if (!enabled) return true
          const depts = parseJsonArraySafe(tDepts)
          const years = parseJsonNumberArraySafe(tYears)
          const deptMatch = depts.length === 0 || isDepartmentEligible(depts, user.departmentId, collegeDepts)
          const currentYear = user.incomingYear ? Math.min(new Date().getFullYear() - user.incomingYear + 1, 4) : 1
          const yearMatch = years.length === 0 || years.includes(currentYear)
          return deptMatch && yearMatch
        }
        const filtered = all.filter((i) => isEligibleRow(i.targetDepartments, i.targetYears, i.eligibilityEnabled))
        // If filtering removed items, we still return filtered page; total is at least filtered length for UI.
        // For accuracy, compute filtered total by scanning all ids when needed (only once)
        internships = filtered
        // For filtered total, do a full scan only when page===1 to avoid O(n) on every page; otherwise estimate
        if (page === 1) {
          const allForCount = await prisma.internship.findMany({
            where: { collegeId: user.collegeId! },
            select: { targetDepartments: true, targetYears: true, eligibilityEnabled: true },
          })
          total = allForCount.filter((i) => isEligibleRow(i.targetDepartments, i.targetYears, i.eligibilityEnabled)).length
        }
      }

      const data = internships.map((i: any) => ({
        ...i,
        registrationsCount: i._count?.registrations ?? 0,
        registrations: i.registrations, // keep user's own registration for isRegistered check
        _count: undefined,
        // Deadline is DateTime after 10k migration (was String): coerce handles both during rollout.
        computedStatus: i.status === 'ENDED' || (() => { const d = coerceDeadline(i.deadline); return !!d && d < new Date() })() ? 'ENDED' : 'ACTIVE',
      }))

      const pages = Math.ceil(total / limit)
      return {
        data,
        pagination: { page, limit, total, pages },
      }
    })
    const { data, pagination } = cachedBody as { data: any; pagination: { page: number; limit: number; total: number; pages: number } }
    const pages = pagination.pages
    const makeLink = (p: number) => {
      const params = new URLSearchParams({ page: String(p), limit: String(limit) })
      if (search) params.set('search', search)
      return `<${req.baseUrl}${req.path}?${params.toString()}>`
    }
    const links: string[] = []
    if (page < pages) links.push(`${makeLink(page + 1)}; rel="next"`)
    if (page > 1) links.push(`${makeLink(page - 1)}; rel="prev"`)
    links.push(`${makeLink(1)}; rel="first"`)
    if (pages > 0) links.push(`${makeLink(pages)}; rel="last"`)
    if (links.length) res.set('Link', links.join(', '))
    // Backward compat: if client didn't request pagination, also support ?page-less callers expecting array
    // But we always return paginated; frontend will handle both shapes.
    // P0 SECURITY (F11): authenticated list — private only, never s-maxage.
    // P0-B: 60s browser + SWR (was 15s) pairs with 5m shared getOrSet.
    // P0-D selective 304: cachedBody is Redis-memoized (HIT = 0 Postgres).
    res.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=30')
    sendConditionalList(req, res, { data, pagination }, { cacheHit: listCacheHit })
  } catch (error) {
    logger.error({ err: error }, 'Error listing internships:')
    res.status(500).json({ error: 'Failed to list internships' })
  }
})

// GET /staging - List staging internships with pagination (admin/teacher only)
router.get('/staging', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }

    // Real offset pagination on the staging SSOT (services/opportunities/staging.ts).
    // No deadline filter for admin staging — show all pending including expired
    // (visually marked Expired). Past-year titles excluded DB-side (parity with
    // hackathons staging); in-memory filtering stays out of paging logic.
    const { page, limit, skip } = parseStagingParams(
      req.query as { page?: unknown; limit?: unknown; cursor?: unknown },
    )
    const status = req.query.status as string | undefined
    // Per-college decisions: pending = no decision by MY college (global row
    // stays ACTIVE/DRAFT/PENDING; A approve/reject never hides it from B).
    const isSuper = user.role === 'SUPER_ADMIN'
    const decisionCollegeId = !isSuper ? (user.collegeId || null) : null
    let scopedWhere: Record<string, unknown>
    try {
      scopedWhere = buildStagingWhere(
        {
          status,
          collegeId: user.collegeId,
          isSuperAdmin: isSuper,
          ...(decisionCollegeId ? { decisionCollegeId } : {}),
        },
        { pendingStatuses: ['DRAFT', 'PENDING', 'ACTIVE'] },
      ).scopedWhere
    } catch {
      scopedWhere = buildStagingWhere(
        { status, collegeId: user.collegeId, isSuperAdmin: isSuper },
        { pendingStatuses: ['DRAFT', 'PENDING', 'ACTIVE'] },
      ).scopedWhere
    }

    const findArgs = buildStagingFindArgs({ scopedWhere, page, limit, skip, cursor: null })
    // DIP: staging list/count via StagingListStore (same contract as hackathons).
    let rows: unknown[]
    let total: number
    try {
      ;[rows, total] = await Promise.all([
        stagingStore.listInternshipStaging(findArgs),
        stagingStore.countInternshipStaging(scopedWhere),
      ])
    } catch (e: any) {
      const msg = String(e?.message || e || '')
      if (msg.includes('decisions') || (e as any)?.code === 'P2021' || msg.includes('InternshipStagingDecision')) {
        const legacy = buildStagingWhere(
          { status, collegeId: user.collegeId, isSuperAdmin: isSuper },
          { pendingStatuses: ['DRAFT', 'PENDING', 'ACTIVE'] },
        ).scopedWhere
        const legacyArgs = buildStagingFindArgs({ scopedWhere: legacy, page, limit, skip, cursor: null })
        ;[rows, total] = await Promise.all([
          stagingStore.listInternshipStaging(legacyArgs),
          stagingStore.countInternshipStaging(legacy),
        ])
      } else {
        throw e
      }
    }
    const { pageRows } = buildStagingPage({
      rows: rows as Array<{ id: string }>,
      filtered: rows as Array<{ id: string }>,
      total,
      page,
      limit,
      cursor: null,
    })

    res.json({
      data: pageRows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    logger.error({ err: error }, 'Get staging internships error')
    res.status(500).json({ error: 'Failed to fetch staging internships' })
  }
})

// GET /staging/counts - Get staging counts (independent of pagination)
// P0-A: ETag 304 for the slow-poll fallback (socket-dead path). See hackathons.ts.
router.get('/staging/counts', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    // Per-college decisions make college scoping exact, so the 60s cache key
    // is per scope (global for SUPER_ADMIN, per college otherwise).
    const scope = scopeForUser(user as any)
    const counts = await getOrSet(stagingCountsKey('int', scope), STAGING_COUNTS_CACHE_TTL_MS, async () => {
      // No deadline filter — counts must reflect all pending including expired
      let countsWhere: any = {}
      if (user && user.role !== 'SUPER_ADMIN') {
        countsWhere = { OR: [{ collegeId: user.collegeId }, { collegeId: null }] }
      }
      const all = await prisma.internshipStaging.findMany({
        select: { id: true, targetDepartments: true, status: true },
        where: countsWhere,
      })
      // Per-college decisions: pending = no decision by MY college.
      let myDecisions = new Map<string, string>()
      if (user && user.role !== 'SUPER_ADMIN' && user.collegeId) {
        try {
          myDecisions = await listDecisionsForCollege(prisma as any, 'internshipStagingDecision', user.collegeId)
        } catch {
          myDecisions = new Map<string, string>()
        }
      }
      let total = 0, enriched = 0, pending = 0, approved = 0, rejected = 0
      for (const item of all) {
        // Order 3: canonical Json (helper accepts Json or legacy String).
        const depts = parseJsonArraySafe((item as any).targetDepartments)
        total++
        if (depts.length > 0) enriched++
        const mine = myDecisions.get((item as any).id)
        if (mine === 'APPROVED') { approved++; continue }
        if (mine === 'REJECTED') { rejected++; continue }
        if ((item as any).status === 'APPROVED') approved++
        else if ((item as any).status === 'REJECTED') rejected++
        else if (depts.length > 0) pending++
      }
      return { total, enriched, pending, approved, rejected }
    })
    // P0-A fallback poll: ETag + private SWR (fail-open — hashing never blocks).
    try {
      const etag = buildCountsEtag(counts as any)
      res.set('ETag', etag)
      res.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=30')
      res.set('Vary', 'Accept-Encoding, Authorization')
      if (isCountsNotModified(req.headers['if-none-match'], etag)) {
        res.status(304).end()
        return
      }
    } catch {}
    res.json(counts)
  } catch (error) {
    logger.error({ err: error }, 'Error fetching internship staging counts:')
    res.status(500).json({ error: 'Failed to fetch counts' })
  }
})

// GET /staging/:id - Get single staging internship (F15: tenant gate)
router.get('/staging/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }

    const internship = await prisma.internshipStaging.findUnique({
      where: { id: req.params.id as string },
    })
    if (!internship) {
      res.status(404).json({ error: 'Staging internship not found' })
      return
    }
    if ((internship as any).collegeId && !canAccessCollege(user as any, (internship as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    let myDecision: string | null = null
    if (user.role !== 'SUPER_ADMIN' && user.collegeId) {
      try {
        const d = await findDecision(prisma as any, 'internshipStagingDecision', (internship as any).id, user.collegeId)
        myDecision = d?.decision ?? null
      } catch {
        myDecision = null
      }
    }
    res.json({ ...(internship as any), ...(myDecision ? { myDecision } : {}) })
  } catch (error) {
    logger.error({ err: error }, 'Get staging internship error:')
    res.status(500).json({ error: 'Failed to fetch staging internship' })
  }
})

// GET /:id - Get single internship with registrations - tenant isolated (PII) + STUDENT own-only
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    // HALF1: internship + user independent → Promise.all (was sequential).
    const [internship, user] = await Promise.all([
      prisma.internship.findUnique({
        where: { id: req.params.id as string },
        include: {
          registrations: { include: { user: { select: { id: true, name: true, email: true, studentId: true, department: true, departmentId: true, incomingYear: true } } } },
          creator: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }), // NARROW-READ half1
    ])
    if (!internship) {
      res.status(404).json({ error: 'Internship not found' })
      return
    }
    // Tenant check: hide cross-college internships (list already filters, but direct ID must also deny)
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    if (!canAccessCollege(user as any, (internship as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    // STUDENT own-only: strip other students' registrations/PII (Classroom parity).
    if (user.role === 'STUDENT') {
      const own = (internship as any).registrations.filter((r: any) => r.userId === user.id)
      res.json({ ...internship, registrations: own })
      return
    }
    res.json(internship)
  } catch (error) {
    logger.error({ err: error }, 'Error getting internship:')
    res.status(500).json({ error: 'Failed to get internship' })
  }
})

// POST / - Create internship (teacher/admin/super)
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers and admins can create internships' })
      return
    }

    const { title, description, company, role, url, stipend, duration, mode, startDate, deadline, targetDepartments, targetYears, eligibilityEnabled, collegeId: bodyCollegeId } = req.body
    // topbottom F7: all five are NOT NULL cols — missing values rode into
    // Prisma and 500d. Fail closed with 400.
    const missing = ['title', 'description', 'company', 'role', 'url'].filter(
      (k) => !(req.body as any)[k] || !String((req.body as any)[k]).trim(),
    )
    if (missing.length > 0) {
      res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` })
      return
    }
    const derivedCollegeId = deriveCollegeId(user as any, bodyCollegeId as string | null | undefined, req)
    if (!derivedCollegeId) {
      res.status(400).json({ error: 'College ID is required' })
      return
    }

    // Order 3: canonical Json arrays only (String twins dropped).
    const deptArr = normalizeDepartments(targetDepartments as string[] | string | null | undefined)
    const yearsArr = normalizeYears(targetYears as number[] | string | null | undefined)
    const internship = await prisma.internship.create({
      data: {
        title,
        description,
        company,
        role,
        url,
        stipend: stipend || null,
        duration: duration || null,
        mode: mode || 'REMOTE',
        startDate: startDate || null,
        // Order 8 dual-write: free-text startDate + typed startAt (null when unparseable like "Immediate").
        startAt: coerceStartAt(startDate) as any,
        deadline: coerceDeadline(deadline),
        targetDepartments: deptArr as any,
        targetYears: yearsArr as any,
        eligibilityEnabled: eligibilityEnabled || false,
        creatorId: req.userId!,
        collegeId: derivedCollegeId,
      },
    })

    try { broadcastInternshipMutation({ internshipId: internship.id, collegeId: derivedCollegeId, action: 'created' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    // P0-B: bust shared 5m published list (fail-open, TTL backstop covers miss).
    try { void bustInternshipsList(listScopeForUser(user as any)); void bustInternshipsList('global') } catch {}
    res.status(201).json(internship)
  } catch (error) {
    logger.error({ err: error }, 'Error creating internship:')
    res.status(500).json({ error: 'Failed to create internship' })
  }
})

// DELETE /:id - Delete internship (creator or admin only) - tenant isolated
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    // HALF1: internship + user independent → Promise.all (was sequential).
    const [internship, user] = await Promise.all([
      prisma.internship.findUnique({ where: { id: req.params.id as string } }),
      prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }), // NARROW-READ half1
    ])
    if (!internship) {
      res.status(404).json({ error: 'Internship not found' })
      return
    }
    if (!user) {
      res.status(403).json({ error: 'Not authorized' })
      return
    }
    // HIGH BOLA fix: tenant isolation — only same college (or SUPER_ADMIN) may delete
    if (!canAccessCollege(user as any, internship.collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    const isOwner = internship.creatorId === req.userId
    const isSuper = user.role === 'SUPER_ADMIN'
    const isCollegeAdminSameCollege = user.role === 'COLLEGE_ADMIN' && internship.collegeId === user.collegeId
    if (!isOwner && !isSuper && !isCollegeAdminSameCollege) {
      res.status(403).json({ error: 'Not authorized' })
      return
    }
    await prisma.internship.delete({ where: { id: req.params.id as string } })
    // P0-D: reuse the pre-delete row for scope (fail-open global when null).
    try { broadcastInternshipMutation({ internshipId: req.params.id as string, action: 'deleted', collegeId: (internship as any)?.collegeId ?? (user as any)?.collegeId ?? null }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    // P0-B: bust shared 5m published list (scope unknown post-delete — bust global best-effort, TTL covers rest).
    try { void bustInternshipsList('global') } catch {}
    res.json({ success: true })
  } catch (error) {
    logger.error({ err: error }, 'Error deleting internship:')
    res.status(500).json({ error: 'Failed to delete internship' })
  }
})

// POST /:id/register - Student registers (tenant + eligibility gated)
router.post('/:id/register', async (req: AuthRequest, res: Response) => {
  try {
    // HALF1: user + internship independent → Promise.all (was sequential).
    const [user, internship] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }), // NARROW-READ half1
      prisma.internship.findUnique({ where: { id: req.params.id as string } }),
    ])
    if (!user || user.role !== 'STUDENT') {
      res.status(403).json({ error: 'Only students can register' })
      return
    }

    if (!internship) {
      res.status(404).json({ error: 'Internship not found' })
      return
    }
    // Tenant isolation (parity with hackathons register + GET /:id)
    if (!canAccessCollege(user as any, (internship as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }

    // Eligibility (AI codes CSE/IT/ALL → departmentIds)
    if ((internship as any).eligibilityEnabled) {
      // Order 3: canonical Json arrays (helpers accept Json or legacy String).
      const targetDepts = parseJsonArraySafe((internship as any).targetDepartments)
      const targetYears = parseJsonNumberArraySafe((internship as any).targetYears)
      if (targetDepts.length > 0) {
        const { isDepartmentEligible, getCollegeDepartments } = await import('../utils/eligibility')
        const collegeDepts = await getCollegeDepartments((internship as any).collegeId || user.collegeId)
        if (!isDepartmentEligible(targetDepts, user.departmentId, collegeDepts)) {
          res.status(403).json({ error: 'Your department is not eligible for this internship' })
          return
        }
      }
      if (targetYears.length > 0 && user.incomingYear) {
        const currentYear = Math.min(new Date().getFullYear() - user.incomingYear + 1, 4)
        if (!targetYears.includes(currentYear)) {
          res.status(403).json({ error: `Only year ${targetYears.join(', ')} students are eligible for this internship` })
          return
        }
      }
    }

    const existing = await prisma.internshipRegistration.findUnique({
      where: { internshipId_userId: { internshipId: req.params.id as string, userId: req.userId! } },
    })
    if (existing) {
      res.status(400).json({ error: 'Already registered' })
      return
    }

    const registration = await prisma.internshipRegistration.create({
      data: { internshipId: req.params.id as string, userId: req.userId!, status: 'REGISTERED' },
    })

    // P0-B: registrationsCount lives in the published list payload — bust it.
    try { void bustInternshipsList(listScopeForUser(user as any)); void bustInternshipsList('global') } catch {}
    res.status(201).json(registration)
  } catch (error) {
    logger.error({ err: error }, 'Error registering for internship:')
    res.status(500).json({ error: 'Failed to register' })
  }
})

// DELETE /:id/register - Student unregisters (own only, 404 if not registered) (#5 leftovers).
router.delete('/:id/register', async (req: AuthRequest, res: Response) => {
  try {
    const [user, internship] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true } }),
      prisma.internship.findUnique({ where: { id: req.params.id as string }, select: { collegeId: true } }),
    ])
    const roleErr = unregisterRoleError(user?.role)
    if (!user || roleErr) {
      res.status(403).json({ error: roleErr || 'Only students can unregister' })
      return
    }
    if (!internship) {
      res.status(404).json({ error: 'Internship not found' })
      return
    }
    if (!canAccessCollege(user as any, (internship as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    const existing = await prisma.internshipRegistration.findUnique({
      where: { internshipId_userId: { internshipId: req.params.id as string, userId: req.userId! } },
    })
    if (!existing) {
      res.status(404).json({ error: 'Not registered' })
      return
    }
    await prisma.internshipRegistration.delete({ where: { id: existing.id } })
    // P0-D: thread collegeId (scoped emit).
    try { broadcastInternshipMutation({ internshipId: req.params.id as string, action: 'unregistered', collegeId: (internship as any)?.collegeId ?? (user as any)?.collegeId ?? null }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    // P0-B: registrationsCount lives in the published list payload — bust it.
    try { void bustInternshipsList(listScopeForUser(user as any)); void bustInternshipsList('global') } catch {}
    res.json({ success: true })
  } catch (error) {
    logger.error({ err: error }, 'Error unregistering for internship:')
    res.status(500).json({ error: 'Failed to unregister' })
  }
})

// POST /:id/remind - Remind registered users only (teacher/admin of college, body { message }) (#5 leftovers).
router.post('/:id/remind', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true } })
    const roleErr = remindRoleError(user?.role)
    if (!user || roleErr) {
      res.status(403).json({ error: roleErr || 'Only teachers or admins can send reminders' })
      return
    }
    const internship = await prisma.internship.findUnique({
      where: { id: req.params.id as string },
      select: { id: true, title: true, collegeId: true },
    })
    if (!internship) {
      res.status(404).json({ error: 'Internship not found' })
      return
    }
    if (!canAccessCollege(user as any, (internship as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    const parsed = validateRemindMessage(req.body)
    if (!parsed.ok) {
      res.status(400).json({ error: (parsed as { ok: false; error: string }).error })
      return
    }
    const regs = await prisma.internshipRegistration.findMany({
      where: { internshipId: req.params.id as string },
      select: { userId: true },
    })
    const userIds = registeredUserIds(regs as Array<{ userId?: unknown }>)
    if (userIds.length === 0) {
      res.json({ notified: 0, message: 'No registered users to remind' })
      return
    }
    const payload = buildRemindNotification('internship', internship.title, (parsed as { ok: true; message: string }).message, internship.id)
    await notifyUsers(userIds, payload)
    logger.info(`[AUDIT] internship:remind actor=${user.id} role=${user.role} target=${internship.id} notified=${userIds.length}`)
    res.json({ notified: userIds.length })
  } catch (error) {
    logger.error({ err: error }, 'Error sending internship reminders:')
    res.status(500).json({ error: 'Failed to send reminders' })
  }
})

// PUT /:id/report - Student self-reports status
router.put('/:id/report', async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.body
    if (!['SELECTED', 'REJECTED'].includes(status)) {
      res.status(400).json({ error: 'Status must be SELECTED or REJECTED' })
      return
    }

    const registration = await prisma.internshipRegistration.findUnique({
      where: { internshipId_userId: { internshipId: req.params.id as string, userId: req.userId! } },
    })
    if (!registration) {
      res.status(404).json({ error: 'Not registered' })
      return
    }

    const updated = await prisma.internshipRegistration.update({
      where: { id: registration.id },
      data: { status, reportedAt: new Date() },
    })

    res.json(updated)
  } catch (error) {
    logger.error({ err: error }, 'Error reporting status:')
    res.status(500).json({ error: 'Failed to report status' })
  }
})

// GET /:id/registrations - Get all registrations (teacher/admin/super) - tenant isolated
router.get('/:id/registrations', async (req: AuthRequest, res: Response) => {
  try {
    // HALF1: user + internship independent → Promise.all (was sequential).
    const [user, internship] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }), // NARROW-READ half1
      prisma.internship.findUnique({ where: { id: req.params.id as string }, select: { collegeId: true } }),
    ])
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Not authorized' })
      return
    }
    if (!internship) {
      res.status(404).json({ error: 'Internship not found' })
      return
    }
    if (!canAccessCollege(user as any, internship.collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }

    const registrations = await prisma.internshipRegistration.findMany({
      where: { internshipId: req.params.id as string },
      include: { user: { select: { id: true, name: true, email: true, studentId: true, department: true, departmentId: true, incomingYear: true } } },
    })

    res.json(registrations)
  } catch (error) {
    logger.error({ err: error }, 'Error getting registrations:')
    res.status(500).json({ error: 'Failed to get registrations' })
  }
})

// PUT /:id/registrations/:regId - Update registration status (teacher/admin/super) - tenant isolated + IDOR guard
router.put('/:id/registrations/:regId', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Not authorized' })
      return
    }
    const internship = await prisma.internship.findUnique({ where: { id: req.params.id as string }, select: { collegeId: true } })
    if (!internship) {
      res.status(404).json({ error: 'Internship not found' })
      return
    }
    if (!canAccessCollege(user as any, internship.collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }

    // F14 parity: registration must belong to the URL internship.
    const existing = await prisma.internshipRegistration.findUnique({ where: { id: req.params.regId as string } })
    if (!existing) {
      res.status(404).json({ error: 'Registration not found' })
      return
    }
    if ((existing as any).internshipId !== (req.params.id as string)) {
      res.status(400).json({ error: 'Registration does not belong to this internship' })
      return
    }

    const { status } = req.body
    const updated = await prisma.internshipRegistration.update({
      where: { id: req.params.regId as string },
      data: { status },
    })

    res.json(updated)
  } catch (error) {
    logger.error({ err: error }, 'Error updating registration:')
    res.status(500).json({ error: 'Failed to update registration' })
  }
})

// GET /export/:id - Export registrations as Excel - tenant isolated
router.get('/export/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Not authorized' })
      return
    }

    const internship = await prisma.internship.findUnique({ where: { id: req.params.id as string } })
    if (!internship) {
      res.status(404).json({ error: 'Internship not found' })
      return
    }
    if (!canAccessCollege(user as any, internship.collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }

    const registrations = await prisma.internshipRegistration.findMany({
      where: { internshipId: req.params.id as string },
      include: { user: { select: { name: true, email: true, studentId: true } } },
    })

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'CampusFlow'
    workbook.created = new Date()
    const sheet = workbook.addWorksheet('Registrations')
    sheet.columns = [
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Roll Number', key: 'studentId', width: 15 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Reported At', key: 'reportedAt', width: 20 },
    ]

    registrations.forEach((r) => {
      sheet.addRow({
        name: escapeExcelValue(r.user.name),
        email: escapeExcelValue(r.user.email),
        studentId: escapeExcelValue(r.user.studentId),
        status: escapeExcelValue(r.status),
        reportedAt: r.reportedAt?.toISOString() || 'N/A',
      })
    })

    const buffer = await workbook.xlsx.writeBuffer()
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    // F17: sanitize title into filename + RFC5987 filename*.
    res.setHeader('Content-Disposition', contentDisposition(`${safeFilename(internship.title, 'internship')}-registrations.xlsx`))
    res.send(Buffer.from(buffer as any))
  } catch (error) {
    logger.error({ err: error }, 'Error exporting registrations:')
    res.status(500).json({ error: 'Failed to export' })
  }
})

// GET /export-all - Export all internships (F02 parity: staff-only + tenant scoped)
router.get('/export-all', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    if (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Export requires teacher or admin role' })
      return
    }

    const collegeFilter = user.role === 'SUPER_ADMIN' ? {} : { collegeId: user.collegeId! }
    // HALF1: narrow registrations to status only (was include:true full rows). Export uses
    // only length + SELECTED count, so full blobs wasted I/O. Same counts, smaller payload.
    const internships = await prisma.internship.findMany({
      where: collegeFilter,
      select: { title: true, company: true, role: true, mode: true, stipend: true, duration: true, deadline: true, registrations: { select: { status: true } } },
      orderBy: { createdAt: 'desc' },
    })

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'CampusFlow'
    workbook.created = new Date()
    const sheet = workbook.addWorksheet('Internships')
    sheet.columns = [
      { header: 'Title', key: 'title', width: 30 },
      { header: 'Company', key: 'company', width: 20 },
      { header: 'Role', key: 'role', width: 20 },
      { header: 'Mode', key: 'mode', width: 12 },
      { header: 'Stipend', key: 'stipend', width: 15 },
      { header: 'Duration', key: 'duration', width: 15 },
      { header: 'Deadline', key: 'deadline', width: 15 },
      { header: 'Registrations', key: 'regCount', width: 15 },
      { header: 'Selected', key: 'selected', width: 12 },
    ]

    internships.forEach((i) => {
      // Deadline is DateTime post-migration (was String): format to YYYY-MM-DD for Excel.
      const deadlineCell = (i as any).deadline
        ? (coerceDeadline((i as any).deadline)?.toISOString().slice(0, 10) ?? 'N/A')
        : 'N/A'
      sheet.addRow({
        title: escapeExcelValue(i.title),
        company: escapeExcelValue(i.company),
        role: escapeExcelValue(i.role),
        mode: escapeExcelValue(i.mode),
        stipend: escapeExcelValue(i.stipend || 'N/A'),
        duration: escapeExcelValue(i.duration || 'N/A'),
        deadline: escapeExcelValue(deadlineCell),
        regCount: i.registrations.length,
        selected: i.registrations.filter((r) => r.status === 'SELECTED').length,
      })
    })

    const buffer = await workbook.xlsx.writeBuffer()
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="internships.xlsx"')
    res.send(Buffer.from(buffer as any))
  } catch (error) {
    logger.error({ err: error }, 'Error exporting internships:')
    res.status(500).json({ error: 'Failed to export' })
  }
})

// POST /fetch-details - AI extract internship details from URL - SSRF protected + rate limited
router.post('/fetch-details', fetchLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const { url } = req.body
    if (!url) {
      res.status(400).json({ error: 'URL is required' })
      return
    }

    // HIGH SSRF fix: validate URL before fetching (block private IP / metadata / bad schemes)
    try {
      await validateExternalUrl(String(url))
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'Invalid URL' })
      return
    }

    // AI Manager handles provider resolution

    // Fetch page content - SSRF hardened: manual redirect, 10s timeout, size cap 2MB
    let pageContent = ''
    try {
      const response = await fetch(String(url), {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        redirect: 'manual',
      } as any)
      // Block redirects to private hosts (manual prevents auto-follow)
      if (response.status >= 300 && response.status < 400) {
        throw new Error('Redirect blocked')
      }
      // Size cap
      const len = Number(response.headers.get('content-length') || 0)
      if (len > 2 * 1024 * 1024) throw new Error('Response too large')
      const html = await response.text()
      if (html.length > 2 * 1024 * 1024) throw new Error('Response too large')
      pageContent = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 8000)
    } catch {
      logger.info('Could not fetch URL content, sending URL only to AI')
    }

    const contentSection = pageContent.length > 300
      ? `Page content:\n${pageContent}`
      : `Page content: (SPA/JavaScript-rendered page - content not available via fetch)`

    // SPA path: DDG search top-3 like hackathon path instead of URL-only (grounding + fallback).
    let searchResults = ''
    if (pageContent.length < 300) {
      let searchQuery = ''
      try {
        const urlPath = new URL(String(url)).pathname
        const slug = urlPath.split('/').filter(Boolean).pop() || ''
        const cleaned = slug.replace(/[-_]/g, ' ').replace(/\d{5,}/g, '').replace(/\s+/g, ' ').trim()
        if (cleaned.length > 5) searchQuery = cleaned
      } catch {}
      if (!searchQuery || searchQuery.length < 5) {
        try {
          const domain = new URL(String(url)).hostname.replace('www.', '')
          searchQuery = `${domain} internship`
        } catch {
          searchQuery = 'internship'
        }
      }
      logger.info(`Internship content too short (${pageContent.length} chars), searching web for: ${searchQuery}`)
      searchResults = await searchOpportunityDetails(searchQuery + ' internship details stipend duration eligibility')
    }

    const searchSection = searchResults
      ? `\n\nWeb search results for this internship:\n${searchResults}`
      : ''

    // Grounded text for post-AI validation + deterministic fallback.
    const groundedContent = [pageContent, searchResults].filter(Boolean).join('\n')

    // Shared prompt (fetchDetails.ts SSOT): full-desc + never-₹0 (fixes brief 2-3-sentence + ONLY-if-explicit contradictions).
    const prompt = buildFetchDetailsPrompt('internship', { url: String(url), contentSection, searchSection })

    // Use AI Manager routing (fetch feature)
    let responseText = ''
    try {
      responseText = await chatCompletion('fetch', [
        { role: 'user', content: prompt },
      ], { temperature: 0.1, max_tokens: 2000 })
    } catch (aiErr) {
      logger.info({ err: aiErr }, 'AI fetch failed for internship details:')
    }

    const parseAiResponse = (text: string): any => {
      if (!text) return null
      try {
        const firstParse = JSON.parse(text)
        return typeof firstParse === 'string' ? JSON.parse(firstParse) : firstParse
      } catch {
        try {
          const jsonMatch = text.match(/\{[\s\S]*\}/)
          if (jsonMatch) return JSON.parse(jsonMatch[0])
        } catch {}
        return null
      }
    }

    // No-key fallback: NOT_CONFIGURED / throw / parse-fail → deterministic extractors instead of null.
    if (!responseText || isAiNotConfiguredResponse(responseText)) {
      if (groundedContent && groundedContent.length > 50) {
        logger.info('AI not configured/failed for internship fetch — using deterministic fallback')
        const fb = buildInternshipDeterministicFallback(groundedContent, String(url))
        res.json(toFetchDetailsEnvelope(fb))
        return
      }
      res.json(toFetchDetailsEnvelope(null, 'Could not extract details. Please fill manually.'))
      return
    }

    let details: any = parseAiResponse(responseText)
    if (!details) {
      if (groundedContent && groundedContent.length > 50) {
        logger.info('AI parse failed for internship fetch — using deterministic fallback')
        const fb = buildInternshipDeterministicFallback(groundedContent, String(url))
        res.json(toFetchDetailsEnvelope(fb))
        return
      }
      res.json(toFetchDetailsEnvelope(null, 'Could not extract details. Please fill manually.'))
      return
    }
    // Validation gate: strip fake prizes/dates not grounded in page text before res.json.
    try {
      const validated = validateFetchDetails('internship', details, groundedContent)
      if (validated.dropped.length) {
        logger.info({ dropped: validated.dropped }, 'Internship fetch validation dropped hallucinated fields:')
      }
      details = validated.data
    } catch {}
    if (details) {
      res.json(toFetchDetailsEnvelope(details as Record<string, unknown>))
    } else {
      res.json(toFetchDetailsEnvelope(null, 'Could not extract details. Please fill manually.'))
    }
  } catch (error) {
    logger.error({ err: error }, 'AI fetch internship details error:')
    res.status(500).json({ error: 'Failed to fetch details' })
  }
})

// POST /fetch-external - Trigger auto-fetch of internships from external sources (staging flow) - SUPER_ADMIN + rate limited
router.post('/fetch-external', fetchLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user || user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin access required' })
      return
    }

    const { fetchFromAllSources, enrichInternshipStaging } = await import('../services/opportunityAgent')
    const allOpps = await fetchFromAllSources()
    const internships = allOpps.filter(o => o.type === 'INTERNSHIP')

    let fetched = 0
    let skipped = 0
    const idsToEnrich: string[] = []

    for (const opp of internships) {
      if (!opp.url || !opp.title) { skipped++; continue }
      // Order 2 V-24 NULL-safe: normalize missing/blank → 'MANUAL' (matches DB NOT NULL + GLOBAL unique).
      const oppSource = normalizeSource((opp as { source?: unknown }).source)
      try {
        const existing = await prisma.internshipStaging.findFirst({
          where: { title: opp.title, source: oppSource },
        })
        if (existing) { skipped++; continue }

        const created = await prisma.internshipStaging.create({
          data: {
            title: opp.title,
            description: opp.description || 'No description available',
            company: opp.company || opp.organizer || 'Unknown',
            role: opp.role || opp.title,
            url: opp.url,
            stipend: opp.stipend || null,
            duration: opp.duration || null,
            mode: opp.mode || 'REMOTE',
            deadline: coerceDeadline((opp as any).deadline),
            startDate: opp.startDate || null,
            startAt: coerceStartAt((opp as any).startDate) as any,
            status: 'ACTIVE',
            source: oppSource,
            creatorId: user.id,
            collegeId: deriveCollegeId(user as any, null, req) || user.collegeId || null,
          },
        })
        fetched++
        idsToEnrich.push(created.id)
      } catch (err) {
        logger.error({ err: err }, `Error storing internship staging "${opp.title}":`)
        skipped++
      }
    }

    logger.info(`[Fetch] ${fetched} internships created — enriching in background`)

    // Enrich in background (don't block the response)
    const ENRICH_DELAY_MS = 12000
    ;(async () => {
      for (let i = 0; i < idsToEnrich.length; i++) {
        logger.info(`[Fetch] Enriching internship ${i + 1}/${idsToEnrich.length}`)
        await enrichInternshipStaging(idsToEnrich[i]).catch(() => {})
        if (i < idsToEnrich.length - 1) {
          await new Promise(r => setTimeout(r, ENRICH_DELAY_MS))
        }
      }
      logger.info(`[Fetch] Done — enriched ${idsToEnrich.length} internships`)
    })()

    // P0-D: fetched staging rows are global feed — explicit null = global by intent.
    try { broadcastInternshipMutation({ action: 'fetched', fetched, total: internships.length, collegeId: null }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    // P0-A: bust only when rows changed (server emits only on change).
    try { if (fetched > 0) void bustStagingCountsForUser('int', user as any) } catch {}
    res.json({ message: `Internship fetch complete`, fetched, skipped, total: internships.length })
  } catch (error) {
    logger.error({ err: error }, 'Fetch external internships error:')
    res.status(500).json({ error: 'Failed to fetch external internships' })
  }
})

// POST /staging/:id/approve - Approve staging internship (F04: tenant gate + audit)
// Per-college independent (fix: single global status). Same contract as
// hackathons approve: global row stays ACTIVE/DRAFT/PENDING, each college's
// approve creates its OWN published copy + own APPROVED decision; leak-closed
// idempotency (own college scope only); 400 when target college missing.
router.post('/staging/:id/approve', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }

    const staging = await prisma.internshipStaging.findUnique({
      where: { id: req.params.id as string },
    })
    if (!staging) {
      res.status(404).json({ error: 'Staging internship not found' })
      return
    }

    const targetCollegeId = resolveDecisionCollegeId(user as any, staging as any, req)
      || deriveCollegeId(user as any, (staging as any).collegeId as string | null | undefined, req)
      || (staging as any).collegeId
      || (user as any).collegeId
      || getSuperAdminTargetCollegeId(req)
    if (!targetCollegeId) {
      res.status(400).json({ error: 'College ID required for internship approval' })
      return
    }
    if (!canDecideForCollege(user as any, (staging as any).collegeId, targetCollegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    if (!canAccessDecisionCollege(user as any, targetCollegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }

    // Per-college idempotency: already APPROVED by MY college → return MY copy.
    const myDecision = await findDecision(prisma as any, 'internshipStagingDecision', staging.id, targetCollegeId)
    if (myDecision?.decision === 'APPROVED') {
      const ownWhere = buildOwnPublishedWhere(staging as any, targetCollegeId)
      const existing = await prisma.internship.findFirst({ where: ownWhere as never })
      if (existing) {
        res.json({ message: 'Internship already approved', internship: existing, idempotent: true })
        return
      }
    } else if ((staging as any).url) {
      const ownDup = await prisma.internship.findFirst({
        where: { url: (staging as any).url, collegeId: targetCollegeId } as never,
      })
      if (ownDup && !myDecision) {
        await upsertDecision(prisma as any, prisma as any, 'internshipStagingDecision', {
          stagingId: staging.id,
          collegeId: targetCollegeId,
          decision: 'APPROVED',
          decidedBy: user.id,
        })
        res.json({ message: 'Internship already approved', internship: ownDup, idempotent: true })
        return
      }
    }

    // Atomic: create + mark APPROVED together (no half-published state on crash).
    // Deadline is already DateTime (10k migration); coerce covers legacy String rows during rollout.
    // Order 3: staging→published carries canonical Json arrays directly (same names/types).
    const internship = await prisma.$transaction(async (tx) => {
      const created = await tx.internship.create({
        data: {
          title: staging.title,
          description: staging.description,
          company: staging.company,
          role: staging.role,
          url: staging.url,
          stipend: staging.stipend,
          duration: staging.duration,
          mode: staging.mode,
          startDate: staging.startDate,
          startAt: (staging as any).startAt ?? coerceStartAt((staging as any).startDate) as any,
          deadline: coerceDeadline((staging as any).deadline),
          targetDepartments: (staging as any).targetDepartments as any,
          targetYears: (staging as any).targetYears as any,
          eligibilityEnabled: staging.eligibilityEnabled,
          status: 'ACTIVE',
          source: staging.source,
          creatorId: user.id,
          collegeId: targetCollegeId,
        },
      })
      // Per-college: record MY decision; NEVER flip the shared global status
      // (global stays ACTIVE so other colleges remain pending). Pre-migration
      // fallback flips globally inside the same transaction.
      try {
        const dm = (tx as any).internshipStagingDecision
        if (dm?.upsert) {
          await dm.upsert({
            where: { stagingId_collegeId: { stagingId: staging.id, collegeId: targetCollegeId } },
            create: { stagingId: staging.id, collegeId: targetCollegeId, decision: 'APPROVED', decidedBy: user.id },
            update: { decision: 'APPROVED', decidedBy: user.id, decidedAt: new Date() },
          })
        } else {
          await tx.internshipStaging.update({ where: { id: staging.id }, data: { status: 'APPROVED' } })
        }
      } catch {
        try {
          await tx.internshipStaging.update({ where: { id: staging.id }, data: { status: 'APPROVED' } })
        } catch {}
      }
      return created
    })

    try { broadcastInternshipMutation({ internshipId: internship.id, stagingId: req.params.id as string, action: 'approved', collegeId: (internship as any).collegeId ?? targetCollegeId ?? (user as any)?.collegeId ?? null }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    // P0-A: bust counts cache so socket-driven clients refetch fresh (fail-open).
    try { void bustStagingCountsForUser('int', user as any) } catch {}
    // P0-B: newly published row changes the published list (all scopes see it).
    try { void bustInternshipsList(listScopeForUser(user as any)); void bustInternshipsList('global') } catch {}
    logger.info(`[AUDIT] internship-staging:approve actor=${user.id} role=${user.role} college=${(user as any).collegeId} decisionCollege=${targetCollegeId} target=${req.params.id} published=${internship.id}`)
    res.json({ message: 'Internship approved', internship })
  } catch (error) {
    logger.error({ err: error }, 'Approve staging internship error:')
    res.status(500).json({ error: 'Failed to approve staging internship' })
  }
})

// POST /staging/:id/reject - Reject staging internship (F04: tenant gate + audit)
// Per-college independent: own REJECTED decision only; others unaffected.
router.post('/staging/:id/reject', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }

    const staging = await prisma.internshipStaging.findUnique({
      where: { id: req.params.id as string },
    })
    if (!staging) {
      res.status(404).json({ error: 'Staging internship not found' })
      return
    }

    const targetCollegeId = resolveDecisionCollegeId(user as any, staging as any, req)
      || deriveCollegeId(user as any, (staging as any).collegeId as string | null | undefined, req)
      || (staging as any).collegeId
      || (user as any).collegeId
      || getSuperAdminTargetCollegeId(req)
    if (!targetCollegeId) {
      res.status(400).json({ error: 'College ID required for internship rejection' })
      return
    }
    if (!canDecideForCollege(user as any, (staging as any).collegeId, targetCollegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    if (!canAccessDecisionCollege(user as any, targetCollegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }

    const myDecision = await findDecision(prisma as any, 'internshipStagingDecision', staging.id, targetCollegeId)
    if (myDecision?.decision === 'REJECTED') {
      res.json({ message: 'Internship already rejected', idempotent: true })
      return
    }
    if (myDecision?.decision === 'APPROVED') {
      res.status(409).json({ error: 'Already approved by your college' })
      return
    }

    const saved = await upsertDecision(prisma as any, prisma as any, 'internshipStagingDecision', {
      stagingId: staging.id,
      collegeId: targetCollegeId,
      decision: 'REJECTED',
      decidedBy: user.id,
    })
    if (!saved) {
      await prisma.internshipStaging.update({
        where: { id: req.params.id as string },
        data: { status: 'REJECTED' },
      })
    }

    try { broadcastInternshipMutation({ stagingId: req.params.id as string, action: 'rejected', collegeId: targetCollegeId ?? (user as any)?.collegeId ?? null }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    // P0-A: bust counts cache (fail-open, see approve).
    try { void bustStagingCountsForUser('int', user as any) } catch {}
    logger.info(`[AUDIT] internship-staging:reject actor=${user.id} role=${user.role} college=${(user as any).collegeId} decisionCollege=${targetCollegeId} target=${req.params.id}`)
    res.json({ message: 'Internship rejected' })
  } catch (error) {
    logger.error({ err: error }, 'Reject staging internship error:')
    res.status(500).json({ error: 'Failed to reject staging internship' })
  }
})

// POST /staging/:id/assign - Assign staging internship to teacher
router.post('/staging/:id/assign', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'COLLEGE_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }

    const { teacherId } = req.body
    if (!teacherId) {
      res.status(400).json({ error: 'teacherId is required' })
      return
    }

    const teacher = await prisma.user.findUnique({ where: { id: teacherId }, select: { id: true, role: true, collegeId: true, name: true } }) // NARROW-READ half1
    if (!teacher || teacher.role !== 'TEACHER') {
      res.status(400).json({ error: 'Invalid teacher' })
      return
    }

    const staging = await prisma.internshipStaging.findUnique({ where: { id: req.params.id as string } })
    if (!staging) {
      res.status(404).json({ error: 'Staging internship not found' })
      return
    }

    if (user.role === 'COLLEGE_ADMIN') {
      if ((staging as any).collegeId && (staging as any).collegeId !== user.collegeId) {
        res.status(403).json({ error: 'Access denied: different college' })
        return
      }
      if ((teacher as any).collegeId !== user.collegeId) {
        res.status(403).json({ error: 'Can only assign teachers of your college' })
        return
      }
    }

    const updated = await prisma.internshipStaging.update({
      where: { id: req.params.id as string },
      data: { creatorId: teacherId },
    })

    try { broadcastInternshipMutation({ stagingId: req.params.id as string, action: 'staging:assigned', teacherId, collegeId: (user as any)?.collegeId ?? null }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.json({ message: `Assigned to ${teacher.name}`, staging: updated })
  } catch (error) {
    logger.error({ err: error }, 'Assign internship staging error:')
    res.status(500).json({ error: 'Failed to assign' })
  }
})

// POST /staging/assign-all - Assign ALL pending internships to teacher
router.post('/staging/assign-all', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'COLLEGE_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }

    const { teacherId } = req.body
    if (!teacherId) {
      res.status(400).json({ error: 'teacherId is required' })
      return
    }

    const teacher = await prisma.user.findUnique({ where: { id: teacherId }, select: { id: true, role: true, collegeId: true, name: true } }) // NARROW-READ half1
    if (!teacher || teacher.role !== 'TEACHER') {
      res.status(400).json({ error: 'Invalid teacher' })
      return
    }

    const bulkWhere: any = { status: 'ACTIVE' }
    if (user.role === 'COLLEGE_ADMIN') {
      if ((teacher as any).collegeId !== user.collegeId) {
        res.status(403).json({ error: 'Can only assign teachers of your college' })
        return
      }
      bulkWhere.OR = [{ collegeId: user.collegeId }, { collegeId: null }]
    }

    const result = await prisma.internshipStaging.updateMany({
      where: bulkWhere,
      data: { creatorId: teacherId },
    })

    try { broadcastInternshipMutation({ action: 'staging:bulk-assigned', teacherId, count: result.count, collegeId: (teacher as any)?.collegeId ?? (user as any)?.collegeId ?? null }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.json({ assigned: result.count, teacher: teacher.name })
  } catch (error) {
    logger.error({ err: error }, 'Assign all internship staging error:')
    res.status(500).json({ error: 'Failed to assign all' })
  }
})

// POST /staging/re-enrich - Re-enrich all unenriched internship staging records
// Per-college note: skips only GLOBAL REJECTED. Own-college REJECTED decisions
// (InternshipStagingDecision) never block enrich for other colleges.
router.post('/staging/re-enrich', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true } }) // NARROW-READ half1
    if (!user || user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin access required' })
      return
    }

    const { enrichInternshipStaging } = await import('../services/opportunityAgent')

    // Find staging records with no targetDepartments OR no deadline (not fully enriched)
    // Order 3: targetDepartments is canonical Json — explicit equals (was String '[]').
    const unenriched = await prisma.internshipStaging.findMany({
      where: {
        status: { not: 'REJECTED' },
        OR: [
          { targetDepartments: { equals: [] } },
          { deadline: null },
        ],
      },
    })

    if (unenriched.length === 0) {
      res.json({ message: 'All internships already enriched', enriched: 0 })
      return
    }

    logger.info(`[Re-enrich] Found ${unenriched.length} unenriched internships — enriching in background`)

    // Enrich in background (don't block the response)
    const ENRICH_DELAY_MS = 12000
    ;(async () => {
      for (let i = 0; i < unenriched.length; i++) {
        logger.info(`[Re-enrich] Enriching internship ${i + 1}/${unenriched.length}`)
        await enrichInternshipStaging(unenriched[i].id).catch(() => {})
        if (i < unenriched.length - 1) {
          await new Promise(r => setTimeout(r, ENRICH_DELAY_MS))
        }
      }
      logger.info(`[Re-enrich] Done — enriched ${unenriched.length} internships`)
    })()

    res.json({ message: `Enrichment started in background`, total: unenriched.length })
  } catch (error) {
    logger.error({ err: error }, 'Re-enrich internships error:')
    res.status(500).json({ error: 'Failed to re-enrich' })
  }
})

export default router
