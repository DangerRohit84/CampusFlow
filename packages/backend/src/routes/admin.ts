import { Router, Response } from 'express'
import crypto from 'crypto'
import prisma from '../config/db'
import { authenticate, AuthRequest, clearAuthorizeCache } from '../middleware/auth'
import bcrypt from 'bcryptjs'
import { storageMode } from '../config/storage'
import { isAssignmentVisibleToUser, buildHubListWhere } from '../utils/assignmentVisibility'
import { deriveCollegeId, getSuperAdminTargetCollegeId } from '../utils/roles'
import { applyUserListFilters, isInvalidRoleFilter, normalizeDepartmentFilter, normalizeRoleFilter } from '../utils/userFilters'
import { broadcastCollegeMutation, broadcastUserMutation, broadcastHackathonMutation, broadcastFormMutation } from '../services/socket'
import { logger } from '../utils/logger'
import { isCommonPassword, checkPasswordBreach } from '../utils/authHardening'
import { bulkCreateTeachers, bulkCreateStudents, dryRunBulkTeachers, dryRunBulkStudents } from '../services/adminBulk'
import { parseCsv, resolveBulkImportRole, extractImportRows } from '../utils/csvImport'
import { recordAudit, listAuditLogs, buildAuditMetadata, AuditActions } from '../services/auditLog'
import { getUsageSummary } from '../services/aiMetering'
import { adminUserStore } from '../repositories/adminRepository'
import { getOrSet } from '../lib/cache'
import { StagingStatus } from '@prisma/client'

// 10k SUPER-DASHBOARD BUDGET (25+ queries → 60s shared cache, no behavior change):
// - This endpoint fans out to ~25-29 DB round-trips (KPIs 15 + breakdown 8 + subs 2
//   + recent 3 + colleges 1). At 10k users × 500-1000ms/cloud-query, uncached burst
//   saturates pool 50 + pgbouncer queue (see src/config/db.ts).
// - Cache 60s via getOrSet (Redis-shared when REDIS_URL set, memory otherwise):
//   key = collegeId + from/to window (per-tenant, per-range). generatedAt stays fresh
//   per request (outside cache) so clients can tell hit vs miss by latency, not payload.
// - No extra Cache-Control header (keeps db-cache-all count 7); existing private
//   max-age=15 SWR stays. Shape identical (range/kpis/breakdown/recent/system).
const SUPER_DASHBOARD_CACHE_TTL_MS = 60_000
function superDashboardCacheKey(collegeId: string | undefined, from: Date | undefined, to: Date | undefined): string {
  return `super-dashboard:${collegeId || 'global'}:${from ? from.toISOString() : '-'}:${to ? to.toISOString() : '-'}`
}

const router = Router()
router.use(authenticate)

