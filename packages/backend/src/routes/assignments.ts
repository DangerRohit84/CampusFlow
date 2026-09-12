import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import { AssignmentStatusEnum, PriorityEnum } from '../lib/validators'
import { isPrismaNotFound } from '../lib/prismaErrors'

const router = Router()
router.use(authenticate)

// Order 4: status/priority are native Prisma enums (AssignmentStatus/Priority).
// Zod mirrors DB domain so ghosts (APROVED) 400 instead of P2000/500.
const assignmentSchema = z.object({
  courseId: z.string().trim().min(1).optional().nullable(),
  title: z.string(),
  description: z.string().optional(),
  dueDate: z.string().transform((s) => new Date(s)),
  priority: PriorityEnum.default('MEDIUM'),
  status: AssignmentStatusEnum.default('PENDING'),
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
    // Order-1 FK: Assignment.courseId → Course(id) ON DELETE SET NULL (nullable).
    // Validate when provided so FK violations surface as 400, not 500/P2003.
    let courseId: string | null = (body as any).courseId ?? null
    if (courseId) {
      const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } })
      if (!course) {
        res.status(400).json({ error: 'Invalid courseId: course not found' })
        return
      }
    } else {
      courseId = null
    }
    const assignment = await prisma.assignment.create({
      data: { ...body, courseId, userId: req.userId! },
    })
    res.status(201).json(assignment)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors })
      return
    }
    // Defensive: race between check + create (course deleted) → FK P2003 as 400.
    if ((error as any)?.code === 'P2003') {
      res.status(400).json({ error: 'Invalid courseId: course not found' })
      return
    }
    res.status(500).json({ error: 'Failed to create assignment' })
  }
})

// Update assignment
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const body = assignmentSchema.partial().parse(req.body)
    if ((body as any).courseId) {
      const course = await prisma.course.findUnique({ where: { id: (body as any).courseId }, select: { id: true } })
      if (!course) {
        res.status(400).json({ error: 'Invalid courseId: course not found' })
        return
      }
    }
    const assignment = await prisma.assignment.update({
      where: { id: req.params.id as string, userId: req.userId },
      data: body,
    })
    res.json(assignment)
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
      res.status(404).json({ error: 'Assignment not found' })
      return
    }
    res.status(500).json({ error: 'Failed to update assignment' })
  }
})

// Delete assignment
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await prisma.assignment.delete({
      where: { id: req.params.id as string, userId: req.userId },
    })
    res.json({ message: 'Assignment deleted' })
  } catch (error) {
    // topbottom F4: missing/not-owned row (P2025) is 404, not 500.
    if (isPrismaNotFound(error)) {
      res.status(404).json({ error: 'Assignment not found' })
      return
    }
    res.status(500).json({ error: 'Failed to delete assignment' })
  }
})

export default router