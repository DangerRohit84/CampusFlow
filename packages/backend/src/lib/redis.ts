/**
 * CampusFlow shared Redis — central seam for 10k multi-instance scale.
 *
 * WHY: single-instance MemoryStores break on N Render replicas (rate-limit
 * counters, sync throttle, authorize cache, sync locks, socket presence must
 * be shared). All shared-state code talks to this module (or lib/cache),
 * never to `new Map` directly for cross-instance data.
 *
 * CONTRACT (behavior identical single-instance, correct multi-instance):
 * - REDIS_URL unset → fail OPEN to in-memory (dev/CI works with zero infra).
 *   Warn-once (not per-call spam) so logs stay greppable.
 * - REDIS_URL set → lazy connect (no boot crash when Redis blips); every
 *   helper fails OPEN to null/false on error (availability over strictness).
 *   Rate-limit over-admit by 1 on Redis blip beats 500ing the dashboard.
 * - No secrets in logs (never log REDIS_URL value, only host presence).
 * - No `config/index` import here (keeps hermetic vitest without JWT env).
 *
 * 10k MATH (see .ai/reports/scale10k-redis.md):
 * - Per-user demand ~100 req/15m p95 → budget 1000 = 10x headroom.
 * - Rate-limit = ~2 Redis ops/req (GET+SET); 10k users ≈ 1M req/15m ≈ 1111
 *   rps avg → ~2222 Redis ops/s, well under single-Redis 50k ops/s.
 * - Per-user keys scale horizontally (no hotspot); anon IP-only fallback is
 *   low-volume pre-login traffic.
 */

import { logger } from '../utils/logger'

// ---------------------------------------------------------------------------
// Minimal Redis surface (subset of ioredis we use — mockable in tests)
// ---------------------------------------------------------------------------

export interface RedisLike {
  get(key: string): Promise<string | null>
  // ioredis overload: set(key, val, 'PX', ttl, 'NX') etc. Keep loose for mocks.
  set(key: string, value: string, ...args: Array<string | number>): Promise<string | null>
  del(...keys: string[]): Promise<number>
  incr(key: string): Promise<number>
  incrby?(key: string, increment: number): Promise<number>
  pexpire(key: string, ms: number): Promise<number>
  pttl(key: string): Promise<number>
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>
  on?(event: string, listener: (...args: any[]) => void): void
  disconnect?(...args: any[]): void | Promise<void>
}

// ---------------------------------------------------------------------------
// Lazy singleton (no connection at import — hermetic tests stay offline)
// ---------------------------------------------------------------------------

let client: RedisLike | null = null
let clientPromise: Promise<RedisLike | null> | null = null
let warnedUnset = false
let warnedError = false
let testOverride: RedisLike | null | undefined

function redisUrl(): string | null {
  const raw = (process.env.REDIS_URL || '').trim()
  return raw ? raw : null
}

export function isRedisConfigured(): boolean {
  return redisUrl() !== null
}

/** Test seam: inject a FakeRedis (or null to force fallback). */
export function __setRedisClientForTests(mock: RedisLike | null): void {
  testOverride = mock
  if (mock) {
    client = mock
  } else {
    client = null
  }
}

/** Test seam: reset singleton + warn flags. Does NOT disconnect real client. */
export function __resetRedisForTests(): void {
  testOverride = undefined
  client = null
  clientPromise = null
  warnedUnset = false
  warnedError = false
  loggedReady = false
}

function warnUnsetOnce(): void {
  if (warnedUnset) return
  warnedUnset = true
  logger.warn(
    '[redis] REDIS_URL unset — using in-memory fallback (dev single-instance; prod multi-instance requires REDIS_URL)'
  )
}

function warnErrorOnce(err: unknown, op: string): void {
  if (warnedError) return
  warnedError = true
  logger.warn(
    { err: (err as any)?.message || String(err), op },
    '[redis] operation failed, failing open to in-memory (multi-instance degraded until Redis heals)'
  )
}

// ---------------------------------------------------------------------------
// Resilient defaults (Upstash rediss:// + Render KeyValue redis://).
// ---------------------------------------------------------------------------

let loggedReady = false

/**
 * True when hostname is Upstash (`*.upstash.io`). Upstash requires TLS —
 * plaintext `redis://` to an Upstash host gets `read ECONNRESET` on connect.
 * Best-effort parse, never throws, never logs the URL.
 */
