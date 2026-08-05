import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'

const router = Router()
router.use(authenticate)

const scheduleSchema = z.object({
  title: z.string(),
  course: z.string().optional(),
  location: z.string().optional(),
  dayOfWeek: z.number().min(0).max(6),
  startTime: z.string(),
  endTime: z.string(),
  type: z.string().default('CLASS'),
  color: z.string().optional(),
  recurring: z.boolean().default(true),
})

// Get all schedules
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const schedules = await prisma.schedule.findMany({
      where: { userId: req.userId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    })
    res.json(schedules)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch schedules' })
  }
})

// Get schedule by day
router.get('/day/:dayOfWeek', async (req: AuthRequest, res: Response) => {
  try {
    const dayOfWeek = parseInt(req.params.dayOfWeek)
    const schedules = await prisma.schedule.findMany({
      where: { userId: req.userId, dayOfWeek },
      orderBy: { startTime: 'asc' },
    })
    res.json(schedules)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch schedules' })
  }
})

// Create schedule
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const body = scheduleSchema.parse(req.body)
    const schedule = await prisma.schedule.create({
      data: { ...body, userId: req.userId! },
    })
    res.status(201).json(schedule)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors })
      return
    }
    res.status(500).json({ error: 'Failed to create schedule' })
  }
})

// Update schedule
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const body = scheduleSchema.partial().parse(req.body)
    const schedule = await prisma.schedule.update({
      where: { id: req.params.id, userId: req.userId },
      data: body,
    })
    res.json(schedule)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors })
      return
    }
    res.status(500).json({ error: 'Failed to update schedule' })
  }
})

// Delete schedule
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await prisma.schedule.delete({
      where: { id: req.params.id, userId: req.userId },
    })
    res.json({ message: 'Schedule deleted' })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete schedule' })
  }
})

export default router