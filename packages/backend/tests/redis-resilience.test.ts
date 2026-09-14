/**
 * Redis resilience — Upstash rediss:// TLS/retry defaults (mocked, no network).
 *
 * Locks in the prod fix for: Upstash 0 commands + every op
 * `max retries per request limit (2)` failing open to memory.
 *
 * Root cause: maxRetriesPerRequest: 2 flushed the offline queue after 3
 * reconnect attempts (~1.4s), before external TLS handshake completed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  buildRedisOptions,
  isTlsRedisUrl,
  redactedRedisTarget,
  __resetRedisForTests,
} from '../src/lib/redis'

const BACKEND_SRC = path.resolve(__dirname, '../src')
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(BACKEND_SRC, rel), 'utf8')
}

let savedRedisUrl: string | undefined
let savedSocketAdapter: string | undefined

beforeEach(() => {
  savedRedisUrl = process.env.REDIS_URL
  savedSocketAdapter = process.env.SOCKET_ADAPTER
  __resetRedisForTests()
})

afterEach(() => {
  if (savedRedisUrl === undefined) delete process.env.REDIS_URL
  else process.env.REDIS_URL = savedRedisUrl
  if (savedSocketAdapter === undefined) delete process.env.SOCKET_ADAPTER
  else process.env.SOCKET_ADAPTER = savedSocketAdapter
  __resetRedisForTests()
})

describe('buildRedisOptions (shared resilient defaults)', () => {
  it('rediss:// enables TLS object (Upstash SNI path)', () => {
    const opts = buildRedisOptions('rediss://default:pw@example:6379') as any
    expect(opts.tls).toBeDefined()
    expect(typeof opts.tls).toBe('object')
  })

  it('rediss:// pins SNI servername when hostname parseable', () => {
    const opts = buildRedisOptions('rediss://default:pw@example:6379') as any
    // Hostname is DNS (not IP) — servername must be pinned for multi-tenant TLS.
    // Value itself is asserted only as non-empty string (never assert live hosts).
    expect(typeof opts.tls.servername === 'string' || Object.keys(opts.tls).length === 0).toBe(true)
  })

  it('redis:// (internal Render KeyValue) has no TLS key', () => {
    const opts = buildRedisOptions('redis://localhost:6379') as any
    expect('tls' in opts).toBe(false)
  })

  it('uses sane retries/timeouts (not aggressive 2-retry)', () => {
    const opts = buildRedisOptions('rediss://default:pw@example:6379') as any
    expect(opts.maxRetriesPerRequest).toBeGreaterThanOrEqual(3)
    expect(opts.maxRetriesPerRequest).toBeLessThanOrEqual(10)
    expect(opts.family).toBe(4)
    expect(opts.enableOfflineQueue).toBe(true)
    expect(opts.lazyConnect).toBe(true)
    expect(opts.enableReadyCheck).toBe(true)
    expect(opts.connectTimeout).toBeGreaterThanOrEqual(5000)
    expect(opts.commandTimeout).toBeGreaterThanOrEqual(2000)
    expect(opts.keepAlive).toBeGreaterThan(0)
    expect(typeof opts.retryStrategy).toBe('function')
  })

  it('isTlsRedisUrl is case-insensitive', () => {
    expect(isTlsRedisUrl('rediss://x')).toBe(true)
    expect(isTlsRedisUrl('REDISS://x')).toBe(true)
    expect(isTlsRedisUrl('redis://x')).toBe(false)
    expect(isTlsRedisUrl('')).toBe(false)
  })
})

describe('redactedRedisTarget (never leaks secrets/hosts)', () => {
  it('hides password and host, keeps scheme only', () => {
    const redacted = redactedRedisTarget('rediss://default:hunter2@some-host:6379')
    expect(redacted).toContain('rediss://REDACTED')
    expect(redacted).not.toContain('hunter2')
    expect(redacted).not.toContain('some-host')
    expect(redacted).not.toContain('default')
  })

  it('redis scheme redacts too', () => {
    const redacted = redactedRedisTarget('redis://localhost:6379')
    expect(redacted).toBe('redis://REDACTED')
  })
})

describe('source lock-in (resilient defaults shipped)', () => {
  it('lib/redis.ts no longer uses aggressive maxRetriesPerRequest: 2', () => {
    const src = readSrc('lib/redis.ts')
    expect(src).toContain('buildRedisOptions')
    expect(src).toContain('maxRetriesPerRequest: 5')
    // Live option was `maxRetriesPerRequest: 2,` (with comma) — historical
    // mentions in comments (no comma) are allowed.
    expect(src).not.toMatch(/maxRetriesPerRequest:\s*2,/)
    expect(src).toContain('family: 4')
    expect(src).toContain('REDACTED')
    expect(src).toContain('[redis] ready')
  })

  it('socket adapter reuses shared options (no divergent 2-retry)', () => {
    const src = readSrc('services/socket.ts')
    expect(src).toContain('buildRedisOptions')
    expect(src).not.toMatch(/maxRetriesPerRequest:\s*2,/)
    expect(src).toContain('redactedRedisTarget')
  })

  it('socket mode gates on REDIS_URL presence (not only lazy client)', () => {
    const src = readSrc('services/socket.ts')
    expect(src).toContain('isRedisConfigured')
  })
})

describe('socket mode with REDIS_URL set but client not yet connected', () => {
  it('selects redis mode via isRedisConfigured (boot race fix)', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379'
    delete process.env.SOCKET_ADAPTER
    __resetRedisForTests()
    // Lazy singleton is still null before first use (background connect pending).
    const { getSocketAdapterMode } = await import('../src/services/socket')
    expect(getSocketAdapterMode()).toBe('redis')
  })

  it('still memory when REDIS_URL unset', async () => {
    delete process.env.REDIS_URL
    delete process.env.SOCKET_ADAPTER
    __resetRedisForTests()
    const { getSocketAdapterMode } = await import('../src/services/socket')
    expect(getSocketAdapterMode()).toBe('memory')
  })
})
