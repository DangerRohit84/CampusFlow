import { Router, Response } from 'express'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'

const router = Router()
router.use(authenticate)

// List departments for user's college
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || !user.collegeId) {
      res.status(403).json({ error: 'College access required' })
      return
    }
    const departments = await prisma.department.findMany({
      where: { collegeId: user.collegeId },
      include: { _count: { select: { users: true } } },
      orderBy: { name: 'asc' },
    })
    res.json(departments)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch departments' })
  }
})

// Create department (college admin only)
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || user.role !== 'COLLEGE_ADMIN') {
      res.status(403).json({ error: 'College admin access required' })
      return
    }
    if (!user.collegeId) {
      res.status(400).json({ error: 'College admin must belong to a college' })
      return
    }
    const { name } = req.body
    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Department name is required' })
      return
    }
    const existing = await prisma.department.findFirst({
      where: { collegeId: user.collegeId, name: name.trim() },
    })
    if (existing) {
      res.status(400).json({ error: 'Department already exists' })
      return
    }
    const dept = await prisma.department.create({
      data: { name: name.trim(), collegeId: user.collegeId },
    })
    res.status(201).json(dept)
  } catch (error: any) {
    console.error('Department create error:', error?.message || error)
    res.status(500).json({ error: 'Failed to create department', detail: error?.message })
  }
})

// Rename department
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || user.role !== 'COLLEGE_ADMIN') {
      res.status(403).json({ error: 'College admin access required' })
      return
    }
    if (!user.collegeId) {
      res.status(400).json({ error: 'College admin must belong to a college' })
      return
    }
    const { name } = req.body
    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Department name is required' })
      return
    }
    const dept = await prisma.department.findUnique({ where: { id: req.params.id } })
    if (!dept || dept.collegeId !== user.collegeId) {
      res.status(404).json({ error: 'Department not found' })
      return
    }
    const updated = await prisma.department.update({
      where: { id: req.params.id },
      data: { name: name.trim() },
    })
    res.json(updated)
  } catch (error) {
    res.status(500).json({ error: 'Failed to update department' })
  }
})

// Delete department
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || user.role !== 'COLLEGE_ADMIN') {
      res.status(403).json({ error: 'College admin access required' })
      return
    }
    if (!user.collegeId) {
      res.status(400).json({ error: 'College admin must belong to a college' })
      return
    }
    const dept = await prisma.department.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { users: true } } },
    })
    if (!dept || dept.collegeId !== user.collegeId) {
      res.status(404).json({ error: 'Department not found' })
      return
    }
    if (dept._count.users > 0) {
      res.status(400).json({ error: `Cannot delete: ${dept._count.users} users belong to this department` })
      return
    }
    await prisma.department.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete department' })
  }
})

export default router