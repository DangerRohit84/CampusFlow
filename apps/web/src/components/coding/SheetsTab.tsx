// components/coding/SheetsTab.tsx — DSA Sheets browser (manual-only).
// WHY: interview prep follows curated sheets (Striver A2Z / SDE, NeetCode 150
// + A2OJ ladders), not just daily/recs. This tab renders the STATIC ordered
// tracks from GET /coding-problems/sheets (titles+links only — no statements,
// no scraped solves): track selector + step accordions + rows (title,
// difficulty dot, View-original link, manual checkmark). Progress is
// localStorage manual marks only (lib/sheets.ts v2 manual set) with per-step +
// per-track bars — device-only, never synced, never feeds My Stats.
// Manual-only by product decision: no auto-fetch, no auto-marks, no "Auto"
// badge. Stored auto/dismissed data (if any) is KEPT untouched in localStorage
// and the backend GET /coding-problems/automark route is KEPT (no migration,
// no delete) — the tab simply stops calling it and stops rendering auto.
// Rate-safe: 1 GET per mount (sheets 24h-cached static).
import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, RefreshCw, Loader2, CheckCircle2, ChevronDown, BookOpen } from 'lucide-react'
import { codingProfileAPI } from '../../lib/api/resources/profile'
import {
  loadSheetMarksV2,
  sheetItemKey,
  stepProgress,
  toggleSheetMarkV2,
  trackProgress,
  type SheetMarksV2,
  type SheetTrack,
} from '../../lib/sheets'
import { trackProblemsEvent } from '../../lib/codingProblems'

const DOT: Record<string, string> = {
  Easy: 'bg-emerald-500',
  Medium: 'bg-amber-500',
  Hard: 'bg-red-500',
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-200 dark:bg-night-700" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
    </div>
  )
}

