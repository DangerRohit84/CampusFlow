import { Router, Response } from 'express'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import ExcelJS from 'exceljs'
import Groq from 'groq-sdk'
import { config } from '../config'

const router = Router()
router.use(authenticate)

const hasAI = config.groqApiKey && config.groqApiKey !== 'your-groq-api-key-here'
const groq = hasAI ? new Groq({ apiKey: config.groqApiKey }) : null

// GET / - List internships (filtered by eligibility for students)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    let internships = await prisma.internship.findMany({
      where: { collegeId: user.collegeId! },
      include: { registrations: { where: { userId: req.userId } } },
      orderBy: { createdAt: 'desc' },
    })

    // Filter by eligibility for students
    if (user.role === 'STUDENT' && user.departmentId) {
      internships = internships.filter((i) => {
        if (!i.eligibilityEnabled) return true
        const depts = JSON.parse(i.targetDepartments) as string[]
        const years = JSON.parse(i.targetYears) as number[]
        const deptMatch = depts.length === 0 || depts.includes(user.departmentId!)
        const currentYear = user.incomingYear
          ? Math.min(new Date().getFullYear() - user.incomingYear + 1, 4)
          : 1
        const yearMatch = years.length === 0 || years.includes(currentYear)
        return deptMatch && yearMatch
      })
    }

    // Add computed status
    const result = internships.map((i) => ({
      ...i,
      computedStatus: i.status === 'ENDED' || (i.deadline && new Date(i.deadline) < new Date()) ? 'ENDED' : 'ACTIVE',
    }))

    res.json(result)
  } catch (error) {
    console.error('Error listing internships:', error)
    res.status(500).json({ error: 'Failed to list internships' })
  }
})

// GET /:id - Get single internship with registrations
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const internship = await prisma.internship.findUnique({
      where: { id: req.params.id },
      include: {
        registrations: { include: { user: { select: { id: true, name: true, email: true, studentId: true } } } },
        creator: { select: { id: true, name: true, email: true } },
      },
    })
    if (!internship) {
      res.status(404).json({ error: 'Internship not found' })
      return
    }
    res.json(internship)
  } catch (error) {
    console.error('Error getting internship:', error)
    res.status(500).json({ error: 'Failed to get internship' })
  }
})

// POST / - Create internship (teacher only)
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can create internships' })
      return
    }

    const { title, description, company, role, url, stipend, duration, mode, startDate, deadline, targetDepartments, targetYears, eligibilityEnabled } = req.body

    const internship = await prisma.internship.create({
      data: {
        title,
        description,
        company,
        role,
        url,
        stipend: stipend || null,
        duration: duration || null,
        mode: mode || 'REMOTE',
        startDate: startDate || null,
        deadline: deadline || null,
        targetDepartments: JSON.stringify(targetDepartments || []),
        targetYears: JSON.stringify(targetYears || []),
        eligibilityEnabled: eligibilityEnabled || false,
        creatorId: req.userId!,
        collegeId: user.collegeId,
      },
    })

    res.status(201).json(internship)
  } catch (error) {
    console.error('Error creating internship:', error)
    res.status(500).json({ error: 'Failed to create internship' })
  }
})

// DELETE /:id - Delete internship (creator or admin only)
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const internship = await prisma.internship.findUnique({ where: { id: req.params.id } })
    if (!internship) {
      res.status(404).json({ error: 'Internship not found' })
      return
    }
    if (internship.creatorId !== req.userId) {
      const user = await prisma.user.findUnique({ where: { id: req.userId! } })
      if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
        res.status(403).json({ error: 'Not authorized' })
        return
      }
    }
    await prisma.internship.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting internship:', error)
    res.status(500).json({ error: 'Failed to delete internship' })
  }
})

// POST /:id/register - Student registers
router.post('/:id/register', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user || user.role !== 'STUDENT') {
      res.status(403).json({ error: 'Only students can register' })
      return
    }

    const existing = await prisma.internshipRegistration.findUnique({
      where: { internshipId_userId: { internshipId: req.params.id, userId: req.userId! } },
    })
    if (existing) {
      res.status(400).json({ error: 'Already registered' })
      return
    }

    const registration = await prisma.internshipRegistration.create({
      data: { internshipId: req.params.id, userId: req.userId!, status: 'REGISTERED' },
    })

    res.status(201).json(registration)
  } catch (error) {
    console.error('Error registering for internship:', error)
    res.status(500).json({ error: 'Failed to register' })
  }
})

// PUT /:id/report - Student self-reports status
router.put('/:id/report', async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.body
    if (!['SELECTED', 'REJECTED'].includes(status)) {
      res.status(400).json({ error: 'Status must be SELECTED or REJECTED' })
      return
    }

    const registration = await prisma.internshipRegistration.findUnique({
      where: { internshipId_userId: { internshipId: req.params.id, userId: req.userId! } },
    })
    if (!registration) {
      res.status(404).json({ error: 'Not registered' })
      return
    }

    const updated = await prisma.internshipRegistration.update({
      where: { id: registration.id },
      data: { status, reportedAt: new Date() },
    })

    res.json(updated)
  } catch (error) {
    console.error('Error reporting status:', error)
    res.status(500).json({ error: 'Failed to report status' })
  }
})

// GET /:id/registrations - Get all registrations (teacher only)
router.get('/:id/registrations', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN')) {
      res.status(403).json({ error: 'Not authorized' })
      return
    }

    const registrations = await prisma.internshipRegistration.findMany({
      where: { internshipId: req.params.id },
      include: { user: { select: { id: true, name: true, email: true, studentId: true, departmentId: true } } },
    })

    res.json(registrations)
  } catch (error) {
    console.error('Error getting registrations:', error)
    res.status(500).json({ error: 'Failed to get registrations' })
  }
})

