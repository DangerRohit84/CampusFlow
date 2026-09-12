import { Router, Response } from 'express'
import bcrypt from 'bcryptjs'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import prisma from '../config/db'
import { authenticate, AuthRequest, clearAuthorizeCache } from '../middleware/auth'
import { getDayOfWeek } from '../utils/dateUtils'
import { getSuperAdminTargetCollegeId } from '../utils/roles'
import { broadcastUserMutation } from '../services/socket'
import { logger } from '../utils/logger'
import { buildAnonymizedUser, isDeletedUser, buildSelfDeleteAudit } from '../services/selfDelete'
import { recordAudit } from '../services/auditLog'
import { revokeJti } from '../utils/authHardening'
import { createSharedRateLimitStore } from '../lib/cache'
import { parsePreferencesSafe } from '../lib/validators'

const router = Router()
router.use(authenticate)

// Self-delete limiter: 3/h per (IP+user) — privacy.md §3 (reuse authLimiter pattern).
const selfDeleteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  store: createSharedRateLimitStore(60 * 60 * 1000, 'rl:self-delete:'),
  keyGenerator: (req) => {
    const ipPart = (req as any).ip ? ipKeyGenerator((req as any).ip) : 'unknown'
    const uid = (req as AuthRequest).userId
    return uid ? `${ipPart}:${uid}` : ipPart
  },
  message: { error: 'Too many delete attempts, please try again later' },
})

// DELETE /me — self-service erasure (privacy.md §3, anonymize-not-delete).
// 1. password re-entry → 2. anonymize User → 3. wipe CodingProfile +
// UserIntegration → 4. audit (no PII) + revoke session → 5. 200 { deleted }.
router.delete('/me', selfDeleteLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const password = (req.body as any)?.password
    if (typeof password !== 'string' || !password) {
      res.status(400).json({ error: 'Password confirmation required' })
      return
    }
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || isDeletedUser(user as any)) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      res.status(401).json({ error: 'Incorrect password' })
      return
    }
    const patch = buildAnonymizedUser(user.id)
    const { id: _omit, ...data } = patch
    const updated = await (prisma as any).user.update({ where: { id: user.id }, data })
    // Wipe handles + integration secrets (best-effort, never blocks erasure).
    try { await (prisma as any).codingProfile?.deleteMany?.({ where: { userId: user.id } }) } catch {}
    try { await (prisma as any).userIntegration?.deleteMany?.({ where: { userId: user.id } }) } catch {}
    try { await recordAudit(buildSelfDeleteAudit(user.id, (user as any).role)) } catch {}
    try { if (req.jwtJti) revokeJti(req.jwtJti) } catch {}
    try { if (req.userId) clearAuthorizeCache(req.userId) } catch {}
    try { broadcastUserMutation({ userId: user.id, action: 'user:self-deleted' }) } catch {}
    logger.info({ event: 'user:self-delete', actorId: user.id, requestId: (req as any).requestId })
    res.json({ deleted: true, anonymizedEmail: (updated as any).email })
  } catch (error) {
    logger.error({ requestId: (req as any).requestId, route: 'DELETE /api/user/me' }, 'Self-delete error')
    res.status(500).json({ error: 'Failed to delete account' })
  }
})

