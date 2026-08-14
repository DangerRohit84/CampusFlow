import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { createServer } from 'http'
import cron from 'node-cron'
import rateLimit from 'express-rate-limit'
import { config } from './config'
import { initSocket } from './services/socket'
import { fetchAndStoreContests } from './services/contestFetcher'

import { syncAllUsers } from './services/syncEngine'
import { errorHandler } from './middleware/errorHandler'
import authRoutes from './routes/auth'
import scheduleRoutes from './routes/schedules'
import assignmentRoutes from './routes/assignments'
import notificationRoutes from './routes/notifications'
import chatRoutes from './routes/chat'
import userRoutes from './routes/user'
import searchRoutes from './routes/search'
import aiRoutes from './routes/ai'
import taskRoutes from './routes/tasks'
import timetableRoutes from './routes/timetable'
import hackathonRoutes from './routes/hackathons'
import contestRoutes from './routes/contests'
import formRoutes from './routes/forms'
import adminRoutes from './routes/admin'
import departmentRoutes from './routes/departments'
import roomsRouter from './routes/rooms'
import internshipsRouter from './routes/internships'
import codingProfileRoutes from './routes/codingProfile'

import prisma from './config/db'

const app = express()
const httpServer = createServer(app)

// Initialize WebSocket
initSocket(httpServer)

// Middleware
app.use(helmet({ crossOriginResourcePolicy: false }))
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000,http://localhost:5173').split(',').map((o: string) => o.trim())
app.use(cors({ origin: (origin, callback) => { if (!origin || allowedOrigins.includes(origin)) { callback(null, true) } else { callback(new Error('Not allowed by CORS')) } }, credentials: true }))
app.use(express.json({ limit: '10mb' }))

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts, please try again later' },
})

// Health check
app.get('/api/health', async (_req, res) => {
  let dbStatus = 'ok'
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch {
    dbStatus = 'error'
  }
  res.json({
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    service: 'CampusFlow API',
    version: '1.0.0',
    db: dbStatus,
    features: ['auth', 'schedules', 'assignments', 'notifications', 'chat', 'ai', 'search', 'websocket', 'hackathons', 'rooms', 'internships'],
  })
})

// Public: Register college (no auth required) - rate limited
app.post('/api/colleges/register', rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts, please try again later' },
}), async (req, res) => {
  try {
    const { name, code, address, phone, website, adminEmail } = req.body

    if (!name || !code || !adminEmail) {
      res.status(400).json({ error: 'Name, code, and admin email are required' })
      return
    }

    const existing = await prisma.college.findFirst({
      where: { OR: [{ name }, { code }] },
    })
    if (existing) {
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
        adminEmail,
        status: 'PENDING',
      },
    })

    res.status(201).json(college)
  } catch (error) {
    console.error('Public college register error:', error)
    res.status(500).json({ error: 'Failed to register college' })
  }
})

