import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../config/db'
import { authenticate, AuthRequest, authorize } from '../middleware/auth'
import { notifyUsers } from '../services/notificationService'
import { recordAudit, buildAuditMetadataJson } from '../services/auditLog'
import { parseJsonArraySafe } from '../lib/validators'
import {
  alumniProfileSchema,
  mentorshipRequestSchema,
  mentorshipRespondSchema,
  maskAlumniProfile,
  slaDatesForNewRequest,
  startOfUtcDay,
  calcResponseRate,
  foldResponseCounters,
  sortVerificationQueue,
  isMissingTable,
  canCollegeAdminAccess,
  MENTORSHIP_DAILY_LIMIT,
} from '../services/alumniService'
import { logger } from '../utils/logger'

const router = Router()
router.use(authenticate)

// Pre-migration guard (SourceHealth pattern): tables absent → 503, never 500.
// Deploy applies via `prisma migrate deploy`; until then every handler below
// returns "run prisma migrate" instead of throwing P2021/P2022.
function alumniTablesReady(): boolean {
  const p = prisma as unknown as Record<string, unknown>
  return typeof (p as { alumniProfile?: unknown }).alumniProfile !== 'undefined'
    && typeof (p as { mentorshipRequest?: unknown }).mentorshipRequest !== 'undefined'
}

// Missing-table guard lives in alumniService.isMissingTable (M2 lock, hermetic-tested).
// WHY: map P2021/P2022 to 503 "run prisma migrate" (never 500) in every catch below.

type Db = {
  alumniProfile: {
    upsert: (a: unknown) => Promise<unknown>
    findMany: (a: unknown) => Promise<unknown[]>
    findUnique: (a: unknown) => Promise<unknown>
    findFirst: (a: unknown) => Promise<unknown>
    update: (a: unknown) => Promise<unknown>
    count: (a: unknown) => Promise<number>
  }
  mentorshipRequest: {
    create: (a: unknown) => Promise<unknown>
    findMany: (a: unknown) => Promise<unknown[]>
    findFirst: (a: unknown) => Promise<unknown>
    findUnique: (a: unknown) => Promise<unknown>
    update: (a: unknown) => Promise<unknown>
    count: (a: unknown) => Promise<number>
  }
}

function db(): Db {
  return prisma as unknown as Db
}

const PROFILE_SELECT = {
  id: true,
  userId: true,
  collegeId: true,
  graduationYear: true,
  degree: true,
  department: true,
  company: true,
  roleTitle: true,
  location: true,
  bio: true,
  skills: true,
  linkedinUrl: true,
  githubUrl: true,
  portfolioUrl: true,
  contactEmail: true,
  contactPhone: true,
  isVerified: true,
  verifiedAt: true,
  isAvailableForMentorship: true,
  totalRequests: true,
  acceptedRequests: true,
  respondedRequests: true,
  avgResponseHours: true,
  createdAt: true,
  updatedAt: true,
} as const

function toCard(row: Record<string, unknown>): Record<string, unknown> {
  const skills = parseJsonArraySafe(row.skills)
  return {
    ...row,
    skills,
    responseRate: calcResponseRate({
      totalRequests: Number(row.totalRequests ?? 0),
      respondedRequests: Number(row.respondedRequests ?? 0),
    }),
  }
}

async function hasAcceptedLink(viewerId: string, alumniUserId: string): Promise<boolean> {
  if (viewerId === alumniUserId) return true
  try {
    const hit = await db().mentorshipRequest.findFirst({
      where: { requesterId: viewerId, alumniUserId, status: 'ACCEPTED' },
    })
    return !!hit
  } catch {
    return false
  }
}

