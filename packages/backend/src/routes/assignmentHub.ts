import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import { buildHubListWhere } from '../utils/assignmentVisibility'
import multer from 'multer'
import { uploadFile } from '../config/storage'
import path from 'path'

export const hubBlocked = ['.html','.htm','.xhtml','.svg','.xml','.js','.mjs','.css']
const hubUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 }, fileFilter: (_req,file,cb)=> {
  if (hubBlocked.includes(path.extname(file.originalname).toLowerCase())) cb(new Error('File type not allowed'))
  else cb(null,true)
}})

const router = Router()
router.use(authenticate)

const assignmentHubSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  courseId: z.string().optional(),
  dueDate: z.string().transform(s => new Date(s)).refine(d => !isNaN(d.getTime()), { message: 'Invalid dueDate' }),
  scope: z.enum(['ALL','DEPARTMENT','ROOM']).default('ALL'),
  departmentId: z.string().optional().nullable(),
  roomId: z.string().optional().nullable(),
  submissionMode: z.enum(['ONLINE','OFFLINE','HYBRID']).default('ONLINE'),
  showGrades: z.preprocess(v => v === 'true' ? true : v === 'false' ? false : v, z.boolean().default(true)),
  showFeedback: z.preprocess(v => v === 'true' ? true : v === 'false' ? false : v, z.boolean().default(true)),
  showSubmissionStatus: z.preprocess(v => v === 'true' ? true : v === 'false' ? false : v, z.boolean().default(true)),
  showStats: z.preprocess(v => v === 'true' ? true : v === 'false' ? false : v, z.boolean().default(false)),
  maxPoints: z.preprocess(v => typeof v === 'string' ? parseInt(v) : v, z.number().int().min(1).max(1000).default(100)),
  maxGrade: z.string().optional().nullable(),
  allowLateSubmission: z.preprocess(v => v === 'true' ? true : v === 'false' ? false : v, z.boolean().default(false)),
  attachments: z.string().optional(),
})

const updateHubSchema = assignmentHubSchema.partial()

