// components/coding/ProblemsTab.tsx — Problems-to-Solve (CodingProfile tab).
// WHY: totals/history never answered "what do I solve next?". This tab shows:
//   LeetCode: Daily card (GET /coding-problems/daily, stale badge + retry) +
//   Recommended shelf (difficulty-split heuristic from the user's real LC
//   easy/med/hard + why-labels, unsolved-first) + Explore (curated pool with
//   topic/difficulty/search filters, URL-synced, mobile-collapsible) +
//   Mark Solved/Star (localStorage v1 only — no auto-verify, no fake solves).
//   Codeforces: live browser (GET /coding-problems/codeforces, 12h server
//   cache, tag pills + rating-band filter + rating/solvedCount sort,
//   stale badge + retry, real codeforces.com links only).
//   Sheets: static DSA tracks (GET /coding-problems/sheets, Striver A2Z /
//   SDE + NeetCode 150 titles+links only, track selector + step accordions +
//   manual checkmarks with per-step/per-track bars, device-only v1).
//   Links: static CodeChef/HackerRank/GFG/AtCoder cards (plan §4 — no live
//   catalog, browse-there-track-manually notice, no backend).
// Rate-safe: LeetCode does exactly 2 calls per mount (daily + curated list in
// one parallel round); CF lazy-fetches once when its tab opens (server 12h
// cache + 20req/10s route limiter absorb filter changes); Sheets does 1 GET
// when its tab opens (24h HTTP-cached static). Every row links out
// via a real URL; bad rows are dropped service-side and re-filtered client-side.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, RefreshCw, Loader2, Star, CheckCircle2, CalendarDays, Sparkles, SlidersHorizontal, ChevronDown } from 'lucide-react'
import { api } from '../../lib/api/client'
import { codingProfileAPI } from '../../lib/api/resources/profile'
import SheetsTab from './SheetsTab'
import LinksTab from './LinksTab'
import {
  CF_RATING_BANDS,
  DEFAULT_PROBLEM_FILTER,
  buildCfQuery,
  buildProblemFilterSearch,
  cfProblemKey,
  collectTopics,
  filterProblems,
  formatSolvedCount,
  loadProblemMarks,
  parseProblemFilters,
  recommendProblems,
  toggleSolvedMark,
  toggleStarredMark,
  trackProblemsEvent,
  writeProblemFiltersToUrl,
  type CfProblemItem,
  type LcSplit,
  type ProblemDifficulty,
  type ProblemFilter,
  type ProblemItem,
  type ProblemMarks,
} from '../../lib/codingProblems'

interface DailyPayload {
  title: string
  titleSlug: string
  url: string
  difficulty: ProblemDifficulty | null
  date: string | null
  questionId: string | null
  paidOnly?: boolean
}

const DIFF_STYLE: Record<string, string> = {
  Easy: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/20',
  Medium: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/20',
  Hard: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/20',
}

function DifficultyBadge({ d }: { d: ProblemDifficulty | null | undefined }) {
  if (!d) return <span className="text-[10px] text-surface-400 dark:text-night-400">—</span>
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${DIFF_STYLE[d]}`}>
      {d}
    </span>
  )
}

function PaidBadge() {
  return (
    <span title="LeetCode Premium" className="inline-flex items-center rounded-full border border-purple-200 dark:border-purple-500/30 bg-purple-50 dark:bg-purple-500/10 px-2 py-0.5 text-[10px] font-semibold text-purple-700 dark:text-purple-300">
      Premium
    </span>
  )
}

// --- Codeforces browser (plan §2) --------------------------------------------
// Popular CF tags for pills (stable list — server holds the full catalog).

const POPULAR_CF_TAGS = [
  'dp',
  'math',
  'greedy',
  'implementation',
  'data structures',
  'brute force',
  'graphs',
  'strings',
  'binary search',
  'two pointers',
  'sorting',
  'trees',
] as const

function cfRatingStyle(rating: number | null): string {
  if (rating == null) return 'border-surface-200 dark:border-night-600 text-surface-400 dark:text-night-400'
  if (rating < 1200) return 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/20'
  if (rating < 1600) return 'bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-500/20'
  if (rating < 2000) return 'bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-500/20'
  return 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/20'
}

function CfRatingBadge({ rating }: { rating: number | null }) {
  if (rating == null) return <span className="text-[10px] text-surface-400 dark:text-night-400">unrated</span>
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cfRatingStyle(rating)}`}>
      {rating}
    </span>
  )
}