export default function SheetsTab() {
  const [tracks, setTracks] = useState<SheetTrack[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [openSteps, setOpenSteps] = useState<Set<string>>(new Set())
  const [marks, setMarks] = useState<SheetMarksV2>(() => loadSheetMarksV2())
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const epoch = useRef(0)

  const load = async (isRetry = false) => {
    const gen = ++epoch.current
    if (isRetry) setRetrying(true)
    else setLoading(true)
    setError(null)
    try {
      const res = await codingProfileAPI.getSheets()
      if (gen !== epoch.current) return
      const rows = Array.isArray(res?.tracks) ? res.tracks : []
      // Client no-fake guard (seed is static + backend-tested): keep steps
      // with real https links only.
      const clean = (rows as unknown as SheetTrack[]).filter(
        (t) => typeof t?.id === 'string' && t.id && Array.isArray(t.steps) && t.steps.length > 0,
      )
      setTracks(clean)
      if (clean.length === 0) {
        setError('No sheets available right now — retry shortly.')
      } else {
        setSelected((prev) => (prev && clean.some((t) => t.id === prev) ? prev : clean[0].id))
        // Open the first step of the default track for immediate value.
        setOpenSteps((prev) => (prev.size > 0 ? prev : new Set([`${clean[0].id}/${clean[0].steps[0]?.id}`])))
      }
      trackProblemsEvent('impression', { source: 'sheets-tab' })
    } catch (e: any) {
      if (gen !== epoch.current) return
      setTracks([])
      setError(e?.response?.data?.error || 'Sheets unavailable — retry shortly.')
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

  // Manual-only progress: stored auto/dismissed sets (if any) are ignored for
  // display but KEPT in storage (no data delete, reversible).
  const marked = useMemo(() => new Set(marks.manual), [marks.manual])
  const active = tracks.find((t) => t.id === selected) ?? null
  const progress = useMemo(() => (active ? trackProgress(active, marked) : null), [active, marked])

  const onToggle = (trackId: string, stepId: string, order: number) => {
    const key = sheetItemKey(trackId, stepId, order)
    setMarks((prev) => toggleSheetMarkV2(key, prev))
    trackProblemsEvent('mark', { kind: 'sheet', key })
  }
  const onOpenLink = (url: string) => trackProblemsEvent('click', { titleSlug: url })

  const toggleStep = (key: string) => {
    setOpenSteps((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 p-12 text-sm text-surface-500 dark:text-night-300">
        <Loader2 size={16} className="animate-spin" /> Loading sheets…
      </div>
    )
  }

  if (error && tracks.length === 0) {
    return (
      <div className="rounded-2xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 p-8 text-center">
        <p className="text-sm text-surface-500 dark:text-night-300">{error}</p>
        <button
          onClick={() => load(true)}
          disabled={retrying}
          className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 px-3 py-1.5 text-xs font-medium text-surface-600 dark:text-night-200 hover:bg-surface-100 dark:hover:bg-night-700 disabled:opacity-50"
        >
          {retrying ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Retry
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ── Track selector with per-track bars ── */}
      <div role="tablist" aria-label="DSA tracks" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {tracks.map((t) => {
          const p = trackProgress(t, marked)
          const isActive = t.id === selected
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => {
                setSelected(t.id)
                trackProblemsEvent('impression', { source: `sheets-${t.id}` })
              }}
              className={`rounded-2xl border p-3 text-left transition-colors ${
                isActive
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10'
                  : 'border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 hover:border-primary-300'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-surface-900 dark:text-night-50">{t.name}</span>
                <span className="text-[11px] font-semibold text-surface-500 dark:text-night-300">
                  {p.done}/{p.total} · {p.pct}%
                </span>
              </div>
              <div className="mt-2">
                <Bar pct={p.pct} />
              </div>
            </button>
          )
        })}
      </div>

      {active && (
        <>
          {/* ── Credit line (attribution, honest subset note) ── */}
          <p className="flex flex-wrap items-center gap-1 text-[11px] text-surface-400 dark:text-night-400">
            <BookOpen size={12} />
            {active.credit}{' '}
            <a
              href={active.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onOpenLink(active.sourceUrl)}
              className="font-medium text-primary-600 dark:text-success-300 hover:underline inline-flex items-center gap-0.5"
            >
              {active.sourceName} <ExternalLink size={11} />
            </a>
          </p>

          {progress && (
            <div className="rounded-2xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 p-4">
              <div className="flex items-center justify-between gap-2 text-xs font-semibold text-surface-700 dark:text-night-200">
                <span>{active.name} progress</span>
                <span>{progress.done}/{progress.total} · {progress.pct}%</span>
              </div>
              <div className="mt-2">
                <Bar pct={progress.pct} />
              </div>
            </div>
          )}

          {/* ── Step accordions ── */}
          <div className="space-y-2">
            {active.steps.map((s) => {
              const key = `${active.id}/${s.id}`
              const open = openSteps.has(key)
              const sp = stepProgress(active.id, s, marked)
              return (
                <section
                  key={s.id}
                  aria-label={s.title}
                  className="overflow-hidden rounded-2xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800"
                >
                  <button
                    onClick={() => toggleStep(key)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-2 px-4 py-3 text-left"
                  >
                    <ChevronDown size={15} className={`shrink-0 text-surface-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-surface-900 dark:text-night-50" title={s.title}>
                      {s.title}
                    </span>
                    <span className="shrink-0 text-[11px] font-semibold text-surface-500 dark:text-night-300">
                      {sp.done}/{sp.total}
                    </span>
                    <span className="hidden w-20 shrink-0 sm:block">
                      <Bar pct={sp.pct} />
                    </span>
                  </button>
                  {open && (
                    <ul className="divide-y divide-surface-100 dark:divide-night-700 border-t border-surface-100 dark:border-night-700">
                      {s.items.map((item) => {
                        const k = sheetItemKey(active.id, s.id, item.order)
                        const done = marked.has(k)
                        return (
                          <li key={item.order} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                            <span className="flex shrink-0 items-center gap-1.5" title={item.difficulty}>
                              <span className={`inline-block h-2 w-2 rounded-full ${DOT[item.difficulty] ?? 'bg-surface-300'}`} />
                              <span className="hidden text-[10px] font-medium text-surface-400 dark:text-night-400 sm:inline">
                                {item.difficulty}
                              </span>
                            </span>
                            <span className={`min-w-0 flex-1 truncate text-sm font-medium ${done ? 'text-surface-400 dark:text-night-400 line-through' : 'text-surface-900 dark:text-night-50'}`} title={item.title}>
                              {item.title}
                            </span>
                            <span className="hidden text-[10px] text-surface-400 dark:text-night-400 md:inline">{item.topic}</span>
                            <a
                              href={item.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => onOpenLink(item.sourceUrl)}
                              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 px-2 py-1 text-[11px] font-medium text-primary-600 dark:text-success-300 hover:underline"
                            >
                              View original <ExternalLink size={11} />
                            </a>
                            <button
                              onClick={() => onToggle(active.id, s.id, item.order)}
                              aria-pressed={done}
                              aria-label={done ? `Unmark ${item.title}` : `Mark ${item.title} done`}
                              title={done ? 'Mark undone' : 'Mark done (saved on this device)'}
                              className={`flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors ${
                                done
                                  ? 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                  : 'border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-500 dark:text-night-300 hover:text-emerald-600 dark:hover:text-emerald-300'
                              }`}
                            >
                              <CheckCircle2 size={12} /> {done ? 'Done' : 'Mark'}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </section>
              )
            })}
          </div>
          <div className="space-y-1">
            <p className="text-[11px] text-surface-400 dark:text-night-400">
              Checkmarks are manual and saved on this device only. Solved counts in My Stats come from synced platform data — never from these checkmarks.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
