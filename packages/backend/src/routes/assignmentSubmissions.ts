import { Router, Response } from 'express'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import multer from 'multer'
import { uploadFile } from '../config/storage'
import path from 'path'

const router = Router({ mergeParams: true })
router.use(authenticate)

export const blockedSubmissionExtensions = ['.html','.htm','.xhtml','.svg','.xml','.js','.mjs','.css','.exe','.sh']

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (blockedSubmissionExtensions.includes(path.extname(file.originalname).toLowerCase())) { cb(new Error('File type not allowed')); return }
    cb(null, true)
  }
})

export function enforceSubmissionMode(mode: string, hasFile: boolean, hasContent: boolean) {
  if (mode === 'ONLINE' && !hasFile && !hasContent) throw new Error('ONLINE submissions require content or file upload')
  if (mode === 'OFFLINE' && hasFile) throw new Error('OFFLINE submissions must not include files; submit in person')
  if (mode === 'OFFLINE' && !hasContent) throw new Error('OFFLINE submissions require confirmation text (e.g., roll number or offline receipt)')
}

function handleMulterError(err: any, _req: any, res: Response, next: any) {
  if (err) return res.status(400).json({ error: err.message })
  next()
}

router.post('/hub/:hubId/submissions', upload.single('file'), handleMulterError, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || user.role !== 'STUDENT') { res.status(403).json({ error: 'Only students can submit' }); return }
    const hub = await prisma.assignmentHub.findUnique({ where: { id: req.params.hubId as string } })
    if (!hub) { res.status(404).json({ error: 'Assignment not found' }); return }
    if (hub.collegeId && hub.collegeId !== user.collegeId) { res.status(403).json({ error: 'Not in your college' }); return }
    if (hub.scope === 'DEPARTMENT' && hub.departmentId !== user.departmentId) { res.status(403).json({ error: 'Not in target department' }); return }
    if (hub.scope === 'ROOM') {
      const isMember = await prisma.roomMember.findUnique({ where: { roomId_studentId: { roomId: hub.roomId!, studentId: user.id } } })
      if (!isMember) { res.status(403).json({ error: 'Not in target room' }); return }
    }
    const isLate = new Date() > hub.dueDate
    if (isLate && !hub.allowLateSubmission) { res.status(400).json({ error: 'Past due date and late submissions not allowed' }); return }
    const content = typeof req.body.content === 'string' ? req.body.content.trim() : ''
    const hasFile = !!req.file
    const hasContent = !!content
    try { enforceSubmissionMode(hub.submissionMode, hasFile, hasContent) } catch (e: any) { res.status(400).json({ error: e.message }); return }

    const existing = await prisma.assignmentSubmission.findUnique({ where: { assignmentId_studentId: { assignmentId: hub.id, studentId: user.id } } })
    if (existing && existing.status !== 'RETURNED') { res.status(400).json({ error: 'Already submitted; wait for grade/return or contact teacher' }); return }

    let fileData: any = {}
    if (req.file) {
      const stored = await uploadFile(req.file.buffer, { folder: `assignments/${hub.id}`, resourceType: 'auto', fileName: req.file.originalname })
      fileData = { fileUrl: stored.url, fileName: req.file.originalname, fileType: path.extname(req.file.originalname).toLowerCase().slice(1) || 'other', fileSize: req.file.size }
    }

    const submission = await prisma.assignmentSubmission.upsert({
      where: { assignmentId_studentId: { assignmentId: hub.id, studentId: user.id } },
      create: { assignmentId: hub.id, studentId: user.id, content: content || null, status: isLate ? 'LATE' : 'SUBMITTED', ...fileData },
      update: { content: content || null, status: isLate ? 'LATE' : 'SUBMITTED', ...fileData, submittedAt: new Date() }
    })
    res.status(201).json(submission)
  } catch (e) { console.error('Submit error', e); res.status(500).json({ error: 'Failed to submit' }) }
})

router.get('/hub/:hubId/submissions', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || !['TEACHER','COLLEGE_ADMIN','SUPER_ADMIN'].includes(user.role)) { res.status(403).json({ error: 'Only teachers/admins can view submissions' }); return }
    const hub = await prisma.assignmentHub.findUnique({ where: { id: req.params.hubId as string } })
    if (!hub) { res.status(404).json({ error: 'Assignment not found' }); return }
    const isOwner = hub.creatorId === user.id
    const isCollegeAdmin = user.role === 'COLLEGE_ADMIN' && hub.collegeId === user.collegeId
    const isSuper = user.role === 'SUPER_ADMIN'
    if (!isOwner && !isCollegeAdmin && !isSuper) { res.status(403).json({ error: 'Not authorized for this assignment' }); return }
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20))
    const skip = (page - 1) * limit
    const [subs, total] = await Promise.all([
      prisma.assignmentSubmission.findMany({ where: { assignmentId: hub.id }, include: { student: { select: { id: true, name: true, email: true, studentId: true, departmentName: true } } }, orderBy: { submittedAt: 'desc' }, skip, take: limit }),
      prisma.assignmentSubmission.count({ where: { assignmentId: hub.id } })
    ])
    res.json({ data: subs, pagination: { page, limit, total, pages: Math.ceil(total/limit) } })
  } catch (e) { console.error('List subs error', e); res.status(500).json({ error: 'Failed to list submissions' }) }
})