// Public: List approved colleges for registration dropdown (no auth required)
app.get('/api/colleges/list', async (_req, res) => {
  try {
    const colleges = await prisma.college.findMany({
      where: { status: 'APPROVED' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
    res.json(colleges)
  } catch (error) {
    console.error('Public college list error:', error)
    res.status(500).json({ error: 'Failed to fetch colleges' })
  }
})

// Public: Get departments for a college (no auth required)
app.get('/api/colleges/:id/departments', async (req, res) => {
  try {
    const departments = await prisma.department.findMany({
      where: { collegeId: req.params.id },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
    res.json(departments)
  } catch (error) {
    console.error('Public college departments error:', error)
    res.status(500).json({ error: 'Failed to fetch departments' })
  }
})

// API Routes
app.use('/api/auth/login', authLimiter)
app.use('/api/auth/register', authLimiter)
app.use('/api/auth', authRoutes)
app.use('/api/schedules', generalLimiter, scheduleRoutes)
app.use('/api/assignments', generalLimiter, assignmentRoutes)
app.use('/api/notifications', generalLimiter, notificationRoutes)
app.use('/api/chat', generalLimiter, chatRoutes)
app.use('/api/user', generalLimiter, userRoutes)
app.use('/api/search', generalLimiter, searchRoutes)
app.use('/api/ai', generalLimiter, aiRoutes)
app.use('/api/tasks', generalLimiter, taskRoutes)
app.use('/api/timetable', generalLimiter, timetableRoutes)
app.use('/api/hackathons', generalLimiter, hackathonRoutes)
app.use('/api/contests', generalLimiter, contestRoutes)
app.use('/api/forms', generalLimiter, formRoutes)
app.use('/api/admin', generalLimiter, adminRoutes)
app.use('/api/departments', generalLimiter, departmentRoutes)
app.use('/api/rooms', generalLimiter, roomsRouter)
app.use('/api/internships', generalLimiter, internshipsRouter)
app.use('/api/coding-profile', generalLimiter, codingProfileRoutes)


// 404 handler
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' })
})

// Error handler
app.use(errorHandler)

// Start server
const PORT = config.port
httpServer.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════════════════════╗
  ║          CampusFlow API Server v1.0            ║
  ║────────────────────────────────────────────────║
  ║  🚀 Running on http://localhost:${PORT}           ║
  ║  📡 WebSocket enabled (Socket.IO)             ║
  ║  🔐 JWT authentication                         ║
  ║  🤖 Groq AI integration                        ║
  ║  🔍 Search API enabled                         ║
  ║  📊 AI Insights & Study Plans                  ║
  ╚════════════════════════════════════════════════╝
  `)
})

// Schedule contest fetch every 6 hours
cron.schedule('0 */6 * * *', async () => {
  console.log('[Cron] Running contest fetch...')
  try {
    await fetchAndStoreContests()
  } catch (error) {
    console.error('[Cron] Contest fetch failed:', error)
  }
})



// Cron: sync contest participation every 6 hours
setInterval(async () => {
  try {
    console.log('[CRON] Starting contest participation sync...')
    const result = await syncAllUsers()
    console.log(`[CRON] Synced ${result.totalSynced} records from ${result.totalUsers} users`)
  } catch (err) {
    console.error('[CRON] Sync failed:', err)
  }
}, 6 * 60 * 60 * 1000) // every 6 hours

// Initial fetch on server start
fetchAndStoreContests().catch(console.error)

// Cron: fetch opportunities (hackathons + internships) every 12 hours
cron.schedule('0 */12 * * *', async () => {
  console.log('[Cron] Fetching opportunities from external sources...')
  try {
    const { fetchFromAllSources, enrichHackathonStaging, enrichInternshipStaging } = await import('./services/opportunityAgent')

    // Find an admin to own the staging records
    const admin = await prisma.user.findFirst({
      where: { role: { in: ['SUPER_ADMIN', 'COLLEGE_ADMIN'] } },
    })
    if (!admin) {
      console.log('[Cron] No admin user found, skipping opportunity fetch')
      return
    }

    const allOpps = await fetchFromAllSources()
    let hackathonFetched = 0, hackathonSkipped = 0
    let internshipFetched = 0, internshipSkipped = 0
    const hackathonIdsToEnrich: string[] = []
    const internshipIdsToEnrich: string[] = []

    // Process hackathons
    const hackathons = allOpps.filter(o => o.type === 'HACKATHON')
    for (const opp of hackathons) {
      if (!opp.url || !opp.title) { hackathonSkipped++; continue }
      try {
        const existing = await prisma.hackathonStaging.findFirst({
          where: { title: opp.title, source: opp.source },
        })
        if (existing) { hackathonSkipped++; continue }

        const created = await prisma.hackathonStaging.create({
          data: {
            title: opp.title,
            description: opp.description || null,
            url: opp.url,
            organizer: opp.organizer || null,
            deadline: opp.deadline ? new Date(opp.deadline) : null,
            startDate: opp.startDate ? new Date(opp.startDate) : null,
            duration: opp.duration || null,
            location: opp.location || null,
            mode: opp.mode || null,
            prizePool: opp.prizePool || null,
            themes: JSON.stringify(opp.themes || []),
            website: opp.website || null,
            discord: opp.discord || null,
            participantsCount: opp.participantsCount || 0,
            inviteOnly: opp.inviteOnly || false,
            status: 'DRAFT',
            source: opp.source,
            creatorId: admin.id,
            collegeId: admin.collegeId!,
          },
        })
        hackathonFetched++
        hackathonIdsToEnrich.push(created.id)
      } catch { hackathonSkipped++ }
    }

    // Process internships
    const internships = allOpps.filter(o => o.type === 'INTERNSHIP')
    for (const opp of internships) {
      if (!opp.url || !opp.title) { internshipSkipped++; continue }
      try {
        const existing = await prisma.internshipStaging.findFirst({
          where: { title: opp.title, source: opp.source },
        })
        if (existing) { internshipSkipped++; continue }

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
            creatorId: admin.id,
            collegeId: admin.collegeId!,
          },
        })
        internshipFetched++
        internshipIdsToEnrich.push(created.id)
      } catch { internshipSkipped++ }
    }

    console.log(`[Cron] Opportunities: ${hackathonFetched} hackathons + ${internshipFetched} internships fetched, ${hackathonSkipped + internshipSkipped} skipped`)

    // Enrich sequentially with delay between each to avoid rate limits
    const ENRICH_DELAY_MS = 12000

    async function enrichSequentially(ids: string[], enrichFn: (id: string) => Promise<void>, label: string) {
      for (let i = 0; i < ids.length; i++) {
        console.log(`[Cron] Enriching ${label} ${i + 1}/${ids.length}`)
        await enrichFn(ids[i]).catch(() => {})
        if (i < ids.length - 1) {
          await new Promise(r => setTimeout(r, ENRICH_DELAY_MS))
        }
      }
    }

    await enrichSequentially(hackathonIdsToEnrich, enrichHackathonStaging, 'hackathons')
    await enrichSequentially(internshipIdsToEnrich, enrichInternshipStaging, 'internships')
  } catch (err) {
    console.error('[Cron] Opportunity fetch failed:', err)
  }
})

export { app, httpServer }