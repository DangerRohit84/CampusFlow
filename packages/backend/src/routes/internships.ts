import { Router, Response } from 'express'
import rateLimit from 'express-rate-limit'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import ExcelJS from 'exceljs'
import { chatCompletion } from '../ai/client'
import { canAccessCollege, deriveCollegeId, getSuperAdminTargetCollegeId } from '../utils/roles'
import { validateExternalUrl } from '../utils/secureUrl'
import { broadcastInternshipMutation } from '../services/socket'

const router = Router()
router.use(authenticate)

// SSRF fetch-details rate limit: 10/hour per IP+user (audit HIGH #2)
const fetchLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many fetch attempts, please try again later' },
})

// AI now uses AI Manager routing via src/ai/client.ts

// GET / - List internships (paginated, indexed, eligibility-aware)
// SUPER_ADMIN: global view (or ?collegeId= filter), bypasses tenant isolation
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const isSuper = user.role === 'SUPER_ADMIN'
    const filterCollegeId = isSuper ? ((getSuperAdminTargetCollegeId(req) as string | undefined) || (req.query.collegeId as string | undefined)) : undefined

    if (!isSuper && !user.collegeId) {
      res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60')
      res.json({ data: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } })
      return
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20))
    const skip = (page - 1) * limit
    const search = (req.query.search as string)?.trim()

    let where: any = {}
    if (isSuper) {
      if (filterCollegeId) where = { collegeId: filterCollegeId }
      // else {} — global across all colleges, plus null global internships
    } else {
      where = { collegeId: user.collegeId }
    }
    if (search) {
      const s: any = { contains: search, mode: 'insensitive' }
      const searchClause = { OR: [{ title: s }, { company: s }, { role: s }] } as any
      if (isSuper && !filterCollegeId) {
        where = searchClause
      } else {
        const baseCollege = isSuper && filterCollegeId ? { collegeId: filterCollegeId } : { collegeId: user.collegeId }
        where = { AND: [baseCollege, searchClause] }
      }
    }

    // Use _count instead of loading full registrations arrays; include only current user's registration flag via _count filtered?
    // Fetch total + page data with count aggregation
    const [all, totalRaw] = await Promise.all([
      prisma.internship.findMany({
        where,
        include: {
          _count: { select: { registrations: true } },
          registrations: { where: { userId: req.userId }, select: { id: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.internship.count({ where }),
    ])

    // Eligibility filtering must happen before pagination for correctness, but doing in DB is not possible with JSON strings.
    // Optimized: fetch count-aware page then filter, and if student filtering reduces too much, fetch extra.
    // For now filter the page slice (fast path); total will be adjusted for student view.
    let internships: any[] = all
    let total = totalRaw
    if (user.role === 'STUDENT' && user.departmentId) {
      const filtered = all.filter((i) => {
        if (!i.eligibilityEnabled) return true
        try {
          const depts = JSON.parse(i.targetDepartments) as string[]
          const years = JSON.parse(i.targetYears) as number[]
          const deptMatch = depts.length === 0 || depts.includes(user.departmentId!)
          const currentYear = user.incomingYear ? Math.min(new Date().getFullYear() - user.incomingYear + 1, 4) : 1
          const yearMatch = years.length === 0 || years.includes(currentYear)
          return deptMatch && yearMatch
        } catch { return true }
      })
      // If filtering removed items, we still return filtered page; total is at least filtered length for UI.
      // For accuracy, compute filtered total by scanning all ids when needed (only once)
      internships = filtered
      // For filtered total, do a full scan only when page===1 to avoid O(n) on every page; otherwise estimate
      if (page === 1) {
        const allForCount = await prisma.internship.findMany({
          where: { collegeId: user.collegeId! },
          select: { targetDepartments: true, targetYears: true, eligibilityEnabled: true },
        })
        total = allForCount.filter((i) => {
          if (!i.eligibilityEnabled) return true
          try {
            const depts = JSON.parse(i.targetDepartments as string) as string[]
            const years = JSON.parse(i.targetYears as string) as number[]
            const deptMatch = depts.length === 0 || depts.includes(user.departmentId!)
            const currentYear = user.incomingYear ? Math.min(new Date().getFullYear() - user.incomingYear + 1, 4) : 1
            const yearMatch = years.length === 0 || years.includes(currentYear)
            return deptMatch && yearMatch
          } catch { return true }
        }).length
      }
    }

    const data = internships.map((i: any) => ({
      ...i,
      registrationsCount: i._count?.registrations ?? 0,
      registrations: i.registrations, // keep user's own registration for isRegistered check
      _count: undefined,
      computedStatus: i.status === 'ENDED' || (i.deadline && new Date(i.deadline) < new Date()) ? 'ENDED' : 'ACTIVE',
    }))

    const pages = Math.ceil(total / limit)
    const makeLink = (p: number) => {
      const params = new URLSearchParams({ page: String(p), limit: String(limit) })
      if (search) params.set('search', search)
      return `<${req.baseUrl}${req.path}?${params.toString()}>`
    }
    const links: string[] = []
    if (page < pages) links.push(`${makeLink(page + 1)}; rel="next"`)
    if (page > 1) links.push(`${makeLink(page - 1)}; rel="prev"`)
    links.push(`${makeLink(1)}; rel="first"`)
    if (pages > 0) links.push(`${makeLink(pages)}; rel="last"`)
    if (links.length) res.set('Link', links.join(', '))
    // Backward compat: if client didn't request pagination, also support ?page-less callers expecting array
    // But we always return paginated; frontend will handle both shapes.
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60, s-maxage=120, stale-while-revalidate=300')
    res.json({
      data,
      pagination: { page, limit, total, pages },
    })
  } catch (error) {
    console.error('Error listing internships:', error)
    res.status(500).json({ error: 'Failed to list internships' })
  }
})

// GET /staging - List staging internships with pagination (admin/teacher only)
router.get('/staging', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }

    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 20
    const status = req.query.status as string | undefined
    const skip = (page - 1) * limit

    // No deadline filter for admin staging — show all pending including expired (visually marked Expired)
    let where: any = {}
    if (status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
      // Items can be DRAFT (fetched), PENDING (admin-created), or ACTIVE (fetched external)
      if (status === 'PENDING') {
        where.status = { in: ['DRAFT', 'PENDING', 'ACTIVE'] }
      } else {
        where.status = status
      }
    }
    // When listing for review, only show enriched items (have departments)
    if (status === 'PENDING' || !status) {
      where.targetDepartments = { not: '[]' }
    }
    // College filter: college_admin/teacher sees own college + global (collegeId null) so Cognition appears; superadmin keeps where {}
    if (user.role !== 'SUPER_ADMIN') {
      where = Object.keys(where).length
        ? { AND: [where, { OR: [{ collegeId: user.collegeId }, { collegeId: null }] }] }
        : { OR: [{ collegeId: user.collegeId }, { collegeId: null }] }
    }

    const [internships, total] = await Promise.all([
      prisma.internshipStaging.findMany({
        orderBy: [
          { deadline: 'asc' },
          { createdAt: 'desc' },
        ],
        where,
        skip,
        take: limit,
      }),
      prisma.internshipStaging.count({ where }),
    ])

    res.json({
      data: internships,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Get staging internships error:', error)
    res.status(500).json({ error: 'Failed to fetch staging internships' })
  }
})

// GET /staging/counts - Get staging counts (independent of pagination)
router.get('/staging/counts', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    // No deadline filter — counts must reflect all pending including expired
    let countsWhere: any = {}
    if (user && user.role !== 'SUPER_ADMIN') {
      countsWhere = { OR: [{ collegeId: user.collegeId }, { collegeId: null }] }
    }
    const all = await prisma.internshipStaging.findMany({
      select: { targetDepartments: true, status: true },
      where: countsWhere,
    })
    let total = 0, enriched = 0, pending = 0, approved = 0, rejected = 0
    for (const item of all) {
      const depts = JSON.parse(item.targetDepartments || '[]')
      total++
      if (depts.length > 0) enriched++
      if (item.status === 'APPROVED') approved++
      else if (item.status === 'REJECTED') rejected++
      else if (depts.length > 0) pending++
    }
    res.json({ total, enriched, pending, approved, rejected })
  } catch (error) {
    console.error('Error fetching internship staging counts:', error)
    res.status(500).json({ error: 'Failed to fetch counts' })
  }
})

