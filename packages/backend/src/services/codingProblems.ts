// packages/backend/src/services/codingProblems.ts
// Problems-to-Solve — LeetCode daily + curated explore pool + Codeforces live.
//
// WHY: CodingProfilePage showed totals/history but never answered "what do I
// solve next?". This module owns the read-only problem sources behind
// GET /coding-problems/daily + GET /coding-problems/list + GET /coding-problems/codeforces:
//   daily — activeDailyCodingChallengeQuestion proxy (single LeetCode call,
//     20h server cache, stale-served on upstream failure).
//   list  — curated static pool (~30 hand-verified titleSlugs, in-memory
//     filter) + OPTIONAL live problemsetQuestionListV2 passthrough (one call,
//     24h cache keyed by params).
//   codeforces — official problemset.problems proxy (single GET, 12h server
//     cache of the FULL catalog, in-memory tag + rating-band filter, sort by
//     rating/solvedCount, 1req/2s upstream guard, stale-served on failure).
// Rate-safe: ≤2 upstream calls per page (frontend fetches daily + list once
// per tab mount; CF tab lazy-fetches once); route limiter is 20req/10s
// (index.ts wiring). Every live source records a SourceHealth run
// (LEETCODE_DAILY / LEETCODE_PROBLEMSET / CODEFORCES_PROBLEMS).
// No-fake contract (binding): rows without a valid titleSlug (LeetCode) or
// contestId/index/name (Codeforces) are DROPPED (never synthesized);
// failures serve stale cache with stale:true or 502 — never invented
// problems. No DB writes, no migration (shared lib/cache + SourceHealth
// fallback store only). No secrets (public LeetCode GraphQL + public CF API).

import { cache, type CacheBackend } from '../lib/cache'
import {
  sourceHealthStore,
  type SourceHealthStore,
} from './fetch/health'
import { logger } from '../utils/logger'

export const LEETCODE_GRAPHQL_URL = 'https://leetcode.com/graphql'
/** Daily upstream timeout (matches LEETCODE_STATS_TIMEOUT_MS tail budget). */
export const CODING_PROBLEMS_FETCH_TIMEOUT_MS = 12_000
/** Server cache: daily rotates ~24h; 20h keeps one fetch/day with overlap. */
export const CODING_PROBLEMS_DAILY_TTL_MS = 20 * 60 * 60 * 1000
/** Physical retention for the daily entry so expired-but-recent rows stay
 *  servable as stale (freshness stays 20h above). Without this the 20h TTL
 *  evicts the row exactly when we need yesterday's card on a fetch blip. */
export const CODING_PROBLEMS_DAILY_STALE_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Daily GraphQL query — QuestionNode exposes `isPaidOnly` (live probe
 *  2026-09-11: `paidOnly` on QuestionNode 400s with "Did you mean
 *  isPaidOnly?"). Keep the selection minimal (one call, 12s budget). */
export const DAILY_CHALLENGE_QUERY =
  'query { activeDailyCodingChallengeQuestion { date link question { title titleSlug difficulty questionFrontendId isPaidOnly } } }'
/** Server cache: problemset catalog moves slowly; 24h per param-key. */
export const CODING_PROBLEMS_LIST_TTL_MS = 24 * 60 * 60 * 1000
/** Physical retention for list entries so expired-but-recent rows stay
 *  servable as stale on a revalidate blip (freshness stays 24h above).
 *  Same cache-first-then-revalidate pattern as the daily 7d retention
 *  (daily fix 2026-09-11): without this the 24h TTL evicts the row exactly
 *  when we need the previous page as `stale:true`. */
export const CODING_PROBLEMS_LIST_STALE_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Live list GraphQL query — V1 `problemsetQuestionList` was removed
 *  (live probe 2026-09-11: 400 `Cannot query field "problemsetQuestionList"
 *  on type "Query". Did you mean "problemsetQuestionListV2"?`). V2 takes
 *  `filters: QuestionFilterInput` (requires `filterCombineType: ALL`;
 *  topic via `topicFilter.topicSlugs`, difficulty via
 *  `difficultyFilter.difficulties`) and returns `totalLength` + `questions`.
 *  Notes from live probing (same headers/timeout as production code):
 *  - V2's ProblemSetQuestionNode exposes `paidOnly` (NOT `isPaidOnly` —
 *    the mirror image of the daily drift; `isPaidOnly` on V2 400s with
 *    "Did you mean paidOnly?"). Selection keeps `paidOnly`.
 *  - `difficulty` arrives UPPERCASE (EASY/MEDIUM/HARD) — handled by the
 *    case-insensitive normalizeDifficulty.
 *  - Top-level `searchKeyword` is auth-gated (unauthenticated → 200 with
 *    `errors: "Please Register or Sign in"`, `data: null`), so `search` is
 *    NEVER sent upstream — it is post-filtered in-memory on the fetched
 *    page (see loadLiveProblemList). No secrets, no auth. */
export const PROBLEMSET_V2_QUERY =
  'query problemsetQuestionListV2($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionFilterInput) { problemsetQuestionListV2(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) { totalLength questions { title titleSlug difficulty topicTags { name slug } paidOnly } } }'
/** SourceHealth platform keys (normalized UPPERCASE at record time). */
export const DAILY_SOURCE = 'LEETCODE_DAILY'
export const LIST_SOURCE = 'LEETCODE_PROBLEMSET'
export const PROBLEMS_CACHE_PREFIX = 'coding-problems'
export const DAILY_CACHE_KEY = `${PROBLEMS_CACHE_PREFIX}:daily:v1`

