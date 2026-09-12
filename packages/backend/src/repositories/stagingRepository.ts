// repositories/stagingRepository.ts — DIP store for staging lists (Track 4 I-3 slice).
// WHY: every route/service did `import prisma from '../config/db'` (high-level
// modules `new` low-level concretes — no seam for tests). This interface lets
// staging routes depend on an abstraction (Prisma impl in prod, in-memory fake
// in vitest) injected via factory. Where touched (hackathons/internships
// staging list/count) uses this store; other routes migrate incrementally.
// No behavior change: Prisma impl delegates to the same model calls.

import prisma from '../config/db'
import type { StagingFindArgs } from '../services/opportunities/staging'

export interface StagingListStore {
  listHackathonStaging(
    args: StagingFindArgs,
  ): Promise<Array<{ id: string; deadline: Date | null; title: string }>>
  countHackathonStaging(where: Record<string, unknown>): Promise<number>
  listInternshipStaging(args: StagingFindArgs): Promise<Array<{ id: string }>>
  countInternshipStaging(where: Record<string, unknown>): Promise<number>
}

/** Minimal DB surface for staging (LSP: depend on narrow interface, not typeof prisma). */
export interface StagingDb {
  hackathonStaging: {
    findMany(args: unknown): Promise<Array<{ id: string; deadline: Date | null; title: string }>>
    count(args: unknown): Promise<number>
  }
  internshipStaging: {
    findMany(args: unknown): Promise<Array<{ id: string }>>
    count(args: unknown): Promise<number>
  }
}

/** Prisma-backed store (prod). Constructor-injected for tests. */
export class PrismaStagingStore implements StagingListStore {
  constructor(private readonly db: StagingDb = prisma as unknown as StagingDb) {}

  listHackathonStaging(args: StagingFindArgs) {
    return this.db.hackathonStaging.findMany(args as never) as Promise<
      Array<{ id: string; deadline: Date | null; title: string }>
    >
  }

  countHackathonStaging(where: Record<string, unknown>) {
    return this.db.hackathonStaging.count({ where } as never)
  }

  listInternshipStaging(args: StagingFindArgs) {
    return this.db.internshipStaging.findMany(args as never) as Promise<Array<{ id: string }>>
  }

  countInternshipStaging(where: Record<string, unknown>) {
    return this.db.internshipStaging.count({ where } as never)
  }
}

/** Default singleton (composition root wires it; routes import this). */
export const stagingStore: StagingListStore = new PrismaStagingStore()

/** In-memory fake for hermetic vitest (no DB). */
export function createInMemoryStagingStore(seed: {
  hackathons?: Array<{ id: string; deadline: Date | null; title: string }>
  internships?: Array<{ id: string }>
} = {}): StagingListStore & { seedData: typeof seed } {
  const hackathons = [...(seed.hackathons ?? [])]
  const internships = [...(seed.internships ?? [])]
  return {
    seedData: { hackathons, internships },
    async listHackathonStaging(args: StagingFindArgs) {
      const skip = args.skip ?? 0
      return hackathons.slice(skip, skip + args.take)
    },
    async countHackathonStaging() {
      return hackathons.length
    },
    async listInternshipStaging(args: StagingFindArgs) {
      const skip = args.skip ?? 0
      return internships.slice(skip, skip + args.take)
    },
    async countInternshipStaging() {
      return internships.length
    },
  }
}
