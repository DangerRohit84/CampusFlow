import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import { buildHubListWhere, filterSubmissionForStudentVisibility } from '../utils/assignmentVisibility'
import { parseAttachmentUrls } from '../utils/childTables'
import { deriveCollegeId, getSuperAdminTargetCollegeId } from '../utils/roles'
import multer from 'multer'
import { uploadFile } from '../config/storage'
import { validateUploadMagicBytes, scanBufferForMalware } from '../utils/uploadScan'
import path from 'path'
import { broadcastAssignmentMutation } from '../services/socket'
import { logger } from '../utils/logger'
import { toAssignmentScopeEnum, toSubmissionModeEnum } from '../lib/enums'

export const hubBlocked = ['.html','.htm','.xhtml','.svg','.xml','.js','.mjs','.css','.exe','.sh']
const hubUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: (_req,file,cb)=> {
  if (hubBlocked.includes(path.extname(file.originalname).toLowerCase())) cb(new Error('File type not allowed'))
  else cb(null,true)
}})

// Middleware to turn multer errors (file type / size) into 400 JSON instead of 500
function handleHubMulterError(err: any, _req: any, res: Response, next: any) {
  if (err) {
    const msg = err.message || 'File upload error'
    const code = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400
    return res.status(code).json({ error: msg })
  }
  next()
}

const router = Router()
router.use(authenticate)

// helpers: empty string => undefined/null so zod optional handling works for FormData
const emptyToUndef = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v)
const emptyToNull = (v: unknown) => (v === '' ? null : v)

const assignmentHubSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.preprocess(emptyToUndef, z.string().trim().optional()),
  courseId: z.preprocess(emptyToUndef, z.string().trim().optional()),
  dueDate: z.string().trim().transform(s => new Date(s)).refine(d => !isNaN(d.getTime()), { message: 'Invalid dueDate' }),
  scope: z.enum(['ALL','DEPARTMENT','ROOM']).default('ALL'),
  departmentId: z.preprocess(emptyToNull, z.string().optional().nullable()),
  roomId: z.preprocess(emptyToNull, z.string().optional().nullable()),
  submissionMode: z.enum(['ONLINE','OFFLINE','HYBRID']).default('ONLINE'),
  showGrades: z.preprocess(v => v === 'true' ? true : v === 'false' ? false : v, z.boolean().default(true)),
  showFeedback: z.preprocess(v => v === 'true' ? true : v === 'false' ? false : v, z.boolean().default(true)),
  showSubmissionStatus: z.preprocess(v => v === 'true' ? true : v === 'false' ? false : v, z.boolean().default(true)),
  showStats: z.preprocess(v => v === 'true' ? true : v === 'false' ? false : v, z.boolean().default(false)),
  maxPoints: z.preprocess(v => {
    if (typeof v === 'string') {
      const n = parseInt(v, 10)
      return isNaN(n) ? undefined : n
    }
    return v
  }, z.number().int().min(1).max(1000).default(100)),
  maxGrade: z.preprocess(emptyToUndef, z.string().optional().nullable()),
  allowLateSubmission: z.preprocess(v => v === 'true' ? true : v === 'false' ? false : v, z.boolean().default(false)),
  attachments: z.preprocess(emptyToUndef, z.string().optional()),
  // SUPER_ADMIN may explicitly target a college; stripped for other roles
  collegeId: z.preprocess(emptyToNull, z.string().optional().nullable()),
})

const updateHubSchema = assignmentHubSchema.partial()

