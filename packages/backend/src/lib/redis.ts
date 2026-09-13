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

async function createClient(): Promise<RedisLike | null> {
  const url = redisUrl()
  if (!url) {
    warnUnsetOnce()
    return null
  }
  try {
    // Static import keeps bundling simple; lazy `new` keeps import side-effect free.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const IORedis = require('ioredis') as new (url: string, opts?: any) => RedisLike
    const c = new IORedis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      retryStrategy: (times: number) => Math.min(2000, 100 * Math.pow(2, times)),
    })
    try {
      // Swallow async error events — helpers already fail open per-op.
      ;(c as any)?.on?.('error', () => {})
    } catch {}
    // Best-effort connect (don't await long — commands queue until ready).
    try {
      await Promise.race([
        (c as any)?.connect?.(),
        new Promise((r) => setTimeout(r, 1000)),
      ])
    } catch {}
    return c
  } catch (e) {
    warnErrorOnce(e, 'connect')
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
    if (testOverride !== undefined) return testOverride !== null
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
