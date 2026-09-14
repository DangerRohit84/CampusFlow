/**
 * CampusFlow cache abstraction — Redis-shared with in-memory fallback.
 *
 * Why: single-instance MemoryStore breaks under horizontal scale (Render
 * runs N instances; rate-limit counters + ETag + socket presence must be
 * shared). This module is the seam: all rate-limit / ETag / socket code
 * talks to `cache` (or a `CacheBackend`), so Redis is a boot-time swap
 * (`initCacheFromEnv()`) with zero route edits.
 *
 * Current: `InMemoryCache` by default; `RedisCache` when REDIS_URL is set
 * (per-op fallback to a local InMemoryCache so a Redis blip fails open).
 * Socket fan-out: `@socket.io/redis-adapter` attached in services/socket.ts
 * when REDIS_URL is set (fail-open to memory otherwise — see Track D ADR).
 */

import { getRedisClient, isRedisConfigured, redisDel, redisGet, redisIncr, redisSet } from './redis'
import { redisRateLimitGet, redisRateLimitIncrement } from './redis'

export interface CacheEntry {
  value: unknown
  expiresAt: number | null
}

export interface CacheBackend {
  get<T = unknown>(key: string): Promise<T | null>
  set(key: string, value: unknown, ttlMs?: number): Promise<void>
  del(key: string): Promise<void>
  incr(key: string, ttlMs?: number): Promise<number>
  clear?(): Promise<void>
}

// ---------------------------------------------------------------------------
// In-memory backend (default — single instance, zero deps)
// ---------------------------------------------------------------------------

const DEFAULT_MAX_KEYS = 10_000

export class InMemoryCache implements CacheBackend {
  private store = new Map<string, CacheEntry>()
  private maxKeys: number

  constructor(maxKeys = DEFAULT_MAX_KEYS) {
    this.maxKeys = maxKeys
  }

  private isExpired(entry: CacheEntry): boolean {
    return entry.expiresAt !== null && Date.now() > entry.expiresAt
  }

  private evictIfNeeded(): void {
    if (this.store.size < this.maxKeys) return
    // Evict oldest-expired first, else oldest-inserted (Map preserves insertion order).
    for (const [k, v] of this.store) {
      if (this.isExpired(v)) {
        this.store.delete(k)
        if (this.store.size < this.maxKeys) return
      }
    }
    const first = this.store.keys().next()
    if (!first.done) this.store.delete(first.value)
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const entry = this.store.get(key)
    if (!entry) return null
    if (this.isExpired(entry)) {
      this.store.delete(key)
      return null
    }
    return entry.value as T
  }

  async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
    this.evictIfNeeded()
    this.store.set(key, {
      value,
      expiresAt: typeof ttlMs === 'number' && ttlMs > 0 ? Date.now() + ttlMs : null,
    })
  }

  async del(key: string): Promise<void> {
    this.store.delete(key)
  }

  async incr(key: string, ttlMs?: number): Promise<number> {
    const current = await this.get<number>(key)
    const next = (typeof current === 'number' ? current : 0) + 1
    // Preserve existing TTL when caller doesn't pass one (rate-limit window).
    if (typeof ttlMs === 'number') {
      await this.set(key, next, ttlMs)
    } else {
      const entry = this.store.get(key)
      const remaining = entry?.expiresAt ? Math.max(1, entry.expiresAt - Date.now()) : undefined
      await this.set(key, next, remaining)
    }
    return next
  }

  async clear(): Promise<void> {
    this.store.clear()
  }

  get size(): number {
    return this.store.size
  }
}

// ---------------------------------------------------------------------------
// Singleton + swap hook (Redis when REDIS_URL is set)
// ---------------------------------------------------------------------------

let activeBackend: CacheBackend = new InMemoryCache()

/** Shared cache instance — import this in routes/middleware (never `new`). */
export const cache: CacheBackend = {
  get: (key) => activeBackend.get(key),
  set: (key, value, ttlMs) => activeBackend.set(key, value, ttlMs),
  del: (key) => activeBackend.del(key),
  incr: (key, ttlMs) => activeBackend.incr(key, ttlMs),
  clear: () => activeBackend.clear?.() ?? Promise.resolve(),
}

/** Swap backend at boot (e.g., to RedisCache). Call once before listen. */
export function setCacheBackend(backend: CacheBackend): void {
  activeBackend = backend
}

export function getCacheBackend(): CacheBackend {
  return activeBackend
}

// ---------------------------------------------------------------------------
// Redis backend (multi-instance) with per-op in-memory fallback
// ---------------------------------------------------------------------------

export class RedisCache implements CacheBackend {
  private fallback: InMemoryCache

  constructor(fallback?: InMemoryCache) {
    this.fallback = fallback ?? new InMemoryCache()
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    try {
      if (!getRedisClient()) return this.fallback.get<T>(key)
      const hit = await redisGet<T>(key)
      if (hit !== null && hit !== undefined) return hit
      return this.fallback.get<T>(key)
    } catch {
      return this.fallback.get<T>(key)
    }
  }

