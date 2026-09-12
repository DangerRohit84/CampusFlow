// lib/codingProblems.ts — Problems-tab helpers (pure, unit-tested).
// WHY: the 4th CodingProfile tab ("Problems") answers "what do I solve
// next?" from the LeetCode daily + curated pool (GET /coding-problems/*).
// This file owns ONLY client-side logic: localStorage marks (v1),
// difficulty-split recommendations with why-labels, explore filtering, URL
// filter sync, and trivial analytics (plausible/gtag when present, no-op
// otherwise). No fetching here (see codingProfileAPI.getDailyProblem /
// getProblemsList in lib/api/resources/profile.ts). No fakes: recommend
// picks real pool rows; empty pool → [] (caller renders honest empty state).

export type ProblemDifficulty = 'Easy' | 'Medium' | 'Hard'

export interface ProblemItem {
  title: string
  titleSlug: string
  difficulty: ProblemDifficulty
  topics: string[]
  paidOnly?: boolean
  url: string
}

export interface LcSplit {
  easySolved?: number | null
  mediumSolved?: number | null
  hardSolved?: number | null
}

export interface RecommendedProblem {
  item: ProblemItem
  why: string
}

// --- localStorage marks (v1) ----------------------------------------------

export const PROBLEMS_MARKS_KEY = 'cf-problems-marks-v1'

export interface ProblemMarks {
  solved: string[]
  starred: string[]
}

