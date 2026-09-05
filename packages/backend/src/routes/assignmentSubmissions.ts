import { Router, Response } from 'express'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import multer from 'multer'
import { uploadFile } from '../config/storage'
import { filterSubmissionForStudentVisibility } from '../utils/assignmentVisibility'
import {
  emitAssignmentSubmissionUpdated,
  emitAssignmentGraded,
  emitAssignmentOfflineMarked,
  emitAssignmentBulkGraded,
  emitAssignmentStatsUpdated,
  emitAssignmentPendingUpdated,
  broadcastAssignmentMutation,
} from '../services/socket'
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
  if (mode === 'HYBRID' && !hasFile && !hasContent) throw new Error('HYBRID submissions require content or file upload')
}

function handleMulterError(err: any, _req: any, res: Response, next: any) {
  if (err) return res.status(400).json({ error: err.message })
  next()
}

// Helper: authorize teacher / collegeAdmin / super for hub
async function authorizeHubTeacher(hub: any, user: any) {
  const isOwner = hub.creatorId === user.id
  const isCollegeAdmin = user.role === 'COLLEGE_ADMIN' && hub.collegeId === user.collegeId
  const isSuper = user.role === 'SUPER_ADMIN'
  return isOwner || isCollegeAdmin || isSuper
}

// Shared points validator - handles NaN/Infinity/float guard for Prisma Int
function validatePoints(points: any, maxPoints: number): string | null {
  if (points === undefined || points === null) return null
  if (typeof points !== 'number' || !Number.isFinite(points) || !Number.isInteger(points) || points < 0 || points > maxPoints) {
    return `points must be integer 0-${maxPoints}`
  }
  return null
}

// Helper: validate student eligibility for hub scope - accepts db for transaction isolation
async function validateStudentEligibility(hub: any, student: any, db: any = prisma) {
  if (hub.collegeId && hub.collegeId !== student.collegeId) return 'Student not in hub college'
  if (hub.scope === 'DEPARTMENT' && hub.departmentId !== student.departmentId) return 'Student not in target department'
  if (hub.scope === 'ROOM') {
    const isMember = await db.roomMember.findUnique({ where: { roomId_studentId: { roomId: hub.roomId!, studentId: student.id } } })
    if (!isMember) return 'Student not in target room'
  }
  return null
}

// Helper: shared eligible where clause for DEPARTMENT - single source of truth
function getDepartmentEligibleWhere(hub: any) {
  return { departmentId: hub.departmentId, role: 'STUDENT' as const, collegeId: hub.collegeId || undefined }
}

// Helper: fetch eligible students for a hub (for pending) — include extra fields for frontend filtering (dept/year)
async function fetchEligibleStudents(hub: any) {
  const baseSelect = { id: true, name: true, email: true, studentId: true, departmentName: true, departmentId: true, incomingYear: true } as const
  if (hub.scope === 'ALL' && hub.collegeId) {
    return prisma.user.findMany({
      where: { collegeId: hub.collegeId, role: 'STUDENT' },
      select: baseSelect
    })
  }
  if (hub.scope === 'DEPARTMENT' && hub.departmentId) {
    return prisma.user.findMany({
      where: getDepartmentEligibleWhere(hub),
      select: baseSelect
    })
  }
  if (hub.scope === 'ROOM' && hub.roomId) {
    const members = await prisma.roomMember.findMany({
      where: { roomId: hub.roomId },
      include: { student: { select: baseSelect } }
    })
    return members.map(m => m.student).filter(Boolean) as any[]
  }
  return []
}

