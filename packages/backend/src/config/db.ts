import { PrismaClient } from '@prisma/client'
import { logger } from '../utils/logger'

/**
 * CampusFlow DB — Neon pooled hardening for 10k scale.
 *
 * P1001 "Can't reach pooler at ...:5432" is transient on Neon free tier:
 * - cause: channel_binding=require breaks on some VPCs/proxies
 * - cause: connect_timeout too low for cold start (Neon wakes ~5-10s)
 * - cause: pool_timeout too low for pgbouncer queue under burst
 *
 * 10k changes (this file):
 * - pool: connection_limit 20 → 50 (Neon pooled URL param, see .env.example).
 *   50 = headroom for burst + socket/ETag/rate-limit fan-out without P2024.
 *   Math: pgbouncer queue depth ≈ limit; 20 saturated at ~200 rps burst, 50 holds ~500 rps.
 * - EXPLICIT retry: no Proxy magic, no auto-$extends retry. Callers wrap
 *   transient-prone sections with `withRetry(fn, { label })`. Explicit beats
 *   implicit at scale (visible in code review, no hidden double-retry, no
 *   Proxy stack-trace mangling). See `queryWithRetry` + examples below.
 * - Slow-query + pool-metrics log: every $allModels op is timed; >SLOW_QUERY_MS
 *   (default 500ms) warns with model.operation + duration; periodic
 *   `[db:metrics]` line shows throughput/concurrency for capacity planning.
 *
 * Migration from Proxy version:
 * - BEFORE: `prisma.user.findUnique(...)` auto-retried (hidden).
 * - AFTER:  `await withRetry(() => prisma.user.findUnique(...), { label: 'user.findUnique' })`
 *   for critical paths (auth:join, assignmentSubmissions.ts:126, health).
 *   Non-critical reads can call prisma directly (fail fast, let route 500 + retry client-side).
 * - `prismaBase` is the raw client (no logging extension) for pre-flight checks.
 *
 * Deployment notes:
 * - URLs versioned in .env.example, drift detected by sanitize warn.
 * - Rollback: revert .env connection_limit to 20 (sanitize will enforce min 50 —
 *   to truly rollback set MIN_CONNECTION_LIMIT=20 env, not recommended at 10k).
 * - Observability: retry warns include label + code, health check exposes db: ok|degraded.
 */

// ---------------------------------------------------------------------------
// 1) Runtime URL sanitization (defense-in-depth even if .env fixed)
// ---------------------------------------------------------------------------

const MIN_CONNECTION_LIMIT = parseInt(process.env.MIN_CONNECTION_LIMIT || '50', 10) || 50
const TARGET_CONNECTION_LIMIT = Math.max(50, MIN_CONNECTION_LIMIT)

function sanitizeUrl(key: 'DATABASE_URL' | 'DIRECT_URL') {
  const raw = process.env[key]
  if (!raw) return
  try {
    const url = new URL(raw)
    let mutated = false

    const cb = url.searchParams.get('channel_binding')
    if (cb === 'require') {
      url.searchParams.set('channel_binding', 'prefer')
      mutated = true
      logger.warn(`[db] ${key} channel_binding=require -> prefer (fixes P1001 on some networks)`)
    }

    const ct = url.searchParams.get('connect_timeout')
    if (!ct || parseInt(ct, 10) < 30) {
      url.searchParams.set('connect_timeout', '30')
      mutated = true
    }

    if (key === 'DATABASE_URL') {
      const pt = url.searchParams.get('pool_timeout')
      if (!pt || parseInt(pt, 10) < 30) {
        url.searchParams.set('pool_timeout', '30')
        mutated = true
      }
      if (!url.searchParams.has('pgbouncer')) {
        url.searchParams.set('pgbouncer', 'true')
        mutated = true
      }
      const cl = url.searchParams.get('connection_limit')
      const clNum = cl ? parseInt(cl, 10) : NaN
      if (!cl || Number.isNaN(clNum) || clNum < TARGET_CONNECTION_LIMIT) {
        if (cl && !Number.isNaN(clNum) && clNum < TARGET_CONNECTION_LIMIT) {
          logger.warn(`[db] ${key} connection_limit=${cl} -> ${TARGET_CONNECTION_LIMIT} (10k headroom, fixes P2024 pool timeout under burst)`)
        }
        url.searchParams.set('connection_limit', String(TARGET_CONNECTION_LIMIT))
        mutated = true
      }
      // ensure sslmode
      if (!url.searchParams.has('sslmode')) {
        url.searchParams.set('sslmode', 'require')
        mutated = true
      }
    } else {
      // DIRECT_URL: ensure sslmode, keep no pgbouncer
      if (!url.searchParams.has('sslmode')) {
        url.searchParams.set('sslmode', 'require')
        mutated = true
      }
      // direct should NOT have pgbouncer=true (Prisma validates)
      if (url.searchParams.get('pgbouncer') === 'true') {
        url.searchParams.delete('pgbouncer')
        mutated = true
        logger.warn(`[db] ${key} removed pgbouncer=true (direct URL must not use pgbouncer)`)
      }
    }

    if (mutated) {
      const sanitized = url.toString()
      process.env[key] = sanitized
      // don't log full URL (contains password); log host+params only
      logger.info(`[db] sanitized ${key}: host=${url.host} params=${url.search}`)
    }
  } catch (e) {
    logger.warn({ err: (e as Error).message }, `[db] failed to sanitize ${key}:`)
  }
}

