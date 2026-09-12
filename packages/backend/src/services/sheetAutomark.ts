// packages/backend/src/services/sheetAutomark.ts
// Sheets auto-mark — Codeforces full-history + LeetCode recent-20 solved feeds.
//
// WHY: SheetsTab showed manual checkmarks only, so users re-ticked problems
// they had already solved on CF/LC. This module owns the read-only solved
// feeds behind GET /coding-problems/automark:
//   cf — user.status?from=1&count=10000 (verdict OK → `${contestId}-${index}`,
//     full history, same join key + URL builder as the CF catalog; gated
//     through the shared 2s codeforcesGate, 10s timeout, 10min per-handle
//     server cache).
//   lc — recentSubmissionList(username, limit 20) (statusDisplay Accepted →
//     titleSlug, recent-20 window ONLY, 12s timeout, 10min per-handle cache,
//     backoff on non-200/bot-403).
// Rate-safe: ≤2 upstream calls per uncached user (one per platform), both
// cached ≥10min; CF shares the process-wide 2s gate with stats/heatmap so
// auto-mark never triples the sync budget (sync reuses its own user.status
// calls; this endpoint reuses the gate + cache, never bypasses). Route
// limiter is 20req/10s (index.ts wiring) like the other coding-problems
// routes. CodeChef/HackerRank/GFG have NO solved API — honestly omitted (no
// scrapers, manual marks only — see SheetsTab notice).
// No-fake contract (binding): only verdict OK / statusDisplay Accepted rows
// with valid join keys count; unknown handles (CF 400 FAILED / LC [] / null
// user) yield empty solved (never "unsolved"), failures serve stale cache
// with stale:true or honest error — never invented solves. No DB writes, no
// migration (shared lib/cache only). No secrets (public CF API + public LC
// GraphQL with Referer+UA as probed in .ai/reports/submission-api-probe.md).

import { cache, type CacheBackend } from '../lib/cache'
import { fetchCodeforcesJson } from './codeforcesGate'
import { CF_STATS_TIMEOUT_MS, LEETCODE_STATS_TIMEOUT_MS } from './platformStats'
import { isValidSlug } from './codingProblems'
import { logger } from '../utils/logger'

/** Upstream timeouts (reuse the stats tail budgets — same hosts). */
export const AUTOMARK_CF_TIMEOUT_MS = CF_STATS_TIMEOUT_MS
export const AUTOMARK_LC_TIMEOUT_MS = LEETCODE_STATS_TIMEOUT_MS
/** Server cache: solves move slowly; 10min per-handle (LC bot-sensitive). */
export const AUTOMARK_CF_TTL_MS = 10 * 60 * 1000
export const AUTOMARK_LC_TTL_MS = 10 * 60 * 1000
/** CF full history page (same as stats/heatmap — one heavy call, cached). */
export const AUTOMARK_CF_COUNT = 10000
/** LC hard cap: endpoint returns ≤20, no paging (probe-verified). */
export const AUTOMARK_LC_LIMIT = 20
export const AUTOMARK_CACHE_PREFIX = 'coding-problems:automark'
export const CF_AUTOMARK_CACHE_KEY = (h: string) => `${AUTOMARK_CACHE_PREFIX}:cf:${h.toLowerCase()}:v1`
export const LC_AUTOMARK_CACHE_KEY = (h: string) => `${AUTOMARK_CACHE_PREFIX}:lc:${h.toLowerCase()}:v1`
/** LeetCode GraphQL recent feed (probe-verified field set + headers). */
export const LC_RECENT_QUERY =
  'query recentSubmissions($username: String!, $limit: Int!) { recentSubmissionList(username: $username, limit: $limit) { title titleSlug timestamp statusDisplay lang } }'
const LC_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const HANDLE_RE = /^[a-zA-Z0-9._-]+$/
const CF_INDEX_RE = /^[A-Z][0-9]?$/

/** Sanitize a platform handle (null when not a real shape — never fetch). */
export function sanitizeAutomarkHandle(handle: unknown): string | null {
  const s = String(handle ?? '').trim()
  if (!s || s.length > 50) return null
  if (!HANDLE_RE.test(s)) return null
  return s
}

