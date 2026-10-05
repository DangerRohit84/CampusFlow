// apps/web/src/lib/leaderboardSort.ts — college leaderboard client sort (pure).
// WHY (issue #1): positions/rank numbers follow rating(avg) desc by default.
// Column headers (Rating, Solved, Contests, Name) toggle asc/desc with arrow.
// Frontend sort is client-side over the filtered slice; backend default is
// rating-primary (see backend leaderboardRating.sortLeaderboardGroups).
// Rank numbers follow the CURRENT sort (recomputed after sorting).
export type LeaderboardSortKey = 'rating' | 'solved' | 'contests' | 'name';
export type SortDir = 'asc' | 'desc';

export interface LeaderboardRowLike {
  name?: string | null;
  totalContests?: number | null;
  totalSolved?: number | null;
  rating?: number | null;
  bestRating?: number | null;
  [k: string]: unknown;
}

function ratingOf(r: LeaderboardRowLike): number {
  const v = (r.rating ?? (r as any).bestRating ?? 0) as unknown;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Sort rows by key/dir. Pure — never mutates input. Fail-open (nulls as 0/'' last on desc). */
export function sortLeaderboardRows<T extends LeaderboardRowLike>(
  rows: ReadonlyArray<T>,
  key: LeaderboardSortKey,
  dir: SortDir,
): T[] {
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (key) {
      case 'rating': {
        const ra = ratingOf(a);
        const rb = ratingOf(b);
        if (rb !== ra) return (rb - ra) * (dir === 'asc' ? -1 : 1);
        // secondary: contests desc (stable with backend), then name asc
        const ca = num((a as any).totalContests);
        const cb = num((b as any).totalContests);
        if (cb !== ca) return cb - ca;
        return String((a as any).name ?? '').localeCompare(String((b as any).name ?? ''));
      }
      case 'solved': {
        const sa = num((a as any).totalSolved);
        const sb = num((b as any).totalSolved);
        if (sa !== sb) return (sa - sb) * mul;
        const ra = ratingOf(a);
        const rb = ratingOf(b);
        if (rb !== ra) return rb - ra;
        return String((a as any).name ?? '').localeCompare(String((b as any).name ?? ''));
      }
      case 'contests': {
        const ca = num((a as any).totalContests);
        const cb = num((b as any).totalContests);
        if (ca !== cb) return (ca - cb) * mul;
        const ra = ratingOf(a);
        const rb = ratingOf(b);
        if (rb !== ra) return rb - ra;
        return String((a as any).name ?? '').localeCompare(String((b as any).name ?? ''));
      }
      case 'name': {
        const an = String((a as any).name ?? '');
        const bn = String((b as any).name ?? '');
        const c = an.localeCompare(bn);
        if (c !== 0) return c * mul;
        const ra = ratingOf(a);
        const rb = ratingOf(b);
        return rb - ra;
      }
      default:
        return 0;
    }
  });
}

/**
 * Next sort state for a header click: same key flips dir, new key uses
 * sensible default (rating/solved/contests -> desc, name -> asc).
 * Pure.
 */
export function nextSort(
  curKey: LeaderboardSortKey,
  curDir: SortDir,
  clicked: LeaderboardSortKey,
): { key: LeaderboardSortKey; dir: SortDir } {
  if (clicked === curKey) {
    return { key: curKey, dir: curDir === 'desc' ? 'asc' : 'desc' };
  }
  return { key: clicked, dir: clicked === 'name' ? 'asc' : 'desc' };
}
