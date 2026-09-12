import { Router, Response } from 'express'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import { broadcastReportMutation } from '../services/socket'
import { logger } from '../utils/logger'

const router = Router()
router.use(authenticate)

// Validation constants — mirrors frontend dropdowns
const SCOPES = ['COLLEGE', 'WEBSITE'] as const
const ISSUE_TYPES = ['DESIGN', 'BUG', 'CRASH', 'PERFORMANCE', 'SECURITY', 'FEATURE_REQUEST', 'OTHER'] as const
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const

type Scope = typeof SCOPES[number]
type IssueType = typeof ISSUE_TYPES[number]
type Priority = typeof PRIORITIES[number]
type Status = typeof STATUSES[number]

function isValidScope(v: any): v is Scope { return SCOPES.includes(v) }
function isValidIssueType(v: any): v is IssueType { return ISSUE_TYPES.includes(v) }
function isValidPriority(v: any): v is Priority { return PRIORITIES.includes(v) }
function isValidStatus(v: any): v is Status { return STATUSES.includes(v) }

// POST /api/reports — any authenticated user can report college or website issue
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    // HALF2: narrow auth read (was full row incl. passwordHash/preferences; uses id/role/collegeId/collegeName)
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } })
    if (!user) { res.status(404).json({ error: 'User not found' }); return }

    const { scope, issueType, collegeId, title, description, priority, attachmentUrl } = req.body

    if (!scope || !isValidScope(scope)) {
      res.status(400).json({ error: `scope must be one of ${SCOPES.join(',')}` }); return
    }
    if (!issueType || !isValidIssueType(issueType)) {
      res.status(400).json({ error: `issueType must be one of ${ISSUE_TYPES.join(',')}` }); return
    }
    if (!title || typeof title !== 'string' || title.trim().length < 5) {
      res.status(400).json({ error: 'title is required (min 5 chars)' }); return
    }
    if (!description || typeof description !== 'string' || description.trim().length < 10) {
      res.status(400).json({ error: 'description is required (min 10 chars)' }); return
    }
    const finalPriority: Priority = priority && isValidPriority(priority) ? priority : 'MEDIUM'

    let finalCollegeId: string | null = null

    if (scope === 'COLLEGE') {
      // College scope requires a college — prefer explicit body.collegeId, fallback to user's college
      const requested = (collegeId as string | undefined) || (req as any).body?.collegeId || (req.query.collegeId as string | undefined) || user.collegeId
      if (!requested) {
        res.status(400).json({ error: 'collegeId is required when scope is COLLEGE' }); return
      }
      // Validate college exists
      // HALF2: narrow to id/name only (was full row)
      const college = await prisma.college.findUnique({ where: { id: String(requested) }, select: { id: true, name: true } })
      if (!college) { res.status(400).json({ error: 'Invalid collegeId' }); return }
      finalCollegeId = college.id
    } else {
      // WEBSITE scope — collegeId optional; store reporter's college for analytics if available
      if (collegeId) {
        // HALF2: narrow to id/name only (was full row)
        const c = await prisma.college.findUnique({ where: { id: String(collegeId) }, select: { id: true, name: true } }).catch(() => null)
        if (c) { finalCollegeId = c.id }
        else if (user.collegeId) { finalCollegeId = user.collegeId }
      } else if (user.collegeId) {
        finalCollegeId = user.collegeId
        // try resolve name
        // HALF2: narrow to id/name only (was full row)
        const c = await prisma.college.findUnique({ where: { id: user.collegeId }, select: { id: true, name: true } }).catch(() => null)
        // Order 6: collegeName copy dropped — resolve via college relation
      }
    }

    const report = await (prisma as any).report.create({
      data: {
        userId: user.id,
        collegeId: finalCollegeId,
        scope,
        issueType,
        title: title.trim().slice(0, 200),
        description: description.trim(),
        priority: finalPriority,
        status: 'OPEN',
        attachmentUrl: attachmentUrl ? String(attachmentUrl).slice(0, 2000) : null,
      },
      include: {
        user: { select: { id: true, name: true, email: true, role: true, collegeId: true } },
        college: { select: { id: true, name: true, code: true } },
      },
    })

    try { broadcastReportMutation({ reportId: report.id, collegeId: finalCollegeId, action: 'created' }) } catch {}
    // Order 6 compat: project collegeName via join (DB copy dropped).
    res.status(201).json({ ...report, collegeName: (report as any).college?.name ?? null })
  } catch (err) {
    logger.error({ err: err }, 'Create report error')
    res.status(500).json({ error: 'Failed to create report' })
  }
})