// POST /api/alumni/profile — upsert OWN alumni profile (any authenticated user;
// becomes discoverable once admin verifies). College stamped from the user row.
router.post('/profile', async (req: AuthRequest, res: Response) => {
  try {
    if (!alumniTablesReady()) { res.status(503).json({ error: 'Alumni feature not yet migrated. Please run prisma migrate.' }); return }
    const parsed = alumniProfileSchema.safeParse(req.body ?? {})
    if (!parsed.success) { res.status(400).json({ error: 'Validation error', details: parsed.error.errors }); return }
    const me = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, collegeId: true, name: true, email: true } })
    if (!me) { res.status(404).json({ error: 'User not found' }); return }
    const v = parsed.data
    const clean = (s: string | null | undefined): string | null => {
      if (s === undefined || s === null) return null
      const t = String(s).trim()
      return t ? t.slice(0, 500) : null
    }
    const skills = Array.isArray(v.skills) ? v.skills.map((s) => String(s).trim().slice(0, 60)).filter(Boolean).slice(0, 30) : []
    const row = (await db().alumniProfile.upsert({
      where: { userId: me.id },
      create: {
        userId: me.id,
        collegeId: me.collegeId ?? null,
        graduationYear: v.graduationYear ?? null,
        degree: clean(v.degree),
        department: clean(v.department),
        company: clean(v.company),
        roleTitle: clean(v.roleTitle),
        location: clean(v.location),
        bio: v.bio ? String(v.bio).trim().slice(0, 5000) : null,
        skills,
        linkedinUrl: clean(v.linkedinUrl),
        githubUrl: clean(v.githubUrl),
        portfolioUrl: clean(v.portfolioUrl),
        contactEmail: clean(v.contactEmail),
        contactPhone: clean(v.contactPhone),
        isAvailableForMentorship: v.isAvailableForMentorship ?? true,
      },
      update: {
        // College re-stamped on every save (user moved colleges → directory follows).
        collegeId: me.collegeId ?? null,
        graduationYear: v.graduationYear ?? null,
        degree: clean(v.degree),
        department: clean(v.department),
        company: clean(v.company),
        roleTitle: clean(v.roleTitle),
        location: clean(v.location),
        bio: v.bio ? String(v.bio).trim().slice(0, 5000) : null,
        skills,
        linkedinUrl: clean(v.linkedinUrl),
        githubUrl: clean(v.githubUrl),
        portfolioUrl: clean(v.portfolioUrl),
        contactEmail: clean(v.contactEmail),
        contactPhone: clean(v.contactPhone),
        isAvailableForMentorship: v.isAvailableForMentorship ?? true,
      },
    })) as unknown as Record<string, unknown>
    res.status(201).json(toCard(row))
  } catch (err) {
    if (isMissingTable(err)) { res.status(503).json({ error: 'Alumni feature not yet migrated. Please run prisma migrate.' }); return }
    logger.error({ err }, 'Alumni upsert profile error')
    res.status(500).json({ error: 'Failed to save alumni profile' })
  }
})

// GET /api/alumni — directory list (college-scoped, masked contact, paged).
// Query: ?search=&company=&graduationYear=&verified=&available=&page=&limit=
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!alumniTablesReady()) { res.status(503).json({ error: 'Alumni feature not yet migrated. Please run prisma migrate.' }); return }
    const me = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } })
    if (!me) { res.status(404).json({ error: 'User not found' }); return }
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20))
    const skip = (page - 1) * limit
    const search = String(req.query.search || '').trim()
    const company = String(req.query.company || '').trim()
    const graduationYear = req.query.graduationYear ? parseInt(String(req.query.graduationYear), 10) : NaN
    const verified = String(req.query.verified || '')
    const available = String(req.query.available || '')

    const where: Record<string, unknown> = {}
    // College scoping (reports.ts pattern): SUPER_ADMIN sees all (optional
    // ?collegeId filter); everyone else sees own college only.
    if (me.role === 'SUPER_ADMIN') {
      if (req.query.collegeId) where.collegeId = String(req.query.collegeId)
    } else {
      if (!me.collegeId) { res.json({ data: [], pagination: { page, limit, total: 0, pages: 0 } }); return }
      where.collegeId = me.collegeId
    }
    if (company) where.company = { contains: company, mode: 'insensitive' }
    if (Number.isFinite(graduationYear)) where.graduationYear = graduationYear
    if (verified === 'true') where.isVerified = true
    else if (verified === 'false') where.isVerified = false
    if (available === 'true') where.isAvailableForMentorship = true
    else if (available === 'false') where.isAvailableForMentorship = false
    if (search) {
      const s = { contains: search, mode: 'insensitive' }
      where.OR = [
        { company: s }, { roleTitle: s }, { bio: s },
        { department: s }, { degree: s }, { location: s },
      ]
    }

    const [rows, total] = await Promise.all([
      db().alumniProfile.findMany({
        where,
        select: { ...PROFILE_SELECT, user: { select: { id: true, name: true, avatar: true } } },
        orderBy: [{ isVerified: 'desc' }, { updatedAt: 'desc' }],
        skip,
        take: limit,
      }),
      db().alumniProfile.count({ where }),
    ])
    // Directory is ALWAYS masked (no per-row ACCEPTED check at list scale —
    // that would be N+1; detail endpoint unmasks on accepted link).
    const data = (rows as unknown as Record<string, unknown>[]).map((r) =>
      toCard(maskAlumniProfile(r as never as { userId: string; contactEmail?: string | null; contactPhone?: string | null }, { canSeeContact: false })),
    )
    res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60')
    res.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  } catch (err) {
    if (isMissingTable(err)) { res.status(503).json({ error: 'Alumni feature not yet migrated. Please run prisma migrate.' }); return }
    logger.error({ err }, 'Alumni list error')
    res.status(500).json({ error: 'Failed to fetch alumni directory' })
  }
})