// GET /staging/:id - Get single staging internship
router.get('/staging/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }

    const internship = await prisma.internshipStaging.findUnique({
      where: { id: req.params.id as string },
    })
    if (!internship) {
      res.status(404).json({ error: 'Staging internship not found' })
      return
    }
    res.json(internship)
  } catch (error) {
    console.error('Get staging internship error:', error)
    res.status(500).json({ error: 'Failed to fetch staging internship' })
  }
})

// GET /:id - Get single internship with registrations - tenant isolated (PII)
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const internship = await prisma.internship.findUnique({
      where: { id: req.params.id as string },
      include: {
        registrations: { include: { user: { select: { id: true, name: true, email: true, studentId: true, department: true, departmentId: true, incomingYear: true, departmentName: true } } } },
        creator: { select: { id: true, name: true, email: true } },
      },
    })
    if (!internship) {
      res.status(404).json({ error: 'Internship not found' })
      return
    }
    // Tenant check: hide cross-college internships (list already filters, but direct ID must also deny)
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (user && !canAccessCollege(user as any, (internship as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    res.json(internship)
  } catch (error) {
    console.error('Error getting internship:', error)
    res.status(500).json({ error: 'Failed to get internship' })
  }
})

// POST / - Create internship (teacher/admin/super)
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers and admins can create internships' })
      return
    }

    const { title, description, company, role, url, stipend, duration, mode, startDate, deadline, targetDepartments, targetYears, eligibilityEnabled, collegeId: bodyCollegeId } = req.body
    const derivedCollegeId = deriveCollegeId(user as any, bodyCollegeId as string | null | undefined, req)
    if (!derivedCollegeId) {
      res.status(400).json({ error: 'College ID is required' })
      return
    }

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
        collegeId: derivedCollegeId,
      },
    })

    try { broadcastInternshipMutation({ internshipId: internship.id, collegeId: derivedCollegeId, action: 'created' }) } catch {}
    res.status(201).json(internship)
  } catch (error) {
    console.error('Error creating internship:', error)
    res.status(500).json({ error: 'Failed to create internship' })
  }
})

