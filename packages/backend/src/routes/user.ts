import { Router, Response } from 'express'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'

const router = Router()
router.use(authenticate)

// Get grades
router.get('/grades', async (req: AuthRequest, res: Response) => {
  try {
    const grades = await prisma.grade.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
    })
    res.json(grades)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch grades' })
  }
})

// Get grade stats
router.get('/grades/stats', async (req: AuthRequest, res: Response) => {
  try {
    const grades = await prisma.grade.findMany({ where: { userId: req.userId } })
    const totalCredits = grades.reduce((sum, g) => sum + g.credits, 0)
    const weightedGpa = grades.reduce((sum, g) => sum + g.gpa * g.credits, 0)
    const cgpa = totalCredits > 0 ? weightedGpa / totalCredits : 0

    res.json({
      cgpa: Math.round(cgpa * 100) / 100,
      totalCredits,
      courseCount: grades.length,
      grades,
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' })
  }
})

// Get attendance
router.get('/attendance', async (req: AuthRequest, res: Response) => {
  try {
    const records = await prisma.attendance.findMany({
      where: { userId: req.userId },
      orderBy: { date: 'desc' },
    })
    res.json(records)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch attendance' })
  }
})

// Get attendance stats
router.get('/attendance/stats', async (req: AuthRequest, res: Response) => {
  try {
    const records = await prisma.attendance.findMany({ where: { userId: req.userId } })
    const total = records.length
    const present = records.filter((r) => r.status === 'PRESENT').length
    const absent = records.filter((r) => r.status === 'ABSENT').length
    const late = records.filter((r) => r.status === 'LATE').length
    const percentage = total > 0 ? Math.round((present / total) * 100) : 0

    res.json({ total, present, absent, late, percentage })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' })
  }
})

// Get user profile/settings
router.get('/profile', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department,
      year: user.year,
      semester: user.semester,
      avatar: user.avatar,
      preferences: user.preferences ? JSON.parse(user.preferences) : {},
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch profile' })
  }
})

// Update profile
router.put('/profile', async (req: AuthRequest, res: Response) => {
  try {
    const { name, department, year, semester, preferences } = req.body
    const user = await prisma.user.update({
      where: { id: req.userId },
      data: {
        ...(name && { name }),
        ...(department && { department }),
        ...(year && { year }),
        ...(semester && { semester }),
        ...(preferences && { preferences: JSON.stringify(preferences) }),
      },
    })
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department,
      year: user.year,
      semester: user.semester,
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to update profile' })
  }
})

// Get integrations
router.get('/integrations', async (req: AuthRequest, res: Response) => {
  try {
    const integrations = await prisma.userIntegration.findMany({
      where: { userId: req.userId },
    })
    res.json(integrations)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch integrations' })
  }
})

// Get dashboard stats
router.get('/dashboard', async (req: AuthRequest, res: Response) => {
  try {
    const [grades, attendance, assignments, notifications, schedules] = await Promise.all([
      prisma.grade.findMany({ where: { userId: req.userId } }),
      prisma.attendance.findMany({ where: { userId: req.userId } }),
      prisma.assignment.findMany({ where: { userId: req.userId } }),
      prisma.notification.findMany({ where: { userId: req.userId, read: false } }),
      prisma.schedule.findMany({ where: { userId: req.userId } }),
    ])

    // CGPA
    const totalCredits = grades.reduce((sum, g) => sum + g.credits, 0)
    const weightedGpa = grades.reduce((sum, g) => sum + g.gpa * g.credits, 0)
    const cgpa = totalCredits > 0 ? Math.round((weightedGpa / totalCredits) * 100) / 100 : 0

    // Attendance
    const totalClasses = attendance.length
    const presentClasses = attendance.filter((a) => a.status === 'PRESENT').length
    const attendancePercent = totalClasses > 0 ? Math.round((presentClasses / totalClasses) * 100) : 0

    // Assignments
    const pendingAssignments = assignments.filter((a) => a.status === 'PENDING')
    const upcomingDeadlines = pendingAssignments.filter((a) => new Date(a.dueDate) >= new Date()).length

    // Today's schedule (get current day of week)
    const today = new Date().getDay()
    const todaySchedule = schedules.filter((s) => s.dayOfWeek === today)

    res.json({
      cgpa,
      attendancePercent,
      pendingAssignments: pendingAssignments.length,
      upcomingDeadlines,
      unreadNotifications: notifications.length,
      todaySchedule,
      recentNotifications: notifications.slice(0, 5),
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch dashboard' })
  }
})

export default router