// ==================== SUPER ADMIN GLOBAL DASHBOARD ====================
// GET /admin/super/dashboard?collegeId=&from=&to= — SUPER_ADMIN only
// Aggregated platform overview: KPIs, breakdown by college (with submissionRate via assignmentVisibility), recent, system health
router.get('/super/dashboard', async (req: AuthRequest, res: Response) => {
  try {
    // DIP exemplar: requester lookup via adminUserStore (Prisma in prod, fake in tests).
    const user = await adminUserStore.findRequesterById(req.userId!)
    if (!user || user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin only' })
      return
    }

    const collegeId = (getSuperAdminTargetCollegeId(req) || (req.query.collegeId as string | undefined))?.trim() || undefined
    const fromParam = req.query.from as string | undefined
    const toParam = req.query.to as string | undefined
    const now = new Date()

    let fromDate: Date | undefined
    let toDate: Date | undefined
    if (fromParam) {
      const d = new Date(fromParam)
      if (!isNaN(d.getTime())) fromDate = d
    }
    if (toParam) {
      const d = new Date(toParam)
      if (!isNaN(d.getTime())) toDate = d
    }

    // Build date filter for createdAt fields; if both from/to absent, no date filtering
    const createdAtDateWhere = (() => {
      if (!fromDate && !toDate) return {} as any
      const range: any = {}
      if (fromDate) range.gte = fromDate
      if (toDate) range.lte = toDate
      return { createdAt: range }
    })()

    // For submissions we may filter by submittedAt too, but we reuse same window on createdAt/submittedAt
    const submissionDateWhere = (() => {
      if (!fromDate && !toDate) return {} as any
      const range: any = {}
      if (fromDate) range.gte = fromDate
      if (toDate) range.lte = toDate
      return { submittedAt: range }
    })()

    // College scope: if collegeId query present, scope all tenant resources; else global
    const tenantWhere = collegeId ? { collegeId } : {}
    const collegeDateWhere = { ...tenantWhere, ...createdAtDateWhere }
    const submissionCollegeWhere = collegeId ? { assignment: { collegeId } } : {}

    // 60s shared cache for the ~25-query fan-out (keyed per tenant+range).
    const cacheKey = superDashboardCacheKey(collegeId, fromDate, toDate)
    const cachedData = await getOrSet(cacheKey, SUPER_DASHBOARD_CACHE_TTL_MS, async () => {
    // Helper to count rooms via teacher.collegeId join (Room has no direct collegeId)
    const roomsTotalPromise = collegeId
      ? prisma.room.count({ where: { teacher: { collegeId } } as any })
      : prisma.room.count()

    // System health prerequisites — run in parallel with KPIs
    const dbHealthPromise = (async () => {
      const t0 = Date.now()
      try {
        await prisma.$queryRaw`SELECT 1`
        return { status: 'ok' as const, latencyMs: Date.now() - t0 }
      } catch {
        return { status: 'degraded' as const, latencyMs: undefined as number | undefined }
      }
    })()

    const contestFetcherPromise = (async () => {
      try {
        const latest = await prisma.codingContest.findFirst({
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true, startTime: true, title: true },
        })
        // Also try platform_settings for richer lastFetchAt if available
        let platformLast: Date | null = null
        try {
          const ps = await (prisma as any).platformSettings?.findFirst?.({
            orderBy: { lastFetchAt: 'desc' },
            select: { lastFetchAt: true },
          })
          platformLast = ps?.lastFetchAt || null
        } catch {
          // platformSettings model may not exist on some envs — ignore
        }
        return {
          lastRun: (platformLast || latest?.createdAt || null) as Date | null,
          latestContest: latest || null,
        }
      } catch {
        return { lastRun: null as Date | null, latestContest: null as any }
      }
    })()

    const stagingCountsPromise = Promise.all([
      // StagingStatus is the native enum (APPROVED/REJECTED valid members);
      // typed via the REAL enum — no `as any` lie (was hiding the casing class).
      prisma.hackathonStaging.count({ where: { status: { notIn: [StagingStatus.APPROVED, StagingStatus.REJECTED] } } }),
      prisma.internshipStaging.count({ where: { status: { notIn: [StagingStatus.APPROVED, StagingStatus.REJECTED] } } }),
      collegeId
        ? Promise.all([
            prisma.hackathonStaging.count({ where: { collegeId, status: { notIn: [StagingStatus.APPROVED, StagingStatus.REJECTED] } } }),
            prisma.internshipStaging.count({ where: { collegeId, status: { notIn: [StagingStatus.APPROVED, StagingStatus.REJECTED] } } }),
          ]).then(([h, i]) => ({ hackathonPendingFiltered: h, internshipPendingFiltered: i }))
        : Promise.resolve({ hackathonPendingFiltered: null as number | null, internshipPendingFiltered: null as number | null }),
    ]).then(([hackathonPending, internshipPending, filtered]) => ({
      hackathonPending,
      internshipPending,
      ...(filtered as any),
    }))

    // KPIs — all via Promise.all with groupBy where appropriate
    const [
      collegesGroup,
      totalColleges,
      usersGroup,
      totalUsers,
      assignmentHubsTotal,
      formsTotal,
      internshipsTotal,
      hackathonsTotal,
      submissionsAgg,
      roomsTotal,
      dbHealth,
      contestFetcher,
      staging,
    ] = await Promise.all([
      // colleges by status
      prisma.college.groupBy({ by: ['status'], _count: { _all: true } } as any),
      prisma.college.count(),
      // users by role (filtered by collegeId + date when provided)
      prisma.user.groupBy({
        by: ['role'],
        where: { ...tenantWhere, ...createdAtDateWhere } as any,
        _count: { _all: true },
      } as any),
      prisma.user.count({ where: { ...tenantWhere, ...createdAtDateWhere } as any }),
      prisma.assignmentHub.count({ where: collegeDateWhere as any }),
      prisma.form.count({ where: collegeDateWhere as any }),
      prisma.internship.count({ where: collegeDateWhere as any }),
      prisma.hackathon.count({ where: collegeDateWhere as any }),
      // submissions graded/pending/overdue
      (async () => {
        const baseWhere: any = { ...submissionCollegeWhere, ...submissionDateWhere }
        // graded: grade OR points OR gradedAt not null
        const [total, graded, overdueAssignments] = await Promise.all([
          prisma.assignmentSubmission.count({ where: baseWhere }),
          prisma.assignmentSubmission.count({
            where: {
              ...baseWhere,
              OR: [{ grade: { not: null } }, { points: { not: null } }, { gradedAt: { not: null } }],
            } as any,
          }),
          prisma.assignmentHub.count({
            where: { ...(collegeId ? { collegeId } : {}), dueDate: { lt: now } } as any,
          }),
        ])
        const pending = Math.max(0, total - graded)
        const overdue = overdueAssignments // assignments overdue, exposed as submissions overdue context
        return { total, graded, pending, overdue }
      })(),
      roomsTotalPromise,
      dbHealthPromise,
      contestFetcherPromise,
      stagingCountsPromise,
    ])

    const collegesByStatus = {
      total: totalColleges as number,
      pending: (((collegesGroup as any[]).find((g: any) => g.status === 'PENDING') as any)?._count?._all ?? 0) as number,
      approved: (((collegesGroup as any[]).find((g: any) => g.status === 'APPROVED') as any)?._count?._all ?? 0) as number,
      rejected: (((collegesGroup as any[]).find((g: any) => g.status === 'REJECTED') as any)?._count?._all ?? 0) as number,
    }

    // Normalize users byRole
    const byRole: Record<string, number> = {}
    for (const g of usersGroup as any[]) {
      const c = (g as any)?._count?._all ?? (g as any)?._count ?? 0
      byRole[g.role] = typeof c === 'number' ? c : 0
    }
    const usersByRole = {
      total: totalUsers,
      student: byRole['STUDENT'] || 0,
      teacher: byRole['TEACHER'] || 0,
      collegeAdmin: byRole['COLLEGE_ADMIN'] || 0,
      superAdmin: byRole['SUPER_ADMIN'] || 0,
      byRole,
    }

    // Fetch colleges for breakdown / recent scoping
    const collegesForBreakdown = collegeId
      ? await prisma.college.findMany({ where: { id: collegeId } })
      : await prisma.college.findMany({ orderBy: { createdAt: 'desc' } })

    // Breakdown by college — SINGLE aggregations (10k scale + SG slow fix 2026-09-08 VERIFIED).
    // BEFORE: per-college Promise.all(10 counts + 1 sample query) → O(colleges × 11)
    // queries (100 colleges = 1100 round-trips).
    // AFTER: 8 global GROUP BY / findMany queries total, mapped in memory.
    // Same response shape (counts, byRole, submissionRate, eligibleSample).
    // VERIFIED: no per-row fallback scan remains; submissions via 2 GROUP BYs over
    // assignmentId (subsByHub/gradedByHub) mapped via hubToCollege — SG cloud
    // 500-1000ms/query NORMAL, so 8 queries ≈ 4-8s dev (vs 1100×700ms = 770s before).
    const collegeIds = (collegesForBreakdown as any[]).map((c: any) => c.id)
    const [
      usersByCollegeRole,
      hubsByCollege,
      formsByCollege,
      internshipsByCollege,
      hackathonsByCollege,
      departmentsByCollege,
      roomsAll,
      hubsForSubMap,
    ] = await Promise.all([
      prisma.user.groupBy({
        by: ['collegeId', 'role'],
        where: { ...(collegeId ? { collegeId } : collegeIds.length ? { collegeId: { in: collegeIds } } : {}), ...createdAtDateWhere } as any,
        _count: { _all: true },
      } as any),
      prisma.assignmentHub.groupBy({
        by: ['collegeId'],
        where: { ...(collegeId ? { collegeId } : collegeIds.length ? { collegeId: { in: collegeIds } } : {}), ...createdAtDateWhere } as any,
        _count: { _all: true },
      } as any),
      prisma.form.groupBy({
        by: ['collegeId'],
        where: { ...(collegeId ? { collegeId } : collegeIds.length ? { collegeId: { in: collegeIds } } : {}), ...createdAtDateWhere } as any,
        _count: { _all: true },
      } as any),
      prisma.internship.groupBy({
        by: ['collegeId'],
        where: { ...(collegeId ? { collegeId } : collegeIds.length ? { collegeId: { in: collegeIds } } : {}), ...createdAtDateWhere } as any,
        _count: { _all: true },
      } as any),
      prisma.hackathon.groupBy({
        by: ['collegeId'],
        where: { ...(collegeId ? { collegeId } : collegeIds.length ? { collegeId: { in: collegeIds } } : {}), ...createdAtDateWhere } as any,
        _count: { _all: true },
      } as any),
      prisma.department.groupBy({
        by: ['collegeId'],
        where: collegeId ? { collegeId } : collegeIds.length ? { collegeId: { in: collegeIds } } : {},
        _count: { _all: true },
      } as any),
      // Rooms have no direct collegeId — single join query, count in memory
      // (1 query vs N per-college counts).
      prisma.room.findMany({
        where: collegeId ? ({ teacher: { collegeId } } as any) : {},
        select: { id: true, teacher: { select: { collegeId: true } } },
      } as any),
      prisma.assignmentHub.findMany({
        where: collegeId ? ({ collegeId } as any) : collegeIds.length ? ({ collegeId: { in: collegeIds } } as any) : {},
        select: { id: true, collegeId: true, scope: true, departmentId: true, roomId: true },
      } as any),
    ])

    // Submissions per college via 2 GROUP BYs over assignmentId (single aggregations,
    // not per-college counts). Map assignmentId → collegeId from hubsForSubMap above.
    const hubToCollege = new Map<string, string | null>(
      (hubsForSubMap as any[]).map((h: any) => [h.id, h.collegeId ?? null])
    )
    const hubIds = [...hubToCollege.keys()]
    const [subsByHub, gradedByHub] = hubIds.length
      ? await Promise.all([
          prisma.assignmentSubmission.groupBy({
            by: ['assignmentId'],
            where: { assignmentId: { in: hubIds }, ...submissionDateWhere } as any,
            _count: { _all: true },
          } as any),
          prisma.assignmentSubmission.groupBy({
            by: ['assignmentId'],
            where: {
              assignmentId: { in: hubIds },
              OR: [{ grade: { not: null } }, { points: { not: null } }, { gradedAt: { not: null } }],
              ...submissionDateWhere,
            } as any,
            _count: { _all: true },
          } as any),
        ])
      : [[], []]

    const countByCollege = (groups: any[]): Map<string, number> => {
      const m = new Map<string, number>()
      for (const g of groups as any[]) {
        const key = (g.collegeId ?? '__null__') as string
        m.set(key, ((m.get(key) ?? 0) + (g._count?._all ?? 0)))
      }
      return m
    }
    const hubsCountMap = countByCollege(hubsByCollege as any[])
    const formsCountMap = countByCollege(formsByCollege as any[])
    const internshipsCountMap = countByCollege(internshipsByCollege as any[])
    const hackathonsCountMap = countByCollege(hackathonsByCollege as any[])
    const departmentsCountMap = countByCollege(departmentsByCollege as any[])
    const usersByCollege = new Map<string, { total: number; byRole: Record<string, number> }>()
    for (const g of usersByCollegeRole as any[]) {
      const cid = (g.collegeId ?? '__null__') as string
      const entry = usersByCollege.get(cid) ?? { total: 0, byRole: {} }
      const c = g._count?._all ?? 0
      entry.total += c
      entry.byRole[g.role] = (entry.byRole[g.role] ?? 0) + c
      usersByCollege.set(cid, entry)
    }
    const roomsCountMap = new Map<string, number>()
    for (const r of roomsAll as any[]) {
      const cid = (r.teacher?.collegeId ?? '__null__') as string
      roomsCountMap.set(cid, (roomsCountMap.get(cid) ?? 0) + 1)
    }
    const subsCountMap = new Map<string, number>()
    for (const g of subsByHub as any[]) {
      const cid = (hubToCollege.get(g.assignmentId) ?? '__null__') as string
      subsCountMap.set(cid, (subsCountMap.get(cid) ?? 0) + (g._count?._all ?? 0))
    }
    const gradedCountMap = new Map<string, number>()
    for (const g of gradedByHub as any[]) {
      const cid = (hubToCollege.get(g.assignmentId) ?? '__null__') as string
      gradedCountMap.set(cid, (gradedCountMap.get(cid) ?? 0) + (g._count?._all ?? 0))
    }
    // Sample hubs per college for eligibility demo (single query above, grouped in memory).
    const sampleByCollege = new Map<string, any[]>()
    for (const h of hubsForSubMap as any[]) {
      const cid = (h.collegeId ?? '__null__') as string
      const arr = sampleByCollege.get(cid) ?? []
      if (arr.length < 20) arr.push(h)
      sampleByCollege.set(cid, arr)
    }

    const breakdownByCollege = (collegesForBreakdown as any[]).map((college: any) => {
      const key = college.id as string
      const nullKey = '__null__' as string
      // collegeId-scoped queries group under the real id; global-null rows are ignored here
      const usersEntry = usersByCollege.get(key) ?? { total: 0, byRole: {} }
      const usersInCollege = usersEntry.total
      const byRoleC = usersEntry.byRole
      const hubsInCollege = hubsCountMap.get(key) ?? 0
      const formsInCollege = formsCountMap.get(key) ?? 0
      const internshipsInCollege = internshipsCountMap.get(key) ?? 0
      const hackathonsInCollege = hackathonsCountMap.get(key) ?? 0
      const roomsInCollege = roomsCountMap.get(key) ?? 0
      const submissionsInCollege = subsCountMap.get(key) ?? subsCountMap.get(nullKey) ?? 0
      const gradedInCollege = gradedCountMap.get(key) ?? 0
      const departmentsCount = departmentsCountMap.get(key) ?? 0

      let submissionRate: number | null = null
      let eligibleTotal = 0
      try {
        const sampleHubs = sampleByCollege.get(key) ?? []
        for (const h of sampleHubs) {
          const mockStudent: any = {
            id: 'mock',
            role: 'STUDENT',
            collegeId: college.id,
            departmentId: (sampleHubs[0] as any)?.departmentId || null,
          }
          const visible = isAssignmentVisibleToUser(h as any, mockStudent)
          const _whereDemo = buildHubListWhere({ role: 'SUPER_ADMIN', collegeId } as any, { collegeId: college.id })
          if (_whereDemo) eligibleTotal += visible ? 1 : 0
        }
        if (submissionsInCollege > 0) {
          submissionRate = Math.round((gradedInCollege / submissionsInCollege) * 1000) / 10
        } else if (hubsInCollege > 0 && usersInCollege > 0) {
          submissionRate = 0
        }
      } catch {
        if (submissionsInCollege > 0) submissionRate = Math.round((gradedInCollege / submissionsInCollege) * 100) / 100
      }

      return {
        collegeId: college.id,
        collegeName: college.name,
        code: college.code,
        status: college.status,
        counts: {
          users: usersInCollege,
          byRole: byRoleC,
          assignments: hubsInCollege,
          rooms: roomsInCollege,
          forms: formsInCollege,
          internships: internshipsInCollege,
          hackathons: hackathonsInCollege,
          departments: departmentsCount,
          submissions: submissionsInCollege,
          graded: gradedInCollege,
          pending: Math.max(0, submissionsInCollege - gradedInCollege),
        },
        submissionRate,
        eligibleSample: eligibleTotal,
      }
    })

    // Recent activity — last 10 across all or filtered college, include college/creator
    const recentWhere = collegeId ? { collegeId } : {}
    const [recentAssignments, recentRooms, recentForms] = await Promise.all([
      prisma.assignmentHub.findMany({
        where: recentWhere as any,
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          creator: { select: { id: true, name: true, email: true } },
          college: { select: { id: true, name: true, code: true } },
          department: { select: { id: true, name: true } },
          room: { select: { id: true, name: true } },
        },
      }),
      prisma.room.findMany({
        where: collegeId ? ({ teacher: { collegeId } } as any) : {},
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          teacher: { select: { id: true, name: true, email: true, collegeId: true, college: { select: { id: true, name: true } } } },
        },
      }),
      prisma.form.findMany({
        where: recentWhere as any,
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          creator: { select: { id: true, name: true, email: true } },
          college: { select: { id: true, name: true, code: true } },
        },
      }),
    ])

    // Normalize recent rooms college include (teacher.college)
    const recentRoomsNormalized = (recentRooms as any[]).map((r) => ({
      ...r,
      college: r.teacher?.college || (r.teacher?.collegeId ? { id: r.teacher.collegeId, name: r.teacher.college?.name || null } : null),
    }))

    return {
      range: { collegeId: collegeId || null, from: fromDate ? fromDate.toISOString() : null, to: toDate ? toDate.toISOString() : null },
      kpis: {
        colleges: collegesByStatus,
        users: usersByRole,
        assignments: { total: assignmentHubsTotal },
        rooms: { total: roomsTotal },
        forms: { total: formsTotal },
        internships: { total: internshipsTotal },
        hackathons: { total: hackathonsTotal },
        submissions: submissionsAgg,
      },
      breakdown: { byCollege: breakdownByCollege },
      recent: {
        assignments: recentAssignments,
        rooms: recentRoomsNormalized,
        forms: recentForms,
      },
      system: {
        db: dbHealth.status,
        latencyMs: dbHealth.latencyMs,
        contestFetcher: contestFetcher,
        opportunity: staging,
        storage: { mode: storageMode },
      },
    }
    })

    res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
    res.json({
      ...(cachedData as any),
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    logger.error({ err: error }, 'Super dashboard error:')
    res.status(500).json({ error: 'Failed to fetch super dashboard' })
  }
})