function MarkButtons({ slug, marks, onToggleSolved, onToggleStar }: {
  slug: string
  marks: ProblemMarks
  onToggleSolved: (slug: string) => void
  onToggleStar: (slug: string) => void
}) {
  const solved = marks.solved.includes(slug)
  const starred = marks.starred.includes(slug)
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => onToggleSolved(slug)}
        aria-pressed={solved}
        title={solved ? 'Mark unsolved' : 'Mark solved (saved on this device)'}
        className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors ${
          solved
            ? 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            : 'border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-500 dark:text-night-300 hover:text-emerald-600 dark:hover:text-emerald-300'
        }`}
      >
        <CheckCircle2 size={12} /> {solved ? 'Solved' : 'Solve'}
      </button>
      <button
        onClick={() => onToggleStar(slug)}
        aria-pressed={starred}
        aria-label={starred ? 'Unstar problem' : 'Star problem'}
        title={starred ? 'Unstar' : 'Star (saved on this device)'}
        className={`rounded-lg border p-1.5 transition-colors ${
          starred
            ? 'border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 text-amber-500'
            : 'border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-400 dark:text-night-400 hover:text-amber-500'
        }`}
      >
        <Star size={12} fill={starred ? 'currentColor' : 'none'} />
      </button>
    </div>
  )
}

export default function ProblemsTab({ lcStat }: { lcStat: LcSplit | null }) {
  const [platform, setPlatform] = useState<'leetcode' | 'codeforces' | 'sheets' | 'links'>('leetcode')
  const [daily, setDaily] = useState<DailyPayload | null>(null)
  const [dailyStale, setDailyStale] = useState(false)
  const [dailyCachedAt, setDailyCachedAt] = useState<string | null>(null)
  const [dailyError, setDailyError] = useState<string | null>(null)
  const [items, setItems] = useState<ProblemItem[]>([])
  const [listSource, setListSource] = useState<'curated' | 'live'>('curated')
  const [listError, setListError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)
  // Codeforces live browser (lazy — fetches only when its tab opens).
  const [cfItems, setCfItems] = useState<CfProblemItem[]>([])
  const [cfTotal, setCfTotal] = useState(0)
  const [cfStale, setCfStale] = useState(false)
  const [cfCachedAt, setCfCachedAt] = useState<string | null>(null)
  const [cfError, setCfError] = useState<string | null>(null)
  const [cfLoading, setCfLoading] = useState(false)
  const [cfRetrying, setCfRetrying] = useState(false)
  const [cfTags, setCfTags] = useState<string[]>([])
  const [cfBand, setCfBand] = useState(0)
  const [cfSort, setCfSort] = useState<'rating' | 'solvedCount'>('solvedCount')
  const [cfOrder, setCfOrder] = useState<'asc' | 'desc'>('desc')
  const [cfLoaded, setCfLoaded] = useState(false)
  const [marks, setMarks] = useState<ProblemMarks>(() => loadProblemMarks())
  const [showFilters, setShowFilters] = useState(false)
  const [filter, setFilter] = useState<ProblemFilter>(() => {
    try {
      const p = parseProblemFilters(window.location.search)
      return { ...DEFAULT_PROBLEM_FILTER, ...p }
    } catch {
      return { ...DEFAULT_PROBLEM_FILTER }
    }
  })
  const epoch = useRef(0)
  const cfEpoch = useRef(0)
  const impressionSent = useRef(false)

  // Codeforces loader — single GET per filter change (12h server cache +
  // 20req/10s limiter absorb bursts). Epoch-guarded against race.
  const loadCf = async (isRetry = false) => {
    const gen = ++cfEpoch.current
    if (isRetry) setCfRetrying(true)
    else setCfLoading(true)
    setCfError(null)
    try {
      const params = buildCfQuery({ tags: cfTags, bandIndex: cfBand, sort: cfSort, order: cfOrder, limit: 50 })
      const res = await api.get('/coding-problems/codeforces', { params }).then((r) => r.data)
      if (gen !== cfEpoch.current) return
      const rows = Array.isArray(res?.items) ? res.items : []
      // Client no-fake guard (service already drops): real CF links only.
      const clean = (rows as unknown[]).filter((r: any) =>
        typeof r?.contestId === 'number' && Number.isInteger(r.contestId) && r.contestId > 0 &&
        typeof r?.index === 'string' && /^[A-Z][0-9]?$/.test(r.index) &&
        typeof r?.url === 'string' && r.url.includes(`/problem/${r.contestId}/${r.index}`),
      ) as CfProblemItem[]
      setCfItems(clean)
      setCfTotal(typeof res?.total === 'number' ? res.total : clean.length)
      setCfStale(!!res?.stale)
      setCfCachedAt(res?.cachedAt ?? null)
      setCfLoaded(true)
      if (clean.length === 0 && !res?.error) setCfError('No Codeforces problems match these filters — try clearing them.')
      else if (res?.error && clean.length === 0) setCfError(res.error)
    } catch (e: any) {
      if (gen !== cfEpoch.current) return
      setCfItems([])
      setCfTotal(0)
      setCfError(e?.response?.data?.error || 'Codeforces catalog unavailable — retry shortly.')
    } finally {
      if (gen === cfEpoch.current) {
        setCfLoading(false)
        setCfRetrying(false)
      }
    }
  }

  const load = async (isRetry = false) => {
    const gen = ++epoch.current
    if (isRetry) setRetrying(true)
    else setLoading(true)
    setDailyError(null)
    setListError(null)
    try {
      // Rate-safe: exactly 2 calls per mount (daily + curated list).
      const [d, l] = await Promise.all([
        codingProfileAPI.getDailyProblem().catch((e) => ({ __error: e })),
        codingProfileAPI.getProblemsList().catch((e) => ({ __error: e })),
      ])
      if (gen !== epoch.current) return
      const dd = d as any
      if (dd?.__error) {
        setDaily(null)
        setDailyError(dd.__error?.response?.data?.error || 'Daily challenge unavailable — retry shortly.')
      } else {
        setDaily((dd?.problem ?? null) as DailyPayload | null)
        setDailyStale(!!dd?.stale)
        setDailyCachedAt(dd?.cachedAt ?? null)
        if (!dd?.problem) setDailyError('No daily challenge today — check back tomorrow.')
      }
      const ll = l as any
      if (ll?.__error) {
        setItems([])
        setListError(ll.__error?.response?.data?.error || 'Problem list unavailable — retry shortly.')
      } else {
        const rows = Array.isArray(ll?.items) ? ll.items : []
        // Client no-fake guard (service already drops): keep rows with a
        // real titleSlug link only.
        setItems(rows.filter((r: any) => typeof r?.titleSlug === 'string' && /^[a-z0-9-]+$/.test(r.titleSlug) && typeof r?.url === 'string' && r.url.includes(r.titleSlug)))
        setListSource(ll?.source === 'live' ? 'live' : 'curated')
      }
      if (!impressionSent.current) {
        impressionSent.current = true
        trackProblemsEvent('impression', { source: 'problems-tab' })
      }
    } finally {
      if (gen === epoch.current) {
        setLoading(false)
        setRetrying(false)
      }
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Lazy CF fetch: once when the tab opens, then on every filter change.
  useEffect(() => {
    if (platform !== 'codeforces') return
    loadCf()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, cfTags.join(','), cfBand, cfSort, cfOrder])

  // URL-sync explore filters (share/reload-safe) without navigating.
  useEffect(() => {
    writeProblemFiltersToUrl(filter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.topic, filter.difficulty, filter.query])

  const solvedSet = useMemo(() => new Set(marks.solved), [marks.solved])
  const recs = useMemo(() => recommendProblems(items, lcStat, solvedSet), [items, lcStat, solvedSet])
  const topics = useMemo(() => collectTopics(items), [items])
  const visible = useMemo(() => filterProblems(items, filter, solvedSet), [items, filter, solvedSet])

  const onToggleSolved = (slug: string) => {
    setMarks((prev) => toggleSolvedMark(slug, prev))
    trackProblemsEvent('mark', { kind: 'solved', titleSlug: slug })
  }
  const onToggleStar = (slug: string) => {
    setMarks((prev) => toggleStarredMark(slug, prev))
    trackProblemsEvent('mark', { kind: 'star', titleSlug: slug })
  }
  const onOpenLink = (slug: string) => trackProblemsEvent('click', { titleSlug: slug })
  const onOpenCfLink = (p: CfProblemItem) => trackProblemsEvent('click', { titleSlug: cfProblemKey(p) })
  const toggleCfTag = (tag: string) => {
    setCfTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag].slice(0, 5)))
  }

  const setF = (patch: Partial<ProblemFilter>) => setFilter((f) => ({ ...f, ...patch }))

  if (loading && platform === 'leetcode') {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 p-12 text-sm text-surface-500 dark:text-night-300">
        <Loader2 size={16} className="animate-spin" /> Loading problems…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ── Platform toggle: LeetCode (daily+curated) | Codeforces (live) | Sheets (static) | Links (static) ── */}
      <div role="tablist" aria-label="Problem platform" className="inline-flex flex-wrap rounded-xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 p-1 gap-1">
        {(['leetcode', 'codeforces', 'sheets', 'links'] as const).map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={platform === p}
            onClick={() => {
              setPlatform(p)
              trackProblemsEvent('impression', { source: `problems-tab-${p}` })
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              platform === p
                ? 'bg-white dark:bg-night-850 text-surface-900 dark:text-night-50 shadow-sm border border-surface-200 dark:border-night-600'
                : 'text-surface-500 dark:text-night-300 hover:text-surface-900 dark:hover:text-night-50'
            }`}
          >
            {p === 'leetcode' ? 'LeetCode' : p === 'codeforces' ? 'Codeforces · live' : p === 'sheets' ? 'Sheets' : 'Links'}
          </button>
        ))}
      </div>

      {platform === 'leetcode' && (
        <>
      {/* ── Daily card ── */}
      <section aria-label="Daily challenge" className="rounded-2xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 p-5">
        <div className="flex items-center gap-2 mb-3">
          <CalendarDays size={16} className="text-primary-600 dark:text-success-300" />
          <h3 className="font-bold text-surface-900 dark:text-night-50 text-sm">Daily Challenge</h3>
          {dailyStale && (
            <span className="inline-flex items-center rounded-full border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300">
              Stale{dailyCachedAt ? ` · updated ${new Date(dailyCachedAt).toLocaleDateString()}` : ''}
            </span>
          )}
        </div>
        {daily ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={daily.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => onOpenLink(daily.titleSlug)}
                  className="font-semibold text-surface-900 dark:text-night-50 hover:text-primary-600 dark:hover:text-success-300 hover:underline flex items-center gap-1"
                >
                  {daily.title} <ExternalLink size={13} />
                </a>
                <DifficultyBadge d={daily.difficulty} />
                {daily.paidOnly && <PaidBadge />}
              </div>
              <p className="mt-1 text-xs text-surface-500 dark:text-night-300">
                {daily.date ? `LeetCode daily · ${daily.date}` : 'LeetCode daily'}
                {daily.questionId ? ` · #${daily.questionId}` : ''}
              </p>
            </div>
            <MarkButtons slug={daily.titleSlug} marks={marks} onToggleSolved={onToggleSolved} onToggleStar={onToggleStar} />
          </div>
        ) : (
          <div className="text-center py-4">
            <p className="text-sm text-surface-500 dark:text-night-300">{dailyError || 'No daily challenge right now.'}</p>
            <button
              onClick={() => load(true)}
              disabled={retrying}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 px-3 py-1.5 text-xs font-medium text-surface-600 dark:text-night-200 hover:bg-surface-100 dark:hover:bg-night-700 disabled:opacity-50"
            >
              {retrying ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Retry
            </button>
          </div>
        )}
      </section>

      {/* ── Recommended ── */}
      <section aria-label="Recommended for you">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={16} className="text-primary-600 dark:text-success-300" />
          <h3 className="font-bold text-surface-900 dark:text-night-50 text-sm">Recommended for you</h3>
          <span className="text-[11px] text-surface-400 dark:text-night-400">from your Easy/Med/Hard split</span>
        </div>
        {recs.length === 0 ? (
          <p className="rounded-2xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 p-6 text-center text-sm text-surface-500 dark:text-night-300">
            No recommendations yet — the problem list is still loading or empty.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {recs.map(({ item, why }) => (
              <div key={item.titleSlug} className="rounded-2xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 p-4 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <DifficultyBadge d={item.difficulty} />
                  {item.paidOnly && <PaidBadge />}
                </div>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => onOpenLink(item.titleSlug)}
                  className="font-semibold text-surface-900 dark:text-night-50 hover:text-primary-600 dark:hover:text-success-300 hover:underline flex items-center gap-1"
                >
                  {item.title} <ExternalLink size={13} />
                </a>
                <p className="text-[11px] text-surface-500 dark:text-night-300">{why}</p>
                <div className="mt-auto pt-1">
                  <MarkButtons slug={item.titleSlug} marks={marks} onToggleSolved={onToggleSolved} onToggleStar={onToggleStar} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Explore ── */}
      <section aria-label="Explore problems">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-surface-900 dark:text-night-50 text-sm">
            Explore{listSource === 'live' ? ' · live' : ' · curated'} <span className="font-normal text-surface-400 dark:text-night-400">({visible.length}/{items.length})</span>
          </h3>
          {/* Mobile collapsible filters; always visible on sm+ */}
          <button
            onClick={() => setShowFilters((s) => !s)}
            aria-expanded={showFilters}
            className="sm:hidden inline-flex items-center gap-1.5 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 px-3 py-1.5 text-xs font-medium text-surface-600 dark:text-night-200"
          >
            <SlidersHorizontal size={13} /> Filters
            <ChevronDown size={13} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
        </div>

        <div className={`${showFilters ? 'block' : 'hidden'} sm:block rounded-2xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 p-4 mb-3`}>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <label className="text-xs font-medium text-surface-500 dark:text-night-300 flex flex-col gap-1">
              Topic
              <select
                value={filter.topic}
                onChange={(e) => setF({ topic: e.target.value })}
                className="rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 px-3 py-2 text-sm text-surface-700 dark:text-night-200 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
              >
                <option value="">All topics</option>
                {topics.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-surface-500 dark:text-night-300 flex flex-col gap-1">
              Difficulty
              <select
                value={filter.difficulty}
                onChange={(e) => setF({ difficulty: e.target.value })}
                className="rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 px-3 py-2 text-sm text-surface-700 dark:text-night-200 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
              >
                <option value="">All levels</option>
                <option value="Easy">Easy</option>
                <option value="Medium">Medium</option>
                <option value="Hard">Hard</option>
              </select>
            </label>
            <label className="text-xs font-medium text-surface-500 dark:text-night-300 flex flex-col gap-1 sm:col-span-2">
              Search
              <input
                value={filter.query}
                onChange={(e) => setF({ query: e.target.value })}
                placeholder="Search title or slug…"
                maxLength={100}
                className="rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 px-3 py-2 text-sm text-surface-900 dark:text-night-50 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
              />
            </label>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-surface-500 dark:text-night-300 cursor-pointer">
              <input type="checkbox" checked={filter.hideSolved} onChange={(e) => setF({ hideSolved: e.target.checked })} className="accent-emerald-600" />
              Hide solved
            </label>
            {(filter.topic || filter.difficulty || filter.query || filter.hideSolved) && (
              <button onClick={() => setFilter({ ...DEFAULT_PROBLEM_FILTER })} className="text-xs font-medium text-primary-600 dark:text-success-300 hover:underline">
                Clear filters
              </button>
            )}
            <span className="ml-auto hidden sm:inline text-[11px] text-surface-400 dark:text-night-400">
              Filters sync to the URL — shareable. {buildProblemFilterSearch(filter) || '(no filters)'}
            </span>
          </div>
        </div>

        {listError && items.length === 0 ? (
          <div className="rounded-2xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 p-8 text-center">
            <p className="text-sm text-surface-500 dark:text-night-300">{listError}</p>
            <button
              onClick={() => load(true)}
              disabled={retrying}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 px-3 py-1.5 text-xs font-medium text-surface-600 dark:text-night-200 hover:bg-surface-100 dark:hover:bg-night-700 disabled:opacity-50"
            >
              {retrying ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Retry
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 p-8 text-center">
            <p className="text-sm text-surface-500 dark:text-night-300">No problems match these filters — try clearing them.</p>
          </div>
        ) : (
          <ul className="divide-y divide-surface-100 dark:divide-night-700 rounded-2xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 overflow-hidden">
            {visible.map((p) => (
              <li key={p.titleSlug} className="flex flex-wrap items-center gap-2 px-4 py-2.5 hover:bg-surface-100 dark:hover:bg-night-700 transition-colors">
                <DifficultyBadge d={p.difficulty} />
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => onOpenLink(p.titleSlug)}
                  className="min-w-0 flex-1 truncate text-sm font-medium text-surface-900 dark:text-night-50 hover:text-primary-600 dark:hover:text-success-300 hover:underline"
                  title={p.title}
                >
                  {p.title}
                </a>
                {p.paidOnly && <PaidBadge />}
                {p.topics.slice(0, 2).map((t) => (
                  <span key={t} className="hidden md:inline text-[10px] text-surface-400 dark:text-night-400">{t}</span>
                ))}
                <MarkButtons slug={p.titleSlug} marks={marks} onToggleSolved={onToggleSolved} onToggleStar={onToggleStar} />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-surface-400 dark:text-night-400">
          Marks are saved on this device only (v1). Solved counts in My Stats come from synced platform data — never from these checkmarks.
        </p>
      </section>
        </>
      )}

      {platform === 'codeforces' && (
      <section aria-label="Codeforces live browser" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-bold text-surface-900 dark:text-night-50 text-sm">
            Codeforces · live <span className="font-normal text-surface-400 dark:text-night-400">({cfItems.length}/{cfTotal})</span>
          </h3>
          {cfStale && (
            <span className="inline-flex items-center rounded-full border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300">
              Stale{cfCachedAt ? ` · updated ${new Date(cfCachedAt).toLocaleDateString()}` : ''}
            </span>
          )}
          {cfLoaded && !cfLoading && (
            <button
              onClick={() => loadCf(true)}
              disabled={cfRetrying}
              className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 px-3 py-1.5 text-xs font-medium text-surface-600 dark:text-night-200 hover:bg-surface-100 dark:hover:bg-night-700 disabled:opacity-50"
            >
              {cfRetrying ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Retry
            </button>
          )}
        </div>

        {/* Tag pills (multi-select, max 5) */}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Codeforces tags">
          {POPULAR_CF_TAGS.map((t) => {
            const active = cfTags.includes(t)
            return (
              <button
                key={t}
                onClick={() => toggleCfTag(t)}
                aria-pressed={active}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-success-300'
                    : 'border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-500 dark:text-night-300 hover:border-primary-300'
                }`}
              >
                {t}
              </button>
            )
          })}
          {cfTags.length > 0 && (
            <button onClick={() => setCfTags([])} className="text-[11px] font-medium text-primary-600 dark:text-success-300 hover:underline px-1">
              Clear tags
            </button>
          )}
        </div>

        {/* Rating band + sort */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-2xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 p-4">
          <label className="text-xs font-medium text-surface-500 dark:text-night-300 flex flex-col gap-1">
            Rating
            <select
              value={cfBand}
              onChange={(e) => setCfBand(Number(e.target.value))}
              className="rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 px-3 py-2 text-sm text-surface-700 dark:text-night-200 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            >
              {CF_RATING_BANDS.map((b, i) => (
                <option key={b.label} value={i}>{b.label}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-surface-500 dark:text-night-300 flex flex-col gap-1">
            Sort by
            <select
              value={cfSort}
              onChange={(e) => setCfSort(e.target.value as 'rating' | 'solvedCount')}
              className="rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 px-3 py-2 text-sm text-surface-700 dark:text-night-200 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            >
              <option value="solvedCount">Solved count</option>
              <option value="rating">Rating</option>
            </select>
          </label>
          <label className="text-xs font-medium text-surface-500 dark:text-night-300 flex flex-col gap-1">
            Order
            <select
              value={cfOrder}
              onChange={(e) => setCfOrder(e.target.value as 'asc' | 'desc')}
              className="rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 px-3 py-2 text-sm text-surface-700 dark:text-night-200 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            >
              <option value="desc">High → low</option>
              <option value="asc">Low → high</option>
            </select>
          </label>
        </div>

        {cfLoading ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 p-12 text-sm text-surface-500 dark:text-night-300">
            <Loader2 size={16} className="animate-spin" /> Loading Codeforces problems…
          </div>
        ) : cfError && cfItems.length === 0 ? (
          <div className="rounded-2xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 p-8 text-center">
            <p className="text-sm text-surface-500 dark:text-night-300">{cfError}</p>
            <button
              onClick={() => loadCf(true)}
              disabled={cfRetrying}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 px-3 py-1.5 text-xs font-medium text-surface-600 dark:text-night-200 hover:bg-surface-100 dark:hover:bg-night-700 disabled:opacity-50"
            >
              {cfRetrying ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Retry
            </button>
          </div>
        ) : cfItems.length === 0 ? (
          <div className="rounded-2xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 p-8 text-center">
            <p className="text-sm text-surface-500 dark:text-night-300">No Codeforces problems match these filters — try clearing them.</p>
          </div>
        ) : (
          <ul className="divide-y divide-surface-100 dark:divide-night-700 rounded-2xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 overflow-hidden">
            {cfItems.map((p) => (
              <li key={cfProblemKey(p)} className="flex flex-wrap items-center gap-2 px-4 py-2.5 hover:bg-surface-100 dark:hover:bg-night-700 transition-colors">
                <CfRatingBadge rating={p.rating} />
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => onOpenCfLink(p)}
                  className="min-w-0 flex-1 truncate text-sm font-medium text-surface-900 dark:text-night-50 hover:text-primary-600 dark:hover:text-success-300 hover:underline"
                  title={`${p.name} (${p.contestId}${p.index})`}
                >
                  {p.name}
                </a>
                <span className="text-[10px] text-surface-400 dark:text-night-400" title="Solved count (Codeforces ProblemStatistics)">
                  {formatSolvedCount(p.solvedCount)} solved
                </span>
                {p.tags.slice(0, 2).map((t) => (
                  <span key={t} className="hidden md:inline text-[10px] text-surface-400 dark:text-night-400">{t}</span>
                ))}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-surface-400 dark:text-night-400">
          Live Codeforces catalog (12h server cache, 1 req/2s guard). Every row links out to codeforces.com — failures show stale + retry, never invented rows.
        </p>
      </section>
      )}

      {platform === 'sheets' && (
        <SheetsTab />
      )}

      {platform === 'links' && (
        <LinksTab />
      )}
    </div>
  )
}