// DELETE /:id - Delete internship (creator or admin only) - tenant isolated
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const internship = await prisma.internship.findUnique({ where: { id: req.params.id as string } })
    if (!internship) {
      res.status(404).json({ error: 'Internship not found' })
      return
    }
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user) {
      res.status(403).json({ error: 'Not authorized' })
      return
    }
    // HIGH BOLA fix: tenant isolation — only same college (or SUPER_ADMIN) may delete
    if (!canAccessCollege(user as any, internship.collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    const isOwner = internship.creatorId === req.userId
    const isSuper = user.role === 'SUPER_ADMIN'
    const isCollegeAdminSameCollege = user.role === 'COLLEGE_ADMIN' && internship.collegeId === user.collegeId
    if (!isOwner && !isSuper && !isCollegeAdminSameCollege) {
      res.status(403).json({ error: 'Not authorized' })
      return
    }
    await prisma.internship.delete({ where: { id: req.params.id as string } })
    try { broadcastInternshipMutation({ internshipId: req.params.id as string, action: 'deleted' }) } catch {}
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
      where: { internshipId_userId: { internshipId: req.params.id as string, userId: req.userId! } },
    })
    if (existing) {
      res.status(400).json({ error: 'Already registered' })
      return
    }

    const registration = await prisma.internshipRegistration.create({
      data: { internshipId: req.params.id as string, userId: req.userId!, status: 'REGISTERED' },
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
      where: { internshipId_userId: { internshipId: req.params.id as string, userId: req.userId! } },
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

// GET /:id/registrations - Get all registrations (teacher/admin/super) - tenant isolated
router.get('/:id/registrations', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Not authorized' })
      return
    }
    const internship = await prisma.internship.findUnique({ where: { id: req.params.id as string }, select: { collegeId: true } })
    if (!internship) {
      res.status(404).json({ error: 'Internship not found' })
      return
    }
    if (!canAccessCollege(user as any, internship.collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }

    const registrations = await prisma.internshipRegistration.findMany({
      where: { internshipId: req.params.id as string },
      include: { user: { select: { id: true, name: true, email: true, studentId: true, department: true, departmentId: true, incomingYear: true } } },
    })

    res.json(registrations)
  } catch (error) {
    console.error('Error getting registrations:', error)
    res.status(500).json({ error: 'Failed to get registrations' })
  }
})

