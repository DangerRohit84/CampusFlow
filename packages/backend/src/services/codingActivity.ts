// packages/backend/src/services/codingActivity.ts
// Unified-heatmap daily activity: per-day SOLVES where honestly obtainable.
//
// SOURCES (assessed 2026-09-11, no hallucination):
// - LeetCode: YES via GraphQL `matchedUser { submissionCalendar }` — a JSON
//   string mapping unix-seconds -> submission count for the trailing ~1y.
//   Same endpoint/timeout (12s) as stats; one extra GraphQL field, no new host.
// - Codeforces: YES via `user.status?from=1&count=10000` (creationTimeSeconds
//   + verdict). Accepted (verdict OK) submissions bucketed per UTC day. Cost:
//   one gated CF call (2s gate + 10s timeout, same budget as stats). Stats
//   already fetches user.status; this reuses the same shape but stays a
//   separate best-effort call so stats never depends on activity parsing.
// - CodeChef: NO daily API (profile scrape yields totals + contest rating
//   history only, no per-day solves). Omitted honestly — totals stay in cards.
// - HackerRank / GFG: NO daily API (scrapes yield scores/totals only).
//   Omitted honestly — totals stay in cards, never faked into the heatmap.
// - GitHub: YES via the public contributions page (no token) — see
//   githubActivity.ts (8s timeout, 10min success cache, 15s route throttle).
//   Unauthenticated IP throttling is possible, so every GitHub read here is
//   best-effort + cached and NEVER fails a sync (returns [] on any failure).
// - Contests: YES already — ContestParticipation.participatedAt dates. NOT
//   duplicated here; the frontend merges participations (contests) with this
//   table (coding + git).
//
// STORAGE: additive `CodingActivity{userId,date,source,count}` rows
// (@@unique[userId,date,source]). `date` is UTC-midnight DateTime. Batched
// writes (1 deleteMany window + chunked createMany) so a 182-day x 3-source
// snapshot costs ~2-3 round-trips. Pre-migration safe: missing table returns
// { saved: 0, skipped: 'pre-migration' } instead of throwing (same pattern as
// syncEngine saveSyncResult). No secrets: public endpoints only, no tokens.

import { fetchCodeforcesJson } from './codeforcesGate'
import { LEETCODE_STATS_TIMEOUT_MS, CF_STATS_TIMEOUT_MS } from './platformStats'
import { getGithubCalendar } from './githubActivity'
import { logger } from '../utils/logger'

export type CodingActivitySource = 'leetcode' | 'codeforces' | 'github'

export interface DailyCount {
  date: string // YYYY-MM-DD (UTC)
  count: number
}

/** Trailing window persisted per sync (matches frontend 182-day grid). */
export const ACTIVITY_WINDOW_DAYS = 182
const CREATE_CHUNK = 500
const SYNC_TIMEOUT_NOTE = '[codingActivity]'

const HANDLE_RE = /^[a-zA-Z0-9._-]+$/
export function sanitizeActivityHandle(handle: unknown): string | null {
  const s = String(handle ?? '').trim()
  if (!s || s.length > 50) return null
  if (!HANDLE_RE.test(s)) return null
  return s
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

/** UTC-midnight Date for a YYYY-MM-DD key (null when malformed). */
export function dayKeyToUtcDate(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return Number.isFinite(d.getTime()) ? d : null
}

/** Epoch seconds (or ms) -> YYYY-MM-DD UTC key. Null on invalid. */
export function epochToDayKey(ts: unknown): string | null {
  const n = typeof ts === 'string' && ts.trim() !== '' ? Number(ts) : (ts as number)
  if (!Number.isFinite(n) || n <= 0) return null
  // LeetCode calendar keys are seconds; tolerate ms defensively.
  const ms = n > 1e12 ? Math.floor(n) : Math.floor(n * 1000)
  const d = new Date(ms)
  if (!Number.isFinite(d.getTime())) return null
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

/**
 * Parse a LeetCode `submissionCalendar` payload into per-day counts.
 * Accepts the raw JSON string OR an already-parsed object mapping
 * epoch-seconds -> count. Invalid entries are skipped (never throw).
 * Future-dated keys beyond `todayKey` are dropped (sync-noise guard).
 */
export function parseLeetcodeSubmissionCalendar(
  raw: unknown,
  opts?: { todayKey?: string }
): Record<string, number> {
  const out: Record<string, number> = {}
  if (raw == null) return out
  let obj: Record<string, unknown> | null = null
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t) return out
    try {
      const parsed: unknown = JSON.parse(t)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        obj = parsed as Record<string, unknown>
      } else {
        return out
      }
    } catch {
      return out
    }
  } else if (typeof raw === 'object' && !Array.isArray(raw)) {
    obj = raw as Record<string, unknown>
  } else {
    return out
  }
  const maxKey = opts?.todayKey ?? '9999-12-31'
  for (const [k, v] of Object.entries(obj)) {
    const day = epochToDayKey(k)
    if (!day) continue
    if (day > maxKey) continue
    const n = typeof v === 'string' ? Number(v) : (v as number)
    if (!Number.isFinite(n) || n <= 0) continue
    const c = Math.floor(n)
    if (c <= 0) continue
    out[day] = (out[day] ?? 0) + c
  }
  return out
}