// GET /api/alumni/requests/mine — sent + received for the caller.
// ?box=sent|received|all (default all). ?alumniUserId= narrows to one alumni
// (detail deep-link, L2: one filtered row beats 50 scanned rows).
// Paged (page/limit, max 50).
router.get('/requests/mine', async (req: AuthRequest, res: Response) => {
  try {
    if (!alumniTablesReady()) { res.status(503).json({ error: 'Alumni feature not yet migrated. Please run prisma migrate.' }); return }
    const box = String(req.query.box || 'all')
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20))
    const skip = (page - 1) * limit
    const baseWhere: Record<string, unknown> = box === 'sent'
      ? { requesterId: req.userId }
      : box === 'received'
        ? { alumniUserId: req.userId }
        : { OR: [{ requesterId: req.userId }, { alumniUserId: req.userId }] }
    // Optional alumni filter (L2): intersect with the box scope via AND so
    // box=received + mismatched filter correctly returns empty (no leak).
    const filterAlumniUserId = String(req.query.alumniUserId || '').trim()
    const where: Record<string, unknown> = filterAlumniUserId
      ? { AND: [baseWhere, { alumniUserId: filterAlumniUserId }] }
      : baseWhere
    const [rows, total] = await Promise.all([
      db().mentorshipRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      db().mentorshipRequest.count({ where }),
    ])
    res.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
    res.json({ data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  } catch (err) {
    if (isMissingTable(err)) { res.status(503).json({ error: 'Alumni feature not yet migrated. Please run prisma migrate.' }); return }
    logger.error({ err }, 'Alumni mine error')
    res.status(500).json({ error: 'Failed to fetch mentorship requests' })
  }
})