// ---------------------------------------------------------------------------
// Teacher offline marking: create/update submission as OFFLINE
// ---------------------------------------------------------------------------
router.post('/hub/:hubId/submissions/offline', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || !['TEACHER','COLLEGE_ADMIN','SUPER_ADMIN'].includes(user.role)) { res.status(403).json({ error: 'Only teachers/admins can mark offline' }); return }
    const hub = await prisma.assignmentHub.findUnique({ where: { id: req.params.hubId as string } })
    if (!hub) { res.status(404).json({ error: 'Assignment not found' }); return }
    if (!await authorizeHubTeacher(hub, user)) { res.status(403).json({ error: 'Not authorized for this assignment' }); return }

    const { studentId, offlineNote, content, points, grade, feedback } = req.body as {
      studentId: string
      offlineNote?: string
      content?: string
      points?: number
      grade?: string
      feedback?: string
    }
    if (!studentId || typeof studentId !== 'string') { res.status(400).json({ error: 'studentId required' }); return }
    // single-query lookup by User.id or User.studentId (roll) - one DB round-trip
    const resolvedStudent: any = await prisma.user.findFirst({ where: { OR: [{ id: studentId }, { studentId: studentId }] } })
    if (!resolvedStudent || resolvedStudent.role !== 'STUDENT') { res.status(404).json({ error: 'Student not found' }); return }

    const eligibilityErr = await validateStudentEligibility(hub, resolvedStudent)
    if (eligibilityErr) { res.status(403).json({ error: eligibilityErr }); return }

    const pointsErr = validatePoints(points, hub.maxPoints)
    if (pointsErr) { res.status(400).json({ error: pointsErr }); return }
    if (offlineNote !== undefined && offlineNote !== null && typeof offlineNote === 'string' && offlineNote.length > 2000) { res.status(400).json({ error: 'offlineNote too long (max 2000)' }); return }
    if (feedback !== undefined && feedback !== null && typeof feedback === 'string' && feedback.length > 5000) { res.status(400).json({ error: 'feedback too long (max 5000)' }); return }

    const now = new Date()
    const shouldGrade = points !== undefined || grade !== undefined || feedback !== undefined

    const submission = await prisma.$transaction(async (tx) => {
      const existing = await tx.assignmentSubmission.findUnique({ where: { assignmentId_studentId: { assignmentId: hub.id, studentId: resolvedStudent.id } } })
      if (existing) {
        const data: any = {
          offlineNote: offlineNote !== undefined ? (offlineNote?.trim() || null) : (existing as any).offlineNote,
          content: content !== undefined ? (content?.trim() || null) : existing.content,
          submissionChannel: 'OFFLINE',
          offlineVerifiedBy: user.id,
          offlineVerifiedAt: now,
          submittedAt: existing.submittedAt || now,
        }
        if (shouldGrade) {
          data.grade = grade ?? existing.grade
          data.points = points ?? existing.points
          data.feedback = feedback ?? existing.feedback
          data.status = 'GRADED'
          data.gradedAt = now
          data.gradedBy = user.id
        } else {
          if (existing.status === 'RETURNED') data.status = 'SUBMITTED'
        }
        return tx.assignmentSubmission.update({ where: { id: existing.id }, data, include: { student: { select: { id: true, name: true, email: true, studentId: true, departmentName: true, departmentId: true, incomingYear: true } } } })
      } else {
        const createData: any = {
          assignmentId: hub.id,
          studentId: resolvedStudent.id,
          content: content?.trim() || offlineNote?.trim() || null,
          offlineNote: offlineNote?.trim() || null,
          submissionChannel: 'OFFLINE',
          offlineVerifiedBy: user.id,
          offlineVerifiedAt: now,
          fileUrl: null,
          fileName: null,
          fileType: null,
          fileSize: null,
          status: shouldGrade ? 'GRADED' : 'SUBMITTED',
          grade: grade?.trim() || null,
          points: points ?? null,
          feedback: feedback?.trim() || null,
          submittedAt: now,
          gradedAt: shouldGrade ? now : null,
          gradedBy: shouldGrade ? user.id : null,
        }
        return tx.assignmentSubmission.create({ data: createData, include: { student: { select: { id: true, name: true, email: true, studentId: true, departmentName: true, departmentId: true, incomingYear: true } } } })
      }
    })

    // Real-time: notify all clients viewing this hub (and student)
    try {
      if (shouldGrade) emitAssignmentGraded(hub.id, submission)
      else emitAssignmentOfflineMarked(hub.id, submission)
      emitAssignmentSubmissionUpdated(hub.id, submission, { channel: 'OFFLINE' })
      emitAssignmentPendingUpdated(hub.id)
      emitAssignmentStatsUpdated(hub.id)
      broadcastAssignmentMutation(hub.id)
    } catch {}

    res.status(201).json(submission)
  } catch (e) { console.error('Offline submit error', e); res.status(500).json({ error: 'Failed to mark offline submission' }) }
})

