// apps/web/src/lib/rating.ts — college leaderboard rating (average, pure).
// WHY: leaderboard + My Stats must show AVERAGE (mean of available platform
// ratings, ignore nulls, fail-open) labeled "Rating", not best/max. Covers all
// platforms: Codeforces + CodeChef carry numeric ratings; LeetCode/HackerRank/
// GFG carry null/score-only and are ignored. No fetching here, no storage.
export interface RatedStatLike {
  rating?: number | null;
  valid?: boolean;
}

/** Mean of available numeric ratings; null when none (fail-open). Pure. */
export function averageRatings(values: ReadonlyArray<number | null | undefined>): number | null {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    sum += v;
    n++;
  }
  if (n === 0) return null;
  return sum / n;
}

/**
 * Mean of valid platformStats ratings, rounded; null when none.
 * Invalid entries (valid === false) are ignored — a typo handle never drags
 * the average. Fail-open null lets callers render "—".
 */
export function averagePlatformRatings(stats: ReadonlyArray<RatedStatLike | null | undefined>): number | null {
  const vals: number[] = [];
  for (const s of stats) {
    if (!s || s.valid === false) continue;
    if (typeof s.rating === 'number' && Number.isFinite(s.rating)) vals.push(s.rating);
  }
  const avg = averageRatings(vals);
  return avg == null ? null : Math.round(avg);
}
