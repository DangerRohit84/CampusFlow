import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import path from 'path'
import { createServer } from 'http'
import cron from 'node-cron'
import rateLimit from 'express-rate-limit'
import { config } from './config'
import { initSocket } from './services/socket'
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
import roomsRouter, { blockedUploadExtensions } from './routes/rooms'
import internshipsRouter from './routes/internships'
import codingProfileRoutes from './routes/codingProfile'
import fetchRoutes from './routes/fetch'
import aiManagerRoutes from './routes/ai-manager'
import attendanceRoutes from './routes/attendance'
import gradesRoutes from './routes/grades'
import announcementsRoutes from './routes/announcements'
import internalCronRoutes, { runContestsJob, runProfileSyncJob, runOpportunitiesJob, runCleanupJob } from './routes/internalCron'

import prisma from './config/db'
import { storageMode } from './config/storage'

const app = express()
const httpServer = createServer(app)

// Initialize WebSocket
initSocket(httpServer)

// Middleware
app.use(helmet({ crossOriginResourcePolicy: false }))
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000,http://localhost:5173').split(',').map((o: string) => o.trim())
app.use(cors({ origin: (origin, callback) => { if (!origin || allowedOrigins.includes(origin)) { callback(null, true) } else { callback(new Error('Not allowed by CORS')) } }, credentials: true }))
app.use(express.json({ limit: '10mb' }))

// Serve uploaded files from local disk in local mode (production uses Cloudinary URLs).
// Resolves to packages/backend/uploads, matching storage.ts's LOCAL_UPLOAD_ROOT.
if (storageMode !== 'cloudinary') {
  app.use('/uploads', express.static(path.resolve(__dirname, '../uploads'), {
    // Force download for active-content extensions so a bad row cannot execute inline
    setHeaders: (res, filePath) => {
      if (blockedUploadExtensions.includes(path.extname(filePath).toLowerCase())) {
        res.setHeader('Content-Disposition', 'attachment')
      }
    },
  }))
}

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

// Strict limiter for internal cron endpoints - each accepted POST runs a full
// job synchronously (external fetches, bulk DB writes), so keep the budget tiny.
const cronLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
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
    features: ['auth', 'schedules', 'assignments', 'notifications', 'chat', 'ai', 'search', 'websocket', 'hackathons', 'rooms', 'internships', 'announcements'],
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

// Internal cron endpoints (triggered by Render Cron Jobs)
app.use('/internal/cron', cronLimiter, internalCronRoutes)

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
app.use('/api/fetch', fetchRoutes)
app.use('/api/ai-manager', aiManagerRoutes)
app.use('/api/attendance', generalLimiter, attendanceRoutes)
app.use('/api/grades', generalLimiter, gradesRoutes)
app.use('/api/announcements', generalLimiter, announcementsRoutes)


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

// Embedded background jobs (local dev fallback).
// In production these run via Render Cron Jobs hitting /internal/cron/* endpoints,
// so set DISABLE_EMBEDDED_CRON=true on the web service.
if (process.env.DISABLE_EMBEDDED_CRON !== 'true') {
  // Schedule contest fetch every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    try {
      await runContestsJob()
    } catch (error) {
      console.error('[Cron] Contest fetch failed:', error)
    }
  })

  // Cron: sync contest participation every hour
  setInterval(async () => {
    try {
      await runProfileSyncJob()
    } catch (err) {
      console.error('[CRON] Sync failed:', err)
    }
  }, 60 * 60 * 1000) // every hour (per-user 1h throttle still applies inside syncAllUsers)

  // Initial fetch on server start
  runContestsJob().catch(console.error)

  // Cron: fetch opportunities (hackathons + internships) every 12 hours
  cron.schedule('0 */12 * * *', async () => {
    try {
      await runOpportunitiesJob()
    } catch (err) {
      console.error('[Cron] Opportunity fetch failed:', err)
    }
  })

  // Cron: cleanup old rejected items every Sunday at 3 AM
  cron.schedule('0 3 * * 0', async () => {
    try {
      await runCleanupJob()
    } catch (err) {
      console.error('[Cron] Cleanup failed:', err)
    }
  })
}

export { app, httpServer }