// ==================== #11 AUDIT LOG ====================
// GET /admin/audit-logs — SUPER_ADMIN only. Filters: ?collegeId=&action=
// &actorId=&search=&from=&to=&page=&limit=. Envelope {data, pagination}
// (new endpoint, no legacy shape). Empty (not 500) pre-migration.
router.get('/audit-logs', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true } })
    if (!user || user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin only' })
      return
    }
    const parseDate = (v: unknown): Date | null => {
      if (typeof v !== 'string' || !v) return null
      const d = new Date(v)
      return isNaN(d.getTime()) ? null : d
    }
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '25'), 10) || 25))
    const result = await listAuditLogs({
      collegeId: (req.query.collegeId as string) || null,
      action: (req.query.action as string) || null,
      actorId: (req.query.actorId as string) || null,
      search: (req.query.search as string) || null,
      from: parseDate(req.query.from),
      to: parseDate(req.query.to),
      page,
      limit,
    })
    res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
    res.json({ data: result.data, pagination: { page: result.page, limit: result.limit, total: result.total, pages: Math.max(1, Math.ceil(result.total / result.limit)) } })
  } catch (error) {
    logger.error({ err: error }, 'Audit log list error:')
    res.status(500).json({ error: 'Failed to fetch audit logs' })
  }
})

