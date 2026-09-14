import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import { etagCacheMiddleware } from './middleware/etagCache'
import path from 'path'
import { createServer } from 'http'
import cron from 'node-cron'
import { config } from './config'
import { withRetry } from './config/db'
import { initSocket } from './services/socket'
import { errorHandler } from './middleware/errorHandler'
import { requestId } from './middleware/requestId'
import { logger } from './utils/logger'
// Track 4 (SRP): composition root only wires; logic lives in dedicated modules.
import { bodyNormalizer } from './middleware/bodyNormalizer'
import { generalLimiter as makeGeneralLimiter, authLimiter as makeAuthLimiter, cronLimiter as makeCronLimiter, collegeRegisterLimiter } from './middleware/rateLimits'
import collegesRouter from './routes/colleges'
import { startEmbeddedCron } from './jobs/cron'
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
import codingProblemsRoutes from './routes/codingProblems'
import fetchRoutes from './routes/fetch'
import aiManagerRoutes from './routes/ai-manager'
import attendanceRoutes from './routes/attendance'
import gradesRoutes from './routes/grades'
import announcementsRoutes from './routes/announcements'
import assignmentHubRouter from './routes/assignmentHub'
import assignmentSubmissionsRouter from './routes/assignmentSubmissions'
import resumeRoutes from './routes/resume'
import publicProfileRoutes from './routes/publicProfile'
import reportRoutes from './routes/reports'
import internalCronRoutes from './routes/internalCron'
import streamRoutes from './routes/stream'

import prisma, { warmupPool } from './config/db'
import { storageMode } from './config/storage'
import { checkMigrationStatus } from './config/migrationCheck'
import { initCacheFromEnv } from './lib/cache'
import { disconnectRedis, ensureRedisRejectionGuard, isRedisConfigured } from './lib/redis'

const app = express()
const httpServer = createServer(app)

// PROD crash guard (last resort): Redis commandTimeout rejections must never
// exit(1) the Render service. Per-op try/catch + fire-and-forget .catch is
// primary; this logs Redis unhandled/uncought and keeps the process alive
// (fail-open to memory). Installed first so boot-time Redis blips are covered.
ensureRedisRejectionGuard()

// Scale10k: shared cache boot (Redis when REDIS_URL set, memory otherwise).
// Lazy connect — never crashes boot when Redis blips; helpers fail open.
const cacheMode = initCacheFromEnv()
logger.info(`[cache] mode=${cacheMode.mode} redisConfigured=${isRedisConfigured()} (prod requires REDIS_URL, dev single-instance memory OK)`)

// P0 SECURITY (F19): trust first proxy hop (Render/Heroku/Nginx) so
// req.ip + express-rate-limit see the real client IP, not the LB.
// Must be set before any rate limiter. `1` = trust single front proxy.
// Render / popular-site parity: also required for secure cookies behind Render LB.
app.set('trust proxy', 1)

// Timeouts: match popular-site defaults — fail fast on slow clients, keep-alive tuned for LB idle (65s > 60s LB timeout).
httpServer.timeout = 120_000
httpServer.keepAliveTimeout = 65_000
httpServer.headersTimeout = 66_000

// Initialize WebSocket
initSocket(httpServer)

