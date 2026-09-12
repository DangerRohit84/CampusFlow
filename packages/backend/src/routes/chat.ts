import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import { aiQuota, noteAiUpstreamError } from '../middleware/aiQuota'
import { chatCompletion, isAiRateLimitError } from '../ai/client'
import { logger } from '../utils/logger'

const router = Router()
router.use(authenticate)

const messageSchema = z.object({
  content: z.string().min(1).max(8000),
})

const providerSchema = z.object({
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
}).optional()

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// ==================== SMART CONTEXT RETRIEVAL ====================

type Intent = 'schedule' | 'assignment' | 'grade' | 'attendance' | 'greeting' | 'general'

/**
 * Classify user intent from message using pure regex patterns (no API call).
 */
function classifyIntent(message: string): Intent {
  const lower = message.toLowerCase()

  // Greeting patterns
  if (/^(hi|hello|hey|howdy|good\s*(morning|afternoon|evening)|what'?s\s*up|sup|hola)\b/i.test(lower)) {
    return 'greeting'
  }

  // Schedule patterns
  if (/\b(today|class|schedule|timetable|period|lecture|what\s*do\s*i\s*have|free|break|next\s*class|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(lower)) {
    return 'schedule'
  }

  // Assignment patterns
  if (/\b(assignment|homework|due|deadline|submit|project|report|task|lab\s*report|essay|paper)\b/i.test(lower)) {
    return 'assignment'
  }

  // Grade patterns
  if (/\b(grade|gpa|cgpa|marks|score|result|performance|percentage|credit|semester)\b/i.test(lower)) {
    return 'grade'
  }

  // Attendance patterns
  if (/\b(attendance|present|absent|late|attendance\s*%|attend)\b/i.test(lower)) {
    return 'attendance'
  }

  return 'general'
}

// ==================== COMPRESSION HELPERS ====================

/**
 * Compress schedule data to minimal format.
 * Example: "09:30 SC @ BB-307, 10:30 OOAD @ BB-307"
 */
function compressSchedule(classes: any[]): string {
  if (!classes.length) return 'No classes'
  return classes.map(c => {
    const time = c.startTime || '??:??'
    const code = c.course || c.title || '?'
    const loc = c.location ? ` @ ${c.location}` : ''
    return `${time} ${code}${loc}`
  }).join(', ')
}

/**
 * Compress assignments data to minimal format.
 * Example: "🔴 ML Report due tomorrow, 🟡 SQL due in 3d"
 */
function compressAssignments(assignments: any[]): string {
  if (!assignments.length) return 'No pending assignments'
  const now = new Date()
  return assignments.map(a => {
    const due = new Date(a.dueDate)
    const daysLeft = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    const icon = daysLeft <= 1 ? '🔴' : daysLeft <= 3 ? '🟡' : '🟢'
    const code = a.title || '?'
    const dueText = daysLeft <= 0 ? 'overdue' : daysLeft === 1 ? 'tomorrow' : `in ${daysLeft}d`
    return `${icon} ${code} due ${dueText}`
  }).join(', ')
}

/**
 * Compress grades data to minimal format.
 * Example: "SC:A(9.0), OOAD:A-(8.5), CGPA:8.7"
 */
function compressGrades(grades: any[]): string {
  if (!grades.length) return 'No grades available'
  const gradeStrs = grades.slice(0, 8).map(g => {
    const code = (g as any).courseName ?? (g as any).course?.name ?? '?'
    return `${code}:${g.grade}(${g.gpa})`
  }).join(', ')
  const totalCredits = grades.reduce((sum: number, g: any) => sum + g.credits, 0)
  // topbottom F6b: zero-credit history (or empty) → NaN CGPA baked into the AI
  // prompt. Guard: report n/a instead of "NaN".
  if (totalCredits <= 0) return `${gradeStrs}, CGPA:n/a`
  const weightedGpa = grades.reduce((sum: number, g: any) => sum + g.gpa * g.credits, 0) / totalCredits
  return `${gradeStrs}, CGPA:${weightedGpa.toFixed(1)}`
}

/**
 * Compress attendance data to minimal format.
 * Example: "SC:92%, OOAD:85%"
 */


// ==================== SCOPED CONTEXT BUILDER ====================

/**
 * Build scoped context based on detected intent. Only fetches relevant data.
 */
async function buildScopedContext(userId: string, intent: Intent): Promise<string> {
  const now = new Date()
  const todayDayOfWeek = now.getDay()
  const todayStr = now.toISOString().split('T')[0]

  // Greeting needs no data
  if (intent === 'greeting') {
    return ''
  }

  // For general intent, return compact summary
  if (intent === 'general') {
    return buildCompactSummary(userId)
  }

  // Schedule: only today + next 3 days
  if (intent === 'schedule') {
    // HALF2: bound user-scoped scan (was unbounded; weekly timetable typically <50)
    const schedules = await prisma.schedule.findMany({
      where: { userId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      take: 50,
    })
    const todayClasses = schedules.filter(s => s.dayOfWeek === todayDayOfWeek)
    const nextDaysClasses = schedules.filter(s => s.dayOfWeek > todayDayOfWeek && s.dayOfWeek <= todayDayOfWeek + 3)
    const relevant = [...todayClasses, ...nextDaysClasses]
    return `SCHEDULE (${DAY_NAMES[todayDayOfWeek]}+3d): ${compressSchedule(relevant)}`
  }

  // Assignment: pending only, sorted by due date
  if (intent === 'assignment') {
    const assignments = await prisma.assignment.findMany({
      where: { userId, status: { not: 'COMPLETED' } },
      orderBy: { dueDate: 'asc' },
      take: 5
    })
    return `ASSIGNMENTS: ${compressAssignments(assignments)}`
  }

  // Grade: recent grades + CGPA summary
  if (intent === 'grade') {
    const _gr = await prisma.grade.findMany({
      where: { userId },
      include: { course: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10
    })
    const grades: any[] = _gr.map((g: any) => ({ ...g, courseName: g.course?.name ?? null }))
    return `GRADES: ${compressGrades(grades)}`
  }

  // Fallback
  return buildCompactSummary(userId)
}

/**
 * Build compact summary for general queries (1-line per category).
 */
async function buildCompactSummary(userId: string): Promise<string> {
  const now = new Date()
  const todayDayOfWeek = now.getDay()

  const [schedules, assignments, grades] = await Promise.all([
    // HALF2: bound user-scoped schedule scan (was unbounded; weekly typically <50)
    prisma.schedule.findMany({ where: { userId }, orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }], take: 50 }),
    prisma.assignment.findMany({ where: { userId, status: { not: 'COMPLETED' } }, orderBy: { dueDate: 'asc' }, take: 5 }),
    prisma.grade.findMany({ where: { userId }, include: { course: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 10 }),
  ])

  const parts: string[] = []
  const todayClasses = schedules.filter(s => s.dayOfWeek === todayDayOfWeek)
  parts.push(`Today: ${compressSchedule(todayClasses)}`)
  parts.push(`Assignments: ${compressAssignments(assignments)}`)
  if (grades.length) parts.push(`Grades: ${compressGrades(grades)}`)
  return parts.join(' | ')
}

/**
 * Fallback: Fetch ALL student data (legacy behavior).
 */
async function buildFullContext(userId: string): Promise<string> {
  const now = new Date()
  const todayDayOfWeek = now.getDay() // 0=Sun, 1=Mon, ...
  const todayStr = now.toISOString().split('T')[0]

  const [schedules, assignments, grades] = await Promise.all([
    // HALF2: bound user-scoped scans (were unbounded; weekly typically <50)
    prisma.schedule.findMany({ where: { userId }, orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }], take: 50 }),
    prisma.assignment.findMany({ where: { userId }, orderBy: { dueDate: 'asc' }, take: 10 }),
    prisma.grade.findMany({ where: { userId }, include: { course: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 20 }),
  ])

  const parts: string[] = []

  // Today's schedule
  const todayClasses = schedules.filter(s => s.dayOfWeek === todayDayOfWeek)
  if (todayClasses.length > 0) {
    parts.push(`TODAY'S SCHEDULE (${DAY_NAMES[todayDayOfWeek]}):`)
    todayClasses.forEach(s => {
      parts.push(`  • ${s.startTime}-${s.endTime} | ${s.title} (${s.course || ''}) @ ${s.location || 'TBD'} | Teacher: ${s.teacher || 'TBD'}`)
    })
  } else {
    parts.push(`TODAY (${DAY_NAMES[todayDayOfWeek]}): No classes scheduled`)
  }

  // Full weekly timetable summary
  if (schedules.length > 0) {
    parts.push('')
    parts.push('WEEKLY TIMETABLE:')
    const grouped: Record<number, typeof schedules> = {}
    schedules.forEach(s => { (grouped[s.dayOfWeek] = grouped[s.dayOfWeek] || []).push(s) })
    Object.entries(grouped).forEach(([day, slots]) => {
      parts.push(`  ${DAY_NAMES[Number(day)]}: ${slots.map(s => `${s.startTime}-${s.endTime} ${s.title}`).join(', ')}`)
    })
  }

  // Upcoming assignments
  const pendingAssignments = assignments.filter(a => a.status !== 'COMPLETED')
  if (pendingAssignments.length > 0) {
    parts.push('')
    parts.push('PENDING ASSIGNMENTS:')
    pendingAssignments.forEach(a => {
      const due = new Date(a.dueDate)
      const daysLeft = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      const urgency = daysLeft <= 1 ? '🔴 URGENT' : daysLeft <= 3 ? '🟡 SOON' : '🟢'
      parts.push(`  ${urgency} "${a.title}" — due ${due.toLocaleDateString()} (${daysLeft} days left) | Priority: ${a.priority} | Progress: ${a.progress}%`)
    })
  }

  // Recent grades
  if (grades.length > 0) {
    parts.push('')
    parts.push('RECENT GRADES:')
    grades.slice(0, 10).forEach(g => {
      parts.push(`  • ${(g as any).courseName ?? (g as any).course?.name ?? '?'}: ${g.grade} (GPA: ${g.gpa}) | Semester ${g.semester} | Credits: ${g.credits}`)
    })
    const totalCredits = grades.reduce((sum, g) => sum + g.credits, 0)
    const weightedGpa = grades.reduce((sum, g) => sum + g.gpa * g.credits, 0) / totalCredits
    parts.push(`  CGPA: ${weightedGpa.toFixed(2)} | Total Credits: ${totalCredits}`)
  }

  return parts.join('\n')
}

const SYSTEM_PROMPT = `You are CampusFlow, an AI campus assistant. You have access to SCOPED student data relevant to their question.

RULES:
- Use ONLY the data provided in context (it's scoped to their question).
- Be concise (2-4 sentences), friendly, actionable.
- Reference specific details from the data (times, grades, percentages).
- If data is missing, say what you can help with and suggest they check the relevant page.
- Never fabricate data.`

async function chatWithProvider(userId: string, userMessage: string): Promise<string> {
  try {
    const intent = classifyIntent(userMessage)
    const studentContext = await buildScopedContext(userId, intent)
    logger.info({ err: intent }, '[Chat] Intent:', '| Context length:', studentContext.length, 'chars for user:', userId)

    const fullPrompt = `${SYSTEM_PROMPT}

=== STUDENT DATA ===
${studentContext}
=== END STUDENT DATA ===

Student's question: ${userMessage}`

    return await chatCompletion('chat', [
      { role: 'user', content: fullPrompt },
    ], { temperature: 0.7, max_tokens: 1024 })
  } catch (error: any) {
    try { noteAiUpstreamError('chat', error) } catch {}
    logger.error({ err: error?.message || error }, 'AI provider error:')
    return getSmartResponse(userMessage)
  }
}

function getSmartResponse(query: string): string {
  const lower = query.toLowerCase()
  if (lower.includes('schedule') || lower.includes('class') || lower.includes('today')) {
    return "I can help with your schedule! Check the Schedule page for your full timetable, or ask me about specific classes."
  }
  if (lower.includes('assignment') || lower.includes('due')) {
    return "Check the Assignments page for all your deadlines. Want help prioritizing them?"
  }
  if (lower.includes('exam') || lower.includes('test')) {
    return "Your next exam schedule is available on the Dashboard. Want me to help you create a study plan?"
  }
  if (lower.includes('attendance')) {
    return "Check the Attendance page for your attendance tracking. Want tips on improving it?"
  }
  if (lower.includes('grade') || lower.includes('gpa')) {
    return "Visit the Grades page to see all your grades. Want help understanding your performance?"
  }
  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
    return "Hey! I'm your CampusFlow AI assistant. I can help with schedules, assignments, exams, grades, and more. What would you like to know?"
  }
  return "I can help you with your schedule, assignments, exams, grades, and attendance. Could you rephrase your question or let me know what you need?"
}

// Get all chat sessions
router.get('/sessions', async (req: AuthRequest, res: Response) => {
  try {
    // HALF2: bound user-scoped list (was unbounded; sessions per user typically <50)
    const sessions = await prisma.chatSession.findMany({
      where: { userId: req.userId },
      orderBy: { updatedAt: 'desc' },
      include: { messages: { take: 1, orderBy: { createdAt: 'desc' } } },
      take: 50,
    })
    res.json(sessions)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sessions' })
  }
})

// Create chat session
router.post('/sessions', async (req: AuthRequest, res: Response) => {
  try {
    const session = await prisma.chatSession.create({
      data: {
        userId: req.userId!,
        title: 'New Chat',
      },
    })
    res.status(201).json(session)
  } catch (error) {
    res.status(500).json({ error: 'Failed to create session' })
  }
})

// Get session messages — cursor pagination (take:50 max) + count.
// Uses (sessionId, createdAt) index. Dual-mode: no query → capped array
// (compat, oldest-first); ?cursor/?limit/?page → envelope with total+nextCursor.
router.get('/sessions/:sessionId/messages', async (req: AuthRequest, res: Response) => {
  try {
    const session = await prisma.chatSession.findFirst({
      where: { id: req.params.sessionId as string, userId: req.userId },
    })
    if (!session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    const wantsPaged = req.query.cursor != null || req.query.limit != null || req.query.page != null
    const limitParam = parseInt(String(req.query.limit || '50'), 10)
    const limit = Number.isFinite(limitParam) ? Math.min(50, Math.max(1, limitParam)) : 50
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
    const cursorId = req.query.cursor ? String(req.query.cursor) : null
    const where: any = { sessionId: req.params.sessionId as string }
    const cursorClause: any = cursorId ? { cursor: { id: cursorId }, skip: 1 } : { skip: (page - 1) * limit }
    const [messages, total] = await Promise.all([
      prisma.chatMessage.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit,
        ...cursorClause,
      }),
      wantsPaged ? prisma.chatMessage.count({ where }) : Promise.resolve(-1),
    ])
    res.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
    if (wantsPaged) {
      const pages = Math.ceil((total as number) / limit)
      const nextCursor = messages.length === limit ? (messages[messages.length - 1] as any)?.id ?? null : null
      res.json({ data: messages, pagination: { page, limit, total, pages, nextCursor } })
      return
    }
    res.json(messages)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch messages' })
  }
})