// PUT /:id/registrations/:regId - Update registration status (teacher/admin/super) - tenant isolated
router.put('/:id/registrations/:regId', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Not authorized' })
      return
    }
    const internship = await prisma.internship.findUnique({ where: { id: req.params.id as string }, select: { collegeId: true } })
    if (!internship) {
      res.status(404).json({ error: 'Internship not found' })
      return
    }
    if (!canAccessCollege(user as any, internship.collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }

    const { status } = req.body
    const updated = await prisma.internshipRegistration.update({
      where: { id: req.params.regId as string },
      data: { status },
    })

    res.json(updated)
  } catch (error) {
    console.error('Error updating registration:', error)
    res.status(500).json({ error: 'Failed to update registration' })
  }
})

// GET /export/:id - Export registrations as Excel - tenant isolated
router.get('/export/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Not authorized' })
      return
    }

    const internship = await prisma.internship.findUnique({ where: { id: req.params.id as string } })
    if (!internship) {
      res.status(404).json({ error: 'Internship not found' })
      return
    }
    if (!canAccessCollege(user as any, internship.collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }

    const registrations = await prisma.internshipRegistration.findMany({
      where: { internshipId: req.params.id as string },
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

    const collegeFilter = user.role === 'SUPER_ADMIN' ? {} : { collegeId: user.collegeId! }
    const internships = await prisma.internship.findMany({
      where: collegeFilter,
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

// POST /fetch-details - AI extract internship details from URL - SSRF protected + rate limited
router.post('/fetch-details', fetchLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const { url } = req.body
    if (!url) {
      res.status(400).json({ error: 'URL is required' })
      return
    }

    // HIGH SSRF fix: validate URL before fetching (block private IP / metadata / bad schemes)
    try {
      await validateExternalUrl(String(url))
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'Invalid URL' })
      return
    }

    // AI Manager handles provider resolution

    // Fetch page content - SSRF hardened: manual redirect, 10s timeout, size cap 2MB
    let pageContent = ''
    try {
      const response = await fetch(String(url), {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        redirect: 'manual',
      } as any)
      // Block redirects to private hosts (manual prevents auto-follow)
      if (response.status >= 300 && response.status < 400) {
        throw new Error('Redirect blocked')
      }
      // Size cap
      const len = Number(response.headers.get('content-length') || 0)
      if (len > 2 * 1024 * 1024) throw new Error('Response too large')
      const html = await response.text()
      if (html.length > 2 * 1024 * 1024) throw new Error('Response too large')
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
  "url": "application URL (the original URL provided)",
  "targetDepartments": ["CSE", "IT", "ECE", "EEE", "MECH", "CIVIL"] - ONLY if explicitly mentioned, otherwise [],
  "targetYears": [1, 2, 3, 4] - ONLY if explicitly mentioned, otherwise []
}

CRITICAL RULES:
1. NEVER fabricate information not present in the content.
2. NEVER make up dates unless explicitly found. Set to null if not found.
3. For targetDepartments: ANALYZE the role and description to INFER which departments have relevant skills. SOFTWARE (CSE, IT, AIDS, CSBS, CYS, DS, MCA), ELECTRICAL (ECE, EEE), MECHANICAL (MECH, AUTO, IE, CIVIL), BUSINESS (MBA). If software/developer role → CSE, IT, AIDS. If hardware/embedded → ECE, EEE. If mechanical → MECH. If marketing/business → MBA. If open to all → ["ALL"]. If nothing specific → [].
4. For targetYears: INFER from context. "fresher" → [1]. "2nd year" → [2]. "pre-final" → [3]. "final year" → [4]. "all years" → [1,2,3,4]. No info → [].
5. Return ONLY the JSON object, no other text:`

    // Use AI Manager routing (fetch feature)
    let responseText = ''
    try {
      responseText = await chatCompletion('fetch', [
        { role: 'user', content: prompt },
      ], { temperature: 0.1, max_tokens: 1000 })
    } catch (aiErr) {
      console.log('AI fetch failed for internship details:', aiErr)
    }

    let details: any = null
    try {
      const firstParse = JSON.parse(responseText)
      details = typeof firstParse === 'string' ? JSON.parse(firstParse) : firstParse
    } catch {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (jsonMatch) details = JSON.parse(jsonMatch[0])
    }
    if (details) {
      res.json({ details })
    } else {
      res.json({ message: 'Could not extract details. Please fill manually.', details: null })
    }
  } catch (error) {
    console.error('AI fetch internship details error:', error)
    res.status(500).json({ error: 'Failed to fetch details' })
  }
})

// POST /fetch-external - Trigger auto-fetch of internships from external sources (staging flow) - SUPER_ADMIN + rate limited
router.post('/fetch-external', fetchLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user || user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin access required' })
      return
    }

    const { fetchFromAllSources, enrichInternshipStaging } = await import('../services/opportunityAgent')
    const allOpps = await fetchFromAllSources()
    const internships = allOpps.filter(o => o.type === 'INTERNSHIP')

    let fetched = 0
    let skipped = 0
    const idsToEnrich: string[] = []

    for (const opp of internships) {
      if (!opp.url || !opp.title) { skipped++; continue }
      try {
        const existing = await prisma.internshipStaging.findFirst({
          where: { title: opp.title, source: opp.source },
        })
        if (existing) { skipped++; continue }

        const created = await prisma.internshipStaging.create({
          data: {
            title: opp.title,
            description: opp.description || 'No description available',
            company: opp.company || opp.organizer || 'Unknown',
            role: opp.role || opp.title,
            url: opp.url,
            stipend: opp.stipend || null,
            duration: opp.duration || null,
            mode: opp.mode || 'REMOTE',
            deadline: opp.deadline || null,
            startDate: opp.startDate || null,
            status: 'ACTIVE',
            source: opp.source,
            creatorId: user.id,
            collegeId: deriveCollegeId(user as any, null, req) || user.collegeId || null,
          },
        })
        fetched++
        idsToEnrich.push(created.id)
      } catch (err) {
        console.error(`Error storing internship staging "${opp.title}":`, err)
        skipped++
      }
    }

    console.log(`[Fetch] ${fetched} internships created — enriching in background`)

    // Enrich in background (don't block the response)
    const ENRICH_DELAY_MS = 12000
    ;(async () => {
      for (let i = 0; i < idsToEnrich.length; i++) {
        console.log(`[Fetch] Enriching internship ${i + 1}/${idsToEnrich.length}`)
        await enrichInternshipStaging(idsToEnrich[i]).catch(() => {})
        if (i < idsToEnrich.length - 1) {
          await new Promise(r => setTimeout(r, ENRICH_DELAY_MS))
        }
      }
      console.log(`[Fetch] Done — enriched ${idsToEnrich.length} internships`)
    })()

    try { broadcastInternshipMutation({ action: 'fetched', fetched, total: internships.length }) } catch {}
    res.json({ message: `Internship fetch complete`, fetched, skipped, total: internships.length })
  } catch (error) {
    console.error('Fetch external internships error:', error)
    res.status(500).json({ error: 'Failed to fetch external internships' })
  }
})

// POST /staging/:id/approve - Approve staging internship (move to main table)
router.post('/staging/:id/approve', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }

    const staging = await prisma.internshipStaging.findUnique({
      where: { id: req.params.id as string },
    })
    if (!staging) {
      res.status(404).json({ error: 'Staging internship not found' })
      return
    }
    const targetCollegeId = deriveCollegeId(user as any, (staging as any).collegeId as string | null | undefined, req) || (staging as any).collegeId || user.collegeId || getSuperAdminTargetCollegeId(req)
    if (!targetCollegeId) {
      res.status(400).json({ error: 'College ID required for internship approval' })
      return
    }

    const internship = await prisma.internship.create({
      data: {
        title: staging.title,
        description: staging.description,
        company: staging.company,
        role: staging.role,
        url: staging.url,
        stipend: staging.stipend,
        duration: staging.duration,
        mode: staging.mode,
        startDate: staging.startDate,
        deadline: staging.deadline,
        targetDepartments: staging.targetDepartments,
        targetYears: staging.targetYears,
        eligibilityEnabled: staging.eligibilityEnabled,
        status: 'ACTIVE',
        source: staging.source,
        creatorId: user.id,
        collegeId: targetCollegeId,
      },
    })

    // Mark as approved in staging (keep for approved tab)
    await prisma.internshipStaging.update({
      where: { id: req.params.id as string },
      data: { status: 'APPROVED' },
    })

    try { broadcastInternshipMutation({ internshipId: internship.id, stagingId: req.params.id as string, action: 'approved' }) } catch {}
    res.json({ message: 'Internship approved', internship })
  } catch (error) {
    console.error('Approve staging internship error:', error)
    res.status(500).json({ error: 'Failed to approve staging internship' })
  }
})

// POST /staging/:id/reject - Reject staging internship (update status to REJECTED)
router.post('/staging/:id/reject', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }

    const staging = await prisma.internshipStaging.findUnique({
      where: { id: req.params.id as string },
    })
    if (!staging) {
      res.status(404).json({ error: 'Staging internship not found' })
      return
    }

    await prisma.internshipStaging.update({
      where: { id: req.params.id as string },
      data: { status: 'REJECTED' },
    })

    try { broadcastInternshipMutation({ stagingId: req.params.id as string, action: 'rejected' }) } catch {}
    res.json({ message: 'Internship rejected' })
  } catch (error) {
    console.error('Reject staging internship error:', error)
    res.status(500).json({ error: 'Failed to reject staging internship' })
  }
})

// POST /staging/:id/assign - Assign staging internship to teacher
router.post('/staging/:id/assign', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'COLLEGE_ADMIN')) {
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

    const staging = await prisma.internshipStaging.findUnique({ where: { id: req.params.id as string } })
    if (!staging) {
      res.status(404).json({ error: 'Staging internship not found' })
      return
    }

    const updated = await prisma.internshipStaging.update({
      where: { id: req.params.id as string },
      data: { creatorId: teacherId },
    })

    try { broadcastInternshipMutation({ stagingId: req.params.id as string, action: 'staging:assigned', teacherId }) } catch {}
    res.json({ message: `Assigned to ${teacher.name}`, staging: updated })
  } catch (error) {
    console.error('Assign internship staging error:', error)
    res.status(500).json({ error: 'Failed to assign' })
  }
})

// POST /staging/assign-all - Assign ALL pending internships to teacher
router.post('/staging/assign-all', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'COLLEGE_ADMIN')) {
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

    const result = await prisma.internshipStaging.updateMany({
      where: { status: 'ACTIVE' },
      data: { creatorId: teacherId },
    })

    try { broadcastInternshipMutation({ action: 'staging:bulk-assigned', teacherId, count: result.count }) } catch {}
    res.json({ assigned: result.count, teacher: teacher.name })
  } catch (error) {
    console.error('Assign all internship staging error:', error)
    res.status(500).json({ error: 'Failed to assign all' })
  }
})

// POST /staging/re-enrich - Re-enrich all unenriched internship staging records
router.post('/staging/re-enrich', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } })
    if (!user || user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin access required' })
      return
    }

    const { enrichInternshipStaging } = await import('../services/opportunityAgent')

    // Find staging records with no targetDepartments OR no deadline (not fully enriched)
    const unenriched = await prisma.internshipStaging.findMany({
      where: {
        status: { not: 'REJECTED' },
        OR: [
          { targetDepartments: '[]' },
          { deadline: null },
        ],
      },
    })

    if (unenriched.length === 0) {
      res.json({ message: 'All internships already enriched', enriched: 0 })
      return
    }

    console.log(`[Re-enrich] Found ${unenriched.length} unenriched internships — enriching in background`)

    // Enrich in background (don't block the response)
    const ENRICH_DELAY_MS = 12000
    ;(async () => {
      for (let i = 0; i < unenriched.length; i++) {
        console.log(`[Re-enrich] Enriching internship ${i + 1}/${unenriched.length}`)
        await enrichInternshipStaging(unenriched[i].id).catch(() => {})
        if (i < unenriched.length - 1) {
          await new Promise(r => setTimeout(r, ENRICH_DELAY_MS))
        }
      }
      console.log(`[Re-enrich] Done — enriched ${unenriched.length} internships`)
    })()

    res.json({ message: `Enrichment started in background`, total: unenriched.length })
  } catch (error) {
    console.error('Re-enrich internships error:', error)
    res.status(500).json({ error: 'Failed to re-enrich' })
  }
})

export default router
