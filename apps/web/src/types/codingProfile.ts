// types/codingProfile.ts — CodingProfile DTO + per-platform sync TTLs.
// WHY: backend now exposes CodingProfile.lastSyncError (TEXT NULL, ≤500ch —
// cleared null on success, set on total failure; lastSyncedAt NOT advanced on
// total failure — see fix-sync-upgrades-backend.md). Frontend had no type
// (used `any`), so the error was invisible. This file gives the shape a home
// (ISP: focused DTO, re-exported via types/api.ts) + documents the TTL table
// from sync-comparison.md §2 (Go-service: LC/GFG change fast, scrape paths
// slow — badges change rarely, ratings only after contests).

export interface CodingProfile {
  id?: string
  userId?: string
  leetcodeHandle?: string | null
  codeforcesHandle?: string | null
  codechefHandle?: string | null
  hackerrankHandle?: string | null
  gfgHandle?: string | null
  githubUsername?: string | null
  platformStats?: string | null
  lastSyncedAt?: string | null
  /** Set (≤500 chars) on total failure, cleared (null) on success. */
  lastSyncError?: string | null
}

// Per-platform SWR TTLs (ms) — sync-comparison §2/§4 upgrade 2.
// LC/GFG 30m, CF 1h, CC 2h, HR 6h. WHY these values: LeetCode/GFG solve counts
// move with daily practice; CF rating only after contests (~1h settle); CC/HR
// are scraped (brittle + slow) so longer TTLs cut redundant scrapes.
export const PLATFORM_SYNC_TTL_MS: Record<string, number> = {
  leetcode: 30 * 60 * 1000,
  gfg: 30 * 60 * 1000,
  codeforces: 60 * 60 * 1000,
  codechef: 2 * 60 * 60 * 1000,
  hackerrank: 6 * 60 * 60 * 1000,
}

/** ms since lastSyncedAt, or null when never synced / unparseable. */
export function getSyncAgeMs(lastSyncedAt?: string | null, nowMs = Date.now()): number | null {
  if (!lastSyncedAt) return null
  const t = new Date(lastSyncedAt).getTime()
  if (!Number.isFinite(t)) return null
  return Math.max(0, nowMs - t)
}

/** True when this platform's data is older than its per-platform TTL. */
export function isPlatformStale(
  platformId: string,
  lastSyncedAt?: string | null,
  nowMs = Date.now(),
): boolean {
  const age = getSyncAgeMs(lastSyncedAt, nowMs)
  if (age === null) return true
  const ttl = PLATFORM_SYNC_TTL_MS[platformId] ?? PLATFORM_SYNC_TTL_MS.leetcode
  return age > ttl
}

/** Human age: "just now" / "5m ago" / "2h ago" / "3d ago". */
export function formatSyncAge(ageMs: number | null): string {
  if (ageMs === null) return 'never'
  const mins = Math.floor(ageMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