export interface LeetcodeDailyDeps {
  fetchFn?: typeof fetch
}

const LC_DAILY_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * Fetch LeetCode per-day submissions via GraphQL submissionCalendar.
 * Best-effort: returns {} on any failure (never throws for network/parse).
 */
export async function fetchLeetcodeDailyActivity(
  handle: string,
  deps: LeetcodeDailyDeps = {}
): Promise<Record<string, number>> {
  const sanitized = sanitizeActivityHandle(handle)
  if (!sanitized) return {}
  const fetchFn = deps.fetchFn ?? globalThis.fetch
  try {
    const body = JSON.stringify({
      query: `query userSubmissionCalendar($username: String!) {
        matchedUser(username: $username) {
          username
          submissionCalendar
        }
      }`,
      variables: { username: sanitized },
    })
    const resp = await fetchFn('https://leetcode.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': LC_DAILY_UA, Referer: 'https://leetcode.com' },
      body,
      signal: AbortSignal.timeout(LEETCODE_STATS_TIMEOUT_MS),
    } as RequestInit)
    const data: any = await (resp as Response).json()
    const cal = data?.data?.matchedUser?.submissionCalendar
    const now = new Date()
    const todayKey = `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`
    return parseLeetcodeSubmissionCalendar(cal, { todayKey })
  } catch (err) {
    logger.warn({ err: (err as any)?.message || err }, `${SYNC_TIMEOUT_NOTE} LeetCode daily fetch failed for ${sanitized} (best-effort)`)
    return {}
  }
}

export interface CfSubmissionLike {
  creationTimeSeconds?: unknown
  verdict?: unknown
}

/**
 * Bucket Codeforces submissions to per-day ACCEPTED counts.
 * Only verdict === 'OK' rows with finite positive creationTimeSeconds count.
 * Pure — unit-tested.
 */
export function bucketCodeforcesSubmissionsByDay(
  submissions: readonly CfSubmissionLike[] | null | undefined,
  opts?: { todayKey?: string }
): Record<string, number> {
  const out: Record<string, number> = {}
  if (!submissions || submissions.length === 0) return out
  const maxKey = opts?.todayKey ?? '9999-12-31'
  for (const sub of submissions) {
    if (!sub || (sub as any).verdict !== 'OK') continue
    const ts = (sub as any).creationTimeSeconds
    if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) continue
    const day = epochToDayKey(ts)
    if (!day) continue
    if (day > maxKey) continue
    out[day] = (out[day] ?? 0) + 1
  }
  return out
}

export interface CodeforcesDailyDeps {
  fetchFn?: typeof fetch
}

/**
 * Fetch Codeforces per-day accepted submissions via user.status.
 * Best-effort: returns {} on rate-limit/network/parse failure (never throws).
 * NOTE: goes through the shared 2s CF gate (1 extra gated call per sync when
 * a CF handle is linked — same budget class as the stats user.status call).
 */