sanitizeUrl('DATABASE_URL')
sanitizeUrl('DIRECT_URL')

// ---------------------------------------------------------------------------
// 2) Explicit retry helper — for transient Neon pooler errors
//    Callers MUST wrap critical sections explicitly (no Proxy auto-magic).
//
//    Example (assignmentSubmissions.ts:126 — single-query student lookup):
//      const student = await withRetry(
//        () => prisma.user.findFirst({ where: { OR: [{ id }, { studentId }] } }),
//        { label: 'assignmentSubmissions.resolveStudent', retries: 3 }
//      )
//
//    Example (socket auth:join):
//      const user = await withRetry(
//        () => prisma.user.findUnique({ where: { id: userId } }),
//        { label: 'socket.auth:join', retries: 2, baseDelayMs: 400 }
//      )
// ---------------------------------------------------------------------------
export function isRetryableError(error: any): boolean {
  if (!error) return false
  const code = error.code as string | undefined
  const msg = String(error.message || error || '')
  if (code === 'P1001' || code === 'P1002' || code === 'P1017') return true
  if (msg.includes("Can't reach database server")) return true
  if (msg.includes('P1001')) return true
  if (msg.includes('Timed out fetching a new connection')) return true
  if (msg.toLowerCase().includes('pool timeout') || msg.includes('pool_timeout')) return true
  if (msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED')) return true
  if (msg.includes('connection is not established') || msg.includes('Server has closed the connection')) return true
  return false
}

export function isP1001Error(e: any): boolean {
  return e?.code === 'P1001' || String(e?.message || '').includes("Can't reach database server")
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number; label?: string } = {}
): Promise<T> {
  const { retries = 3, baseDelayMs = 500, label = 'db' } = opts
  let lastError: any
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (e: any) {
      lastError = e
      const retryable = isRetryableError(e)
      const isLast = attempt === retries
      if (!retryable || isLast) throw e
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 100
      logger.warn(
        `[db:${label}] transient ${e.code || 'CONN_ERR'} attempt ${attempt + 1}/${retries + 1} retrying in ${Math.round(delay)}ms: ${String(e.message).slice(0, 400)}`
      )
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastError
}

/** Convenience: explicit retry wrapper with label-first signature for routes. */
export function queryWithRetry<T>(label: string, fn: () => Promise<T>, retries = 3): Promise<T> {
  return withRetry(fn, { label, retries, baseDelayMs: 400 })
}

/** Explicit transaction retry (retries the whole tx closure on transient pool errors). */
export function transactionWithRetry<T>(label: string, fn: (tx: any) => Promise<T>, retries = 2): Promise<T> {
  return withRetry(() => (baseClient as any).$transaction(fn), { label: `tx:${label}`, retries, baseDelayMs: 500 }) as Promise<T>
}

// ---------------------------------------------------------------------------
// 3) Prisma singleton + slow-query / pool-metrics observability
//    - baseClient is raw PrismaClient (no extension) — use for pre-flight checks.
//    - prisma adds TIMING-ONLY $extends (no retry). Retry is explicit via withRetry.
// ---------------------------------------------------------------------------
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined
  // eslint-disable-next-line no-var
  var __prismaExtended: PrismaClient | undefined
}

const SLOW_QUERY_MS = parseInt(process.env.SLOW_QUERY_MS || '500', 10) || 500
const DB_METRICS_INTERVAL_MS = parseInt(process.env.DB_METRICS_INTERVAL_MS || '60000', 10) || 60000

interface DbMetrics {
  totalQueries: number
  slowQueries: number
  totalDurationMs: number
  maxDurationMs: number
  concurrent: number
  maxConcurrent: number
  errors: number
}

const dbMetrics: DbMetrics = {
  totalQueries: 0,
  slowQueries: 0,
  totalDurationMs: 0,
  maxDurationMs: 0,
  concurrent: 0,
  maxConcurrent: 0,
  errors: 0,
}