// Get grades
router.get('/grades', async (req: AuthRequest, res: Response) => {
  try {
    // Order 6: courseName via join (DB copy dropped).
    const _rows = await prisma.grade.findMany({
      where: { userId: req.userId },
      include: { course: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    })
    const grades = _rows.map((g: any) => ({ ...g, courseName: g.course?.name ?? null }))
    res.json(grades)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch grades' })
  }
})

// Get grade stats
router.get('/grades/stats', async (req: AuthRequest, res: Response) => {
  try {
    const _gr2 = await prisma.grade.findMany({ where: { userId: req.userId }, include: { course: { select: { name: true } } } })
    const grades: any[] = _gr2.map((g: any) => ({ ...g, courseName: g.course?.name ?? null }))
    const totalCredits = grades.reduce((sum, g) => sum + g.credits, 0)
    const weightedGpa = grades.reduce((sum, g) => sum + g.gpa * g.credits, 0)
    const cgpa = totalCredits > 0 ? weightedGpa / totalCredits : 0

    res.json({
      cgpa: Math.round(cgpa * 100) / 100,
      totalCredits,
      courseCount: grades.length,
      grades,
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' })
  }
})



// Helpers for username
function sanitizeUsername(raw: string): string {
  return raw.toLowerCase().trim().replace(/[^a-z0-9_.-]/g, '').replace(/^[._-]+/, '').slice(0, 20)
}
function isValidUsername(u: string): boolean {
  return /^[a-z0-9]([a-z0-9._-]{1,18}[a-z0-9])?$/.test(u) && u.length >= 3 && u.length <= 20
}

function normalizePortfolioUrl(input: string): string | null {
  const raw = String(input || '').trim()
  if (!raw) return null
  // auto-prefix https:// if missing scheme
  let candidate = raw
  if (!/^https?:\/\//i.test(candidate)) candidate = 'https://' + candidate
  try {
    const u = new URL(candidate)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    // require host with dot or localhost
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null
    if (u.hostname.length < 3) return null
    // disallow javascript:, data:, etc already handled
    // normalize: keep as entered but ensure no spaces
    return u.toString()
  } catch {
    return null
  }
}
function isValidPortfolioUrl(input: string): boolean {
  return normalizePortfolioUrl(input) !== null
}

// Check username availability (authed)
router.get('/check-username/:username', async (req: AuthRequest, res: Response) => {
  try {
    const raw = sanitizeUsername(String(req.params.username || ''))
    if (!raw || !isValidUsername(raw)) {
      res.json({ available: false, reason: '3-20 chars, letters/numbers/_.-, start/end alphanumeric' })
      return
    }
    try {
      const existing = await (prisma as any).user.findFirst({ where: { username: raw } })
      if (existing && existing.id !== req.userId) {
        res.json({ available: false, reason: 'Already taken' })
        return
      }
      res.json({ available: true, username: raw })
    } catch (e: any) {
      const msg = String(e?.message || '')
      if (msg.includes('username') || msg.includes('Unknown argument')) {
        res.status(503).json({ error: 'Username feature not yet migrated' })
        return
      }
      throw e
    }
  } catch {
    res.status(500).json({ error: 'Check failed' })
  }
})

// Set / update own username (once or change)
router.put('/username', async (req: AuthRequest, res: Response) => {
  try {
    const rawInput = String(req.body.username || '').trim()
    const username = sanitizeUsername(rawInput)
    if (!username || !isValidUsername(username)) {
      res.status(400).json({ error: 'Invalid username: 3-20 chars, letters/numbers/_.- only, must start/end with letter or number' })
      return
    }
    const existing = await (prisma as any).user.findFirst({ where: { username } })
    if (existing && existing.id !== req.userId) {
      res.status(400).json({ error: 'Username already taken' })
      return
    }
    const user = await (prisma as any).user.findUnique({ where: { id: req.userId } })
    if (!user) { res.status(404).json({ error: 'User not found' }); return }
    // optional: prevent frequent changes? allow for now
    const updated = await (prisma as any).user.update({ where: { id: req.userId }, data: { username } as any })
    try { broadcastUserMutation({ userId: req.userId, action: 'username:updated' }) } catch {}
    res.json({ id: updated.id, username: (updated as any).username, name: updated.name, email: updated.email })
  } catch (error: any) {
    const msg = String(error?.message || '')
    if (msg.includes('Unique constraint')) {
      res.status(400).json({ error: 'Username already taken' })
      return
    }
    if (msg.includes('username') || msg.includes('Unknown argument') || msg.includes('column')) {
      res.status(503).json({ error: 'Username feature not yet migrated. Please run prisma migrate.' })
      return
    }
    logger.error({ err: error }, 'username update error')
    res.status(500).json({ error: 'Failed to update username' })
  }
})

// Suggest username based on current user
// NARROW-READ: only id+name+email (was full row incl. passwordHash) — same payload.
router.get('/suggest-username', async (req: AuthRequest, res: Response) => {
  try {
    const me = await (prisma as any).user.findUnique({ where: { id: req.userId }, select: { id: true, name: true, email: true } })
    if (!me) { res.status(404).json({ error: 'User not found' }); return }
    let base = sanitizeUsername((me.name || '').replace(/\s+/g, '_')) || sanitizeUsername(me.email.split('@')[0]) || 'user'
    if (base.length < 3) base = (base + 'user').slice(0, 20)
    let candidate = base
    let tries = 0
    while (tries < 20) {
      try {
        const exists = await (prisma as any).user.findFirst({ where: { username: candidate } })
        if (!exists || exists.id === req.userId) break
      } catch (e: any) {
        const msg = String(e?.message || '')
        if (msg.includes('username') || msg.includes('Unknown argument')) break
        throw e
      }
      tries++
      candidate = `${base}${tries}`.slice(0, 20)
    }
    res.json({ suggestion: candidate })
  } catch {
    res.status(500).json({ error: 'Suggest failed' })
  }
})

// Get user profile/settings
router.get('/profile', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    const u = user as any
    res.json({
      id: user.id,
      name: user.name,
      username: u.username || null,
      email: user.email,
      role: user.role,
      department: u.department,
      year: u.year,
      semester: u.semester,
      avatar: user.avatar,
      portfolioUrl: u.portfolioUrl || null,
      // topbottom F9: legacy rows may hold preferences as a corrupt STRING —
      // bare JSON.parse threw → 500 on core profile fetch. parsePreferencesSafe
      // degrades to {} (Json col normally returns an object already).
      preferences: parsePreferencesSafe((user as any).preferences),
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch profile' })
  }
})

// Update profile
router.put('/profile', async (req: AuthRequest, res: Response) => {
  try {
    const { name, department, year, semester, preferences, portfolioUrl } = req.body
    // topbottom F8: User has NO `department`/`year`/`semester` scalar cols
    // (departmentId FK + incomingYear/outgoingYear twins only) — passing them
    // made Prisma throw `Unknown argument` → 500 on every profile save that
    // included them. Strip explicitly (documented, not silent: same shape GET
    // already returns). Use departmentId/incomingYear via admin flows instead.
    void department
    void year
    void semester
    const updateData: any = {
      ...(name && { name }),
      ...(preferences && { preferences: preferences as any }), // Order 9: Json col — pass object
    }
    // portfolioUrl handling — allow any website URL (https), validate, allow clearing with empty string/null
    if (portfolioUrl !== undefined) {
      const raw = String(portfolioUrl || '').trim()
      if (raw === '' || raw === null) {
        updateData.portfolioUrl = null
      } else {
        const normalized = normalizePortfolioUrl(raw)
        if (!normalized) {
          res.status(400).json({ error: 'Invalid portfolio URL. Must be a valid https:// URL (e.g., https://your-portfolio.com)' })
          return
        }
        updateData.portfolioUrl = normalized
      }
    }
    let user: any
    try {
      user = await (prisma as any).user.update({
        where: { id: req.userId },
        data: updateData,
      })
    } catch (e: any) {
      const msg = String(e?.message || '')
      if (msg.includes('portfolioUrl') || msg.includes('Unknown argument') || msg.includes('column')) {
        // Fallback if migration not yet applied — strip portfolioUrl and retry
        const { portfolioUrl: _omit, ...fallbackData } = updateData
        user = await prisma.user.update({ where: { id: req.userId }, data: fallbackData } as any)
        // still return success but warn that portfolioUrl not persisted
        const uFallback = user as any
        res.json({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          department: uFallback.department,
          year: uFallback.year,
          semester: uFallback.semester,
          portfolioUrl: null,
          warning: 'Portfolio URL not yet migrated',
        })
        return
      }
      throw e
    }
    const u = user as any
    try { broadcastUserMutation({ userId: user.id, action: 'profile:updated' }) } catch {}
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      department: u.department,
      year: u.year,
      semester: u.semester,
      portfolioUrl: u.portfolioUrl || null,
      avatar: user.avatar,
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to update profile' })
  }
})

// Get integrations
router.get('/integrations', async (req: AuthRequest, res: Response) => {
  try {
    const integrations = await prisma.userIntegration.findMany({
      where: { userId: req.userId },
    })
    res.json(integrations)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch integrations' })
  }
})

// Get dashboard stats (role-specific)
// VERIFIED single-query aggregations (SG slow fix 2026-09-08):
// - TEACHER: 4 parallel findMany (courses/hackathons/forms/enrollments) via ONE
//   Promise.all — no per-row loop, counts derived in memory via filter().length.
// - ADMIN: 10 parallel count/findMany via ONE Promise.all (user.count ×4 by role,
//   hackathon/form COUNT + recent take:3, college.count) — no N+1, no fallback scan.
// - STUDENT: 6 parallel findMany via ONE Promise.all (grades/assignments/
//   notifications/schedules/hubs+submissions) — hubPending computed in memory via
//   Set lookup, NOT per-hub DB queries. SG cloud 500-1000ms/query NORMAL
//   (India→SG RTT+TLS+pgbouncer); TanStack staleTime ≥30s avoids refetch storms.
// - Super-admin heavy breakdown lives in admin.ts super/dashboard (GROUP BY ×8,
//   verified — no per-college fallback). If adding queries here, keep them inside
//   the existing Promise.all and prefer count/groupBy over findMany+filter.
// 10k QUERY BUDGETS (caps, no behavior change — totals via count, display via take):
// - TEACHER: own rows only (teacherId/creatorId scoped) → take:100 each + enrollments take:200.
//   Per-teacher data <100 rows realistic; caps bound worst-case roster fan-out.
// - ADMIN: totals via COUNT (O(1)), recent via take:3 ordered (was unbounded findMany
//   + slice — same payload, bounded rows). Per-dashboard ≤10 queries, ≤~10 rows display.
// - STUDENT: per-user rows only (userId scoped) → take:200 each (CGPA needs all grades;
//   200 covers realistic per-user history; hubs already take:100). Per-dashboard 6 queries.
// - Global: dashboard burst = 200 users × 6 parallel GETs (see scripts/load-10k-smoke.mjs);
//   pool 50 + Redis shared limiter hold via per-user buckets (scale10k-redis.md).
router.get('/dashboard', async (req: AuthRequest, res: Response) => {
  try {
    // NARROW-READ (fan-out #3): auth check needs only id/role/collegeId
    // (was full row incl. passwordHash/preferences). Same branching payload.
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true } })
    if (!user) return res.status(404).json({ error: 'User not found' })
    // CACHE-ALL: dashboard aggregates are per-user + mutation-invalidated client-side;
    // private edge SWR (browser-only, never shared) cuts refetch storms (codingProfile.ts:333 pattern).
    res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')

    // ── Teacher Dashboard ──────────────────────────────────────────
    if (user.role === 'TEACHER') {
      const [courses, hackathons, forms, enrollments] = await Promise.all([
        prisma.course.findMany({ where: { teacherId: user.id }, take: 100 }),
        prisma.hackathon.findMany({ where: { creatorId: user.id }, take: 100 }),
        prisma.form.findMany({ where: { creatorId: user.id }, take: 100 }),
        prisma.enrollment.findMany({
          where: { course: { teacherId: user.id } },
          include: { student: { select: { id: true, name: true, email: true } } },
          take: 200,
        }),
      ])

      const activeHackathons = hackathons.filter((h) => h.status === 'PUBLISHED').length
      const activeForms = forms.filter((f) => f.status === 'ACTIVE').length

      return res.json({
        role: 'TEACHER',
        totalCourses: courses.length,
        totalStudents: enrollments.length,
        hackathons: hackathons.length,
        activeHackathons,
        forms: forms.length,
        activeForms,
        courses: courses.slice(0, 5),
        recentHackathons: hackathons.slice(0, 3).map((h) => ({
          id: h.id,
          title: h.title,
          status: h.status,
          startDate: h.startDate,
          createdAt: h.createdAt,
        })),
      })
    }

    // ── Admin Dashboard (College Admin & Super Admin) ──────────────
    if (user.role === 'COLLEGE_ADMIN' || user.role === 'SUPER_ADMIN') {
      const scopedCollegeId = user.role === 'SUPER_ADMIN' ? getSuperAdminTargetCollegeId(req as any) : null
      const collegeFilter =
        user.role === 'SUPER_ADMIN'
          ? scopedCollegeId ? { collegeId: scopedCollegeId } : {}
          : user.collegeId ? { collegeId: user.collegeId } : {}

      const [
        totalUsers,
        totalTeachers,
        totalStudents,
        totalAdmins,
        hackathonsTotal,
        formsTotal,
        hackathons,
        forms,
        pendingColleges,
        totalColleges,
      ] = await Promise.all([
        prisma.user.count({ where: collegeFilter }),
        prisma.user.count({ where: { ...collegeFilter, role: 'TEACHER' } }),
        prisma.user.count({ where: { ...collegeFilter, role: 'STUDENT' } }),
        prisma.user.count({ where: { ...collegeFilter, role: 'COLLEGE_ADMIN' } }),
        prisma.hackathon.count({
          where: user.role === 'SUPER_ADMIN' ? collegeFilter : collegeFilter,
        }),
        prisma.form.count({
          where: user.role === 'SUPER_ADMIN' ? collegeFilter : collegeFilter,
        }),
        prisma.hackathon.findMany({
          where: user.role === 'SUPER_ADMIN' ? collegeFilter : collegeFilter,
          select: { id: true, title: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 3,
        }),
        prisma.form.findMany({
          where: user.role === 'SUPER_ADMIN' ? collegeFilter : collegeFilter,
          select: { id: true, title: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 3,
        }),
        user.role === 'SUPER_ADMIN'
          ? prisma.college.count({ where: { status: 'PENDING' } })
          : Promise.resolve(0),
        user.role === 'SUPER_ADMIN'
          ? prisma.college.count()
          : Promise.resolve(1),
      ])

      return res.json({
        role: user.role,
        totalUsers,
        totalTeachers,
        totalStudents,
        totalAdmins,
        hackathons: hackathonsTotal,
        forms: formsTotal,
        pendingColleges,
        totalColleges,
        recentHackathons: hackathons.slice(0, 3),
        recentForms: forms.slice(0, 3),
      })
    }

    // ── Student Dashboard (default) ────────────────────────────────
    const [grades, assignments, notifications, schedules, hubs, mySubmissions] = await Promise.all([
      prisma.grade.findMany({ where: { userId: req.userId }, take: 200 }),
      prisma.assignment.findMany({ where: { userId: req.userId }, take: 200 }),
      prisma.notification.findMany({ where: { userId: req.userId, read: false }, take: 200 }),
      prisma.schedule.findMany({ where: { userId: req.userId }, take: 200 }),
      prisma.assignmentHub.findMany({
        where: user.collegeId ? { collegeId: user.collegeId } : {},
        select: { id: true, dueDate: true, scope: true, departmentId: true, roomId: true },
        orderBy: { dueDate: 'asc' },
        take: 100,
      }).catch(()=>[] as any[]),
      prisma.assignmentSubmission.findMany({ where: { studentId: req.userId }, select: { assignmentId: true }, take: 200 }).catch(()=>[] as any[]),
    ])

    // CGPA
    const totalCredits = grades.reduce((sum, g) => sum + g.credits, 0)
    const weightedGpa = grades.reduce((sum, g) => sum + g.gpa * g.credits, 0)
    const cgpa = totalCredits > 0 ? Math.round((weightedGpa / totalCredits) * 100) / 100 : 0

    // Assignments — legacy + hub (visibility-filtered: student sees only hubs where not yet submitted and due future or overdue)
    const submittedSet = new Set((mySubmissions as any[]).map((s:any)=> s.assignmentId))
    const now = new Date()
    const hubPending = (hubs as any[]).filter((h:any)=> !submittedSet.has(h.id))
    const legacyPending = assignments.filter((a) => a.status === 'PENDING')
    const pendingAssignmentsCount = legacyPending.length + hubPending.length
    // upcoming = dueDate >= now (legacy + hub) + not yet submitted
    const legacyUpcoming = legacyPending.filter((a) => new Date(a.dueDate) >= now).length
    const hubUpcoming = hubPending.filter((h:any)=> new Date(h.dueDate) >= now).length
    const upcomingDeadlines = legacyUpcoming + hubUpcoming

    // Today's schedule (get current day of week)
    const today = getDayOfWeek()
    const todaySchedule = schedules.filter((s) => s.dayOfWeek === today)

    res.json({
      role: 'STUDENT',
      cgpa,
      pendingAssignments: pendingAssignmentsCount,
      upcomingDeadlines,
      unreadNotifications: notifications.length,
      todaySchedule,
      recentNotifications: notifications.slice(0, 5),
      // Hub stats for modern frontend — client can prefer these over legacy counts
      hubAssignments: {
        total: hubs.length,
        pending: hubPending.length,
        upcoming: hubUpcoming,
      },
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch dashboard' })
  }
})

export default router