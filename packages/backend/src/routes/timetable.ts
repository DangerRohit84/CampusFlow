import { Router, Response } from 'express'
import { chatCompletion, visionCompletion, ChatMessage } from '../ai/client'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import { config } from '../config'
import multer from 'multer'
import { getDayOfWeek } from '../utils/dateUtils'

const router = Router()
router.use(authenticate)

const storage = multer.memoryStorage()
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff', 'image/heic']
    if (allowed.includes(file.mimetype) || file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Only image files allowed (JPG, PNG, WebP, etc.)'))
  },
})

// AI Manager handles provider resolution
async function parseWithAI(prompt: string): Promise<string> {
  try {
    return await chatCompletion('timetable', [
      { role: 'user', content: prompt },
    ], { temperature: 0.1, max_tokens: 2048 })
  } catch (err) {
    console.error('AI timetable parse error:', err)
    return '[]'
  }
}

const dayMap: Record<string, number> = {
  'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3, 'friday': 4, 'saturday': 5, 'sunday': 6,
  'mon': 0, 'tue': 1, 'wed': 2, 'thu': 3, 'fri': 4, 'sat': 5, 'sun': 6,
  'm': 0, 't': 1, 'w': 2, 'th': 3, 'f': 4, 'sa': 5, 's': 6,
}

function parseLocalTimetable(text: string): any[] {
  const classes: any[] = []
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  let currentDay: number | null = null

  for (const line of lines) {
    const lower = line.toLowerCase().replace(/[^a-z0-9\s]/g, '')

    // Check if this line is a day header
    for (const [key, val] of Object.entries(dayMap)) {
      if (lower.startsWith(key) && lower.length < 20) {
        currentDay = val
        break
      }
    }
    if (currentDay !== null) {
      // Try to extract time and subject from this line
      const timeMatch = line.match(/(\d{1,2})[:.]?(\d{2})?\s*[-–to]+\s*(\d{1,2})[:.]?(\d{2})?/i)
      if (timeMatch) {
        const startH = parseInt(timeMatch[1])
        const startM = parseInt(timeMatch[2] || '0')
        const endH = parseInt(timeMatch[3])
        const endM = parseInt(timeMatch[4] || '0')
        const startTime = `${startH.toString().padStart(2, '0')}:${startM.toString().padStart(2, '0')}`
        const endTime = `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`

        // Everything after the time is the subject/location/teacher
        const afterTime = line.substring(line.indexOf(timeMatch[0]) + timeMatch[0].length).trim()
        const parts = afterTime.split(/[-–|/,]+/).map((p) => p.trim()).filter(Boolean)
        const title = parts[0] || 'Untitled'
        const location = parts.length >= 2 ? parts[1] : ''
        const teacher = parts.length >= 3 ? parts.slice(2).join(', ') : ''

        classes.push({ title, course: '', location, teacher: teacher || null, dayOfWeek: currentDay, startTime, endTime, type: line.toLowerCase().includes('lab') ? 'LAB' : 'CLASS' })
      }
    }
  }
  return classes
}

// Upload timetable image and AI extract classes
router.post('/upload', upload.single('timetable'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No image uploaded' })
      return
    }

    // Get provider config from frontend
    let provider: { baseUrl?: string; apiKey?: string; model?: string } | undefined
    try { provider = JSON.parse(req.body.provider || '{}') } catch {}

    const base64 = req.file.buffer.toString('base64')
    const mimeType = req.file.mimetype
    console.log(`[Timetable Upload] File: ${req.file.originalname}, Size: ${req.file.size}, MIME: ${mimeType}, Provider: ${provider?.model || 'groq-vision'}`)

    const prompt = `Extract ALL classes from this timetable image. Return ONLY a valid JSON array.

For each class:
{"title":"name","course":"code","location":"room","teacher":"professor name","dayOfWeek":0,"startTime":"HH:MM","endTime":"HH:MM","type":"CLASS"}

dayOfWeek: Monday=0, Tuesday=1, Wednesday=2, Thursday=3, Friday=4, Saturday=5, Sunday=6
type: CLASS or LAB

Return ONLY the JSON array:`

    let response = '[]'

    // Use AI Manager routing (timetable feature) for vision
    try {
      console.log('[Timetable Upload] Using AI Manager vision routing')
      response = await visionCompletion('timetable', [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
        ],
      }], { temperature: 0.1, max_tokens: 16384 })
      console.log('[Timetable Upload] AI Manager vision responded, length:', response.length)
    } catch (err: any) {
      console.error('[Timetable Upload] AI Manager vision error:', err?.message)
    }

    // Strip <think>...</think> tags from thinking models (handles closed, unclosed, and embedded JSON)
    let cleanResponse = response
    // Remove closed think blocks
    cleanResponse = cleanResponse.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    // If response still starts with <think> (unclosed), find first [ after it
    if (cleanResponse.toLowerCase().startsWith('<think>')) {
      const firstBracket = cleanResponse.indexOf('[')
      if (firstBracket !== -1) {
        cleanResponse = cleanResponse.substring(firstBracket).trim()
      } else {
        // No JSON found after unclosed think — try raw response
        const rawBracket = response.indexOf('[')
        if (rawBracket !== -1) cleanResponse = response.substring(rawBracket).trim()
      }
    }
    // Strip markdown code fences
    cleanResponse = cleanResponse.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()
    console.log('[Timetable Upload] Cleaned response (first 300):', cleanResponse.substring(0, 300))

    let classes: any[] = []
    try {
      // Debug: log first few char codes
      if (cleanResponse.length > 0) {
        const codes = Array.from(cleanResponse.substring(0, 10)).map(c => c.charCodeAt(0))
        console.log('[Timetable Upload] First 10 char codes:', codes.join(','), 'total len:', cleanResponse.length, 'ends:', cleanResponse.substring(cleanResponse.length - 20))
      }

      // Try cleaned response first, then full response
      for (const src of [cleanResponse, response]) {
        if (classes.length > 0) break

        // Try direct parse first
        try {
          classes = JSON.parse(src)
          if (Array.isArray(classes) && classes.length > 0 && classes[0].title) {
            console.log('[Timetable Upload] Direct parse OK, count:', classes.length)
            break
          }
          classes = []
        } catch (directErr: any) {
          console.log('[Timetable Upload] Direct parse failed:', directErr.message?.substring(0, 100))
        }

        // Try extracting JSON array substring
        const firstBracket = src.indexOf('[')
        const lastBracket = src.lastIndexOf(']')
        console.log('[Timetable Upload] Bracket search: first=[', firstBracket, 'last=]', lastBracket, 'srcLen:', src.length)
        if (firstBracket !== -1 && lastBracket > firstBracket) {
          const jsonStr = src.substring(firstBracket, lastBracket + 1)
          try {
            classes = JSON.parse(jsonStr)
            if (Array.isArray(classes) && classes.length > 0 && classes[0].title) break
            classes = []
          } catch (extractErr: any) {
            console.log('[Timetable Upload] Extract parse failed:', extractErr.message?.substring(0, 100))
          }
        }
      }
      console.log('[Timetable Upload] Final parsed', classes.length, 'classes')
    } catch (e: any) {
      console.error('[Timetable Upload] Outer error:', e.message)
    }

    res.json({
      classes,
      message: classes.length > 0
        ? `Found ${classes.length} classes. Review and confirm to save.`
        : 'Could not extract from image. Make sure your AI provider supports vision (OpenAI, Gemini), or paste your timetable as text instead.',
    })
  } catch (error) {
    console.error('Timetable upload error:', error)
    res.status(500).json({ error: 'Failed to process timetable' })
  }
})

