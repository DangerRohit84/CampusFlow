/**
 * Redis PROD crash guard — TLS upgrade + never-crash rejection safety.
 *
 * PROD boot log: `read ECONNRESET` on connect + UNHANDLED
 * `Error: Command timed out` (ioredis Command.js) killed Node (exit 1).
 * Recent buildRedisOptions (commandTimeout 5000 + fail-open) introduced
 * rejections that escaped handling.
 *
 * This file locks in:
 *  (a) TLS mismatch fix — Upstash requires TLS; `redis://...upstash.io`
 *      (non-TLS scheme) got plaintext RESET. Force TLS for *.upstash.io
 *      regardless of scheme, scheme-driven otherwise.
 *  (b) Rejection safety — EVERY redis op path .catch to memory fallback;
 *      process-level safety net ONLY as last resort (log, never crash).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'

import {
  buildRedisOptions,
  isTlsRedisUrl,
  redactedRedisTarget,
  redisGet,
  redisSet,
  redisDel,
  redisIncr,
  redisIncrBy,
  redisPexpire,
  redisPttl,
  redisSetNxPx,
  acquireRedisLock,
  releaseRedisLock,
  redisRateLimitIncrement,
  redisRateLimitGet,
  isRedisReady,
  __setRedisClientForTests,
  __resetRedisForTests,
  type RedisLike,
} from '../src/lib/redis'
import {
  __resetCacheForTests,
  setCacheBackend,
  getOrSet,
} from '../src/lib/cache'

const BACKEND_SRC = path.resolve(__dirname, '../src')
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(BACKEND_SRC, rel), 'utf8')
}

let savedRedisUrl: string | undefined
beforeEach(() => {
  savedRedisUrl = process.env.REDIS_URL
  __resetRedisForTests()
  __resetCacheForTests()
})
afterEach(() => {
  if (savedRedisUrl === undefined) delete process.env.REDIS_URL
  else process.env.REDIS_URL = savedRedisUrl
  __resetRedisForTests()
  __resetCacheForTests()
})

// ---------------------------------------------------------------------------
// (a) TLS upgrade for Upstash host regardless of scheme
// ---------------------------------------------------------------------------

describe('TLS upgrade for Upstash host (ECONNRESET fix)', () => {
  it('isTlsRedisUrl forces TLS for *.upstash.io even with redis:// scheme', () => {
    expect(isTlsRedisUrl('redis://default:pw@myhost.upstash.io:6379')).toBe(true)
  })

  it('isTlsRedisUrl is case-insensitive + trims for upstash host', () => {
    expect(isTlsRedisUrl('  REDIS://default:pw@MYHOST.UPSTASH.IO:6379  ')).toBe(true)
  })

  it('isTlsRedisUrl stays scheme-driven for non-upstash hosts', () => {
    expect(isTlsRedisUrl('redis://localhost:6379')).toBe(false)
    expect(isTlsRedisUrl('redis://internal.render:6379')).toBe(false)
    expect(isTlsRedisUrl('rediss://default:pw@example:6379')).toBe(true)
  })

  it('buildRedisOptions enables TLS object for redis:// upstash host', () => {
    const opts = buildRedisOptions('redis://default:pw@myhost.upstash.io:6379') as any
    expect(opts.tls).toBeDefined()
    expect(typeof opts.tls).toBe('object')
    expect(typeof opts.tls.servername === 'string' || Object.keys(opts.tls).length === 0).toBe(true)
  })

  it('buildRedisOptions keeps no-TLS for internal redis://', () => {
    const opts = buildRedisOptions('redis://localhost:6379') as any
    expect('tls' in opts).toBe(false)
  })

  it('redactedRedisTarget reports rediss for upstash host even with redis:// scheme', () => {
    expect(redactedRedisTarget('redis://default:pw@myhost.upstash.io:6379')).toBe('rediss://REDACTED')
    expect(redactedRedisTarget('redis://localhost:6379')).toBe('redis://REDACTED')
  })
})

// ---------------------------------------------------------------------------
// (b) Rejection safety — failing client (commandTimeout) never rejects
// ---------------------------------------------------------------------------

/** Every method rejects like ioredis commandTimeout — must all fail open. */
class FailingRedis implements RedisLike {
  private err(): Error {
    const e = new Error('Command timed out')
    ;(e as any).code = 'ETIMEDOUT'
    return e
  }
  async get(): Promise<string | null> {
    throw this.err()
  }
  async set(): Promise<string | null> {
    throw this.err()
  }
  async del(): Promise<number> {
    throw this.err()
  }
  async incr(): Promise<number> {
    throw this.err()
  }
  async pexpire(): Promise<number> {
    throw this.err()
  }
  async pttl(): Promise<number> {
    throw this.err()
  }
  async eval(): Promise<unknown> {
    throw this.err()
  }
  async ping(): Promise<string> {
    throw this.err()
  }
}