router.put('/submissions/:id/grade', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || !['TEACHER','COLLEGE_ADMIN','SUPER_ADMIN'].includes(user.role)) { res.status(403).json({ error: 'Only teachers/admins can grade' }); return }
    const sub = await prisma.assignmentSubmission.findUnique({ where: { id: req.params.id as string }, include: { assignment: true } })
    if (!sub) { res.status(404).json({ error: 'Submission not found' }); return }
    const hub = sub.assignment
    const isOwner = hub.creatorId === user.id
    const isCollegeAdmin = user.role === 'COLLEGE_ADMIN' && hub.collegeId === user.collegeId
    const isSuper = user.role === 'SUPER_ADMIN'
    if (!isOwner && !isCollegeAdmin && !isSuper) { res.status(403).json({ error: 'Not authorized to grade' }); return }
    const { grade, points, feedback } = req.body
    if (points !== undefined && (typeof points !== 'number' || points < 0 || points > hub.maxPoints)) { res.status(400).json({ error: `points must be 0-${hub.maxPoints}` }); return }
    const updated = await prisma.assignmentSubmission.update({ where: { id: sub.id }, data: { grade: grade ?? undefined, points: points ?? undefined, feedback: feedback ?? undefined, status: 'GRADED', gradedAt: new Date(), gradedBy: user.id } })
    res.json(updated)
  } catch (e) { console.error('Grade error', e); res.status(500).json({ error: 'Failed to grade' }) }
})

router.get('/my-submissions', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) { res.status(401).json({ error: 'User not found' }); return }
    const subs = await prisma.assignmentSubmission.findMany({ where: { studentId: user.id }, include: { assignment: { select: { id: true, title: true, dueDate: true, submissionMode: true, showGrades: true, showFeedback: true, showSubmissionStatus: true, maxPoints: true } } }, orderBy: { submittedAt: 'desc' } })
    const filtered = subs.map(s => {
      const hub: any = s.assignment
      let out: any = { ...s }
      if (!hub.showGrades) { out.grade = null; out.points = null }
      if (!hub.showFeedback) out.feedback = null
      if (!hub.showSubmissionStatus) out.status = null
      return out
    })
    res.json(filtered)
  } catch (e) { console.error('My subs error', e); res.status(500).json({ error: 'Failed to fetch' }) }
})

router.get('/hub/:hubId/stats', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) { res.status(401).json({ error: 'User not found' }); return }
    const hub = await prisma.assignmentHub.findUnique({ where: { id: req.params.hubId as string } })
    if (!hub) { res.status(404).json({ error: 'Assignment not found' }); return }
    const isOwner = hub.creatorId === user.id
    const isCollegeAdmin = user.role === 'COLLEGE_ADMIN' && hub.collegeId === user.collegeId
    const isSuper = user.role === 'SUPER_ADMIN'
    const isStudent = user.role === 'STUDENT'
    if (isStudent && !hub.showStats) { res.status(403).json({ error: 'Stats not visible to students for this assignment' }); return }
    if (!isOwner && !isCollegeAdmin && !isSuper && !isStudent) { res.status(403).json({ error: 'Access denied' }); return }
    let eligibleCount: number
    if (hub.scope === 'ALL' && hub.collegeId) eligibleCount = await prisma.user.count({ where: { collegeId: hub.collegeId, role: 'STUDENT' } })
    else if (hub.scope === 'DEPARTMENT' && hub.departmentId) eligibleCount = await prisma.user.count({ where: { departmentId: hub.departmentId, role: 'STUDENT' } })
    else if (hub.scope === 'ROOM' && hub.roomId) eligibleCount = await prisma.roomMember.count({ where: { roomId: hub.roomId } })
    else eligibleCount = 0
    const submissions = await prisma.assignmentSubmission.findMany({ where: { assignmentId: hub.id } })
    const submitted = submissions.length
    const graded = submissions.filter(s => s.status === 'GRADED').length
    const avgPoints = graded ? Math.round((submissions.filter(s => s.points !== null).reduce((a,c)=>a+(c.points||0),0)/graded)*10)/10 : null
    res.json({ eligible: eligibleCount, submitted, pending: Math.max(0, eligibleCount - submitted), graded, avgPoints, submissionRate: eligibleCount ? Math.round((submitted/eligibleCount)*100) : 0 })
  } catch (e) { console.error('Stats error', e); res.status(500).json({ error: 'Failed to get stats' }) }
})

export default router