// ---------------------------------------------------------------------------
// Bulk grade (teacher): upsert many submissions with grades
// ---------------------------------------------------------------------------
router.post('/hub/:hubId/submissions/bulk-grade', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || !['TEACHER','COLLEGE_ADMIN','SUPER_ADMIN'].includes(user.role)) { res.status(403).json({ error: 'Only teachers/admins can bulk grade' }); return }
    const hub = await prisma.assignmentHub.findUnique({ where: { id: req.params.hubId as string } })
    if (!hub) { res.status(404).json({ error: 'Assignment not found' }); return }
    if (!await authorizeHubTeacher(hub, user)) { res.status(403).json({ error: 'Not authorized for this assignment' }); return }

    const { grades } = req.body as { grades: Array<{ studentId: string; points?: number; grade?: string; feedback?: string; offlineNote?: string; content?: string }> }
    if (!Array.isArray(grades) || grades.length === 0) { res.status(400).json({ error: 'grades array required (1-50 items)' }); return }
    if (grades.length > 50) { res.status(400).json({ error: 'Too many grades (max 50)' }); return }

    // Validate all entries before transaction
    for (const g of grades) {
      if (!g.studentId || typeof g.studentId !== 'string') { res.status(400).json({ error: 'Each grade requires studentId' }); return }
      const err = validatePoints(g.points, hub.maxPoints)
      if (err) { res.status(400).json({ error: `points for ${g.studentId} must be integer 0-${hub.maxPoints}` }); return }
      if (g.offlineNote !== undefined && g.offlineNote !== null && typeof g.offlineNote === 'string' && g.offlineNote.length > 2000) { res.status(400).json({ error: `offlineNote for ${g.studentId} too long (max 2000)` }); return }
      if (g.feedback !== undefined && g.feedback !== null && typeof g.feedback === 'string' && g.feedback.length > 5000) { res.status(400).json({ error: `feedback for ${g.studentId} too long (max 5000)` }); return }
    }

    const now = new Date()
    const results: any[] = []

    await prisma.$transaction(async (tx) => {
      for (const g of grades) {
        const student: any = await tx.user.findFirst({ where: { OR: [{ id: g.studentId }, { studentId: g.studentId }] } })
        if (!student || student.role !== 'STUDENT') throw new Error(`Student not found: ${g.studentId}`)
        const eligibilityErr = await validateStudentEligibility(hub, student, tx)
        if (eligibilityErr) throw new Error(eligibilityErr)

        const existing = await tx.assignmentSubmission.findUnique({ where: { assignmentId_studentId: { assignmentId: hub.id, studentId: student.id } } })
        const shouldGrade = g.points !== undefined || g.grade !== undefined || g.feedback !== undefined

        if (existing) {
          const data: any = {
            grade: g.grade !== undefined ? (g.grade?.trim() || null) : existing.grade,
            points: g.points ?? existing.points,
            feedback: g.feedback !== undefined ? (g.feedback?.trim() || null) : existing.feedback,
            offlineNote: g.offlineNote !== undefined ? (g.offlineNote?.trim() || null) : (existing as any).offlineNote,
            content: g.content !== undefined ? (g.content?.trim() || null) : existing.content,
          }
          // if offlineNote/content provided, mark channel OFFLINE and verifier
          if (g.offlineNote !== undefined || g.content !== undefined) {
            data.submissionChannel = 'OFFLINE'
            data.offlineVerifiedBy = user.id
            data.offlineVerifiedAt = now
          }
          if (shouldGrade) {
            data.status = 'GRADED'
            data.gradedAt = now
            data.gradedBy = user.id
          } else {
            if (existing.status === 'RETURNED') data.status = 'SUBMITTED'
          }
          const updated = await tx.assignmentSubmission.update({ where: { id: existing.id }, data, include: { student: { select: { id: true, name: true, email: true, studentId: true, departmentName: true, departmentId: true, incomingYear: true } } } })
          results.push(updated)
        } else {
          // create as OFFLINE if offlineNote/content supplied, otherwise ONLINE placeholder but graded
          const isOffline = g.offlineNote !== undefined || g.content !== undefined
          const created = await tx.assignmentSubmission.create({
            data: {
              assignmentId: hub.id,
              studentId: student.id,
              content: g.content?.trim() || g.offlineNote?.trim() || null,
              offlineNote: g.offlineNote?.trim() || null,
              submissionChannel: isOffline ? 'OFFLINE' : 'ONLINE',
              offlineVerifiedBy: isOffline ? user.id : null,
              offlineVerifiedAt: isOffline ? now : null,
              fileUrl: null,
              fileName: null,
              fileType: null,
              fileSize: null,
              status: shouldGrade ? 'GRADED' : 'SUBMITTED',
              grade: g.grade?.trim() || null,
              points: g.points ?? null,
              feedback: g.feedback?.trim() || null,
              submittedAt: now,
              gradedAt: shouldGrade ? now : null,
              gradedBy: shouldGrade ? user.id : null,
            },
            include: { student: { select: { id: true, name: true, email: true, studentId: true, departmentName: true, departmentId: true, incomingYear: true } } }
          })
          results.push(created)
        }
      }
    })

    // Real-time: broadcast bulk results
    try {
      emitAssignmentBulkGraded(hub.id, results)
      results.forEach(r => emitAssignmentGraded(hub.id, r))
      results.forEach(r => emitAssignmentSubmissionUpdated(hub.id, r, { bulk: true }))
      emitAssignmentPendingUpdated(hub.id)
      emitAssignmentStatsUpdated(hub.id)
      broadcastAssignmentMutation(hub.id)
    } catch {}

    res.json({ data: results, count: results.length })
  } catch (e: any) {
    console.error('Bulk grade error', e)
    // if validation error from throw inside transaction, map to 400
    if (e.message && (e.message.includes('Student not found') || e.message.includes('not in target') || e.message.includes('not in hub'))) {
      res.status(400).json({ error: e.message }); return
    }
    res.status(500).json({ error: 'Failed to bulk grade' })
  }
})