export function isUpstashHost(url: string): boolean {
  try {
    const hostname = new URL(String(url || '').trim()).hostname?.trim().toLowerCase()
    if (!hostname) return false
    return hostname === 'upstash.io' || hostname.endsWith('.upstash.io')
  } catch {
    return false
  }
}

/**
 * True for prod TLS URLs. Case-insensitive, trimmed.
 * - `rediss://` scheme → TLS (Upstash prod, Render TLS).
 * - `*.upstash.io` host → TLS regardless of scheme (treat `redis://` as
 *   `rediss://`; plaintext to Upstash gets ECONNRESET).
 * - Otherwise scheme-driven (internal Render KeyValue `redis://` stays plain).
 */
export function isTlsRedisUrl(url: string): boolean {
  const trimmed = String(url || '').trim()
  if (/^rediss:\/\//i.test(trimmed)) return true
  if (isUpstashHost(trimmed)) return true
  return false
}

/**
 * Redacted target for logs — scheme + REDACTED only (never host/password/token).
 * e.g. `rediss://REDACTED` (TLS) vs `redis://REDACTED` (internal, no TLS).
 */
export function redactedRedisTarget(url: string): string {
  const scheme = isTlsRedisUrl(url) ? 'rediss' : 'redis'
  return `${scheme}://REDACTED`
}

/**
 * Shared ioredis options (single source of truth for lib/redis + socket adapter).
 *
 * WHY these values (prod incident: Upstash 0 commands + every op
 * `max retries per request limit (2)` failing open to memory):
 * - `maxRetriesPerRequest: 2` flushed the offline queue after 3 reconnect
 *   attempts (~200+400+800ms ≈ 1.4s), before external TLS handshake
 *   (DNS+TCP+TLS+AUTH+HELLO+INFO ready-check, often 1–3s cold from Render)
 *   completed — so no command ever reached the server (0 commands on dashboard).
 *   `5` tolerates ~7s of cold handshake (200+400+800+1600+2000+2000ms) yet still
 *   fails open; default `20` would hang request-path ops ~40s (too long).
 * - `tls: {}` (with SNI servername when parseable) for TLS URLs (`rediss://`
 *   OR `*.upstash.io` host regardless of scheme — Upstash requires TLS;
 *   plaintext `redis://` to Upstash gets `read ECONNRESET`): ioredis
 *   auto-TLS sets boolean `true`, which StandaloneConnector merges via
 *   `Object.assign(opts, true)` (no-op) — explicit object documents the TLS path
 *   and pins SNI for multi-tenant Upstash. Absent for internal `redis://`.
 * - `family: 4` avoids Render→Upstash IPv6 stalls (default `0` tries IPv6 first,
 *   can hang past the retry budget before IPv4 fallback).
 * - `connectTimeout: 10000` / `commandTimeout: 5000` bound cold-start hangs so
 *   helpers fail open instead of blocking requests (was unset = indefinite).
 *   Every commandTimeout rejection MUST land in a handler (helpers try/catch
 *   + fire-and-forget .catch + process guard last resort) or Node exits 1.
 * - `enableOfflineQueue: true` (explicit) ensures warmup commands queue until
 *   ready instead of dropping; `keepAlive: 30000` survives LB idle.
 */
export function buildRedisOptions(url: string): Record<string, unknown> {
  const tls = isTlsRedisUrl(url)
  const opts: Record<string, unknown> = {
    lazyConnect: true,
    enableReadyCheck: true,
    enableOfflineQueue: true,
    maxRetriesPerRequest: 5,
    connectTimeout: 10_000,
    commandTimeout: 5_000,
    family: 4,
    keepAlive: 30_000,
    retryStrategy: (times: number) => Math.min(2000, 100 * Math.pow(2, times)),
  }
  if (tls) {
    // Pin SNI servername for multi-tenant TLS (Upstash routes by SNI).
    // Hostname parse is best-effort — fallback to empty tls object (Node still
    // derives SNI from host). Never throws, never logs the URL.
    try {
      const hostname = new URL(String(url).trim()).hostname?.trim()
      const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')
      opts.tls = hostname && !isIp ? { servername: hostname } : {}
    } catch {
      opts.tls = {}
    }
  }
  return opts
}

async function createClient(): Promise<RedisLike | null> {
  const url = redisUrl()
  if (!url) {
    warnUnsetOnce()
    return null
  }
  const target = redactedRedisTarget(url)
  try {
    // Static import keeps bundling simple; lazy `new` keeps import side-effect free.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const IORedis = require('ioredis') as new (url: string, opts?: any) => RedisLike
    const c = new IORedis(url, buildRedisOptions(url))
    try {
      // Ready once (redacted target only — never host/password/token).
      ;(c as any)?.on?.('ready', () => {
        if (loggedReady) return
        loggedReady = true
        logger.info(`[redis] ready (${target} family=4 tls=${isTlsRedisUrl(url)})`)
      })
      // First connection error only (helpers already fail open per-op).
      ;(c as any)?.on?.('error', (err: unknown) => {
        warnErrorOnce(err, `connect ${target}`)
      })
    } catch {}
    // Best-effort connect (don't await long — commands queue until ready).
    // Attach .catch to the connect promise BEFORE racing so a late rejection
    // (after the 1s timeout wins) still lands in a handler — otherwise the
    // commandTimeout rejection escapes as UNHANDLED and kills Node (exit 1).
    try {
      const connectP =
        typeof (c as any)?.connect === 'function'
          ? (c as any).connect().catch(() => {})
          : Promise.resolve()
      await Promise.race([connectP, new Promise((r) => setTimeout(r, 1000))])
    } catch {}
    return c
  } catch (e) {
    warnErrorOnce(e, `connect ${target}`)
    return null
  }
}

/**
 * Get the shared client (null = in-memory fallback).
 * Sync fast-path: returns existing client or null when unconfigured.
 * Triggers background connect on first use when REDIS_URL is set.
 */
export function getRedisClient(): RedisLike | null {
  if (testOverride !== undefined) return testOverride
  if (client) return client
  if (!isRedisConfigured()) {
    warnUnsetOnce()
    return null
  }
  if (!clientPromise) {
    clientPromise = createClient().then((c) => {
      if (c) client = c
      return c
    })
  }
  // Return synchronously-available client (may still be null while connecting;
  // callers treat null as fallback — next tick the client is ready).
  return client
}

/** Async readiness probe (ping with short timeout). Null-safe, never throws. */
export async function isRedisReady(): Promise<boolean> {
  try {
    // Null override = forced fallback (never ready). Non-null override must
    // still ping so a failing FakeRedis reports false (fail-open, not false-ready).
    if (testOverride !== undefined && testOverride === null) return false
    const c = getRedisClient()
    if (!c) return false
    const res = await Promise.race([
      (c as any)?.ping?.() ?? Promise.resolve('PONG'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('ping timeout')), 1000)),
    ])
    return res === 'PONG' || res != null
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Never-crash safety net (last resort ONLY — per-op try/catch is primary).
// ---------------------------------------------------------------------------

/**
 * True when an error looks like a Redis connectivity/timeout failure
 * (ECONNRESET plaintext-to-TLS, `Command timed out` via commandTimeout,
 * max-retries flush, closed connection). Used by the process guard to log
 * and survive Redis blips without crashing the API.
 * Never throws, never inspects secrets (message only).
 */
export function isRedisError(err: unknown): boolean {
  try {
    if (!err) return false
    const msg = String((err as any)?.message || err).toLowerCase()
    if (!msg || msg === '[object object]') return false
    return (
      msg.includes('command timed out') ||
      msg.includes('econnreset') ||
      msg.includes('max retries per request') ||
      msg.includes('connection is closed') ||
      msg.includes('redis') ||
      msg.includes('ioredis') ||
      msg.includes('etimedout') ||
      msg.includes('econnrefused') ||
      msg.includes('socket closed unexpectedly') ||
      msg.includes('ping timeout')
    )
  } catch {
    return false
  }
}

let guardInstalled = false

/**
 * Process-level safety net for Redis commandTimeout rejections.
 * Installs `unhandledRejection` + `uncaughtException` handlers that LOG
 * Redis errors and keep the process alive (fail-open to memory fallback).
 * Non-Redis errors preserve default behavior (log; rethrow uncaught).
 * Idempotent — safe to call twice (boot + tests). Returns true when
 * handlers are installed (always true after first call).
 *
 * WHY last resort only: every redis op path already try/catches to memory
 * fallback (lib/redis helpers, lib/cache getOrSet, throttle, locks, socket
 * presence, pub/sub). commandTimeout rejections MUST land in a handler;
 * any missed fire-and-forget `void` would otherwise exit(1) the Render
 * service. This guard ensures a missed path degrades, never downs.
 */
export function ensureRedisRejectionGuard(): boolean {
  if (guardInstalled) return true
  guardInstalled = true
  try {
    process.on('unhandledRejection', (reason: unknown) => {
      try {
        if (isRedisError(reason)) {
          logger.warn(
            { err: (reason as any)?.message || String(reason) },
            '[redis] unhandled rejection (fail-open to memory, process kept alive)'
          )
          return
        }
      } catch {}
      // Non-redis: log (preserve visibility) but do not crash here —
      // let Node default handle it (we only suppress redis).
      try {
        logger.error({ err: (reason as any)?.message || String(reason) }, '[unhandledRejection] non-redis')
      } catch {}
    })
    process.on('uncaughtException', (err: unknown) => {
      try {
        if (isRedisError(err)) {
          logger.warn(
            { err: (err as any)?.message || String(err) },
            '[redis] uncaught exception (fail-open to memory, process kept alive)'
          )
          return
        }
      } catch {}
      // Non-redis uncaught: log then rethrow to preserve crash semantics
      // (do not swallow real bugs). Re-emit async so handler returns.
      try {
        logger.error({ err: (err as any)?.message || String(err) }, '[uncaughtException] non-redis — crashing')
      } catch {}
      // Schedule exit(1) to preserve default crash for non-redis bugs.
      setImmediate(() => {
        try {
          // Remove our handler to avoid loop, then throw.
          process.removeAllListeners('uncaughtException')
        } catch {}
        throw err
      })
    })
  } catch {}
  return true
}

/** Test seam: reset guard flag (does NOT remove process listeners). */
export function __resetRedisGuardForTests(): void {
  guardInstalled = false
}

// ---------------------------------------------------------------------------
// JSON get/set/del/incr/expire (fail-open primitives)
// ---------------------------------------------------------------------------

export async function redisGet<T = unknown>(key: string): Promise<T | null> {
  const c = getRedisClient()
  if (!c) return null
  try {
    const raw = await c.get(key)
    if (raw == null) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      // Plain-string value (locks store raw tokens) — return as-is.
      return raw as unknown as T
    }
  } catch (e) {
    warnErrorOnce(e, `GET ${key}`)
    return null
  }
}