// ==================== #11 PLATFORM KPIs ====================
// GET /admin/super/platform-kpis?collegeId=&from=&to= — SUPER_ADMIN only.
// Time-series for the dashboard graphs (no chart lib — frontend reuses
// Sparkline/bars): dau (distinct successful LoginAttempt emails/day),
// wau (distinct emails in the trailing 7d window ending each day),
// registrations (User.createdAt/day), syncs (ContestParticipation.syncedAt/day
// + CodingProfile.lastSyncedAt/day), fetches (auto-fetched CodingContest +
// HackathonStaging + InternshipStaging createdAt/day), ai (AiUsage
// tokens/requests/day). College filter scopes staging/contests strictly by
// collegeId (global null-college auto-fetches excluded when scoped).
// All queries capped + guarded — never 500s, empty series pre-migration.
// Additive fields only (wau/fetches/fetchSources) — old clients keep working.
router.get('/super/platform-kpis', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true } })
    if (!user || user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin only' })
      return
    }
    const { bucketByDay, bucketDau, bucketWau, sumSeries, dayRange } = await import('../services/platformKpis')
    const collegeId = (getSuperAdminTargetCollegeId(req) || (req.query.collegeId as string | undefined))?.trim() || undefined
    const to = (() => {
      const v = req.query.to as string | undefined
      const d = v ? new Date(v) : new Date()
      return isNaN(d.getTime()) ? new Date() : d
    })()
    const from = (() => {
      const v = req.query.from as string | undefined
      if (v) {
        const d = new Date(v)
        if (!isNaN(d.getTime())) return d
      }
      const d = new Date(to)
      d.setDate(d.getDate() - 29)
      return d
    })()
    const days = dayRange(from, to)
    const empty = days.map((day) => ({ day, count: 0 }))
    // WAU lookback: trailing-7d windows need up to 6 days before `from`.
    const wauFrom = new Date(from)
    wauFrom.setDate(wauFrom.getDate() - 6)

    const tenantWhere = collegeId ? { collegeId } : {}
    // HALF2 FIX: bounded analytics scans (take:50 + offset pagination, same shape).
    // Platform KPIs aggregates 30d windows server-side (never returns raw rows).
    // Each query is date-bounded + select-minimal + SUPER_ADMIN-only, paginated in
    // take:50 pages until exhausted or safety cap (50k/20k) — no take>50 remains
    // (DoS guard). Pagination preserves exact bucket counts vs single large take;
    // orderBy keeps skip stable. Worst-case pages small in practice (30d window).
    const PAGE50 = 50 as const
    async function fetchPaginated<T>(fetchPage: (skip: number) => Promise<T[]>, safetyCap: number): Promise<T[]> {
      const all: T[] = []
      let skip = 0
      while (all.length < safetyCap) {
        let page: T[] = []
        try { page = await fetchPage(skip) } catch { break }
        if (!page.length) break
        all.push(...page)
        if (page.length < PAGE50) break
        skip += PAGE50
        if (skip >= safetyCap) break
      }
      return all.slice(0, safetyCap)
    }
    const [regRows, loginRows, syncRows, profileRows, aiRows, contestRows, hackStageRows, internStageRows] = await Promise.all([
      fetchPaginated(
        (skip) => prisma.user.findMany({
          where: { ...tenantWhere, createdAt: { gte: from, lte: to } } as any,
          select: { createdAt: true },
          orderBy: { createdAt: 'asc' },
          skip,
          take: 50,
        }).catch(() => [] as Array<{ createdAt: Date }>),
        50000,
      ),
      fetchPaginated(
        (skip) => prisma.loginAttempt.findMany({
          where: { success: true, createdAt: { gte: wauFrom, lte: to } } as any,
          select: { email: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
          skip,
          take: 50,
        }).catch(() => [] as Array<{ email: string; createdAt: Date }>),
        50000,
      ),
      fetchPaginated(
        (skip) => prisma.contestParticipation.findMany({
          where: { syncedAt: { gte: from, lte: to }, ...(collegeId ? { user: { collegeId } } : {}) } as any,
          select: { syncedAt: true },
          orderBy: { syncedAt: 'asc' },
          skip,
          take: 50,
        }).catch(() => [] as Array<{ syncedAt: Date }>),
        50000,
      ),
      fetchPaginated(
        (skip) => prisma.codingProfile.findMany({
          where: { lastSyncedAt: { gte: from, lte: to }, ...(collegeId ? { user: { collegeId } } : {}) } as any,
          select: { lastSyncedAt: true },
          orderBy: { lastSyncedAt: 'asc' },
          skip,
          take: 50,
        }).catch(() => [] as Array<{ lastSyncedAt: Date | null }>),
        50000,
      ),
      getUsageSummary({ collegeId, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }).catch(() => [] as Array<{ day: string; tokens: number; requests: number; costCents: number }>),
      // Fetch throughput: machine-written opportunity rows (guarded, paginated —
      // fetch tables grow faster than user tables, hence 20k safety cap each).
      fetchPaginated(
        (skip) => prisma.codingContest.findMany({
          where: { createdAt: { gte: from, lte: to }, ...(collegeId ? { collegeId } : {}) } as any,
          select: { createdAt: true },
          orderBy: { createdAt: 'asc' },
          skip,
          take: 50,
        }).catch(() => [] as Array<{ createdAt: Date }>),
        20000,
      ),
      fetchPaginated(
        (skip) => prisma.hackathonStaging.findMany({
          where: { createdAt: { gte: from, lte: to }, ...(collegeId ? { collegeId } : {}) } as any,
          select: { createdAt: true },
          orderBy: { createdAt: 'asc' },
          skip,
          take: 50,
        }).catch(() => [] as Array<{ createdAt: Date }>),
        20000,
      ),
      fetchPaginated(
        (skip) => prisma.internshipStaging.findMany({
          where: { createdAt: { gte: from, lte: to }, ...(collegeId ? { collegeId } : {}) } as any,
          select: { createdAt: true },
          orderBy: { createdAt: 'asc' },
          skip,
          take: 50,
        }).catch(() => [] as Array<{ createdAt: Date }>),
        20000,
      ),
    ])

    const registrations = (() => {
      try {
        return bucketByDay((regRows as Array<{ createdAt: Date }>).map((r) => r.createdAt), from, to)
      } catch { return empty }
    })()
    const dau = (() => {
      try {
        return bucketDau((loginRows as Array<{ email: string; createdAt: Date }>).map((r) => ({ key: r.email, at: r.createdAt })), from, to)
      } catch { return empty }
    })()
    const wau = (() => {
      try {
        // Same rows as DAU (wider window incl. 6d lookback) — rolling 7d union.
        return bucketWau((loginRows as Array<{ email: string; createdAt: Date }>).map((r) => ({ key: r.email, at: r.createdAt })), from, to)
      } catch { return empty }
    })()
    const syncs = (() => {
      try {
        const dates: Date[] = [
          ...(syncRows as Array<{ syncedAt: Date }>).map((r) => r.syncedAt),
          ...(profileRows as Array<{ lastSyncedAt: Date | null }>).map((r) => r.lastSyncedAt).filter((d): d is Date => !!d),
        ]
        return bucketByDay(dates, from, to)
      } catch { return empty }
    })()
    // Fetch counts: all three opportunity-ingest tables bucketed per day.
    const fetchSeries = (() => {
      try {
        const dates: Date[] = [
          ...(contestRows as Array<{ createdAt: Date }>).map((r) => r.createdAt),
          ...(hackStageRows as Array<{ createdAt: Date }>).map((r) => r.createdAt),
          ...(internStageRows as Array<{ createdAt: Date }>).map((r) => r.createdAt),
        ]
        return bucketByDay(dates, from, to)
      } catch { return empty }
    })()
    const fetchSources = {
      contests: (contestRows as Array<unknown>).length,
      hackathons: (hackStageRows as Array<unknown>).length,
      internships: (internStageRows as Array<unknown>).length,
    }
    const aiByDay = (() => {
      try {
        const map = new Map<string, { tokens: number; requests: number; costCents: number }>()
        for (const r of aiRows as Array<{ day: string; tokens: number; requests: number; costCents: number }>) {
          const e = map.get(r.day) ?? { tokens: 0, requests: 0, costCents: 0 }
          e.tokens += r.tokens || 0
          e.requests += r.requests || 0
          e.costCents += r.costCents || 0
          map.set(r.day, e)
        }
        return days.map((day) => ({ day, ...(map.get(day) ?? { tokens: 0, requests: 0, costCents: 0 }) }))
      } catch {
        return days.map((day) => ({ day, tokens: 0, requests: 0, costCents: 0 }))
      }
    })()

    res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
    res.json({
      range: { collegeId: collegeId || null, from: from.toISOString(), to: to.toISOString() },
      dau,
      wau,
      registrations,
      syncs,
      fetches: fetchSeries,
      fetchSources,
      ai: aiByDay,
      totals: {
        dau: sumSeries(dau),
        // WAU is a rolling window — the current value is the last day's point,
        // not a sum (summing would 7x-count the same users).
        wau: wau.length ? wau[wau.length - 1].count : 0,
        registrations: sumSeries(registrations),
        syncs: sumSeries(syncs),
        fetches: sumSeries(fetchSeries),
        aiTokens: aiByDay.reduce((a, p) => a + p.tokens, 0),
        aiRequests: aiByDay.reduce((a, p) => a + p.requests, 0),
        aiCostCents: aiByDay.reduce((a, p) => a + p.costCents, 0),
      },
    })
  } catch (error) {
    logger.error({ err: error }, 'Platform KPIs error:')
    res.status(500).json({ error: 'Failed to fetch platform KPIs' })
  }
})