export async function fetchCodeforcesDailyActivity(
  handle: string,
  deps: CodeforcesDailyDeps = {}
): Promise<Record<string, number>> {
  const sanitized = sanitizeActivityHandle(handle)
  if (!sanitized) return {}
  try {
    const status = await fetchCodeforcesJson<any>(
      `https://codeforces.com/api/user.status?handle=${encodeURIComponent(sanitized)}&from=1&count=10000`,
      { timeoutMs: CF_STATS_TIMEOUT_MS },
      deps.fetchFn ? { fetchFn: deps.fetchFn } : {}
    )
    if (status.stillRateLimited) return {}
    if (status.status === 404 || (status.status as number) === 400) return {}
    const data: any = status.data
    if (!data || data.status !== 'OK' || !Array.isArray(data.result)) return {}
    const now = new Date()
    const todayKey = `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`
    return bucketCodeforcesSubmissionsByDay(data.result as CfSubmissionLike[], { todayKey })
  } catch (err) {
    logger.warn({ err: (err as any)?.message || err }, `${SYNC_TIMEOUT_NOTE} Codeforces daily fetch failed for ${sanitized} (best-effort)`)
    return {}
  }
}

/** Sum leetcode + codeforces daily maps into one coding map (pure). */
export function mergeCodingDaily(
  ...maps: Array<Record<string, number> | null | undefined>
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of maps) {
    if (!m) continue
    for (const [k, v] of Object.entries(m)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue
      const n = Math.floor(Number(v))
      if (!Number.isFinite(n) || n <= 0) continue
      out[k] = (out[k] ?? 0) + n
    }
  }
  return out
}

/**
 * Fetch all obtainable coding daily maps for a profile (parallel,
 * best-effort). Returns per-source maps; missing handles yield {}.
 * Never throws (each source is individually guarded).
 */
export async function fetchCodingDailyForProfile(profile: {
  leetcodeHandle?: string | null
  codeforcesHandle?: string | null
}): Promise<Record<CodingActivitySource, Record<string, number>>> {
  const empty = (): Record<CodingActivitySource, Record<string, number>> => ({
    leetcode: {},
    codeforces: {},
    github: {},
  })
  try {
    const [lc, cf] = await Promise.all([
      profile?.leetcodeHandle
        ? fetchLeetcodeDailyActivity(profile.leetcodeHandle).catch(() => ({}))
        : Promise.resolve({}),
      profile?.codeforcesHandle
        ? fetchCodeforcesDailyActivity(profile.codeforcesHandle).catch(() => ({}))
        : Promise.resolve({}),
    ])
    return { leetcode: lc, codeforces: cf, github: {} }
  } catch {
    return empty()
  }
}

/**
 * GitHub daily fetch — best-effort cached wrapper over getGithubCalendar.
 * Returns [] (never null/throw) so sync can include it unconditionally.
 * Public page only, no tokens (see githubActivity.ts for limits).
 */
export async function fetchGithubDailyBestEffort(
  username: unknown,
  days = ACTIVITY_WINDOW_DAYS
): Promise<DailyCount[]> {
  try {
    const raw = String(username ?? '').trim()
    if (!raw) return []
    const cal = await getGithubCalendar(raw, days)
    if (!cal || cal.length === 0) return []
    return cal
      .filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.count > 0)
      .map((d) => ({ date: d.date, count: Math.max(0, Math.floor(d.count)) }))
  } catch {
    return []
  }
}

export interface ActivityRowInput {
  userId: string
  /** UTC-midnight Date */
  date: Date
  source: CodingActivitySource
  count: number
}

/**
 * Convert per-source day maps to DB rows (UTC-midnight dates, counts floored
 * and clamped >= 1). Skips malformed dates. Pure — unit-tested.
 */
export function toActivityRows(
  userId: string,
  bySource: Partial<Record<CodingActivitySource, Record<string, number>>>
): ActivityRowInput[] {
  const rows: ActivityRowInput[] = []
  if (!userId) return rows
  const sources: CodingActivitySource[] = ['leetcode', 'codeforces', 'github']
  for (const source of sources) {
    const m = bySource[source]
    if (!m) continue
    for (const [day, count] of Object.entries(m)) {
      const date = dayKeyToUtcDate(day)
      if (!date) continue
      const n = Math.floor(Number(count))
      if (!Number.isFinite(n) || n <= 0) continue
      rows.push({ userId, date, source, count: n })
    }
  }
  return rows
}