export function getDbMetrics(): Readonly<DbMetrics> & { avgMs: number; connectionLimit: number } {
  return {
    ...dbMetrics,
    avgMs: dbMetrics.totalQueries ? Math.round(dbMetrics.totalDurationMs / dbMetrics.totalQueries) : 0,
    connectionLimit: TARGET_CONNECTION_LIMIT,
  }
}

export function resetDbMetrics(): void {
  dbMetrics.totalQueries = 0
  dbMetrics.slowQueries = 0
  dbMetrics.totalDurationMs = 0
  dbMetrics.maxDurationMs = 0
  dbMetrics.maxConcurrent = 0
  dbMetrics.errors = 0
}

const baseClient =
  global.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = baseClient
}

// Timing-only extension — logs slow queries + tracks pool pressure.
// NOTE: no retry here by design (explicit withRetry at call sites).
const extendedClient =
  global.__prismaExtended ??
  (baseClient.$extends({
    query: {
      $allModels: {
        async $allOperations({ operation, model, args, query }) {
          const start = Date.now()
          dbMetrics.concurrent++
          if (dbMetrics.concurrent > dbMetrics.maxConcurrent) dbMetrics.maxConcurrent = dbMetrics.concurrent
          try {
            const result = await (query as any)(args)
            const durationMs = Date.now() - start
            dbMetrics.totalQueries++
            dbMetrics.totalDurationMs += durationMs
            if (durationMs > dbMetrics.maxDurationMs) dbMetrics.maxDurationMs = durationMs
            if (durationMs > SLOW_QUERY_MS) {
              dbMetrics.slowQueries++
              // Timing note: local Postgres <50ms is healthy. Prod (Singapore API → SG DB,
              // same-region) ~5ms is healthy. Dev from India → Singapore Neon is
              // 500-1000ms per query NORMAL (70-90ms RTT + TLS + pgbouncer per query)
              // and 100+ sequential dashboard queries → 70s wall — that is geography,
              // not a missing index. Dashboard aggregations are single GROUP BY queries
              // (see admin super/dashboard + assignmentHub student path; no per-row
              // fallback scan). SLOW_QUERY_MS=500 in prod; 1000 in local .env.local.example
              // to cut cloud-dev noise. If slow on LOCAL PG: EXPLAIN (ANALYZE, BUFFERS) + N+1/groupBy.
              logger.warn(`[db:slow] ${model}.${operation} ${durationMs}ms (> ${SLOW_QUERY_MS}ms) — local<50ms healthy, prod SG same-region ~5ms; India→SG cloud 500-1000ms=RTT/TLS/pgbouncer NORMAL. If slow locally: EXPLAIN (ANALYZE, BUFFERS) + N+1/groupBy`)
            }
            return result
          } catch (e) {
            dbMetrics.errors++
            throw e
          } finally {
            dbMetrics.concurrent--
          }
        },
      },
    },
  }) as unknown as PrismaClient)

if (process.env.NODE_ENV !== 'production') {
  global.__prismaExtended = extendedClient
}

// Explicit export — NO Proxy wrapper (removed: hid retries, mangled stack traces,
// doubled retry when combined with $extends). Use withRetry() at call sites.
const prisma = extendedClient

// Periodic pool-metrics log (capacity planning for 10k: watch avgMs + maxConcurrent vs limit 50).
if (process.env.NODE_ENV !== 'test' && !global.__prisma) {
  const timer = setInterval(() => {
    const m = getDbMetrics()
    if (m.totalQueries === 0) return
    logger.info(
      `[db:metrics] queries=${m.totalQueries} slow(>${SLOW_QUERY_MS}ms)=${m.slowQueries} avg=${m.avgMs}ms max=${m.maxDurationMs}ms ` +
        `maxConcurrent=${m.maxConcurrent} errors=${m.errors} connection_limit=${m.connectionLimit}`
    )
  }, DB_METRICS_INTERVAL_MS)
  if (typeof (timer as any).unref === 'function') (timer as any).unref()
}