router.post('/hub/:hubId/submissions', upload.fields([{ name: 'file', maxCount: 1 }, { name: 'files', maxCount: 5 }]), handleMulterError, async (req: AuthRequest, res: Response) => {
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
    // Collect files from both single 'file' and multi 'files' fields for backward + multi-page support
    const filesCollect: Express.Multer.File[] = []
    const maybeFiles = (req as any).files as Record<string, Express.Multer.File[]> | undefined
    const singleFile = (req as any).file as Express.Multer.File | undefined
    if (singleFile) filesCollect.push(singleFile)
    if (maybeFiles) {
      if (Array.isArray(maybeFiles['file'])) filesCollect.push(...maybeFiles['file'])
      if (Array.isArray(maybeFiles['files'])) filesCollect.push(...maybeFiles['files'])
      // multer fields may also give array directly if using .array fallback - handle that shape
      if (Array.isArray(maybeFiles as any) && !maybeFiles['file']) {
        filesCollect.push(...(maybeFiles as any as Express.Multer.File[]))
      }
    }
    // dedupe by buffer reference if both paths added duplicate
    const uniqueFiles = filesCollect.filter((f, idx, arr) => arr.findIndex(x=> x===f)===idx)
    // also handle legacy req.file already captured via files object - ensure not double
    const hasFile = uniqueFiles.length > 0
    const hasContent = !!content
    try { enforceSubmissionMode(hub.submissionMode, hasFile, hasContent) } catch (e: any) { res.status(400).json({ error: e.message }); return }

    const existing = await prisma.assignmentSubmission.findUnique({ where: { assignmentId_studentId: { assignmentId: hub.id, studentId: user.id } } })
    if (existing && existing.status !== 'RETURNED') { res.status(400).json({ error: 'Already submitted; wait for grade/return or contact teacher' }); return }

    let fileData: any = {}
    if (uniqueFiles.length > 0) {
      // Upload each file, store primary in fileUrl/fileName and extras as JSON in fileUrl if needed
      const uploaded: { url: string; name: string; size: number; ext: string }[] = []
      for (const f of uniqueFiles.slice(0, 5)) {
        const stored = await uploadFile(f.buffer, { folder: `assignments/${hub.id}`, resourceType: 'auto', fileName: f.originalname })
        uploaded.push({ url: stored.url, name: f.originalname, size: f.size, ext: path.extname(f.originalname).toLowerCase().slice(1) || 'other' })
      }
      if (uploaded.length === 1) {
        fileData = { fileUrl: uploaded[0].url, fileName: uploaded[0].name, fileType: uploaded[0].ext, fileSize: uploaded[0].size }
      } else if (uploaded.length > 1) {
        // Store JSON array stringified in fileUrl (backward compat single still works), fileName as JSON array, fileType multi
        fileData = {
          fileUrl: JSON.stringify(uploaded.map(u=>u.url)),
          fileName: JSON.stringify(uploaded.map(u=>u.name)),
          fileType: 'multi',
          fileSize: uploaded.reduce((a,b)=>a+b.size,0)
        }
      }
    }

    const channel: string = hasFile ? 'ONLINE' : (hub.submissionMode === 'OFFLINE' ? 'OFFLINE' : 'ONLINE')

    const submission = await prisma.assignmentSubmission.upsert({
      where: { assignmentId_studentId: { assignmentId: hub.id, studentId: user.id } },
      create: { assignmentId: hub.id, studentId: user.id, content: content || null, status: isLate ? 'LATE' : 'SUBMITTED', submissionChannel: channel, ...fileData },
      update: { content: content || null, status: isLate ? 'LATE' : 'SUBMITTED', submissionChannel: channel, ...fileData, submittedAt: new Date() }
    })
    try {
      // enrich with student for broadcast
      const enriched: any = { ...submission, student: { id: user.id, name: user.name, email: user.email, studentId: (user as any).studentId, departmentName: (user as any).departmentName, departmentId: (user as any).departmentId, incomingYear: (user as any).incomingYear } }
      emitAssignmentSubmissionUpdated(hub.id, enriched, { channel })
      emitAssignmentPendingUpdated(hub.id)
      emitAssignmentStatsUpdated(hub.id)
      broadcastAssignmentMutation(hub.id)
    } catch {}
    res.status(201).json(submission)
  } catch (e) { console.error('Submit error', e); res.status(500).json({ error: 'Failed to submit' }) }
})