  async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
    // Write-through: Redis (shared) + local fallback (fast L1 for this instance).
    try {
      if (getRedisClient()) {
        await redisSet(key, value, ttlMs)
      }
    } catch {}
    await this.fallback.set(key, value, ttlMs)
  }

  async del(key: string): Promise<void> {
    try {
      if (getRedisClient()) await redisDel(key)
    } catch {}
    await this.fallback.del(key)
  }

  async incr(key: string, ttlMs?: number): Promise<number> {
    try {
      if (getRedisClient()) {
        const n = await redisIncr(key, ttlMs)
        if (typeof n === 'number') {
          // Keep fallback loosely in sync (best-effort, never authoritative).
          try {
            await this.fallback.set(key, n, ttlMs)
          } catch {}
          return n
        }
      }
    } catch {}
    return this.fallback.incr(key, ttlMs)
  }

  async clear(): Promise<void> {
    // NEVER flushdb on clear (would wipe shared prod data). Clear local only;
    // per-key TTLs expire shared entries. resetAll() on rate-limit stores
    // calls this — safe by design.
    await this.fallback.clear()
  }

  get size(): number {
    return this.fallback.size
  }
}

/**
 * Boot swap: when REDIS_URL is set, share counters via RedisCache
 * (per-op memory fallback); else keep the InMemory singleton.
 * Idempotent — safe to call twice (tests + index.ts).
 */
export function initCacheFromEnv(): { mode: 'redis' | 'memory' } {
  try {
    if (isRedisConfigured()) {
      setCacheBackend(new RedisCache())
      return { mode: 'redis' }
    }
  } catch {}
  return { mode: 'memory' }
}

/** Test-only: reset singleton to a fresh InMemoryCache. */
export function __resetCacheForTests(): void {
  activeBackend = new InMemoryCache()
}

// ---------------------------------------------------------------------------
// Socket.IO multi-instance fan-out (Track D — landed):
// `@socket.io/redis-adapter` is attached in services/socket.ts when REDIS_URL
// is set (SOCKET_ADAPTER=redis|memory|auto flag in config). Presence
// (`presence:*` keys via lib/redis) + emit fan-out are both shared; sticky
// sessions on Render remain recommended (faster upgrade) but not required
// for correctness. See docs/adr/scale-10k-shard-redis.md §5.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// express-rate-limit stores
// - createCacheRateLimitStore: backend-injected (compat, hermetic tests).
// - createSharedRateLimitStore: Redis-atomic when REDIS_URL is set, else a
//   process-local InMemoryCache fallback. Behavior identical single-instance;
//   multi-instance shares counters (no per-replica budget inflation).
// ---------------------------------------------------------------------------

export interface RateLimitStoreOptions {
  windowMs: number
  prefix?: string
}

export function createCacheRateLimitStore(backend: CacheBackend = activeBackend, windowMs = 15 * 60 * 1000, prefix = 'rl:') {
  let resolvedWindowMs = windowMs
  return {
    localKeys: false, // false = safe to share; true only for pure MemoryStore. We claim shareable so a future Redis swap needs no route change.
    prefix,
    init(options: { windowMs?: number }) {
      if (options?.windowMs) resolvedWindowMs = options.windowMs
    },
    async get(key: string) {
      const raw = await backend.get<{ totalHits: number; resetTime: number }>(prefix + key)
      if (!raw) return undefined
      if (Date.now() > raw.resetTime) {
        await backend.del(prefix + key)
        return undefined
      }
      return { totalHits: raw.totalHits, resetTime: new Date(raw.resetTime) }
    },
    async increment(key: string) {
      const now = Date.now()
      const cacheKey = prefix + key
      const existing = await backend.get<{ totalHits: number; resetTime: number }>(cacheKey)
      if (!existing || now > existing.resetTime) {
        const resetTime = now + resolvedWindowMs
        await backend.set(cacheKey, { totalHits: 1, resetTime }, resolvedWindowMs)
        return { totalHits: 1, resetTime: new Date(resetTime) }
      }
      const next = { totalHits: existing.totalHits + 1, resetTime: existing.resetTime }
      const ttl = Math.max(1, existing.resetTime - now)
      await backend.set(cacheKey, next, ttl)
      return { totalHits: next.totalHits, resetTime: new Date(next.resetTime) }
    },
    async decrement(key: string) {
      const cacheKey = prefix + key
      const existing = await backend.get<{ totalHits: number; resetTime: number }>(cacheKey)
      if (!existing) return
      const next = Math.max(0, existing.totalHits - 1)
      const ttl = Math.max(1, existing.resetTime - Date.now())
      await backend.set(cacheKey, { totalHits: next, resetTime: existing.resetTime }, ttl)
    },
    async resetKey(key: string) {
      await backend.del(prefix + key)
    },
    async resetAll() {
      await backend.clear?.()
    },
  }
}

