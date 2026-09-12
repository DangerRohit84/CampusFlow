// lib/sheets.ts — Sheets-browser helpers (pure, unit-tested).
// WHY: plan §3 ships Striver A2Z / SDE / NeetCode 150 as STATIC ordered
// tracks (GET /coding-problems/sheets, titles+links only). Progress is manual
// checkmarks in localStorage v1 — same pattern as the Problems MVP marks
// (device-only, never synced, never feeds My Stats solves). §4 adds A2OJ
// Ladder11/Ladder4 (CF problemset rows) + auto-mark: CF full-history
// (user.status OK → contestId-index join) and LC recent-20 (Accepted →
// titleSlug) auto-check rows with a distinct "auto" source (user can uncheck;
// manual is never unmarked by auto). CC/HR/GFG stay manual-only (no scrapers).
// This file owns ONLY client logic: mark storage (v1 compat + v2
// manual/auto/dismissed), stable item keys, join mapping (URL → cfKey/slug →
// sheet keys), per-step + per-track progress math. No fetching here (see
// codingProfileAPI.getSheets / getAutomark). No fakes: progress derives from
// real track payloads; unknown keys are ignored when computing bars (stale
// marks never inflate counts).

export interface SheetItem {
  order: number
  title: string
  sourceUrl: string
  topic: string
  difficulty: 'Easy' | 'Medium' | 'Hard'
  cfKey?: string
  a2ojDifficulty?: number
}

export interface SheetStep {
  id: string
  title: string
  order: number
  items: SheetItem[]
}

export interface SheetTrack {
  id: string
  name: string
  sourceName: string
  sourceUrl: string
  credit: string
  originalCount: number
  steps: SheetStep[]
}

// --- stable item keys -------------------------------------------------------
// Key = "<trackId>/<stepId>/<order>" (order is 1-based per step, locked
// backend-side). Keys survive title edits; step renames reset that step.

export const SHEETS_MARKS_KEY = 'cf-sheets-marks-v1'

const SHEET_KEY_RE = /^[a-z0-9-]+\/[a-z0-9-]+\/\d+$/

/** Build the stable key for a sheet row. */
export function sheetItemKey(trackId: string, stepId: string, order: number): string {
  return `${trackId}/${stepId}/${order}`
}

