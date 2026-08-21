import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth'
import { chatCompletion } from '../ai/client'

const router = Router()

router.post('/parse', authenticate, async (req: Request, res: Response) => {
  try {
    const { text } = req.body
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Text is required' })
      return
    }

    const prompt = `Parse the following attendance data extracted from a college portal screenshot.

Extract each subject with:
- name: subject name
- total: total classes held
- present: classes attended
- absent: classes missed

Return ONLY a valid JSON array. No markdown, no explanation, no code fences.

Example output:
[{"name": "Mathematics", "total": 40, "present": 35, "absent": 5}]

OCR text:
${text}`

    const result = await chatCompletion('attendance', [
      { role: 'user', content: prompt },
    ], { max_tokens: 2048 })

    let subjects
    try {
      const cleaned = result.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
      subjects = JSON.parse(cleaned)
    } catch {
      res.status(422).json({ error: 'Could not parse AI response', raw: result })
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
