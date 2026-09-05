import { Router, Request, Response } from 'express'
import { authenticate, AuthRequest } from '../middleware/auth'
import { visionCompletion } from '../ai/client'
import prisma from '../config/db'
import { broadcastAttendanceMutation } from '../services/socket'

const router = Router()

// GET /api/attendance/data — load saved attendance
router.get('/data', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!
    const record = await prisma.attendanceData.findUnique({
      where: { studentId: userId },
    })
    if (!record) {
      res.json({ subjects: [], requiredPct: 75 })
      return
    }
    res.json({
      subjects: JSON.parse(record.subjects),
      requiredPct: record.requiredPct,
    })
  } catch (error) {
    console.error('[Attendance] Load error:', error)
    res.status(500).json({ error: 'Failed to load attendance data' })
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
    try { broadcastAttendanceMutation({ userId, action: 'saved' }) } catch {}
    res.json({ saved: true, id: record.id })
  } catch (error) {
    console.error('[Attendance] Save error:', error)
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
    try { broadcastAttendanceMutation({ userId, action: 'deleted' }) } catch {}
    res.json({ deleted: true })
  } catch (error) {
    console.error('[Attendance] Delete error:', error)
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
      console.error('[Attendance Parse] Vision error:', err?.message || err)
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
    console.error('Parse error:', error)
    res.status(500).json({ error: 'Failed to parse attendance data' })
  }
})

export default router