// GET /api/alumni/pending — admin verification queue (<24h triage first).
// COLLEGE_ADMIN: own college; SUPER_ADMIN: all (optional ?collegeId).
router.get('/pending', authorize(['COLLEGE_ADMIN', 'SUPER_ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    if (!alumniTablesReady()) { res.status(503).json({ error: 'Alumni feature not yet migrated. Please run prisma migrate.' }); return }
    const me = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } })
    if (!me) { res.status(404).json({ error: 'User not found' }); return }
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20))
    const where: Record<string, unknown> = { isVerified: false }
    if (me.role === 'SUPER_ADMIN') {
      if (req.query.collegeId) where.collegeId = String(req.query.collegeId)
    } else {
      if (!me.collegeId) { res.json({ data: [], pagination: { page, limit, total: 0, pages: 0 } }); return }
      where.collegeId = me.collegeId
    }
    const rows = (await db().alumniProfile.findMany({
      where,
      select: { ...PROFILE_SELECT, user: { select: { id: true, name: true, email: true, avatar: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    })) as unknown as Record<string, unknown>[]
    const sorted = sortVerificationQueue(rows)
    const total = sorted.length
    const slice = sorted.slice((page - 1) * limit, (page - 1) * limit + limit)
    res.json({ data: slice, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  } catch (err) {
    if (isMissingTable(err)) { res.status(503).json({ error: 'Alumni feature not yet migrated. Please run prisma migrate.' }); return }
    logger.error({ err }, 'Alumni pending error')
    res.status(500).json({ error: 'Failed to fetch verification queue' })
  }
})

// GET /api/alumni/:userId — single profile, masked until ACCEPTED link.
// (Must sit AFTER /requests/mine + /pending so literal paths win.)
router.get('/:userId', async (req: AuthRequest, res: Response) => {
  try {
    if (!alumniTablesReady()) { res.status(503).json({ error: 'Alumni feature not yet migrated. Please run prisma migrate.' }); return }
    const targetUserId = String(req.params.userId)
    const me = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } })
    if (!me) { res.status(404).json({ error: 'User not found' }); return }
    const profile = (await (db().alumniProfile as unknown as { findUnique: (a: unknown) => Promise<unknown> }).findUnique({
      where: { userId: targetUserId },
      include: { user: { select: { id: true, name: true, avatar: true, collegeId: true } } },
    })) as unknown as Record<string, unknown> | null
    if (!profile) { res.status(404).json({ error: 'Alumni profile not found' }); return }
    // Same-college guard (except SUPER_ADMIN + owner).
    if (me.role !== 'SUPER_ADMIN' && me.id !== targetUserId) {
      const profileCollege = (profile.collegeId as string | null) ?? ((profile as { user?: { collegeId?: string | null } }).user?.collegeId ?? null)
      if (!me.collegeId || !profileCollege || me.collegeId !== profileCollege) {
        res.status(403).json({ error: 'Not authorized for this college profile' }); return
      }
    }
    const canSee = await hasAcceptedLink(me.id, targetUserId)
    res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60')
    res.json(toCard(maskAlumniProfile(profile as never as { userId: string; contactEmail?: string | null; contactPhone?: string | null }, { canSeeContact: canSee })))
  } catch (err) {
    if (isMissingTable(err)) { res.status(503).json({ error: 'Alumni feature not yet migrated. Please run prisma migrate.' }); return }
    logger.error({ err }, 'Alumni get error')
    res.status(500).json({ error: 'Failed to fetch alumni profile' })
  }
})

