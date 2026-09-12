import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import { PriorityEnum, combineDateAndTime, coerceDeadline } from '../lib/validators'
import { tryToTaskStatusEnum } from '../lib/enums'
import { isPrismaNotFound } from '../lib/prismaErrors'
import { aiQuota, noteAiUpstreamError } from '../middleware/aiQuota'
import { isAiRateLimitError } from '../ai/client'
import { chatWithAI } from '../ai/groq'
// chatWithAI now uses AI Manager routing (feature: 'chat')
import { getDayOfWeek } from '../utils/dateUtils'
import { broadcastTaskMutation } from '../services/socket'

const router = Router()
router.use(authenticate)

const taskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  date: z.string(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  duration: z.number().optional(),
  category: z.string().default('personal'),
  priority: PriorityEnum.default('MEDIUM'),
  color: z.string().optional(),
  isClass: z.boolean().default(false),
  courseId: z.string().optional(),
  location: z.string().optional(),
  recurrence: z.string().optional(),
})

// Get all tasks
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { date, category, status } = req.query
    const where: any = { userId: req.userId }
    if (date) {
      const d = new Date(date as string)
      const nextDay = new Date(d)
      nextDay.setDate(nextDay.getDate() + 1)
      where.date = { gte: d, lt: nextDay }
    }
    if (category) where.category = category
    // Order 4: Task.status is the native TaskStatus enum (UPPERCASE).
    // Normalize case-insensitively at the Prisma boundary; unknown values
    // are ignored (no filter) so a ghost never 500s via Prisma validation.
    if (status) {
      const normalized = tryToTaskStatusEnum(status)
      if (normalized) where.status = normalized
    }

    const tasks = await prisma.task.findMany({
      where,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    })
    // CACHE-ALL: own task list — private edge SWR (codingProfile.ts:333 pattern).
    res.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
    res.json(tasks)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tasks' })
  }
})

// Get tasks for a date range (week view)
router.get('/range', async (req: AuthRequest, res: Response) => {
  try {
    const { start, end } = req.query
    if (!start || !end) {
      res.status(400).json({ error: 'Start and end dates required' })
      return
    }
    const tasks = await prisma.task.findMany({
      where: {
        userId: req.userId,
        date: { gte: new Date(start as string), lte: new Date(end as string) },
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    })
    // CACHE-ALL: own range slice — private edge SWR.
    res.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
    res.json(tasks)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tasks' })
  }
})

// Get today's tasks
router.get('/today', async (req: AuthRequest, res: Response) => {
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const tasks = await prisma.task.findMany({
      where: {
        userId: req.userId,
        date: { gte: today, lt: tomorrow },
      },
      orderBy: [{ startTime: 'asc' }, { createdAt: 'asc' }],
    })
    // CACHE-ALL: own today slice — private edge SWR.
    res.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
    res.json(tasks)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch today tasks' })
  }
})

// Create task
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const body = taskSchema.parse(req.body)
    // topbottom F3: z.string() accepts garbage dates; Invalid Date must 400,
    // not ride into Prisma and 500.
    if (!coerceDeadline((body as any).date)) {
      res.status(400).json({ error: 'Invalid date. Must be a parseable date string' })
      return
    }
    // Order-1 FK: Task.courseId → Course(id) ON DELETE SET NULL (nullable).
    // Validate when provided so FK violations surface as 400, not 500/P2003.
    if ((body as any).courseId) {
      const course = await prisma.course.findUnique({ where: { id: (body as any).courseId }, select: { id: true } })
      if (!course) {
        res.status(400).json({ error: 'Invalid courseId: course not found' })
        return
      }
    }
    // Order 8 dual-write: date+String times → absolute startAt/endAt range.
    const _d = new Date((body as any).date)
    const _sAt = combineDateAndTime(_d, (body as any).startTime)
    const _eAt = combineDateAndTime(_d, (body as any).endTime)
    const task = await prisma.task.create({
      data: { ...body, userId: req.userId!, date: new Date(body.date), ...(_sAt ? { startAt: _sAt } : {}), ...(_eAt ? { endAt: _eAt } : {}) } as any,
    })
    try { broadcastTaskMutation({ action: 'task:created', taskId: task.id, userId: req.userId }) } catch {}
    res.status(201).json(task)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors })
      return
    }
    if ((error as any)?.code === 'P2003') {
      res.status(400).json({ error: 'Invalid courseId: course not found' })
      return
    }
    res.status(500).json({ error: 'Failed to create task' })
  }
})