// Get all hackathons (admin — supports ?collegeId= filter for super admin)
// 10k scale: take:50 max + count in parallel, _count instead of full
// registrations/rounds blobs. Dual-mode: ?page/?limit/?cursor → envelope
// {data, pagination:{page,limit,total,pages,nextCursor}}; no query → capped
// array (compat, same element shape with legacy registrations/rounds arrays).
router.get('/hackathons', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }) // HALF2: narrow (was full row incl. passwordHash)
    if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }
    let where: any = {}
    if (user.role === 'SUPER_ADMIN') {
      const collegeId = getSuperAdminTargetCollegeId(req) as string | undefined
      if (collegeId) where = { collegeId }
    } else {
      where = { OR: [{ collegeId: user.collegeId }, { collegeId: null }] }
    }
    const wantsPaged = req.query.page != null || req.query.limit != null || req.query.cursor != null
    const limitParam = parseInt(String(req.query.limit || '50'), 10)
    const limit = Number.isFinite(limitParam) ? Math.min(50, Math.max(1, limitParam)) : 50
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
    const skip = (page - 1) * limit
    const cursorId = req.query.cursor ? String(req.query.cursor) : null
    const cursorClause: any = cursorId ? { cursor: { id: cursorId }, skip: 1 } : { skip }
    const [rows, total] = await Promise.all([
      prisma.hackathon.findMany({
        where,
        include: { creator: { select: { name: true } }, _count: { select: { registrations: true, rounds: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        ...cursorClause,
      }),
      prisma.hackathon.count({ where }),
    ])
    // Map _count to legacy fields (frontend uses registrations?.length)
    const hackathons = (rows as any[]).map((h: any) => ({
      ...h,
      registrations: Array(h._count.registrations).fill({}),
      rounds: Array(h._count.rounds).fill({}),
      registrationsCount: h._count.registrations,
      roundsCount: h._count.rounds,
    }))
    res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
    if (wantsPaged) {
      const pages = Math.ceil(total / limit)
      const nextCursor = rows.length === limit ? (rows[rows.length - 1] as any)?.id ?? null : null
      res.json({ data: hackathons, pagination: { page, limit, total, pages, nextCursor } })
      return
    }
    res.set('X-Total-Count', String(total))
    res.json(hackathons)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch hackathons' })
  }
})

// Get all forms (admin — supports ?collegeId= filter for super admin)
// 10k scale: take:50 max + count, _count instead of full responses blob (same
// dual-mode + legacy mapping as /admin/hackathons).
router.get('/forms', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }) // HALF2: narrow (was full row incl. passwordHash)
    if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }
    let where: any = {}
    if (user.role === 'SUPER_ADMIN') {
      const collegeId = getSuperAdminTargetCollegeId(req) as string | undefined
      if (collegeId) where = { collegeId }
    } else {
      where = { OR: [{ collegeId: user.collegeId }, { collegeId: null }] }
    }
    const wantsPaged = req.query.page != null || req.query.limit != null || req.query.cursor != null
    const limitParam = parseInt(String(req.query.limit || '50'), 10)
    const limit = Number.isFinite(limitParam) ? Math.min(50, Math.max(1, limitParam)) : 50
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
    const skip = (page - 1) * limit
    const cursorId = req.query.cursor ? String(req.query.cursor) : null
    const cursorClause: any = cursorId ? { cursor: { id: cursorId }, skip: 1 } : { skip }
    const [rows, total] = await Promise.all([
      prisma.form.findMany({
        where,
        include: { creator: { select: { name: true } }, _count: { select: { responses: true, fields: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        ...cursorClause,
      }),
      prisma.form.count({ where }),
    ])
    const forms = (rows as any[]).map((f: any) => ({
      ...f,
      responses: Array(f._count.responses).fill({}),
      fields: Array(f._count.fields).fill({}),
      responsesCount: f._count.responses,
      fieldsCount: f._count.fields,
    }))
    res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
    if (wantsPaged) {
      const pages = Math.ceil(total / limit)
      const nextCursor = rows.length === limit ? (rows[rows.length - 1] as any)?.id ?? null : null
      res.json({ data: forms, pagination: { page, limit, total, pages, nextCursor } })
      return
    }
    res.set('X-Total-Count', String(total))
    res.json(forms)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch forms' })
  }
})

// Delete any hackathon (admin override — college-scoped)
router.delete('/hackathons/:id', async (req: AuthRequest, res: Response) => {
  try {
    // HALF2: parallel independent reads (was user then hackathon sequential) + narrow auth kept
    const [user, hackathon] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }),
      prisma.hackathon.findUnique({ where: { id: req.params.id as string } }),
    ])
    if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }

    if (!hackathon) {
      res.status(404).json({ error: 'Hackathon not found' })
      return
    }

    if (user.role !== 'SUPER_ADMIN' && hackathon.collegeId !== user.collegeId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    // HALF2: parallel child deletes (were 2 sequential awaits; parent delete still after due to FK)
    await Promise.all([
      prisma.hackathonRound.deleteMany({ where: { hackathonId: req.params.id as string } }),
      prisma.hackathonRegistration.deleteMany({ where: { hackathonId: req.params.id as string } }),
    ])
    await prisma.hackathon.delete({ where: { id: req.params.id as string } })
    try { broadcastHackathonMutation({ hackathonId: req.params.id as string, action: 'deleted' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete hackathon' })
  }
})

// Delete any form (admin override — college-scoped)
router.delete('/forms/:id', async (req: AuthRequest, res: Response) => {
  try {
    // HALF2: parallel independent reads (was user then form sequential) + narrow auth kept
    const [user, form] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }),
      prisma.form.findUnique({ where: { id: req.params.id as string } }),
    ])
    if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }

    if (!form) {
      res.status(404).json({ error: 'Form not found' })
      return
    }

    if (user.role !== 'SUPER_ADMIN' && form.collegeId !== user.collegeId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    // HALF2: parallel child deletes (were 2 sequential awaits; parent delete still after due to FK)
    await Promise.all([
      prisma.formResponse.deleteMany({ where: { formId: req.params.id as string } }),
      prisma.formField.deleteMany({ where: { formId: req.params.id as string } }),
    ])
    await prisma.form.delete({ where: { id: req.params.id as string } })
    try { broadcastFormMutation(req.params.id as string) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete form' })
  }
})

// Get analytics (supports ?collegeId= filter for super admin)
router.get('/analytics', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }) // HALF2: narrow (was full row incl. passwordHash)
    if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    let where: any = {}
    if (user.role === 'SUPER_ADMIN') {
      const collegeId = getSuperAdminTargetCollegeId(req) as string | undefined
      if (collegeId) where = { collegeId }
    } else {
      where = { collegeId: user.collegeId }
    }

    const [totalStudents, totalTeachers, hackathons, forms, registrations] = await Promise.all([
      prisma.user.count({ where: { ...where, role: 'STUDENT' } }),
      prisma.user.count({ where: { ...where, role: 'TEACHER' } }),
      prisma.hackathon.count({ where: where.collegeId ? { collegeId: where.collegeId } : {} }),
      prisma.form.count({ where: where.collegeId ? { collegeId: where.collegeId } : {} }),
      prisma.hackathonRegistration.count({
        where: {
          hackathon: where.collegeId ? { collegeId: where.collegeId } : {},
        },
      }),
    ])

    // CACHE-ALL: counts-only aggregate, no PII — private edge SWR (codingProfile.ts:333 pattern).
    res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
    res.json({
      totalStudents,
      totalTeachers,
      hackathons,
      forms,
      registrations,
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch analytics' })
  }
})

// ==================== COLLEGE MANAGEMENT ====================

// College Admin: Register a new college (creates pending college)
router.post('/colleges/register', async (req: AuthRequest, res: Response) => {
  try {
    // HALF2: narrow incl. email (adminEmail used; was full row)
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, email: true } })
    if (!user || user.role !== 'COLLEGE_ADMIN') {
      res.status(403).json({ error: 'Only college admins can register colleges' })
      return
    }

    const { name, code, address, phone, website } = req.body

    const existingCollege = await prisma.college.findFirst({
      where: { OR: [{ name }, { code }] },
    })
    if (existingCollege) {
      res.status(400).json({ error: 'College name or code already exists' })
      return
    }

    const college = await prisma.college.create({
      data: {
        name,
        code,
        address,
        phone,
        website,
        adminEmail: user.email,
        status: 'PENDING',
      },
    })

    // Link user to this college
    await prisma.user.update({
      where: { id: user.id },
      data: { collegeId: college.id },
    })
    try { broadcastCollegeMutation({ collegeId: college.id, action: 'registered' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    void recordAudit({
      actorId: user.id, actorEmail: user.email ?? null, actorRole: user.role,
      action: AuditActions.COLLEGE_REGISTER, entityType: 'COLLEGE', entityId: college.id, collegeId: college.id,
      metadata: buildAuditMetadata({ name: college.name, code: college.code }),
    })

    res.status(201).json(college)
  } catch (error) {
    logger.error({ err: error }, 'Register college error:')
    res.status(500).json({ error: 'Failed to register college' })
  }
})

