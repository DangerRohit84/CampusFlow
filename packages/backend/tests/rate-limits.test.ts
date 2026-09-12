/**
 * General limiter 429 fix — hermetic supertest (no DB, no network).
 *
 * Locks in the "Too many requests, please try again later" fix:
 *  - N requests under limit pass; over limit → 429 with Retry-After header
 *    + { error with seconds, retryAfterSec } body (syncThrottle countdown reuse).
 *  - Per-user+IP key: two users behind one NAT IP get separate buckets
 *    (college NAT root cause — IP-only 500/15m collapsed all users).
 *  - OPTIONS (CORS preflight) skips counting.
 */
import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { generalLimiter } from '../src/middleware/rateLimits'

function fakeJwt(userId: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64')
  return `${b64({ alg: 'none' })}.${b64({ userId })}.sig`
}

function buildApp(prefix: string, limit = 3) {
  const app = express()
  app.set('trust proxy', 1)
  app.use('/api/test', generalLimiter({ windowMs: 60_000, limit, prefix }))
  app.get('/api/test', (_req, res) => res.json({ ok: true }))
  app.options('/api/test', (_req, res) => res.sendStatus(204))
  return app
}

describe('generalLimiter 429 fix (supertest, no DB)', () => {
  it('under limit passes, over limit 429 with Retry-After + retryAfterSec', async () => {
    const prefix = `rl:test-general-a-${Date.now()}-`
    const app = buildApp(prefix, 3)
    for (let i = 0; i < 3; i++) {
      const ok = await request(app).get('/api/test')
      expect(ok.status).toBe(200)
    }
    const limited = await request(app).get('/api/test')
    expect(limited.status).toBe(429)
    expect(limited.headers['retry-after']).toBeTruthy()
    expect(typeof limited.body.retryAfterSec).toBe('number')
    expect(limited.body.retryAfterSec).toBeGreaterThan(0)
    expect(String(limited.body.error)).toMatch(/try again in \d+s/)
  })

  it('per-user split: userB unaffected when userA exhausts (NAT fix)', async () => {
    const prefix = `rl:test-general-b-${Date.now()}-`
    const app = buildApp(prefix, 2)
    const a = fakeJwt('user-a')
    const b = fakeJwt('user-b')
    expect((await request(app).get('/api/test').set('Authorization', `Bearer ${a}`)).status).toBe(200)
    expect((await request(app).get('/api/test').set('Authorization', `Bearer ${a}`)).status).toBe(200)
    expect((await request(app).get('/api/test').set('Authorization', `Bearer ${a}`)).status).toBe(429)
    // Same NAT IP, different user → fresh bucket.
    const bRes = await request(app).get('/api/test').set('Authorization', `Bearer ${b}`)
    expect(bRes.status).toBe(200)
  })

  it('OPTIONS preflight does not consume budget', async () => {
    const prefix = `rl:test-general-c-${Date.now()}-`
    const app = buildApp(prefix, 2)
    expect((await request(app).get('/api/test')).status).toBe(200)
    const opt = await request(app).options('/api/test')
    expect(opt.status).not.toBe(429)
    expect((await request(app).get('/api/test')).status).toBe(200)
    // Budget was 2 GETs (OPTIONS skipped) → next GET trips.
    expect((await request(app).get('/api/test')).status).toBe(429)
  })
})
