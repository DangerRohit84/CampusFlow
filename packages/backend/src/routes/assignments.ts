import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'

const router = Router()
router.use(authenticate)

const assignmentSchema = z.object({
  courseId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  dueDate: z.string().transform((s) => new Date(s)),
  priority: z.string().default('MEDIUM'),
  status: z.string().default('PENDING'),
  progress: z.number().min(0).max(100).default(0),
  grade: z.string().optional(),
  maxGrade: z.string().optional(),
})

// Get all assignments
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { status, sort } = req.query
    const where: any = { userId: req.userId }
    if (status && status !== 'all') where.status = status as string

    const orderBy: any = sort === 'priority'
      ? { priority: 'asc' }
      : { dueDate: 'asc' }

    const assignments = await prisma.assignment.findMany({ where, orderBy })
    res.json(assignments)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch assignments' })
  }
})

// Get upcoming assignments
router.get('/upcoming', async (req: AuthRequest, res: Response) => {
  try {
    const assignments = await prisma.assignment.findMany({
      where: {
        userId: req.userId,
        status: 'PENDING',
        dueDate: { gte: new Date() },
      },
      orderBy: { dueDate: 'asc' },
      take: 5,
    })
    res.json(assignments)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch upcoming assignments' })
  }
})

// Create assignment
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const body = assignmentSchema.parse(req.body)
    const assignment = await prisma.assignment.create({
      data: { ...body, userId: req.userId! },
    })
    res.status(201).json(assignment)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors })
      return
    }
    res.status(500).json({ error: 'Failed to create assignment' })
  }
})

// Update assignment
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const body = assignmentSchema.partial().parse(req.body)
    const assignment = await prisma.assignment.update({
      where: { id: req.params.id, userId: req.userId },
      data: body,
    })
    res.json(assignment)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors })
      return
    }
    res.status(500).json({ error: 'Failed to update assignment' })
  }
})

// Delete assignment
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await prisma.assignment.delete({
      where: { id: req.params.id, userId: req.userId },
    })
    res.json({ message: 'Assignment deleted' })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete assignment' })
  }
})

export default router