router.post('/', hubUpload.array('attachments', 5), async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || !['TEACHER','COLLEGE_ADMIN','SUPER_ADMIN'].includes(user.role)) {
      res.status(403).json({ error: 'Only teachers and admins can create assignments' }); return
    }
    const body = assignmentHubSchema.parse(req.body)
    let attachmentUrls: string[] = []
    if ((req as any).files && Array.isArray((req as any).files)) {
      for (const f of (req as any).files as Express.Multer.File[]) {
        const stored = await uploadFile(f.buffer, { folder: `assignments/hub`, resourceType: 'auto', fileName: f.originalname })
        attachmentUrls.push(stored.url)
      }
    }
    const attachmentsJson = attachmentUrls.length ? JSON.stringify(attachmentUrls) : body.attachments || '[]'
    if (body.scope === 'DEPARTMENT' && !body.departmentId) { res.status(400).json({ error: 'departmentId required for DEPARTMENT scope' }); return }
    if (body.scope === 'ROOM' && !body.roomId) { res.status(400).json({ error: 'roomId required for ROOM scope' }); return }
    if (body.scope === 'ALL' && (body.departmentId || body.roomId)) { res.status(400).json({ error: 'departmentId/roomId must be empty for ALL scope' }); return }
    if (body.departmentId) {
      const dept = await prisma.department.findFirst({ where: { id: body.departmentId, collegeId: user.collegeId || undefined } })
      if (!dept) { res.status(400).json({ error: 'Invalid departmentId for your college' }); return }
    }
    if (body.roomId) {
      const room = await prisma.room.findFirst({ where: { id: body.roomId } })
      if (!room) { res.status(404).json({ error: 'Room not found' }); return }
      const isCreator = room.teacherId === user.id
      const isCollegeAdmin = user.role === 'COLLEGE_ADMIN' && room.teacherId && (await prisma.user.findUnique({ where: { id: room.teacherId } }))?.collegeId === user.collegeId
      const isSuper = user.role === 'SUPER_ADMIN'
      if (!isCreator && !isCollegeAdmin && !isSuper) { res.status(403).json({ error: 'Not authorized for this room' }); return }
    }
    const hub = await prisma.assignmentHub.create({
      data: {
        title: body.title.trim(),
        description: body.description?.trim(),
        courseId: body.courseId,
        dueDate: body.dueDate as Date,
        creatorId: user.id,
        collegeId: user.role === 'SUPER_ADMIN' ? (body as any).collegeId || user.collegeId : user.collegeId,
        scope: body.scope as any,
        departmentId: body.scope === 'DEPARTMENT' ? body.departmentId! : null,
        roomId: body.scope === 'ROOM' ? body.roomId! : null,
        submissionMode: body.submissionMode as any,
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
    res.status(201).json(hub)
  } catch (e: any) {
    if (e instanceof z.ZodError) { res.status(400).json({ error: 'Validation error', details: e.errors }); return }
    console.error('Create hub error', e); res.status(500).json({ error: 'Failed to create assignment' })
  }
})

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) { res.status(401).json({ error: 'User not found' }); return }
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20))
    const skip = (page - 1) * limit
    const search = (req.query.search as string)?.trim()
    const scope = req.query.scope as string | undefined
    const submissionMode = req.query.submissionMode as string | undefined

    let where: any = buildHubListWhere(user as any, { search, scope, submissionMode })

    if (user.role === 'STUDENT') {
      const allHubs = await prisma.assignmentHub.findMany({ where, orderBy: { dueDate: 'asc' } })
      const roomIds = (await prisma.roomMember.findMany({ where: { studentId: user.id }, select: { roomId: true } })).map(r => r.roomId)
      const visible = allHubs.filter(h => {
        if (h.scope === 'ALL') return true
        if (h.scope === 'DEPARTMENT') return h.departmentId === user.departmentId
        if (h.scope === 'ROOM') return !!h.roomId && roomIds.includes(h.roomId!)
        return false
      })
      const total = visible.length
      const paged = visible.slice(skip, skip + limit)
      const withCounts = await Promise.all(paged.map(async h => {
        const submissions = await prisma.assignmentSubmission.count({ where: { assignmentId: h.id } })
        const mySubmission = await prisma.assignmentSubmission.findUnique({ where: { assignmentId_studentId: { assignmentId: h.id, studentId: user.id } } })
        return { ...h, submissionsCount: submissions, mySubmission: mySubmission ? filterForStudent(h, mySubmission) : null }
      }))
      res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=30')
      res.json({ data: withCounts, pagination: { page, limit, total, pages: Math.ceil(total/limit) } })
      return
    }

    if (user.role === 'TEACHER' || user.role === 'COLLEGE_ADMIN') {
      where.creatorId = user.role === 'TEACHER' ? user.id : undefined
      if (user.role === 'COLLEGE_ADMIN') where.collegeId = user.collegeId
    }

    const [hubs, total] = await Promise.all([
      prisma.assignmentHub.findMany({ where, include: { creator: { select: { id: true, name: true } }, department: { select: { id: true, name: true } }, room: { select: { id: true, name: true } }, _count: { select: { submissions: true } } }, orderBy: { dueDate: 'asc' }, skip, take: limit }),
      prisma.assignmentHub.count({ where })
    ])
    res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=30')
    res.json({ data: hubs, pagination: { page, limit, total, pages: Math.ceil(total/limit) } })
  } catch (e) { console.error('List hub error', e); res.status(500).json({ error: 'Failed to list assignments' }) }
})