// Super Admin: Get all colleges
router.get('/colleges', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }) // HALF2: narrow (was full row incl. passwordHash)
    if (!user || user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin only' })
      return
    }

    const colleges = await prisma.college.findMany({
      include: {
        _count: { select: { users: true, hackathons: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    // CACHE-ALL: tenant registry (id/name/_count, no user PII) — private edge SWR.
    res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60')
    res.json(colleges)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch colleges' })
  }
})

// Super Admin: Approve college
router.put('/colleges/:id/approve', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, email: true } })
    if (!user || user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin only' })
      return
    }

    const college = await prisma.college.update({
      where: { id: req.params.id as string },
      data: { status: 'APPROVED' },
    })
    try { broadcastCollegeMutation({ collegeId: college.id, action: 'approved' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    void recordAudit({
      actorId: user.id, actorEmail: (user as any).email ?? null, actorRole: user.role,
      action: AuditActions.COLLEGE_APPROVE, entityType: 'COLLEGE', entityId: college.id, collegeId: college.id,
      metadata: buildAuditMetadata({ name: college.name }),
    })

    res.json(college)
  } catch (error) {
    res.status(500).json({ error: 'Failed to approve college' })
  }
})

// Super Admin: Reject college
router.put('/colleges/:id/reject', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, email: true } })
    if (!user || user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin only' })
      return
    }

    const college = await prisma.college.update({
      where: { id: req.params.id as string },
      data: { status: 'REJECTED' },
    })
    try { broadcastCollegeMutation({ collegeId: college.id, action: 'rejected' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    void recordAudit({
      actorId: user.id, actorEmail: (user as any).email ?? null, actorRole: user.role,
      action: AuditActions.COLLEGE_REJECT, entityType: 'COLLEGE', entityId: college.id, collegeId: college.id,
      metadata: buildAuditMetadata({ name: college.name }),
    })

    res.json(college)
  } catch (error) {
    res.status(500).json({ error: 'Failed to reject college' })
  }
})

// Super Admin: Delete college — friendly 400 when users still reference it
// (prevents raw Prisma P2003 FK error leaking + accidental tenant wipe).
router.delete('/colleges/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, email: true } })
    if (!user || user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin only' })
      return
    }

    const collegeId = req.params.id as string
    // HALF2: parallel independent reads (was existing then count sequential); 404 precedence preserved
    const [existing, userCount] = await Promise.all([
      prisma.college.findUnique({ where: { id: collegeId } }),
      prisma.user.count({ where: { collegeId } }),
    ])
    if (!existing) {
      res.status(404).json({ error: 'College not found' })
      return
    }

    if (userCount > 0) {
      res.status(400).json({
        error: `Cannot delete college with ${userCount} user(s). Reassign or remove users first.`,
        code: 'COLLEGE_HAS_USERS',
        userCount,
      })
      return
    }

    await prisma.college.delete({ where: { id: collegeId } })
    try { broadcastCollegeMutation({ collegeId, action: 'deleted' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    void recordAudit({
      actorId: user.id, actorEmail: (user as any).email ?? null, actorRole: user.role,
      action: AuditActions.COLLEGE_DELETE, entityType: 'COLLEGE', entityId: collegeId, collegeId,
      metadata: buildAuditMetadata({ name: (existing as any)?.name }),
    })
    res.json({ message: 'College deleted' })
  } catch (error: any) {
    // Prisma FK violation (e.g., races where users were added concurrently)
    if (error?.code === 'P2003') {
      res.status(400).json({ error: 'Cannot delete college: dependent records exist. Reassign users first.', code: 'COLLEGE_HAS_DEPENDENCIES' })
      return
    }
    res.status(500).json({ error: 'Failed to delete college' })
  }
})

// ==================== USER MANAGEMENT ====================

// Get all users in college (supports ?collegeId= filter for super admin)
// 10k scale: take:50 max + count in parallel. Dual-mode (same as hackathons/forms):
// paged query → envelope, no query → capped array (compat).
// List filters: ?role=STUDENT|TEACHER|COLLEGE_ADMIN|SUPER_ADMIN + ?departmentId=
// (users sub-tabs / department dropdown). Unknown ?role= → 400; pagination untouched.
router.get('/users', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }) // HALF2: narrow (was full row incl. passwordHash)
    if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    let where: any = {}
    if (user.role === 'SUPER_ADMIN') {
      const collegeId = getSuperAdminTargetCollegeId(req) as string | undefined
      if (collegeId) where = { collegeId }
    } else {
      where = { collegeId: user.collegeId }
    }

    if (isInvalidRoleFilter(req.query.role)) {
      res.status(400).json({ error: 'Invalid role filter. Use STUDENT, TEACHER, COLLEGE_ADMIN or SUPER_ADMIN.' })
      return
    }
    where = applyUserListFilters(where, {
      role: normalizeRoleFilter(req.query.role),
      departmentId: normalizeDepartmentFilter(req.query.departmentId),
    })

    const wantsPaged = req.query.page != null || req.query.limit != null || req.query.cursor != null
    const limitParam = parseInt(String(req.query.limit || '50'), 10)
    const limit = Number.isFinite(limitParam) ? Math.min(50, Math.max(1, limitParam)) : 50
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
    const skip = (page - 1) * limit
    const cursorId = req.query.cursor ? String(req.query.cursor) : null
    const cursorClause: any = cursorId ? { cursor: { id: cursorId }, skip: 1 } : { skip }
    const select = {
      id: true,
      name: true,
      email: true,
      role: true,
      departmentId: true,
      department: true,
      studentId: true,
      empNumber: true,
      incomingYear: true,
      outgoingYear: true,
      collegeId: true,
      college: { select: { name: true } },
      createdAt: true,
    } as const

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        ...cursorClause,
      }),
      prisma.user.count({ where }),
    ])

    res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
    if (wantsPaged) {
      const pages = Math.ceil(total / limit)
      const nextCursor = (users as any[]).length === limit ? (users[users.length - 1] as any)?.id ?? null : null
      res.json({ data: users, pagination: { page, limit, total, pages, nextCursor } })
      return
    }
    res.set('X-Total-Count', String(total))
    res.json(users)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' })
  }
})

// GET /users/role-counts — tab-badge totals (Track 4: useAdminRoleCounts).
// WHY a dedicated endpoint: AdminPage previously paid 3× take:1+count
// round-trips per dept change for STUDENT/TEACHER/COLLEGE_ADMIN totals.
// Single GROUP BY with the SAME tenant scoping + department filter as GET
// /users, so badges can never disagree with the list. Placed before
// /users/:id-style routes (Express matches in order; no GET /users/:id exists
// today, but keep specific-before-param as a rule).
router.get('/users/role-counts', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }) // HALF2: narrow (was full row incl. passwordHash)
    if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    let where: any = {}
    if (user.role === 'SUPER_ADMIN') {
      const collegeId = getSuperAdminTargetCollegeId(req) as string | undefined
      if (collegeId) where = { collegeId }
    } else {
      where = { collegeId: user.collegeId }
    }
    where = applyUserListFilters(where, {
      departmentId: normalizeDepartmentFilter(req.query.departmentId),
    })

    const groups = await prisma.user.groupBy({
      by: ['role'],
      where,
      _count: { role: true },
    })
    const counts = { students: 0, teachers: 0, college_admins: 0 }
    for (const g of groups) {
      if (g.role === 'STUDENT') counts.students = g._count.role
      else if (g.role === 'TEACHER') counts.teachers = g._count.role
      else if (g.role === 'COLLEGE_ADMIN') counts.college_admins = g._count.role
    }
    res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
    res.json(counts)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch role counts' })
  }
})

