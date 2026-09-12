// components/coding/ActivityHeatmap.tsx — 6-month GitHub-style unified grid.
// WHY: feat-unified-heatmap — merges three honest daily sources (contests +
// coding solves + git commits) with per-source toggles. Intensity stays the
// GitHub-quartile countToLevel over the ENABLED-source total so the legend is
// comparable with the old contests-only grid. CodeChef/HackerRank/GFG have no
// daily API and are omitted with an honest note (never faked).
// Accessibility: the grid is a real list with per-cell aria-labels + a text
// summary (screen-reader safe); no motion at all, and the only hover effect is
// gated behind `motion-safe:` (reduced-motion safe). Toggle chips are real
// <button>s with aria-pressed. Contrast: cells are non-text decoration; all
// adjacent *text* (heading, legend, counts) uses surface/night tokens (AA).

import { useMemo } from 'react';
import {
  groupHeatmapByWeeks,
  formatDayLabel,
  formatUnifiedDayLabel,
  OMITTED_SOURCES,
  HEATMAP_RANGE_LAST_6,
  type HeatmapDay,
  type UnifiedDay,
  type SourceToggles,
  type ActivitySource,
  type DayBreakdown,
  type HeatmapYearOption,
} from '../../lib/codingStreak';

// GitHub contribution palette (light) + GitHub dark-mode equivalents.
const LIGHT_FILLS = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];
const DARK_FILLS = ['rgba(255,255,255,0.08)', '#0e4429', '#006d32', '#26a641', '#39d353'];
const VAR_CSS = `:root{--heat-0:${LIGHT_FILLS[0]};--heat-1:${LIGHT_FILLS[1]};--heat-2:${LIGHT_FILLS[2]};--heat-3:${LIGHT_FILLS[3]};--heat-4:${LIGHT_FILLS[4]}}.dark{--heat-0:${DARK_FILLS[0]};--heat-1:${DARK_FILLS[1]};--heat-2:${DARK_FILLS[2]};--heat-3:${DARK_FILLS[3]};--heat-4:${DARK_FILLS[4]}}`;

const CELL = 12;
const GAP = 3;

// Source chip dots (text-adjacent decoration only; labels carry meaning).
const SOURCE_DOT: Record<ActivitySource, string> = {
  contests: '#f59e0b',
  coding: '#3b82f6',
  git: '#22c55e',
};

const SOURCE_LABEL: Record<ActivitySource, string> = {
  contests: 'Contests',
  coding: 'Coding',
  git: 'Git',
};

function monthLabels(weeks: (HeatmapDay | null)[][]): { index: number; label: string }[] {
  const out: { index: number; label: string }[] = [];
  let prevMonth = '';
  weeks.forEach((week, i) => {
    const first = week.find((d): d is HeatmapDay => d !== null);
    if (!first) return;
    const month = first.date.slice(0, 7); // YYYY-MM
    if (month !== prevMonth) {
      prevMonth = month;
      const ms = Date.UTC(Number(first.date.slice(0, 4)), Number(first.date.slice(5, 7)) - 1, 1);
      out.push({
        index: i,
        label: new Date(ms).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
      });
    }
  });
  return out;
}

function isUnified(day: HeatmapDay | UnifiedDay): day is UnifiedDay {
  return (
    typeof (day as UnifiedDay)?.contests === 'number' ||
    typeof (day as UnifiedDay)?.coding === 'number' ||
    typeof (day as UnifiedDay)?.git === 'number'
  );
}

function cellLabel(day: HeatmapDay | UnifiedDay): string {
  if (isUnified(day)) {
    return formatUnifiedDayLabel(day.date, {
      contests: day.contests ?? 0,
      coding: day.coding ?? 0,
      git: day.git ?? 0,
    });
  }
  return formatDayLabel(day.date, day.count);
}

