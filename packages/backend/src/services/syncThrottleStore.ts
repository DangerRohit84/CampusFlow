// packages/backend/src/services/syncThrottleStore.ts
// Upgrade 3b — DB-backed sync throttle so the 60s button guard survives
// restarts + works across N replicas. Scale10k: Redis-fast-path added.
//
// WHY: POST /coding-profile/sync throttle was a process-local Map (lost on
// restart, duplicated on N instances → double-sync + CF burst).
//
// WHAT (layered, all fail-open — availability over strictness):
//  1. Redis (when REDIS_URL set): atomic SET NX PX 60s per user. First claim
//     wins globally; losers get retryAfterSec from PTTL. No DB write on the
//     hot path (1 Redis op vs upsert). Cleared on handle change.
//  2. DB (SyncThrottle table): authoritative when Redis is unset (dev/CI) and
//     best-effort write-through when Redis is set (survives Redis flush).
//  3. Memory Map: fast-path + fallback when DB/Redis miss (documented limit:
//     process-local only). Never 500s sync — claim best-effort.
//
// LIMITS (documented):
// - Until `prisma migrate deploy` applies the SyncThrottle table, DB calls
//   fall back to memory (watch for `[syncThrottle] table missing` warn).
// - Until REDIS_URL is set, layer 1 is skipped (same as before).
// - All Prisma access via `(prisma as any)` so tsc passes before
//   `prisma generate` picks up the new model.

import prisma from '../config/db'
import { logger } from '../utils/logger'
import { getRedisClient, redisDel, redisGet, redisPttl, redisSetNxPx } from '../lib/redis'

export const SYNC_THROTTLE_STORE_MS = 60 * 1000

// In-memory fallback (same semantics as codingProfile.ts syncThrottle).
const memFallback = new Map<string, number>()
let warnedMissingTable = false

function warnOnce(msg: string, err?: unknown): void {
  if (warnedMissingTable) return
  warnedMissingTable = true
  logger.warn({ err: (err as any)?.message || err }, msg)
}

/** True when the DB/client predates the sync_upgrades migration (table/column absent). */
function isMissingThrottleTableError(err: any): boolean {
  if (!err) return false
  if (err.code === 'P2021' || err.code === 'P2022') return true
  const msg = String((err as any)?.message || err)
  return /syncthrottle.*(unknown argument|does not exist)|relation "?syncthrottle"? does not exist/i.test(msg)
}

/** Test-only: reset fallback + warn flag. */
export function __resetSyncThrottleStoreForTests(): void {
  memFallback.clear()
  warnedMissingTable = false
}

export interface ThrottleCheck {
  allowed: boolean
  retryAfterSec: number
}

function retryAfterSecFrom(lastMs: number, nowMs: number, windowMs: number): number {
  return Math.max(1, Math.ceil((windowMs - (nowMs - lastMs)) / 1000))
}

function throttleKey(userId: string): string {
  return `sync:throttle:${userId}`
}

/**
 * Redis fast-path: atomic claim via SET NX PX.
 * Returns { claimed } when Redis is usable, null when Redis is unavailable
 * (caller falls through to DB/memory). Never throws.
 */
async function tryRedisClaim(userId: string, nowMs: number, windowMs: number): Promise<ThrottleCheck | null> {
  try {
    if (!getRedisClient()) return null
    const key = throttleKey(userId)
    const won = await redisSetNxPx(key, String(nowMs), windowMs)
    if (won === null) return null // Redis blip → fall through
    if (won) {
      memFallback.set(userId, nowMs)
      return { allowed: true, retryAfterSec: 0 }
    }
    // Lost the race: someone else holds the window — countdown from PTTL.
    const pttl = await redisPttl(key)
    if (typeof pttl === 'number' && pttl > 0) {
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(pttl / 1000)) }
    }
    // No TTL (edge: key without expire) → parse stored timestamp.
    try {
      const raw = await redisGet<string | number>(key)
      const last = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10)
      if (Number.isFinite(last)) {
        return { allowed: false, retryAfterSec: retryAfterSecFrom(last, nowMs, windowMs) }
      }
    } catch {}
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(windowMs / 1000)) }
  } catch {
    return null
  }
}

