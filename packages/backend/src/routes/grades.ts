import { Router, Response } from 'express'
import { authenticate, AuthRequest } from '../middleware/auth'
import prisma from '../config/db'
import { visionCompletion } from '../ai/client'
import { validateUploadMagicBytes } from '../utils/uploadScan'
import { broadcastGradeMutation } from '../services/socket'
import { logger } from '../utils/logger'
import {
  parseGradeSubjectsInput,
  buildGradeRows,
  resolveGradeSubjects,
  hasGradeRows,
  GRADE_CALCULATOR_SOURCE,
} from '../utils/gradeAttendance'

const router = Router()

// Order 11 (V-15 → P6/P9): Grade is the RECORD (not cache). Calculator
// scratchpad (GradeData blob) migrates here as rows with source=CALCULATOR.
// Expand-phase dual-write: writers fill BOTH blob + rows (rows best-effort so
// pre-migration DBs keep working); readers prefer rows with blob fallback.
// Blobs are NEVER dropped here (contract is a later order).

// Get grade calculator data
router.get('/data', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!
    // Read-new: calculator Grade rows first (best-effort for pre-migration DBs).
    let gradeRows: Array<{ subject: string | null; subjectCode: string | null; credits: number; grade: string }> | null = null
    try {
      const rows = await (prisma as any).grade.findMany({
        where: { userId, source: GRADE_CALCULATOR_SOURCE },
        orderBy: { subject: 'asc' },
        take: 50,
      })
      if (Array.isArray(rows) && rows.length > 0) gradeRows = rows
    } catch {
      gradeRows = null
    }
    const data = await prisma.gradeData.findUnique({ where: { studentId: req.userId! } })
    // CACHE-ALL: own grade data — private edge SWR (user edits invalidate client-side).
    res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60')
    const scale = (data as any)?.scale || '10'
    if (gradeRows && hasGradeRows({ gradeRows })) {
      const subjects = resolveGradeSubjects({ subjects: (data as any)?.subjects, gradeRows: gradeRows as any })
      res.json({ subjects, scale, source: 'record' })
      return
    }
    if (!data) return res.json({ subjects: [], scale: '10', source: 'blob' })
    const subjects = resolveGradeSubjects({ subjects: (data as any).subjects, gradeRows: null })
    res.json({ subjects, scale, source: 'blob' })
  } catch (error) {
    logger.error({ err: error }, '[Grades] Load error:')
    res.status(500).json({ error: 'Failed to fetch grade data' })
  }
})

// List calculator Grade record rows (raw record view; intentionally uncached
// analytics like tasks daily-summary — always fresh, no private CC).
router.get('/records', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!
    let rows: unknown[] = []
    try {
      rows = await (prisma as any).grade.findMany({
        where: { userId, source: GRADE_CALCULATOR_SOURCE },
        orderBy: { subject: 'asc' },
        take: 50,
      })
    } catch {
      rows = []
    }
    res.json({ records: rows, source: rows.length > 0 ? 'record' : 'blob' })
  } catch (error) {
    logger.error({ err: error }, '[Grades] Records error:')
    res.status(500).json({ error: 'Failed to fetch grade records' })
  }
})

