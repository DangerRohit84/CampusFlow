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

    const user = await prisma.user.findUnique({ where: { id: userId } })
    const collegeId = (user as any)?.collegeId || null
    // Use mode insensitive for Postgres; contains is sufficient
    const like = { contains: query, mode: 'insensitive' as const }
    const [schedules, assignments, assignmentHubs, notifications, hackathons, internships, forms, rooms, codingContests, tasks] = await Promise.all([
      prisma.schedule.findMany({
        where: { userId, OR: [{ title: like }, { course: like }, { location: like }] }, take: 6,
      }),
      prisma.assignment.findMany({
        where: { userId, OR: [{ title: like }, { courseId: like }, { description: like }] }, take: 6,
      }),
      // AssignmentHub — college-scoped, visible via assignmentVisibility OR at least by college/global where
      prisma.assignmentHub.findMany({
        where: collegeId ? { collegeId, OR: [{ title: like }, { description: like }] } : { OR: [{ title: like }, { description: like }] },
        take: 6, orderBy: { dueDate: 'desc' }
      }).catch(()=>[] as any[]),
      prisma.notification.findMany({
        where: { userId, OR: [{ title: like }, { message: like }] }, take: 6,
      }),
      prisma.hackathon.findMany({
        where: collegeId ? { collegeId, OR: [{ title: like }, { organizer: like }] } : { OR: [{ title: like }, { organizer: like }] },
        take: 6, orderBy: { createdAt: 'desc' }
      }).catch(()=>[] as any[]),
      prisma.internship.findMany({
        where: collegeId ? { collegeId, OR: [{ title: like }, { company: like }, { role: like }] } : { OR: [{ title: like }, { company: like }] },
        take: 6, orderBy: { createdAt: 'desc' }
      }).catch(()=>[] as any[]),
      prisma.form.findMany({
        where: collegeId ? { collegeId, OR: [{ title: like }, { description: like }] } : { OR: [{ title: like }, { description: like }] },
        take: 6, orderBy: { createdAt: 'desc' }
      }).catch(()=>[] as any[]),
      prisma.room.findMany({
        where: { OR: [{ name: like }, { description: like }] }, take: 6, orderBy: { createdAt: 'desc' }
      }).catch(()=>[] as any[]),
      prisma.codingContest.findMany({
        where: { OR: [{ title: like }, { platform: like }] }, take: 6, orderBy: { startTime: 'desc' }
      }).catch(()=>[] as any[]),
      prisma.task.findMany({
        where: { userId, OR: [{ title: like }, { description: like }] }, take: 6,
      }),
    ])

    const results = [
      ...schedules.map((s: any) => ({ type: 'schedule', id: s.id, title: s.title, subtitle: `${s.course || ''} · ${s.location || ''}`.replace(/^ · | · $/g,''), data: s })),
      ...assignments.map((a: any) => ({ type: 'assignment', id: a.id, title: a.title, subtitle: `${a.courseId} · Due: ${a.dueDate.toISOString().split('T')[0]}`, data: a })),
      ...(assignmentHubs as any[]).map((h: any) => ({ type: 'assignmentHub', id: h.id, title: h.title, subtitle: `Due ${new Date(h.dueDate).toLocaleDateString()} · ${h.scope}`, data: h })),
      ...notifications.map((n: any) => ({ type: 'notification', id: n.id, title: n.title, subtitle: n.message, data: n })),
      ...(hackathons as any[]).map((h: any) => ({ type: 'hackathon', id: h.id, title: h.title, subtitle: `${h.organizer || ''} · ${h.mode || ''}`.replace(/^ · | · $/g,''), data: h })),
      ...(internships as any[]).map((i: any) => ({ type: 'internship', id: i.id, title: i.title, subtitle: `${i.company || ''} · ${i.role || ''}`.replace(/^ · | · $/g,''), data: i })),
      ...(forms as any[]).map((f: any) => ({ type: 'form', id: f.id, title: f.title, subtitle: f.description || 'Form', data: f })),
      ...(rooms as any[]).map((r: any) => ({ type: 'room', id: r.id, title: r.name, subtitle: r.description || `Code ${r.joinCode}`, data: r })),
      ...(codingContests as any[]).map((c: any) => ({ type: 'contest', id: c.id, title: c.title, subtitle: `${c.platform} · ${c.status}`, data: c })),
      ...tasks.map((t: any) => ({ type: 'task', id: t.id, title: t.title, subtitle: `${t.category || 'personal'} · ${new Date(t.date).toLocaleDateString()}`, data: t })),
    ]

    res.json({ results, total: results.length })
  } catch (error) {
    res.status(500).json({ error: 'Search failed' })
  }
})

export default router