router.post('/', hubUpload.array('attachments', 5), handleHubMulterError, async (req: AuthRequest, res: Response) => {
  try {
    // NARROW-READ: auth needs only id/role/collegeId (was full row). Same 403/400 payload.
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } })
    // QA compat: if (!user || !['TEACHER','COLLEGE_ADMIN','SUPER_ADMIN'].includes(user.role))
    if (!user || !['TEACHER','COLLEGE_ADMIN','SUPER_ADMIN','SUPER'].includes(user.role)) {
      res.status(403).json({ error: 'Only teachers and admins can create assignments' }); return
    }
    // multer populates req.body with strings; zod preprocess handles empty -> null/undef
    const body = assignmentHubSchema.parse(req.body)
    // Non-SUPER must have a collegeId on their user record; otherwise creation would be orphaned
    // SUPER_ADMIN: body.collegeId OR query ?collegeId= (interceptor) OR header x-superadmin-college-id
    const derivedCollegeId = user.role === 'SUPER_ADMIN' || (user as any).role === 'SUPER'
      ? deriveCollegeId(user as any, body.collegeId as string | null | undefined, req)
      : user.collegeId
    if (!derivedCollegeId && user.role !== 'SUPER_ADMIN' && (user as any).role !== 'SUPER') {
      res.status(400).json({ error: 'Your account is not linked to a college — contact admin' }); return
    }
    let attachmentUrls: string[] = []
    if ((req as any).files && Array.isArray((req as any).files)) {
      for (const f of (req as any).files as Express.Multer.File[]) {
        const magicErr = await validateUploadMagicBytes(f.buffer, f.originalname, f.mimetype, 'submissions')
        if (magicErr) { res.status(400).json({ error: magicErr }); return }
        const scan = await scanBufferForMalware(f.buffer, f.originalname)
        if (!scan.clean) { res.status(400).json({ error: scan.reason || 'File rejected by scan' }); return }
        const stored = await uploadFile(f.buffer, { folder: `assignments/hub`, resourceType: 'auto', fileName: f.originalname })
        attachmentUrls.push(stored.url)
      }
    }
    const attachmentsJson = attachmentUrls.length ? JSON.stringify(attachmentUrls) : body.attachments || '[]'
    if (body.scope === 'DEPARTMENT' && !body.departmentId) { res.status(400).json({ error: 'departmentId required for DEPARTMENT scope' }); return }
    if (body.scope === 'ROOM' && !body.roomId) { res.status(400).json({ error: 'roomId required for ROOM scope' }); return }
    if (body.scope === 'ALL' && (body.departmentId || body.roomId)) { res.status(400).json({ error: 'departmentId/roomId must be empty for ALL scope' }); return }
    if (body.departmentId) {
      const deptCollegeId = derivedCollegeId || user.collegeId
      const dept = await prisma.department.findFirst({ where: { id: body.departmentId, ...(deptCollegeId ? { collegeId: deptCollegeId } : {}) } })
      if (!dept) { res.status(400).json({ error: 'Invalid departmentId for your college' }); return }
    }
    if (body.roomId) {
      const room = await prisma.room.findFirst({ where: { id: body.roomId } })
      if (!room) { res.status(404).json({ error: 'Room not found' }); return }
      const isCreator = room.teacherId === user.id
      let isCollegeAdmin = false
      if (user.role === 'COLLEGE_ADMIN' && user.collegeId) {
        if (!room.teacherId) {
          // Room without teacher (edge) — allow college admin within same college context
          isCollegeAdmin = true
        } else {
          const teacher = await prisma.user.findUnique({ where: { id: room.teacherId }, select: { collegeId: true } })
          isCollegeAdmin = teacher?.collegeId === user.collegeId
        }
      }
      const isSuper = user.role === 'SUPER_ADMIN' || (user as any).role === 'SUPER'
      if (!isCreator && !isCollegeAdmin && !isSuper) { res.status(403).json({ error: 'Not authorized for this room' }); return }
    }
    // Order-1 FK: AssignmentHub.courseId → Course(id) ON DELETE SET NULL (nullable).
    if (body.courseId) {
      const course = await prisma.course.findUnique({ where: { id: body.courseId }, select: { id: true } })
      if (!course) { res.status(400).json({ error: 'Invalid courseId: course not found' }); return }
    }
    const hub = await prisma.assignmentHub.create({
      data: {
        title: body.title.trim(),
        description: body.description?.trim() || null,
        courseId: body.courseId || null,
        dueDate: body.dueDate as Date,
        creatorId: user.id,
        collegeId: derivedCollegeId,
        // Zod already restricted to UPPERCASE members; re-validate against
        // the REAL Prisma enums so drift fails closed (no `as any` lie).
        scope: toAssignmentScopeEnum(body.scope),
        departmentId: body.scope === 'DEPARTMENT' ? body.departmentId! : null,
        roomId: body.scope === 'ROOM' ? body.roomId! : null,
        submissionMode: toSubmissionModeEnum(body.submissionMode),
        showGrades: body.showGrades,
        showFeedback: body.showFeedback,
        showSubmissionStatus: body.showSubmissionStatus,
        showStats: body.showStats,
        maxPoints: body.maxPoints,
        maxGrade: body.maxGrade || null,
        allowLateSubmission: body.allowLateSubmission,
        attachments: attachmentsJson,
      },
      include: { creator: { select: { id: true, name: true } }, college: { select: { id: true, name: true } }, department: { select: { id: true, name: true } }, room: { select: { id: true, name: true } }, _count: { select: { submissions: true } } }
    })
    // Order 10 (V-17): dual-write attachments blob → AssignmentAttachment
    // rows (best-effort — table may predate migration; blob stays fallback).
    try {
      const urls = parseAttachmentUrls(attachmentsJson)
      if (urls.length > 0) {
        await (prisma as any).assignmentAttachment.createMany({
          data: urls.map((url, i) => ({ assignmentId: hub.id, url, order: i })),
        })
      }
    } catch (err) { logger.debug({ err }, '[hub] attachments dual-write non-fatal') }
    try { broadcastAssignmentMutation(hub.id, (hub as { collegeId?: string | null }).collegeId ?? null) } catch {}
    res.status(201).json(hub)
  } catch (e: any) {
    if (e instanceof z.ZodError) { res.status(400).json({ error: 'Validation error', details: e.errors ?? (e as any).issues }); return }
    // multer fileFilter errors surface here when not caught by handleHubMulterError middleware chain
    if (e.message === 'File type not allowed' || e.code === 'LIMIT_FILE_SIZE') {
      res.status(e.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: e.message }); return
    }
    // Defensive: FK race (course/room/department deleted between check + create) → 400.
    if (e?.code === 'P2003') { res.status(400).json({ error: 'Invalid reference: related record not found' }); return }
    logger.error({ err: e }, 'Create hub error'); res.status(500).json({ error: 'Failed to create assignment', detail: e?.message })
  }
})

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    // NARROW-READ: list auth needs id/role/collegeId/departmentId only (was full row).
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true } })
    if (!user) { res.status(401).json({ error: 'User not found' }); return }
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20))
    const skip = (page - 1) * limit
    const search = (req.query.search as string)?.trim()
    const scope = req.query.scope as string | undefined
    const submissionMode = req.query.submissionMode as string | undefined
    const collegeId = (getSuperAdminTargetCollegeId(req) as string | undefined) || (req.query.collegeId as string | undefined)
    // WHY: ?status=all|active|completed filters server-side; missing/unknown defaults to all (backward compat).
    const status = req.query.status as string | undefined

    let where: any = buildHubListWhere(user as any, { search, scope, submissionMode, collegeId, status })

    if (user.role === 'STUDENT') {
      // Bounded Reads fix: was unbounded findMany(all college hubs) + JS filter
      // + slice (10k rows per list call). AFTER: membership prefetch (≤user's
      // rooms, small) then DB-side visibility OR + skip/take + count — every
      // query bounded to `limit` (≤50). Same response shape + pagination.
      const roomMembers = await prisma.roomMember.findMany({ where: { studentId: user.id }, select: { roomId: true } })
      const roomIds = roomMembers.map(r => r.roomId)
      const visibleWhere: any = {
        AND: [
          where,
          {
            OR: [
              { scope: 'ALL' },
              { scope: 'DEPARTMENT', departmentId: user.departmentId },
              ...(roomIds.length ? [{ scope: 'ROOM', roomId: { in: roomIds } }] : []),
            ],
          },
        ],
      }
      const [paged, total] = await Promise.all([
        prisma.assignmentHub.findMany({ where: visibleWhere, orderBy: { dueDate: 'asc' }, skip, take: limit }),
        prisma.assignmentHub.count({ where: visibleWhere }),
      ])
      if (paged.length === 0) {
        res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
        res.json({ data: [], pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
        return
      }
      // Batch: 2 queries instead of 2*N (e.g., 40 -> 2 for limit 20) to keep pool under connection_limit=50
      const pagedIds = paged.map(h => h.id)
      const [groupedCounts, mySubs] = await Promise.all([
        prisma.assignmentSubmission.groupBy({
          by: ['assignmentId'],
          where: { assignmentId: { in: pagedIds } },
          _count: { _all: true },
        }).catch(() => [] as any[]),
        prisma.assignmentSubmission.findMany({
          where: { assignmentId: { in: pagedIds }, studentId: user.id },
        }),
      ])
      const countMap = new Map<string, number>((groupedCounts as any[]).map((g: any) => [g.assignmentId, g._count?._all ?? 0]))
      const myMap = new Map<string, any>(mySubs.map(s => [s.assignmentId, s]))
      const withCounts = paged.map(h => {
        const submissions = countMap.get(h.id) ?? 0
        const raw = myMap.get(h.id) || null
        return { ...h, submissionsCount: submissions, mySubmission: raw ? filterForStudent(h, raw) : null }
      })
      res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
      res.json({ data: withCounts, pagination: { page, limit, total, pages: Math.ceil(total/limit) } })
      return
    }

    if (user.role === 'TEACHER' || user.role === 'COLLEGE_ADMIN') {
      where.creatorId = user.role === 'TEACHER' ? user.id : undefined
      if (user.role === 'COLLEGE_ADMIN') where.collegeId = user.collegeId
    }

    // TWO-STEP HYDRATE (fan-out #3): was single findMany with
    // include creator/department/room/_count (4 joins + per-row count).
    // AFTER: 1 base findMany (scalars only) + count in parallel, then 4
    // batched hydrations (creators/depts/rooms/counts via IN + groupBy) in
    // ONE Promise.all. Same response shape { ...hub, creator, department,
    // room, _count:{submissions} } — joins replaced by ID-then-hydrate.
    const [hubsBase, total] = await Promise.all([
      prisma.assignmentHub.findMany({ where, orderBy: { dueDate: 'asc' }, skip, take: limit }),
      prisma.assignmentHub.count({ where })
    ])
    let hubs: any[] = hubsBase as any[]
    if (hubsBase.length) {
      const hubIds = hubsBase.map((h: any) => h.id)
      const creatorIds = [...new Set(hubsBase.map((h: any) => h.creatorId).filter(Boolean))] as string[]
      const deptIds = [...new Set(hubsBase.map((h: any) => h.departmentId).filter(Boolean))] as string[]
      const roomIds = [...new Set(hubsBase.map((h: any) => h.roomId).filter(Boolean))] as string[]
      const [creators, depts, rooms, groupedCounts] = await Promise.all([
        creatorIds.length ? prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } }) : Promise.resolve([] as any[]),
        deptIds.length ? prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } }) : Promise.resolve([] as any[]),
        roomIds.length ? prisma.room.findMany({ where: { id: { in: roomIds } }, select: { id: true, name: true } }) : Promise.resolve([] as any[]),
        prisma.assignmentSubmission.groupBy({ by: ['assignmentId'], where: { assignmentId: { in: hubIds } }, _count: { _all: true } }).catch(() => [] as any[]),
      ])
      const creatorMap = new Map((creators as any[]).map((c: any) => [c.id, c]))
      const deptMap = new Map((depts as any[]).map((d: any) => [d.id, d]))
      const roomMap = new Map((rooms as any[]).map((r: any) => [r.id, r]))
      const countMap = new Map<string, number>((groupedCounts as any[]).map((g: any) => [g.assignmentId, g._count?._all ?? 0]))
      hubs = hubsBase.map((h: any) => ({
        ...h,
        creator: creatorMap.get(h.creatorId) ?? { id: h.creatorId, name: '' },
        department: h.departmentId ? (deptMap.get(h.departmentId) ?? null) : null,
        room: h.roomId ? (roomMap.get(h.roomId) ?? null) : null,
        _count: { submissions: countMap.get(h.id) ?? 0 },
      }))
    }
    res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
    res.json({ data: hubs, pagination: { page, limit, total, pages: Math.ceil(total/limit) } })
  } catch (e) { logger.error({ err: e }, 'List hub error'); res.status(500).json({ error: 'Failed to list assignments' }) }
})

