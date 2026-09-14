// lib/codingTabs.ts — CodingProfile tab-fetch guards (TAB REPEAT fix).
// WHY: leaderboard refetched on EVERY return to its tab (effect deps included
// activeTab) and ProblemsTab unmounted/remounted per switch (conditional &&),
// so its mount fetch (daily+list) + "Loading problems…" loader re-ran on each
// visit. Both must happen once per page mount (first visit / filter change),
// not per tab switch.

export interface LeaderboardFilterKey {
  platform: string
  departmentId: string
}

/**
 * True when the leaderboard needs a fetch: only while the leaderboard tab is
 * active AND (never fetched OR filters changed since the last fetch).
 * Pure + hermetic (no React) so vitest covers the tab-switch matrix.
 */
export function shouldFetchLeaderboard(
  activeTab: string,
  current: LeaderboardFilterKey,
  lastFetched: LeaderboardFilterKey | null | undefined,
): boolean {
  if (activeTab !== 'leaderboard') return false
  if (!lastFetched) return true
  return (
    lastFetched.platform !== current.platform ||
    lastFetched.departmentId !== current.departmentId
  )
}

/**
 * Track visited outer tabs so lazily-mounted panels (Problems) stay mounted
 * (hidden) after first visit instead of unmounting per switch.
 * Returns a NEW Set (React state-safe; never mutates the input).
 */
export function withTabVisited(prev: ReadonlySet<string>, tab: string): Set<string> {
  if (prev.has(tab)) return new Set(prev)
  const next = new Set(prev)
  next.add(tab)
  return next
}
