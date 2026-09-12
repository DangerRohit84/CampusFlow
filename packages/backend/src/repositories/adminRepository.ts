// repositories/adminRepository.ts — DIP seam for admin dashboard/bulk (high-risk route).
// WHY: routes/admin.ts did `prisma.user.findUnique` per request + 4N bulk
// round-trips (untestable without DB). This interface covers the requester
// lookup + bulk prefetch surfaces with narrow types (LSP). Bulk writes live in
// services/adminBulk.ts (already DI). No behavior change.

import prisma from '../config/db'
import { logger } from '../utils/logger'

export interface AdminRequester {
  id: string
  role: string
  collegeId: string | null
}

export interface AdminDb {
  user: {
    findUnique(args: unknown): Promise<AdminRequester | null>
    findMany(args: unknown): Promise<Array<{ email: string }>>
    createMany(args: unknown): Promise<{ count: number }>
  }
  department: {
    findMany(args: unknown): Promise<Array<{ id: string; collegeId: string; name: string }>>
  }
}

export interface AdminUserStore {
  findRequesterById(userId: string): Promise<AdminRequester | null>
}

export class PrismaAdminUserStore implements AdminUserStore {
  constructor(private readonly db: Pick<AdminDb, 'user'> = prisma as unknown as Pick<AdminDb, 'user'>) {}

  async findRequesterById(userId: string): Promise<AdminRequester | null> {
    try {
      // NARROW-READ (fan-out #3, auth.ts:139-142 pattern): id/role/collegeId only (was full row).
      return await this.db.user.findUnique({ where: { id: userId }, select: { id: true, role: true, collegeId: true } })
    } catch (err) {
      logger.debug({ err, userId }, '[adminRepository] findRequesterById failed (treated as null)')
      return null
    }
  }
}

/** Default singleton (composition root wires it; routes import this). */
export const adminUserStore: AdminUserStore = new PrismaAdminUserStore()

/** In-memory fake for hermetic vitest (no DB). */
export function createInMemoryAdminUserStore(seed: { users?: AdminRequester[] } = {}): AdminUserStore & {
  users: AdminRequester[]
} {
  const users = [...(seed.users ?? [])]
  return {
    users,
    async findRequesterById(userId: string) {
      return users.find((u) => u.id === userId) ?? null
    },
  }
}
