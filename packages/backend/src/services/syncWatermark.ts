/**
 * P1-2: Watermark-based incremental sync (profile + contest list).
 *
 * WHY: hourly full-shard profile sync re-stats EVERY stale user (up to 60k
 * external fetches/day at 500 users) even when handles never changed and the
 * prior stats were valid. Contest fetch re-loops every fetched row 4×/day
 * even when the upstream lists are byte-identical. Watermarks record WHAT was
 * last synced (handles fingerprint + stats validity + list hash) so repeat
 * runs skip unchanged work and only pay for new/changed rows.
 *
 * CONTRACT (additive / backward-compat / fail-open):
 * - Watermark MISS, corrupt entry, or any cache/Redis error → FULL sync (old
 *   behavior, never skips). Skipping is allow-listed: only when fingerprint
 *   matches AND prior stats were valid AND last sync is within the valid
 *   recheck window (6h). Handle change, invalid stats, or expiry → full.
 * - Contest list gate: skips only the per-row upsert loop when the upstream
 *   list hash matches the last run within 6h; the time-driven status sweep
 *   still runs (status transitions are time-based, not hash-based).
 * - Storage is the shared `cache` (Redis when configured, memory otherwise)
 *   with bounded TTLs (7d user watermarks, 6h contest lists). No migration,
 *   no schema change, no PII beyond lowercase handles already in DB.
 * - Never throws (all entry points try/catch to miss/full).
 */

import crypto from 'crypto'
import { cache } from '../lib/cache'
import { logger } from '../utils/logger'

/** Valid stats recheck window: steady users re-stat 4×/day, not 24× (−83%). */
export const VALID_STATS_RECHECK_MS = 6 * 60 * 60 * 1000
/** Fresh sync window (existing 1h staleness contract, unchanged). */
export const STALE_SYNC_RECHECK_MS = 60 * 60 * 1000
/** User watermark TTL (correctness backstop; missed clears → full sync). */
export const SYNC_WATERMARK_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Contest list watermark TTL (aligns to 6h contest cron). */
export const CONTEST_LIST_WATERMARK_TTL_MS = 6 * 60 * 60 * 1000

export interface SyncWatermark {
  /** Fingerprint of handles at last successful sync (see handlesFingerprint). */
  handlesHash: string
  /** True when the last sync produced valid stats for ≥1 platform. */
  valid: boolean
  /** Hash of last stats payload (change detection, best-effort). */
  statsHash: string | null
  /** Epoch ms of the sync that wrote this watermark. */
  at: number
}

export interface ContestListWatermark {
  /** Hash of last normalized upstream contest list (see contestListHash). */
  listHash: string
  /** Epoch ms of the run that wrote this watermark. */
  at: number
  /** Counts from that run (observability, not correctness). */
  fetched?: number
  updated?: number
}

function shaHex(input: string): string {
  try {
    return crypto.createHash('sha256').update(String(input)).digest('hex')
  } catch {
    return 'error'
  }
}

function normHandle(v: unknown): string {
  return String(v ?? '').trim().toLowerCase()
}

/**
 * Fingerprint of a profile's external handles. Pure, never throws.
 * Covers all 6 sync inputs (5 stat handles + github) so ANY handle change
 * (set, cleared, edited) invalidates the watermark → full resync.
 */
export function handlesFingerprint(profile: {
  leetcodeHandle?: string | null
  codeforcesHandle?: string | null
  codechefHandle?: string | null
  hackerrankHandle?: string | null
  gfgHandle?: string | null
  githubUsername?: string | null
} | null | undefined): string {
  try {
    if (!profile) return shaHex('no-profile')
    const parts = [
      normHandle(profile.leetcodeHandle),
      normHandle(profile.codeforcesHandle),
      normHandle(profile.codechefHandle),
      normHandle(profile.hackerrankHandle),
      normHandle(profile.gfgHandle),
      normHandle(profile.githubUsername),
    ]
    return shaHex(parts.join('|'))
  } catch {
    return 'error'
  }
}

/** Hash of a stats payload (best-effort change signal). Pure, never throws. */
export function statsPayloadHash(stats: unknown): string | null {
  try {
    if (stats == null) return null
    return shaHex(JSON.stringify(stats))
  } catch {
    return null
  }
}

/** True when ≥1 platform stat is valid (steady-user signal). Pure. */
export function hasValidStats(stats: Array<{ valid?: boolean }> | null | undefined): boolean {
  try {
    if (!Array.isArray(stats)) return false
    return stats.some((s) => !!(s && (s as { valid?: boolean }).valid))
  } catch {
    return false
  }
}

/** Tenant-scoped watermark key (per-user, never cross-tenant). Pure. */
export function syncWatermarkKey(userId: string): string {
  const id = String(userId || 'unknown').slice(0, 120)
  return `sync:wm:${id}`
}

/** Contest list watermark key (public upstream data, no tenant segment). Pure. */
export function contestListWatermarkKey(): string {
  return 'sync:contest-list:wm'
}

/** Read a user's sync watermark. Miss/corrupt/error → null (fallback full). */
export async function getSyncWatermark(userId: string): Promise<SyncWatermark | null> {
  try {
    if (!userId) return null
    const hit = await cache.get<SyncWatermark>(syncWatermarkKey(userId))
    if (!hit || typeof hit !== 'object') return null
    if (typeof (hit as SyncWatermark).handlesHash !== 'string') return null
    if (typeof (hit as SyncWatermark).at !== 'number') return null
    return hit as SyncWatermark
  } catch {
    return null
  }
}