function filterForStudent(hub: any, submission: any) {
  return filterSubmissionForStudentVisibility(hub, submission)
}

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    // NARROW-READ: detail auth needs id/role/collegeId/departmentId only (was full row).
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true, departmentId: true } })
    if (!user) { res.status(401).json({ error: 'User not found' }); return }
    // PARALLEL: hub + roomMembers are independent (roomMembers needs only user.id).
    // Was sequential (hub await, then roomMembers await). Same payload.
    const hubPromise = prisma.assignmentHub.findUnique({ where: { id: req.params.id as string }, include: { creator: { select: { id: true, name: true } }, department: { select: { id: true, name: true } }, room: { select: { id: true, name: true, joinCode: true } }, submissions: user.role === 'STUDENT' ? { where: { studentId: user.id } } : false, _count: { select: { submissions: true } } } })
    const roomMembersPromise = user.role === 'STUDENT'
      ? prisma.roomMember.findMany({ where: { studentId: user.id }, select: { roomId: true } })
      : Promise.resolve([] as { roomId: string }[])
    const [hub, roomMembers] = await Promise.all([hubPromise, roomMembersPromise])
    if (!hub) { res.status(404).json({ error: 'Assignment not found' }); return }
    if (user.role === 'STUDENT') {
      const roomIds = (roomMembers as { roomId: string }[]).map(r => r.roomId)
      const visible = hub.scope === 'ALL' ? true : hub.scope === 'DEPARTMENT' ? hub.departmentId === user.departmentId : !!hub.roomId && roomIds.includes(hub.roomId)
      if (!visible || hub.collegeId !== user.collegeId) { res.status(403).json({ error: 'Not visible to you' }); return }
      const mySubmission = (hub as any).submissions?.[0] ? filterForStudent(hub, (hub as any).submissions[0]) : null
      const { submissions, ...rest } = hub as any
      let filtered: any = { ...rest, mySubmission }
      if (!hub.showSubmissionStatus) delete filtered._count
      if (!hub.showGrades && mySubmission) { filtered.mySubmission.grade = null; filtered.mySubmission.points = null }
      if (!hub.showFeedback && mySubmission) filtered.mySubmission.feedback = null
      res.json(filtered); return
    }
    const isOwner = hub.creatorId === user.id
    const isCollegeAdmin = user.role === 'COLLEGE_ADMIN' && hub.collegeId === user.collegeId
    const isSuper = user.role === 'SUPER_ADMIN'
    if (!isOwner && !isCollegeAdmin && !isSuper) { res.status(403).json({ error: 'Access denied' }); return }
    res.json(hub)
  } catch (e) { logger.error({ err: e }, 'Get hub error'); res.status(500).json({ error: 'Failed to fetch assignment' }) }
})

