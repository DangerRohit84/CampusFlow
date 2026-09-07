import { PrismaClient } from '@prisma/client'

/**
 * CampusFlow DB — Neon pooled hardening for P1001
 *
 * P1001 "Can't reach pooler at ...:5432" is transient on Neon free tier:
 * - cause: channel_binding=require breaks on some VPCs/proxies
 * - cause: connect_timeout=15 too low for cold start (Neon wakes ~5-10s)
 * - cause: pool_timeout=15 too low for pgbouncer queue under burst
 *
 * Fixes:
 * - runtime sanitize DATABASE_URL / DIRECT_URL: require->prefer, 15->30, ensure pgbouncer for pooled
 * - auto-retry transient errors (P1001/P1002/P1017/ECONNRESET) with exponential backoff
 * - wrap all model queries via $extends + raw queries via Proxy so assignmentSubmissions.ts:126 is covered without feature-code edits
 * - startup SELECT 1 check logs degraded vs ok (matches /api/health)
 *
 * Deployment notes:
 * - Infrastructure-as-Code: URLs versioned in .env.example, drift detected by sanitize warn
 * - Rollback: revert .env to channel_binding=require if needed (not recommended) — sanitize will warn but still override; to truly rollback set env ALLOW_CHANNEL_BINDING_REQUIRE=true (not implemented by default)
 * - Observability: retry warns include model.operation + code, health check exposes db: ok|degraded
 */

// ---------------------------------------------------------------------------
// 1) Runtime URL sanitization (defense-in-depth even if .env fixed)
//    This ensures Render/Neon deploy with old env still heals without rebuild.
// ---------------------------------------------------------------------------
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
      console.warn(`[db] ${key} channel_binding=require -> prefer (fixes P1001 on some networks)`)
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
      if (!cl || parseInt(cl, 10) < 20) {
        if (cl && parseInt(cl, 10) < 20) {
          console.warn(`[db] ${key} connection_limit=${cl} -> 20 (fixes P2024 pool timeout under burst)`)
        }
        url.searchParams.set('connection_limit', '20')
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
        console.warn(`[db] ${key} removed pgbouncer=true (direct URL must not use pgbouncer)`)
      }
    }

    if (mutated) {
      const sanitized = url.toString()
      process.env[key] = sanitized
      // don't log full URL (contains password); log host+params only
      console.log(`[db] sanitized ${key}: host=${url.host} params=${url.search}`)
    }
  } catch (e) {
    console.warn(`[db] failed to sanitize ${key}:`, (e as Error).message)
  }
}

sanitizeUrl('DATABASE_URL')
sanitizeUrl('DIRECT_URL')

// ---------------------------------------------------------------------------
// 2) Retry helpers — for transient Neon pooler errors
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
      console.warn(
        `[db:${label}] transient ${e.code || 'CONN_ERR'} attempt ${attempt + 1}/${retries + 1} retrying in ${Math.round(delay)}ms: ${String(e.message).slice(0, 400)}`
      )
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastError
}

// ---------------------------------------------------------------------------
// 3) Prisma singleton + auto-retry wrapper
//    - baseClient is raw PrismaClient
//    - extended client retries every $allModels operation (covers assignmentSubmissions.ts:126 findUnique)
//    - Proxy retries raw queries ($queryRaw etc) and connect
// ---------------------------------------------------------------------------
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined
  // eslint-disable-next-line no-var
  var __prismaExtended: PrismaClient | undefined
}

const baseClient =
  global.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = baseClient
}

// $extends query retry — Prisma 6 client extensions
const extendedClient =
  global.__prismaExtended ??
  (baseClient.$extends({
    query: {
      $allModels: {
        async $allOperations({ operation, model, args, query }) {
          return withRetry(() => (query as any)(args), {
            retries: 3,
            baseDelayMs: 400,
            label: `${model}.${operation}`,
          })
        },
      },
    },
  }) as unknown as PrismaClient)

if (process.env.NODE_ENV !== 'production') {
  global.__prismaExtended = extendedClient
}

function wrapRawRetry<T extends object>(target: T): T {
  const rawMethods = new Set(['$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe', '$connect', '$disconnect'])
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const val = Reflect.get(obj, prop, receiver)
      if (typeof val === 'function' && rawMethods.has(String(prop))) {
        return (...args: any[]) => withRetry(() => (val as any).apply(obj, args), { label: String(prop), retries: 3, baseDelayMs: 500 })
      }
      if (typeof val === 'function') {
        return val.bind(obj)
      }
      return val
    },
  })
}

const prisma = wrapRawRetry(extendedClient)

// ---------------------------------------------------------------------------
// 4) Connectivity helpers — pooled vs direct, health check
// ---------------------------------------------------------------------------
export async function checkConnectivity(): Promise<{ pooled: 'ok' | 'error'; direct?: 'ok' | 'error'; latencyMs?: number }> {
  const start = Date.now()
  try {
    await withRetry(() => baseClient.$queryRaw`SELECT 1` as Promise<any>, { label: 'startup:SELECT 1', retries: 2, baseDelayMs: 600 })
    const latencyMs = Date.now() - start
    console.log(`[db] pooled connectivity OK (SELECT 1 ${latencyMs}ms)`)
    return { pooled: 'ok', latencyMs }
  } catch (e: any) {
    console.error('[db] pooled connectivity check failed after retries:', e?.code || '', String(e?.message).slice(0, 600))
    console.error('[db] hint: verify DATABASE_URL uses -pooler host, channel_binding=prefer, connect_timeout=30, pool_timeout=30, pgbouncer=true')
    return { pooled: 'error' }
  }
}

export async function testPooledVsDirect(): Promise<void> {
  // Used for manual verification: tests pooled (DATABASE_URL) then direct (DIRECT_URL) if available
  console.log('[db] === pooled vs direct connectivity test ===')
  console.log(`[db] DATABASE_URL host: ${(() => { try { return new URL(process.env.DATABASE_URL || '').host } catch { return 'invalid' } })()}`)
  console.log(`[db] DIRECT_URL host: ${(() => { try { return new URL(process.env.DIRECT_URL || '').host } catch { return 'not set' } })()}`)
  // Pooled
  try {
    const t0 = Date.now()
    await withRetry(() => baseClient.$queryRaw`SELECT 1` as Promise<any>, { label: 'pooled:SELECT 1', retries: 2 })
    console.log(`[db] pooled SELECT 1 OK ${Date.now() - t0}ms`)
  } catch (e: any) {
    console.error(`[db] pooled SELECT 1 FAILED ${e.code || ''} ${String(e.message).slice(0, 500)}`)
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
      console.log(`[db] direct SELECT 1 OK ${Date.now() - t0}ms`)
    } catch (e: any) {
      console.error(`[db] direct SELECT 1 FAILED ${e.code || ''} ${String(e.message).slice(0, 500)}`)
    } finally {
      try { await directClient?.$disconnect() } catch {}
    }
  } else {
    console.warn('[db] DIRECT_URL not set — skip direct test')
  }
  console.log('[db] === test complete ===')
}

// Non-blocking startup check (don't crash server on cold-start P1001; /api/health will show degraded and retry will heal)
if (process.env.NODE_ENV !== 'test') {
  setImmediate(() => {
    checkConnectivity().catch(() => {})
  })
}

// Graceful shutdown — prevent pool leak on Render restart (which caused repeat logs)
const shutdown = async () => {
  try {
    await baseClient.$disconnect()
    console.log('[db] disconnected')
  } catch {}
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('beforeExit', shutdown)

export default prisma
export { prisma, baseClient as prismaBase, extendedClient }