// PUT /:id/registrations/:regId - Update registration status (teacher)
router.put('/:id/registrations/:regId', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN')) {
      res.status(403).json({ error: 'Not authorized' })
      return
    }

    const { status } = req.body
    const updated = await prisma.internshipRegistration.update({
      where: { id: req.params.regId },
      data: { status },
    })

    res.json(updated)
  } catch (error) {
    console.error('Error updating registration:', error)
    res.status(500).json({ error: 'Failed to update registration' })
  }
})

// GET /export/:id - Export registrations as Excel
router.get('/export/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN')) {
      res.status(403).json({ error: 'Not authorized' })
      return
    }

    const internship = await prisma.internship.findUnique({ where: { id: req.params.id } })
    if (!internship) {
      res.status(404).json({ error: 'Internship not found' })
      return
    }

    const registrations = await prisma.internshipRegistration.findMany({
      where: { internshipId: req.params.id },
      include: { user: { select: { name: true, email: true, studentId: true } } },
    })

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'CampusFlow'
    workbook.created = new Date()
    const sheet = workbook.addWorksheet('Registrations')
    sheet.columns = [
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Roll Number', key: 'studentId', width: 15 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Reported At', key: 'reportedAt', width: 20 },
    ]

    registrations.forEach((r) => {
      sheet.addRow({
        name: r.user.name,
        email: r.user.email,
        studentId: r.user.studentId,
        status: r.status,
        reportedAt: r.reportedAt?.toISOString() || 'N/A',
      })
    })

    const buffer = await workbook.xlsx.writeBuffer()
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${internship.title}-registrations.xlsx"`)
    res.send(Buffer.from(buffer as any))
  } catch (error) {
    console.error('Error exporting registrations:', error)
    res.status(500).json({ error: 'Failed to export' })
  }
})

// GET /export-all - Export all internships
router.get('/export-all', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const internships = await prisma.internship.findMany({
      where: { collegeId: user.collegeId! },
      include: { registrations: true },
      orderBy: { createdAt: 'desc' },
    })

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'CampusFlow'
    workbook.created = new Date()
    const sheet = workbook.addWorksheet('Internships')
    sheet.columns = [
      { header: 'Title', key: 'title', width: 30 },
      { header: 'Company', key: 'company', width: 20 },
      { header: 'Role', key: 'role', width: 20 },
      { header: 'Mode', key: 'mode', width: 12 },
      { header: 'Stipend', key: 'stipend', width: 15 },
      { header: 'Duration', key: 'duration', width: 15 },
      { header: 'Deadline', key: 'deadline', width: 15 },
      { header: 'Registrations', key: 'regCount', width: 15 },
      { header: 'Selected', key: 'selected', width: 12 },
    ]

    internships.forEach((i) => {
      sheet.addRow({
        title: i.title,
        company: i.company,
        role: i.role,
        mode: i.mode,
        stipend: i.stipend || 'N/A',
        duration: i.duration || 'N/A',
        deadline: i.deadline || 'N/A',
        regCount: i.registrations.length,
        selected: i.registrations.filter((r) => r.status === 'SELECTED').length,
      })
    })

    const buffer = await workbook.xlsx.writeBuffer()
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="internships.xlsx"')
    res.send(Buffer.from(buffer as any))
  } catch (error) {
    console.error('Error exporting internships:', error)
    res.status(500).json({ error: 'Failed to export' })
  }
})

// POST /fetch-details - AI extract internship details from URL
router.post('/fetch-details', async (req: AuthRequest, res: Response) => {
  try {
    const { url } = req.body
    if (!url) {
      res.status(400).json({ error: 'URL is required' })
      return
    }

    if (!groq) {
      res.status(503).json({ error: 'AI service not configured' })
      return
    }

    // Fetch page content
    let pageContent = ''
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      })
      const html = await response.text()
      clearTimeout(timeout)
      pageContent = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 8000)
    } catch {
      console.log('Could not fetch URL content, sending URL only to AI')
    }

    const contentSection = pageContent.length > 300
      ? `Page content:\n${pageContent}`
      : `Page content: (SPA/JavaScript-rendered page - content not available via fetch)`

    const prompt = `Extract internship details from the following sources. URL: ${url}

${contentSection}

Return ONLY a valid JSON object with these fields:
{
  "title": "internship title",
  "company": "company name",
  "role": "specific role/designation",
  "description": "brief description (2-3 sentences)",
  "stipend": "stipend like ₹15,000/month or Unpaid",
  "duration": "like 3 months, 6 months",
  "mode": "REMOTE, ONSITE, or HYBRID",
  "deadline": "application deadline YYYY-MM-DD or null",
  "url": "application URL (the original URL provided)"
}

CRITICAL RULES:
1. NEVER fabricate information not present in the content.
2. NEVER make up dates unless explicitly found. Set to null if not found.
3. Return ONLY the JSON object, no other text:`

    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      max_tokens: 1000,
    })

    const responseText = completion.choices[0]?.message?.content || '{}'
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const details = JSON.parse(jsonMatch[0])
      res.json({ details })
    } else {
      res.json({ message: 'Could not extract details. Please fill manually.', details: null })
    }
  } catch (error) {
    console.error('AI fetch internship details error:', error)
    res.status(500).json({ error: 'Failed to fetch details' })
  }
})

export default router
