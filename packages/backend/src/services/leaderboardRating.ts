// packages/backend/src/services/leaderboardRating.ts — college leaderboard rating (average).
// WHY: leaderboard must show AVERAGE (mean of available ratings, ignore nulls,
// fail-open) labeled "rating", not best/max. Covers all platforms (CF/LC/CC
// contest ratings; HR/GFG rows carry null and are ignored by _avg). Sorting
// is rating-primary (positions by rating, contests secondary). API compat:
// `bestRating` (_max) is kept deprecated alongside new `rating` (_avg rounded)
// — no break, no migration, no schema change.
// Issue #2: platformStats average is RANK-GATED — only platforms where rank
// exists (rankTitle/globalRank/countryRank/stars/division, not null/0) count.
// Rating without rank is skipped; solved SUM unchanged; fail-open null/—.
export interface RankedStatLike {
  rating?: number | null
  valid?: boolean
  rankTitle?: string | null
  maxRankTitle?: string | null
  globalRank?: number | null
  countryRank?: number | null
  stars?: number | null
  division?: string | null
}

/** True when a platform stat carries a rank (not null/0/empty). Pure, fail-open false. */
export function hasRankForAverage(s: RankedStatLike | null | undefined): boolean {
  if (!s || typeof s !== 'object') return false
  if ((s as any).valid === false) return false
  const rt = (s as any).rankTitle
  if (typeof rt === 'string' && rt.trim()) return true
  const mrt = (s as any).maxRankTitle
  if (typeof mrt === 'string' && mrt.trim()) return true
  const div = (s as any).division
  if (typeof div === 'string' && div.trim()) return true
  const gr = (s as any).globalRank
  if (typeof gr === 'number' && Number.isFinite(gr) && gr > 0) return true
  const cr = (s as any).countryRank
  if (typeof cr === 'number' && Number.isFinite(cr) && cr > 0) return true
  const st = (s as any).stars
  if (typeof st === 'number' && Number.isFinite(st) && st > 0) return true
  return false
}

/**
 * Mean of RANKED platformStats ratings (rounded); null when none ranked.
 * Skips rating-without-rank; ignores invalid entries; fail-open null.
 * Solved SUM is separate (totalSolvedFromPlatformStats) and unchanged.
 */
export function averagePlatformRatings(stats: ReadonlyArray<RankedStatLike | null | undefined>): number | null {
  const vals: number[] = []
  for (const s of stats) {
    if (!s || (s as any).valid === false) continue
    if (!hasRankForAverage(s)) continue
    const r = (s as any).rating
    if (typeof r !== 'number' || !Number.isFinite(r)) continue
    vals.push(r)
  }
  const avg = averageRatings(vals)
  return avg == null ? null : Math.round(avg)
}

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

/**
 * platformStats -> total solved (SUM, not average). Pure, fail-open 0.
 * WHY: leaderboard Solved = TOTAL across platforms (matches publicProfile.ts
 * totalSolved + CodingProfilePage totalSolved: sum valid problemsSolved).
 * Rating is AVERAGE (mean); solved is TOTAL (sum). Double-counts if the same
 * problem is solved on LC+CF — accepted, matches profile total by design.
 * Invalid entries (valid falsy) ignored; non-numeric problemsSolved ignored
 * (avoids `"0" + "5" = "05"` string-concat bug in naive `|| 0` sum).
 * Json|String dual-read (legacy rows may be a JSON string).
 */
export function totalSolvedFromPlatformStats(raw: unknown): number {
  let arr: unknown[]
  if (Array.isArray(raw)) {
    arr = raw
  } else if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t) return 0
    try {
      const p = JSON.parse(t)
      if (!Array.isArray(p)) return 0
      arr = p
    } catch {
      return 0
    }
  } else {
    return 0
  }
  let sum = 0
  for (const s of arr) {
    if (!s || typeof s !== 'object') continue
    const o = s as { valid?: unknown; problemsSolved?: unknown }
    // Mirror existing totalSolved logic: require valid truthy (publicProfile
    // filters `s.valid`; CodingProfilePage filters `s.valid`).
    if (!o.valid) continue
    const n = o.problemsSolved
    if (typeof n !== 'number' || !Number.isFinite(n)) continue
    if (n <= 0) continue
    sum += Math.floor(n)
  }
  return sum
}

export interface LeaderboardGroupLike {
  userId: string
  _count?: { _all?: number | null } | null
  _avg?: { rank?: number | null; rating?: number | null } | null
  _max?: { rating?: number | null } | null
}

/** Sort groups: rating(avg) desc, then totalContests desc, then userId asc. Pure.
 * WHY (issue #1): positions/rank numbers follow rating, not contest count.
 * Contests is secondary tie-break only. Default rating desc.
 */
export function sortLeaderboardGroups<T extends LeaderboardGroupLike>(groups: ReadonlyArray<T>): T[] {
  return [...groups].sort((a, b) => {
    const ra = toLeaderboardRating(a._avg?.rating)
    const rb = toLeaderboardRating(b._avg?.rating)
    if (rb !== ra) return rb - ra
    const ca = a._count?._all ?? 0
    const cb = b._count?._all ?? 0
    if (cb !== ca) return cb - ca
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
  u: { name?: unknown; username?: unknown; department?: { name?: unknown } | null; departmentId?: unknown; incomingYear?: unknown; avatar?: unknown } | null | undefined,
  platformStats?: unknown,
): {
  userId: string
  name: string
  /** Public handle for /u/:username (null when unset — frontend renders plain text). */
  username: string | null
  department: string
  departmentId: string | null
  incomingYear: number | null
  avatar: string | null
  totalContests: number
  avgRank: number
  rating: number
  /** @deprecated kept for API compat — use `rating` (average). */
  bestRating: number
  /** Total solved SUM across platforms (not average). Fail-open 0. */
  totalSolved: number
} {
  const usernameRaw = (u as any)?.username
  const username = typeof usernameRaw === 'string' && usernameRaw.trim() ? usernameRaw.trim() : null
  return {
    userId: g.userId,
    name: typeof u?.name === 'string' ? u.name : '',
    username,
    department: typeof (u?.department as any)?.name === 'string' ? ((u?.department as any).name as string) : '',
    departmentId: typeof u?.departmentId === 'string' ? (u.departmentId as string) : null,
    incomingYear: typeof u?.incomingYear === 'number' ? (u.incomingYear as number) : null,
    avatar: typeof u?.avatar === 'string' ? (u.avatar as string) : null,
    totalContests: g._count?._all ?? 0,
    avgRank: g._avg?.rank != null && Number.isFinite(g._avg.rank) ? Math.round(g._avg.rank as number) : 0,
    rating: toLeaderboardRating(g._avg?.rating),
    bestRating: typeof g._max?.rating === 'number' && Number.isFinite(g._max.rating) ? Math.round(g._max.rating as number) : 0,
    totalSolved: totalSolvedFromPlatformStats(platformStats),
  }
}