// ---------------------------------------------------------------------------
// Pure join mapping (unit-tested, never throws).
// ---------------------------------------------------------------------------

export interface CfSubmissionLike {
  verdict?: unknown
  problem?: { contestId?: unknown; index?: unknown } | null
}

/**
 * Map CF user.status rows to solved `${contestId}-${index}` keys.
 * Only verdict === "OK" rows with integer contestId>0 + index matching
 * CF_INDEX_RE count. Dedupe via Set, sorted for stable JSON. Gym rows are
 * NOT filtered here — the caller intersects with the ladder catalog (known
 * keys), so non-problemset contests never mark a sheet row.
 */
export function extractCfSolvedKeys(submissions: readonly CfSubmissionLike[] | null | undefined): string[] {
  const set = new Set<string>()
  if (!submissions || submissions.length === 0) return []
  for (const sub of submissions) {
    try {
      if (!sub || (sub as any).verdict !== 'OK') continue
      const p = (sub as any).problem
      if (!p || typeof p !== 'object') continue
      const cid = (p as any).contestId
      const idx = (p as any).index
      if (!Number.isInteger(cid) || (cid as number) <= 0) continue
      if (typeof idx !== 'string' || !CF_INDEX_RE.test(idx)) continue
      set.add(`${cid}-${idx}`)
    } catch {
      continue
    }
  }
  return [...set].sort()
}

export interface LcSubmissionLike {
  titleSlug?: unknown
  statusDisplay?: unknown
  timestamp?: unknown
}

/** Coerce an LC timestamp (string seconds | number s/ms) → ms (null bad). */
export function parseLcTimestampMs(ts: unknown): number | null {
  try {
    const n = typeof ts === 'string' && ts.trim() !== '' ? Number(ts.trim()) : (ts as number)
    if (!Number.isFinite(n) || n <= 0) return null
    const ms = n > 1e12 ? Math.floor(n) : Math.floor(n * 1000)
    if (!Number.isFinite(ms) || ms <= 0) return null
    return ms
  } catch {
    return null
  }
}

export interface LcSolvedEntry {
  slug: string
  solvedAtMs: number
}

/**
 * Map LC recentSubmissionList rows to deduped Accepted slugs (latest solve
 * wins per slug, sorted newest-first). Only statusDisplay === "Accepted"
 * (exact casing, probe-verified) with a valid slug counts. Callers must
 * label this "recently solved (last 20)" — older solves are invisible here.
 */
export function extractLcRecentSolved(submissions: readonly LcSubmissionLike[] | null | undefined): LcSolvedEntry[] {
  const best = new Map<string, number>()
  if (!submissions || submissions.length === 0) return []
  for (const sub of submissions) {
    try {
      if (!sub || (sub as any).statusDisplay !== 'Accepted') continue
      const raw = (sub as any).titleSlug
      if (!isValidSlug(raw)) continue
      const slug = String(raw).trim()
      const ms = parseLcTimestampMs((sub as any).timestamp)
      if (ms == null) continue
      const prev = best.get(slug)
      if (prev == null || ms > prev) best.set(slug, ms)
    } catch {
      continue
    }
  }
  return [...best.entries()]
    .map(([slug, solvedAtMs]) => ({ slug, solvedAtMs }))
    .sort((a, b) => b.solvedAtMs - a.solvedAtMs)
}

// ---------------------------------------------------------------------------
// Cached loaders (I/O). Deps injectable for hermetic tests.
// ---------------------------------------------------------------------------

export interface AutomarkDeps {
  fetchFn?: typeof fetch
  now?: () => number
  cacheBackend?: CacheBackend
  timeoutMs?: number
}

function depsCache(d: AutomarkDeps): CacheBackend {
  return d.cacheBackend ?? cache
}

export interface CfAutomarkEntry {
  solvedKeys: string[]
  cachedAt: string
}

export interface CfAutomarkResult {
  handle: string | null
  solvedKeys: string[]
  stale: boolean
  cachedAt: string | null
  rateLimited?: boolean
  error?: string
}

