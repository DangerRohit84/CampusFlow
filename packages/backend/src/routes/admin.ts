import { Router, Response } from 'express'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import bcrypt from 'bcryptjs'

const router = Router()
router.use(authenticate)

// Get all hackathons (admin)
router.get('/hackathons', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }
    const hackathons = await prisma.hackathon.findMany({
      where: user.role === 'SUPER_ADMIN' ? {} : { collegeId: user.collegeId },
      include: { creator: { select: { name: true } }, registrations: true },
      orderBy: { createdAt: 'desc' },
    })
    res.json(hackathons)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch hackathons' })
  }
})

// Get all forms (admin)
router.get('/forms', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }
    const forms = await prisma.form.findMany({
      where: user.role === 'SUPER_ADMIN' ? {} : { collegeId: user.collegeId },
      include: { creator: { select: { name: true } }, responses: true },
      orderBy: { createdAt: 'desc' },
    })
    res.json(forms)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch forms' })
  }
})

// Delete any hackathon (admin override)
router.delete('/hackathons/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }
    await prisma.hackathonRound.deleteMany({ where: { hackathonId: req.params.id as string } })
    await prisma.hackathonRegistration.deleteMany({ where: { hackathonId: req.params.id as string } })
    await prisma.hackathon.delete({ where: { id: req.params.id as string } })
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete hackathon' })
  }
})

// Delete any form (admin override)
router.delete('/forms/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }
    await prisma.formResponse.deleteMany({ where: { formId: req.params.id as string } })
    await prisma.formField.deleteMany({ where: { formId: req.params.id as string } })
    await prisma.form.delete({ where: { id: req.params.id as string } })
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete form' })
  }
})

// Get analytics
router.get('/analytics', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    const where = user.role === 'SUPER_ADMIN' ? {} : { collegeId: user.collegeId }

    const [totalStudents, totalTeachers, hackathons, forms, registrations] = await Promise.all([
      prisma.user.count({ where: { ...where, role: 'STUDENT' } }),
      prisma.user.count({ where: { ...where, role: 'TEACHER' } }),
      prisma.hackathon.count({ where: where.collegeId ? { collegeId: where.collegeId } : {} }),
      prisma.form.count({ where: where.collegeId ? { collegeId: where.collegeId } : {} }),
      prisma.hackathonRegistration.count({
        where: {
          hackathon: where.collegeId ? { collegeId: where.collegeId } : {},
        },
      }),
    ])

    res.json({
      totalStudents,
      totalTeachers,
      hackathons,
      forms,
      registrations,
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch analytics' })
  }
})

// ==================== COLLEGE MANAGEMENT ====================

// College Admin: Register a new college (creates pending college)
router.post('/colleges/register', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || user.role !== 'COLLEGE_ADMIN') {
      res.status(403).json({ error: 'Only college admins can register colleges' })
      return
    }

    const { name, code, address, phone, website } = req.body

    const existingCollege = await prisma.college.findFirst({
      where: { OR: [{ name }, { code }] },
    })
    if (existingCollege) {
      res.status(400).json({ error: 'College name or code already exists' })
      return
    }

    const college = await prisma.college.create({
      data: {
        name,
        code,
        address,
        phone,
        website,
        adminEmail: user.email,
        status: 'PENDING',
      },
    })

    // Link user to this college
    await prisma.user.update({
      where: { id: user.id },
      data: { collegeId: college.id },
    })

    res.status(201).json(college)
  } catch (error) {
    console.error('Register college error:', error)
    res.status(500).json({ error: 'Failed to register college' })
  }
})

// Super Admin: Get all colleges
router.get('/colleges', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin only' })
      return
    }

    const colleges = await prisma.college.findMany({
      include: {
        _count: { select: { users: true, hackathons: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    res.json(colleges)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch colleges' })
  }
})

// Super Admin: Approve college
router.put('/colleges/:id/approve', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin only' })
      return
    }

    const college = await prisma.college.update({
      where: { id: req.params.id as string },
      data: { status: 'APPROVED' },
    })

    res.json(college)
  } catch (error) {
    res.status(500).json({ error: 'Failed to approve college' })
  }
})

// Super Admin: Reject college
router.put('/colleges/:id/reject', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin only' })
      return
    }

    const college = await prisma.college.update({
      where: { id: req.params.id as string },
      data: { status: 'REJECTED' },
    })

    res.json(college)
  } catch (error) {
    res.status(500).json({ error: 'Failed to reject college' })
  }
})

// Super Admin: Delete college
router.delete('/colleges/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin only' })
      return
    }

    await prisma.college.delete({ where: { id: req.params.id as string } })
    res.json({ message: 'College deleted' })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete college' })
  }
})

// ==================== USER MANAGEMENT ====================

// Get all users in college
router.get('/users', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    const where = user.role === 'SUPER_ADMIN' ? {} : { collegeId: user.collegeId }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        departmentId: true,
        department: true,
        studentId: true,
        empNumber: true,
        incomingYear: true,
        outgoingYear: true,
        collegeId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    res.json(users)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' })
  }
})

// Add teacher to college
router.post('/users/teacher', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || user.role !== 'COLLEGE_ADMIN') {
      res.status(403).json({ error: 'Only college admins can add teachers' })
      return
    }

    const { email, name, password, departmentId, empNumber } = req.body

    const existingUser = await prisma.user.findUnique({ where: { email } })
    if (existingUser) {
      res.status(400).json({ error: 'Email already exists' })
      return
    }

    // Validate departmentId if provided
    if (departmentId) {
      const dept = await prisma.department.findUnique({ where: { id: departmentId } })
      if (!dept || dept.collegeId !== user.collegeId) {
        res.status(400).json({ error: 'Invalid department' })
        return
      }
    }

    const passwordHash = await bcrypt.hash(password || 'password123', 10)

    const newUser = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: 'TEACHER',
        collegeId: user.collegeId,
        departmentId: departmentId || undefined,
        empNumber,
      },
    })

    res.status(201).json({
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
    })
  } catch (error) {
    console.error('Add teacher error:', error)
    res.status(500).json({ error: 'Failed to create teacher' })
  }
})