// Save grade calculator data
router.post('/data', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { subjects, scale } = req.body
    const data = await prisma.gradeData.upsert({
      where: { studentId: req.userId! },
      update: { subjects: JSON.stringify(subjects || []), scale: scale || '10' },
      create: { studentId: req.userId!, subjects: JSON.stringify(subjects || []), scale: scale || '10' },
    })
    // Order 11 dual-write non-fatal: mirror blob subjects into Grade rows
    // (source=CALCULATOR, replace-all scoped so MANUAL transcript rows survive).
    try {
      const parsed = parseGradeSubjectsInput(subjects)
      const rows = buildGradeRows(parsed, scale || (data as any)?.scale || '10')
      await (prisma as any).grade.deleteMany({ where: { userId: req.userId!, source: GRADE_CALCULATOR_SOURCE } })
      if (rows.length > 0) {
        await (prisma as any).grade.createMany({
          data: rows.map((r) => ({
            userId: req.userId!,
            courseId: null,
            subject: r.subject,
            subjectCode: r.subjectCode,
            source: GRADE_CALCULATOR_SOURCE,
            semester: r.semester,
            credits: r.credits,
            grade: r.grade,
            gpa: r.gpa,
          })),
        })
      }
    } catch (e) {
      logger.warn({ err: e }, '[Grades] Record dual-write skipped (pre-migration DB?)')
    }
    try { broadcastGradeMutation({ userId: req.userId, action: 'saved' }) } catch {}
    res.json({ success: true })
  } catch (error) {
    logger.error({ err: error }, '[Grades] Save error:')
    res.status(500).json({ error: 'Failed to save grade data' })
  }
})

// Delete grade calculator data
router.delete('/data', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    await prisma.gradeData.deleteMany({ where: { studentId: req.userId! } })
    // Order 11 dual-write non-fatal: clear calculator rows (MANUAL rows survive).
    try {
      await (prisma as any).grade.deleteMany({ where: { userId: req.userId!, source: GRADE_CALCULATOR_SOURCE } })
    } catch (e) {
      logger.warn({ err: e }, '[Grades] Record delete skipped (pre-migration DB?)')
    }
    try { broadcastGradeMutation({ userId: req.userId, action: 'deleted' }) } catch {}
    res.json({ success: true })
  } catch (error) {
    logger.error({ err: error }, '[Grades] Delete error:')
    res.status(500).json({ error: 'Failed to delete grade data' })
  }
})

// Upload-audit-all normalizer (backend half, mirrors timetable's
// normalizeParsedClasses). WHY: vision LLMs drift keys (title/course vs
// name, courseCode vs code, credit vs credits, score vs grade, numeric
// grades vs letters). The old gate returned raw AI JSON, so drift surfaced
// as 422 "Could not parse grades" after vision already succeeded.
// Normalize BEFORE res.json; shape { subjects } stays stable.
const GRADE_KEYS = ['name', 'title', 'course', 'subject', 'code', 'coursecode', 'credits', 'credit', 'grade', 'score', 'mark'] as const

function hasGradeKeys(s: any): boolean {
  if (!s || typeof s !== 'object') return false
  const keys = new Set(Object.keys(s).map((k) => String(k).toLowerCase()))
  return (GRADE_KEYS as readonly string[]).some((k) => keys.has(k))
}

export function normalizeGradeSubjects(input: unknown): Array<{ name: string; code: string; credits: number; grade: string }> {
  if (!Array.isArray(input)) return []
  return input
    .filter(hasGradeKeys)
    .map((s: any) => {
      const creditsRaw = s.credits ?? s.credit
      const creditsNum = typeof creditsRaw === 'number' ? creditsRaw : parseInt(String(creditsRaw ?? '').trim(), 10)
      return {
        name: String(s.name ?? s.title ?? s.course ?? s.subject ?? '').trim(),
        code: String(s.code ?? s.courseCode ?? '').trim(),
        credits: Number.isFinite(creditsNum) && creditsNum >= 0 ? Math.floor(creditsNum) : 0,
        grade: String(s.grade ?? s.score ?? s.mark ?? '').trim(),
      }
    })
    .filter((s) => s.name.length > 0)
}