/** Load CF solved keys: fresh cache → gated user.status → stale cache → honest empty. */
export async function loadCfSolvedKeys(
  handle: string,
  deps: AutomarkDeps = {},
): Promise<CfAutomarkResult> {
  const sanitized = sanitizeAutomarkHandle(handle)
  if (!sanitized) return { handle: null, solvedKeys: [], stale: false, cachedAt: null }
  const now = deps.now ?? Date.now
  const c = depsCache(deps)
  const timeoutMs = deps.timeoutMs ?? AUTOMARK_CF_TIMEOUT_MS
  const key = CF_AUTOMARK_CACHE_KEY(sanitized)

  let cached: CfAutomarkEntry | null = null
  try {
    cached = await c.get<CfAutomarkEntry>(key)
  } catch { cached = null }
  const fresh = cached && now() - new Date(cached.cachedAt).getTime() < AUTOMARK_CF_TTL_MS
  if (fresh && cached) {
    return { handle: sanitized, solvedKeys: cached.solvedKeys, stale: false, cachedAt: cached.cachedAt }
  }

  try {
    const status = await fetchCodeforcesJson<any>(
      `https://codeforces.com/api/user.status?handle=${encodeURIComponent(sanitized)}&from=1&count=${AUTOMARK_CF_COUNT}`,
      { timeoutMs },
      deps.fetchFn ? { fetchFn: deps.fetchFn } : {},
    )
    if (status.stillRateLimited) {
      if (cached) {
        return { handle: sanitized, solvedKeys: cached.solvedKeys, stale: true, cachedAt: cached.cachedAt, rateLimited: true }
      }
      return { handle: sanitized, solvedKeys: [], stale: false, cachedAt: null, rateLimited: true, error: 'Codeforces is rate-limiting — retry in a couple of seconds.' }
    }
    // Unknown handle: CF returns HTTP 400 + {status:FAILED} (probe §1). That
    // is "unlinked/unknown", not retryable — empty solved, no error throw.
    if (status.status === 404 || (status.status as number) === 400) {
      return { handle: sanitized, solvedKeys: [], stale: false, cachedAt: cached?.cachedAt ?? null }
    }
    const data: any = status.data
    if (!data || data.status !== 'OK' || !Array.isArray(data.result)) {
      throw new Error('Codeforces API FAILED')
    }
    const solvedKeys = extractCfSolvedKeys(data.result as CfSubmissionLike[])
    const entry: CfAutomarkEntry = { solvedKeys, cachedAt: new Date(now()).toISOString() }
    try { await c.set(key, entry, AUTOMARK_CF_TTL_MS) } catch { /* best-effort */ }
    return { handle: sanitized, solvedKeys, stale: false, cachedAt: entry.cachedAt }
  } catch (err) {
    logger.warn({ err: (err as any)?.message || err }, '[automark] codeforces solved fetch failed')
    if (cached) {
      return { handle: sanitized, solvedKeys: cached.solvedKeys, stale: true, cachedAt: cached.cachedAt }
    }
    return { handle: sanitized, solvedKeys: [], stale: false, cachedAt: null, error: 'Codeforces solves unavailable — retry shortly.' }
  }
}

export interface LcAutomarkEntry {
  solved: LcSolvedEntry[]
  cachedAt: string
}

export interface LcAutomarkResult {
  handle: string | null
  solved: LcSolvedEntry[]
  stale: boolean
  cachedAt: string | null
  /** Honest window note — always present when a handle is linked. */
  note?: string
  error?: string
}

const LC_WINDOW_NOTE = 'Recent 20 submissions only — older LeetCode solves need a manual check.'

