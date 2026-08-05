import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { createServer } from 'http'
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
import formRoutes from './routes/forms'
import adminRoutes from './routes/admin'
import departmentRoutes from './routes/departments'
import roomsRouter from './routes/rooms'
import prisma from './config/db'

const app = express()
const httpServer = createServer(app)

// Initialize WebSocket
initSocket(httpServer)

// Middleware
app.use(helmet({ crossOriginResourcePolicy: false }))
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }))
app.use(express.json({ limit: '10mb' }))

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'CampusFlow API',
    version: '1.0.0',
    features: ['auth', 'schedules', 'assignments', 'notifications', 'chat', 'ai', 'search', 'websocket', 'hackathons', 'rooms'],
  })
})

// Public: Register college (no auth required)
app.post('/api/colleges/register', async (req, res) => {
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

// API Routes
app.use('/api/auth', authRoutes)
app.use('/api/schedules', scheduleRoutes)
app.use('/api/assignments', assignmentRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/chat', chatRoutes)
app.use('/api/user', userRoutes)
app.use('/api/search', searchRoutes)
app.use('/api/ai', aiRoutes)
app.use('/api/tasks', taskRoutes)
app.use('/api/timetable', timetableRoutes)
app.use('/api/hackathons', hackathonRoutes)
app.use('/api/forms', formRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/departments', departmentRoutes)
app.use('/api/rooms', roomsRouter)

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

export { app, httpServer }