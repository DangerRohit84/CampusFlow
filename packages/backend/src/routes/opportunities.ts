import { Router, Response } from 'express'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import { fetchAndStoreOpportunities } from '../services/opportunityAgent'

const router = Router()
router.use(authenticate)

// GET / - List opportunities (filtered by role)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const { type, status, source } = req.query

    const where: any = {}

    if (type) where.type = type
    if (source) where.source = source

    if (user.role === 'STUDENT') {
      where.status = 'APPROVED'
      where.OR = [
        { collegeId: user.collegeId },
        { collegeId: null },
      ]
    } else if (user.role === 'TEACHER') {
      where.status = 'APPROVED'
      where.assignedTo = user.id
    } else if (status) {
      where.status = status
    }

    const opportunities = await prisma.opportunity.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    res.json(opportunities)
  } catch (error) {
    console.error('Get opportunities error:', error)
    res.status(500).json({ error: 'Failed to fetch opportunities' })
  }
})

// GET /pending - Pending reviews (admin/teacher only)
router.get('/pending', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    if (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN' && user.role !== 'TEACHER') {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    const where: any = { status: 'PENDING' }

    if (user.role === 'TEACHER') {
      where.assignedTo = user.id
    } else {
      where.collegeId = user.collegeId
    }

    const opportunities = await prisma.opportunity.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })

    res.json(opportunities)
  } catch (error) {
    console.error('Get pending opportunities error:', error)
    res.status(500).json({ error: 'Failed to fetch pending opportunities' })
  }
})

// GET /for-me - Opportunities filtered by user's department (for users without college)
router.get('/for-me', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const departmentName = user.departmentName || user.departmentId
    if (!departmentName) {
      res.json([])
      return
    }

    const deptLower = departmentName.toLowerCase()
    const { type } = req.query

    const where: any = {
      OR: [
        { title: { contains: deptLower, mode: 'insensitive' } },
        { description: { contains: deptLower, mode: 'insensitive' } },
        { role: { contains: deptLower, mode: 'insensitive' } },
      ],
    }

    if (type) where.type = type

    const opportunities = await prisma.opportunity.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    res.json(opportunities)
  } catch (error) {
    console.error('Get opportunities for me error:', error)
    res.status(500).json({ error: 'Failed to fetch opportunities' })
  }
})

// PUT /:id/approve - Approve and create Hackathon/Internship entry
router.put('/:id/approve', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    if (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN' && user.role !== 'TEACHER') {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    const opportunity = await prisma.opportunity.findUnique({
      where: { id: req.params.id as string },
    })

    if (!opportunity) {
      res.status(404).json({ error: 'Opportunity not found' })
      return
    }

    if (user.role === 'TEACHER' && opportunity.assignedTo !== user.id) {
      res.status(403).json({ error: 'Can only approve opportunities assigned to you' })
      return
    }

    // Create entry in Hackathon or Internship table
    if (opportunity.type === 'HACKATHON') {
      await prisma.hackathon.create({
        data: {
          creatorId: user.id,
          collegeId: user.collegeId,
          title: opportunity.title,
          description: opportunity.description,
          url: opportunity.url,
          organizer: opportunity.organizer,
          deadline: opportunity.deadline ? new Date(opportunity.deadline) : null,
          startDate: opportunity.startDate ? new Date(opportunity.startDate) : null,
          location: opportunity.location,
          mode: opportunity.mode || 'OFFLINE',
          prizePool: opportunity.prizePool,
          duration: opportunity.duration,
          source: opportunity.source,
          status: 'PUBLISHED',
        },
      })
    } else if (opportunity.type === 'INTERNSHIP') {
      if (!user.collegeId) {
        res.status(400).json({ error: 'College admin must have a collegeId to approve internships' })
        return
      }
      await prisma.internship.create({
        data: {
          creatorId: user.id,
          collegeId: user.collegeId,
          title: opportunity.title,
          description: opportunity.description || '',
          company: opportunity.company || '',
          role: opportunity.role || '',
          url: opportunity.url,
          stipend: opportunity.stipend,
          duration: opportunity.duration,
          startDate: opportunity.startDate,
          deadline: opportunity.deadline,
          mode: opportunity.mode || 'REMOTE',
          source: opportunity.source,
          status: 'ACTIVE',
        },
      })
    }

    const updated = await prisma.opportunity.update({
      where: { id: req.params.id as string },
      data: {
        status: 'APPROVED',
        approvedBy: user.id,
      },
    })

    res.json(updated)
  } catch (error) {
    console.error('Approve opportunity error:', error)
    res.status(500).json({ error: 'Failed to approve opportunity' })
  }
})

// PUT /:id/reject - Reject (admin/teacher only)
router.put('/:id/reject', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    if (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN' && user.role !== 'TEACHER') {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    const opportunity = await prisma.opportunity.findUnique({
      where: { id: req.params.id as string },
    })

    if (!opportunity) {
      res.status(404).json({ error: 'Opportunity not found' })
      return
    }

    if (user.role === 'TEACHER' && opportunity.assignedTo !== user.id) {
      res.status(403).json({ error: 'Can only reject opportunities assigned to you' })
      return
    }

    const updated = await prisma.opportunity.update({
      where: { id: req.params.id as string },
      data: {
        status: 'REJECTED',
        approvedBy: user.id,
      },
    })

    res.json(updated)
  } catch (error) {
    console.error('Reject opportunity error:', error)
    res.status(500).json({ error: 'Failed to reject opportunity' })
  }
})

// PUT /:id/assign - Assign to teacher (admin only)
router.put('/:id/assign', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    if (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Admin access required' })
      return
    }

    const { teacherId } = req.body
    if (!teacherId) {
      res.status(400).json({ error: 'teacherId is required' })
      return
    }

    const teacher = await prisma.user.findUnique({ where: { id: teacherId } })
    if (!teacher || teacher.role !== 'TEACHER') {
      res.status(400).json({ error: 'Invalid teacher' })
      return
    }

    const updated = await prisma.opportunity.update({
      where: { id: req.params.id as string },
      data: { assignedTo: teacherId },
    })

    res.json(updated)
  } catch (error) {
    console.error('Assign opportunity error:', error)
    res.status(500).json({ error: 'Failed to assign opportunity' })
  }
})

// POST /fetch-now - Manual trigger (admin only)
router.post('/fetch-now', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }

    const result = await fetchAndStoreOpportunities()
    res.json({ message: 'Fetch complete', ...result })
  } catch (error) {
    console.error('Fetch now error:', error)
    res.status(500).json({ error: 'Failed to fetch opportunities' })
  }
})

// DELETE /:id - Delete (admin only)
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }

    await prisma.opportunity.delete({ where: { id: req.params.id as string } })
    res.json({ message: 'Opportunity deleted' })
  } catch (error) {
    console.error('Delete opportunity error:', error)
    res.status(500).json({ error: 'Failed to delete opportunity' })
  }
})

export default router
