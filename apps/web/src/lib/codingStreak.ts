// lib/codingStreak.ts — heatmap bucketing + streak calc for CodingProfilePage.
// WHY: task #7 needs a 6-month GitHub-style grid + current/max streaks derived
// from existing ContestParticipation rows (no backend change, no migration).
// These helpers are pure (no React/DOM) so they are unit-tested with vitest;
// CodingProfilePage + ActivityHeatmap consume them (single source of truth).
//
// Conventions (documented — tests lock them):
// - Day keys are UTC calendar dates `YYYY-MM-DD` (participatedAt is an ISO
//   instant; bucketing in UTC keeps client/server deterministic regardless of
//   the viewer's timezone).
// - "6 months" = last 182 days ending today (inclusive), start aligned back to
//   the previous Sunday so the grid always renders complete Sun–Sat columns.
// - Levels mirror GitHub quartiles: 0 → none, 1 → 1 contest, 2 → 2,
//   3 → 3–4, 4 → 5+.
// - Streaks count consecutive UTC calendar days with ≥1 participation.
//   `current` counts back from today, falling back to yesterday (so a user who
//   simply hasn't contested *yet* today keeps their live streak — GitHub-style).
//   `longest` is the max run anywhere in the data.

export interface ParticipationLike {
  participatedAt?: string | Date | null;
}

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export interface HeatmapDay {
  /** UTC date key `YYYY-MM-DD`. */
  date: string;
  count: number;
  level: HeatLevel;
}

