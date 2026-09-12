import prisma from '../config/db'
import { emitNotification, isUserOnline } from './socket'
import { logger } from '../utils/logger'
import { chunk, uniqueIds, NOTIFY_CHUNK_SIZE } from './notify/chunked'
import { type NotificationStore, prismaNotificationStore } from '../lib/repository'

export { NOTIFY_CHUNK_SIZE }

export interface NotifyDeps {
  /** Persistence seam (default: Prisma). Inject a fake in unit tests. */
  store?: NotificationStore;
  /** Socket seams (default: real presence/emit). Inject fakes in unit tests. */
  emit?: typeof emitNotification;
  isOnline?: typeof isUserOnline;
}

// DIP: high-level notify flow depends on the NotificationStore interface, not
// on `import prisma` directly. Callers keep calling notifyUsers(ids, n) — the
// Prisma wiring is the default; tests inject fakes (no DB/socket).
export async function notifyUsers(
  userIds: string[],
  n: { title: string; message: string; type?: string; priority?: string; source?: string },
  deps?: NotifyDeps,
) {
  const store = deps?.store ?? prismaNotificationStore(prisma.notification)
  const emit = deps?.emit ?? emitNotification
  const isOnline = deps?.isOnline ?? isUserOnline
  const unique = uniqueIds(userIds)
  if (unique.length === 0) return []

  // Chunked writes (popular-site parity): unbounded createMany in one query
  // risks statement-timeout + N+1 fan-out on large colleges. 500/chunk keeps
  // each INSERT bounded. createManyAndReturn gives real ids for socket payloads.
  const createdAll: { id: string; userId: string }[] = []
  for (const batch of chunk(unique, NOTIFY_CHUNK_SIZE)) {
    const created = await store.createManyAndReturn({
      data: batch.map((userId) => ({
        userId,
        title: n.title,
        message: n.message,
        type: n.type || 'GENERAL',
        priority: n.priority || 'MEDIUM',
        source: n.source || null,
      })),
      select: { id: true, userId: true },
    }).catch(async () => {
      // Fallback for providers without createManyAndReturn: plain createMany (count only)
      await store.createMany({
        data: batch.map((userId) => ({
          userId,
          title: n.title,
          message: n.message,
          type: n.type || 'GENERAL',
          priority: n.priority || 'MEDIUM',
          source: n.source || null,
        })),
      })
      return batch.map((userId) => ({ id: '', userId }))
    })
    createdAll.push(...created)
  }

  const idByUser = new Map(createdAll.map((c) => [c.userId, c.id]))

  // Only emit to online users — offline users read from DB on next load.
  // Prevents N+1 socket fan-out storms when notifying whole colleges.
  for (const userId of unique) {
    if (!isOnline(userId)) continue
    try {
      emit(userId, {
        id: idByUser.get(userId) || '',
        title: n.title,
        message: n.message,
        type: n.type || 'GENERAL',
        priority: n.priority || 'MEDIUM',
        createdAt: new Date(),
      })
    } catch (err) {
      // Socket emit failure is non-critical — notification is already persisted.
      // Log at debug (no silent catch) so emit outages are observable.
      logger.debug({ err, userId }, '[notify] emit failed (persisted, non-critical)')
    }
  }

  return createdAll
}

export async function notifyUser(
  userId: string,
  n: { title: string; message: string; type?: string; priority?: string; source?: string },
  deps?: NotifyDeps,
) {
  return notifyUsers([userId], n, deps)
}