// Parse timetable from text
router.post('/parse-text', async (req: AuthRequest, res: Response) => {
  try {
    const { text } = req.body
    if (!text) {
      res.status(400).json({ error: 'Text required' })
      return
    }

    // Try local parser first (always works, no API key needed)
    let classes = parseLocalTimetable(text)

      // If local parser found nothing, try AI Manager routing
      if (classes.length === 0) {
        const prompt = `Parse this timetable text. Extract every class. Return ONLY a valid JSON array.

Text:
${text}

For each class:
{"title":"name","course":"code","location":"room","teacher":"professor name","dayOfWeek":0,"startTime":"HH:MM","endTime":"HH:MM","type":"CLASS"}

dayOfWeek: Monday=0, Tuesday=1, Wednesday=2, Thursday=3, Friday=4, Saturday=5, Sunday=6
type: CLASS or LAB
teacher: professor/instructor name (empty string if not present)

Return ONLY the JSON array:`

        const response = await parseWithAI(prompt)
      try {
        const jsonMatch = response.match(/\[[\s\S]*\]/)
        if (jsonMatch) classes = JSON.parse(jsonMatch[0])
      } catch {}
    }

    res.json({
      classes,
      message: classes.length > 0
        ? `Found ${classes.length} classes. Review and confirm to save.`
        : 'Could not parse timetable. Try a different format.',
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to parse timetable' })
  }
})

// Save parsed classes to database
router.post('/save', async (req: AuthRequest, res: Response) => {
  try {
    const { classes } = req.body
    if (!classes || !Array.isArray(classes)) {
      res.status(400).json({ error: 'Classes array required' })
      return
    }

    // Optionally clear existing schedules
    const { clearExisting } = req.body
    if (clearExisting) {
      await prisma.schedule.deleteMany({ where: { userId: req.userId } })
    }

    const colors = ['#5c7cfa', '#845ef7', '#20c997', '#fcc419', '#f06595', '#7950f2', '#22b8cf', '#ff6b6b']
    const saved = []

    for (let i = 0; i < classes.length; i++) {
      const c = classes[i]
      const schedule = await prisma.schedule.create({
        data: {
          userId: req.userId!,
          title: c.title || 'Untitled',
          course: c.course || '',
          location: c.location || '',
          teacher: c.teacher || null,
          dayOfWeek: c.dayOfWeek ?? 0,
          startTime: c.startTime || '09:00',
          endTime: c.endTime || '10:00',
          type: c.type || 'CLASS',
          color: c.color || colors[i % colors.length],
          recurring: true,
        },
      })
      saved.push(schedule)
    }

    res.json({ saved: saved.length, schedules: saved })
  } catch (error) {
    console.error('Save timetable error:', error)
    res.status(500).json({ error: 'Failed to save timetable' })
  }
})

// Get today's classes
router.get('/today', async (req: AuthRequest, res: Response) => {
  try {
    const dayOfWeek = getDayOfWeek()

    const classes = await prisma.schedule.findMany({
      where: { userId: req.userId, dayOfWeek },
      orderBy: { startTime: 'asc' },
    })

    res.json(classes)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch today classes' })
  }
})

// Get full timetable
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const schedules = await prisma.schedule.findMany({
      where: { userId: req.userId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    })
    res.json(schedules)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch timetable' })
  }
})

// Delete all classes
router.delete('/clear', async (req: AuthRequest, res: Response) => {
  try {
    await prisma.schedule.deleteMany({ where: { userId: req.userId } })
    res.json({ message: 'Timetable cleared' })
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear timetable' })
  }
})

export default router