export interface StreakResult {
  current: number;
  longest: number;
  totalActiveDays: number;
  /** Most recent active day key, or null when no activity. */
  lastActiveDate: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 182;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** UTC midnight ISO → `YYYY-MM-DD`. */
export function toUtcDayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * Normalize an ISO string / Date to a UTC `YYYY-MM-DD` key.
 * Returns null for missing/invalid values (caller skips the row).
 */
export function toDayKey(input: string | Date | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const d = input instanceof Date ? input : new Date(input);
  if (!Number.isFinite(d.getTime())) return null;
  return toUtcDayKey(d);
}

/** Parse a `YYYY-MM-DD` key back to UTC midnight ms. NaN when malformed. */
export function dayKeyToMs(key: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Today (UTC) as a day key. Accepts an override for tests. */
export function todayKey(today?: Date | string): string {
  if (!today) return toUtcDayKey(new Date());
  const key = toDayKey(today);
  if (key) return key;
  return toUtcDayKey(new Date());
}

/**
 * Bucket participations by UTC day → count. Skips rows with missing/invalid
 * `participatedAt` and rows dated after `today` (future-dated sync noise must
 * not inflate the grid or streaks).
 */
export function bucketParticipationsByDay(
  items: ParticipationLike[] | null | undefined,
  opts?: { today?: Date | string },
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!items || items.length === 0) return out;
  const maxKey = todayKey(opts?.today);
  for (const item of items) {
    const key = toDayKey(item?.participatedAt);
    if (!key) continue;
    if (key > maxKey) continue; // ignore future-dated rows
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/** Contest count → heat level (0–4). */
export function countToLevel(count: number): HeatLevel {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count <= 4) return 3;
  return 4;
}

/**
 * Build the 6-month day list (ascending) ending `today`. Every day in the
 * window is present (count 0 when inactive) so the grid never has holes.
 */
export function buildHeatmapDays(
  countByDay: Record<string, number> | Map<string, number> | null | undefined,
  opts?: { today?: Date | string; windowDays?: number },
): HeatmapDay[] {
  const windowDays = Math.max(1, Math.floor(opts?.windowDays ?? WINDOW_DAYS));
  const endKey = todayKey(opts?.today);
  const endMs = dayKeyToMs(endKey);
  const lookup =
    countByDay instanceof Map
      ? (k: string) => countByDay.get(k) ?? 0
      : (k: string) => (countByDay as Record<string, number> | null | undefined)?.[k] ?? 0;
  const days: HeatmapDay[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const ms = endMs - i * DAY_MS;
    const date = toUtcDayKey(new Date(ms));
    const count = Math.max(0, Math.floor(lookup(date)));
    days.push({ date, count, level: countToLevel(count) });
  }
  return days;
}

/**
 * Group an ascending day list into Sun–Sat week columns for the grid.
 * Leading `null`s pad the first column back to Sunday (GitHub-style).
 */
export function groupHeatmapByWeeks(days: HeatmapDay[]): (HeatmapDay | null)[][] {
  if (days.length === 0) return [];
  const weeks: (HeatmapDay | null)[][] = [];
  let week: (HeatmapDay | null)[] = [];
  const firstMs = dayKeyToMs(days[0].date);
  const leadBlanks = Number.isFinite(firstMs) ? new Date(firstMs).getUTCDay() : 0;
  for (let i = 0; i < leadBlanks; i++) week.push(null);
  for (const day of days) {
    week.push(day);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return weeks;
}

/** Coerce the supported active-day shapes into a Set of day keys. */
function toActiveKeySet(
  input: Iterable<string> | Record<string, number> | Map<string, number> | null | undefined,
): Set<string> {
  if (!input) return new Set();
  if (input instanceof Set) return new Set([...input].filter((k) => typeof k === 'string'));
  if (input instanceof Map) {
    return new Set(
      [...input.entries()].filter(([, v]) => (v ?? 0) > 0).map(([k]) => k),
    );
  }
  if (Array.isArray(input)) return new Set(input.filter((k) => typeof k === 'string'));
  if (typeof input === 'object') {
    return new Set(Object.entries(input).filter(([, v]) => (v ?? 0) > 0).map(([k]) => k));
  }
  return new Set();
}

/**
 * Current + longest streak over active day keys. `current` walks back from
 * today, or from yesterday when today is inactive (live-streak friendly);
 * `longest` is the max consecutive run anywhere.
 */
export function calcStreaks(
  activeDays: Iterable<string> | Record<string, number> | Map<string, number> | null | undefined,
  opts?: { today?: Date | string },
): StreakResult {
  const active = toActiveKeySet(activeDays);
  if (active.size === 0) {
    return { current: 0, longest: 0, totalActiveDays: 0, lastActiveDate: null };
  }
  // Last active date = max key (lexicographic == chronological for YYYY-MM-DD).
  let lastActiveDate: string | null = null;
  for (const key of active) {
    if (dayKeyToMs(key) !== dayKeyToMs(key)) continue; // skip malformed keys
    if (lastActiveDate === null || key > lastActiveDate) lastActiveDate = key;
  }
  if (lastActiveDate === null) {
    return { current: 0, longest: 0, totalActiveDays: 0, lastActiveDate: null };
  }

  // Longest run: sort keys, walk consecutive UTC days.
  const sorted = [...active].filter((k) => Number.isFinite(dayKeyToMs(k))).sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = dayKeyToMs(sorted[i - 1]);
    const cur = dayKeyToMs(sorted[i]);
    if (cur - prev === DAY_MS) {
      run++;
      if (run > longest) longest = run;
    } else if (cur !== prev) {
      run = 1;
    }
  }

  // Current: start today, else yesterday (streak stays alive intraday).
  const endMs = dayKeyToMs(todayKey(opts?.today));
  let cursor = endMs;
  if (!active.has(toUtcDayKey(new Date(cursor)))) cursor -= DAY_MS;
  let current = 0;
  while (active.has(toUtcDayKey(new Date(cursor)))) {
    current++;
    cursor -= DAY_MS;
  }

  return { current, longest, totalActiveDays: sorted.length, lastActiveDate };
}

/** Human label for a heatmap cell (used for aria-label + title). */
export function formatDayLabel(dateKey: string, count: number): string {
  const ms = dayKeyToMs(dateKey);
  const dateLabel = Number.isFinite(ms)
    ? new Date(ms).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : dateKey;
  return `${count === 0 ? 'No' : count} contest${count === 1 ? '' : 's'} on ${dateLabel}`;
}

// ─── Unified heatmap (contests + coding solves + git) ───────────────────────
// WHY: feat-unified-heatmap — the grid merges three honest daily sources:
//   contests (ContestParticipation.participatedAt, authoritative),
//   coding (CodingActivity leetcode+codeforces per-day solves from sync), and
//   git (GitHub contributions, cached best-effort). CodeChef/HackerRank/GFG
//   have NO daily API and are omitted (never faked) — see OMITTED_SOURCES.
// Streaks stay COMBINED across enabled sources (documented): per-source
// streaks would triple the badge UI for little signal at pilot scale.

/** Toggle key per unified source. */
export type ActivitySource = 'contests' | 'coding' | 'git';

export interface SourceToggles {
  contests: boolean;
  coding: boolean;
  git: boolean;
}

export const ALL_SOURCES_ON: SourceToggles = { contests: true, coding: true, git: true };

/** Sources with no obtainable daily data — omitted honestly, never faked. */
export const OMITTED_SOURCES: ReadonlyArray<{ id: string; reason: string }> = [
  { id: 'codechef', reason: 'No public per-day solves API (totals in cards only)' },
  { id: 'hackerrank', reason: 'No public per-day activity API (totals in cards only)' },
  { id: 'gfg', reason: 'No public per-day activity API (totals in cards only)' },
];

/**
 * One grid day with raw per-source counts. `count`/`level` are derived from
 * ENABLED sources only (toggles filter intensity); the raw contests/coding/git
 * fields always keep true values so tooltips stay honest when a source is off.
 */
export interface UnifiedDay extends HeatmapDay {
  contests: number;
  coding: number;
  git: number;
}

export interface DayBreakdown {
  contests: number;
  coding: number;
  git: number;
}

function asCount(n: unknown): number {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Sum day->count maps (pure). Malformed keys and non-positive counts skipped. */
export function sumDayMaps(
  ...maps: Array<Record<string, number> | Map<string, number> | null | undefined>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of maps) {
    if (!m) continue;
    const entries = m instanceof Map ? m.entries() : Object.entries(m);
    for (const [k, v] of entries) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
      const n = asCount(v);
      if (n <= 0) continue;
      out[k] = (out[k] ?? 0) + n;
    }
  }
  return out;
}

/**
 * Build the unified 6-month day list (ascending, no holes). Intensity uses the
 * same GitHub-quartile countToLevel over the ENABLED-source total so the
 * legend stays comparable with the old contests-only grid. Raw per-source
 * counts are preserved for tooltips/breakdowns regardless of toggles.
 */
export function buildUnifiedHeatmapDays(
  args: {
    contests?: Record<string, number> | Map<string, number> | null;
    coding?: Record<string, number> | Map<string, number> | null;
    git?: Record<string, number> | Map<string, number> | null;
  } | null | undefined,
  opts?: { today?: Date | string; windowDays?: number; toggles?: Partial<SourceToggles> | null },
): UnifiedDay[] {
  const windowDays = Math.max(1, Math.floor(opts?.windowDays ?? WINDOW_DAYS));
  const endKey = todayKey(opts?.today);
  const endMs = dayKeyToMs(endKey);
  const toggles: SourceToggles = {
    contests: opts?.toggles?.contests ?? true,
    coding: opts?.toggles?.coding ?? true,
    git: opts?.toggles?.git ?? true,
  };
  const lookup = (m: Record<string, number> | Map<string, number> | null | undefined) => {
    if (!m) return (_k: string) => 0;
    if (m instanceof Map) return (k: string) => asCount(m.get(k));
    return (k: string) => asCount((m as Record<string, number>)[k]);
  };
  const getContests = lookup(args?.contests);
  const getCoding = lookup(args?.coding);
  const getGit = lookup(args?.git);
  const days: UnifiedDay[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const ms = endMs - i * DAY_MS;
    const date = toUtcDayKey(new Date(ms));
    const contests = getContests(date);
    const coding = getCoding(date);
    const git = getGit(date);
    const count =
      (toggles.contests ? contests : 0) + (toggles.coding ? coding : 0) + (toggles.git ? git : 0);
    days.push({ date, count, level: countToLevel(count), contests, coding, git });
  }
  return days;
}

/**
 * Totals over a unified day list (or any day->count maps). Used for the share
 * card breakdown + heatmap header. Pure.
 */
export function sumBreakdown(
  days: ReadonlyArray<UnifiedDay> | null | undefined,
): DayBreakdown {
  const out: DayBreakdown = { contests: 0, coding: 0, git: 0 };
  if (!days) return out;
  for (const d of days) {
    out.contests += asCount((d as UnifiedDay)?.contests);
    out.coding += asCount((d as UnifiedDay)?.coding);
    out.git += asCount((d as UnifiedDay)?.git);
  }
  return out;
}

/** Active-day map (key -> 1) from a unified list using ENABLED-total counts. */
export function unifiedActiveByDay(days: ReadonlyArray<UnifiedDay> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!days) return out;
  for (const d of days) {
    if (d && asCount(d.count) > 0) out[d.date] = 1;
  }
  return out;
}