// Middleware (order matters: requestId first so every log/err carries it,
// then compression for wire size, then ETag/CDN SWR like Cloudflare/Vercel)
app.use(requestId)
app.use(compression({ threshold: 1024 }))
// Helmet: CSP via nginx (hash-pinned) + HSTS prod-only on API (I-8); backend enforces
// nosniff/DENY + COOP/CORP same-origin (2026 baseline). crossOriginResourcePolicy
// was `false` — now `same-origin` (uploads served attachment + nosniff, no break).
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-origin' },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  // I-8: HSTS on API when behind TLS (prod only). 63072000 + subDomains + preload
  // per OWASP 2026 baseline. Dev keeps off to avoid localhost pinning.
  hsts: process.env.NODE_ENV === 'production' ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
  // JSON API: no CSP needed (no HTML). Documented as intentional — web CSP lives
  // in nginx.conf + render.yaml (form-action/upgrade-insecure-requests).
}))
// Defense-in-depth if helmet version skips COOP/CORP/HSTS on some paths:
app.use((_req, res, next) => {
  if (!res.getHeader('Cross-Origin-Opener-Policy')) res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  if (!res.getHeader('Cross-Origin-Resource-Policy')) res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  // Fallback HSTS when helmet hsts disabled (non-prod never sets — prod-only guard)
  if (process.env.NODE_ENV === 'production' && !res.getHeader('Strict-Transport-Security')) {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  }
  next()
})
// High-scale: per-page weak ETag + CDN SWR (GitHub/Cloudflare pattern) — keep before routes so res.json is wrapped
app.use(etagCacheMiddleware)
// CORS allowlist is centralized in config.frontendUrls (SSOT from FRONTEND_URL + FRONTEND_URLS csv).
// Vercel cutover: append the Vercel origin alongside onrender via env (comma-separated, no wildcard in prod).
// Socket.IO uses the same SSOT (services/socket.ts) — no per-file origin lists.
const allowedOrigins = config.frontendUrls
app.use(cors({ origin: (origin, callback) => { if (!origin || allowedOrigins.includes(origin)) { callback(null, true) } else { callback(new Error('Not allowed by CORS')) } }, credentials: true }))
// Body limits (I-8): default 1mb (was 10mb — JSON-parse DoS). Auth payloads are
// <2kb; uploads use multipart/multer (rooms 10MB, resume 6MB) not JSON, so 1mb
// global is safe. Per-route: auth login/register enforce 100kb via content-length
// guard below (fails 413 before bcrypt), export routes stream (no large JSON).
app.use(express.json({ limit: '1mb', strict: false }))
// Normalize primitive JSON bodies — canonical middleware in middleware/bodyNormalizer.ts.
app.use(bodyNormalizer)
// Also parse urlencoded bodies (harmless, keeps parity with body-parser defaults)
app.use(express.urlencoded({ extended: true, limit: '1mb' }))

// Auth strict body cap (100kb): reject oversized login/register before Zod/bcrypt.
// Global is 1mb; auth JSON is tiny — 100kb blocks JSON-parse CPU DoS on the
// highest-abuse surface while keeping UX (400 vs 500 handled in errorHandler).
app.use('/api/auth', (req, res, next) => {
  const len = Number(req.headers['content-length'] || 0)
  if (len > 100 * 1024) {
    res.status(413).json({ error: 'Payload too large' })
    return
  }
  next()
})

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

// Rate limiting — factories live in middleware/rateLimits.ts (Redis-ready via
// lib/cache). Each limiter gets its own CacheStore prefix sharing one backend.
const generalLimiter = makeGeneralLimiter()

const authLimiter = makeAuthLimiter()

// Strict limiter for internal cron endpoints - each accepted POST runs a full
// job synchronously (external fetches, bulk DB writes), so keep the budget tiny.
const cronLimiter = makeCronLimiter()

// Health check — BetterStack expects `status` field + HTTP semantics:
// 200 + status:ok when DB reachable, 503 + status:degraded otherwise.
// Render/Docker HEALTHCHECK treats non-200 as unhealthy (triggers restart/alert).
// Rollback: revert to unconditional 200 res.json.
app.get('/api/health', async (_req, res) => {
  let dbStatus = 'ok'
  try {
    // Explicit retry (db.ts has no Proxy auto-magic): 2 quick retries for Neon wake.
    await withRetry(() => prisma.$queryRaw`SELECT 1` as Promise<unknown>, { label: 'health:SELECT 1', retries: 2, baseDelayMs: 400 })
  } catch {
    dbStatus = 'error'
  }
  const isOk = dbStatus === 'ok'
  res.status(isOk ? 200 : 503).json({
    status: isOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    service: 'CampusFlow API',
    version: '1.0.0',
    db: dbStatus,
    features: ['auth', 'schedules', 'assignments', 'notifications', 'chat', 'ai', 'search', 'websocket', 'hackathons', 'rooms', 'internships', 'announcements'],
  })
})

// Public colleges — canonical router in routes/colleges.ts (SRP extract).
// Register stays strictly limited (5/h); list/public/departments stay open.
app.use('/api/colleges/register', collegeRegisterLimiter())
app.use('/api/colleges', collegesRouter)

// Internal cron endpoints (triggered by Render Cron Jobs)
app.use('/internal/cron', cronLimiter, internalCronRoutes)

