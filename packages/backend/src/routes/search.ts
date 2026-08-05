import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'

const router = Router()
router.use(authenticate)

// Search across all user data
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { q } = req.query
    if (!q || typeof q !== 'string') {
      res.status(400).json({ error: 'Search query required' })
      return
    }

    const query = q.toLowerCase()
    const userId = req.userId!

    const [schedules, assignments, notifications] = await Promise.all([
      prisma.schedule.findMany({
        where: {
          userId,
          OR: [
            { title: { contains: query } },
            { course: { contains: query } },
            { location: { contains: query } },
          ],
        },
        take: 10,
      }),
      prisma.assignment.findMany({
        where: {
          userId,
          OR: [
            { title: { contains: query } },
            { courseId: { contains: query } },
            { description: { contains: query } },
          ],
        },
        take: 10,
      }),
      prisma.notification.findMany({
        where: {
          userId,
          OR: [
            { title: { contains: query } },
            { message: { contains: query } },
          ],
        },
        take: 10,
      }),
    ])

    const results = [
      ...schedules.map((s) => ({ type: 'schedule', id: s.id, title: s.title, subtitle: `${s.course} · ${s.location}`, data: s })),
      ...assignments.map((a) => ({ type: 'assignment', id: a.id, title: a.title, subtitle: `${a.courseId} · Due: ${a.dueDate.toISOString().split('T')[0]}`, data: a })),
      ...notifications.map((n) => ({ type: 'notification', id: n.id, title: n.title, subtitle: n.message, data: n })),
    ]

    res.json({ results, total: results.length })
  } catch (error) {
    res.status(500).json({ error: 'Search failed' })
  }
})

export default router