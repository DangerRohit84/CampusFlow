/**
 * P1-4: Global (Redis-backed) singleflight for external calls.
 *
 * WHY: P0-B gave `getOrSet` cross-replica singleflight for CACHEABLE reads
 * (lists, counts). External calls (platform stats per handle, scrape per URL,
 * enrich per prompt-hash) had only per-process coalescing (`statsCache`,
 * `scrapeCache`, `CoalescingCache`) — N replicas × same handle in the same
 * window = N× external fetches (enroll wave, contest end, cron overlap).
 * This module promotes the same SET-NX-PX + waiter pattern to externals:
 * first claimant runs the loader, losers wait for the winner's short-lived
 * result key instead of refetching. Thundering herd 3 replicas → 1 fetch.
 *
 * CONTRACT (additive / backward-compat / fail-open):
 * - `singleflight(key, loader)` coalesces CONCURRENT callers only (no long
 *   memo — result key TTL defaults 30s, just long enough to absorb a burst).
 *   Use `memoizedSingleflight` (delegates to P0-B `getOrSet`) when the value
 *   is memoizable for minutes/hours (stats 5m, scrape 12h, enrich 24h).
 * - Redis down / lock unavailable → run loader directly (old behavior, never
 *   blocks, never throws). Loader errors never poison the result key.
 * - Loaders must return JSON-serializable values (result travels via `cache`
 *   which JSON-encodes for Redis). Non-serializable returns degrade to
 *   direct-load (fail-open, still correct).
 * - Keys are truncated to 200 chars for the lock namespace (P0-B precedent).
 * - No secrets in keys (handles are lowercased user input, never tokens).
 */

import { cache, getOrSet } from './cache'
import { acquireRedisLock, getRedisClient } from './redis'
import { logger } from '../utils/logger'

/** In-process coalescing for THIS replica (0 extra Redis ops on the fast path). */
const externalInflight = new Map<string, Promise<unknown>>()

/** Test-only: clear in-process external singleflight map. */
export function __resetExternalSingleflightForTests(): void {
  externalInflight.clear()
}

/** Redis lock namespace for external singleflight claims. Pure, never throws. */
export function singleflightLockKey(key: string): string {
  try {
    const k = String(key || 'empty')
    return `lock:sf:${k.length > 200 ? k.slice(0, 200) : k}`
  } catch {
    return 'lock:sf:empty'
  }
}

/** Short-lived shared result key (burst absorption, NOT a long cache). Pure. */
export function singleflightResultKey(key: string): string {
  try {
    const k = String(key || 'empty')
    return `sf:result:${k.length > 200 ? k.slice(0, 200) : k}`
  } catch {
    return 'sf:result:empty'
  }
}

export interface SingleflightOptions {
  /** Claim TTL (deadlock guard when the winner crashes mid-load). Default 30s. */
  lockTtlMs?: number
  /** How long losers wait for the winner's result before fail-open load. Default 5s. */
  waitMs?: number
  /** Poll interval for losers. Default 100ms. */
  pollMs?: number
  /** Shared result TTL (burst window). Default 30s. */
  resultTtlMs?: number
}

function resolveOptions(opts?: SingleflightOptions): Required<SingleflightOptions> {
  try {
    const lockTtlMs = Number(opts?.lockTtlMs)
    const waitMs = Number(opts?.waitMs)
    const pollMs = Number(opts?.pollMs)
    const resultTtlMs = Number(opts?.resultTtlMs)
    return {
      lockTtlMs: Number.isFinite(lockTtlMs) && lockTtlMs > 0 ? Math.floor(lockTtlMs) : 30_000,
      waitMs: Number.isFinite(waitMs) && waitMs > 0 ? Math.floor(waitMs) : 5_000,
      pollMs: Number.isFinite(pollMs) && pollMs > 0 ? Math.floor(pollMs) : 100,
      resultTtlMs: Number.isFinite(resultTtlMs) && resultTtlMs > 0 ? Math.floor(resultTtlMs) : 30_000,
    }
  } catch {
    return { lockTtlMs: 30_000, waitMs: 5_000, pollMs: 100, resultTtlMs: 30_000 }
  }
}

/**
 * Coalesce concurrent external loads across replicas.
 * First claimant runs `loader()`; concurrent losers (same + cross replica)
 * wait for the winner's shared result instead of refetching.
 * Never throws for cache/Redis blips (fail-open direct load); loader errors
 * propagate to the caller (never cached, never poison waiters — waiters that
 * time out run their own loader and see the same error or succeed).
 */
export async function singleflight<T>(key: string, loader: () => Promise<T>, opts?: SingleflightOptions): Promise<T> {
  const { lockTtlMs, waitMs, pollMs, resultTtlMs } = resolveOptions(opts)
  const cacheKey = String(key || 'empty')
  // Same-replica fast path: share the in-flight promise (0 extra Redis ops).
  const pending = externalInflight.get(cacheKey)
  if (pending) return (await pending) as T
  const task = (async (): Promise<T> => {
    let redisAvailable = false
    try {
      redisAvailable = getRedisClient() !== null
    } catch {
      redisAvailable = false
    }
    if (!redisAvailable) {
      // Memory mode: local coalescing only (identical single-instance behavior).
      return loader()
    }
    const resultKey = singleflightResultKey(cacheKey)
    let lock: { acquired: boolean; release: () => Promise<void> } | null = null
    try {
      lock = await acquireRedisLock(singleflightLockKey(cacheKey), lockTtlMs)
    } catch {
      lock = null
    }
    if (lock && lock.acquired) {
      try {
        // Double-checked read: a previous winner's burst-window result may exist.
        try {
          const recheck = await cache.get<T>(resultKey)
          if (recheck !== null && recheck !== undefined) return recheck
        } catch {}
        const fresh = await loader()
        // Best-effort shared result (burst absorption). Non-serializable
        // values fail the SET but the winner still returns them correctly.
        try {
          await cache.set(resultKey, fresh, resultTtlMs)
        } catch {}
        return fresh
      } finally {
        try {
          await lock.release()
        } catch {}
      }
    }
    if (lock && !lock.acquired) {
      // Loser: wait for the winner's shared result, then fail-open own load.
      const deadline = Date.now() + waitMs
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, pollMs))
        try {
          const waited = await cache.get<T>(resultKey)
          if (waited !== null && waited !== undefined) return waited
        } catch {}
      }
      try {
        logger.debug(`[singleflight] waiter timeout for ${cacheKey.slice(0, 80)} — fail-open direct load`)
      } catch {}
    }
    // Redis unavailable (lock null) or waiter timeout: direct load, never blocks.
    return loader()
  })()
  externalInflight.set(cacheKey, task)
  try {
    return await task
  } finally {
    externalInflight.delete(cacheKey)
  }
}

/**
 * Memoized singleflight for externals worth caching (stats 5m, scrape 12h,
 * enrich 24h). Delegates to P0-B `getOrSet` (single lock implementation —
 * DRY: no second lock path). Fail-open to loader on any cache/Redis blip.
 */
export async function memoizedSingleflight<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  return getOrSet(key, ttlMs, loader)
}