describe('rejection safety — failing client fails open, never rejects', () => {
  it('every helper resolves to fallback (never throws on Command timed out)', async () => {
    __setRedisClientForTests(new FailingRedis() as unknown as RedisLike)
    await expect(redisGet('k')).resolves.toBeNull()
    await expect(redisSet('k', { a: 1 }, 1000)).resolves.toBe(false)
    await expect(redisDel('k')).resolves.toBeUndefined()
    await expect(redisIncr('k', 1000)).resolves.toBeNull()
    await expect(redisIncrBy('k', 5, 1000)).resolves.toBeNull()
    await expect(redisPexpire('k', 1000)).resolves.toBe(false)
    await expect(redisPttl('k')).resolves.toBeNull()
    await expect(redisSetNxPx('k', 'v', 1000)).resolves.toBeNull()
    await expect(acquireRedisLock('lock:k', 1000)).resolves.toBeNull()
    await expect(releaseRedisLock('lock:k', 'tok')).resolves.toBe(false)
    await expect(redisRateLimitIncrement('rl:k', 60_000)).resolves.toBeNull()
    await expect(redisRateLimitGet('rl:k')).resolves.toBeNull()
    await expect(isRedisReady()).resolves.toBe(false)
  })

  it('getOrSet fails open when backend throws (Command timed out)', async () => {
    const throwingBackend = {
      get: async () => {
        throw new Error('Command timed out')
      },
      set: async () => {
        throw new Error('Command timed out')
      },
      del: async () => {},
      incr: async () => {
        throw new Error('Command timed out')
      },
    }
    setCacheBackend(throwingBackend as any)
    let loaderCalls = 0
    const val = await getOrSet('crash:key', 60_000, async () => {
      loaderCalls++
      return { n: 42 }
    })
    expect(val).toEqual({ n: 42 })
    expect(loaderCalls).toBe(1)
  })

  it('getOrSet still serves loader when set throws after load', async () => {
    const failSetBackend = {
      get: async () => null,
      set: async () => {
        throw new Error('Command timed out')
      },
      del: async () => {},
      incr: async () => 1,
    }
    setCacheBackend(failSetBackend as any)
    await expect(getOrSet('crash:key2', 60_000, async () => 'fresh')).resolves.toBe('fresh')
  })
})

describe('process-level safety net (last resort, log never crash)', () => {
  it('lib/redis exports isRedisError + ensureRedisRejectionGuard', async () => {
    const mod = await import('../src/lib/redis')
    expect(typeof (mod as any).isRedisError).toBe('function')
    expect(typeof (mod as any).ensureRedisRejectionGuard).toBe('function')
  })

  it('isRedisError detects Command timed out / ECONNRESET / max retries', async () => {
    const { isRedisError } = await import('../src/lib/redis')
    expect(isRedisError(new Error('Command timed out'))).toBe(true)
    expect(isRedisError(new Error('read ECONNRESET'))).toBe(true)
    expect(isRedisError(new Error('Reached the max retries per request limit (try 5)'))).toBe(true)
    expect(isRedisError(new Error('Connection is closed'))).toBe(true)
    expect(isRedisError(new Error('some totally unrelated bug'))).toBe(false)
    expect(isRedisError(null)).toBe(false)
    expect(isRedisError(undefined)).toBe(false)
  })

  it('ensureRedisRejectionGuard is idempotent and returns installed flag', async () => {
    const { ensureRedisRejectionGuard } = await import('../src/lib/redis')
    expect(ensureRedisRejectionGuard()).toBe(true)
    expect(ensureRedisRejectionGuard()).toBe(true)
  })
})

describe('source lock-in (rejection safety shipped)', () => {
  it('lib/redis forces TLS for upstash.io + has crash guard', () => {
    const src = readSrc('lib/redis.ts')
    expect(src).toContain('upstash')
    expect(src).toContain('unhandledRejection')
    expect(src).toContain('ensureRedisRejectionGuard')
    expect(src).toContain('isRedisError')
  })

  it('fire-and-forget redis calls all .catch (no bare void redis*)', () => {
    const socketSrc = readSrc('services/socket.ts')
    // Every `void redis*` line must land its timeout rejection in a handler.
    const socketVoidLines = socketSrc.split('\n').filter((l) => l.includes('void redis'))
    expect(socketVoidLines.length).toBeGreaterThan(0)
    for (const line of socketVoidLines) {
      expect(line).toMatch(/\.catch\(/)
    }
    const authSrc = readSrc('middleware/auth.ts')
    const authVoidLines = authSrc.split('\n').filter((l) => l.includes('void redis'))
    expect(authVoidLines.length).toBeGreaterThan(0)
    for (const line of authVoidLines) {
      expect(line).toMatch(/\.catch\(/)
    }
  })

  it('getOrSet is fail-open (try/catch in lib/cache.ts)', () => {
    const src = readSrc('lib/cache.ts')
    // getOrSet body must contain try/catch (fail-open to loader on Command timed out).
    const idx = src.indexOf('export async function getOrSet')
    expect(idx).toBeGreaterThan(-1)
    const body = src.slice(idx, idx + 1500)
    expect(body).toContain('try')
    expect(body).toContain('catch')
  })

  it('boot installs crash guard (index.ts)', () => {
    const src = readSrc('index.ts')
    expect(src).toContain('ensureRedisRejectionGuard')
  })
})