// Parse grade image with AI vision
router.post('/parse', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { image } = req.body
    if (!image || typeof image !== 'string') {
      res.status(400).json({ error: 'Image base64 is required' })
      return
    }

    const mimeType = image.match(/^data:([^;]+)/)?.[1] || 'image/png'
    const base64 = image.includes(',') ? image.split(',')[1] : image

    // Upload-audit-all: JSON-base64 images previously skipped the shared
    // magic-byte gate (spoofed data-URLs reached AI vision). Decode +
    // verify via 'rooms' surface (image magics) before vision.
    let imageBuffer: Buffer | null = null
    try {
      imageBuffer = Buffer.from(base64, 'base64')
    } catch {
      imageBuffer = null
    }
    if (!imageBuffer || imageBuffer.length === 0) {
      res.status(400).json({ error: 'Invalid image data' })
      return
    }
    try {
      const extHint = mimeType === 'image/jpeg' ? 'photo.jpg' : mimeType === 'image/webp' ? 'photo.webp' : mimeType === 'image/gif' ? 'photo.gif' : 'photo.png'
      const magicErr = await validateUploadMagicBytes(imageBuffer, extHint, mimeType, 'rooms')
      if (magicErr) {
        logger.warn({ requestId: (req as any).requestId, reason: magicErr }, '[Grades Parse] upload blocked (magic-byte)')
        res.status(400).json({ error: 'Invalid image file' })
        return
      }
    } catch (e: any) {
      logger.warn({ requestId: (req as any).requestId, err: String(e?.message || e).slice(0, 200) }, '[Grades Parse] validation error')
      res.status(400).json({ error: 'Invalid image file' })
      return
    }

    const prompt = `This is a grade report or transcript image. Extract ALL courses visible in the image.

For each course, return:
- name: the full course name exactly as written
- code: the course code if visible (e.g. "CS101"), empty string if not visible
- credits: the credit value as a number (e.g. 3 or 4)
- grade: the letter grade (O, A+, A, A-, B+, B, B-, C+, C, C-, D, P, F)

RULES:
- Extract ALL courses, even if grade is missing
- Return ONLY a valid JSON array. No markdown, no code fences, no explanation.
- Each object: {"name": "Course Name", "code": "CS101", "credits": 3, "grade": "A"}

Return ONLY the JSON array:`

    let response = ''
    try {
      response = await visionCompletion('grades', [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
        ],
      }], { temperature: 0.1, max_tokens: 4096 })
    } catch (err: any) {
      logger.error({ err: err?.message || err }, '[Grades Parse] Vision error:')
      res.status(500).json({ error: 'AI vision failed' })
      return
    }

    let clean = response.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    if (clean.toLowerCase().startsWith('<think>')) {
      const firstBracket = clean.indexOf('[')
      if (firstBracket !== -1) clean = clean.substring(firstBracket).trim()
    }
    clean = clean.replace(/^```json?\n?/i, '').replace(/```$/gm, '').trim()
    logger.info({ err: clean.substring(0, 500) }, '[Grades Parse] Clean response:')

    const jsonMatch = clean.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      logger.error({ err: response?.substring(0, 500) }, '[Grades Parse] No JSON array found. Raw response:')
      res.status(422).json({ error: 'Could not parse grades from image', raw: response })
      return
    }

    let subjects
    try {
      // Drift-tolerant: direct array OR embedded [...] substring, then
      // coerce drifted keys (title/courseCode/score) to the stable shape.
      let raw: unknown = null
      try {
        raw = JSON.parse(clean)
      } catch {
        const m2 = clean.match(/\[[\s\S]*\]/)
        if (m2) raw = JSON.parse(m2[0])
        else throw new Error('no-json')
      }
      subjects = normalizeGradeSubjects(raw)
      if (subjects.length === 0) {
        logger.error({ err: response?.substring(0, 500) }, '[Grades Parse] No grade rows after normalize. Raw response:')
        res.status(422).json({ error: 'Could not parse grades from image', raw: response })
        return
      }
    } catch {
      res.status(422).json({ error: 'Could not parse AI response', raw: response })
      return
    }

    res.json({ subjects })
  } catch (error) {
    logger.error({ err: error }, '[Grades] Parse error:')
    res.status(500).json({ error: 'Failed to parse grade image' })
  }
})

export default router