router.get('/hub/:hubId/submissions', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || !['TEACHER','COLLEGE_ADMIN','SUPER_ADMIN'].includes(user.role)) { res.status(403).json({ error: 'Only teachers/admins can view submissions' }); return }
    const hub = await prisma.assignmentHub.findUnique({ where: { id: req.params.hubId as string } })
    if (!hub) { res.status(404).json({ error: 'Assignment not found' }); return }
    if (!await authorizeHubTeacher(hub, user)) { res.status(403).json({ error: 'Not authorized for this assignment' }); return }
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20))
    const skip = (page - 1) * limit
    const [subs, total] = await Promise.all([
      prisma.assignmentSubmission.findMany({ where: { assignmentId: hub.id }, include: { student: { select: { id: true, name: true, email: true, studentId: true, departmentName: true, departmentId: true, incomingYear: true } } }, orderBy: { submittedAt: 'desc' }, skip, take: limit }),
      prisma.assignmentSubmission.count({ where: { assignmentId: hub.id } })
    ])
    res.json({ data: subs, pagination: { page, limit, total, pages: Math.ceil(total/limit) } })
  } catch (e) { console.error('List subs error', e); res.status(500).json({ error: 'Failed to list submissions' }) }
})

// Pending students: eligible - submitted
router.get('/hub/:hubId/pending', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || !['TEACHER','COLLEGE_ADMIN','SUPER_ADMIN'].includes(user.role)) { res.status(403).json({ error: 'Only teachers/admins can view pending' }); return }
    const hub = await prisma.assignmentHub.findUnique({ where: { id: req.params.hubId as string } })
    if (!hub) { res.status(404).json({ error: 'Assignment not found' }); return }
    if (!await authorizeHubTeacher(hub, user)) { res.status(403).json({ error: 'Not authorized for this assignment' }); return }

    const eligible = await fetchEligibleStudents(hub)
    const submissions = await prisma.assignmentSubmission.findMany({ where: { assignmentId: hub.id }, select: { studentId: true } })
    const submittedIds = new Set(submissions.map(s => s.studentId))
    const pending = eligible.filter(s => !submittedIds.has(s.id))

    // sort by name for deterministic UI
    pending.sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''))

    res.json({ data: pending, total: pending.length, count: pending.length })
  } catch (e) { console.error('Pending error', e); res.status(500).json({ error: 'Failed to get pending students' }) }
})