export type ProblemDifficulty = 'Easy' | 'Medium' | 'Hard'

export interface CuratedProblem {
  title: string
  titleSlug: string
  difficulty: ProblemDifficulty
  topics: string[]
  paidOnly?: boolean
}

export interface ProblemItem extends CuratedProblem {
  url: string
}

export interface DailyProblem {
  title: string
  titleSlug: string
  url: string
  difficulty: ProblemDifficulty | null
  date: string | null
  questionId: string | null
  paidOnly: boolean
  stale: boolean
  cachedAt: string | null
}

const SLUG_RE = /^[a-z0-9-]+$/

export function isValidSlug(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 100 && SLUG_RE.test(v)
}

/** Real LeetCode problem URL — null when the slug is not a real shape. */
export function buildProblemUrl(titleSlug: string): string | null {
  if (!isValidSlug(titleSlug)) return null
  return `https://leetcode.com/problems/${titleSlug}/`
}

export function normalizeDifficulty(raw: unknown): ProblemDifficulty | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim().toLowerCase()
  if (t === 'easy') return 'Easy'
  if (t === 'medium' || t === 'med') return 'Medium'
  if (t === 'hard') return 'Hard'
  return null
}

// ---------------------------------------------------------------------------
// Curated static pool (~30 hand-verified LeetCode slugs).
// Titles/difficulties/topics mirror the public LeetCode catalog (Sep 2026).
// Every row links out via buildProblemUrl; paidOnly is false throughout
// (all 30 are free) but kept explicit so the UI badge contract is uniform.
// ---------------------------------------------------------------------------

export const CURATED_PROBLEMS: ReadonlyArray<CuratedProblem> = [
  // Easy — fundamentals
  { title: 'Two Sum', titleSlug: 'two-sum', difficulty: 'Easy', topics: ['array', 'hash-table'] },
  { title: 'Best Time to Buy and Sell Stock', titleSlug: 'best-time-to-buy-and-sell-stock', difficulty: 'Easy', topics: ['array', 'dynamic-programming'] },
  { title: 'Valid Parentheses', titleSlug: 'valid-parentheses', difficulty: 'Easy', topics: ['stack', 'string'] },
  { title: 'Merge Two Sorted Lists', titleSlug: 'merge-two-sorted-lists', difficulty: 'Easy', topics: ['linked-list'] },
  { title: 'Climbing Stairs', titleSlug: 'climbing-stairs', difficulty: 'Easy', topics: ['dynamic-programming'] },
  { title: 'Maximum Subarray', titleSlug: 'maximum-subarray', difficulty: 'Easy', topics: ['array', 'dynamic-programming', 'divide-and-conquer'] },
  { title: 'Valid Anagram', titleSlug: 'valid-anagram', difficulty: 'Easy', topics: ['hash-table', 'string'] },
  { title: 'Binary Search', titleSlug: 'binary-search', difficulty: 'Easy', topics: ['array', 'binary-search'] },
  { title: 'Reverse Linked List', titleSlug: 'reverse-linked-list', difficulty: 'Easy', topics: ['linked-list'] },
  { title: 'Maximum Depth of Binary Tree', titleSlug: 'maximum-depth-of-binary-tree', difficulty: 'Easy', topics: ['tree', 'dfs', 'bfs'] },
  // Medium — core interview patterns
  { title: 'Longest Substring Without Repeating Characters', titleSlug: 'longest-substring-without-repeating-characters', difficulty: 'Medium', topics: ['hash-table', 'sliding-window', 'string'] },
  { title: 'Container With Most Water', titleSlug: 'container-with-most-water', difficulty: 'Medium', topics: ['array', 'two-pointers'] },
  { title: '3Sum', titleSlug: '3sum', difficulty: 'Medium', topics: ['array', 'two-pointers', 'sorting'] },
  { title: 'Group Anagrams', titleSlug: 'group-anagrams', difficulty: 'Medium', topics: ['array', 'hash-table', 'string'] },
  { title: 'Top K Frequent Elements', titleSlug: 'top-k-frequent-elements', difficulty: 'Medium', topics: ['array', 'hash-table', 'heap'] },
  { title: 'Product of Array Except Self', titleSlug: 'product-of-array-except-self', difficulty: 'Medium', topics: ['array', 'prefix-sum'] },
  { title: 'Search in Rotated Sorted Array', titleSlug: 'search-in-rotated-sorted-array', difficulty: 'Medium', topics: ['array', 'binary-search'] },
  { title: 'Combination Sum', titleSlug: 'combination-sum', difficulty: 'Medium', topics: ['array', 'backtracking'] },
  { title: 'Merge Intervals', titleSlug: 'merge-intervals', difficulty: 'Medium', topics: ['array', 'sorting'] },
  { title: 'House Robber', titleSlug: 'house-robber', difficulty: 'Medium', topics: ['dynamic-programming'] },
  { title: 'Number of Islands', titleSlug: 'number-of-islands', difficulty: 'Medium', topics: ['matrix', 'bfs', 'dfs'] },
  { title: 'Course Schedule', titleSlug: 'course-schedule', difficulty: 'Medium', topics: ['graph', 'bfs', 'dfs'] },
  { title: 'Implement Trie (Prefix Tree)', titleSlug: 'implement-trie-prefix-tree', difficulty: 'Medium', topics: ['hash-table', 'string', 'trie'] },
  { title: 'Coin Change', titleSlug: 'coin-change', difficulty: 'Medium', topics: ['dynamic-programming', 'bfs'] },
  { title: 'LRU Cache', titleSlug: 'lru-cache', difficulty: 'Medium', topics: ['design', 'hash-table', 'linked-list'] },
  // Hard — stretch goals
  { title: 'Median of Two Sorted Arrays', titleSlug: 'median-of-two-sorted-arrays', difficulty: 'Hard', topics: ['array', 'binary-search'] },
  { title: 'Trapping Rain Water', titleSlug: 'trapping-rain-water', difficulty: 'Hard', topics: ['array', 'two-pointers', 'stack'] },
  { title: 'Merge k Sorted Lists', titleSlug: 'merge-k-sorted-lists', difficulty: 'Hard', topics: ['heap', 'linked-list'] },
  { title: 'Minimum Window Substring', titleSlug: 'minimum-window-substring', difficulty: 'Hard', topics: ['hash-table', 'sliding-window', 'string'] },
  { title: 'Binary Tree Maximum Path Sum', titleSlug: 'binary-tree-maximum-path-sum', difficulty: 'Hard', topics: ['tree', 'dfs'] },
]