/** Load LC recent solved: fresh cache → GraphQL recent-20 → stale cache → honest empty. */
export async function loadLcRecentSolved(
  handle: string,
  deps: AutomarkDeps = {},
): Promise<LcAutomarkResult> {
  const sanitized = sanitizeAutomarkHandle(handle)
  if (!sanitized) return { handle: null, solved: [], stale: false, cachedAt: null }
  const fetchFn = deps.fetchFn ?? globalThis.fetch
  const now = deps.now ?? Date.now
  const c = depsCache(deps)
  const timeoutMs = deps.timeoutMs ?? AUTOMARK_LC_TIMEOUT_MS
  const key = LC_AUTOMARK_CACHE_KEY(sanitized)

  let cached: LcAutomarkEntry | null = null
  try {
    cached = await c.get<LcAutomarkEntry>(key)
  } catch { cached = null }
  const fresh = cached && now() - new Date(cached.cachedAt).getTime() < AUTOMARK_LC_TTL_MS
  if (fresh && cached) {
    return { handle: sanitized, solved: cached.solved, stale: false, cachedAt: cached.cachedAt, note: LC_WINDOW_NOTE }
  }

  try {
    const resp = await fetchFn('https://leetcode.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': LC_UA, Referer: 'https://leetcode.com/' },
      body: JSON.stringify({ query: LC_RECENT_QUERY, variables: { username: sanitized, limit: AUTOMARK_LC_LIMIT } }),
      signal: AbortSignal.timeout(timeoutMs),
    } as RequestInit)
    if (!resp.ok) throw new Error(`LeetCode HTTP ${ (resp as Response).status ?? 0 }`)
    let json: unknown = null
    try {
      json = (await (resp as Response).json()) as unknown
    } catch {
      throw new Error('LeetCode payload unreadable')
    }
    const list = (json as any)?.data?.recentSubmissionList
    // [] is ambiguous (unknown vs inactive vs private — probe §2): treat as
    // "no recent data", not "unsolved". null user → same (no throw).
    const rows = Array.isArray(list) ? (list as LcSubmissionLike[]) : []
    const solved = extractLcRecentSolved(rows)
    const entry: LcAutomarkEntry = { solved, cachedAt: new Date(now()).toISOString() }
    try { await c.set(key, entry, AUTOMARK_LC_TTL_MS) } catch { /* best-effort */ }
    return { handle: sanitized, solved, stale: false, cachedAt: entry.cachedAt, note: LC_WINDOW_NOTE }
  } catch (err) {
    logger.warn({ err: (err as any)?.message || err }, '[automark] leetcode recent fetch failed')
    if (cached) {
      return { handle: sanitized, solved: cached.solved, stale: true, cachedAt: cached.cachedAt, note: LC_WINDOW_NOTE }
    }
    return { handle: sanitized, solved: [], stale: false, cachedAt: null, note: LC_WINDOW_NOTE, error: 'LeetCode recent solves unavailable — retry shortly.' }
  }
}

export interface AutomarkSnapshot {
  cf: CfAutomarkResult
  lc: LcAutomarkResult
}

/**
 * Load both solved feeds for a profile's linked handles (parallel,
 * best-effort). Missing handles yield empty (null handle). Never throws —
 * each loader is individually guarded.
 */
export async function loadAutomarkForHandles(
  handles: { cfHandle?: string | null; lcHandle?: string | null },
  deps: AutomarkDeps = {},
): Promise<AutomarkSnapshot> {
  try {
    const [cf, lc] = await Promise.all([
      handles?.cfHandle
        ? loadCfSolvedKeys(handles.cfHandle, deps).catch(() => ({ handle: null, solvedKeys: [], stale: false, cachedAt: null }) as CfAutomarkResult)
        : Promise.resolve({ handle: null, solvedKeys: [], stale: false, cachedAt: null } as CfAutomarkResult),
      handles?.lcHandle
        ? loadLcRecentSolved(handles.lcHandle, deps).catch(() => ({ handle: null, solved: [], stale: false, cachedAt: null, note: LC_WINDOW_NOTE }) as LcAutomarkResult)
        : Promise.resolve({ handle: null, solved: [], stale: false, cachedAt: null } as LcAutomarkResult),
    ])
    return { cf, lc }
  } catch {
    return {
      cf: { handle: null, solvedKeys: [], stale: false, cachedAt: null },
      lc: { handle: null, solved: [], stale: false, cachedAt: null },
    }
  }
}