function normalizeSheetKeys(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const k of v) {
    if (typeof k !== 'string') continue
    const t = k.trim()
    if (!t || t.length > 120 || !SHEET_KEY_RE.test(t) || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/** Read sheet marks (never throws — corrupted storage → empty). */
export function loadSheetMarks(): string[] {
  try {
    const raw = localStorage.getItem(SHEETS_MARKS_KEY)
    if (!raw) return []
    const p = JSON.parse(raw) as { done?: unknown }
    return normalizeSheetKeys(p.done)
  } catch {
    return []
  }
}

function saveSheetMarks(done: string[]): void {
  try {
    localStorage.setItem(SHEETS_MARKS_KEY, JSON.stringify({ done }))
  } catch {
    /* private-mode — marks still work in-memory for the session */
  }
}

export function toggleSheetMark(key: string, current?: string[]): string[] {
  const base = current ?? loadSheetMarks()
  const set = new Set(normalizeSheetKeys(base))
  const k = key.trim()
  if (!SHEET_KEY_RE.test(k)) return [...set]
  if (set.has(k)) set.delete(k)
  else set.add(k)
  const next = [...set]
  saveSheetMarks(next)
  return next
}

// --- v2 marks: manual vs auto (distinct source, user can uncheck) -------------
// WHY §4: auto-mark must never unmark manual, and a user-unchecked auto row
// must stay unchecked (dismissed) instead of being re-added on the next
// Sheets open. v1 {done[]} migrates to v2 {manual[]} (auto/dismissed start
// empty). Device-only, never synced, never feeds My Stats — same contract.

export const SHEETS_MARKS_KEY_V2 = 'cf-sheets-marks-v2'

export interface SheetMarksV2 {
  manual: string[]
  auto: string[]
  dismissed: string[]
  meta?: {
    cfHandle?: string | null
    lcHandle?: string | null
    fetchedAt?: string | null
    cfStale?: boolean
    lcStale?: boolean
  }
}

const EMPTY_V2: SheetMarksV2 = { manual: [], auto: [], dismissed: [] }

/** Read v2 marks (never throws — corrupted → empty; migrates v1 → manual). */
export function loadSheetMarksV2(): SheetMarksV2 {
  try {
    const raw = localStorage.getItem(SHEETS_MARKS_KEY_V2)
    if (raw) {
      const p = JSON.parse(raw) as Partial<SheetMarksV2 & { meta?: unknown }>
      const manual = normalizeSheetKeys((p as { manual?: unknown }).manual)
      const auto = normalizeSheetKeys((p as { auto?: unknown }).auto)
      const dismissed = normalizeSheetKeys((p as { dismissed?: unknown }).dismissed)
      // Manual wins on overlap (auto never shadows a manual mark).
      const manualSet = new Set(manual)
      const cleanAuto = auto.filter((k) => !manualSet.has(k))
      const cleanDismissed = dismissed.filter((k) => !manualSet.has(k) && !cleanAuto.includes(k))
      const meta = (p as { meta?: SheetMarksV2['meta'] }).meta
      return {
        manual,
        auto: cleanAuto,
        dismissed: cleanDismissed,
        ...(meta && typeof meta === 'object' ? { meta } : {}),
      }
    }
    // Migrate v1 → manual (one-way; v2 writes never touch the v1 key).
    const v1 = loadSheetMarks()
    if (v1.length > 0) return { manual: v1, auto: [], dismissed: [] }
    return { ...EMPTY_V2 }
  } catch {
    return { ...EMPTY_V2 }
  }
}

export function saveSheetMarksV2(m: SheetMarksV2): void {
  try {
    const manual = normalizeSheetKeys(m.manual)
    const manualSet = new Set(manual)
    const auto = normalizeSheetKeys(m.auto).filter((k) => !manualSet.has(k))
    const dismissed = normalizeSheetKeys(m.dismissed).filter((k) => !manualSet.has(k) && !auto.includes(k))
    const payload: SheetMarksV2 = { manual, auto, dismissed }
    if (m.meta && typeof m.meta === 'object') payload.meta = m.meta
    localStorage.setItem(SHEETS_MARKS_KEY_V2, JSON.stringify(payload))
  } catch {
    /* private-mode — marks still work in-memory for the session */
  }
}

/**
 * Toggle a row in v2 space:
 * manual → unmarked · auto → unmarked+dismissed (never re-auto-marked) ·
 * unmarked → manual (and un-dismissed). Invalid keys return input unchanged.
 */
export function toggleSheetMarkV2(key: string, current?: SheetMarksV2): SheetMarksV2 {
  const base = current ?? loadSheetMarksV2()
  const k = key.trim()
  if (!SHEET_KEY_RE.test(k)) return { manual: [...base.manual], auto: [...base.auto], dismissed: [...base.dismissed], ...(base.meta ? { meta: base.meta } : {}) }
  const manual = new Set(normalizeSheetKeys(base.manual))
  const auto = new Set(normalizeSheetKeys(base.auto).filter((x) => !manual.has(x)))
  const dismissed = new Set(normalizeSheetKeys(base.dismissed).filter((x) => !manual.has(x) && !auto.has(x)))
  if (manual.has(k)) {
    manual.delete(k)
  } else if (auto.has(k)) {
    auto.delete(k)
    dismissed.add(k)
  } else {
    manual.add(k)
    dismissed.delete(k)
  }
  const next: SheetMarksV2 = { manual: [...manual], auto: [...auto], dismissed: [...dismissed] }
  if (base.meta) next.meta = base.meta
  saveSheetMarksV2(next)
  return next
}

/** Combined done set (manual ∪ auto) for progress bars. */
export function combinedMarked(m: Pick<SheetMarksV2, 'manual' | 'auto'>): Set<string> {
  return new Set([...normalizeSheetKeys(m.manual), ...normalizeSheetKeys(m.auto).filter((k) => !new Set(normalizeSheetKeys(m.manual)).has(k))])
}

/** True when the row is auto-marked (and not manually overridden). */
export function isAutoMark(key: string, m: Pick<SheetMarksV2, 'manual' | 'auto'>): boolean {
  const manual = new Set(normalizeSheetKeys(m.manual))
  if (manual.has(key)) return false
  return new Set(normalizeSheetKeys(m.auto)).has(key)
}

// --- join mapping: solved feeds → sheet keys (pure) ---------------------------
// CF: `${contestId}-${index}` (probe §4) extracted from the row's CF URL.
// LC: titleSlug extracted from the row's LC URL. Rows whose URL matches
// neither are manual-only (CC/HR/GFG have no tracks — honestly ignored).

const CF_URL_RE = /^https:\/\/codeforces\.com\/problemset\/problem\/(\d+)\/([A-Z][0-9]?)\/?$/
const LC_URL_RE = /^https:\/\/leetcode\.com\/problems\/([a-z0-9-]+)\/$/

/** Extract `${contestId}-${index}` from a sheet row URL (null when not CF). */
export function cfKeyFromSheetUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const m = CF_URL_RE.exec(url.trim())
  if (!m) return null
  const cid = parseInt(m[1], 10)
  if (!Number.isInteger(cid) || cid <= 0) return null
  return `${cid}-${m[2]}`
}

/** Extract titleSlug from a sheet row URL (null when not LeetCode). */
export function lcSlugFromSheetUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const m = LC_URL_RE.exec(url.trim())
  if (!m) return null
  const slug = m[1]
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return null
  return slug
}

