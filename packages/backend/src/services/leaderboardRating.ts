// packages/backend/src/services/leaderboardRating.ts — college leaderboard rating (average).
// WHY: leaderboard must show AVERAGE (mean of available ratings, ignore nulls,
// fail-open) labeled "rating", not best/max. Covers all platforms (CF/LC/CC
// contest ratings; HR/GFG rows carry null and are ignored by _avg). Sorting
// uses the average; ties break deterministically. API compat: `bestRating`
// (_max) is kept deprecated alongside new `rating` (_avg rounded) — no break,
// no migration, no schema change.
export function averageRatings(values: ReadonlyArray<number | null | undefined>): number | null {
  let sum = 0
  let n = 0
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    sum += v
    n++
  }
  if (n === 0) return null
  return sum / n
}

/** DB _avg.rating (number|null) -> display rating (rounded int, fail-open 0). */
export function toLeaderboardRating(avg: unknown): number {
  if (typeof avg !== 'number' || !Number.isFinite(avg)) return 0
  return Math.round(avg)
}

export interface LeaderboardGroupLike {
  userId: string
  _count?: { _all?: number | null } | null
  _avg?: { rank?: number | null; rating?: number | null } | null
  _max?: { rating?: number | null } | null
}

/** Sort groups: totalContests desc, then rating(avg) desc, then userId asc. Pure. */
export function sortLeaderboardGroups<T extends LeaderboardGroupLike>(groups: ReadonlyArray<T>): T[] {
  return [...groups].sort((a, b) => {
    const ca = a._count?._all ?? 0
    const cb = b._count?._all ?? 0
    if (cb !== ca) return cb - ca
    const ra = toLeaderboardRating(a._avg?.rating)
    const rb = toLeaderboardRating(b._avg?.rating)
    if (rb !== ra) return rb - ra
    // Deterministic tie-break (was insertion-order dependent).
    // Byte compare (not localeCompare) for cross-env determinism.
    const au = String(a.userId)
    const bu = String(b.userId)
    return au < bu ? -1 : au > bu ? 1 : 0
  })
}

/** Map a DB group + user row to the leaderboard payload (rating + deprecated bestRating). Pure. */
export function mapLeaderboardGroup(
  g: LeaderboardGroupLike,
  u: { name?: unknown; department?: { name?: unknown } | null; departmentId?: unknown; incomingYear?: unknown; avatar?: unknown } | null | undefined,
): {
  userId: string
  name: string
  department: string
  departmentId: string | null
  incomingYear: number | null
  avatar: string | null
  totalContests: number
  avgRank: number
  rating: number
  /** @deprecated kept for API compat — use `rating` (average). */
  bestRating: number
} {
  return {
    userId: g.userId,
    name: typeof u?.name === 'string' ? u.name : '',
    department: typeof (u?.department as any)?.name === 'string' ? ((u?.department as any).name as string) : '',
    departmentId: typeof u?.departmentId === 'string' ? (u.departmentId as string) : null,
    incomingYear: typeof u?.incomingYear === 'number' ? (u.incomingYear as number) : null,
    avatar: typeof u?.avatar === 'string' ? (u.avatar as string) : null,
    totalContests: g._count?._all ?? 0,
    avgRank: g._avg?.rank != null && Number.isFinite(g._avg.rank) ? Math.round(g._avg.rank as number) : 0,
    rating: toLeaderboardRating(g._avg?.rating),
    bestRating: typeof g._max?.rating === 'number' && Number.isFinite(g._max.rating) ? Math.round(g._max.rating as number) : 0,
  }
}