// Update task
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const body = taskSchema.partial().parse(req.body)
    // topbottom F3: same date-validity guard as create (Invalid Date → 400).
    if (body.date !== undefined && !coerceDeadline(body.date as any)) {
      res.status(400).json({ error: 'Invalid date. Must be a parseable date string' })
      return
    }
    if ((body as any).courseId) {
      const course = await prisma.course.findUnique({ where: { id: (body as any).courseId }, select: { id: true } })
      if (!course) {
        res.status(400).json({ error: 'Invalid courseId: course not found' })
        return
      }
    }
    // Order 8 dual-write on update (recompute range when date present; else keep old range).
    const _ud: any = { ...body, date: body.date ? new Date(body.date as any) : undefined }
    try {
      if (body.date) {
        const _bd = new Date(body.date as any)
        if (!Number.isNaN(_bd.getTime())) {
          if ((body as any).startTime !== undefined) _ud.startAt = combineDateAndTime(_bd, (body as any).startTime)
          if ((body as any).endTime !== undefined) _ud.endAt = combineDateAndTime(_bd, (body as any).endTime)
        }
      }
    } catch {}
    try {
      const _base = body.date ? new Date(body.date as any) : undefined
      if (_base && ((body as any).startTime !== undefined || (body as any).endTime !== undefined || body.date !== undefined)) {
        // Need existing row for missing half — fetch is cheap (single row); fallback keeps old range on failure.
      }
    } catch {}
    const task = await prisma.task.update({
      where: { id: req.params.id as string, userId: req.userId },
      data: _ud as any,
    })
    try { broadcastTaskMutation({ action: 'task:updated', taskId: task.id, userId: req.userId }) } catch {}
    res.json(task)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors })
      return
    }
    if ((error as any)?.code === 'P2003') {
      res.status(400).json({ error: 'Invalid courseId: course not found' })
      return
    }
    // topbottom F4: scoped update on missing/not-owned row (P2025) is 404, not 500.
    if (isPrismaNotFound(error)) {
      res.status(404).json({ error: 'Task not found' })
      return
    }
    res.status(500).json({ error: 'Failed to update task' })
  }
})

// Toggle task complete
router.put('/:id/toggle', async (req: AuthRequest, res: Response) => {
  try {
    const task = await prisma.task.findFirst({ where: { id: req.params.id as string, userId: req.userId } })
    if (!task) { res.status(404).json({ error: 'Not found' }); return }

    const updated = await prisma.task.update({
      where: { id: req.params.id as string },
      data: { completed: !task.completed, status: task.completed ? 'PENDING' : 'COMPLETED' },
    })
    try { broadcastTaskMutation({ action: 'task:toggled', taskId: updated.id, userId: req.userId }) } catch {}
    res.json(updated)
  } catch (error) {
    // topbottom F4: lost-race delete between findFirst + update (P2025) is 404.
    if (isPrismaNotFound(error)) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    res.status(500).json({ error: 'Failed to toggle task' })
  }
})

// Delete task
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await prisma.task.delete({ where: { id: req.params.id as string, userId: req.userId } })
    try { broadcastTaskMutation({ action: 'task:deleted', taskId: req.params.id as string, userId: req.userId }) } catch {}
    res.json({ message: 'Task deleted' })
  } catch (error) {
    // topbottom F4: missing/not-owned row (P2025) is 404, not 500.
    if (isPrismaNotFound(error)) {
      res.status(404).json({ error: 'Task not found' })
      return
    }
    res.status(500).json({ error: 'Failed to delete task' })
  }
})