export default function ActivityHeatmap({
  days,
  currentStreak,
  longestStreak,
  toggles,
  onToggle,
  breakdown,
  showOmittedNote = true,
  yearValue = HEATMAP_RANGE_LAST_6,
  yearOptions = null,
  onYearChange = null,
  rangeLabel = 'last 6 months',
}: {
  days: (HeatmapDay | UnifiedDay)[];
  currentStreak: number;
  longestStreak: number;
  /** When provided with onToggle, renders Contests/Coding/Git toggle chips. */
  toggles?: SourceToggles | null;
  onToggle?: ((source: ActivitySource) => void) | null;
  /** Window totals for the header (contests/solves/commits split). */
  breakdown?: DayBreakdown | null;
  /** Show the honest omitted-sources note (default true). */
  showOmittedNote?: boolean;
  /** Year-filter selection (default 'last6'). Shown only with yearOptions + onYearChange. */
  yearValue?: string;
  /** Dropdown options (Last 6 months + years + All) from getHeatmapYearOptions. */
  yearOptions?: HeatmapYearOption[] | null;
  /** Year-filter change handler (persists in the page). */
  onYearChange?: ((year: string) => void) | null;
  /** Visible-range phrase for the caption + summaries ('last 6 months' | 'YYYY' | 'all available history'). */
  rangeLabel?: string;
}) {
  const weeks = useMemo(() => groupHeatmapByWeeks(days), [days]);
  const labels = useMemo(() => monthLabels(weeks), [weeks]);
  const total = useMemo(() => days.reduce((s, d) => s + d.count, 0), [days]);
  const interactive = Boolean(toggles && onToggle);
  const showYearFilter = Boolean(yearOptions && yearOptions.length > 0 && onYearChange);
  // Summary grammar: "in the last 6 months" vs "in 2026" / "in all available history".
  const rangePhrase = rangeLabel === 'last 6 months' ? 'the last 6 months' : rangeLabel;

  if (days.length === 0) return null;

  const parts =
    breakdown ??
    (days.length > 0 && days.every(isUnified)
      ? (days as UnifiedDay[]).reduce<DayBreakdown>(
          (acc, d) => ({
            contests: acc.contests + (d.contests || 0),
            coding: acc.coding + (d.coding || 0),
            git: acc.git + (d.git || 0),
          }),
          { contests: 0, coding: 0, git: 0 },
        )
      : null);

  const summary = parts
    ? `${total} activit${total === 1 ? 'y' : 'ies'} in ${rangePhrase} ` +
      `(${parts.contests} contest${parts.contests === 1 ? '' : 's'}, ` +
      `${parts.coding} solve${parts.coding === 1 ? '' : 's'}, ` +
      `${parts.git} commit${parts.git === 1 ? '' : 's'}). ` +
      `Current streak ${currentStreak} day${currentStreak === 1 ? '' : 's'}, ` +
      `longest ${longestStreak} day${longestStreak === 1 ? '' : 's'}.`
    : `${total} contest${total === 1 ? '' : 's'} in ${rangePhrase}. ` +
      `Current streak ${currentStreak} day${currentStreak === 1 ? '' : 's'}, ` +
      `longest ${longestStreak} day${longestStreak === 1 ? '' : 's'}.`;

  const toggleSources: ActivitySource[] = ['contests', 'coding', 'git'];

  return (
    <figure className="bg-surface-50 dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 p-5">
      <style>{VAR_CSS}</style>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <figcaption className="font-semibold text-surface-900 dark:text-night-50 text-sm">
          Activity <span className="font-normal text-surface-500 dark:text-night-300">— {rangeLabel}</span>
        </figcaption>
        <p className="text-xs text-surface-500 dark:text-night-300" aria-hidden="true">
          {parts ? (
            <>
              {total} · {parts.contests} contests · {parts.coding} solves · {parts.git} commits
            </>
          ) : (
            <>
              {total} contest{total === 1 ? '' : 's'}
            </>
          )}
        </p>
      </div>

      {/* Year filter: Last 6 months (default) + calendar years + All. Native
          <select> with a visible label: keyboard usable, AT announced. Slices
          the unified days client-side; streaks recompute over the visible
          range (documented in codingStreak.ts). */}
      {showYearFilter && yearOptions && onYearChange && (
        <div className="flex items-center gap-2 mb-3">
          <label
            htmlFor="cf-heatmap-year"
            className="text-[11px] font-medium text-surface-500 dark:text-night-300"
          >
            Year
          </label>
          <select
            id="cf-heatmap-year"
            value={yearValue}
            onChange={(e) => onYearChange(e.target.value)}
            className="px-2 py-1 rounded-lg border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-xs font-medium text-surface-700 dark:text-night-200 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
          >
            {yearOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Per-source toggles: filter which sources feed intensity + streaks. */}
      {interactive && toggles && onToggle && (
        <div className="flex flex-wrap items-center gap-2 mb-3" role="group" aria-label="Heatmap sources">
          {toggleSources.map((s) => {
            const on = toggles[s];
            return (
              <button
                key={s}
                type="button"
                onClick={() => onToggle(s)}
                aria-pressed={on}
                title={on ? `Hide ${SOURCE_LABEL[s]} from the heatmap` : `Show ${SOURCE_LABEL[s]} on the heatmap`}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                  on
                    ? 'bg-white dark:bg-night-700 text-surface-700 dark:text-night-100 border-surface-200 dark:border-night-600'
                    : 'bg-transparent text-surface-400 dark:text-night-500 border-surface-200 dark:border-night-700 line-through'
                }`}
              >
                <span
                  aria-hidden="true"
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: SOURCE_DOT[s], opacity: on ? 1 : 0.35 }}
                />
                {SOURCE_LABEL[s]}
              </button>
            );
          })}
        </div>
      )}

      {/* Screen-reader summary (the grid cells below carry per-day labels;
          the summary keeps the story one announcement). */}
      <p className="sr-only" role="status">
        {summary}
      </p>

      {/* Month labels */}
      <div
        aria-hidden="true"
        className="relative mb-1 text-[10px] text-surface-400 dark:text-night-400 select-none"
        style={{ height: 14 }}
      >
        {labels.map((l) => (
          <span
            key={`${l.index}-${l.label}`}
            className="absolute"
            style={{ left: l.index * (CELL + GAP) }}
          >
            {l.label}
          </span>
        ))}
      </div>

      {/* Grid: list semantics + per-cell labels (spec: "table or list with
          aria-labels"). Cells are tabIndex -1 (browse-mode readable, no
          180-stop tab trap); the sr-only summary carries the announcements. */}
      <ul
        aria-label={`Activity per week, ${rangeLabel}. ${summary}`}
        className="flex gap-[3px] overflow-x-auto pb-1 list-none m-0 p-0"
      >
        {weeks.map((week, wi) => (
          <li key={wi} aria-label={`Week ${wi + 1}`} className="shrink-0 list-none">
            <ul className="flex flex-col gap-[3px] list-none m-0 p-0">
              {week.map((day, di) =>
                day === null ? (
                  <li
                    key={`blank-${di}`}
                    aria-hidden="true"
                    className="list-none rounded-[3px]"
                    style={{ width: CELL, height: CELL }}
                  />
                ) : (
                  <li
                    key={day.date}
                    title={cellLabel(day)}
                    aria-label={cellLabel(day)}
                    data-date={day.date}
                    data-count={day.count}
                    data-level={day.level}
                    tabIndex={-1}
                    style={{ width: CELL, height: CELL }}
                    className="list-none rounded-[3px] border border-black/[0.04] dark:border-white/[0.06] outline-none motion-safe:transition-transform motion-safe:hover:scale-125"
                  >
                    <span
                      aria-hidden="true"
                      className="block w-full h-full rounded-[3px]"
                      style={{ backgroundColor: `var(--heat-${day.level})` }}
                    />
                  </li>
                ),
              )}
            </ul>
          </li>
        ))}
      </ul>

      {/* Legend: combined intensity + source dots */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] text-surface-500 dark:text-night-300" aria-hidden="true">
          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: SOURCE_DOT.contests }} />
          <span>Contests</span>
          <span className="inline-block w-2 h-2 rounded-full ml-2" style={{ backgroundColor: SOURCE_DOT.coding }} />
          <span>Coding</span>
          <span className="inline-block w-2 h-2 rounded-full ml-2" style={{ backgroundColor: SOURCE_DOT.git }} />
          <span>Git</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-surface-500 dark:text-night-300">
          <span>Less</span>
          {[0, 1, 2, 3, 4].map((l) => (
            <span
              key={l}
              aria-hidden="true"
              className="rounded-[3px] border border-black/[0.04] dark:border-white/[0.06]"
              style={{ width: 10, height: 10, backgroundColor: `var(--heat-${l})` }}
            />
          ))}
          <span>More</span>
        </div>
      </div>

      {/* Honest coverage note: daily data exists only for these sources. */}
      {showOmittedNote && (
        <p className="mt-2 text-[11px] leading-relaxed text-surface-400 dark:text-night-400">
          Daily activity: contests · LeetCode/Codeforces solves · GitHub commits.
          {OMITTED_SOURCES.map((s) => ` ${s.id}`).join(',')} — totals in cards only (no daily API, not shown here).
        </p>
      )}
    </figure>
  );
}