/** Human label for a unified cell (aria-label + title), with per-source split. */
export function formatUnifiedDayLabel(dateKey: string, parts: Partial<DayBreakdown> | null | undefined): string {
  const ms = dayKeyToMs(dateKey);
  const dateLabel = Number.isFinite(ms)
    ? new Date(ms).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : dateKey;
  const c = asCount(parts?.contests);
  const s = asCount(parts?.coding);
  const g = asCount(parts?.git);
  const total = c + s + g;
  if (total === 0) return `No activity on ${dateLabel}`;
  const bits: string[] = [];
  if (c > 0) bits.push(`${c} contest${c === 1 ? '' : 's'}`);
  if (s > 0) bits.push(`${s} solve${s === 1 ? '' : 's'}`);
  if (g > 0) bits.push(`${g} commit${g === 1 ? '' : 's'}`);
  return `${bits.join(' · ')} on ${dateLabel}`;
}

// ─── Heatmap year filter (feat-heatmap-year) ────────────────────────────
// WHY: readers want a full calendar year (or all history), not just the
// trailing 6-month window. Filtering is client-side over the unified days
// the page already built — backend GET /coding-profile/activity is
// date-bounded (?days=, max 365), so year slices show the available
// trailing history, never fabricated zeros outside it. Streaks stay
// COMBINED over the visible range by design (same rule as source toggles):
// calcStreaks(unifiedActiveByDay(visibleDays)).

