/**
 * Scale10k Redis — shared-store tests (hermetic, no live Redis in CI).
 *
 * Proves behavior identical single-instance, correct multi-instance:
 * - Fail-open: REDIS_URL unset → all helpers return null/false (memory path).
 * - Shared: two store objects (two API replicas) behind one FakeRedis see
 *   ONE counter (rate-limit), ONE throttle claim, ONE lock.
 * - Contracts preserved: 429 shape + retryAfterSec, 60s throttle + countdown,
 *   60s authorize TTL, advisory-lock key stability.
 *
 * No network, no DB, no timers beyond short TTL math (PTTL-based).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import fs from 'fs'
import path from 'path'

import {
  getRedisClient,
  redisGet,
  redisSet,
  redisDel,
  redisIncr,
  redisPttl,
  redisSetNxPx,
  acquireRedisLock,
  releaseRedisLock,
  redisRateLimitIncrement,
  redisRateLimitGet,
  __setRedisClientForTests,
  __resetRedisForTests,
  type RedisLike,
} from '../src/lib/redis'
import { InMemoryCache, RedisCache, createSharedRateLimitStore, __resetCacheForTests } from '../src/lib/cache'
import { checkAndClaimSyncThrottle, clearSyncThrottleStore, __resetSyncThrottleStoreForTests } from '../src/services/syncThrottleStore'
import { tryAcquireProfileSyncLock, PROFILE_SYNC_LOCK_KEY } from '../src/services/syncLock'
import { generalLimiter } from '../src/middleware/rateLimits'

const BACKEND_SRC = path.resolve(__dirname, '../src')
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(BACKEND_SRC, rel), 'utf8')
}

// ---------------------------------------------------------------------------
// FakeRedis: in-memory RedisLike (shared Map = one Redis server).
// Supports PX/NX, PTTL, INCR (TTL-preserving), and EVAL for both Lua scripts
// (lock release compare-del + rate-limit cjson increment).
// ---------------------------------------------------------------------------

type Entry = { val: string; exp: number | null }

class FakeRedis implements RedisLike {
  store = new Map<string, Entry>()
  evalCalls = 0

  private isExpired(e: Entry): boolean {
    return e.exp !== null && Date.now() > e.exp
  }

  private read(key: string): Entry | null {
    const e = this.store.get(key)
    if (!e) return null
    if (this.isExpired(e)) {
      this.store.delete(key)
      return null
    }
    return e
  }

  async get(key: string): Promise<string | null> {
    return this.read(key)?.val ?? null
  }

  async set(key: string, value: string, ...args: Array<string | number>): Promise<string | null> {
    let px: number | null = null
    let nx = false
    for (let i = 0; i < args.length; i++) {
      const a = String(args[i]).toUpperCase()
      if (a === 'PX' && i + 1 < args.length) {
        px = Number(args[i + 1])
        i++
      } else if (a === 'NX') {
        nx = true
      }
    }
    if (nx && this.read(key) !== null) return null
    this.store.set(key, { val: value, exp: px != null && px > 0 ? Date.now() + px : null })
    return 'OK'
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0
    for (const k of keys) {
      const e = this.store.get(k)
      if (e && !this.isExpired(e)) n++
      this.store.delete(k)
    }
    return n
  }

  async incr(key: string): Promise<number> {
    const cur = this.read(key)
    const n = (cur ? parseInt(cur.val, 10) || 0 : 0) + 1
    this.store.set(key, { val: String(n), exp: cur?.exp ?? null })
    return n
  }

  async pexpire(key: string, ms: number): Promise<number> {
    const e = this.read(key)
    if (!e) return 0
    e.exp = Date.now() + ms
    this.store.set(key, e)
    return 1
  }

  async pttl(key: string): Promise<number> {
    const e = this.store.get(key)
    if (!e) return -2
    if (this.isExpired(e)) {
      this.store.delete(key)
      return -2
    }
    if (e.exp === null) return -1
    return Math.max(0, e.exp - Date.now())
  }

  async eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown> {
    this.evalCalls++
    const keys = args.slice(0, numKeys).map(String)
    const argv = args.slice(numKeys).map(String)
    // Lock release: compare-del.
    if (script.includes('redis.call("GET"') && script.includes('DEL') && !script.includes('cjson')) {
      const cur = await this.get(keys[0])
      if (cur === argv[0]) {
        await this.del(keys[0])
        return 1
      }
      return 0
    }
    // Rate-limit Lua: atomic GET+SET over JSON {totalHits, resetTime}.
    if (script.includes('cjson')) {
      const cacheKey = keys[0]
      const windowMs = Number(argv[0])
      const now = Number(argv[1])
      const raw = await this.get(cacheKey)
      if (!raw) {
        const resetTime = now + windowMs
        await this.set(cacheKey, JSON.stringify({ totalHits: 1, resetTime }), 'PX', windowMs)
        return [1, resetTime]
      }
      let obj: { totalHits: number; resetTime: number } | null = null
      try {
        obj = JSON.parse(raw)
      } catch {
        obj = null
      }
      if (!obj || !obj.resetTime || now > obj.resetTime) {
        const resetTime = now + windowMs
        await this.set(cacheKey, JSON.stringify({ totalHits: 1, resetTime }), 'PX', windowMs)
        return [1, resetTime]
      }
      const next = { totalHits: obj.totalHits + 1, resetTime: obj.resetTime }
      await this.set(cacheKey, JSON.stringify(next), 'PX', Math.max(1, next.resetTime - now))
      return [next.totalHits, next.resetTime]
    }
    throw new Error('FakeRedis: unsupported script')
  }
}

let savedRedisUrl: string | undefined

beforeEach(() => {
  savedRedisUrl = process.env.REDIS_URL
  __resetRedisForTests()
  __resetCacheForTests()
  __resetSyncThrottleStoreForTests()
})

afterEach(() => {
  if (savedRedisUrl === undefined) delete process.env.REDIS_URL
  else process.env.REDIS_URL = savedRedisUrl
  __resetRedisForTests()
  __resetCacheForTests()
  __resetSyncThrottleStoreForTests()
})

function fakeJwt(userId: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64')
  return `${b64({ alg: 'none' })}.${b64({ userId })}.sig`
}

// ---------------------------------------------------------------------------
// 1. Fail-open with no Redis (dev/CI single-instance)
// ---------------------------------------------------------------------------

describe('redis fail-open (REDIS_URL unset → memory)', () => {
  it('helpers return null/false without throwing', async () => {
    delete process.env.REDIS_URL
    __resetRedisForTests()
    expect(getRedisClient()).toBeNull()
    await expect(redisGet('k')).resolves.toBeNull()
    await expect(redisSet('k', { a: 1 }, 1000)).resolves.toBe(false)
    await expect(redisIncr('k', 1000)).resolves.toBeNull()
    await expect(redisPttl('k')).resolves.toBeNull()
    await expect(redisSetNxPx('k', 'v', 1000)).resolves.toBeNull()
    await expect(acquireRedisLock('lock:k', 1000)).resolves.toBeNull()
    await expect(redisRateLimitIncrement('rl:k', 60_000)).resolves.toBeNull()
    await expect(redisRateLimitGet('rl:k')).resolves.toBeNull()
  })

  it('InMemoryCache preserves TTL on incr-without-ttl (rate-limit window)', async () => {
    const m = new InMemoryCache()
    await m.set('w', 1, 60_000)
    const n = await m.incr('w')
    expect(n).toBe(2)
    // Still present (TTL preserved, not dropped to persistent).
    expect(await m.get('w')).toBe(2)
  })

  it('RedisCache falls back to memory when Redis is unset', async () => {
    delete process.env.REDIS_URL
    __resetRedisForTests()
    const rc = new RedisCache()
    await rc.set('rk', { n: 1 }, 60_000)
    expect(await rc.get('rk')).toEqual({ n: 1 })
    expect(await rc.incr('cnt', 60_000)).toBe(1)
    expect(await rc.incr('cnt')).toBe(2)
    await rc.del('rk')
    expect(await rc.get('rk')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 2. Shared primitives via FakeRedis (one server, N clients)
// ---------------------------------------------------------------------------

describe('redis primitives via FakeRedis (shared)', () => {
  it('get/set/del/incr/pttl round-trip as JSON', async () => {
    __setRedisClientForTests(new FakeRedis())
    expect(await redisSet('obj', { role: 'TEACHER' }, 60_000)).toBe(true)
    expect(await redisGet('obj')).toEqual({ role: 'TEACHER' })
    const ttl = await redisPttl('obj')
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(60_000)
    expect(await redisIncr('hits', 60_000)).toBe(1)
    expect(await redisIncr('hits')).toBe(2)
    await redisDel('obj')
    expect(await redisGet('obj')).toBeNull()
  })

  it('SET NX PX claims once (throttle/lock atomicity)', async () => {
    __setRedisClientForTests(new FakeRedis())
    expect(await redisSetNxPx('claim:u1', 't1', 60_000)).toBe(true)
    expect(await redisSetNxPx('claim:u1', 't2', 60_000)).toBe(false)
    await redisDel('claim:u1')
    expect(await redisSetNxPx('claim:u1', 't3', 60_000)).toBe(true)
  })

  it('distributed lock: acquire → held → owner-release → re-acquire', async () => {
    const fake = new FakeRedis()
    __setRedisClientForTests(fake)
    const a = await acquireRedisLock('lock:test', 60_000)
    expect(a?.acquired).toBe(true)
    const b = await acquireRedisLock('lock:test', 60_000)
    expect(b?.acquired).toBe(false)
    // Wrong token cannot steal.
    expect(await releaseRedisLock('lock:test', 'wrong-token')).toBe(false)
    await a!.release()
    const c = await acquireRedisLock('lock:test', 60_000)
    expect(c?.acquired).toBe(true)
    await c!.release()
  })

  it('rate-limit increment is atomic via Lua and shared', async () => {
    const fake = new FakeRedis()
    __setRedisClientForTests(fake)
    const first = await redisRateLimitIncrement('rl:shared', 60_000)
    expect(first?.totalHits).toBe(1)
    const second = await redisRateLimitIncrement('rl:shared', 60_000)
    expect(second?.totalHits).toBe(2)
    expect(second?.resetTimeMs).toBe(first?.resetTimeMs)
    expect(fake.evalCalls).toBeGreaterThan(0)
    const got = await redisRateLimitGet('rl:shared')
    expect(got?.totalHits).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 3. Shared rate-limit store: two replicas, one budget (429 contract intact)
// ---------------------------------------------------------------------------

describe('shared rate-limit store (two replicas, one budget)', () => {
  it('two store objects share ONE counter via FakeRedis', async () => {
    __setRedisClientForTests(new FakeRedis())
    const prefix = `rl:test-shared-${Date.now()}-`
    const storeA = createSharedRateLimitStore(60_000, prefix)
    const storeB = createSharedRateLimitStore(60_000, prefix)
    const r1 = await storeA.increment('userX')
    expect(r1.totalHits).toBe(1)
    const r2 = await storeB.increment('userX')
    expect(r2.totalHits).toBe(2)
    expect(r2.resetTime.getTime()).toBe(r1.resetTime.getTime())
    const got = await storeA.get('userX')
    expect(got?.totalHits).toBe(2)
  })

  it('replica B 429s when replica A exhausts (multi-instance 429 shape)', async () => {
    __setRedisClientForTests(new FakeRedis())
    const prefix = `rl:test-429-${Date.now()}-`
    const buildApp = () => {
      const app = express()
      app.set('trust proxy', 1)
      // NOTE: create the limiter per app BUT share the prefix + FakeRedis —
      // mirrors two Render replicas behind one Redis.
      app.use('/api/test', generalLimiter({ windowMs: 60_000, limit: 2, prefix }))
      app.get('/api/test', (_req, res) => res.json({ ok: true }))
      return app
    }
    // generalLimiter builds a fresh memory fallback per instance; sharing
    // comes from FakeRedis. Exhaust via appA…
    const appA = buildApp()
    expect((await request(appA).get('/api/test')).status).toBe(200)
    expect((await request(appA).get('/api/test')).status).toBe(200)
    // …replica B (same prefix+Redis) sees the shared budget.
    const appB = buildApp()
    const limited = await request(appB).get('/api/test')
    expect(limited.status).toBe(429)
    expect(limited.headers['retry-after']).toBeTruthy()
    expect(typeof limited.body.retryAfterSec).toBe('number')
    expect(String(limited.body.error)).toMatch(/try again in \d+s/)
  })

  it('memory fallback still 429s locally when Redis is unset', async () => {
    delete process.env.REDIS_URL
    __resetRedisForTests()
    const prefix = `rl:test-fallback-${Date.now()}-`
    const store = createSharedRateLimitStore(60_000, prefix)
    await store.increment('k')
    await store.increment('k')
    const third = await store.increment('k')
    expect(third.totalHits).toBe(3)
    expect((await store.get('k'))?.totalHits).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// 4. syncThrottle via Redis (60s contract + countdown preserved)
// ---------------------------------------------------------------------------

describe('syncThrottle Redis claim (60s + countdown)', () => {
  it('first claim allowed, second denied with retryAfterSec, clear re-allows', async () => {
    __setRedisClientForTests(new FakeRedis())
    const noTableDb = {}
    const first = await checkAndClaimSyncThrottle('su1', { nowMs: 1000, windowMs: 60_000, prismaClient: noTableDb })
    expect(first.allowed).toBe(true)
    const second = await checkAndClaimSyncThrottle('su1', { nowMs: 2000, windowMs: 60_000, prismaClient: noTableDb })
    expect(second.allowed).toBe(false)
    expect(second.retryAfterSec).toBeGreaterThan(0)
    expect(second.retryAfterSec).toBeLessThanOrEqual(60)
    await clearSyncThrottleStore('su1', noTableDb)
    const again = await checkAndClaimSyncThrottle('su1', { nowMs: 3000, windowMs: 60_000, prismaClient: noTableDb })
    expect(again.allowed).toBe(true)
  })

  it('two users get independent Redis windows', async () => {
    __setRedisClientForTests(new FakeRedis())
    const noTableDb = {}
    expect((await checkAndClaimSyncThrottle('suA', { nowMs: 1000, prismaClient: noTableDb })).allowed).toBe(true)
    expect((await checkAndClaimSyncThrottle('suB', { nowMs: 1000, prismaClient: noTableDb })).allowed).toBe(true)
    expect((await checkAndClaimSyncThrottle('suA', { nowMs: 2000, prismaClient: noTableDb })).allowed).toBe(false)
    expect((await checkAndClaimSyncThrottle('suB', { nowMs: 2000, prismaClient: noTableDb })).allowed).toBe(false)
  })

  it('falls back to DB/memory when Redis is unset (existing contract)', async () => {
    delete process.env.REDIS_URL
    __resetRedisForTests()
    __resetSyncThrottleStoreForTests()
    const noTableDb = {}
    expect((await checkAndClaimSyncThrottle('suF', { nowMs: 1000, prismaClient: noTableDb })).allowed).toBe(true)
    const second = await checkAndClaimSyncThrottle('suF', { nowMs: 2000, prismaClient: noTableDb })
    expect(second.allowed).toBe(false)
    expect(second.retryAfterSec).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// 5. syncLock via Redis (pg secondary, key stability)
// ---------------------------------------------------------------------------

describe('syncLock Redis primary + pg secondary', () => {
  it('Redis held → second acquirer skips; release → re-acquire', async () => {
    __setRedisClientForTests(new FakeRedis())
    const pgFree = { $queryRaw: async () => [{ acquired: true }] }
    const a = await tryAcquireProfileSyncLock(pgFree as any)
    expect(a.acquired).toBe(true)
    const b = await tryAcquireProfileSyncLock(pgFree as any)
    expect(b.acquired).toBe(false)
    await a.release()
    const c = await tryAcquireProfileSyncLock(pgFree as any)
    expect(c.acquired).toBe(true)
    await c.release()
  })

  it('falls back to pg advisory when Redis is unset (key stability)', async () => {
    delete process.env.REDIS_URL
    __resetRedisForTests()
    expect(PROFILE_SYNC_LOCK_KEY).toBe(7279001)
    const held = { $queryRaw: async () => [{ acquired: false }] }
    expect((await tryAcquireProfileSyncLock(held as any)).acquired).toBe(false)
    const throwing = {
      $queryRaw: async () => {
        throw new Error('no pg here')
      },
    }
    // Fail open (documented): lock infra never blocks sync.
    expect((await tryAcquireProfileSyncLock(throwing as any)).acquired).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 6. Authorize + ETag + socket contracts (static + shared-key round-trip)
// ---------------------------------------------------------------------------

describe('authorize / etag / socket contracts', () => {
  it('authorize caches role+college 60s via shared key shape (static + round-trip)', async () => {
    const src = readSrc('middleware/auth.ts')
    expect(src).toContain('authz:')
    expect(src).toContain('60_000')
    expect(src).toContain('collegeId')
    // Shared key round-trips the {role, collegeId} entry shape.
    __setRedisClientForTests(new FakeRedis())
    expect(await redisSet('authz:probe', { role: 'TEACHER', collegeId: 'c1' }, 60_000)).toBe(true)
    expect(await redisGet('authz:probe')).toEqual({ role: 'TEACHER', collegeId: 'c1' })
  })

  it('etag middleware stays stateless (no shared store to migrate)', () => {
    const src = readSrc('middleware/etagCache.ts')
    expect(src).toContain('SCALE10k')
    expect(src).not.toMatch(/require\(['"]\.\.\/lib\/redis['"]\)|from ['"]\.\.\/lib\/redis['"]/)
  })

  it('socket presence shares via presence:* keys (round-trip)', async () => {
    const src = readSrc('services/socket.ts')
    expect(src).toContain('presence:')
    expect(src).toContain('isUserOnlineShared')
    __setRedisClientForTests(new FakeRedis())
    expect(await redisSet('presence:u9', '1', 24 * 60 * 60 * 1000)).toBe(true)
    // '1' JSON-parses to 1 on read (redisGet) — either shape means "online".
    expect(await redisGet('presence:u9')).toEqual(1)
    await redisDel('presence:u9')
    expect(await redisGet('presence:u9')).toBeNull()
  })

  it('per-user rate key splits NAT users (contract lock-in)', async () => {
    __setRedisClientForTests(new FakeRedis())
    const prefix = `rl:test-nat-${Date.now()}-`
    const app = express()
    app.set('trust proxy', 1)
    app.use('/api/test', generalLimiter({ windowMs: 60_000, limit: 1, prefix }))
    app.get('/api/test', (_req, res) => res.json({ ok: true }))
    const a = fakeJwt('nat-a')
    const b = fakeJwt('nat-b')
    expect((await request(app).get('/api/test').set('Authorization', `Bearer ${a}`)).status).toBe(200)
    expect((await request(app).get('/api/test').set('Authorization', `Bearer ${a}`)).status).toBe(429)
    // Same NAT IP, different user → fresh bucket (shared or memory, same rule).
    expect((await request(app).get('/api/test').set('Authorization', `Bearer ${b}`)).status).toBe(200)
  })
})
