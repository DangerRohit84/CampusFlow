// repositories/roomRepository.ts — DIP seam for room access (high-risk route).
// WHY: routes/rooms.ts:authorizeRoomChatAccess did `prisma.user.findUnique`
// directly (untestable without DB, 29/30 routes same). This interface lets the
// route depend on an abstraction (Prisma in prod, in-memory fake in vitest).
// Minimal surface (LSP: narrow, not typeof prisma). No behavior change.

import prisma from '../config/db'
import { logger } from '../utils/logger'

export interface RoomUser {
  id: string
  role: string
  collegeId: string | null
}

export interface RoomAccessDb {
  user: {
    findUnique(args: unknown): Promise<RoomUser | null>
  }
  roomMember?: {
    findFirst(args: unknown): Promise<{ id: string } | null>
  }
}

export interface RoomAccessStore {
  findUserById(userId: string): Promise<RoomUser | null>
}

export class PrismaRoomAccessStore implements RoomAccessStore {
  constructor(private readonly db: RoomAccessDb = prisma as unknown as RoomAccessDb) {}

  async findUserById(userId: string): Promise<RoomUser | null> {
    try {
      return await this.db.user.findUnique({ where: { id: userId } })
    } catch (err) {
      logger.debug({ err, userId }, '[roomRepository] findUserById failed (treated as null)')
      return null
    }
  }
}

/** Default singleton (composition root wires it; routes import this). */
export const roomAccessStore: RoomAccessStore = new PrismaRoomAccessStore()

/** In-memory fake for hermetic vitest (no DB). */
export function createInMemoryRoomAccessStore(seed: { users?: RoomUser[] } = {}): RoomAccessStore & {
  users: RoomUser[]
} {
  const users = [...(seed.users ?? [])]
  return {
    users,
    async findUserById(userId: string) {
      return users.find((u) => u.id === userId) ?? null
    },
  }
}
