import { Router, Request, Response } from 'express'
import { authenticate, AuthRequest } from '../middleware/auth'
import { visionCompletion } from '../ai/client'
import prisma from '../config/db'
import { broadcastAttendanceMutation } from '../services/socket'
import { logger } from '../utils/logger'
import { toAttendanceStatusEnum } from '../lib/enums'
import {
  parseAttendanceSubjectsInput,
  buildAttendanceRecordRows,
  resolveAttendanceSubjects,
  hasAttendanceRecords,
  attendancePct,
  isBelowThreshold,
  ATT_DEFAULT_REQUIRED,
} from '../utils/gradeAttendance'

const router = Router()

// Order 11 (V-16 → P6/P9): AttendanceRecord rows are the RECORD (not cache).
// Calculator blob (AttendanceData.subjects) migrates here as one row per
// subject with present/total + last date/status. Expand-phase dual-write:
// writers fill BOTH blob + rows (rows best-effort for pre-migration DBs);
// readers prefer rows with blob fallback. Blobs NEVER dropped here.

// GET /api/attendance/data — load saved attendance
router.get('/data', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!
    // Read-new: AttendanceRecord rows first (best-effort for pre-migration DBs).
    let recordRows: Array<{ subject: string; present: number; total: number }> | null = null
    try {
      const rows = await (prisma as any).attendanceRecord.findMany({
        where: { studentId: userId },
        orderBy: { subject: 'asc' },
        take: 50,
      })
      if (Array.isArray(rows) && rows.length > 0) recordRows = rows
    } catch {
      recordRows = null
    }
    const record = await prisma.attendanceData.findUnique({
      where: { studentId: userId },
    })
    // CACHE-ALL: own attendance data — private edge SWR (user edits invalidate client-side).
    res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60')
    const requiredPct = (record as any)?.requiredPct ?? ATT_DEFAULT_REQUIRED
    if (recordRows && hasAttendanceRecords({ recordRows })) {
      const parsed = resolveAttendanceSubjects({ subjects: (record as any)?.subjects, recordRows: recordRows as any })
      res.json({
        subjects: parsed,
        requiredPct,
        source: 'record',
      })
      return
    }
    if (!record) {
      res.json({ subjects: [], requiredPct: 75, source: 'blob' })
      return
    }
    const subjects = resolveAttendanceSubjects({ subjects: (record as any).subjects, recordRows: null })
    res.json({
      subjects,
      requiredPct: (record as any).requiredPct,
      source: 'blob',
    })
  } catch (error) {
    logger.error({ err: error }, '[Attendance] Load error:')
    res.status(500).json({ error: 'Failed to load attendance data' })
  }
})

// GET /api/attendance/records — raw AttendanceRecord rows (intentionally
// uncached analytics like tasks daily-summary — always fresh, no private CC).
router.get('/records', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!
    let rows: unknown[] = []
    try {
      rows = await (prisma as any).attendanceRecord.findMany({
        where: { studentId: userId },
        orderBy: { subject: 'asc' },
        take: 50,
      })
    } catch {
      rows = []
    }
    res.json({ records: rows, source: rows.length > 0 ? 'record' : 'blob' })
  } catch (error) {
    logger.error({ err: error }, '[Attendance] Records error:')
    res.status(500).json({ error: 'Failed to load attendance records' })
  }
})

// GET /api/attendance/summary — per-subject pct + below-threshold flags.
// This is the V-16 query ("students below X%") now answerable in SQL
// (SUM(present)/SUM(total) GROUP BY subject); here computed from record rows
// with blob fallback. Intentionally uncached (fresh analytics, no private CC).
router.get('/summary', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!
    let recordRows: Array<{ subject: string; present: number; total: number; status?: string; date?: unknown }> | null = null
    try {
      const rows = await (prisma as any).attendanceRecord.findMany({
        where: { studentId: userId },
        orderBy: { subject: 'asc' },
        take: 50,
      })
      if (Array.isArray(rows) && rows.length > 0) recordRows = rows
    } catch {
      recordRows = null
    }
    const blob = await prisma.attendanceData.findUnique({ where: { studentId: userId } })
    const requiredPct = (blob as any)?.requiredPct ?? ATT_DEFAULT_REQUIRED
    const subjects = resolveAttendanceSubjects({ subjects: (blob as any)?.subjects, recordRows: recordRows as any })
    const withPct = subjects.map((s) => {
      const pct = attendancePct(s.attended, s.held)
      return { name: s.name, held: s.held, attended: s.attended, pct, below: isBelowThreshold(s.attended, s.held, requiredPct) }
    })
    res.json({
      requiredPct,
      subjects: withPct,
      belowCount: withPct.filter((s) => s.below).length,
      source: recordRows ? 'record' : 'blob',
    })
  } catch (error) {
    logger.error({ err: error }, '[Attendance] Summary error:')
    res.status(500).json({ error: 'Failed to load attendance summary' })
  }
})