export async function redisSet(key: string, value: unknown, ttlMs?: number): Promise<boolean> {
  const c = getRedisClient()
  if (!c) return false
  try {
    const raw = typeof value === 'string' ? value : JSON.stringify(value)
    if (typeof ttlMs === 'number' && ttlMs > 0) {
      await c.set(key, raw, 'PX', Math.floor(ttlMs))
    } else {
      await c.set(key, raw)
    }
    return true
  } catch (e) {
    warnErrorOnce(e, `SET ${key}`)
    return false
  }
}

export async function redisDel(key: string): Promise<void> {
  const c = getRedisClient()
  if (!c) return
  try {
    await c.del(key)
  } catch (e) {
    warnErrorOnce(e, `DEL ${key}`)
  }
}

export async function redisIncr(key: string, ttlMs?: number): Promise<number | null> {
  const c = getRedisClient()
  if (!c) return null
  try {
    const n = await c.incr(key)
    if (n === 1 && typeof ttlMs === 'number' && ttlMs > 0) {
      try {
        await c.pexpire(key, Math.floor(ttlMs))
      } catch {}
    }
    return n
  } catch (e) {
    warnErrorOnce(e, `INCR ${key}`)
    return null
  }
}

/**
 * Track D — atomic INCRBY for token-bucket quotas (AI college tokens).
 * Uses native INCRBY when available (ioredis), else GET+SET fallback for
 * mocks (single-threaded OK; racy under true concurrency — over-admits by
 * the racing increment, never 500s). TTL set on first increment only,
 * mirroring redisIncr. Returns null when Redis unavailable (memory fallback).
 */
