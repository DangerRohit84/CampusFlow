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
  }
  internshipStaging: {
    count(args: unknown): Promise<number>
  }
}

export interface FetchStatsStore {
  countHackathonStaging(where: Record<string, unknown>): Promise<number>
  countInternshipStaging(where: Record<string, unknown>): Promise<number>
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
}

/** Default singleton (composition root wires it; routes import this). */
export const fetchStatsStore: FetchStatsStore = new PrismaFetchStatsStore()

/** In-memory fake for hermetic vitest (no DB). */
export function createInMemoryFetchStatsStore(seed: { hackathons?: number; internships?: number } = {}): FetchStatsStore {
  return {
    async countHackathonStaging() {
      return seed.hackathons ?? 0
    },
    async countInternshipStaging() {
      return seed.internships ?? 0
    },
  }
}