// POST /api/attendance/data — save/replace attendance
router.post('/data', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { subjects, requiredPct } = req.body
    if (!Array.isArray(subjects)) {
      res.status(400).json({ error: 'Subjects array is required' })
      return
    }
    const userId = req.userId!
    const record = await prisma.attendanceData.upsert({
      where: { studentId: userId },
      update: {
        subjects: JSON.stringify(subjects),
        requiredPct: requiredPct ?? 75,
      },
      create: {
        studentId: userId,
        subjects: JSON.stringify(subjects),
        requiredPct: requiredPct ?? 75,
      },
    })
    // Order 11 dual-write non-fatal: mirror blob subjects into
    // AttendanceRecord rows (replace-all per student, same as Order 10).
    try {
      const parsed = parseAttendanceSubjectsInput(subjects)
      const rows = buildAttendanceRecordRows(parsed, requiredPct ?? (record as any)?.requiredPct ?? 75)
      await (prisma as any).attendanceRecord.deleteMany({ where: { studentId: userId } })
      if (rows.length > 0) {
        await (prisma as any).attendanceRecord.createMany({
          data: rows.map((r) => ({
            studentId: userId,
            subject: r.subject,
            present: r.present,
            total: r.total,
            // buildAttendanceRecordRows emits PRESENT/ABSENT (valid
            // AttendanceStatus members); re-validate against the REAL enum
            // so drift fails closed instead of hiding behind `as any`.
            status: toAttendanceStatusEnum(r.status),
          })),
        })
      }
    } catch (e) {
      logger.warn({ err: e }, '[Attendance] Record dual-write skipped (pre-migration DB?)')
    }
    try { broadcastAttendanceMutation({ userId, action: 'saved' }) } catch {}
    res.json({ saved: true, id: record.id })
  } catch (error) {
    logger.error({ err: error }, '[Attendance] Save error:')
    res.status(500).json({ error: 'Failed to save attendance data' })
  }
})

// DELETE /api/attendance/data — clear attendance
router.delete('/data', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!
    await prisma.attendanceData.deleteMany({
      where: { studentId: userId },
    })
    // Order 11 dual-write non-fatal: clear record rows too.
    try {
      await (prisma as any).attendanceRecord.deleteMany({ where: { studentId: userId } })
    } catch (e) {
      logger.warn({ err: e }, '[Attendance] Record delete skipped (pre-migration DB?)')
    }
    try { broadcastAttendanceMutation({ userId, action: 'deleted' }) } catch {}
    res.json({ deleted: true })
  } catch (error) {
    logger.error({ err: error }, '[Attendance] Delete error:')
    res.status(500).json({ error: 'Failed to delete attendance data' })
  }
})

// POST /api/attendance/parse — AI parse image
router.post('/parse', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { image } = req.body
    if (!image || typeof image !== 'string') {
      res.status(400).json({ error: 'Image base64 is required' })
      return
    }

    const mimeType = image.match(/^data:([^;]+)/)?.[1] || 'image/png'
    const base64 = image.includes(',') ? image.split(',')[1] : image

    const prompt = `Look at this attendance table image. Extract every row from the table.

For each row, extract:
- name: the full subject/course name exactly as written (keep course codes like "24IC5017-...")
- held: the "Held" column value (total classes held)
- attended: the "Attend" column value (classes attended)

RULES:
- Extract ALL rows, even if attendance is 0
- Keep subject names EXACTLY as they appear — do not shorten or rename
- Return ONLY a valid JSON array. No markdown, no code fences, no explanation.
- Each object: {"name": "...", "held": 40, "attended": 35}

Return ONLY the JSON array:`

    let response = ''
    try {
      response = await visionCompletion('attendance', [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
        ],
      }], { temperature: 0.1, max_tokens: 4096 })
    } catch (err: any) {
      logger.error({ err: err?.message || err }, '[Attendance Parse] Vision error:')
      res.status(500).json({ error: 'AI vision failed' })
      return
    }

    let clean = response.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    if (clean.toLowerCase().startsWith('<think>')) {
      const firstBracket = clean.indexOf('[')
      if (firstBracket !== -1) clean = clean.substring(firstBracket).trim()
    }
    clean = clean.replace(/^```json?\n?/i, '').replace(/```$/gm, '').trim()

    let subjects
    try {
      subjects = JSON.parse(clean)
    } catch {
      res.status(422).json({ error: 'Could not parse AI response', raw: response })
      return
    }

    if (!Array.isArray(subjects)) {
      res.status(422).json({ error: 'AI response is not an array', raw: subjects })
      return
    }

    res.json({ subjects })
  } catch (error) {
    logger.error({ err: error }, 'Parse error:')
    res.status(500).json({ error: 'Failed to parse attendance data' })
  }
})

export default router