export async function redisIncrBy(key: string, increment: number, ttlMs?: number): Promise<number | null> {
  const c = getRedisClient()
  if (!c) return null
  const delta = Math.floor(increment)
  if (!Number.isFinite(delta) || delta <= 0) return redisIncr(key, ttlMs)
  try {
    if (typeof c.incrby === 'function') {
      const n = await c.incrby(key, delta)
      if (n === delta && typeof ttlMs === 'number' && ttlMs > 0) {
        try {
          await c.pexpire(key, Math.floor(ttlMs))
        } catch {}
      }
      return n
    }
    // Fallback for mocks without INCRBY: read-modify-write.
    const raw = await c.get(key)
    const cur = raw == null ? 0 : parseInt(raw, 10) || 0
    const next = cur + delta
    if (cur === 0 && typeof ttlMs === 'number' && ttlMs > 0) {
      await c.set(key, String(next), 'PX', Math.floor(ttlMs))
    } else {
      await c.set(key, String(next))
    }
    return next
  } catch (e) {
    warnErrorOnce(e, `INCRBY ${key}`)
    return null
  }
}

export async function redisPexpire(key: string, ttlMs: number): Promise<boolean> {
  const c = getRedisClient()
  if (!c) return false
  try {
    await c.pexpire(key, Math.floor(ttlMs))
    return true
  } catch (e) {
    warnErrorOnce(e, `PEXPIRE ${key}`)
    return false
  }
}