// POST /api/alumni/request — student → alumni (5/d quota, no self, same college).
router.post('/request', async (req: AuthRequest, res: Response) => {
  try {
    if (!alumniTablesReady()) { res.status(503).json({ error: 'Alumni feature not yet migrated. Please run prisma migrate.' }); return }
    const parsed = mentorshipRequestSchema.safeParse(req.body ?? {})
    if (!parsed.success) { res.status(400).json({ error: 'Validation error', details: parsed.error.errors }); return }
    const { alumniUserId, message, topic } = parsed.data
    if (alumniUserId === req.userId) { res.status(400).json({ error: 'Cannot request mentorship from yourself' }); return }

    const [me, alumniUser, alumniProfile] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, collegeId: true } }),
      prisma.user.findUnique({ where: { id: alumniUserId }, select: { id: true, name: true, role: true, collegeId: true } }),
      (db().alumniProfile as unknown as { findUnique: (a: unknown) => Promise<unknown> }).findUnique({ where: { userId: alumniUserId } }).catch(() => null) as Promise<Record<string, unknown> | null>,
    ])
    if (!me) { res.status(404).json({ error: 'User not found' }); return }
    if (!alumniUser) { res.status(404).json({ error: 'Alumni user not found' }); return }
    if (!alumniProfile) { res.status(404).json({ error: 'Alumni profile not found — ask them to create one first' }); return }
    // Cross-college block (SUPER_ADMIN bypasses for global mentoring).
    if (me.role !== 'SUPER_ADMIN') {
      if (!me.collegeId || !alumniUser.collegeId || me.collegeId !== alumniUser.collegeId) {
        res.status(403).json({ error: 'Cross-college mentorship requests are not allowed' }); return
      }
    }
    if ((alumniProfile as Record<string, unknown>).isAvailableForMentorship === false) {
      res.status(400).json({ error: 'This alumni is not available for mentorship right now' }); return
    }
    // 5/d quota (UTC day bucket, requester-scoped).
    const dayStart = startOfUtcDay(new Date())
    const sentToday = await db().mentorshipRequest.count({ where: { requesterId: me.id, createdAt: { gte: dayStart } } })
    if (sentToday >= MENTORSHIP_DAILY_LIMIT) {
      res.status(429).json({ error: `Daily mentorship request limit reached (${MENTORSHIP_DAILY_LIMIT}/day)` }); return
    }
    // Duplicate guard: one live PENDING per (requester, alumni).
    const existingPending = await db().mentorshipRequest.findFirst({
      where: { requesterId: me.id, alumniUserId, status: 'PENDING' },
    })
    if (existingPending) { res.status(409).json({ error: 'You already have a pending request with this alumni', request: existingPending }); return }

    const { slaDueAt, expiresAt } = slaDatesForNewRequest(new Date())
    const created = (await db().mentorshipRequest.create({
      data: {
        requesterId: me.id,
        alumniUserId,
        alumniProfileId: (alumniProfile as Record<string, unknown>).id as string,
        collegeId: me.collegeId ?? (alumniUser.collegeId ?? null),
        status: 'PENDING',
        message: message ? String(message).trim().slice(0, 2000) : null,
        topic: topic ? String(topic).trim().slice(0, 200) : null,
        slaDueAt,
        expiresAt,
      },
    })) as unknown as Record<string, unknown>
    // Bump directory counter (best-effort, never fails the 201).
    try {
      await (db().alumniProfile as unknown as { update: (a: unknown) => Promise<unknown> }).update({
        where: { userId: alumniUserId },
        data: { totalRequests: { increment: 1 } },
      })
    } catch { /* counter drift reconciled by cron census later */ }
    // Notify alumni (best-effort).
    try {
      await notifyUsers([alumniUserId], {
        title: `New mentorship request from ${me.name}`,
        message: topic ? `${String(topic).slice(0, 120)} — ${String(message || '').slice(0, 200)}` : String(message || 'A student requested mentorship.').slice(0, 300),
        type: 'MENTORSHIP_REQUEST',
        priority: 'HIGH',
        source: `mentorship:${created.id as string}`,
      })
    } catch { /* persisted request wins; socket is advisory */ }
    res.status(201).json(created)
  } catch (err) {
    if (isMissingTable(err)) { res.status(503).json({ error: 'Alumni feature not yet migrated. Please run prisma migrate.' }); return }
    logger.error({ err }, 'Alumni request create error')
    res.status(500).json({ error: 'Failed to create mentorship request' })
  }
})