// API Routes
app.use('/api/auth/login', authLimiter)
app.use('/api/auth/register', authLimiter)
app.use('/api/auth', authRoutes)
app.use('/api/schedules', generalLimiter, scheduleRoutes)
app.use('/api/assignments', generalLimiter, assignmentRoutes)
app.use('/api/assignments/hub', generalLimiter, assignmentHubRouter)
app.use('/api/assignments', generalLimiter, assignmentSubmissionsRouter)
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
// Problems-to-Solve MVP: LeetCode daily + curated/live list. Dedicated
// 20req/10s per-(IP+user) budget (≤2 upstream calls/page by design: the
// Problems tab fetches daily + list once per mount; 20h/24h server caches
// absorb repeats). Separate prefix so problem browsing never eats the
// shared general budget (and vice versa).
app.use('/api/coding-problems', makeGeneralLimiter({ windowMs: 10_000, limit: 20, prefix: 'rl:coding-problems:' }), codingProblemsRoutes)
app.use('/api/fetch', generalLimiter, fetchRoutes)
app.use('/api/ai-manager', generalLimiter, aiManagerRoutes)
app.use('/api/attendance', generalLimiter, attendanceRoutes)
app.use('/api/grades', generalLimiter, gradesRoutes)
app.use('/api/announcements', generalLimiter, announcementsRoutes)
app.use('/api/resume', generalLimiter, resumeRoutes)
app.use('/api/reports', generalLimiter, reportRoutes)
// P1 SSE fallback (one-way status when the socket is dead): authenticated
// EventSource streams for profile-sync / staging-counts / notifications.
// Socket alive = 0 SSE traffic (client only subscribes when disconnected).
app.use('/api/stream', generalLimiter, streamRoutes)
// P0 SECURITY (F05/W7): public profiles are scrape targets — baseline general
// limiter plus a stricter 60/h per-route limiter inside publicProfile router.
app.use('/api/u', generalLimiter, publicProfileRoutes)
// alias for /api/users/u etc if needed
app.use('/api/users/u', generalLimiter, publicProfileRoutes)


// 404 handler
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' })
})

// Error handler
app.use(errorHandler)

// Start server
const PORT = config.port
const server = httpServer.listen(PORT, () => {
  logger.info(
    `
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
  `,
  )
  // pgbouncer connection warmup on boot (SELECT 1 ×3, non-blocking):
  // warms pooler slots so first dashboard burst skips cold TLS+queue cost.
  // India→SG 500-1000ms/query NORMAL in dev; prod same-region ~5ms.
  // Migrations are NOT run here — release-time only via Render preDeployCommand
  // (`npm run db:deploy`, i.e. `prisma migrate deploy` with DIRECT_URL). Running
  // migrate in-process on every boot races concurrent web/cron runners on
  // _prisma_migrations. This boot check below is warn-only (never crashes).
  setImmediate(() => {
    warmupPool().catch(() => {})
    // Migration drift check (warn-only, never crashes healthy paths):
    // compares local prisma/migrations count vs applied _prisma_migrations count
    // and logs the exact release command when behind. Skipped in tests.
    if (process.env.NODE_ENV !== 'test') {
      checkMigrationStatus({ prismaClient: prisma }).catch(() => {})
    }
  })
})

// Graceful SIGTERM/SIGINT drain (Render sends SIGTERM 30s before kill).
// Stop accepting new connections, drain in-flight (incl. sockets), then exit.
// Rollback: revert to plain httpServer.listen without this block.
let draining = false
async function gracefulShutdown(signal: string) {
  if (draining) return
  draining = true
  logger.info(`[${signal}] draining — stop accepting new connections…`)
  // Stop cron/keepalive timers from firing new work during drain
  try {
    cron.getTasks().forEach((t) => t.stop())
  } catch {}
  server.close(async () => {
    logger.info('[shutdown] HTTP closed, disconnecting socket + db + redis…')
    try {
      const { getIO } = await import('./services/socket')
      try { getIO().disconnectSockets(true) } catch {}
      try { getIO().close() } catch {}
    } catch {}
    try { await disconnectRedis() } catch {}
    try { await prisma.$disconnect() } catch {}
    logger.info('[shutdown] drained cleanly')
    process.exit(0)
  })
  // Hard kill after 25s (under Render 30s SIGKILL) to avoid zombie deploy
  setTimeout(() => {
    logger.error('[shutdown] drain timeout 25s — forcing exit')
    process.exit(1)
  }, 25_000).unref()
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// Embedded background jobs (local dev fallback).
// Canonical scheduling lives in jobs/cron.ts (SRP extract).
// In production these run via Render Cron Jobs hitting /internal/cron/* endpoints,
// so set DISABLE_EMBEDDED_CRON=true on the web service.
if (process.env.DISABLE_EMBEDDED_CRON !== 'true') {
  startEmbeddedCron()
}

export { app, httpServer }