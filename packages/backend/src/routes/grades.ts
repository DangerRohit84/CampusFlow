import { Router, Response } from 'express'
import { authenticate, AuthRequest } from '../middleware/auth'
import prisma from '../config/db'
import { visionCompletion } from '../ai/client'
import { broadcastGradeMutation } from '../services/socket'

const router = Router()

// Get grade calculator data
router.get('/data', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const data = await prisma.gradeData.findUnique({ where: { studentId: req.userId! } })
    if (!data) return res.json({ subjects: [], scale: '10' })
    res.json({ subjects: JSON.parse(data.subjects || '[]'), scale: data.scale || '10' })
  } catch (error) {
    console.error('[Grades] Load error:', error)
    res.status(500).json({ error: 'Failed to fetch grade data' })
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
    try { broadcastGradeMutation({ userId: req.userId, action: 'saved' }) } catch {}
    res.json({ success: true })
  } catch (error) {
    console.error('[Grades] Save error:', error)
    res.status(500).json({ error: 'Failed to save grade data' })
  }
})

// Delete grade calculator data
router.delete('/data', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    await prisma.gradeData.deleteMany({ where: { studentId: req.userId! } })
    try { broadcastGradeMutation({ userId: req.userId, action: 'deleted' }) } catch {}
    res.json({ success: true })
  } catch (error) {
    console.error('[Grades] Delete error:', error)
    res.status(500).json({ error: 'Failed to delete grade data' })
  }
})

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
      console.error('[Grades Parse] Vision error:', err?.message || err)
      res.status(500).json({ error: 'AI vision failed' })
      return
    }

    let clean = response.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    if (clean.toLowerCase().startsWith('<think>')) {
      const firstBracket = clean.indexOf('[')
      if (firstBracket !== -1) clean = clean.substring(firstBracket).trim()
    }
    clean = clean.replace(/^```json?\n?/i, '').replace(/```$/gm, '').trim()
    console.log('[Grades Parse] Clean response:', clean.substring(0, 500))

    const jsonMatch = clean.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      console.error('[Grades Parse] No JSON array found. Raw response:', response?.substring(0, 500))
      res.status(422).json({ error: 'Could not parse grades from image', raw: response })
      return
    }

    let subjects
    try {
      subjects = JSON.parse(jsonMatch[0])
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
    console.error('[Grades] Parse error:', error)
    res.status(500).json({ error: 'Failed to parse grade image' })
  }
})

export default router
