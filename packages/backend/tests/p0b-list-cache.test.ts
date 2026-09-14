/**
 * P0-B RED: shared 5m list cache + singleflight + TTL table.
 * Plan §P0-3 + §4.1 + §9 caching track.
 * These tests MUST fail before implementation (modules don't exist yet).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'

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
  delete process.env.REDIS_URL
  __resetCacheForTests()
  // Clear singleflight inflight (re-exported reset when implemented).
  try {
    const mod = require('../src/lib/cache') as any
    mod.__resetSingleflightForTests?.()
  } catch {}
})
afterEach(() => {
  if (savedRedisUrl === undefined) delete process.env.REDIS_URL
  else process.env.REDIS_URL = savedRedisUrl
  __resetCacheForTests()
  try {
    const mod = require('../src/lib/cache') as any
    mod.__resetSingleflightForTests?.()
  } catch {}
})

describe('P0-B list TTLs (5m shared)', () => {
  it('exposes 5m TTL constants for contests/hackathons/internships lists', async () => {
    const mod = await import('../src/services/listCache')
    expect(mod.CONTESTS_LIST_TTL_MS).toBe(5 * 60 * 1000)
    expect(mod.HACKATHONS_LIST_TTL_MS).toBe(5 * 60 * 1000)
    expect(mod.INTERNSHIPS_LIST_TTL_MS).toBe(5 * 60 * 1000)
  })

  it('builds tenant-segmented keys (no cross-tenant leak)', async () => {
    const mod = await import('../src/services/listCache')
    const a = mod.contestsListKey({
      scope: 'college:c1',
      userId: 'u1',
      platform: 'CODEFORCES',
      status: 'UPCOMING',
      search: 'hello',
      page: 1,
      limit: 20,
      gen: 0,
    })
    const b = mod.contestsListKey({
      scope: 'college:c2',
      userId: 'u1',
      platform: 'CODEFORCES',
      status: 'UPCOMING',
      search: 'hello',
      page: 1,
      limit: 20,
      gen: 0,
    })
    expect(a).not.toBe(b)
    expect(a).toContain('college:c1')
    expect(a).toContain('contests:list')
    // Same inputs => same key (stable).
    const a2 = mod.contestsListKey({
      scope: 'college:c1',
      userId: 'u1',
      platform: 'CODEFORCES',
      status: 'UPCOMING',
      search: 'hello',
      page: 1,
      limit: 20,
      gen: 0,
    })
    expect(a).toBe(a2)
    // Different page => different key.
    const a3 = mod.contestsListKey({
      scope: 'college:c1',
      userId: 'u1',
      platform: 'CODEFORCES',
      status: 'UPCOMING',
      search: 'hello',
      page: 2,
      limit: 20,
      gen: 0,
    })
    expect(a).not.toBe(a3)
  })

  it('hackathons/internships keys are tenant-segmented + stable', async () => {
    const mod = await import('../src/services/listCache')
    const h1 = mod.hackathonsListKey({
      scope: 'global',
      userId: 'u1',
      search: '',
      status: '',
      mine: '',
      page: 1,
      limit: 20,
      gen: 0,
    })
    const h2 = mod.hackathonsListKey({
      scope: 'college:c9',
      userId: 'u1',
      search: '',
      status: '',
      mine: '',
      page: 1,
      limit: 20,
      gen: 0,
    })
    expect(h1).not.toBe(h2)
    expect(h1).toContain('hackathons:list')
    const i1 = mod.internshipsListKey({
      scope: 'global',
      userId: 'u1',
      search: 'x',
      mine: '',
      page: 1,
      limit: 20,
      gen: 0,
    })
    expect(i1).toContain('internships:list')
    expect(i1).toContain('global')
  })
})

describe('P0-B singleflight + jittered TTL', () => {
  it('coalesces concurrent misses (loader called once)', async () => {
    // In-process singleflight: N concurrent getOrSet same key => 1 loader call.
    let calls = 0
    const loader = async () => {
      calls++
      await new Promise((r) => setTimeout(r, 50))
      return { n: 7 }
    }
    const results = await Promise.all([
      getOrSet('p0b:coalesce:test-key', 300_000, loader),
      getOrSet('p0b:coalesce:test-key', 300_000, loader),
      getOrSet('p0b:coalesce:test-key', 300_000, loader),
    ])
    expect(results).toEqual([{ n: 7 }, { n: 7 }, { n: 7 }])
    expect(calls).toBe(1)
  })

  it('applies jitter to SET TTL (0-10% extra, never short)', async () => {
    const mod = await import('../src/lib/cache')
    expect(typeof (mod as any).withJitter).toBe('function')
    const base = 300_000
    for (let i = 0; i < 20; i++) {
      const j = (mod as any).withJitter(base)
      expect(j).toBeGreaterThanOrEqual(base)
      expect(j).toBeLessThanOrEqual(Math.floor(base * 1.1) + 1)
    }
  })

  it('getOrSet SET uses jittered TTL (capturing backend)', async () => {
    let capturedTtl: number | undefined
    const capturing = {
      get: async () => null,
      set: async (_k: string, _v: unknown, ttl?: number) => {
        capturedTtl = ttl
      },
      del: async () => {},
      incr: async () => 1,
    }
    setCacheBackend(capturing as any)
    await getOrSet('p0b:jitter:key', 300_000, async () => ({ ok: true }))
    expect(capturedTtl).toBeDefined()
    expect(capturedTtl!).toBeGreaterThanOrEqual(300_000)
    expect(capturedTtl!).toBeLessThanOrEqual(330_001)
  })

  it('getOrSet stays fail-open (throwing backend => loader value)', async () => {
    const throwing = {
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
    setCacheBackend(throwing as any)
    const val = await getOrSet('p0b:failopen:key', 300_000, async () => 'fresh')
    expect(val).toBe('fresh')
  })
})

describe('P0-B bust helpers (fail-open version bump)', () => {
  it('version starts 0, bust bumps, keys include gen', async () => {
    const mod = await import('../src/services/listCache')
    const scope = 'college:p0b-bust-test'
    // Reset versions for isolation when implemented.
    try {
      ;(mod as any).__resetListCacheForTests?.()
    } catch {}
    __resetCacheForTests()
    const v0 = await mod.getContestsListVersion(scope)
    expect(v0).toBe(0)
    await mod.bustContestsList(scope)
    const v1 = await mod.getContestsListVersion(scope)
    expect(v1).toBeGreaterThan(v0)
    const k0 = mod.contestsListKey({
      scope,
      userId: 'u1',
      platform: '',
      status: '',
      search: '',
      page: 1,
      limit: 20,
      gen: v0,
    })
    const k1 = mod.contestsListKey({
      scope,
      userId: 'u1',
      platform: '',
      status: '',
      search: '',
      page: 1,
      limit: 20,
      gen: v1,
    })
    expect(k0).not.toBe(k1)
  })

  it('bust helpers never throw (fail-open)', async () => {
    const mod = await import('../src/services/listCache')
    await expect(mod.bustContestsList('college:x')).resolves.toBeUndefined()
    await expect(mod.bustHackathonsList('global')).resolves.toBeUndefined()
    await expect(mod.bustInternshipsList('college:x')).resolves.toBeUndefined()
  })
})

describe('P0-B wiring (source lock-in)', () => {
  it('contests list uses shared getOrSet 5m + bust on mutation', () => {
    const src = readSrc('routes/contests.ts')
    expect(src).toContain('getOrSet')
    expect(src).toContain('CONTESTS_LIST_TTL_MS')
    expect(src).toContain('contestsListKey')
    expect(src).toContain('bustContestsList')
  })

  it('hackathons list uses shared getOrSet 5m + bust on mutation', () => {
    const src = readSrc('routes/hackathons.ts')
    expect(src).toContain('HACKATHONS_LIST_TTL_MS')
    expect(src).toContain('hackathonsListKey')
    expect(src).toContain('bustHackathonsList')
  })

  it('internships list uses shared getOrSet 5m + bust on mutation', () => {
    const src = readSrc('routes/internships.ts')
    expect(src).toContain('INTERNSHIPS_LIST_TTL_MS')
    expect(src).toContain('internshipsListKey')
    expect(src).toContain('bustInternshipsList')
  })

  it('PlatformSettings stays via getOrSet (shared, fail-open)', () => {
    const src = readSrc('services/fetch/settingsCache.ts')
    expect(src).toContain('getOrSet')
    expect(src).toContain('PLATFORM_SETTINGS_CACHE_KEY')
  })

  it('staging counts stay via getOrSet (shared, tenant-segmented)', () => {
    const src = readSrc('services/stagingCounts.ts')
    expect(src).toContain('stagingCountsKey')
    const hackSrc = readSrc('routes/hackathons.ts')
    expect(hackSrc).toContain('stagingCountsKey')
  })

  it('central TTL doc exists (docs/caching.md with fresh/stale + bust table)', () => {
    const docPath = path.resolve(__dirname, '../../../docs/caching.md')
    expect(fs.existsSync(docPath)).toBe(true)
    const doc = fs.readFileSync(docPath, 'utf8')
    expect(doc).toContain('contests:list')
    expect(doc).toContain('hackathons:list')
    expect(doc).toContain('internships:list')
    expect(doc).toContain('bust')
    expect(doc).toContain('5m')
  })
})