export interface SheetSolvedInput {
  cfSolved?: ReadonlySet<string> | ReadonlyArray<string>
  lcSolved?: ReadonlySet<string> | ReadonlyArray<string>
}

/**
 * Map solved feeds to sheet keys (pure — the join under test).
 * CF keys match ladder rows via contestId-index; LC slugs match Striver/NeetCode
 * rows via titleSlug. Unknown/stale URLs never match (no invented marks).
 */
export function mapSolvedToSheetKeys(
  tracks: ReadonlyArray<{ id: string; steps: ReadonlyArray<{ id: string; items: ReadonlyArray<{ order: number; sourceUrl: string }> }> }>,
  solved: SheetSolvedInput,
): string[] {
  const cf = new Set<string>(Array.isArray(solved.cfSolved) ? solved.cfSolved : (solved.cfSolved ?? []))
  const lc = new Set<string>(Array.isArray(solved.lcSolved) ? solved.lcSolved : (solved.lcSolved ?? []))
  if (cf.size === 0 && lc.size === 0) return []
  const out: string[] = []
  for (const t of tracks) {
    if (!t || typeof t.id !== 'string') continue
    for (const s of t.steps ?? []) {
      if (!s || typeof s.id !== 'string') continue
      for (const item of s.items ?? []) {
        const url = (item as { sourceUrl?: unknown }).sourceUrl
        const ck = cfKeyFromSheetUrl(url)
        if (ck && cf.has(ck)) {
          out.push(sheetItemKey(t.id, s.id, (item as { order: number }).order))
          continue
        }
        const slug = lcSlugFromSheetUrl(url)
        if (slug && lc.has(slug)) out.push(sheetItemKey(t.id, s.id, (item as { order: number }).order))
      }
    }
  }
  return [...new Set(out)]
}

/**
 * Apply auto marks (append-only): adds solved sheet keys not already manual
 * and not dismissed. NEVER removes manual, never re-adds dismissed, never
 * drops existing auto (LC window churn must not unmark). Persists + returns.
 */
export function applyAutoMarks(
  solvedSheetKeys: ReadonlyArray<string> | ReadonlySet<string>,
  current?: SheetMarksV2,
  meta?: SheetMarksV2['meta'],
): SheetMarksV2 {
  const base = current ?? loadSheetMarksV2()
  const manual = new Set(normalizeSheetKeys(base.manual))
  const auto = new Set(normalizeSheetKeys(base.auto).filter((k) => !manual.has(k)))
  const dismissed = new Set(normalizeSheetKeys(base.dismissed).filter((k) => !manual.has(k) && !auto.has(k)))
  const incoming = new Set(normalizeSheetKeys(Array.isArray(solvedSheetKeys) ? solvedSheetKeys : [...solvedSheetKeys]))
  for (const k of incoming) {
    if (manual.has(k) || dismissed.has(k) || auto.has(k)) continue
    auto.add(k)
  }
  const next: SheetMarksV2 = { manual: [...manual], auto: [...auto], dismissed: [...dismissed] }
  next.meta = meta ?? base.meta
  saveSheetMarksV2(next)
  return next
}

// --- progress math (pure) ----------------------------------------------------

export interface StepProgress {
  done: number
  total: number
  /** Integer 0–100 (0 when the step is empty — never NaN). */
  pct: number
}

/** Per-step bar: counts only keys belonging to this step (stale keys ignored). */
export function stepProgress(
  trackId: string,
  step: { id: string; items: ReadonlyArray<Pick<SheetItem, 'order'>> },
  marked?: ReadonlySet<string> | ReadonlyArray<string>,
): StepProgress {
  const set = new Set<string>(Array.isArray(marked) ? marked : (marked ?? []))
  const total = step.items.length
  if (total === 0) return { done: 0, total: 0, pct: 0 }
  let done = 0
  for (const item of step.items) {
    if (set.has(sheetItemKey(trackId, step.id, item.order))) done++
  }
  return { done, total, pct: Math.round((done / total) * 100) }
}

export interface TrackProgress extends StepProgress {
  perStep: StepProgress[]
}

/** Per-track bar: aggregates its steps (same stale-key-ignoring rule). */
export function trackProgress(
  track: { id: string; steps: ReadonlyArray<{ id: string; items: ReadonlyArray<Pick<SheetItem, 'order'>> }> },
  marked?: ReadonlySet<string> | ReadonlyArray<string>,
): TrackProgress {
  const perStep = track.steps.map((s) => stepProgress(track.id, s, marked))
  const done = perStep.reduce((n, p) => n + p.done, 0)
  const total = perStep.reduce((n, p) => n + p.total, 0)
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100), perStep }
}