async function readDbLast(userId: string, client: any): Promise<number | null> {
  const row = await client.syncThrottle.findUnique({ where: { userId } })
  const v = (row as any)?.lastRequestedAt as Date | string | undefined
  if (!v) return null
  const ms = v instanceof Date ? v.getTime() : new Date(v).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * Check + claim the per-user sync throttle.
 * Returns allowed=false with retryAfterSec when within window (does NOT claim).
 * Returns allowed=true after persisting lastRequestedAt=now.
 */
export async function checkAndClaimSyncThrottle(
  userId: string,
  opts: {
    nowMs?: number
    windowMs?: number
    prismaClient?: any
  } = {}
): Promise<ThrottleCheck> {
  const nowMs = opts.nowMs ?? Date.now()
  const windowMs = opts.windowMs ?? SYNC_THROTTLE_STORE_MS
  const client: any = opts.prismaClient ?? (prisma as any)

  // Layer 1 — Redis atomic claim (multi-instance, no DB write on hot path).
  const redisRes = await tryRedisClaim(userId, nowMs, windowMs)
  if (redisRes) {
    if (redisRes.allowed) {
      // Best-effort DB write-through (survives Redis flush; never blocks).
      if (client?.syncThrottle?.upsert) {
        try {
          await client.syncThrottle.upsert({
            where: { userId },
            update: { lastRequestedAt: new Date(nowMs) },
            create: { userId, lastRequestedAt: new Date(nowMs) },
          })
        } catch {}
      }
    }
    return redisRes
  }

  // Try DB first (authoritative for multi-instance).
  if (client?.syncThrottle?.findUnique) {
    try {
      const last = await readDbLast(userId, client)
      if (last != null && nowMs - last < windowMs) {
        return { allowed: false, retryAfterSec: retryAfterSecFrom(last, nowMs, windowMs) }
      }
      try {
        await client.syncThrottle.upsert({
          where: { userId },
          update: { lastRequestedAt: new Date(nowMs) },
          create: { userId, lastRequestedAt: new Date(nowMs) },
        })
      } catch (e) {
        // Missing table (pre-migration) → warn-once, not per-call spam; the
        // claim already succeeded via the read path + memory stays in sync.
        // Transient/race → per-call warn, still allow (claim best-effort).
        if (isMissingThrottleTableError(e)) {
          warnOnce('[syncThrottle] table missing, using in-memory fallback (multi-instance unsafe until migration 20260910000000_sync_upgrades applied)', e)
        } else {
          logger.warn({ err: (e as any)?.message || e }, '[syncThrottle] upsert failed (non-fatal, allowing sync)')
        }
      }
      // Keep fallback in sync so local fast-path agrees.
      memFallback.set(userId, nowMs)
      return { allowed: true, retryAfterSec: 0 }
    } catch (e) {
      warnOnce('[syncThrottle] table missing or DB error, using in-memory fallback (multi-instance unsafe until migration 20260910000000_sync_upgrades applied)', e)
    }
  }

  // In-memory fallback (documented limit: process-local only).
  const last = memFallback.get(userId)
  if (last !== undefined && nowMs - last < windowMs) {
    return { allowed: false, retryAfterSec: retryAfterSecFrom(last, nowMs, windowMs) }
  }
  memFallback.set(userId, nowMs)
  return { allowed: true, retryAfterSec: 0 }
}

/** Clear throttle (handle change → immediate re-sync allowed). Best-effort Redis + DB + memory. */
export async function clearSyncThrottleStore(userId: string, prismaClient?: any): Promise<void> {
  memFallback.delete(userId)
  try {
    if (getRedisClient()) await redisDel(throttleKey(userId))
  } catch {}
  const client: any = prismaClient ?? (prisma as any)
  if (client?.syncThrottle?.deleteMany) {
    try {
      await client.syncThrottle.deleteMany({ where: { userId } })
    } catch {
      // Missing table / transient → memory already cleared; ignore.
    }
  }
}
