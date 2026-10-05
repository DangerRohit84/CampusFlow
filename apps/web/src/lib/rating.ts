// apps/web/src/lib/rating.ts — college leaderboard rating (average, pure).
// WHY: leaderboard + My Stats must show AVERAGE (mean of available platform
// ratings, ignore nulls, fail-open) labeled "Rating", not best/max. Covers all
// platforms: Codeforces + CodeChef carry numeric ratings; LeetCode/HackerRank/
// GFG carry null/score-only and are ignored. No fetching here, no storage.
// Issue #2 RANK-GATE: only platforms where rank exists count (rankTitle/
// globalRank/countryRank/stars/division, not null/0). Rating without rank is
// skipped; solved SUM unchanged; fail-open null lets callers render "—".
export interface RatedStatLike {
  rating?: number | null;
  valid?: boolean;
  rankTitle?: string | null;
  maxRankTitle?: string | null;
  globalRank?: number | null;
  countryRank?: number | null;
  stars?: number | null;
  division?: string | null;
}

/** True when a platform stat carries a rank (not null/0/empty). Pure, fail-open false. */
export function hasRankForAverage(s: RatedStatLike | null | undefined): boolean {
  if (!s || typeof s !== 'object') return false;
  if ((s as any).valid === false) return false;
  const rt = (s as any).rankTitle;
  if (typeof rt === 'string' && rt.trim()) return true;
  const mrt = (s as any).maxRankTitle;
  if (typeof mrt === 'string' && mrt.trim()) return true;
  const div = (s as any).division;
  if (typeof div === 'string' && div.trim()) return true;
  const gr = (s as any).globalRank;
  if (typeof gr === 'number' && Number.isFinite(gr) && gr > 0) return true;
  const cr = (s as any).countryRank;
  if (typeof cr === 'number' && Number.isFinite(cr) && cr > 0) return true;
  const st = (s as any).stars;
  if (typeof st === 'number' && Number.isFinite(st) && st > 0) return true;
  return false;
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
 * Mean of RANKED platformStats ratings, rounded; null when none ranked.
 * Skips rating-without-rank; ignores invalid entries (valid === false) — a
 * typo handle never drags the average. Solved SUM is separate (unchanged).
 * Fail-open null lets callers render "—".
 */
export function averagePlatformRatings(stats: ReadonlyArray<RatedStatLike | null | undefined>): number | null {
  const vals: number[] = [];
  for (const s of stats) {
    if (!s || s.valid === false) continue;
    if (!hasRankForAverage(s)) continue;
    if (typeof s.rating === 'number' && Number.isFinite(s.rating)) vals.push(s.rating);
  }
  const avg = averageRatings(vals);
  return avg == null ? null : Math.round(avg);
}