export interface CuratedFilter {
  topic?: string | null
  difficulty?: ProblemDifficulty | null
  search?: string | null
}

/** In-memory filter over the curated pool (no upstream call). Pure. */
export function filterCuratedProblems(
  pool: ReadonlyArray<CuratedProblem> = CURATED_PROBLEMS,
  filter: CuratedFilter = {},
): ProblemItem[] {
  const topic = (filter.topic || '').trim().toLowerCase() || null
  const search = (filter.search || '').trim().toLowerCase() || null
  const out: ProblemItem[] = []
  for (const p of pool) {
    if (!isValidSlug(p.titleSlug) || !p.title) continue // no-fake: drop bad rows
    if (filter.difficulty && p.difficulty !== filter.difficulty) continue
    if (topic && !p.topics.some((t) => t.toLowerCase() === topic)) continue
    if (search && !(`${p.title} ${p.titleSlug}`.toLowerCase().includes(search))) continue
    const url = buildProblemUrl(p.titleSlug)
    if (!url) continue
    out.push({ title: p.title, titleSlug: p.titleSlug, difficulty: p.difficulty, topics: [...p.topics], paidOnly: !!p.paidOnly, url })
  }
  return out
}

/** Sorted unique topic slugs across the curated pool (filter dropdown). */
export function curatedTopics(
  pool: ReadonlyArray<CuratedProblem> = CURATED_PROBLEMS,
): string[] {
  const set = new Set<string>()
  for (const p of pool) for (const t of p.topics || []) {
    const s = String(t || '').trim().toLowerCase()
    if (s) set.add(s)
  }
  return [...set].sort()
}

// ---------------------------------------------------------------------------
// LeetCode GraphQL normalization (pure, unit-tested, never throws).
// ---------------------------------------------------------------------------

export interface NormalizedDaily {
  title: string
  titleSlug: string
  url: string
  difficulty: ProblemDifficulty | null
  date: string | null
  questionId: string | null
  paidOnly: boolean
}

/** Parse activeDailyCodingChallengeQuestion payload. Null when no real row. */
export function normalizeDailyResponse(json: unknown): NormalizedDaily | null {
  try {
    const node = (json as any)?.data?.activeDailyCodingChallengeQuestion
    if (!node || typeof node !== 'object') return null
    const q = (node as any).question || {}
    const titleSlug = typeof q.titleSlug === 'string' ? q.titleSlug.trim() : ''
    if (!isValidSlug(titleSlug)) return null // no-fake: drop slugless rows
    const url = buildProblemUrl(titleSlug)
    if (!url) return null
    const title = typeof q.title === 'string' && q.title.trim()
      ? q.title.trim().slice(0, 200)
      : titleSlug
    const dateRaw = typeof (node as any).date === 'string' ? (node as any).date.trim() : null
    const date = dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null
    const qidRaw = q.questionFrontendId ?? q.questionId ?? null
    const questionId = qidRaw != null && String(qidRaw).trim() ? String(qidRaw).trim().slice(0, 16) : null
    return {
      title,
      titleSlug,
      url,
      difficulty: normalizeDifficulty(q.difficulty),
      date,
      questionId,
      // Live schema uses `isPaidOnly`; accept legacy `paidOnly` too so old
      // mocks/cached rows still normalize (live probe 2026-09-11).
      paidOnly: (q as any).isPaidOnly === true || (q as any).paidOnly === true,
    }
  } catch {
    return null
  }
}

export interface LiveListParams {
  limit: number
  skip: number
  topic?: string | null
  difficulty?: ProblemDifficulty | null
  search?: string | null
}