// Send message and get AI response
router.post('/sessions/:sessionId/messages', aiQuota('chat'), async (req: AuthRequest, res: Response) => {
  try {
    const body = messageSchema.parse(req.body)
    const session = await prisma.chatSession.findFirst({
      where: { id: req.params.sessionId as string, userId: req.userId },
    })
    if (!session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    const userMessage = await prisma.chatMessage.create({
      data: { sessionId: req.params.sessionId as string, role: 'USER', content: body.content },
    })

    // topbottom F6: the user turn is already persisted — an AI outage must NOT
    // 500 the request (client would lose the reference and duplicate on retry).
    // Return 502 WITH the saved userMessage so the client can render + retry
    // cleanly without resending.
    let aiResponse: string
    try {
      aiResponse = await chatWithProvider(req.userId!, body.content)
    } catch (aiError) {
      if (isAiRateLimitError(aiError)) {
        noteAiUpstreamError('chat', aiError)
        res.status(429).json({ userMessage, error: 'AI rate limit reached, try again shortly' })
        return
      }
      logger.error({ err: aiError }, 'Chat provider error (user turn saved):')
      res.status(502).json({ userMessage, error: 'AI unavailable right now — your message was saved, retry shortly' })
      return
    }

    const assistantMessage = await prisma.chatMessage.create({
      data: { sessionId: req.params.sessionId as string, role: 'ASSISTANT', content: aiResponse },
    })

    // topbottom F6: title/count bookkeeping must never 500 a fully-saved
    // exchange — best-effort.
    try {
      const msgCount = await prisma.chatMessage.count({ where: { sessionId: req.params.sessionId as string } })
      await prisma.chatSession.update({
        where: { id: req.params.sessionId as string },
        data: { updatedAt: new Date(), title: msgCount <= 2 ? body.content.slice(0, 50) : undefined },
      })
    } catch (metaError) {
      logger.debug({ err: metaError }, 'Chat session title update non-fatal')
    }

    res.json({ userMessage, assistantMessage })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors })
      return
    }
    if (isAiRateLimitError(error)) {
      noteAiUpstreamError('chat', error)
      res.status(429).json({ error: 'AI rate limit reached, try again shortly' })
      return
    }
    logger.error({ err: error }, 'Chat error:')
    res.status(500).json({ error: 'Failed to send message' })
  }
})

