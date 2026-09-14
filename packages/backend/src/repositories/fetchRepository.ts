// repositories/fetchRepository.ts — DIP seam for fetch save/stats (high-risk route).
// WHY: routes/fetch.ts:saveItems + /stats did direct prisma.staging counts +
// createMany (untestable without DB). Narrow interface for stats counts +
// batched inserts. saveItems batching already landed in-route (2 pre-fetch +
// 2 createMany); this store covers the stats path + injectable save for tests.

import prisma from '../config/db'
import { logger } from '../utils/logger'

export interface FetchStatsDb {
  hackathonStaging: {
    count(args: unknown): Promise<number>
    groupBy(args: unknown): Promise<Array<{ source?: unknown; _count?: unknown }>>
  }
  internshipStaging: {
    count(args: unknown): Promise<number>
    groupBy(args: unknown): Promise<Array<{ source?: unknown; _count?: unknown }>>
  }
}

export interface FetchStatsStore {
  countHackathonStaging(where: Record<string, unknown>): Promise<number>
  countInternshipStaging(where: Record<string, unknown>): Promise<number>
  /**
   * PERF (prod burst fix): batched per-source counts for GET /fetch/stats.
   * Was 12 platforms × 4 count() = 48 concurrent round-trips (identical-
   * timestamp queueing, maxConcurrent 61 > pool 50). Now 4 GROUP BY source
   * queries total, mapped in memory via buildFetchStats(). Same numbers.
   */
  countStagingBySource(): Promise<StagingSourceCounts>
}

/** One bucket of a GROUP BY source aggregation. */
export interface SourceCountRow {
  source: string
  count: number
}

/** Batched /fetch/stats input: 4 GROUP BY results (totals + enriched-only). */
export interface StagingSourceCounts {
  hackTotal: SourceCountRow[]
  hackEnriched: SourceCountRow[]
  intTotal: SourceCountRow[]
  intEnriched: SourceCountRow[]
}

/** Enriched = description non-empty AND targetDepartments non-empty (same where as the old per-platform counts). */
export const STAGING_ENRICHED_WHERE: Record<string, unknown> = {
  description: { not: '' },
  targetDepartments: { not: [] },
}

export interface PerPlatformStats {
  platform: string
  hackathons: { fetched: number; enriched: number; pending: number }
  internships: { fetched: number; enriched: number; pending: number }
}

/**
 * Pure mapper: GROUP BY rows → per-platform stats shape (identical to the
 * old per-platform count loop). Unknown sources are ignored; platforms with
 * no rows report zeros. Never throws (missing buckets → 0).
 */
export function buildFetchStats(platforms: readonly string[], counts: StagingSourceCounts): PerPlatformStats[] {
  const pick = (rows: readonly SourceCountRow[] | undefined, platform: string): number => {
    if (!Array.isArray(rows)) return 0
    const hit = rows.find((r) => r?.source === platform)
    const n = hit ? Number(hit.count) : 0
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  }
  return platforms.map((platform) => {
    const hackathonCount = pick(counts?.hackTotal, platform)
    const hackathonEnriched = pick(counts?.hackEnriched, platform)
    const internshipCount = pick(counts?.intTotal, platform)
    const internshipEnriched = pick(counts?.intEnriched, platform)
    return {
      platform,
      hackathons: { fetched: hackathonCount, enriched: hackathonEnriched, pending: Math.max(0, hackathonCount - hackathonEnriched) },
      internships: { fetched: internshipCount, enriched: internshipEnriched, pending: Math.max(0, internshipCount - internshipEnriched) },
    }
  })
}

export class PrismaFetchStatsStore implements FetchStatsStore {
  constructor(private readonly db: FetchStatsDb = prisma as unknown as FetchStatsDb) {}

  async countHackathonStaging(where: Record<string, unknown>): Promise<number> {
    try {
      return await this.db.hackathonStaging.count({ where } as never)
    } catch (err) {
      logger.debug({ err }, '[fetchRepository] countHackathonStaging failed (treated as 0)')
      return 0
    }
  }

  async countInternshipStaging(where: Record<string, unknown>): Promise<number> {
    try {
      return await this.db.internshipStaging.count({ where } as never)
    } catch (err) {
      logger.debug({ err }, '[fetchRepository] countInternshipStaging failed (treated as 0)')
      return 0
    }
  }

  async countStagingBySource(): Promise<StagingSourceCounts> {
    const toRows = (groups: Array<{ source?: unknown; _count?: unknown }>): SourceCountRow[] => {
      if (!Array.isArray(groups)) return []
      const out: SourceCountRow[] = []
      for (const g of groups) {
        const source = typeof g?.source === 'string' ? g.source : null
        const raw = (g?._count as { _all?: unknown } | undefined)?._all
        const count = typeof raw === 'number' ? raw : 0
        if (source) out.push({ source, count: Number.isFinite(count) && count > 0 ? Math.floor(count) : 0 })
      }
      return out
    }
    // 4 GROUP BY source queries in parallel (was 48 per-platform counts).
    // Each group is fail-soft to [] (same contract as the old per-count
    // catch → 0), so one bad aggregation never 500s the stats endpoint.
    const [hackTotal, hackEnriched, intTotal, intEnriched] = await Promise.all([
      this.db.hackathonStaging
        .groupBy({ by: ['source'], _count: { _all: true } } as never)
        .then(toRows)
        .catch((err) => {
          logger.debug({ err }, '[fetchRepository] hackTotal groupBy failed (treated as [])')
          return [] as SourceCountRow[]
        }),
      this.db.hackathonStaging
        .groupBy({ by: ['source'], where: STAGING_ENRICHED_WHERE, _count: { _all: true } } as never)
        .then(toRows)
        .catch((err) => {
          logger.debug({ err }, '[fetchRepository] hackEnriched groupBy failed (treated as [])')
          return [] as SourceCountRow[]
        }),
      this.db.internshipStaging
        .groupBy({ by: ['source'], _count: { _all: true } } as never)
        .then(toRows)
        .catch((err) => {
          logger.debug({ err }, '[fetchRepository] intTotal groupBy failed (treated as [])')
          return [] as SourceCountRow[]
        }),
      this.db.internshipStaging
        .groupBy({ by: ['source'], where: STAGING_ENRICHED_WHERE, _count: { _all: true } } as never)
        .then(toRows)
        .catch((err) => {
          logger.debug({ err }, '[fetchRepository] intEnriched groupBy failed (treated as [])')
          return [] as SourceCountRow[]
        }),
    ])
    return { hackTotal, hackEnriched, intTotal, intEnriched }
  }
}

/** Default singleton (composition root wires it; routes import this). */
export const fetchStatsStore: FetchStatsStore = new PrismaFetchStatsStore()

/** In-memory fake for hermetic vitest (no DB). */
export function createInMemoryFetchStatsStore(
  seed: { hackathons?: number; internships?: number; bySource?: Partial<StagingSourceCounts> } = {}
): FetchStatsStore {
  return {
    async countHackathonStaging() {
      return seed.hackathons ?? 0
    },
    async countInternshipStaging() {
      return seed.internships ?? 0
    },
    async countStagingBySource(): Promise<StagingSourceCounts> {
      return {
        hackTotal: seed.bySource?.hackTotal ?? [],
        hackEnriched: seed.bySource?.hackEnriched ?? [],
        intTotal: seed.bySource?.intTotal ?? [],
        intEnriched: seed.bySource?.intEnriched ?? [],
      }
    },
  }
}
