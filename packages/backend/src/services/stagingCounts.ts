/**
 * P0-A realtime: staging counts dirty-flag aggregate push.
 *
 * WHY: AdminOpportunitiesPage polled GET /staging/counts every 60s per tab
 * (1440 GETs/day/tab for data that changes ~2×/day via cron + rare admin
 * approve/reject). Each GET = 2 Redis ops + 1-3 DB reads (cache miss).
 * Fix: server emits `staging:counts:updated` ONLY when counts change
 * (dirty-flag via hash), client patches RQ via setQueryData (0 GET),
 * fallback is a 5m slow poll + ETag 304 when the socket is dead.
 *
 * Rules: additive/backward-compat, fail-open (socket/cache dead = old
 * TTL behavior), no secrets. All helpers are pure except bust (cache.del
 * best-effort) and emit (socket best-effort).
 */
import crypto from 'crypto'
import { cache } from '../lib/cache'

export const STAGING_COUNTS_TTL_MS = 60_000
export const STAGING_COUNTS_EVENT = 'staging:counts:updated'

/** Room-targeted sync-done events (legacy + alias). P0-A socket push. */
export const PROFILE_SYNC_EVENTS = ['profile-sync', 'profile-sync:done'] as const

export type StagingKind = 'hack' | 'int'

export function stagingCountsKey(kind: StagingKind, scope: string): string {
  return `staging-counts:${kind}:${scope}`
}

/** Tenant segment: SUPER_ADMIN/global, else per-college. Never cross-tenant. */
export function scopeForUser(
  user: { role?: string; collegeId?: string | null } | null | undefined,
): string {
  if (!user || user.role === 'SUPER_ADMIN') return 'global'
  return `college:${user.collegeId ?? 'none'}`
}

export type StagingCounts = {
  total: number
  enriched: number
  pending: number
  approved: number
  rejected: number
}

/** Stable hash for dirty-flag comparison (key order fixed). */
export function countsPayloadHash(counts: StagingCounts): string {
  const ordered = {
    total: counts.total,
    enriched: counts.enriched,
    pending: counts.pending,
    approved: counts.approved,
    rejected: counts.rejected,
  }
  return crypto.createHash('md5').update(JSON.stringify(ordered)).digest('hex')
}

// In-memory dirty-flag: last emitted hash + version per scope+kind.
// Per-replica is fine: each mutation is served by exactly one replica, so
// "emit only on change" holds globally without Redis coordination.
const lastHash = new Map<string, string>()
const versions = new Map<string, number>()

function dirtyKey(scope: string, kind: string): string {
  return `${scope}:${kind}`
}

/** Test-only reset (isolates version counters per test). */
export function __resetStagingCountsForTests(): void {
  lastHash.clear()
  versions.clear()
}

/**
 * Dirty-flag gate: first call per scope+kind emits, repeats with identical
 * counts do not, changed counts emit with a bumped version.
 */
export function shouldEmitCounts(
  scope: string,
  kind: string,
  counts: StagingCounts,
): { emit: boolean; version: number } {
  const key = dirtyKey(scope, kind)
  const hash = countsPayloadHash(counts)
  const prev = lastHash.get(key)
  const version = versions.get(key) ?? 0
  if (prev === hash) return { emit: false, version }
  const next = version + 1
  lastHash.set(key, hash)
  versions.set(key, next)
  return { emit: true, version: next }
}

/**
 * Bust cached counts so the next fallback poll recomputes fresh.
 * Fail-open: cache blips never reject (TTL expiry covers the miss).
 */
export async function bustStagingCounts(
  kind: StagingKind | 'both',
  scope?: string,
): Promise<void> {
  try {
    const kinds: StagingKind[] = kind === 'both' ? ['hack', 'int'] : [kind]
    if (scope) {
      for (const k of kinds) {
        try {
          await cache.del(stagingCountsKey(k, scope))
        } catch {}
      }
      return
    }
    // Scope unknown (e.g. called without user): bust global as best-effort.
    // Per-college keys expire via TTL (60s) — correctness preserved, only
    // freshness degrades to the old TTL window for that edge case.
    for (const k of kinds) {
      try {
        await cache.del(stagingCountsKey(k, 'global'))
      } catch {}
    }
  } catch {}
}

/** Convenience: bust the caller's scope from a user row (fail-open). */
export async function bustStagingCountsForUser(
  kind: StagingKind | 'both',
  user: { role?: string; collegeId?: string | null } | null | undefined,
): Promise<void> {
  try {
    await bustStagingCounts(kind, scopeForUser(user))
  } catch {}
}

/** Stable weak ETag for the fallback poll (bytes saved via 304). */
export function buildCountsEtag(counts: StagingCounts): string {
  return `W/"${countsPayloadHash(counts)}"`
}

/** True when the client's If-None-Match covers the fresh ETag. */
export function isCountsNotModified(
  ifNoneMatch: string | string[] | null | undefined,
  etag: string,
): boolean {
  if (!ifNoneMatch) return false
  const values = Array.isArray(ifNoneMatch) ? ifNoneMatch : [ifNoneMatch]
  for (const raw of values) {
    if (!raw) continue
    if (raw === etag) return true
    const parts = String(raw)
      .split(',')
      .map((s) => s.trim())
    if (parts.includes(etag)) return true
  }
  return false
}

/** Completed payload for room-targeted sync:done push (ISO completedAt). */
export function buildProfileSyncPayload(
  userId: string,
  result: { synced?: number; platforms?: string[] } = {},
): {
  userId: string
  status: 'completed'
  synced: number
  platforms: string[]
  completedAt: string
} {
  return {
    userId,
    status: 'completed',
    synced: typeof result.synced === 'number' ? result.synced : 0,
    platforms: Array.isArray(result.platforms) ? result.platforms : [],
    completedAt: new Date().toISOString(),
  }
}