/** Remaining TTL ms (null when unavailable/missing). Never throws. */
export async function redisPttl(key: string): Promise<number | null> {
  const c = getRedisClient()
  if (!c) return null
  try {
    const ms = await c.pttl(key)
    return typeof ms === 'number' ? ms : null
  } catch (e) {
    warnErrorOnce(e, `PTTL ${key}`)
    return null
  }
}

/**
 * Raw SET NX PX (atomic claim for throttles/locks).
 * Returns true when the key was SET (claim won), false when it exists.
 * Returns null when Redis unavailable (caller falls back to memory/DB).
 */
export async function redisSetNxPx(key: string, value: string, ttlMs: number): Promise<boolean | null> {
  const c = getRedisClient()
  if (!c) return null
  try {
    const res = await c.set(key, value, 'PX', Math.floor(ttlMs), 'NX')
    return res === 'OK'
  } catch (e) {
    warnErrorOnce(e, `SET NX ${key}`)
    return null
  }
}

// ---------------------------------------------------------------------------
// Distributed locks (SET NX PX + Lua compare-del)
// ---------------------------------------------------------------------------

const RELEASE_LOCK_LUA = `if redis.call("GET",KEYS[1])==ARGV[1] then return redis.call("DEL",KEYS[1]) else return 0 end`

export interface RedisLockHandle {
  acquired: boolean
  token: string | null
  release: () => Promise<void>
}