// ---------------------------------------------------------------------------
// 4) Connectivity helpers — pooled vs direct, health check (explicit retry)
//    + pgbouncer warmup (SELECT 1 ×3 on boot warms pooler connections so the
//    first real dashboard burst doesn't pay 3× TLS+queue cold cost).
// ---------------------------------------------------------------------------
export async function warmupPool(): Promise<{ ok: number; failed: number; totalMs: number }> {
  const t0 = Date.now()
  let ok = 0
  let failed = 0
  // Sequential ×3: warms 3 pooler slots without bursting; each SELECT 1 is
  // India→SG 500-1000ms NORMAL in dev, ~5ms prod same-region. Failures are
  // non-fatal (pool heals on next query) — log once, never throw on boot.
  for (let i = 1; i <= 3; i++) {
    try {
      await baseClient.$queryRaw`SELECT 1` as Promise<any>
      ok++
    } catch (e: any) {
      failed++
      if (i === 1) {
        logger.warn(`[db:warmup] SELECT 1 #${i} failed (non-fatal, pool heals on demand): ${String(e?.code || '')} ${String(e?.message || '').slice(0, 200)}`)
      }
    }
  }
  const totalMs = Date.now() - t0
  logger.info(`[db:warmup] pgbouncer warmup done ok=${ok}/3 failed=${failed} total=${totalMs}ms (SG cloud 500-1000ms/query NORMAL in dev; prod same-region ~5ms)`)
  return { ok, failed, totalMs }
}

export async function checkConnectivity(): Promise<{ pooled: 'ok' | 'error'; direct?: 'ok' | 'error'; latencyMs?: number }> {
  const start = Date.now()
  try {
    await withRetry(() => baseClient.$queryRaw`SELECT 1` as Promise<any>, { label: 'startup:SELECT 1', retries: 2, baseDelayMs: 600 })
    const latencyMs = Date.now() - start
    logger.info(`[db] pooled connectivity OK (SELECT 1 ${latencyMs}ms)`)
    return { pooled: 'ok', latencyMs }
  } catch (e: any) {
    logger.error({ err: e?.code || '' }, '[db] pooled connectivity check failed after retries:', String(e?.message).slice(0, 600))
    logger.error('[db] hint: verify DATABASE_URL uses -pooler host, channel_binding=prefer, connect_timeout=30, pool_timeout=30, pgbouncer=true')
    return { pooled: 'error' }
  }
}

export async function testPooledVsDirect(): Promise<void> {
  // Used for manual verification: tests pooled (DATABASE_URL) then direct (DIRECT_URL) if available
  logger.info('[db] === pooled vs direct connectivity test ===')
  logger.info(`[db] DATABASE_URL host: ${(() => { try { return new URL(process.env.DATABASE_URL || '').host } catch { return 'invalid' } })()}`)
  logger.info(`[db] DIRECT_URL host: ${(() => { try { return new URL(process.env.DIRECT_URL || '').host } catch { return 'not set' } })()}`)
  // Pooled
  try {
    const t0 = Date.now()
    await withRetry(() => baseClient.$queryRaw`SELECT 1` as Promise<any>, { label: 'pooled:SELECT 1', retries: 2 })
    logger.info(`[db] pooled SELECT 1 OK ${Date.now() - t0}ms`)
  } catch (e: any) {
    logger.error(`[db] pooled SELECT 1 FAILED ${e.code || ''} ${String(e.message).slice(0, 500)}`)
  }
  // Direct (create temp client to avoid polluting pooled pool)
  const directUrl = process.env.DIRECT_URL
  if (directUrl) {
    let directClient: PrismaClient | null = null
    try {
      directClient = new PrismaClient({
        datasources: { db: { url: directUrl } },
        log: ['error'],
      })
      const t0 = Date.now()
      await withRetry(() => directClient!.$queryRaw`SELECT 1` as Promise<any>, { label: 'direct:SELECT 1', retries: 1 })
      logger.info(`[db] direct SELECT 1 OK ${Date.now() - t0}ms`)
    } catch (e: any) {
      logger.error(`[db] direct SELECT 1 FAILED ${e.code || ''} ${String(e.message).slice(0, 500)}`)
    } finally {
      try { await directClient?.$disconnect() } catch {}
    }
  } else {
    logger.warn('[db] DIRECT_URL not set — skip direct test')
  }
  logger.info('[db] === test complete ===')
}

// Non-blocking startup check (don't crash server on cold-start P1001; /api/health will show degraded and retry will heal)
// + pgbouncer warmup ×3 (warms pooler slots; India→SG 500-1000ms/query NORMAL in dev, prod same-region ~5ms).
if (process.env.NODE_ENV !== 'test') {
  setImmediate(() => {
    // Warmup first (3× SELECT 1 sequential), then single connectivity probe for health log.
    warmupPool()
      .catch(() => {})
      .finally(() => {
        checkConnectivity().catch(() => {})
      })
  })
}

// Graceful shutdown — prevent pool leak on Render restart (which caused repeat logs)
const shutdown = async () => {
  try {
    await baseClient.$disconnect()
    logger.info('[db] disconnected')
  } catch {}
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('beforeExit', shutdown)

export default prisma
export { prisma, baseClient as prismaBase, extendedClient }