// GET /api/reports — list with role-based scoping
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    // HALF2: narrow auth read (was full row incl. passwordHash/preferences)
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } })
    if (!user) { res.status(404).json({ error: 'User not found' }); return }

    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20))
    const skip = (page - 1) * limit

    const qScope = req.query.scope as string | undefined
    const qStatus = req.query.status as string | undefined
    const qIssueType = req.query.issueType as string | undefined
    const qPriority = req.query.priority as string | undefined
    const qCollegeId = req.query.collegeId as string | undefined
    const qSearch = (req.query.search as string | undefined)?.trim()

    const where: any = {}

    // Role-based base filter
    if (user.role === 'SUPER_ADMIN') {
      // superadmin sees all; optional college filter
      if (qCollegeId) where.collegeId = qCollegeId
    } else if (user.role === 'COLLEGE_ADMIN') {
      // college admin sees only reports for their college (both COLLEGE and WEBSITE where collegeId matches)
      if (!user.collegeId) {
        // college admin without college — return empty
        res.json({ data: [], pagination: { page, limit, total: 0, pages: 0 } }); return
      }
      where.collegeId = user.collegeId
    } else {
      // TEACHER / STUDENT — see own reports only (keeps privacy but still allows tracking)
      where.userId = user.id
    }

    if (qScope && isValidScope(qScope)) where.scope = qScope
    if (qStatus && isValidStatus(qStatus)) where.status = qStatus
    if (qIssueType && isValidIssueType(qIssueType)) where.issueType = qIssueType
    if (qPriority && isValidPriority(qPriority)) where.priority = qPriority

    if (qSearch) {
      const s: any = { contains: qSearch, mode: 'insensitive' }
      where.OR = [{ title: s }, { description: s }]
    }

    const [reports, total] = await Promise.all([
      (prisma as any).report.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true, role: true, collegeId: true, studentId: true } },
          college: { select: { id: true, name: true, code: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      (prisma as any).report.count({ where }),
    ])

    const pages = Math.ceil(total / limit)
    res.json({ data: reports, pagination: { page, limit, total, pages } })
  } catch (err) {
    logger.error({ err: err }, 'List reports error')
    res.status(500).json({ error: 'Failed to fetch reports' })
  }
})

// GET /api/reports/:id
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    // HALF2: parallel independent reads (was user then report sequential) + narrow auth
    const [user, report] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }),
      (prisma as any).report.findUnique({
        where: { id: req.params.id as string },
        include: {
          user: { select: { id: true, name: true, email: true, role: true, collegeId: true } },
          college: { select: { id: true, name: true, code: true } },
        },
      }),
    ])
    if (!user) { res.status(404).json({ error: 'User not found' }); return }
    if (!report) { res.status(404).json({ error: 'Report not found' }); return }

    // Access check
    if (user.role === 'SUPER_ADMIN') {
      // allow
    } else if (user.role === 'COLLEGE_ADMIN') {
      if (report.collegeId !== user.collegeId) { res.status(403).json({ error: 'Not authorized for this college report' }); return }
    } else {
      if (report.userId !== user.id) { res.status(403).json({ error: 'Not authorized' }); return }
    }

    res.json(report)
  } catch (err) {
    logger.error({ err: err }, 'Get report error')
    res.status(500).json({ error: 'Failed to fetch report' })
  }
})

// PATCH /api/reports/:id/status — college admin (own college) or superadmin
router.patch('/:id/status', async (req: AuthRequest, res: Response) => {
  try {
    // HALF2: parallel independent reads (was user then existing sequential) + narrow auth
    const [user, existing] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }),
      (prisma as any).report.findUnique({ where: { id: req.params.id as string } }),
    ])
    if (!user) { res.status(404).json({ error: 'User not found' }); return }
    if (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Only college admin or super admin can update status' }); return
    }
    const { status } = req.body
    if (!status || !isValidStatus(status)) {
      res.status(400).json({ error: `status must be one of ${STATUSES.join(',')}` }); return
    }
    if (!existing) { res.status(404).json({ error: 'Report not found' }); return }

    if (user.role === 'COLLEGE_ADMIN' && existing.collegeId !== user.collegeId) {
      res.status(403).json({ error: 'Not authorized for this college report' }); return
    }

    const updated = await (prisma as any).report.update({
      where: { id: req.params.id as string },
      data: { status },
      include: {
        user: { select: { id: true, name: true, email: true } },
        college: { select: { id: true, name: true } },
      },
    })
    try { broadcastReportMutation({ reportId: updated.id, collegeId: updated.collegeId, action: 'status:updated' }) } catch {}
    res.json(updated)
  } catch (err) {
    logger.error({ err: err }, 'Update report status error')
    res.status(500).json({ error: 'Failed to update status' })
  }
})

// DELETE /api/reports/:id — owner can delete OPEN, admin/superadmin can delete any
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    // HALF2: parallel independent reads (was user then existing sequential) + narrow auth
    const [user, existing] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }),
      (prisma as any).report.findUnique({ where: { id: req.params.id as string } }),
    ])
    if (!user) { res.status(404).json({ error: 'User not found' }); return }
    if (!existing) { res.status(404).json({ error: 'Report not found' }); return }

    const isOwner = existing.userId === user.id
    const isPrivileged = user.role === 'SUPER_ADMIN' || (user.role === 'COLLEGE_ADMIN' && existing.collegeId === user.collegeId)

    if (!isOwner && !isPrivileged) {
      res.status(403).json({ error: 'Not authorized to delete' }); return
    }
    // Owners can only delete if still OPEN
    if (isOwner && !isPrivileged && existing.status !== 'OPEN') {
      res.status(400).json({ error: 'Only OPEN reports can be deleted by owner' }); return
    }

    await (prisma as any).report.delete({ where: { id: req.params.id as string } })
    try { broadcastReportMutation({ reportId: req.params.id as string, collegeId: existing.collegeId, action: 'deleted' }) } catch {}
    res.json({ message: 'Report deleted' })
  } catch (err) {
    logger.error({ err: err }, 'Delete report error')
    res.status(500).json({ error: 'Failed to delete report' })
  }
})

export default router
