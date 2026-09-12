// packages/backend/src/services/syncLock.ts
// Upgrade 3a — distributed cron lock so overlapping profile-sync runs skip.
// Scale10k: Redis primary, pg advisory secondary.
//
// WHY: hourly embedded cron (jobs/cron.ts setInterval) + Render Cron
// (POST /internal/cron/profile-sync) + teacher POST /coding-profile/sync-all
// can overlap on multi-instance prod (known M-1: 8 process-local singletons).
// N replicas double-sync the same users → double CF bursts + DB write churn.
//
// WHAT (layered, all fail-open — a lock blip never blocks sync):
//  1. Redis SET NX PX (primary when REDIS_URL set): atomic across replicas,
//     TTL 5m deadlock-guard (crash auto-releases). Owner-only Lua release.
//  2. pg advisory lock (secondary: when Redis unset/down, plus same-instance
//     dedupe when the pooler routes to the same backend connection).
//  3. In-memory guard in syncEngine (same-process overlap, no I/O).
//
// LIMITS (documented):
// - Best-effort: every layer fails OPEN (proceed) so lock infra never blocks.
//   pgbouncer transaction mode does NOT hold session-level advisory locks
//   across checkouts — the pg layer still dedupes same-instance overlap via
//   the in-memory guard + reduces cross-instance overlap when the pooler
//   routes to the same backend connection. Redis is the full multi-instance
//   fix (explicitly the deferred Redis/BullMQ scheduler, now landed as locks).
// - Lock key is a fixed bigint constant (pg) + stable Redis key (below).

import prisma from '../config/db'
import { logger } from '../utils/logger'
import { acquireRedisLock, getRedisClient } from '../lib/redis'

/** Fixed advisory-lock key for profile sync (arbitrary, must stay stable). */
export const PROFILE_SYNC_LOCK_KEY = 7279001

/** Stable Redis key for the same lock (pg key is a bigint; Redis is a string). */
export const PROFILE_SYNC_LOCK_REDIS_KEY = 'lock:profile-sync'

/** Redis TTL: max expected syncAllUsers hold (deadlock guard on crash). */
export const PROFILE_SYNC_LOCK_TTL_MS = 5 * 60 * 1000

export interface SyncLockHandle {
  acquired: boolean
  release: () => Promise<void>
}

/**
 * Try to acquire the profile-sync lock (Redis primary, pg secondary).
 * `client` injectable for hermetic tests (must expose $queryRaw).
 */
export async function tryAcquireProfileSyncLock(client?: {
  $queryRaw: (...args: any[]) => Promise<any>
}): Promise<SyncLockHandle> {
  // Layer 1 — Redis distributed lock (multi-instance atomic).
  try {
    if (getRedisClient()) {
      const handle = await acquireRedisLock(PROFILE_SYNC_LOCK_REDIS_KEY, PROFILE_SYNC_LOCK_TTL_MS)
      if (handle) {
        if (!handle.acquired) return { acquired: false, release: async () => {} }
        // Held globally — pg secondary not needed (same run already exclusive).
        return { acquired: true, release: handle.release }
      }
      // Redis blip (null) → fall through to pg secondary (fail open chain).
    }
  } catch {
    // Redis layer must never block sync — fall through to pg.
  }
  const c: any = client ?? (prisma as any)
  const noop: SyncLockHandle = { acquired: true, release: async () => {} }
  if (!c || typeof c.$queryRaw !== 'function') {
    // No DB client (tests) — fail open with a no-op handle.
    return noop
  }
  try {
    const rows = (await c.$queryRaw`SELECT pg_try_advisory_lock(${PROFILE_SYNC_LOCK_KEY}) AS "acquired"`) as Array<{
      acquired: boolean
    }>
    const acquired = rows?.[0]?.acquired === true
    if (!acquired) {
      return { acquired: false, release: async () => {} }
    }
    return {
      acquired: true,
      release: async () => {
        try {
          await c.$queryRaw`SELECT pg_advisory_unlock(${PROFILE_SYNC_LOCK_KEY}) AS "released"`
        } catch (e) {
          logger.warn({ err: (e as any)?.message || e }, '[syncLock] advisory unlock failed (non-fatal)')
        }
      },
    }
  } catch (e) {
    // Fail open (documented): lock infra must never block sync.
    logger.warn({ err: (e as any)?.message || e }, '[syncLock] advisory lock query failed, proceeding without lock (single-instance fallback)')
    return noop
  }
}
