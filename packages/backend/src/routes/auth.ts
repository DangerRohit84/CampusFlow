import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import prisma from '../config/db'
import { config } from '../config'
import { authenticate, AuthRequest } from '../middleware/auth'

const router = Router()

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  password: z.string().min(6),
  departmentId: z.string().optional(),
  department: z.string().optional(),
  role: z.string().optional(),
  collegeId: z.string().optional(),
  college: z.string().optional(),
  empNumber: z.string().optional(),
  studentId: z.string().optional(),
  incomingYear: z.number().optional(),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

// Register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const body = registerSchema.parse(req.body)

    const existingUser = await prisma.user.findUnique({ where: { email: body.email } })
    if (existingUser) {
      res.status(400).json({ error: 'Email already registered' })
      return
    }

    const passwordHash = await bcrypt.hash(body.password, 10)
    const user = await prisma.user.create({
      data: {
        email: body.email,
        name: body.name,
        passwordHash,
        departmentId: body.departmentId || undefined,
        departmentName: body.department || undefined,
        role: body.role as any || 'STUDENT',
        collegeId: body.collegeId,
        collegeName: body.college,
        empNumber: body.empNumber,
        studentId: body.studentId,
        incomingYear: body.incomingYear,
        outgoingYear: body.incomingYear ? body.incomingYear + 4 : undefined,
      },
    })

    const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn as any })

    res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        departmentId: user.departmentId,
        departmentName: user.departmentName,
        incomingYear: user.incomingYear,
        outgoingYear: user.outgoingYear,
        collegeId: user.collegeId,
        collegeName: user.collegeName,
      },
      token,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors })
      return
    }
    console.error('Register error:', error)
    res.status(500).json({ error: 'Registration failed' })
  }
})

// Login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const body = loginSchema.parse(req.body)

    const user = await prisma.user.findUnique({ where: { email: body.email } })
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    const validPassword = await bcrypt.compare(body.password, user.passwordHash)
    if (!validPassword) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn as any })

    const userWithCollege = await prisma.user.findUnique({
      where: { id: user.id },
      include: { college: { select: { id: true, name: true } }, department: true },
    })

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        departmentId: user.departmentId,
        departmentName: user.departmentName,
        department: userWithCollege?.department,
        incomingYear: user.incomingYear,
        outgoingYear: user.outgoingYear,
        studentId: user.studentId,
        empNumber: user.empNumber,
        college: userWithCollege?.college,
        collegeId: user.collegeId,
      },
      token,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors })
      return
    }
    console.error('Login error:', error)
    res.status(500).json({ error: 'Login failed' })
  }
})

// Get current user
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      include: { college: { select: { id: true, name: true } }, department: true },
    })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      departmentId: user.departmentId,
      department: user.department,
      incomingYear: user.incomingYear,
      outgoingYear: user.outgoingYear,
      avatar: user.avatar,
      studentId: user.studentId,
      empNumber: user.empNumber,
      college: user.college,
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to get user' })
  }
})

export default router