// Add student to college
router.post('/users/student', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || user.role !== 'COLLEGE_ADMIN') {
      res.status(403).json({ error: 'Only college admins can add students' })
      return
    }

    const { email, name, password, departmentId, studentId, incomingYear } = req.body

    const existingUser = await prisma.user.findUnique({ where: { email } })
    if (existingUser) {
      res.status(400).json({ error: 'Email already exists' })
      return
    }

    // Validate departmentId if provided
    if (departmentId) {
      const dept = await prisma.department.findUnique({ where: { id: departmentId } })
      if (!dept || dept.collegeId !== user.collegeId) {
        res.status(400).json({ error: 'Invalid department' })
        return
      }
    }

    const passwordHash = await bcrypt.hash(password || 'password123', 10)
    const incoming = incomingYear ? parseInt(incomingYear) : undefined

    const newUser = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: 'STUDENT',
        collegeId: user.collegeId,
        departmentId: departmentId || undefined,
        studentId,
        incomingYear: incoming,
        outgoingYear: incoming ? incoming + 4 : undefined,
      },
    })

    res.status(201).json({
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
    })
  } catch (error) {
    console.error('Add student error:', error)
    res.status(500).json({ error: 'Failed to create student' })
  }
})

// Bulk add teachers via CSV
router.post('/users/teachers/bulk', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || user.role !== 'COLLEGE_ADMIN') {
      res.status(403).json({ error: 'Only college admins can add teachers' })
      return
    }

    const { teachers } = req.body
    const results = { success: 0, failed: 0, errors: [] as string[] }

    for (const t of teachers) {
      try {
        const existingUser = await prisma.user.findUnique({ where: { email: t.email } })
        if (existingUser) {
          results.failed++
          results.errors.push(`${t.email}: Email already exists`)
          continue
        }

        // Validate departmentId if provided
        if (t.departmentId) {
          const dept = await prisma.department.findUnique({ where: { id: t.departmentId } })
          if (!dept || dept.collegeId !== user.collegeId) {
            results.failed++
            results.errors.push(`${t.email}: Invalid department`)
            continue
          }
        }

        const passwordHash = await bcrypt.hash(t.password || 'password123', 10)
        await prisma.user.create({
          data: {
            email: t.email,
            name: t.name,
            passwordHash,
            role: 'TEACHER',
            collegeId: user.collegeId,
            departmentId: t.departmentId || undefined,
            empNumber: t.empNumber,
          },
        })
        results.success++
      } catch (err: any) {
        results.failed++
        results.errors.push(`${t.email}: ${err.message}`)
      }
    }

    res.json(results)
  } catch (error) {
    res.status(500).json({ error: 'Failed to bulk add teachers' })
  }
})

// Bulk add students via CSV
router.post('/users/students/bulk', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || user.role !== 'COLLEGE_ADMIN') {
      res.status(403).json({ error: 'Only college admins can add students' })
      return
    }

    const { students } = req.body
    const results = { success: 0, failed: 0, errors: [] as string[] }

    for (const s of students) {
      try {
        const existingUser = await prisma.user.findUnique({ where: { email: s.email } })
        if (existingUser) {
          results.failed++
          results.errors.push(`${s.email}: Email already exists`)
          continue
        }

        // Validate departmentId if provided
        if (s.departmentId) {
          const dept = await prisma.department.findUnique({ where: { id: s.departmentId } })
          if (!dept || dept.collegeId !== user.collegeId) {
            results.failed++
            results.errors.push(`${s.email}: Invalid department`)
            continue
          }
        }

        const passwordHash = await bcrypt.hash(s.password || 'password123', 10)
        const incoming = s.incomingYear ? parseInt(s.incomingYear) : undefined
        await prisma.user.create({
          data: {
            email: s.email,
            name: s.name,
            passwordHash,
            role: 'STUDENT',
            collegeId: user.collegeId,
            departmentId: s.departmentId || undefined,
            studentId: s.studentId,
            incomingYear: incoming,
            outgoingYear: incoming ? incoming + 4 : undefined,
          },
        })
        results.success++
      } catch (err: any) {
        results.failed++
        results.errors.push(`${s.email}: ${err.message}`)
      }
    }

    res.json(results)
  } catch (error) {
    res.status(500).json({ error: 'Failed to bulk add students' })
  }
})

// Update user
router.put('/users/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    const { name, email, departmentId, role, incomingYear } = req.body

    // Validate departmentId if provided
    if (departmentId) {
      const dept = await prisma.department.findUnique({ where: { id: departmentId } })
      if (!dept || (user.role !== 'SUPER_ADMIN' && dept.collegeId !== user.collegeId)) {
        res.status(400).json({ error: 'Invalid department' })
        return
      }
    }

    const incoming = incomingYear ? parseInt(incomingYear) : undefined
    const updated = await prisma.user.update({
      where: { id: req.params.id as string },
      data: {
        name,
        email,
        departmentId: departmentId || undefined,
        role,
        incomingYear: incoming,
        outgoingYear: incoming ? incoming + 4 : undefined,
      },
      include: { department: true },
    })

    res.json({ id: updated.id, name: updated.name, role: updated.role })
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user' })
  }
})

// Delete user
router.delete('/users/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    await prisma.user.delete({ where: { id: req.params.id as string } })
    res.json({ message: 'User deleted' })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' })
  }
})

export default router