/** Clamp + sanitize list query into GraphQL variables (pure, tested). */
export function buildProblemsetVariables(params: {
  limit?: unknown
  skip?: unknown
  topic?: unknown
  difficulty?: unknown
  search?: unknown
}): LiveListParams & { gqlDifficulty: 'EASY' | 'MEDIUM' | 'HARD' | null } {
  const rawLimit = parseInt(String(params.limit ?? '30'), 10)
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 30
  const rawSkip = parseInt(String(params.skip ?? '0'), 10)
  const skip = Number.isFinite(rawSkip) ? Math.max(0, rawSkip) : 0
  const topicRaw = typeof params.topic === 'string' ? params.topic.trim().toLowerCase() : ''
  const topic = topicRaw && /^[a-z0-9-]+$/.test(topicRaw) ? topicRaw : null
  const difficulty = typeof params.difficulty === 'string'
    ? normalizeDifficulty(params.difficulty)
    : null
  const gqlDifficulty = difficulty === 'Easy' ? 'EASY' : difficulty === 'Medium' ? 'MEDIUM' : difficulty === 'Hard' ? 'HARD' : null
  const searchRaw = typeof params.search === 'string' ? params.search.trim().slice(0, 100) : ''
  return { limit, skip, topic, difficulty, search: searchRaw || null, gqlDifficulty }
}

/** Build V2 GraphQL variables from sanitized list params (pure, tested).
 *  Only unauthenticated-safe filters are sent: topic + difficulty. `search`
 *  is intentionally EXCLUDED — V2 `searchKeyword` requires LeetCode login
 *  (live probe 2026-09-11) and would turn every search into an auth-wall
 *  `data: null`; the loader post-filters `search` in-memory instead. */
export function buildProblemsetV2Variables(params: LiveListParams & { gqlDifficulty: 'EASY' | 'MEDIUM' | 'HARD' | null }): {
  categorySlug: string
  limit: number
  skip: number
  filters: Record<string, unknown>
} {
  const filters: Record<string, unknown> = { filterCombineType: 'ALL' }
  if (params.topic) filters.topicFilter = { topicSlugs: [params.topic], operator: 'IS' }
  if (params.gqlDifficulty) filters.difficultyFilter = { difficulties: [params.gqlDifficulty], operator: 'IS' }
  return { categorySlug: '', limit: params.limit, skip: params.skip, filters }
}

/** Parse problemset payload. Accepts V2 (`problemsetQuestionListV2` with
 *  `totalLength`) and legacy V1 (`problemsetQuestionList` with
 *  `total`/`totalNum` + `questions`/`data`). Drops slugless rows (no-fake). */
export function normalizeProblemsetQuestions(json: unknown): { items: ProblemItem[]; total: number } {
  try {
    const data = (json as any)?.data
    const root = (data as any)?.problemsetQuestionListV2 ?? (data as any)?.problemsetQuestionList
    if (!root || typeof root !== 'object') return { items: [], total: 0 }
    const rawTotal = Number((root as any)?.totalLength ?? (root as any)?.totalNum ?? (root as any)?.total)
    const total = Number.isFinite(rawTotal) && rawTotal >= 0 ? Math.floor(rawTotal) : 0
    const rows = Array.isArray((root as any)?.questions) ? (root as any).questions : Array.isArray((root as any)?.data) ? (root as any).data : []
    const items: ProblemItem[] = []
    for (const r of rows) {
      const slug = typeof r?.titleSlug === 'string' ? r.titleSlug.trim() : ''
      if (!isValidSlug(slug)) continue
      const url = buildProblemUrl(slug)
      if (!url) continue
      // Strict no-fake: rows with unknown difficulty are dropped (never
      // invented as Easy/Hard for badges — the UI renders the badge only
      // from this validated value).
      const strict = normalizeDifficulty(r?.difficulty)
      if (!strict) continue
      const title = typeof r?.title === 'string' && r.title.trim()
        ? r.title.trim().slice(0, 200)
        : slug
      const tags = Array.isArray(r?.topicTags)
        ? (r.topicTags as any[])
            .map((t) => (typeof t?.slug === 'string' && t.slug.trim() ? t.slug.trim().toLowerCase() : typeof t?.name === 'string' && t.name.trim() ? t.name.trim().toLowerCase().replace(/\s+/g, '-') : ''))
            .filter((s) => s && /^[a-z0-9-]+$/.test(s))
        : []
      items.push({ title, titleSlug: slug, difficulty: strict, topics: [...new Set(tags)].slice(0, 8), paidOnly: r?.paidOnly === true || (r as any)?.isPaidOnly === true, url })
    }
    return { items, total }
  } catch {
    return { items: [], total: 0 }
  }
}

// ---------------------------------------------------------------------------
// Cached loaders (I/O). Deps injectable for hermetic tests.
// ---------------------------------------------------------------------------

export interface ProblemsDeps {
  fetchFn?: typeof fetch
  now?: () => number
  store?: SourceHealthStore
  cacheBackend?: CacheBackend
  timeoutMs?: number
}

function depsCache(d: ProblemsDeps): CacheBackend {
  return d.cacheBackend ?? cache
}

/** First GraphQL error message, truncated — for honest logs/surfaced errors. */
function firstGraphqlError(json: unknown): string | null {
  try {
    const errs = (json as any)?.errors
    if (Array.isArray(errs) && errs.length > 0 && typeof errs[0]?.message === 'string') {
      const m = errs[0].message.trim()
      return m ? m.slice(0, 160) : null
    }
    return null
  } catch {
    return null
  }
}

function leetcodeQuery(body: unknown, timeoutMs: number, fetchFn: typeof fetch): Promise<{ ok: boolean; status: number; json: unknown }> {
  return (async () => {
    const resp = await fetchFn(LEETCODE_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'CampusFlow/1.0', Referer: 'https://leetcode.com' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    } as RequestInit)
    const status = (resp as Response).status ?? 0
    // Parse the body even on !ok so GraphQL `errors[]` (e.g. schema drift
    // like paidOnly→isPaidOnly) survives for logging + honest errors instead
    // of being swallowed as a bare HTTP status.
    let json: unknown = null
    try {
      json = (await (resp as Response).json()) as unknown
    } catch {
      json = null
    }
    if (!resp.ok) return { ok: false, status, json }
    return { ok: true, status, json }
  })()
}