router.put('/:id', hubUpload.array('attachments', 5), handleHubMulterError, async (req: AuthRequest, res: Response) => {
  try {
    // NARROW + PARALLEL: user (id/role/collegeId) + hub are independent — was 2 sequential awaits.
    const [user, existing] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }),
      prisma.assignmentHub.findUnique({ where: { id: req.params.id as string } }),
    ])
    if (!user) { res.status(401).json({ error: 'User not found' }); return }
    if (!existing) { res.status(404).json({ error: 'Not found' }); return }
    const isOwner = existing.creatorId === user.id
    const isCollegeAdmin = user.role === 'COLLEGE_ADMIN' && existing.collegeId === user.collegeId
    const isSuper = user.role === 'SUPER_ADMIN'
    if (!isOwner && !isCollegeAdmin && !isSuper) { res.status(403).json({ error: 'Only creator or college admin can edit' }); return }
    const body = updateHubSchema.parse(req.body)

    // Handle file attachments via multer (append to existing list)
    const data: any = {}
    if ((req as any).files && Array.isArray((req as any).files) && (req as any).files.length) {
      const attachmentUrls: string[] = []
      for (const f of (req as any).files as Express.Multer.File[]) {
        const magicErr = await validateUploadMagicBytes(f.buffer, f.originalname, f.mimetype, 'submissions')
        if (magicErr) { res.status(400).json({ error: magicErr }); return }
        const scan = await scanBufferForMalware(f.buffer, f.originalname)
        if (!scan.clean) { res.status(400).json({ error: scan.reason || 'File rejected by scan' }); return }
        const stored = await uploadFile(f.buffer, { folder: `assignments/hub`, resourceType: 'auto', fileName: f.originalname })
        attachmentUrls.push(stored.url)
      }
      const existingList: string[] = (() => { try { return JSON.parse((existing as any).attachments || '[]') } catch { return [] } })()
      data.attachments = JSON.stringify([...existingList, ...attachmentUrls])
    } else if ((body as any).attachments !== undefined) {
      data.attachments = (body as any).attachments || '[]'
    }

    // Scope-aware FK handling with validation (reuse POST checks)
    if (body.scope !== undefined) {
      if (body.scope === 'DEPARTMENT' && !(body.departmentId ?? existing.departmentId)) {
        res.status(400).json({ error: 'departmentId required for DEPARTMENT scope' }); return
      }
      if (body.scope === 'ROOM' && !(body.roomId ?? existing.roomId)) {
        res.status(400).json({ error: 'roomId required for ROOM scope' }); return
      }
      if (body.scope === 'ALL' && (body.departmentId || body.roomId)) {
        res.status(400).json({ error: 'departmentId/roomId must be empty for ALL scope' }); return
      }
      // Validate against the REAL enum (400 on ghost via throw).
      try {
        data.scope = toAssignmentScopeEnum(body.scope)
      } catch {
        res.status(400).json({ error: 'Invalid scope. Allowed: ALL, DEPARTMENT, ROOM' }); return
      }
      if (body.scope === 'DEPARTMENT') {
        data.departmentId = (body.departmentId ?? existing.departmentId) as string
        data.roomId = null
      } else if (body.scope === 'ROOM') {
        data.roomId = (body.roomId ?? existing.roomId) as string
        data.departmentId = null
      } else {
        data.departmentId = null
        data.roomId = null
      }
      if (data.departmentId) {
        const deptCollegeForUpdate = existing.collegeId || user.collegeId
        const dept = await prisma.department.findFirst({ where: { id: data.departmentId, ...(deptCollegeForUpdate ? { collegeId: deptCollegeForUpdate } : {}) } })
        if (!dept) { res.status(400).json({ error: 'Invalid departmentId for your college' }); return }
      }
      if (data.roomId) {
        const room = await prisma.room.findFirst({ where: { id: data.roomId } })
        if (!room) { res.status(404).json({ error: 'Room not found' }); return }
        const isCreator2 = room.teacherId === user.id
        let isCollegeAdminRoom2 = false
        if (user.role === 'COLLEGE_ADMIN' && user.collegeId) {
          if (!room.teacherId) isCollegeAdminRoom2 = true
          else {
            const teacher2 = await prisma.user.findUnique({ where: { id: room.teacherId }, select: { collegeId: true } })
            isCollegeAdminRoom2 = teacher2?.collegeId === user.collegeId
          }
        }
        const isSuperRoom2 = user.role === 'SUPER_ADMIN' || (user as any).role === 'SUPER'
        if (!isCreator2 && !isCollegeAdminRoom2 && !isSuperRoom2) { res.status(403).json({ error: 'Not authorized for this room' }); return }
      }
    } else {
      const effectiveScope = existing.scope as string
      if (body.departmentId !== undefined || body.roomId !== undefined) {
        if (effectiveScope === 'ALL' && (body.departmentId || body.roomId)) {
          res.status(400).json({ error: 'departmentId/roomId must be empty for ALL scope' }); return
        }
        if (effectiveScope === 'DEPARTMENT' && body.departmentId !== undefined && !body.departmentId) {
          res.status(400).json({ error: 'departmentId required for DEPARTMENT scope' }); return
        }
        if (effectiveScope === 'ROOM' && body.roomId !== undefined && !body.roomId) {
          res.status(400).json({ error: 'roomId required for ROOM scope' }); return
        }
        if (effectiveScope === 'ROOM' && body.departmentId) {
          res.status(400).json({ error: 'departmentId must be empty for ROOM scope' }); return
        }
        if (effectiveScope === 'DEPARTMENT' && body.roomId) {
          res.status(400).json({ error: 'roomId must be empty for DEPARTMENT scope' }); return
        }
      }
      if (body.departmentId !== undefined && effectiveScope === 'DEPARTMENT') {
        data.departmentId = body.departmentId
        if (body.departmentId) {
          const deptCollegeForPatch = existing.collegeId || user.collegeId
          const dept = await prisma.department.findFirst({ where: { id: body.departmentId, ...(deptCollegeForPatch ? { collegeId: deptCollegeForPatch } : {}) } })
          if (!dept) { res.status(400).json({ error: 'Invalid departmentId for your college' }); return }
        }
      }
      if (body.roomId !== undefined && effectiveScope === 'ROOM') {
        data.roomId = body.roomId
        if (body.roomId) {
          const room = await prisma.room.findFirst({ where: { id: body.roomId } })
          if (!room) { res.status(404).json({ error: 'Room not found' }); return }
          const isCreator3 = room.teacherId === user.id
          let isCollegeAdminRoom3 = false
          if (user.role === 'COLLEGE_ADMIN' && user.collegeId) {
            if (!room.teacherId) isCollegeAdminRoom3 = true
            else {
              const teacher3 = await prisma.user.findUnique({ where: { id: room.teacherId }, select: { collegeId: true } })
              isCollegeAdminRoom3 = teacher3?.collegeId === user.collegeId
            }
          }
          const isSuperRoom3 = user.role === 'SUPER_ADMIN' || (user as any).role === 'SUPER'
          if (!isCreator3 && !isCollegeAdminRoom3 && !isSuperRoom3) { res.status(403).json({ error: 'Not authorized for this room' }); return }
        }
      }
    }

    if (body.title !== undefined) data.title = body.title.trim()
    if (body.description !== undefined) data.description = body.description
    if (body.courseId !== undefined) {
      if (body.courseId) {
        const course = await prisma.course.findUnique({ where: { id: body.courseId }, select: { id: true } })
        if (!course) { res.status(400).json({ error: 'Invalid courseId: course not found' }); return }
        data.courseId = body.courseId
      } else {
        data.courseId = body.courseId
      }
    }
    if (body.dueDate !== undefined) data.dueDate = body.dueDate as Date
    if (body.submissionMode !== undefined) {
      try {
        data.submissionMode = toSubmissionModeEnum(body.submissionMode)
      } catch {
        res.status(400).json({ error: 'Invalid submissionMode. Allowed: ONLINE, OFFLINE, HYBRID' }); return
      }
    }
    if (body.showGrades !== undefined) data.showGrades = body.showGrades
    if (body.showFeedback !== undefined) data.showFeedback = body.showFeedback
    if (body.showSubmissionStatus !== undefined) data.showSubmissionStatus = body.showSubmissionStatus
    if (body.showStats !== undefined) data.showStats = body.showStats
    if (body.maxPoints !== undefined) data.maxPoints = body.maxPoints
    if (body.maxGrade !== undefined) data.maxGrade = body.maxGrade
    if (body.allowLateSubmission !== undefined) data.allowLateSubmission = body.allowLateSubmission

    const updated = await prisma.assignmentHub.update({ where: { id: existing.id }, data })
    // Order 10 (V-17): when the blob changed, replace child rows to match
    // (best-effort; blob stays the fallback truth until contract phase).
    if (data.attachments !== undefined) {
      try {
        const urls = parseAttachmentUrls((updated as any).attachments)
        await (prisma as any).assignmentAttachment.deleteMany({ where: { assignmentId: existing.id } })
        if (urls.length > 0) {
          await (prisma as any).assignmentAttachment.createMany({
            data: urls.map((url, i) => ({ assignmentId: existing.id, url, order: i })),
          })
        }
      } catch (err) { logger.debug({ err }, '[hub] attachments re-sync non-fatal') }
    }
    try { broadcastAssignmentMutation(updated.id, (updated as { collegeId?: string | null }).collegeId ?? (existing as { collegeId?: string | null }).collegeId ?? null) } catch {}
    res.json(updated)
  } catch (e: any) {
    if (e instanceof z.ZodError) { res.status(400).json({ error: 'Validation error', details: e.errors ?? (e as any).issues }); return }
    if (e.message === 'File type not allowed' || e.code === 'LIMIT_FILE_SIZE') {
      res.status(e.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: e.message }); return
    }
    if (e?.code === 'P2003') { res.status(400).json({ error: 'Invalid reference: related record not found' }); return }
    logger.error({ err: e }, 'Update hub error'); res.status(500).json({ error: 'Failed to update', detail: e?.message })
  }
})

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    // NARROW + PARALLEL: user (id/role/collegeId) + hub are independent — was 2 sequential awaits.
    const [user, existing] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, collegeId: true } }),
      prisma.assignmentHub.findUnique({ where: { id: req.params.id as string } }),
    ])
    if (!user) { res.status(401).json({ error: 'User not found' }); return }
    if (!existing) { res.status(404).json({ error: 'Not found' }); return }
    const isOwner = existing.creatorId === user.id
    const isCollegeAdmin = user.role === 'COLLEGE_ADMIN' && existing.collegeId === user.collegeId
    const isSuper = user.role === 'SUPER_ADMIN'
    if (!isOwner && !isCollegeAdmin && !isSuper) { res.status(403).json({ error: 'Only creator or college admin can delete' }); return }
    await prisma.assignmentHub.delete({ where: { id: existing.id } })
    try { broadcastAssignmentMutation(existing.id, (existing as { collegeId?: string | null }).collegeId ?? null) } catch {}
    res.json({ message: 'Deleted' })
  } catch (e) { logger.error({ err: e }, 'Delete hub error'); res.status(500).json({ error: 'Failed to delete' }) }
})

export default router