function newToken(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require('crypto') as typeof import('crypto')
    return crypto.randomBytes(16).toString('hex')
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

/**
 * Try to acquire a distributed lock (atomic SET NX PX).
 * - Returns null when Redis unavailable (caller tries next layer: pg/memory).
 * - `release()` is Lua compare-del (only the owner deletes — no stealing).
 * - TTL is mandatory (deadlock guard on crash); pick per-holder max runtime.
 */
export async function acquireRedisLock(key: string, ttlMs: number): Promise<RedisLockHandle | null> {
  const c = getRedisClient()
  if (!c) return null
  const token = newToken()
  try {
    const res = await c.set(key, token, 'PX', Math.floor(ttlMs), 'NX')
    if (res !== 'OK') {
      return { acquired: false, token: null, release: async () => {} }
    }
    return {
      acquired: true,
      token,
      release: async () => {
        await releaseRedisLock(key, token)
      },
    }
  } catch (e) {
    warnErrorOnce(e, `LOCK ${key}`)
    return null
  }
}

export async function releaseRedisLock(key: string, token: string): Promise<boolean> {
  const c = getRedisClient()
  if (!c || !token) return false
  try {
    try {
      const res = await c.eval(RELEASE_LOCK_LUA, 1, key, token)
      return res === 1
    } catch {
      // Fallback for mocks without EVAL: compare-then-del (single-threaded OK).
      const cur = await c.get(key)
      if (cur === token) {
        await c.del(key)
        return true
      }
      return false
    }
  } catch (e) {
    warnErrorOnce(e, `UNLOCK ${key}`)
    return false
  }
}

// ---------------------------------------------------------------------------
// Rate-limit atomic increment (Lua when available, GET+SET fallback)
// ---------------------------------------------------------------------------

const RATELIMIT_LUA = `
local data = redis.call('GET', KEYS[1])
local windowMs = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
if (not data) then
  local resetTime = now + windowMs
  local payload = cjson.encode({totalHits=1, resetTime=resetTime})
  redis.call('SET', KEYS[1], payload, 'PX', windowMs)
  return {1, resetTime}
end
local ok, obj = pcall(cjson.decode, data)
if (not ok) or (not obj) or (not obj.resetTime) or (now > obj.resetTime) then
  local resetTime = now + windowMs
  local payload = cjson.encode({totalHits=1, resetTime=resetTime})
  redis.call('SET', KEYS[1], payload, 'PX', windowMs)
  return {1, resetTime}
end
obj.totalHits = obj.totalHits + 1
local ttl = obj.resetTime - now
if (ttl < 1) then ttl = 1 end
redis.call('SET', KEYS[1], cjson.encode(obj), 'PX', ttl)
return {obj.totalHits, obj.resetTime}
`

export interface RateLimitCount {
  totalHits: number
  resetTimeMs: number
}

/**
 * Atomic rate-limit increment in Redis.
 * Returns null when Redis unavailable (caller uses memory fallback).
 * Prefers Lua (single round-trip, no lost updates); falls back to
 * GET+SET (shared but racy under true concurrency — acceptable: per-user
 * RPS is ~0.1, a lost update over-admits by 1, never 500s).
 */
export async function redisRateLimitIncrement(cacheKey: string, windowMs: number): Promise<RateLimitCount | null> {
  const c = getRedisClient()
  if (!c) return null
  const now = Date.now()
  try {
    try {
      const res = (await c.eval(RATELIMIT_LUA, 1, cacheKey, String(windowMs), String(now))) as unknown
      const arr = res as [number, number] | number[]
      if (Array.isArray(arr) && arr.length >= 2) {
        return { totalHits: Number(arr[0]), resetTimeMs: Number(arr[1]) }
      }
    } catch {
      // Mock without EVAL support (tests) — fall through to GET+SET.
    }
    const raw = await c.get(cacheKey)
    if (!raw) {
      const resetTimeMs = now + windowMs
      await c.set(cacheKey, JSON.stringify({ totalHits: 1, resetTime: resetTimeMs }), 'PX', Math.floor(windowMs))
      return { totalHits: 1, resetTimeMs }
    }
    let obj: { totalHits: number; resetTime: number } | null = null
    try {
      obj = JSON.parse(raw)
    } catch {
      obj = null
    }
    if (!obj || !obj.resetTime || now > obj.resetTime) {
      const resetTimeMs = now + windowMs
      await c.set(cacheKey, JSON.stringify({ totalHits: 1, resetTime: resetTimeMs }), 'PX', Math.floor(windowMs))
      return { totalHits: 1, resetTimeMs }
    }
    const next = { totalHits: obj.totalHits + 1, resetTime: obj.resetTime }
    await c.set(cacheKey, JSON.stringify(next), 'PX', Math.max(1, Math.floor(next.resetTime - now)))
    return { totalHits: next.totalHits, resetTimeMs: next.resetTime }
  } catch (e) {
    warnErrorOnce(e, `RL-INCR ${cacheKey}`)
    return null
  }
}

export async function redisRateLimitGet(cacheKey: string): Promise<RateLimitCount | null> {
  const c = getRedisClient()
  if (!c) return null
  try {
    const raw = await c.get(cacheKey)
    if (!raw) return null
    const obj = JSON.parse(raw) as { totalHits: number; resetTime: number }
    if (!obj || typeof obj.totalHits !== 'number' || typeof obj.resetTime !== 'number') return null
    if (Date.now() > obj.resetTime) {
      try {
        await c.del(cacheKey)
      } catch {}
      return null
    }
    return { totalHits: obj.totalHits, resetTimeMs: obj.resetTime }
  } catch (e) {
    warnErrorOnce(e, `RL-GET ${cacheKey}`)
    return null
  }
}

/** Graceful shutdown hook (index.ts drain). Safe when never connected. */
export async function disconnectRedis(): Promise<void> {
  try {
    const c = client
    client = null
    clientPromise = null
    if (c && typeof (c as any).disconnect === 'function') {
      await (c as any).disconnect()
    } else if (c && typeof (c as any).quit === 'function') {
      await (c as any).quit()
    }
  } catch {}
}