function normalizeSlugList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const s of v) {
    if (typeof s !== 'string') continue
    const t = s.trim()
    if (!t || !/^[a-z0-9-]+$/.test(t) || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/** Read marks (never throws — corrupted storage → empty). */
export function loadProblemMarks(): ProblemMarks {
  try {
    const raw = localStorage.getItem(PROBLEMS_MARKS_KEY)
    if (!raw) return { solved: [], starred: [] }
    const p = JSON.parse(raw) as Partial<ProblemMarks>
    return { solved: normalizeSlugList(p.solved), starred: normalizeSlugList(p.starred) }
  } catch {
    return { solved: [], starred: [] }
  }
}

function saveProblemMarks(m: ProblemMarks): void {
  try {
    localStorage.setItem(PROBLEMS_MARKS_KEY, JSON.stringify({ solved: m.solved, starred: m.starred }))
  } catch {
    /* private-mode — marks still work in-memory for the session */
  }
}

export function toggleSolvedMark(slug: string, current?: ProblemMarks): ProblemMarks {
  const m = current ?? loadProblemMarks()
  const set = new Set(m.solved)
  if (set.has(slug)) set.delete(slug)
  else set.add(slug)
  const next = { solved: [...set], starred: m.starred }
  saveProblemMarks(next)
  return next
}

export function toggleStarredMark(slug: string, current?: ProblemMarks): ProblemMarks {
  const m = current ?? loadProblemMarks()
  const set = new Set(m.starred)
  if (set.has(slug)) set.delete(slug)
  else set.add(slug)
  const next = { solved: m.solved, starred: [...set] }
  saveProblemMarks(next)
  return next
}

// --- recommendation heuristic ----------------------------------------------
// One pick per difficulty band (Easy/Medium/Hard), skipping locally-solved
// rows so the shelf stays actionable. Why-labels reference the user's real
// LeetCode easy/med/hard split when available, else honest generic labels.

function num(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null
}

function whyFor(d: ProblemDifficulty, stat: LcSplit | null): string {
  const e = stat ? num(stat.easySolved) : null
  const m = stat ? num(stat.mediumSolved) : null
  const h = stat ? num(stat.hardSolved) : null
  if (e == null && m == null && h == null) {
    return d === 'Easy' ? 'Warm-up · fundamentals' : d === 'Medium' ? 'Core interview pattern' : 'Stretch goal'
  }
  if (d === 'Easy') return e != null && e < 30 ? `Build foundations — ${e} easy solved` : 'Warm-up · keep the streak alive'
  if (d === 'Medium') return m != null && m < 50 ? `Core interviews are Medium — ${m} solved` : `Push into Mediums — ${m ?? 0} solved`
  return h != null && h < 10 ? `Stretch rating — ${h} hard solved` : `Hard target — ${h ?? 0} solved`
}

/** Pick ≤3 recommendations (one per band, unsolved-first). Pure. */
export function recommendProblems(
  pool: ReadonlyArray<ProblemItem>,
  stat: LcSplit | null,
  solved?: ReadonlySet<string> | ReadonlyArray<string>,
): RecommendedProblem[] {
  const solvedSet = new Set<string>(Array.isArray(solved) ? solved : (solved ?? []))
  const out: RecommendedProblem[] = []
  for (const d of ['Easy', 'Medium', 'Hard'] as const) {
    const band = pool.filter((p) => p.difficulty === d && p.titleSlug && p.url)
    if (band.length === 0) continue
    const pick = band.find((p) => !solvedSet.has(p.titleSlug)) ?? band[0]
    out.push({ item: pick, why: whyFor(d, stat) })
  }
  return out
}

// --- explore filtering -------------------------------------------------------

export interface ProblemFilter {
  topic: string // '' = all
  difficulty: string // '' = all, else Easy|Medium|Hard
  query: string // free text over title/slug
  hideSolved: boolean
}

/** Default (unfiltered) explore state. */
export const DEFAULT_PROBLEM_FILTER: ProblemFilter = { topic: '', difficulty: '', query: '', hideSolved: false }

/** Pure explore filter (URL-synced state in, visible rows out). */
export function filterProblems(
  items: ReadonlyArray<ProblemItem>,
  f: ProblemFilter,
  solved?: ReadonlySet<string> | ReadonlyArray<string>,
): ProblemItem[] {
  const solvedSet = new Set<string>(Array.isArray(solved) ? solved : (solved ?? []))
  const q = f.query.trim().toLowerCase()
  return items.filter((p) => {
    if (f.difficulty && p.difficulty !== f.difficulty) return false
    if (f.topic && !p.topics.some((t) => t.toLowerCase() === f.topic.toLowerCase())) return false
    if (q && !(`${p.title} ${p.titleSlug}`.toLowerCase().includes(q))) return false
    if (f.hideSolved && solvedSet.has(p.titleSlug)) return false
    return true
  })
}

/** Sorted unique topics for the filter dropdown. */
export function collectTopics(items: ReadonlyArray<ProblemItem>): string[] {
  const set = new Set<string>()
  for (const p of items) for (const t of p.topics || []) {
    const s = String(t || '').trim().toLowerCase()
    if (s) set.add(s)
  }
  return [...set].sort()
}

// --- URL sync (filters survive share/reload) ----------------------------------

const URL_KEYS = { topic: 'problemsTopic', difficulty: 'problemsDifficulty', query: 'problemsQ' } as const

/** Parse ?problemsTopic=&problemsDifficulty=&problemsQ= (hermetic: takes search). */
export function parseProblemFilters(search: string): Pick<ProblemFilter, 'topic' | 'difficulty' | 'query'> {
  try {
    const sp = new URLSearchParams(search.startsWith('?') ? search : `?${search}`)
    const topicRaw = (sp.get(URL_KEYS.topic) || '').trim().toLowerCase()
    const topic = topicRaw && /^[a-z0-9-]+$/.test(topicRaw) ? topicRaw : ''
    const diffRaw = (sp.get(URL_KEYS.difficulty) || '').trim().toLowerCase()
    const difficulty = diffRaw === 'easy' ? 'Easy' : diffRaw === 'medium' ? 'Medium' : diffRaw === 'hard' ? 'Hard' : ''
    const query = (sp.get(URL_KEYS.query) || '').trim().slice(0, 100)
    return { topic, difficulty, query }
  } catch {
    return { topic: '', difficulty: '', query: '' }
  }
}

/** Build the ?... suffix for the current filters (omits empties). */
export function buildProblemFilterSearch(f: Pick<ProblemFilter, 'topic' | 'difficulty' | 'query'>): string {
  const sp = new URLSearchParams()
  if (f.topic) sp.set(URL_KEYS.topic, f.topic)
  if (f.difficulty) sp.set(URL_KEYS.difficulty, f.difficulty)
  if (f.query.trim()) sp.set(URL_KEYS.query, f.query.trim())
  const s = sp.toString()
  return s ? `?${s}` : ''
}

/** Push filter state to the address bar without navigating (best-effort). */
export function writeProblemFiltersToUrl(f: Pick<ProblemFilter, 'topic' | 'difficulty' | 'query'>): void {
  try {
    const suffix = buildProblemFilterSearch(f)
    const base = window.location.pathname
    const other = new URLSearchParams(window.location.search)
    for (const k of Object.values(URL_KEYS)) other.delete(k)
    const rest = other.toString()
    const next = `${base}${suffix ? `${suffix}${rest ? `&${rest}` : ''}` : rest ? `?${rest}` : ''}${window.location.hash || ''}`
    window.history.replaceState(null, '', next)
  } catch {
    /* non-browser / restricted — filters still work in-memory */
  }
}

// --- trivial analytics (impression/click/mark; skip when absent) ---------------

/** Fire-and-forget problems event (plausible/gtag when loaded, else no-op). */
export function trackProblemsEvent(name: 'impression' | 'click' | 'mark', props?: Record<string, unknown>): void {
  try {
    const w = window as unknown as {
      plausible?: (...args: unknown[]) => void
      gtag?: (...args: unknown[]) => void
    }
    if (typeof w.plausible === 'function') {
      try { w.plausible(`problems:${name}`, { props }) } catch { /* ignore */ }
    }
    if (typeof w.gtag === 'function') {
      try { w.gtag('event', `problems_${name}`, props ?? {}) } catch { /* ignore */ }
    }
  } catch {
    /* analytics must never break the tab */
  }
}

// --- Codeforces browser helpers (plan §2, pure) --------------------------------
// WHY: the Problems tab Codeforces section needs rating-band + tag + sort
// query building without inventing ratings/counts. All filtering/sorting
// happens server-side (GET /coding-problems/codeforces); these helpers only
// shape the query + display counts honestly.

export interface CfProblemItem {
  contestId: number
  index: string
  name: string
  rating: number | null
  tags: string[]
  solvedCount: number
  url: string
}

export interface CfRatingBand {
  label: string
  min: number | null
  max: number | null
}

/** Rating bands for the CF filter (All + 800-start bands, CF-style). */
export const CF_RATING_BANDS: ReadonlyArray<CfRatingBand> = [
  { label: 'All', min: null, max: null },
  { label: '800–1100', min: 800, max: 1100 },
  { label: '1200–1500', min: 1200, max: 1500 },
  { label: '1600–1900', min: 1600, max: 1900 },
  { label: '2000+', min: 2000, max: null },
]

export interface CfQueryInput {
  tags: string[]
  bandIndex: number
  sort: string
  order: string
  limit: number
}

/** Build GET /coding-problems/codeforces params (omits empties). Pure. */
export function buildCfQuery(input: CfQueryInput): {
  tags?: string
  minRating?: number
  maxRating?: number
  sort: string
  order: string
  limit: number
} {
  const tags = (input.tags || [])
    .map((t) => String(t || '').trim().toLowerCase())
    .filter((t) => t && /^[a-z0-9][a-z0-9 #+\-]*$/.test(t))
    .slice(0, 5)
  const band = CF_RATING_BANDS[input.bandIndex] ?? CF_RATING_BANDS[0]
  const out: { tags?: string; minRating?: number; maxRating?: number; sort: string; order: string; limit: number } = {
    sort: input.sort || 'solvedCount',
    order: input.order === 'asc' ? 'asc' : 'desc',
    limit: Number.isFinite(input.limit) ? Math.min(200, Math.max(1, Math.floor(input.limit))) : 50,
  }
  if (tags.length > 0) out.tags = tags.join(';')
  if (band.min != null) out.minRating = band.min
  if (band.max != null) out.maxRating = band.max
  return out
}

/** Honest solved-count display (0 for bad input, never invents). */
export function formatSolvedCount(n: unknown): string {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : 0
  if (v <= 0) return '0'
  if (v < 1000) return String(v)
  return `${(v / 1000).toFixed(1)}k`
}

/** Stable React key for a CF row. */
export function cfProblemKey(p: Pick<CfProblemItem, 'contestId' | 'index'>): string {
  return `${p.contestId}-${p.index}`
}