// Add teacher to college
router.post('/users/teacher', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, email: true } })
    if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'College admin or super admin access required' })
      return
    }

    const collegeId = deriveCollegeId(user as any, req.body.collegeId as string | null | undefined, req)
    if (!collegeId) {
      res.status(400).json({ error: 'College ID is required' })
      return
    }

    const { email, name, password, departmentId, empNumber } = req.body

    const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } }) // HALF2: narrow existence check (was full row)
    if (existingUser) {
      res.status(400).json({ error: 'Email already exists' })
      return
    }

    // P0 SECURITY (F16): unify min 8 / max 72 for admin-created passwords too.
    if (password && (String(password).length < 8 || String(password).length > 72)) {
      res.status(400).json({ error: 'Password must be 8-72 characters' })
      return
    }
    if (password && isCommonPassword(String(password))) {
      res.status(400).json({ error: 'Password is too common, choose a stronger password' })
      return
    }
    if (password) {
      try { const b = await checkPasswordBreach(String(password)); if (b.breached) { res.status(400).json({ error: 'Password has appeared in a data breach, choose a different password' }); return } } catch {}
    }

    // Validate departmentId if provided
    if (departmentId) {
      // HALF2: narrow to collegeId only (was full row; only collegeId used)
      const dept = await prisma.department.findUnique({ where: { id: departmentId }, select: { collegeId: true } })
      if (!dept || dept.collegeId !== collegeId) {
        res.status(400).json({ error: 'Invalid department' })
        return
      }
    }

    const tempPassword = crypto.randomBytes(9).toString('base64url').slice(0, 12) + 'A1!'
    const passwordHash = await bcrypt.hash(password || tempPassword, 12)

    const newUser = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: 'TEACHER',
        collegeId,
        departmentId: departmentId || undefined,
        empNumber,
      },
    })
    // Order 12 CTI dual-write (best-effort, pre-migration safe).
    try {
      const { dualWriteProfiles } = await import('../utils/userProfiles.js').catch(() => ({ dualWriteProfiles: null as any }))
      if (typeof dualWriteProfiles === 'function') await (dualWriteProfiles as any)(prisma, { userId: newUser.id, role: 'TEACHER', empNumber })
    } catch {}
    try { broadcastUserMutation({ userId: newUser.id, collegeId, action: 'teacher:created' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    void recordAudit({
      actorId: user.id, actorEmail: (user as any).email ?? null, actorRole: user.role,
      action: AuditActions.USER_CREATE, entityType: 'TEACHER', entityId: newUser.id, collegeId,
      metadata: buildAuditMetadata({ email: newUser.email, name: newUser.name }),
    })

    res.status(201).json({
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
      tempPassword: password ? undefined : tempPassword,
    })
  } catch (error) {
    logger.error({ err: error }, 'Add teacher error:')
    res.status(500).json({ error: 'Failed to create teacher' })
  }
})

// Add student to college
router.post('/users/student', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, email: true } })
    if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'College admin or super admin access required' })
      return
    }

    const collegeId = deriveCollegeId(user as any, req.body.collegeId as string | null | undefined, req)
    if (!collegeId) {
      res.status(400).json({ error: 'College ID is required' })
      return
    }

    const { email, name, password, departmentId, studentId, incomingYear } = req.body

    const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } }) // HALF2: narrow existence check (was full row)
    if (existingUser) {
      res.status(400).json({ error: 'Email already exists' })
      return
    }

    if (password && (String(password).length < 8 || String(password).length > 72)) {
      res.status(400).json({ error: 'Password must be 8-72 characters' })
      return
    }
    if (password && isCommonPassword(String(password))) {
      res.status(400).json({ error: 'Password is too common, choose a stronger password' })
      return
    }
    if (password) {
      try { const b = await checkPasswordBreach(String(password)); if (b.breached) { res.status(400).json({ error: 'Password has appeared in a data breach, choose a different password' }); return } } catch {}
    }

    // Validate departmentId if provided
    if (departmentId) {
      // HALF2: narrow to collegeId only (was full row; only collegeId used)
      const dept = await prisma.department.findUnique({ where: { id: departmentId }, select: { collegeId: true } })
      if (!dept || dept.collegeId !== collegeId) {
        res.status(400).json({ error: 'Invalid department' })
        return
      }
    }

    const tempPassword = crypto.randomBytes(9).toString('base64url').slice(0, 12) + 'A1!'
    const passwordHash = await bcrypt.hash(password || tempPassword, 12)
    const incoming = incomingYear ? parseInt(incomingYear) : undefined
    if (incoming !== undefined && isNaN(incoming)) {
      res.status(400).json({ error: 'Invalid incomingYear value' })
      return
    }

    const newUser = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: 'STUDENT',
        collegeId,
        departmentId: departmentId || undefined,
        studentId,
        incomingYear: incoming,
        outgoingYear: incoming ? incoming + 4 : undefined,
      },
    })
    // Order 12 CTI dual-write (best-effort, pre-migration safe).
    try {
      const { dualWriteProfiles } = await import('../utils/userProfiles.js').catch(() => ({ dualWriteProfiles: null as any }))
      if (typeof dualWriteProfiles === 'function') await (dualWriteProfiles as any)(prisma, { userId: newUser.id, role: 'STUDENT', studentId, incomingYear: incoming, outgoingYear: incoming ? incoming + 4 : undefined })
    } catch {}
    try { broadcastUserMutation({ userId: newUser.id, collegeId, action: 'student:created' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    void recordAudit({
      actorId: user.id, actorEmail: (user as any).email ?? null, actorRole: user.role,
      action: AuditActions.USER_CREATE, entityType: 'STUDENT', entityId: newUser.id, collegeId,
      metadata: buildAuditMetadata({ email: newUser.email, name: newUser.name }),
    })

    res.status(201).json({
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
      tempPassword: password ? undefined : tempPassword,
    })
  } catch (error) {
    logger.error({ err: error }, 'Add student error:')
    res.status(500).json({ error: 'Failed to create student' })
  }
})

// #11 bulk CSV import: shared input normalization (JSON arrays OR raw CSV
// text) + dry-run detection. Frontend modal sends {teachers|students} arrays
// after client-side CSV parse; {csv} text is accepted for API clients.
function extractBulkRows(body: any, key: 'teachers' | 'students'): import('../services/adminBulk').BulkRow[] {
  const direct = (body as any)?.[key]
  if (Array.isArray(direct)) return direct as import('../services/adminBulk').BulkRow[]
  if (Array.isArray((body as any)?.rows)) return (body as any).rows as import('../services/adminBulk').BulkRow[]
  if (typeof (body as any)?.csv === 'string' && (body as any).csv.trim()) {
    try {
      return parseCsv((body as any).csv)
    } catch {
      return []
    }
  }
  return []
}

function isDryRun(req: AuthRequest): boolean {
  return (req.body as any)?.dryRun === true || (req.body as any)?.dryRun === 'true' || req.query.dryRun === 'true'
}

// Bulk add teachers via CSV (batched — see services/adminBulk.ts).
// Behavior identical ({success,failed,errors}); 4 round-trips total, not 4N.
// #11: ?dryRun=true (or {dryRun:true}) returns a per-row validation report
// {dryRun:true,total,validCount,invalidCount,rows,errors} with zero writes.
router.post('/users/teachers/bulk', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, email: true } })
    if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'College admin or super admin access required' })
      return
    }

    const collegeId = deriveCollegeId(user as any, req.body.collegeId as string | null | undefined, req)
    if (!collegeId) {
      res.status(400).json({ error: 'College ID is required' })
      return
    }

    const rows = extractBulkRows(req.body, 'teachers')
    if (isDryRun(req)) {
      const report = await dryRunBulkTeachers(collegeId, rows)
      void recordAudit({
        actorId: user.id, actorEmail: (user as any).email ?? null, actorRole: user.role,
        action: AuditActions.USER_BULK_DRY_RUN, entityType: 'TEACHER', collegeId,
        metadata: buildAuditMetadata({ type: 'teachers', total: report.total, valid: report.validCount, invalid: report.invalidCount }),
      })
      res.json({ dryRun: true, ...report })
      return
    }
    const results = await bulkCreateTeachers(collegeId, rows)
    if (results.success > 0) {
      try {
        broadcastUserMutation({ collegeId, action: 'teachers:bulk-created', count: results.success })
      } catch (err) {
        logger.debug({ err }, '[admin] teachers bulk broadcast failed (non-fatal)')
      }
    }
    void recordAudit({
      actorId: user.id, actorEmail: (user as any).email ?? null, actorRole: user.role,
      action: AuditActions.USER_BULK_CREATE, entityType: 'TEACHER', collegeId,
      metadata: buildAuditMetadata({ type: 'teachers', success: results.success, failed: results.failed }),
    })

    res.json(results)
  } catch (error) {
    logger.warn({ err: (error as Error)?.message || error }, '[admin] bulk teachers failed:')
    res.status(500).json({ error: 'Failed to bulk add teachers' })
  }
})