export interface DailyCacheEntry {
  problem: NormalizedDaily
  cachedAt: string
}

export interface ListCacheEntry {
  items: ProblemItem[]
  total: number
  cachedAt: string
  paramsKey: string
}

export function listCacheKey(params: LiveListParams): string {
  const parts = [params.limit, params.skip, params.topic ?? '-', params.difficulty ?? '-', params.search ?? '-'].join('|')
  // Key-safe: base64url of the param tuple (no user text in raw key).
  const b64 = Buffer.from(parts).toString('base64url')
  return `${PROBLEMS_CACHE_PREFIX}:list:live:${b64}:v1`
}

export interface DailyResult {
  problem: DailyProblem | null
  stale: boolean
  cachedAt: string | null
  error?: string
}

/** Load daily challenge: fresh cache → upstream → stale cache → null. */
export async function loadDailyProblem(deps: ProblemsDeps = {}): Promise<DailyResult> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch
  const now = deps.now ?? Date.now
  const store = deps.store ?? sourceHealthStore
  const c = depsCache(deps)
  const timeoutMs = deps.timeoutMs ?? CODING_PROBLEMS_FETCH_TIMEOUT_MS

  let cached: DailyCacheEntry | null = null
  try {
    cached = await c.get<DailyCacheEntry>(DAILY_CACHE_KEY)
  } catch { cached = null }

  const fresh = cached && now() - new Date(cached.cachedAt).getTime() < CODING_PROBLEMS_DAILY_TTL_MS
  if (fresh && cached) {
    return { problem: { ...cached.problem, stale: false, cachedAt: cached.cachedAt }, stale: false, cachedAt: cached.cachedAt }
  }

  const started = now()
  try {
    const res = await leetcodeQuery(
      { query: DAILY_CHALLENGE_QUERY },
      timeoutMs,
      fetchFn,
    )
    const latencyMs = now() - started
    if (!res.ok) {
      const hint = firstGraphqlError(res.json)
      throw new Error(`LeetCode daily HTTP ${res.status}${hint ? `: ${hint}` : ''}`)
    }
    const norm = normalizeDailyResponse(res.json)
    if (!norm) {
      const hint = firstGraphqlError(res.json)
      throw new Error(`LeetCode daily payload missing titleSlug${hint ? `: ${hint}` : ''}`)
    }
    const entry: DailyCacheEntry = {
      problem: { ...norm },
      cachedAt: new Date(now()).toISOString(),
    }
    // Physical TTL >> freshness window so yesterday's row survives as stale
    // when the next-day revalidate blips (cache-first-then-revalidate).
    try { await c.set(DAILY_CACHE_KEY, entry, CODING_PROBLEMS_DAILY_STALE_TTL_MS) } catch { /* cache best-effort */ }
    try { await store.recordRun({ platform: DAILY_SOURCE, ok: true, latencyMs, fetchedCount: 1 }) } catch { /* health never fails load */ }
    return { problem: { ...entry.problem, stale: false, cachedAt: entry.cachedAt }, stale: false, cachedAt: entry.cachedAt }
  } catch (err) {
    const latencyMs = now() - started
    const rawMsg = String((err as any)?.message || err || 'unknown error').slice(0, 200)
    try { await store.recordRun({ platform: DAILY_SOURCE, ok: false, latencyMs, error: rawMsg }) } catch { /* never throw */ }
    logger.warn({ err: rawMsg }, '[coding-problems] daily upstream failed')
    if (cached) {
      return { problem: { ...cached.problem, stale: true, cachedAt: cached.cachedAt }, stale: true, cachedAt: cached.cachedAt }
    }
    // Honest surfaced reason (keeps the "unavailable" prefix the card
    // matches on, but preserves the upstream status/hint instead of
    // swallowing it as a bare "did not respond").
    const short = rawMsg.slice(0, 160)
    return { problem: null, stale: false, cachedAt: null, error: `Daily challenge unavailable — ${short}. Retry shortly.` }
  }
}

export interface LiveListResult {
  items: ProblemItem[]
  total: number
  stale: boolean
  cachedAt: string | null
  error?: string
}