function filterForStudent(hub: any, submission: any) {
  if (!hub.showGrades) { const { grade, points, ...rest } = submission; return { ...rest, grade: null, points: null } }
  if (!hub.showFeedback) { const { feedback, ...rest } = submission; return { ...rest, feedback: null } }
  return submission
}

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) { res.status(401).json({ error: 'User not found' }); return }
    const hub = await prisma.assignmentHub.findUnique({ where: { id: req.params.id as string }, include: { creator: { select: { id: true, name: true } }, department: { select: { id: true, name: true } }, room: { select: { id: true, name: true, joinCode: true } }, submissions: user.role === 'STUDENT' ? { where: { studentId: user.id } } : false, _count: { select: { submissions: true } } } })
    if (!hub) { res.status(404).json({ error: 'Assignment not found' }); return }
    if (user.role === 'STUDENT') {
      const roomIds = (await prisma.roomMember.findMany({ where: { studentId: user.id }, select: { roomId: true } })).map(r => r.roomId)
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
    if (!isOwner && !isCollegeAdmin && !isSuper && user.role !== 'TEACHER') { res.status(403).json({ error: 'Access denied' }); return }
    res.json(hub)
  } catch (e) { console.error('Get hub error', e); res.status(500).json({ error: 'Failed to fetch assignment' }) }
})

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) { res.status(401).json({ error: 'User not found' }); return }
    const existing = await prisma.assignmentHub.findUnique({ where: { id: req.params.id as string } })
    if (!existing) { res.status(404).json({ error: 'Not found' }); return }
    const isOwner = existing.creatorId === user.id
    const isCollegeAdmin = user.role === 'COLLEGE_ADMIN' && existing.collegeId === user.collegeId
    const isSuper = user.role === 'SUPER_ADMIN'
    if (!isOwner && !isCollegeAdmin && !isSuper) { res.status(403).json({ error: 'Only creator or college admin can edit' }); return }
    const body = updateHubSchema.parse(req.body)
    if (body.scope && body.scope !== existing.scope) {
      if (body.scope === 'DEPARTMENT' && !body.departmentId) { res.status(400).json({ error: 'departmentId required' }); return }
      if (body.scope === 'ROOM' && !body.roomId) { res.status(400).json({ error: 'roomId required' }); return }
    }
    const updated = await prisma.assignmentHub.update({ where: { id: existing.id }, data: {
      ...(body.title !== undefined ? { title: body.title.trim() } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.courseId !== undefined ? { courseId: body.courseId } : {}),
      ...(body.dueDate !== undefined ? { dueDate: body.dueDate as Date } : {}),
      ...(body.scope !== undefined ? { scope: body.scope as any } : {}),
      ...(body.departmentId !== undefined ? { departmentId: body.scope === 'DEPARTMENT' ? body.departmentId! : body.departmentId } : {}),
      ...(body.roomId !== undefined ? { roomId: body.scope === 'ROOM' ? body.roomId! : body.roomId } : {}),
      ...(body.submissionMode !== undefined ? { submissionMode: body.submissionMode as any } : {}),
      ...(body.showGrades !== undefined ? { showGrades: body.showGrades } : {}),
      ...(body.showFeedback !== undefined ? { showFeedback: body.showFeedback } : {}),
      ...(body.showSubmissionStatus !== undefined ? { showSubmissionStatus: body.showSubmissionStatus } : {}),
      ...(body.showStats !== undefined ? { showStats: body.showStats } : {}),
      ...(body.maxPoints !== undefined ? { maxPoints: body.maxPoints } : {}),
      ...(body.maxGrade !== undefined ? { maxGrade: body.maxGrade } : {}),
      ...(body.allowLateSubmission !== undefined ? { allowLateSubmission: body.allowLateSubmission } : {}),
    }})
    res.json(updated)
  } catch (e: any) {
    if (e instanceof z.ZodError) { res.status(400).json({ error: 'Validation error', details: e.errors }); return }
    console.error('Update hub error', e); res.status(500).json({ error: 'Failed to update' })
  }
})

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) { res.status(401).json({ error: 'User not found' }); return }
    const existing = await prisma.assignmentHub.findUnique({ where: { id: req.params.id as string } })
    if (!existing) { res.status(404).json({ error: 'Not found' }); return }
    const isOwner = existing.creatorId === user.id
    const isCollegeAdmin = user.role === 'COLLEGE_ADMIN' && existing.collegeId === user.collegeId
    const isSuper = user.role === 'SUPER_ADMIN'
    if (!isOwner && !isCollegeAdmin && !isSuper) { res.status(403).json({ error: 'Only creator or college admin can delete' }); return }
    await prisma.assignmentHub.delete({ where: { id: existing.id } })
    res.json({ message: 'Deleted' })
  } catch (e) { console.error('Delete hub error', e); res.status(500).json({ error: 'Failed to delete' }) }
})

export default router