/**
 * ETag note (evaluated — no store to migrate):
 * etagCacheMiddleware is stateless (md5 of the JSON body per response, no
 * cross-instance map). Authenticated GETs never 304 (private, no-store);
 * only anon public GETs use private SWR + 304. Nothing to share in Redis,
 * so no ETag backend exists by design. `getOrSet` below stays for future
 * shared memoization (already backend-agnostic).
 */
export async function getOrSet<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  // Fail-open: any cache blip (Command timed out via commandTimeout) must
  // still serve the loader value, never reject the request. Every await
  // lands in a handler so timeout rejections never escape as UNHANDLED.
  try {
    const hit = await activeBackend.get<T>(key)
    if (hit !== null && hit !== undefined) return hit
  } catch {}
  const fresh = await loader()
  try {
    await activeBackend.set(key, fresh, ttlMs)
  } catch {}
  return fresh
}

// ---------------------------------------------------------------------------
// Shared rate-limit store: Redis-atomic with memory fallback.
// ---------------------------------------------------------------------------

/**
 * Shared rate-limit store for express-rate-limit v8.
 *
 * - Redis path (REDIS_URL set): `redisRateLimitIncrement` (Lua atomic when
 *   the server supports EVAL, else shared GET+SET). All N replicas share one
 *   counter per (prefix+key) — the 1000/15m budget is global, not per-replica.
 * - Memory path (REDIS_URL unset or Redis error): process-local InMemoryCache
 *   with identical semantics (single-instance behavior unchanged).
 *
 * express-rate-limit calls `increment` on EVERY request and `get` for headers;
 * both consult Redis first so `Retry-After`/`resetTime` agree across replicas.
 * `decrement`/`resetKey` write through to both layers (best-effort Redis).
 */
export function createSharedRateLimitStore(windowMs = 15 * 60 * 1000, prefix = 'rl:') {
  let resolvedWindowMs = windowMs
  const memory = new InMemoryCache()
  const useRedis = (): boolean => {
    try {
      return getRedisClient() !== null
    } catch {
      return false
    }
  }
  return {
    localKeys: false,
    prefix,
    init(options: { windowMs?: number }) {
      if (options?.windowMs) resolvedWindowMs = options.windowMs
    },
    async get(key: string) {
      const cacheKey = prefix + key
      if (useRedis()) {
        try {
          const hit = await redisRateLimitGet(cacheKey)
          if (hit) return { totalHits: hit.totalHits, resetTime: new Date(hit.resetTimeMs) }
        } catch {}
        // Fall through to memory (may hold a fresher fallback count during blips).
      }
      const raw = await memory.get<{ totalHits: number; resetTime: number }>(cacheKey)
      if (!raw) return undefined
      if (Date.now() > raw.resetTime) {
        await memory.del(cacheKey)
        return undefined
      }
      return { totalHits: raw.totalHits, resetTime: new Date(raw.resetTime) }
    },
    async increment(key: string) {
      const cacheKey = prefix + key
      if (useRedis()) {
        try {
          const counted = await redisRateLimitIncrement(cacheKey, resolvedWindowMs)
          if (counted) {
            return { totalHits: counted.totalHits, resetTime: new Date(counted.resetTimeMs) }
          }
        } catch {}
        // Redis blip mid-request → fail open to memory (same semantics).
      }
      const now = Date.now()
      const existing = await memory.get<{ totalHits: number; resetTime: number }>(cacheKey)
      if (!existing || now > existing.resetTime) {
        const resetTime = now + resolvedWindowMs
        await memory.set(cacheKey, { totalHits: 1, resetTime }, resolvedWindowMs)
        return { totalHits: 1, resetTime: new Date(resetTime) }
      }
      const next = { totalHits: existing.totalHits + 1, resetTime: existing.resetTime }
      await memory.set(cacheKey, next, Math.max(1, existing.resetTime - now))
      return { totalHits: next.totalHits, resetTime: new Date(next.resetTime) }
    },
    async decrement(key: string) {
      const cacheKey = prefix + key
      if (useRedis()) {
        try {
          const hit = await redisRateLimitGet(cacheKey)
          if (hit && hit.totalHits > 0) {
            await redisSet(
              cacheKey,
              { totalHits: hit.totalHits - 1, resetTime: hit.resetTimeMs },
              Math.max(1, hit.resetTimeMs - Date.now())
            )
          }
        } catch {}
      }
      const existing = await memory.get<{ totalHits: number; resetTime: number }>(cacheKey)
      if (!existing) return
      const next = Math.max(0, existing.totalHits - 1)
      await memory.set(cacheKey, { totalHits: next, resetTime: existing.resetTime }, Math.max(1, existing.resetTime - Date.now()))
    },
    async resetKey(key: string) {
      const cacheKey = prefix + key
      if (useRedis()) {
        try {
          await redisDel(cacheKey)
        } catch {}
      }
      await memory.del(cacheKey)
    },
    async resetAll() {
      await memory.clear()
    },
  }
}
