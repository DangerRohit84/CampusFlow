import { Router, Response } from 'express'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import { deriveCollegeId, getSuperAdminTargetCollegeId } from '../utils/roles'

const router = Router()
router.use(authenticate)

// List departments for user's college (SUPER_ADMIN sees all, or filtered by ?collegeId=/header)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) {
      res.status(403).json({ error: 'Access required' })
      return
    }
    let where: any = {}
    if (user.role === 'SUPER_ADMIN') {
      const collegeId = getSuperAdminTargetCollegeId(req)
      if (collegeId) where = { collegeId }
    } else {
      where = { collegeId: user.collegeId! }
    }
    const departments = await prisma.department.findMany({
      where,
      include: { _count: { select: { users: true } } },
      orderBy: { name: 'asc' },
    })
    res.json(departments)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch departments' })
  }
})

// Create department (college admin or super admin)
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'College admin or super admin access required' })
      return
    }
    const collegeId = deriveCollegeId(user as any, req.body.collegeId as string | null | undefined, req)
    if (!collegeId) {
      res.status(400).json({ error: 'College ID is required' })
      return
    }
    const { name } = req.body
    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Department name is required' })
      return
    }
    const existing = await prisma.department.findFirst({
      where: { collegeId, name: name.trim() },
    })
    if (existing) {
      res.status(400).json({ error: 'Department already exists' })
      return
    }
    const dept = await prisma.department.create({
      data: { name: name.trim(), collegeId },
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
    if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'College admin or super admin access required' })
      return
    }
    const { name } = req.body
    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Department name is required' })
      return
    }
    const dept = await prisma.department.findUnique({ where: { id: req.params.id as string } })
    if (!dept) {
      res.status(404).json({ error: 'Department not found' })
      return
    }
    // College admin can only rename their own college's departments
    if (user.role === 'COLLEGE_ADMIN' && dept.collegeId !== user.collegeId) {
      res.status(404).json({ error: 'Department not found' })
      return
    }
    const updated = await prisma.department.update({
      where: { id: req.params.id as string },
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
    if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'College admin or super admin access required' })
      return
    }
    const dept = await prisma.department.findUnique({
      where: { id: req.params.id as string },
      include: { _count: { select: { users: true } } },
    })
    if (!dept) {
      res.status(404).json({ error: 'Department not found' })
      return
    }
    // College admin can only delete their own college's departments
    if (user.role === 'COLLEGE_ADMIN' && dept.collegeId !== user.collegeId) {
      res.status(404).json({ error: 'Department not found' })
      return
    }
    if (dept._count.users > 0) {
      res.status(400).json({ error: `Cannot delete: ${dept._count.users} users belong to this department` })
      return
    }
    await prisma.department.delete({ where: { id: req.params.id as string } })
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete department' })
  }
})

export default router