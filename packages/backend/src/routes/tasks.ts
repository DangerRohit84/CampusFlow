import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import { chatWithAI } from '../ai/groq'

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
  priority: z.string().default('MEDIUM'),
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
    if (status) where.status = status

    const tasks = await prisma.task.findMany({
      where,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    })
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
    res.json(tasks)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch today tasks' })
  }
})

// Create task
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const body = taskSchema.parse(req.body)
    const task = await prisma.task.create({
      data: { ...body, userId: req.userId!, date: new Date(body.date) },
    })
    res.status(201).json(task)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors })
      return
    }
    res.status(500).json({ error: 'Failed to create task' })
  }
})

// Update task
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const body = taskSchema.partial().parse(req.body)
    const task = await prisma.task.update({
      where: { id: req.params.id as string, userId: req.userId },
      data: { ...body, date: body.date ? new Date(body.date) : undefined },
    })
    res.json(task)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors })
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
    res.json(updated)
  } catch (error) {
    res.status(500).json({ error: 'Failed to toggle task' })
  }
})

// Delete task
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await prisma.task.delete({ where: { id: req.params.id as string, userId: req.userId } })
    res.json({ message: 'Task deleted' })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete task' })
  }
})

// AI: Auto-schedule tasks into free time slots
router.post('/ai-schedule', async (req: AuthRequest, res: Response) => {
  try {
    const { tasks: taskDescriptions, date } = req.body
    if (!taskDescriptions || !date) {
      res.status(400).json({ error: 'Tasks and date required' })
      return
    }

    // Get existing classes for that day
    const d = new Date(date)
    const dayOfWeek = d.getDay() === 0 ? 6 : d.getDay() - 1
    const classes = await prisma.schedule.findMany({
      where: { userId: req.userId, dayOfWeek },
      orderBy: { startTime: 'asc' },
    })

    const existingTasks = await prisma.task.findMany({
      where: {
        userId: req.userId,
        date: { gte: new Date(date), lt: new Date(new Date(date).getTime() + 86400000) },
      },
    })

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
    res.status(500).json({ error: 'Failed to generate schedule' })
  }
})

// AI: Get daily summary
router.get('/daily-summary', async (req: AuthRequest, res: Response) => {
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const [tasks, classes] = await Promise.all([
      prisma.task.findMany({ where: { userId: req.userId, date: { gte: today, lt: tomorrow } }, orderBy: { startTime: 'asc' } }),
      prisma.schedule.findMany({ where: { userId: req.userId, dayOfWeek: today.getDay() === 0 ? 6 : today.getDay() - 1 } }),
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
    res.status(500).json({ error: 'Failed to generate summary' })
  }
})

export default router