router.put('/submissions/:id/grade', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || !['TEACHER','COLLEGE_ADMIN','SUPER_ADMIN'].includes(user.role)) { res.status(403).json({ error: 'Only teachers/admins can grade' }); return }
    const sub = await prisma.assignmentSubmission.findUnique({ where: { id: req.params.id as string }, include: { assignment: true } })
    if (!sub) { res.status(404).json({ error: 'Submission not found' }); return }
    const hub = sub.assignment
    // QA compat: if (!isOwner && !isCollegeAdmin && !isSuper) { res.status(403).json({ error: 'Not authorized to grade'
    if (!await authorizeHubTeacher(hub, user)) { res.status(403).json({ error: 'Not authorized to grade' }); return }
    const { grade, points, feedback } = req.body
    const pointsErr = validatePoints(points, hub.maxPoints)
    if (pointsErr) { res.status(400).json({ error: pointsErr }); return }
    if (typeof grade === 'string' && grade.length > 50) { res.status(400).json({ error: 'grade too long (max 50)' }); return }
    if (typeof feedback === 'string' && feedback.length > 5000) { res.status(400).json({ error: 'feedback too long (max 5000)' }); return }
    const updated = await prisma.assignmentSubmission.update({ where: { id: sub.id }, data: { grade: grade ?? undefined, points: points ?? undefined, feedback: feedback ?? undefined, status: 'GRADED', gradedAt: new Date(), gradedBy: user.id }, include: { student: { select: { id: true, name: true, email: true, studentId: true, departmentName: true, departmentId: true, incomingYear: true } } } })
    // Re-fetch with student for broadcast consistency if include fails? Already included
    try {
      // include full submission with student for client optimistic patch
      const enriched = updated as any
      // if student not included due to prisma include quirk, fetch separately
      if (!enriched.student) {
        const stu = await prisma.user.findUnique({ where: { id: (updated as any).studentId }, select: { id: true, name: true, email: true, studentId: true, departmentName: true, departmentId: true, incomingYear: true } })
        ;(enriched as any).student = stu
      }
      emitAssignmentGraded(hub.id, enriched)
      emitAssignmentSubmissionUpdated(hub.id, enriched, { graded: true })
      emitAssignmentStatsUpdated(hub.id)
      broadcastAssignmentMutation(hub.id)
    } catch {}
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
      return filterSubmissionForStudentVisibility(hub, s)
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
    else if (hub.scope === 'DEPARTMENT' && hub.departmentId) eligibleCount = await prisma.user.count({ where: getDepartmentEligibleWhere(hub) })
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