// PATCH /api/alumni/request/:id — ACCEPT (creates ChatSession + Notification)
// | DECLINE (alumni) | CANCEL (requester). Alumni counters + AuditLog best-effort.
router.patch('/request/:id', async (req: AuthRequest, res: Response) => {
  try {
    if (!alumniTablesReady()) { res.status(503).json({ error: 'Alumni feature not yet migrated. Please run prisma migrate.' }); return }
    const parsed = mentorshipRespondSchema.safeParse(req.body ?? {})
    if (!parsed.success) { res.status(400).json({ error: 'Validation error', details: parsed.error.errors }); return }
    const { action } = parsed.data
    const existing = (await db().mentorshipRequest.findUnique({ where: { id: String(req.params.id) } })) as unknown as Record<string, unknown> | null
    if (!existing) { res.status(404).json({ error: 'Mentorship request not found' }); return }
    if (existing.status !== 'PENDING') { res.status(400).json({ error: `Request is already ${existing.status}` }); return }

    const me = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, collegeId: true } })
    if (!me) { res.status(404).json({ error: 'User not found' }); return }
    const isAlumniSide = existing.alumniUserId === me.id
    const isRequesterSide = existing.requesterId === me.id
    const isAdmin = me.role === 'COLLEGE_ADMIN' || me.role === 'SUPER_ADMIN'
    // College scoping for COLLEGE_ADMIN (mirror verify): own-college only,
    // null deny (fail-closed). SUPER_ADMIN stays global. Locked by
    // canCollegeAdminAccess hermetic tests (M1).
    if (me.role === 'COLLEGE_ADMIN') {
      const reqCollege = (existing.collegeId as string | null) ?? null
      if (!canCollegeAdminAccess({ role: me.role, collegeId: me.collegeId }, reqCollege)) {
        res.status(403).json({ error: 'Not authorized for this college request' }); return
      }
    }

    if (action === 'CANCEL') {
      if (!isRequesterSide && !isAdmin) { res.status(403).json({ error: 'Only the requester can cancel' }); return }
    } else {
      // ACCEPT / DECLINE: alumni side (or admin on their college's behalf).
      if (!isAlumniSide && !isAdmin) { res.status(403).json({ error: 'Only the alumni can respond' }); return }
    }

    const now = new Date()
    const createdAt = new Date(String(existing.createdAt))
    const responseHours = Number.isFinite(createdAt.getTime()) ? Math.max(0, (now.getTime() - createdAt.getTime()) / 3_600_000) : 0
    let nextStatus: string = existing.status as string
    let chatSessionId: string | null = null

    if (action === 'ACCEPT') {
      nextStatus = 'ACCEPTED'
      // Accept side-effect: ChatSession owned by the REQUESTER + greeting message.
      // (ChatSession is per-owner today — no participant table yet; the alumni
      // reaches the thread via the notification payload + requests/mine.)
      try {
        const alumniName = (await prisma.user.findUnique({ where: { id: String(existing.alumniUserId) }, select: { name: true } }))?.name || 'your mentor'
        const session = await prisma.chatSession.create({
          data: { userId: String(existing.requesterId), title: `Mentorship with ${String(alumniName).slice(0, 40)}` },
        })
        chatSessionId = session.id
        await prisma.chatMessage.create({
          data: {
            sessionId: session.id,
            role: 'ASSISTANT',
            content: `Your mentorship request was accepted by ${alumniName}. Say hello and share what you want to learn. Topic: ${String(existing.topic || 'general').slice(0, 200)}`,
          },
        })
      } catch (e) {
        logger.error({ err: e }, 'Alumni accept ChatSession side-effect failed')
        res.status(500).json({ error: 'Failed to create mentorship chat — request is still PENDING, retry shortly' }); return
      }
    } else if (action === 'DECLINE') {
      nextStatus = 'DECLINED'
    } else {
      nextStatus = 'CANCELLED'
    }

    const updated = (await db().mentorshipRequest.update({
      where: { id: String(existing.id) },
      data: { status: nextStatus, respondedAt: now, ...(chatSessionId ? { chatSessionId } : {}) },
    })) as unknown as Record<string, unknown>

    // Response-rate counters (best-effort; ACCEPT/DECLINE only, not CANCEL).
    if (action === 'ACCEPT' || action === 'DECLINE') {
      try {
        const prof = (await (db().alumniProfile as unknown as { findUnique: (a: unknown) => Promise<unknown> }).findUnique({
          where: { userId: String(existing.alumniUserId) },
        })) as unknown as Record<string, unknown> | null
        if (prof) {
          const folded = foldResponseCounters(
            {
              acceptedRequests: Number(prof.acceptedRequests ?? 0),
              respondedRequests: Number(prof.respondedRequests ?? 0),
              avgResponseHours: typeof prof.avgResponseHours === 'number' ? prof.avgResponseHours : undefined,
            },
            { accepted: action === 'ACCEPT', responseHours },
          )
          await (db().alumniProfile as unknown as { update: (a: unknown) => Promise<unknown> }).update({
            where: { userId: String(existing.alumniUserId) },
            data: folded,
          })
        }
      } catch { /* ledger is source of truth; counters reconcile later */ }
    }

    // Notifications (best-effort, advisory).
    try {
      if (action === 'ACCEPT') {
        await notifyUsers([String(existing.requesterId)], {
          title: 'Mentorship request accepted',
          message: 'Your mentorship request was accepted. A chat thread is ready.',
          type: 'MENTORSHIP_ACCEPTED',
          priority: 'HIGH',
          source: `mentorship:${String(existing.id)}`,
        })
      } else if (action === 'DECLINE') {
        await notifyUsers([String(existing.requesterId)], {
          title: 'Mentorship request declined',
          message: 'Your mentorship request was declined. You can request another alumni.',
          type: 'MENTORSHIP_DECLINED',
          priority: 'MEDIUM',
          source: `mentorship:${String(existing.id)}`,
        })
      }
    } catch { /* non-fatal */ }

    // Audit trail (best-effort, never fails the mutation).
    try {
      await recordAudit({
        actorId: me.id,
        actorEmail: null,
        actorRole: me.role,
        action: `MENTORSHIP_${action}`,
        entityType: 'MentorshipRequest',
        entityId: String(existing.id),
        collegeId: (existing.collegeId as string | null) ?? me.collegeId ?? null,
        metadata: buildAuditMetadataJson({ requesterId: existing.requesterId, alumniUserId: existing.alumniUserId, chatSessionId }) as Record<string, unknown>,
      })
    } catch { /* non-fatal */ }

    res.json({ ...updated, chatSessionId })
  } catch (err) {
    if (isMissingTable(err)) { res.status(503).json({ error: 'Alumni feature not yet migrated. Please run prisma migrate.' }); return }
    logger.error({ err }, 'Alumni respond error')
    res.status(500).json({ error: 'Failed to update mentorship request' })
  }
})