/** Load live problemset page (single upstream call, 24h param-keyed cache). */
export async function loadLiveProblemList(
  params: LiveListParams & { gqlDifficulty: 'EASY' | 'MEDIUM' | 'HARD' | null },
  deps: ProblemsDeps = {},
): Promise<LiveListResult> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch
  const now = deps.now ?? Date.now
  const store = deps.store ?? sourceHealthStore
  const c = depsCache(deps)
  const timeoutMs = deps.timeoutMs ?? CODING_PROBLEMS_FETCH_TIMEOUT_MS
  const key = listCacheKey(params)

  let cached: ListCacheEntry | null = null
  try {
    cached = await c.get<ListCacheEntry>(key)
  } catch { cached = null }
  const fresh = cached && now() - new Date(cached.cachedAt).getTime() < CODING_PROBLEMS_LIST_TTL_MS
  if (fresh && cached) {
    return { items: cached.items, total: cached.total, stale: false, cachedAt: cached.cachedAt }
  }

  const started = now()
  try {
    const variables = buildProblemsetV2Variables(params)
    const res = await leetcodeQuery(
      { query: PROBLEMSET_V2_QUERY, variables },
      timeoutMs,
      fetchFn,
    )
    const latencyMs = now() - started
    if (!res.ok) {
      const hint = firstGraphqlError(res.json)
      throw new Error(`LeetCode problemset HTTP ${res.status}${hint ? `: ${hint}` : ''}`)
    }
    // 200 with errors[] + data:null happens when upstream refuses the call
    // (e.g. the auth-gated searchKeyword path) — that is a failure, not an
    // empty catalog (returning [] silently would fake "no matches").
    const raw = res.json as any
    const listRoot = raw?.data?.problemsetQuestionListV2 ?? raw?.data?.problemsetQuestionList
    if (!listRoot || typeof listRoot !== 'object') {
      const hint = firstGraphqlError(res.json)
      throw new Error(`LeetCode problemset payload missing list${hint ? `: ${hint}` : ''}`)
    }
    const shaped = { data: { problemsetQuestionListV2: listRoot } }
    const { items: fetched, total: upstreamTotal } = normalizeProblemsetQuestions(shaped)
    // `search` is post-filtered in-memory on the fetched page: V2
    // searchKeyword needs LeetCode login, so it is never sent upstream.
    // Page-scoped semantics (documented): skip/limit apply upstream, then
    // the substring match narrows the returned page — same match rule as
    // the curated pool (`title + slug` substring, case-insensitive).
    let items = fetched
    let total = upstreamTotal
    const needle = (params.search || '').trim().toLowerCase()
    if (needle) {
      items = fetched.filter((p) => `${p.title} ${p.titleSlug}`.toLowerCase().includes(needle))
      total = items.length
    }
    const entry: ListCacheEntry = { items, total, cachedAt: new Date(now()).toISOString(), paramsKey: key }
    // Physical TTL >> freshness window so the previous page survives as
    // stale when the next-day revalidate blips (same pattern as daily).
    try { await c.set(key, entry, CODING_PROBLEMS_LIST_STALE_TTL_MS) } catch { /* best-effort */ }
    try { await store.recordRun({ platform: LIST_SOURCE, ok: true, latencyMs, fetchedCount: items.length }) } catch { /* never throw */ }
    return { items, total, stale: false, cachedAt: entry.cachedAt }
  } catch (err) {
    const latencyMs = now() - started
    const rawMsg = String((err as any)?.message || err || 'unknown error').slice(0, 200)
    try { await store.recordRun({ platform: LIST_SOURCE, ok: false, latencyMs, error: rawMsg }) } catch { /* never throw */ }
    logger.warn({ err: rawMsg }, '[coding-problems] problemset upstream failed')
    if (cached) {
      return { items: cached.items, total: cached.total, stale: true, cachedAt: cached.cachedAt }
    }
    // Honest surfaced reason (keeps the "unavailable" prefix the list UI
    // matches on, but preserves the upstream status/hint instead of
    // swallowing it — same pattern as the daily fix).
    const short = rawMsg.slice(0, 160)
    return { items: [], total: 0, stale: false, cachedAt: null, error: `Live catalog unavailable — ${short}. Browse the curated list or retry shortly.` }
  }
}

// ---------------------------------------------------------------------------
// Codeforces live browser (plan §2 — official problemset.problems API).
// Single GET, 12h FULL-catalog server cache, in-memory tag + rating-band
// filter, sort by rating/solvedCount, 1req/2s upstream guard.
// ---------------------------------------------------------------------------

/** Official public Codeforces catalog (no auth). */
export const CODEFORCES_API_URL = 'https://codeforces.com/api/problemset.problems'
/** Upstream timeout (same tail budget as LeetCode). */
export const CODEFORCES_FETCH_TIMEOUT_MS = 12_000
/** Server cache: CF catalog moves slowly; 12h single-key (full catalog). */
export const CODEFORCES_LIST_TTL_MS = 12 * 60 * 60 * 1000
/** Community limit: ~1 req/2s — guard upstream calls, serve stale instead. */
export const CODEFORCES_MIN_INTERVAL_MS = 2000
/** SourceHealth platform key (normalized UPPERCASE at record time). */
export const CODEFORCES_SOURCE = 'CODEFORCES_PROBLEMS'
export const CODEFORCES_CACHE_KEY = `${PROBLEMS_CACHE_PREFIX}:codeforces:v1`
export const CODEFORCES_LAST_FETCH_KEY = `${PROBLEMS_CACHE_PREFIX}:codeforces:lastFetchAt:v1`

export interface CfProblemItem {
  contestId: number
  index: string
  name: string
  rating: number | null
  tags: string[]
  solvedCount: number
  url: string
}

export interface CfListParams {
  tags: string[]
  minRating: number | null
  maxRating: number | null
  sort: 'rating' | 'solvedCount' | null
  order: 'asc' | 'desc'
  limit: number
  skip: number
}