// Quick ask (no session needed)
router.post('/ask', aiQuota('chat'), async (req: AuthRequest, res: Response) => {
  try {
    const body = messageSchema.parse(req.body)
    const response = await chatWithProvider(req.userId!, body.content)
    res.json({ response })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors })
      return
    }
    if (isAiRateLimitError(error)) {
      noteAiUpstreamError('chat', error)
      res.status(429).json({ error: 'AI rate limit reached, try again shortly' })
      return
    }
    res.status(500).json({ error: 'Failed to get response' })
  }
})

// Summarize content
router.post('/summarize', aiQuota('chat'), async (req: AuthRequest, res: Response) => {
  try {
    const { content } = req.body
    if (!content) {
      res.status(400).json({ error: 'Content is required' })
      return
    }
    if (typeof content === 'string' && content.length > 8000) {
      res.status(413).json({ error: 'AI input too large (max 8000 chars)', max: 8000 })
      return
    }
    const summary = await chatWithProvider(req.userId!, `Summarize this in 3-5 bullet points:\n\n${content}`)
    res.json({ summary })
  } catch (error) {
    if (isAiRateLimitError(error)) {
      noteAiUpstreamError('chat', error)
      res.status(429).json({ error: 'AI rate limit reached, try again shortly' })
      return
    }
    res.status(500).json({ error: 'Failed to summarize' })
  }
})

export default router