// PATCH /api/alumni/:userId/verify — admin verifies an alumni profile + AuditLog.
// COLLEGE_ADMIN: own college only; SUPER_ADMIN: any.
router.patch('/:userId/verify', authorize(['COLLEGE_ADMIN', 'SUPER_ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    if (!alumniTablesReady()) { res.status(503).json({ error: 'Alumni feature not yet migrated. Please run prisma migrate.' }); return }
    const targetUserId = String(req.params.userId)
    const schema = z.object({ verified: z.boolean().default(true) })
    const parsed = schema.safeParse(req.body ?? {})
    if (!parsed.success) { res.status(400).json({ error: 'Validation error', details: parsed.error.errors }); return }
    const [me, profile] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, email: true } }),
      (db().alumniProfile as unknown as { findUnique: (a: unknown) => Promise<unknown> }).findUnique({ where: { userId: targetUserId } }) as Promise<Record<string, unknown> | null>,
    ])
    if (!me) { res.status(404).json({ error: 'User not found' }); return }
    if (!profile) { res.status(404).json({ error: 'Alumni profile not found' }); return }
    // College scoping mirrors PATCH /request/:id (M1 symmetry rule).
    if (me.role === 'COLLEGE_ADMIN') {
      const pc = (profile.collegeId as string | null) ?? null
      if (!canCollegeAdminAccess({ role: me.role, collegeId: me.collegeId }, pc)) {
        res.status(403).json({ error: 'Not authorized for this college profile' }); return
      }
    }
    const updated = (await (db().alumniProfile as unknown as { update: (a: unknown) => Promise<unknown> }).update({
      where: { userId: targetUserId },
      data: {
        isVerified: parsed.data.verified,
        verifiedBy: me.id,
        verifiedAt: parsed.data.verified ? new Date() : null,
      },
    })) as unknown as Record<string, unknown>
    try {
      await recordAudit({
        actorId: me.id,
        actorEmail: me.email ?? null,
        actorRole: me.role,
        action: parsed.data.verified ? 'ALUMNI_VERIFY' : 'ALUMNI_UNVERIFY',
        entityType: 'AlumniProfile',
        entityId: targetUserId,
        collegeId: (updated.collegeId as string | null) ?? me.collegeId ?? null,
        metadata: buildAuditMetadataJson({ verified: parsed.data.verified }) as Record<string, unknown>,
      })
    } catch { /* non-fatal */ }
    // Notify the alumni (best-effort).
    try {
      await notifyUsers([targetUserId], {
        title: parsed.data.verified ? 'Alumni profile verified' : 'Alumni verification removed',
        message: parsed.data.verified
          ? 'Your alumni profile was verified. You are now discoverable in the directory.'
          : 'Your alumni verification was removed. Contact your college admin.',
        type: 'ALUMNI_VERIFIED',
        priority: 'MEDIUM',
        source: `alumni:${targetUserId}`,
      })
    } catch { /* non-fatal */ }
    res.json(toCard(updated))
  } catch (err) {
    if (isMissingTable(err)) { res.status(503).json({ error: 'Alumni feature not yet migrated. Please run prisma migrate.' }); return }
    logger.error({ err }, 'Alumni verify error')
    res.status(500).json({ error: 'Failed to verify alumni profile' })
  }
})

export default router
