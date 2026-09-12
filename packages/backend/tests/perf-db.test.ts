/**
 * perf-db harness — 10k scale: pagination + cache + validators + retry
 * TDD RED: these imports do not exist yet — watch this fail, then GREEN.
 */
import { describe, it, expect } from 'vitest'
import { parsePagination, paged, encodeCursor, decodeCursor, buildCursorWhere } from '../src/lib/pagination'
import { InMemoryCache, cache, createCacheRateLimitStore } from '../src/lib/cache'
import { RoleEnum, InternshipStatusEnum, targetDepartmentsSchema, themesSchema, coerceDeadline, dualWriteJson } from '../src/lib/validators'
import { isRetryableError, withRetry } from '../src/config/db'

describe('pagination utils (paged generic + cursor)', () => {
  it('parsePagination clamps page/limit', () => {
    expect(parsePagination({ page: '0', limit: '999' })).toEqual({ page: 1, limit: 50, skip: 0 })
    expect(parsePagination({ page: '2', limit: '10' })).toEqual({ page: 2, limit: 10, skip: 10 })
    expect(parsePagination({})).toEqual({ page: 1, limit: 20, skip: 0 })
  })

  it('paged() builds envelope with pages + Link-ready meta', async () => {
    const result = await paged(async (skip: number, take: number) => {
      expect(skip).toBe(0)
      expect(take).toBe(2)
      return { rows: [{ id: 'a' }, { id: 'b' }], total: 5 }
    }, { page: 1, limit: 2 })
    expect(result).toEqual({
      data: [{ id: 'a' }, { id: 'b' }],
      pagination: { page: 1, limit: 2, total: 5, pages: 3 },
    })
  })

  it('cursor encode/decode round-trips', () => {
    const cursor = encodeCursor({ id: 'abc123', createdAt: '2026-01-01T00:00:00.000Z' })
    expect(typeof cursor).toBe('string')
    expect(decodeCursor(cursor)).toEqual({ id: 'abc123', createdAt: '2026-01-01T00:00:00.000Z' })
    expect(decodeCursor('!!!not-base64!!!')).toBeNull()
    expect(decodeCursor(null as any)).toBeNull()
  })

  it('buildCursorWhere returns prisma cursor clause or empty', () => {
    expect(buildCursorWhere(null)).toEqual({})
    expect(buildCursorWhere(encodeCursor({ id: 'x' }))).toEqual({ cursor: { id: 'x' }, skip: 1 })
  })
})

describe('cache abstraction (in-memory now, Redis later)', () => {
  it('InMemoryCache get/set/del with TTL', async () => {
    const c = new InMemoryCache()
    await c.set('k', 'v', 50)
    expect(await c.get('k')).toBe('v')
    await new Promise((r) => setTimeout(r, 60))
    expect(await c.get('k')).toBeNull()
    await c.set('k2', { a: 1 })
    expect(await c.get('k2')).toEqual({ a: 1 })
    await c.del('k2')
    expect(await c.get('k2')).toBeNull()
  })

  it('InMemoryCache incr is atomic-ish', async () => {
    const c = new InMemoryCache()
    expect(await c.incr('hits')).toBe(1)
    expect(await c.incr('hits')).toBe(2)
    expect(await c.get('hits')).toBe(2)
  })

  it('singleton cache is shared', async () => {
    await cache.set('shared', 'yes')
    expect(await cache.get('shared')).toBe('yes')
    await cache.del('shared')
  })

  it('CacheRateLimitStore increment/decrement/resetKey', async () => {
    const c = new InMemoryCache()
    const store: any = createCacheRateLimitStore(c, 60_000)
    store.init?.({ windowMs: 60_000 } as any)
    const r1 = await store.increment('ip:1')
    expect(r1.totalHits).toBe(1)
    expect(r1.resetTime).toBeInstanceOf(Date)
    const r2 = await store.increment('ip:1')
    expect(r2.totalHits).toBe(2)
    await store.decrement('ip:1')
    const got = await store.get?.('ip:1')
    expect(got?.totalHits).toBe(1)
    await store.resetKey('ip:1')
    expect(await store.get?.('ip:1')).toBeUndefined()
  })
})

describe('validators (Role/Status enums + Json dual-write)', () => {
  it('RoleEnum guards 4 roles', () => {
    expect(RoleEnum.safeParse('STUDENT').success).toBe(true)
    expect(RoleEnum.safeParse('SUPER_ADMIN').success).toBe(true)
    expect(RoleEnum.safeParse('HACKER').success).toBe(false)
  })

  it('InternshipStatusEnum guards ACTIVE/ENDED', () => {
    expect(InternshipStatusEnum.safeParse('ACTIVE').success).toBe(true)
    expect(InternshipStatusEnum.safeParse('DELETED').success).toBe(false)
  })

  it('targetDepartments accepts array or JSON string', () => {
    expect(targetDepartmentsSchema.safeParse(['CSE', 'IT']).success).toBe(true)
    expect(targetDepartmentsSchema.safeParse('["CSE","IT"]').success).toBe(true)
    expect(targetDepartmentsSchema.safeParse('not-json').success).toBe(false)
    expect(targetDepartmentsSchema.parse([])).toEqual([])
  })

  it('themes accepts array or JSON string', () => {
    expect(themesSchema.safeParse(['AI', 'Web']).success).toBe(true)
    expect(themesSchema.safeParse('[]').success).toBe(true)
  })

  it('coerceDeadline parses ISO + date-only, rejects garbage', () => {
    const d = coerceDeadline('2026-09-25')
    expect(d).toBeInstanceOf(Date)
    expect(coerceDeadline('')).toBeNull()
    expect(coerceDeadline(null)).toBeNull()
    expect(coerceDeadline('not-a-date')).toBeNull()
    // Date instance passes through
    const now = new Date()
    expect(coerceDeadline(now)).toBe(now)
  })

  it('dualWriteJson keeps String compat + Json canonical', () => {
    const out = dualWriteJson(['CSE', 'IT'])
    expect(out.stringValue).toBe('["CSE","IT"]')
    expect(out.jsonValue).toEqual(['CSE', 'IT'])
    const out2 = dualWriteJson('["CSE"]')
    expect(out2.jsonValue).toEqual(['CSE'])
    const out3 = dualWriteJson([])
    expect(out3.stringValue).toBe('[]')
  })
})

describe('db retry (explicit, no Proxy magic)', () => {
  it('isRetryableError flags P1001/P1002/P1017 + pool timeout', () => {
    expect(isRetryableError({ code: 'P1001', message: "Can't reach database server" })).toBe(true)
    expect(isRetryableError({ code: 'P1002', message: 'timed out' })).toBe(true)
    expect(isRetryableError({ code: 'P2025', message: 'not found' })).toBe(false)
    expect(isRetryableError({ message: 'Timed out fetching a new connection' })).toBe(true)
    expect(isRetryableError(null)).toBe(false)
  })

  it('withRetry retries transient then succeeds', async () => {
    let attempts = 0
    const result = await withRetry(async () => {
      attempts++
      if (attempts < 3) throw { code: 'P1001', message: "Can't reach database server" }
      return 'ok'
    }, { retries: 3, baseDelayMs: 5, label: 'test' })
    expect(result).toBe('ok')
    expect(attempts).toBe(3)
  })

  it('withRetry does not retry non-retryable', async () => {
    let attempts = 0
    await expect(
      withRetry(async () => {
        attempts++
        throw { code: 'P2025', message: 'not found' }
      }, { retries: 3, baseDelayMs: 5 })
    ).rejects.toMatchObject({ code: 'P2025' })
    expect(attempts).toBe(1)
  })
})
