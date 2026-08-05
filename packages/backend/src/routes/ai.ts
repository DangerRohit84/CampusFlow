import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import { summarizeContent, chatWithAI } from '../ai/groq'

const router = Router()
router.use(authenticate)

const summarizeSchema = z.object({
  content: z.string().min(10),
  type: z.enum(['notes', 'email', 'announcement', 'general']).default('general'),
})

const studyPlanSchema = z.object({
  subjects: z.array(z.string()),
  daysLeft: z.number().min(1),
  hoursPerDay: z.number().min(1).max(12),
})

// Summarize notes/content
router.post('/summarize', async (req: AuthRequest, res: Response) => {
  try {
    const body = summarizeSchema.parse(req.body)
    const summary = await summarizeContent(body.content)
    res.json({ summary, type: body.type })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors })
      return
    }
    res.status(500).json({ error: 'Summarization failed' })
  }
})

// Generate study plan
router.post('/study-plan', async (req: AuthRequest, res: Response) => {
  try {
    const body = studyPlanSchema.parse(req.body)
    const prompt = `Create a study plan for these subjects: ${body.subjects.join(', ')}.
Available time: ${body.daysLeft} days, ${body.hoursPerDay} hours per day.
Create a detailed daily schedule with time blocks, breaks, and revision slots.
Format as a structured plan with day-by-day breakdown.`

    const plan = await chatWithAI(prompt)
    res.json({ plan, subjects: body.subjects, daysLeft: body.daysLeft })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors })
      return
    }
    res.status(500).json({ error: 'Failed to generate study plan' })
  }
})

// Check schedule conflicts
router.post('/check-conflicts', async (req: AuthRequest, res: Response) => {
  try {
    const { dayOfWeek, startTime, endTime, excludeId } = req.body
    const schedules = await prisma.schedule.findMany({
      where: { userId: req.userId, dayOfWeek: parseInt(dayOfWeek) },
    })

    const conflicts = schedules.filter((s) => {
      if (excludeId && s.id === excludeId) return false
      return startTime < s.endTime && endTime > s.startTime
    })

    res.json({
      hasConflicts: conflicts.length > 0,
      conflicts,
      suggestion: conflicts.length > 0
        ? `This slot overlaps with: ${conflicts.map((c) => c.title).join(', ')}. Consider a different time slot.`
        : 'No conflicts found. This slot is available!',
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to check conflicts' })
  }
})

// Get AI insights on grades/performance
router.get('/insights', async (req: AuthRequest, res: Response) => {
  try {
    const [grades, attendance] = await Promise.all([
      prisma.grade.findMany({ where: { userId: req.userId } }),
      prisma.attendance.findMany({ where: { userId: req.userId } }),
    ])

    const totalCredits = grades.reduce((sum, g) => sum + g.credits, 0)
    const weightedGpa = grades.reduce((sum, g) => sum + g.gpa * g.credits, 0)
    const cgpa = totalCredits > 0 ? weightedGpa / totalCredits : 0

    const totalClasses = attendance.length
    const presentClasses = attendance.filter((a) => a.status === 'PRESENT').length
    const attendancePercent = totalClasses > 0 ? (presentClasses / totalClasses) * 100 : 0

    const prompt = `Analyze this student's academic performance:
CGPA: ${cgpa.toFixed(2)}/10
Attendance: ${attendancePercent.toFixed(1)}%
Grades: ${grades.map((g) => `${g.courseName}: ${g.grade}`).join(', ')}
Courses with low attendance: ${attendance.filter((a) => a.status === 'ABSENT').map((a) => a.courseName).join(', ') || 'None'}

Provide:
1. Overall assessment
2. Areas of strength
3. Areas needing improvement
4. 3 actionable recommendations`

    const insights = await chatWithAI(prompt)
    res.json({ insights, cgpa, attendancePercent })
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate insights' })
  }
})

export default router