const CF_INDEX_RE = /^[A-Z][0-9]?$/
const CF_TAG_RE = /^[a-z0-9][a-z0-9 #+\-]*$/

/** Real Codeforces problem URL — null when id/index are not a real shape. */
export function buildCodeforcesUrl(contestId: unknown, index: unknown): string | null {
  if (typeof contestId !== 'number' || !Number.isInteger(contestId) || contestId <= 0) return null
  if (typeof index !== 'string' || !CF_INDEX_RE.test(index)) return null
  return `https://codeforces.com/problemset/problem/${contestId}/${index}`
}

function parseCfRating(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseInt(String(v), 10)
  if (!Number.isInteger(n)) return null
  return n
}

/** Sanitize CF list query (throws 400-style Error on invalid band/sort/tags). Pure. */
export function buildCodeforcesParams(raw: {
  tags?: unknown
  minRating?: unknown
  maxRating?: unknown
  sort?: unknown
  order?: unknown
  limit?: unknown
  skip?: unknown
}): CfListParams {
  // Tags: "dp;math, greedy" → ["dp","math","greedy"] (AND semantics downstream).
  let tags: string[] = []
  if (raw.tags != null && String(raw.tags).trim() !== '') {
    const parts = Array.isArray(raw.tags) ? raw.tags : String(raw.tags).split(/[;,]/)
    const seen = new Set<string>()
    for (const part of parts) {
      const t = String(part || '').trim().toLowerCase()
      if (!t) continue
      if (t.length > 40 || !CF_TAG_RE.test(t)) throw new Error(`Invalid tag: ${String(part).slice(0, 40)}`)
      if (!seen.has(t)) {
        seen.add(t)
        tags.push(t)
      }
    }
    if (tags.length > 5) throw new Error('Too many tags (max 5)')
  }

  const minRating = parseCfRating(raw.minRating)
  const maxRating = parseCfRating(raw.maxRating)
  for (const [label, v] of [['minRating', minRating], ['maxRating', maxRating]] as const) {
    if (v != null && (v < 500 || v > 4000)) throw new Error(`Invalid ${label} (500-4000)`)
  }
  if (minRating != null && maxRating != null && minRating > maxRating) {
    throw new Error('Invalid rating band (minRating > maxRating)')
  }

  const sortRaw = raw.sort != null && String(raw.sort).trim() !== '' ? String(raw.sort).trim() : 'solvedCount'
  if (sortRaw !== 'rating' && sortRaw !== 'solvedCount') throw new Error('Invalid sort. Allowed: rating, solvedCount')
  const orderRaw = raw.order != null && String(raw.order).trim() !== '' ? String(raw.order).trim().toLowerCase() : 'desc'
  if (orderRaw !== 'asc' && orderRaw !== 'desc') throw new Error('Invalid order. Allowed: asc, desc')

  const rawLimit = parseInt(String((raw as any).limit ?? '50'), 10)
  const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, rawLimit)) : 50
  const rawSkip = parseInt(String((raw as any).skip ?? '0'), 10)
  const skip = Number.isFinite(rawSkip) ? Math.max(0, rawSkip) : 0

  return { tags, minRating, maxRating, sort: sortRaw as CfListParams['sort'], order: orderRaw as CfListParams['order'], limit, skip }
}

/** Parse problemset.problems payload, join ProblemStatistics. Drops id-less rows (no-fake). */
export function normalizeCodeforcesResponse(json: unknown): { items: CfProblemItem[]; total: number } {
  try {
    const root = json as any
    if (!root || root.status !== 'OK' || typeof root.result !== 'object' || !root.result) {
      return { items: [], total: 0 }
    }
    const problems = Array.isArray(root.result.problems) ? root.result.problems : []
    const stats = Array.isArray(root.result.problemStatistics) ? root.result.problemStatistics : []
    const solved = new Map<string, number>()
    for (const s of stats) {
      const cid = (s as any)?.contestId
      const idx = (s as any)?.index
      if (!Number.isInteger(cid) || cid <= 0 || typeof idx !== 'string') continue
      const n = Number((s as any)?.solvedCount)
      solved.set(`${cid}-${idx}`, Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0)
    }
    const items: CfProblemItem[] = []
    for (const r of problems) {
      const contestId = (r as any)?.contestId
      const index = (r as any)?.index
      const nameRaw = (r as any)?.name
      if (!Number.isInteger(contestId) || contestId <= 0) continue
      if (typeof index !== 'string' || !CF_INDEX_RE.test(index)) continue
      if (typeof nameRaw !== 'string' || !nameRaw.trim()) continue
      const url = buildCodeforcesUrl(contestId, index)
      if (!url) continue
      const name = nameRaw.trim().slice(0, 200)
      const ratingRaw = (r as any)?.rating
      const rating = Number.isInteger(ratingRaw) && ratingRaw >= 500 && ratingRaw <= 4000 ? ratingRaw : null
      const rawTags = Array.isArray((r as any)?.tags) ? (r as any).tags : []
      const tagSet = new Set<string>()
      for (const t of rawTags) {
        const s = String(t || '').trim().toLowerCase()
        if (s && s.length <= 40 && CF_TAG_RE.test(s) && !tagSet.has(s)) tagSet.add(s)
      }
      const key = `${contestId}-${index}`
      items.push({ contestId, index, name, rating, tags: [...tagSet].slice(0, 8), solvedCount: solved.get(key) ?? 0, url })
    }
    return { items, total: items.length }
  } catch {
    return { items: [], total: 0 }
  }
}