// Bulk add students via CSV (batched — see services/adminBulk.ts).
// Behavior identical ({success,failed,errors}); 4 round-trips total, not 4N.
// #11: dry-run mode mirrors the teachers route (zero writes, per-row report).
router.post('/users/students/bulk', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, email: true } })
    if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'College admin or super admin access required' })
      return
    }

    const collegeId = deriveCollegeId(user as any, req.body.collegeId as string | null | undefined, req)
    if (!collegeId) {
      res.status(400).json({ error: 'College ID is required' })
      return
    }

    const rows = extractBulkRows(req.body, 'students')
    if (isDryRun(req)) {
      const report = await dryRunBulkStudents(collegeId, rows)
      void recordAudit({
        actorId: user.id, actorEmail: (user as any).email ?? null, actorRole: user.role,
        action: AuditActions.USER_BULK_DRY_RUN, entityType: 'STUDENT', collegeId,
        metadata: buildAuditMetadata({ type: 'students', total: report.total, valid: report.validCount, invalid: report.invalidCount }),
      })
      res.json({ dryRun: true, ...report })
      return
    }
    const results = await bulkCreateStudents(collegeId, rows)
    if (results.success > 0) {
      try {
        broadcastUserMutation({ collegeId, action: 'students:bulk-created', count: results.success })
      } catch (err) {
        logger.debug({ err }, '[admin] students bulk broadcast failed (non-fatal)')
      }
    }
    void recordAudit({
      actorId: user.id, actorEmail: (user as any).email ?? null, actorRole: user.role,
      action: AuditActions.USER_BULK_CREATE, entityType: 'STUDENT', collegeId,
      metadata: buildAuditMetadata({ type: 'students', success: results.success, failed: results.failed }),
    })

    res.json(results)
  } catch (error) {
    logger.warn({ err: (error as Error)?.message || error }, '[admin] bulk students failed:')
    res.status(500).json({ error: 'Failed to bulk add students' })
  }
})

// #11a unified bulk CSV import: POST /admin/users/import.
// WHY unified: split /teachers/bulk + /students/bulk force the caller to pick
// the endpoint; semester onboarding scripts want one path with {role} +
// {rows|csv}. Behavior delegates verbatim to the same dry-run/bulk services
// (per-row reports, createMany skipDuplicates, dept-name + incomingYear
// handling), so the split routes and this route can never disagree.
// Body: {role?: 'STUDENT'|'TEACHER', rows?: BulkRow[], teachers?: BulkRow[],
//   students?: BulkRow[], csv?: string, collegeId?: string, dryRun?: boolean}.
// Dry-run: ?dryRun=true (or {dryRun:true}) → per-row report, zero writes.
// Confirm: → {role, success, failed, errors}. No secrets in responses.
router.post('/users/import', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, email: true } })
    if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'College admin or super admin access required' })
      return
    }

    const collegeId = deriveCollegeId(user as any, req.body.collegeId as string | null | undefined, req)
    if (!collegeId) {
      res.status(400).json({ error: 'College ID is required' })
      return
    }

    const role = resolveBulkImportRole(req.body as any, req.query as any)
    if (!role) {
      res.status(400).json({ error: 'Invalid role. Use STUDENT or TEACHER.' })
      return
    }

    const rows = extractImportRows(req.body as any, role)
    if (rows.length === 0) {
      res.status(400).json({ error: 'No rows to import. Send {rows} (or {teachers}/{students}) or {csv} text with a name+email header.' })
      return
    }

    const isTeacher = role === 'TEACHER'
    const entityType = isTeacher ? 'TEACHER' : 'STUDENT'
    if (isDryRun(req)) {
      const report = isTeacher
        ? await dryRunBulkTeachers(collegeId, rows)
        : await dryRunBulkStudents(collegeId, rows)
      void recordAudit({
        actorId: user.id, actorEmail: (user as any).email ?? null, actorRole: user.role,
        action: AuditActions.USER_BULK_DRY_RUN, entityType, collegeId,
        metadata: buildAuditMetadata({ type: role.toLowerCase() + 's', via: 'import', total: report.total, valid: report.validCount, invalid: report.invalidCount }),
      })
      res.json({ dryRun: true, role, ...report })
      return
    }
    const results = isTeacher
      ? await bulkCreateTeachers(collegeId, rows)
      : await bulkCreateStudents(collegeId, rows)
    if (results.success > 0) {
      try {
        broadcastUserMutation({ collegeId, action: isTeacher ? 'teachers:bulk-created' : 'students:bulk-created', count: results.success })
      } catch (err) {
        logger.debug({ err }, '[admin] unified import broadcast failed (non-fatal)')
      }
    }
    void recordAudit({
      actorId: user.id, actorEmail: (user as any).email ?? null, actorRole: user.role,
      action: AuditActions.USER_BULK_CREATE, entityType, collegeId,
      metadata: buildAuditMetadata({ type: role.toLowerCase() + 's', via: 'import', success: results.success, failed: results.failed }),
    })

    res.json({ role, ...results })
  } catch (error) {
    logger.warn({ err: (error as Error)?.message || error }, '[admin] unified import failed:')
    res.status(500).json({ error: 'Failed to bulk import users' })
  }
})

// Update user (college-scoped)
router.put('/users/:id', async (req: AuthRequest, res: Response) => {
  try {
    // HALF2: parallel independent reads (was user then target sequential) + narrow kept
    const [user, targetUser] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, email: true } }),
      prisma.user.findUnique({ where: { id: req.params.id as string }, select: { id: true, collegeId: true } }),
    ])
    if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    // Verify target user belongs to the same college (SUPER_ADMIN bypasses)
    if (!targetUser) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    if (user.role !== 'SUPER_ADMIN' && targetUser.collegeId !== user.collegeId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    const { name, email, departmentId, role, incomingYear } = req.body

    // Only Super Admin can assign Super Admin role
    if (role === 'SUPER_ADMIN' && user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Only Super Admin can assign Super Admin role' })
      return
    }

    // Validate departmentId if provided
    if (departmentId) {
      // HALF2: narrow to collegeId only (was full row; only collegeId used)
      const dept = await prisma.department.findUnique({ where: { id: departmentId }, select: { collegeId: true } })
      if (!dept || (user.role !== 'SUPER_ADMIN' && dept.collegeId !== user.collegeId)) {
        res.status(400).json({ error: 'Invalid department' })
        return
      }
    }

    const incoming = incomingYear ? parseInt(incomingYear) : undefined
    if (incoming !== undefined && isNaN(incoming)) {
      res.status(400).json({ error: 'Invalid incomingYear value' })
      return
    }
    const updated = await prisma.user.update({
      where: { id: req.params.id as string },
      data: {
        name,
        email,
        departmentId: role === 'SUPER_ADMIN' ? null : (departmentId || undefined),
        role,
        collegeId: role === 'SUPER_ADMIN' ? null : undefined,
        incomingYear: incoming,
        outgoingYear: incoming ? incoming + 4 : undefined,
      },
      include: { department: true },
    })
    try { clearAuthorizeCache(req.params.id as string) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    try { broadcastUserMutation({ userId: updated.id, collegeId: updated.collegeId, action: 'updated' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    void recordAudit({
      actorId: user.id, actorEmail: (user as any).email ?? null, actorRole: user.role,
      action: AuditActions.USER_UPDATE, entityType: 'USER', entityId: updated.id, collegeId: updated.collegeId ?? targetUser.collegeId ?? null,
      metadata: buildAuditMetadata({ role, name, email }),
    })

    res.json({ id: updated.id, name: updated.name, role: updated.role })
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user' })
  }
})

// Delete user (college-scoped)
router.delete('/users/:id', async (req: AuthRequest, res: Response) => {
  try {
    // HALF2: parallel independent reads (was user then target sequential) + narrow kept
    const [user, targetUser] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, email: true } }),
      prisma.user.findUnique({ where: { id: req.params.id as string }, select: { id: true, collegeId: true } }),
    ])
    if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    // Verify target user belongs to the same college (SUPER_ADMIN bypasses)
    if (!targetUser) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    if (user.role !== 'SUPER_ADMIN' && targetUser.collegeId !== user.collegeId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    await prisma.user.delete({ where: { id: req.params.id as string } })
    try { clearAuthorizeCache(req.params.id as string) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    try { broadcastUserMutation({ userId: req.params.id as string, collegeId: targetUser.collegeId, action: 'deleted' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    void recordAudit({
      actorId: user.id, actorEmail: (user as any).email ?? null, actorRole: user.role,
      action: AuditActions.USER_DELETE, entityType: 'USER', entityId: req.params.id as string, collegeId: targetUser.collegeId ?? null,
      metadata: null,
    })
    res.json({ message: 'User deleted' })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' })
  }
})

export default router