/** Year-filter selection: trailing default, one calendar year, or all. */
export const HEATMAP_RANGE_LAST_6 = 'last6';
export const HEATMAP_RANGE_ALL = 'all';
/** localStorage key for the persisted year selection (alongside toggles). */
export const HEATMAP_YEAR_STORAGE_KEY = 'cf-heatmap-year';

export interface HeatmapYearOption {
  value: string;
  label: string;
}

function isYearString(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}$/.test(v);
}

/** Sorted-desc unique calendar years present in a day list. Pure. */
export function getAvailableHeatmapYears(
  days: ReadonlyArray<HeatmapDay> | null | undefined,
): string[] {
  if (!days || days.length === 0) return [];
  const years = new Set<string>();
  for (const d of days) {
    const date = (d as HeatmapDay | null | undefined)?.date;
    if (typeof date !== 'string') continue;
    const m = /^(\d{4})-\d{2}-\d{2}$/.exec(date);
    if (m) years.add(m[1]);
  }
  return [...years].sort().reverse();
}

/**
 * Slice a unified day list to the visible range. `last6` keeps the trailing
 * 182 days (the default); `all` keeps everything; `YYYY` keeps that calendar
 * year. Unknown selections fall back to the full input (safe default).
 */
export function filterUnifiedDaysByYear<T extends HeatmapDay>(
  days: ReadonlyArray<T> | null | undefined,
  selection: string | null | undefined,
): T[] {
  if (!days || (days as ReadonlyArray<T>).length === 0) return [];
  const list = days as ReadonlyArray<T>;
  if (selection === HEATMAP_RANGE_ALL) return [...list];
  if (selection === HEATMAP_RANGE_LAST_6) {
    return list.length <= WINDOW_DAYS ? [...list] : list.slice(list.length - WINDOW_DAYS);
  }
  if (isYearString(selection)) {
    const prefix = `${selection}-`;
    return list.filter((d) => typeof d?.date === 'string' && d.date.startsWith(prefix));
  }
  return [...list];
}

/** Dropdown options: Last 6 months + years desc + All. Pure. */
export function getHeatmapYearOptions(
  days: ReadonlyArray<HeatmapDay> | null | undefined,
): HeatmapYearOption[] {
  const opts: HeatmapYearOption[] = [{ value: HEATMAP_RANGE_LAST_6, label: 'Last 6 months' }];
  for (const y of getAvailableHeatmapYears(days)) opts.push({ value: y, label: y });
  opts.push({ value: HEATMAP_RANGE_ALL, label: 'All' });
  return opts;
}

/** Screen-reader range phrase for heatmap summaries (unknown → default). */
export function formatHeatmapRangeLabel(selection: string | null | undefined): string {
  if (selection === HEATMAP_RANGE_ALL) return 'all available history';
  if (isYearString(selection)) return selection;
  return 'last 6 months';
}

/**
 * Validate a persisted year selection against the years actually available.
 * Unknown/stale years (e.g. data window shrank) fall back to the default.
 */
export function parseStoredHeatmapYear(
  stored: unknown,
  availableYears: ReadonlyArray<string> | null | undefined,
): string {
  if (stored === HEATMAP_RANGE_ALL || stored === HEATMAP_RANGE_LAST_6) return stored;
  if (isYearString(stored) && Array.isArray(availableYears) && availableYears.includes(stored)) {
    return stored;
  }
  return HEATMAP_RANGE_LAST_6;
}
