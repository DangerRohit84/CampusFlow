/**
 * perf-hotspots — prod dashboard/superadmin burst fix (read-only diagnosis → fix).
 * Favored root causes: repeated identical queries (PlatformSettings.findMany ×40,
 * HackathonStaging/InternshipStaging per-platform counts), uncached slow paths.
 * Fixes: 4 batched GROUP BY source queries for /fetch/stats (+60s shared cache),
 * 60s shared cache for PlatformSettings reads, 60s cache for staging counts +
 * platform-kpis. Hermetic (no DB): fakes + in-memory cache backend.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  buildFetchStats,
  createInMemoryFetchStatsStore,
  PrismaFetchStatsStore,
  STAGING_ENRICHED_WHERE,
  type StagingSourceCounts,
} from '../src/repositories/fetchRepository'
import { __resetCacheForTests, cache } from '../src/lib/cache'
import {
  PLATFORM_SETTINGS_CACHE_KEY,
  PLATFORM_SETTINGS_CACHE_TTL_MS,
  getCachedPlatformSettings,
  invalidatePlatformSettingsCache,
} from '../src/services/fetch/settingsCache'

beforeEach(() => {
  __resetCacheForTests()
})

describe('buildFetchStats (pure mapper — same shape as old per-platform loop)', () => {
  const counts: StagingSourceCounts = {
    hackTotal: [
      { source: 'DEVPOST', count: 10 },
      { source: 'UNSTOP', count: 4 },
    ],
    hackEnriched: [{ source: 'DEVPOST', count: 6 }],
    intTotal: [{ source: 'INTERNSHALA', count: 7 }],
    intEnriched: [
      { source: 'INTERNSHALA', count: 7 },
      { source: 'GHOST', count: 3 },
    ],
  }

  it('maps GROUP BY rows to per-platform stats with pending = fetched - enriched', () => {
    const stats = buildFetchStats(['DEVPOST', 'INTERNSHALA'], counts)
    expect(stats).toEqual([
      {
        platform: 'DEVPOST',
        hackathons: { fetched: 10, enriched: 6, pending: 4 },
        internships: { fetched: 0, enriched: 0, pending: 0 },
      },
      {
        platform: 'INTERNSHALA',
        hackathons: { fetched: 0, enriched: 0, pending: 0 },
        internships: { fetched: 7, enriched: 7, pending: 0 },
      },
    ])
  })

  it('platforms with no rows report zeros; unknown sources ignored', () => {
    const stats = buildFetchStats(['MLH'], counts)
    expect(stats).toEqual([
      { platform: 'MLH', hackathons: { fetched: 0, enriched: 0, pending: 0 }, internships: { fetched: 0, enriched: 0, pending: 0 } },
    ])
    // GHOST rows never surface (not a requested platform).
    expect(JSON.stringify(stats)).not.toContain('GHOST')
  })

  it('clamps negative/NaN pending to 0 (enriched can exceed fetched on skewed writes)', () => {
    const skewed: StagingSourceCounts = {
      hackTotal: [{ source: 'X', count: 2 }],
      hackEnriched: [{ source: 'X', count: 5 }],
      intTotal: [],
      intEnriched: [],
    }
    const [s] = buildFetchStats(['X'], skewed)
    expect(s.hackathons).toEqual({ fetched: 2, enriched: 5, pending: 0 })
  })

  it('tolerates undefined buckets (partial failure → zeros, never throws)', () => {
    const stats = buildFetchStats(['X'], {} as StagingSourceCounts)
    expect(stats[0].hackathons).toEqual({ fetched: 0, enriched: 0, pending: 0 })
    expect(stats[0].internships).toEqual({ fetched: 0, enriched: 0, pending: 0 })
  })
})

describe('STAGING_ENRICHED_WHERE (same predicate as the old per-platform counts)', () => {
  it('matches description non-empty + targetDepartments non-empty', () => {
    expect(STAGING_ENRICHED_WHERE).toEqual({
      description: { not: '' },
      targetDepartments: { not: [] },
    })
  })
})

describe('PrismaFetchStatsStore.countStagingBySource (4 GROUP BY, not 48 counts)', () => {
  it('issues grouped aggregations and maps _count._all → rows', async () => {
    const groupBy = vi.fn()
      .mockResolvedValueOnce([{ source: 'DEVPOST', _count: { _all: 10 } }])
      .mockResolvedValueOnce([{ source: 'DEVPOST', _count: { _all: 6 } }])
      .mockResolvedValueOnce([{ source: 'INTERNSHALA', _count: { _all: 7 } }])
      .mockResolvedValueOnce([])
    const store = new PrismaFetchStatsStore({
      hackathonStaging: { count: vi.fn(), groupBy },
      internshipStaging: { count: vi.fn(), groupBy },
    } as unknown as ConstructorParameters<typeof PrismaFetchStatsStore>[0])
    const counts = await store.countStagingBySource()
    expect(groupBy).toHaveBeenCalledTimes(4)
    expect(counts.hackTotal).toEqual([{ source: 'DEVPOST', count: 10 }])
    expect(counts.hackEnriched).toEqual([{ source: 'DEVPOST', count: 6 }])
    // Old per-platform count() path is NOT used by the batch.
    const db = (store as unknown as { db: { hackathonStaging: { count: ReturnType<typeof vi.fn> } } }).db
    expect(db.hackathonStaging.count).not.toHaveBeenCalled()
  })

  it('enriched groups carry the enriched where clause', async () => {
    const seen: unknown[] = []
    const groupBy = vi.fn(async (args: unknown) => {
      seen.push(args)
      return []
    })
    const store = new PrismaFetchStatsStore({
      hackathonStaging: { count: vi.fn(), groupBy },
      internshipStaging: { count: vi.fn(), groupBy },
    } as unknown as ConstructorParameters<typeof PrismaFetchStatsStore>[0])
    await store.countStagingBySource()
    const withWhere = seen.filter((a) => (a as Record<string, unknown>).where !== undefined)
    expect(withWhere).toHaveLength(2)
    for (const a of withWhere) {
      expect((a as Record<string, unknown>).where).toEqual(STAGING_ENRICHED_WHERE)
    }
  })

  it('fail-soft per group: one rejected groupBy → [] for that group, others intact', async () => {
    const groupBy = vi.fn()
      .mockResolvedValueOnce([{ source: 'A', _count: { _all: 3 } }])
      .mockRejectedValueOnce(new Error('pool blip'))
      .mockResolvedValueOnce([{ source: 'B', _count: { _all: 1 } }])
      .mockResolvedValueOnce([{ source: 'B', _count: { _all: 1 } }])
    const store = new PrismaFetchStatsStore({
      hackathonStaging: { count: vi.fn(), groupBy },
      internshipStaging: { count: vi.fn(), groupBy },
    } as unknown as ConstructorParameters<typeof PrismaFetchStatsStore>[0])
    const counts = await store.countStagingBySource()
    expect(counts.hackTotal).toEqual([{ source: 'A', count: 3 }])
    expect(counts.hackEnriched).toEqual([])
    expect(counts.intTotal).toEqual([{ source: 'B', count: 1 }])
  })

  it('drops non-string sources and non-numeric counts', async () => {
    const groupBy = vi.fn(async () => [
      { source: 'OK', _count: { _all: 2 } },
      { source: null, _count: { _all: 9 } },
      { source: 'BAD', _count: { _all: 'x' } },
    ])
    const store = new PrismaFetchStatsStore({
      hackathonStaging: { count: vi.fn(), groupBy },
      internshipStaging: { count: vi.fn(), groupBy },
    } as unknown as ConstructorParameters<typeof PrismaFetchStatsStore>[0])
    const counts = await store.countStagingBySource()
    expect(counts.hackTotal).toEqual([
      { source: 'OK', count: 2 },
      { source: 'BAD', count: 0 },
    ])
  })
})

describe('in-memory fake store (hermetic route tests)', () => {
  it('countStagingBySource defaults to empty buckets; bySource seed flows through the mapper', async () => {
    const empty = createInMemoryFetchStatsStore()
    expect(await empty.countStagingBySource()).toEqual({ hackTotal: [], hackEnriched: [], intTotal: [], intEnriched: [] })
    const seeded = createInMemoryFetchStatsStore({
      bySource: { hackTotal: [{ source: 'DEVPOST', count: 5 }], hackEnriched: [{ source: 'DEVPOST', count: 5 }] },
    })
    const counts = await seeded.countStagingBySource()
    const [s] = buildFetchStats(['DEVPOST'], counts)
    expect(s.hackathons).toEqual({ fetched: 5, enriched: 5, pending: 0 })
  })

  it('legacy per-platform fakes still work (solid-all compat)', async () => {
    const stats = createInMemoryFetchStatsStore({ hackathons: 3, internships: 2 })
    expect(await stats.countHackathonStaging({})).toBe(3)
    expect(await stats.countInternshipStaging({})).toBe(2)
  })
})

describe('settingsCache (PlatformSettings 60s shared cache)', () => {
  it('exposes the 60s TTL contract', () => {
    expect(PLATFORM_SETTINGS_CACHE_KEY).toBe('fetch:platform-settings')
    expect(PLATFORM_SETTINGS_CACHE_TTL_MS).toBe(60_000)
  })

  it('second read within TTL hits cache (1 DB call for 2 reads)', async () => {
    const findMany = vi.fn(async () => [{ platform: 'DEVPOST', type: 'HACKATHON', enabled: true, fetchLimit: 10 }])
    const db = { platformSettings: { findMany } }
    const first = await getCachedPlatformSettings(db)
    const second = await getCachedPlatformSettings(db)
    expect(first).toEqual(second)
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(await cache.get(PLATFORM_SETTINGS_CACHE_KEY)).toEqual(first)
  })

  it('invalidate forces a fresh DB read', async () => {
    const findMany = vi.fn(async () => [{ platform: 'X', type: 'HACKATHON' }])
    const db = { platformSettings: { findMany } }
    await getCachedPlatformSettings(db)
    await invalidatePlatformSettingsCache()
    await getCachedPlatformSettings(db)
    expect(findMany).toHaveBeenCalledTimes(2)
  })

  it('fail-open to [] when the DB read throws (callers fall back to defaults)', async () => {
    const db = { platformSettings: { findMany: vi.fn(async () => { throw new Error('P1001') }) } }
    await expect(getCachedPlatformSettings(db)).resolves.toEqual([])
  })
})
