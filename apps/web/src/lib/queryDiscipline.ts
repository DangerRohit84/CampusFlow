/**
 * P0-A FE stale discipline (additive, fail-open).
 *
 * WHY: frontend mounted 3-4 parallel RQ queries per page with 30-60s stales
 * + one true 60s counts poll + up-to-30-poll waitForCodingSync per manual sync.
 * Discipline: lists >=60s, slow lists/profile/config 5m, gcTime > staleTime,
 * focus refetch OFF for lists, shared qk keys + staleTime dedupe instead of
 * polling. Socket pushes patch via setQueryData (0 GET); slow poll + ETag
 * covers socket-dead.
 *
 * Backward-compat: constants only — pages opt in without behavior change
 * when the socket is dead (fallback poll preserves old freshness).
 */

// Lists: minimum 60s (was 30s on contests/super-admin/admin-staging).
export const STALE_LIST_MS = 60_000
// Slow-moving lists + profile/config: 5m (counts/parts/reminders/activity/settings).
export const STALE_SLOW_LIST_MS = 5 * 60_000
export const STALE_PROFILE_MS = 5 * 60_000
export const STALE_CONFIG_MS = 5 * 60_000
// gcTime must exceed staleTime (RQ invariant).
export const GC_LIST_MS = 5 * 60_000
export const GC_SLOW_LIST_MS = 10 * 60_000
export const GC_PROFILE_MS = 30 * 60_000
// Counts fallback when the socket is dead (was 60s aggressive poll).
export const ADMIN_COUNTS_FALLBACK_POLL_MS = 5 * 60_000
export const REFETCH_ON_WINDOW_FOCUS_LIST = false

export const STAGING_COUNTS_EVENT = 'staging:counts:updated'

export type CountsBucket = {
  total: number
  enriched: number
  pending: number
  approved: number
  rejected: number
}

export type AdminCountsShape = {
  h: CountsBucket
  i: CountsBucket
}

function zeroBucket(): CountsBucket {
  return { total: 0, enriched: 0, pending: 0, approved: 0, rejected: 0 }
}

function normBucket(b: Partial<CountsBucket> | null | undefined): CountsBucket {
  return {
    total: Math.max(0, Math.floor(Number((b as any)?.total) || 0)),
    enriched: Math.max(0, Math.floor(Number((b as any)?.enriched) || 0)),
    pending: Math.max(0, Math.floor(Number((b as any)?.pending) || 0)),
    approved: Math.max(0, Math.floor(Number((b as any)?.approved) || 0)),
    rejected: Math.max(0, Math.floor(Number((b as any)?.rejected) || 0)),
  }
}

/** Dedicated counts push (handled via setQueryData, never invalidated). */
export function isStagingCountsPush(event: string): boolean {
  return event === STAGING_COUNTS_EVENT
}

export type StagingCountsPatch =
  | { counts: AdminCountsShape }
  | { kind: 'hack' | 'int'; action: 'approved' | 'rejected' | 'deleted' | 'created' }
  | { kind: 'hack' | 'int'; action: string }

/**
 * Merge a socket push into cached admin counts WITHOUT fetching.
 * - Full aggregate (`{counts}`) from the server dirty-flag push wins verbatim.
 * - Per-kind approve/reject/deleted patches pending/approved/rejected locally
 *   (clamped >=0 so duplicate pushes are idempotent).
 * - Unknown actions return the input unchanged (caller falls back to refetch).
 */
export function mergeStagingCounts(
  old: AdminCountsShape | null | undefined,
  patch: StagingCountsPatch,
): AdminCountsShape {
  const base: AdminCountsShape = {
    h: normBucket((old as any)?.h),
    i: normBucket((old as any)?.i),
  }
  if ((patch as { counts?: AdminCountsShape }).counts) {
    const fresh = (patch as { counts: AdminCountsShape }).counts
    return {
      h: normBucket((fresh as any)?.h ?? zeroBucket()),
      i: normBucket((fresh as any)?.i ?? zeroBucket()),
    }
  }
  const kind = (patch as { kind?: string }).kind
  const action = (patch as { action?: string }).action
  if (kind !== 'hack' && kind !== 'int') return base
  const key = kind === 'hack' ? 'h' : 'i'
  const bucket = { ...base[key] }
  // Idempotent: duplicate pushes for an already-empty pending queue are
  // no-ops (no phantom approved/rejected increments).
  if (action === 'approved') {
    if (bucket.pending <= 0) return base
    bucket.pending -= 1
    bucket.approved += 1
  } else if (action === 'rejected') {
    if (bucket.pending <= 0) return base
    bucket.pending -= 1
    bucket.rejected += 1
  } else if (action === 'deleted') {
    if (bucket.pending <= 0 && bucket.total <= 0) return base
    bucket.pending = Math.max(0, bucket.pending - 1)
    bucket.total = Math.max(0, bucket.total - 1)
  } else if (action === 'created') {
    bucket.total += 1
    bucket.pending += 1
  } else {
    return base
  }
  return { ...base, [key]: bucket }
}

/** Socket push preferred only when the socket is actually connected. */
export function shouldUseSocketPush(
  socket: { connected?: boolean } | null | undefined,
): boolean {
  try {
    return !!socket && (socket as { connected?: boolean }).connected === true
  } catch {
    return false
  }
}