/** Write a user's sync watermark (best-effort, never throws). */
export async function setSyncWatermark(userId: string, wm: SyncWatermark): Promise<void> {
  try {
    if (!userId || !wm) return
    await cache.set(syncWatermarkKey(userId), wm, SYNC_WATERMARK_TTL_MS)
  } catch {}
}

/**
 * Decide whether a profile sync can skip externals (watermark HIT).
 * Pure decision (takes the already-fetched watermark — no I/O here).
 *
 * Skip ONLY when ALL hold (allow-list, fail-closed to full):
 *  1. watermark exists and is well-formed,
 *  2. handles fingerprint matches (no handle added/changed/cleared),
 *  3. prior sync was valid (≥1 platform valid — invalid needs retry, not skip),
 *  4. last sync within VALID_STATS_RECHECK_MS (6h steady freshness).
 * Everything else (miss, dirty handles, invalid, expired) → false (full sync).
 */
export function shouldSkipProfileSync(
  profile: Parameters<typeof handlesFingerprint>[0],
  wm: SyncWatermark | null | undefined,
  nowMs = Date.now(),
): boolean {
  try {
    if (!wm || typeof wm !== 'object') return false
    if (wm.valid !== true) return false
    if (!Number.isFinite(wm.at) || wm.at <= 0) return false
    const age = nowMs - wm.at
    if (!Number.isFinite(age) || age < 0 || age >= VALID_STATS_RECHECK_MS) return false
    return handlesFingerprint(profile) === wm.handlesHash
  } catch {
    return false
  }
}

/**
 * Hash of a normalized upstream contest list. Pure, never throws.
 * Sorted `platform|url|startTime` lines so fetch order never flips the hash
 * (field parity: same rows in any order → same hash → correct skip).
 */
export function contestListHash(
  contests: Array<{ platform?: unknown; url?: unknown; startTime?: unknown; title?: unknown }>,
): string {
  try {
    if (!Array.isArray(contests) || contests.length === 0) return shaHex('empty-list')
    const lines = contests.map((c) =>
      [String(c?.platform ?? ''), String(c?.url ?? ''), String(c?.startTime ?? '')].join('|'),
    )
    lines.sort()
    return shaHex(lines.join('\n'))
  } catch {
    return 'error'
  }
}

/** Read the contest list watermark. Miss/corrupt/error → null (fallback full). */
export async function getContestListWatermark(): Promise<ContestListWatermark | null> {
  try {
    const hit = await cache.get<ContestListWatermark>(contestListWatermarkKey())
    if (!hit || typeof hit !== 'object') return null
    if (typeof (hit as ContestListWatermark).listHash !== 'string') return null
    if (typeof (hit as ContestListWatermark).at !== 'number') return null
    return hit as ContestListWatermark
  } catch {
    return null
  }
}

/** Write the contest list watermark (best-effort, never throws). */
export async function setContestListWatermark(wm: ContestListWatermark): Promise<void> {
  try {
    if (!wm) return
    await cache.set(contestListWatermarkKey(), wm, CONTEST_LIST_WATERMARK_TTL_MS)
  } catch {}
}

/**
 * Decide whether the contest per-row upsert loop can be skipped.
 * Pure. Skip ONLY on hash match within 6h (upstream identical → the loop
 * would find every row unchanged). The time-driven status sweep still runs
 * (caller responsibility) — statuses flip with the clock, not the hash.
 */
export function shouldSkipContestLoop(newHash: string, wm: ContestListWatermark | null | undefined, nowMs = Date.now()): boolean {
  try {
    if (!newHash || newHash === 'error') return false
    if (!wm || typeof wm !== 'object') return false
    if (wm.listHash !== newHash) return false
    if (!Number.isFinite(wm.at) || wm.at <= 0) return false
    const age = nowMs - wm.at
    if (!Number.isFinite(age) || age < 0 || age >= CONTEST_LIST_WATERMARK_TTL_MS) return false
    return true
  } catch {
    return false
  }
}

/**
 * Group contest rows by their time-correct status (pure, for batched sweep).
 * Caller issues one `updateMany({where:{id:{in:ids}},data:{status}})` per
 * non-empty group (3 queries max instead of N per-row updates).
 * Rows with unparsable startTime are returned in `unparseable` (skipped by
 * the caller — same as the old per-row `continue`).
 */
export function groupContestStatuses(
  rows: Array<{ id: string; startTime: unknown; duration?: unknown; status?: unknown }>,
  nowMs = Date.now(),
): { UPCOMING: string[]; ONGOING: string[]; ENDED: string[]; unparseable: string[] } {
  const out = { UPCOMING: [] as string[], ONGOING: [] as string[], ENDED: [] as string[], unparseable: [] as string[] }
  try {
    const now = new Date(nowMs)
    for (const r of rows || []) {
      try {
        if (!r || !r.id) continue
        const s = new Date(String((r as { startTime?: unknown }).startTime ?? ''))
        if (Number.isNaN(s.getTime())) {
          out.unparseable.push(r.id)
          continue
        }
        const rawDur = Number((r as { duration?: unknown }).duration ?? 180)
        const dur = Number.isFinite(rawDur) && rawDur > 0 ? rawDur : 180
        const end = new Date(s.getTime() + dur * 60000)
        const correct = s > now ? 'UPCOMING' : end > now ? 'ONGOING' : 'ENDED'
        if (r.status !== correct) out[correct].push(r.id)
      } catch {
        try {
          if (r && r.id) out.unparseable.push(r.id)
        } catch {}
      }
    }
  } catch {}
  return out
}

/** Test-only: no module state (all state lives in shared `cache`). */
export function __resetSyncWatermarkForTests(): void {
  try {
    logger.debug('[syncWatermark] reset requested (stateless — clear shared cache instead)')
  } catch {}
}