/** In-memory tag (AND) + rating-band filter, sort, paginate. Pure. */
export function filterAndSortCfProblems(
  catalog: ReadonlyArray<CfProblemItem>,
  params: CfListParams,
): { items: CfProblemItem[]; total: number } {
  const bandActive = params.minRating != null || params.maxRating != null
  let out = catalog.filter((p) => {
    if (params.tags.length > 0) {
      const set = new Set(p.tags.map((t) => t.toLowerCase()))
      for (const need of params.tags) if (!set.has(need.toLowerCase())) return false
    }
    if (bandActive) {
      if (p.rating == null) return false // no-fake: unrated never guessed into a band
      if (params.minRating != null && p.rating < params.minRating) return false
      if (params.maxRating != null && p.rating > params.maxRating) return false
    }
    return true
  })
  const sortKey = params.sort ?? 'solvedCount'
  const dir = params.order === 'asc' ? 1 : -1
  out = [...out].sort((a, b) => {
    if (sortKey === 'rating') {
      if (a.rating == null && b.rating == null) return b.solvedCount - a.solvedCount
      if (a.rating == null) return 1 // nulls always last
      if (b.rating == null) return -1
      if (a.rating !== b.rating) return (a.rating - b.rating) * dir
      return b.solvedCount - a.solvedCount
    }
    if (a.solvedCount !== b.solvedCount) return (a.solvedCount - b.solvedCount) * dir
    return (a.rating ?? -1) - (b.rating ?? -1)
  })
  const total = out.length
  return { items: out.slice(params.skip, params.skip + params.limit), total }
}

export interface CfCacheEntry {
  items: CfProblemItem[]
  total: number
  cachedAt: string
}

export interface CfLiveResult {
  items: CfProblemItem[]
  total: number
  stale: boolean
  cachedAt: string | null
  error?: string
  rateLimited?: boolean
}

function cfFetch(timeoutMs: number, fetchFn: typeof fetch): Promise<{ ok: boolean; status: number; json: unknown }> {
  return (async () => {
    const resp = await fetchFn(CODEFORCES_API_URL, {
      method: 'GET',
      headers: { 'User-Agent': 'CampusFlow/1.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    } as RequestInit)
    const status = (resp as Response).status ?? 0
    if (!resp.ok) return { ok: false, status, json: null }
    try {
      const json = (await (resp as Response).json()) as unknown
      return { ok: true, status, json }
    } catch {
      return { ok: false, status, json: null }
    }
  })()
}

/** Load CF catalog: fresh cache → upstream (2s-guarded) → stale cache → honest error. */
export async function loadCodeforcesProblems(
  params: CfListParams,
  deps: ProblemsDeps = {},
): Promise<CfLiveResult> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch
  const now = deps.now ?? Date.now
  const store = deps.store ?? sourceHealthStore
  const c = depsCache(deps)
  const timeoutMs = deps.timeoutMs ?? CODEFORCES_FETCH_TIMEOUT_MS

  let cached: CfCacheEntry | null = null
  try {
    cached = await c.get<CfCacheEntry>(CODEFORCES_CACHE_KEY)
  } catch { cached = null }

  const fresh = cached && now() - new Date(cached.cachedAt).getTime() < CODEFORCES_LIST_TTL_MS
  if (fresh && cached) {
    const page = filterAndSortCfProblems(cached.items, params)
    return { items: page.items, total: page.total, stale: false, cachedAt: cached.cachedAt }
  }

  // 1req/2s guard (shared via cache backend so N instances share the budget).
  try {
    const last = await c.get<number>(CODEFORCES_LAST_FETCH_KEY)
    if (typeof last === 'number' && Number.isFinite(last) && now() - last < CODEFORCES_MIN_INTERVAL_MS) {
      if (cached) {
        const page = filterAndSortCfProblems(cached.items, params)
        return { items: page.items, total: page.total, stale: true, cachedAt: cached.cachedAt, rateLimited: true }
      }
      return { items: [], total: 0, stale: false, cachedAt: null, error: 'Codeforces is rate-limiting — retry in a couple of seconds.', rateLimited: true }
    }
  } catch { /* guard best-effort — fall through to fetch */ }
  try { await c.set(CODEFORCES_LAST_FETCH_KEY, now(), CODEFORCES_MIN_INTERVAL_MS * 30) } catch { /* best-effort */ }

  const started = now()
  try {
    const res = await cfFetch(timeoutMs, fetchFn)
    const latencyMs = now() - started
    if (!res.ok) throw new Error(`Codeforces HTTP ${res.status}`)
    if ((res.json as any)?.status !== 'OK') throw new Error('Codeforces API FAILED')
    const { items, total } = normalizeCodeforcesResponse(res.json)
    const entry: CfCacheEntry = { items, total, cachedAt: new Date(now()).toISOString() }
    try { await c.set(CODEFORCES_CACHE_KEY, entry, CODEFORCES_LIST_TTL_MS) } catch { /* best-effort */ }
    try { await store.recordRun({ platform: CODEFORCES_SOURCE, ok: true, latencyMs, fetchedCount: items.length }) } catch { /* never throw */ }
    const page = filterAndSortCfProblems(items, params)
    return { items: page.items, total: page.total, stale: false, cachedAt: entry.cachedAt }
  } catch (err) {
    const latencyMs = now() - started
    try { await store.recordRun({ platform: CODEFORCES_SOURCE, ok: false, latencyMs, error: String((err as any)?.message || err).slice(0, 200) }) } catch { /* never throw */ }
    logger.warn({ err: (err as any)?.message || err }, '[coding-problems] codeforces upstream failed')
    if (cached) {
      const page = filterAndSortCfProblems(cached.items, params)
      return { items: page.items, total: page.total, stale: true, cachedAt: cached.cachedAt }
    }
    return { items: [], total: 0, stale: false, cachedAt: null, error: 'Live Codeforces catalog unavailable — retry shortly.' }
  }
}