/** True when the DB/client predates the coding-activity migration. */
export function isMissingActivityTableError(err: any): boolean {
  if (!err) return false
  if (err.code === 'P2021' || err.code === 'P2022') return true
  const msg = String(err?.message || err)
  return /codingactivity.*(does not exist|unknown|not exist)|relation "?codingactivity"? does not exist|unknown argument.*codingactivity/i.test(msg)
}

let warnedMissingActivityTable = false
/** Test-only: reset warn-once flag. */
export function __resetActivityMissingTableForTests(): void {
  warnedMissingActivityTable = false
}

export interface SaveActivityResult {
  saved: number
  skipped?: 'pre-migration' | undefined
}

/**
 * Batched write of a user's activity snapshot: delete the trailing window
 * for the touched sources, then chunked createMany. Typically 1 delete + 1-2
 * creates (~2-3 round-trips for a full 182d x 3-source snapshot).
 * Never throws: pre-migration degrades to warn-once + { saved: 0,
 * skipped: 'pre-migration' }; other failures log and return { saved: 0 }.
 */
export async function saveCodingActivity(
  userId: string,
  bySource: Partial<Record<CodingActivitySource, Record<string, number>>>,
  opts?: { db?: any; windowDays?: number; today?: Date }
): Promise<SaveActivityResult> {
  if (!userId) return { saved: 0 }
  const rows = toActivityRows(userId, bySource)
  const touchedSources = [...new Set(rows.map((r) => r.source))]
  if (touchedSources.length === 0) return { saved: 0 }
  // Keep DB bounded: only the trailing window is authoritative; older
  // hand-edited rows outside the window are left alone (no mass delete).
  const windowDays = Math.max(1, Math.floor(opts?.windowDays ?? ACTIVITY_WINDOW_DAYS))
  const today = opts?.today ?? new Date()
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  start.setUTCDate(start.getUTCDate() - (windowDays - 1))
  try {
    // Lazy-require prisma so unit tests never touch the DB client.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const db: any = opts?.db ?? require('../config/db').default ?? require('../config/db')
    const delegate = db?.codingActivity
    if (!delegate) {
      if (!warnedMissingActivityTable) {
        warnedMissingActivityTable = true
        logger.warn(`${SYNC_TIMEOUT_NOTE} CodingActivity unavailable (pre-migration client?) — skipping daily-activity save`)
      }
      return { saved: 0, skipped: 'pre-migration' }
    }
    await delegate.deleteMany({
      where: { userId, source: { in: touchedSources }, date: { gte: start } },
    })
    let saved = 0
    for (let i = 0; i < rows.length; i += CREATE_CHUNK) {
      const chunk = rows.slice(i, i + CREATE_CHUNK)
      try {
        await delegate.createMany({ data: chunk, skipDuplicates: true })
        saved += chunk.length
      } catch (err) {
        if (isMissingActivityTableError(err)) {
          if (!warnedMissingActivityTable) {
            warnedMissingActivityTable = true
            logger.warn(
              { err: (err as any)?.message || err },
              `${SYNC_TIMEOUT_NOTE} CodingActivity table missing (migration not applied) — skipping daily-activity save`
            )
          }
          return { saved, skipped: 'pre-migration' }
        }
        throw err
      }
    }
    return { saved }
  } catch (err) {
    if (isMissingActivityTableError(err)) {
      if (!warnedMissingActivityTable) {
        warnedMissingActivityTable = true
        logger.warn(
          { err: (err as any)?.message || err },
          `${SYNC_TIMEOUT_NOTE} CodingActivity table missing (migration not applied) — skipping daily-activity save`
        )
      }
      return { saved: 0, skipped: 'pre-migration' }
    }
    logger.error({ err }, `${SYNC_TIMEOUT_NOTE} saveCodingActivity failed for ${userId} (best-effort, sync continues)`)
    return { saved: 0 }
  }
}