// AI: Auto-schedule tasks into free time slots
router.post('/ai-schedule', aiQuota('tasks-ai'), async (req: AuthRequest, res: Response) => {
  try {
    const { tasks: taskDescriptions, date } = req.body
    if (!taskDescriptions || !date) {
      res.status(400).json({ error: 'Tasks and date required' })
      return
    }
    // topbottom F13: .join() on a non-array TypeErrors → 500; guard first.
    if (!Array.isArray(taskDescriptions) || taskDescriptions.length === 0) {
      res.status(400).json({ error: 'Tasks must be a non-empty array of descriptions' })
      return
    }
    // topbottom F13: invalid date → NaN weekday → Prisma rejects → 500.
    const _schedDate = coerceDeadline(date)
    if (!_schedDate) {
      res.status(400).json({ error: 'Invalid date. Must be a parseable date string' })
      return
    }
    if (JSON.stringify(taskDescriptions).length > 8000) {
      res.status(413).json({ error: 'AI input too large (max 8000 chars)', max: 8000 })
      return
    }

    // Get existing classes for that day
    const d = new Date(date)
    const dayOfWeek = getDayOfWeek(d)
    // HALF2: parallel independent reads (was 2 sequential awaits)
    const [classes, existingTasks] = await Promise.all([
      prisma.schedule.findMany({
        where: { userId: req.userId, dayOfWeek },
        orderBy: { startTime: 'asc' },
      }),
      prisma.task.findMany({
        where: {
          userId: req.userId,
          date: { gte: new Date(date), lt: new Date(new Date(date).getTime() + 86400000) },
        },
      }),
    ])

    const classInfo = classes.map((c) => `${c.startTime}-${c.endTime} ${c.title} at ${c.location}`).join(', ')
    const existingInfo = existingTasks.map((t) => `${t.startTime || 'flex'}-${t.endTime || 'flex'} ${t.title}`).join(', ')

    const prompt = `You are a smart scheduling assistant. Help organize these tasks into today's free time slots.

Today's classes: ${classInfo || 'None'}
Already scheduled: ${existingInfo || 'None'}
Tasks to schedule: ${taskDescriptions.join(', ')}
Day: ${d.toLocaleDateString('en-US', { weekday: 'long' })}

Available time slots: 8:00 AM - 8:00 PM (excluding class times)

For each task, suggest:
1. A specific time slot (start-end)
2. Duration in minutes
3. Priority order
4. Brief reasoning

Format as JSON array: [{"task": "name", "startTime": "HH:MM", "endTime": "HH:MM", "duration": 30, "reason": "why this slot"}]
Return ONLY the JSON array, no other text.`

    const response = await chatWithAI(prompt)
    
    // Try to parse JSON from response
    let schedule
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/)
      schedule = jsonMatch ? JSON.parse(jsonMatch[0]) : []
    } catch {
      schedule = []
    }

    res.json({ schedule, rawResponse: response })
  } catch (error) {
    if (isAiRateLimitError(error)) {
      noteAiUpstreamError('tasks-ai', error)
      res.status(429).json({ error: 'AI rate limit reached, try again shortly' })
      return
    }
    res.status(500).json({ error: 'Failed to generate schedule' })
  }
})

// AI: Get daily summary
router.get('/daily-summary', aiQuota('tasks-ai'), async (req: AuthRequest, res: Response) => {
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const [tasks, classes] = await Promise.all([
      prisma.task.findMany({ where: { userId: req.userId, date: { gte: today, lt: tomorrow } }, orderBy: { startTime: 'asc' } }),
      prisma.schedule.findMany({ where: { userId: req.userId, dayOfWeek: getDayOfWeek() } }),
    ])

    const totalTasks = tasks.length
    const completedTasks = tasks.filter((t) => t.completed).length
    const totalClasses = classes.length
    const pendingTasks = tasks.filter((t) => !t.completed).length

    const prompt = `Create a brief, encouraging daily summary for a student.

Today's classes: ${classes.map((c) => `${c.title} at ${c.startTime}`).join(', ') || 'No classes'}
Tasks: ${totalTasks} total, ${completedTasks} completed, ${pendingTasks} pending
Upcoming tasks: ${tasks.filter((t) => !t.completed).map((t) => t.title).join(', ') || 'None'}

Write a 2-3 sentence summary. Be encouraging and highlight what's important today.`

    const summary = await chatWithAI(prompt)
    res.json({ summary, stats: { totalTasks, completedTasks, totalClasses, pendingTasks } })
  } catch (error) {
    if (isAiRateLimitError(error)) {
      noteAiUpstreamError('tasks-ai', error)
      res.status(429).json({ error: 'AI rate limit reached, try again shortly' })
      return
    }
    res.status(500).json({ error: 'Failed to generate summary' })
  }
})

export default router