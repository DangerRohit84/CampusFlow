// lib/__tests__/unifiedHeatmap.test.ts — unified heatmap merge/toggles.
// WHY: feat-unified-heatmap merges three honest sources (contests + coding
// solves + git commits) with per-source toggles. These pure helpers are the
// single source of truth for CodingProfilePage + ActivityHeatmap, so merging,
// toggle filtering, levels, streak input and labels are locked here.
// Run: npm run test -w @campusflow/web
import { describe, it, expect } from 'vitest';
import {
  sumDayMaps,
  buildUnifiedHeatmapDays,
  sumBreakdown,
  unifiedActiveByDay,
  calcStreaks,
  countToLevel,
  formatUnifiedDayLabel,
  getAvailableHeatmapYears,
  filterUnifiedDaysByYear,
  getHeatmapYearOptions,
  formatHeatmapRangeLabel,
  parseStoredHeatmapYear,
  OMITTED_SOURCES,
  ALL_SOURCES_ON,
} from '../codingStreak';

// Fixed "today" (a Thursday) so window math is deterministic.
const TODAY = '2026-09-10';

describe('sumDayMaps', () => {
  it('sums per-day counts across maps', () => {
    expect(sumDayMaps({ '2026-09-10': 2 }, { '2026-09-10': 3, '2026-09-09': 1 })).toEqual({
      '2026-09-10': 5,
      '2026-09-09': 1,
    });
  });
  it('accepts Maps and skips junk', () => {
    const m = new Map([['2026-09-10', 2]]);
    expect(sumDayMaps(m, null, undefined)).toEqual({ '2026-09-10': 2 });
    expect(sumDayMaps({ junk: 5, '2026-09-10': 0 } as Record<string, number>)).toEqual({});
  });
});

describe('buildUnifiedHeatmapDays', () => {
  it('merges three sources into combined intensity', () => {
    const days = buildUnifiedHeatmapDays(
      {
        contests: { '2026-09-10': 1 },
        coding: { '2026-09-10': 2 },
        git: { '2026-09-10': 5 },
      },
      { today: TODAY, windowDays: 3 },
    );
    expect(days).toHaveLength(3);
    const last = days[2];
    expect(last.date).toBe(TODAY);
    expect(last).toMatchObject({ contests: 1, coding: 2, git: 5, count: 8, level: countToLevel(8) });
  });
  it('covers the window with no holes (inactive days present with zeros)', () => {
    const days = buildUnifiedHeatmapDays({}, { today: TODAY, windowDays: 7 });
    expect(days).toHaveLength(7);
    expect(days[0].date).toBe('2026-09-04');
    expect(days.every((d) => d.count === 0 && d.level === 0)).toBe(true);
  });
  it('toggles filter intensity but preserve raw per-source counts', () => {
    const args = {
      contests: { '2026-09-10': 1 },
      coding: { '2026-09-10': 2 },
      git: { '2026-09-10': 5 },
    };
    const off = buildUnifiedHeatmapDays(args, {
      today: TODAY,
      windowDays: 1,
      toggles: { contests: true, coding: true, git: false },
    });
    expect(off[0].count).toBe(3);
    // Raw stays honest so the tooltip still shows the true split.
    expect(off[0]).toMatchObject({ contests: 1, coding: 2, git: 5 });
    const contestsOnly = buildUnifiedHeatmapDays(args, {
      today: TODAY,
      windowDays: 1,
      toggles: { contests: true, coding: false, git: false },
    });
    expect(contestsOnly[0].count).toBe(1);
    expect(contestsOnly[0].level).toBe(countToLevel(1));
  });
  it('all-off yields zero intensity everywhere', () => {
    const days = buildUnifiedHeatmapDays(
      { contests: { [TODAY]: 3 } },
      { today: TODAY, windowDays: 2, toggles: { contests: false, coding: false, git: false } },
    );
    expect(days.every((d) => d.count === 0 && d.level === 0)).toBe(true);
    // Raw preserved.
    expect(days[1]).toMatchObject({ contests: 3 });
  });
});

describe('sumBreakdown + unifiedActiveByDay + calcStreaks (combined)', () => {
  it('sums raw per-source totals', () => {
    const days = buildUnifiedHeatmapDays(
      {
        contests: { '2026-09-10': 1, '2026-09-09': 2 },
        coding: { '2026-09-10': 3 },
        git: {},
      },
      { today: TODAY, windowDays: 2 },
    );
    expect(sumBreakdown(days)).toEqual({ contests: 3, coding: 3, git: 0 });
    expect(sumBreakdown(null)).toEqual({ contests: 0, coding: 0, git: 0 });
  });
  it('streaks combine across enabled sources (any activity counts)', () => {
    const days = buildUnifiedHeatmapDays(
      {
        contests: { '2026-09-08': 1 },
        coding: { '2026-09-09': 2 },
        git: { '2026-09-10': 1 },
      },
      { today: TODAY, windowDays: 5 },
    );
    const r = calcStreaks(unifiedActiveByDay(days), { today: TODAY });
    expect(r.current).toBe(3);
    expect(r.longest).toBe(3);
  });
  it('disabling the only active source breaks the streak (documented)', () => {
    const args = { contests: {}, coding: {}, git: { '2026-09-10': 4, '2026-09-09': 1 } };
    const on = buildUnifiedHeatmapDays(args, { today: TODAY, windowDays: 2, toggles: ALL_SOURCES_ON });
    expect(calcStreaks(unifiedActiveByDay(on), { today: TODAY }).current).toBe(2);
    const off = buildUnifiedHeatmapDays(args, {
      today: TODAY,
      windowDays: 2,
      toggles: { contests: true, coding: true, git: false },
    });
    expect(calcStreaks(unifiedActiveByDay(off), { today: TODAY }).current).toBe(0);
  });
});

describe('formatUnifiedDayLabel', () => {
  it('shows the per-source split', () => {
    expect(formatUnifiedDayLabel('2026-09-10', { contests: 1, coding: 2, git: 5 })).toMatch(
      /1 contest · 2 solves · 5 commits on /,
    );
  });
  it('omits zero sources and pluralizes', () => {
    expect(formatUnifiedDayLabel('2026-09-10', { contests: 0, coding: 1, git: 0 })).toMatch(/^1 solve on /);
    expect(formatUnifiedDayLabel('2026-09-10', { contests: 2, coding: 0, git: 1 })).toMatch(
      /^2 contests · 1 commit on /,
    );
  });
  it('handles no activity', () => {
    expect(formatUnifiedDayLabel('2026-09-10', { contests: 0, coding: 0, git: 0 })).toMatch(/^No activity on /);
    expect(formatUnifiedDayLabel('2026-09-10', null)).toMatch(/^No activity on /);
  });
});

describe('OMITTED_SOURCES (honest ledger)', () => {
  it('omits exactly the sources with no daily API', () => {
    const ids = OMITTED_SOURCES.map((s) => s.id).sort();
    expect(ids).toEqual(['codechef', 'gfg', 'hackerrank']);
  });
});

describe('heatmap year filter (feat-heatmap-year)', () => {
  // Wide trailing window so fixtures can span 2024–2026 deterministically.
  const WIDE = 900;

  it('lists available years desc from day keys', () => {
    const days = buildUnifiedHeatmapDays(
      {
        contests: { '2024-06-01': 1 },
        coding: { '2025-01-15': 2 },
        git: { '2026-09-10': 1 },
      },
      { today: TODAY, windowDays: WIDE },
    );
    expect(getAvailableHeatmapYears(days)).toEqual(['2026', '2025', '2024']);
  });

  it('getAvailableHeatmapYears returns [] for empty/invalid input', () => {
    expect(getAvailableHeatmapYears([])).toEqual([]);
    expect(getAvailableHeatmapYears(null)).toEqual([]);
    expect(getAvailableHeatmapYears(undefined)).toEqual([]);
  });

  it('filters unified days by calendar year (raw counts preserved)', () => {
    const days = buildUnifiedHeatmapDays(
      { contests: { '2026-03-01': 1, '2025-06-15': 2 }, coding: {}, git: {} },
      { today: TODAY, windowDays: WIDE },
    );
    const only2025 = filterUnifiedDaysByYear(days, '2025');
    expect(only2025.length).toBeGreaterThan(0);
    expect(only2025.every((d) => d.date.startsWith('2025-'))).toBe(true);
    expect(only2025.find((d) => d.date === '2025-06-15')).toMatchObject({ contests: 2, count: 2 });
    expect(only2025.find((d) => d.date === '2026-03-01')).toBeUndefined();
  });

  it('keeps Last 6 months default as the trailing 182 days', () => {
    const days = buildUnifiedHeatmapDays({}, { today: TODAY, windowDays: 400 });
    const last6 = filterUnifiedDaysByYear(days, 'last6');
    expect(last6).toHaveLength(182);
    expect(last6[last6.length - 1].date).toBe(TODAY);
    expect(last6[0].date).toBe(days[days.length - 182].date);
  });

  it('All returns everything in order', () => {
    const days = buildUnifiedHeatmapDays(
      { contests: { '2025-01-01': 1 } },
      { today: TODAY, windowDays: 400 },
    );
    const all = filterUnifiedDaysByYear(days, 'all');
    expect(all).toHaveLength(400);
    expect(all[0].date).toBe(days[0].date);
    expect(all[all.length - 1].date).toBe(TODAY);
  });

  it('unknown selection falls back to the input list', () => {
    const days = buildUnifiedHeatmapDays({}, { today: TODAY, windowDays: 7 });
    expect(filterUnifiedDaysByYear(days, 'junk')).toEqual(days);
    expect(filterUnifiedDaysByYear([], '2026')).toEqual([]);
    expect(filterUnifiedDaysByYear(null, '2026')).toEqual([]);
  });

  it('builds dropdown options: Last 6 months + years desc + All', () => {
    const days = buildUnifiedHeatmapDays(
      { contests: { '2025-05-05': 1, '2026-01-02': 1 } },
      { today: TODAY, windowDays: WIDE },
    );
    expect(getHeatmapYearOptions(days)).toEqual([
      { value: 'last6', label: 'Last 6 months' },
      { value: '2026', label: '2026' },
      { value: '2025', label: '2025' },
      { value: '2024', label: '2024' },
      { value: 'all', label: 'All' },
    ]);
  });

  it('falls back to Last 6 months + All when no dated days', () => {
    expect(getHeatmapYearOptions([])).toEqual([
      { value: 'last6', label: 'Last 6 months' },
      { value: 'all', label: 'All' },
    ]);
    expect(getHeatmapYearOptions(null)).toEqual([
      { value: 'last6', label: 'Last 6 months' },
      { value: 'all', label: 'All' },
    ]);
  });

  it('labels ranges for screen-reader summaries', () => {
    expect(formatHeatmapRangeLabel('last6')).toBe('last 6 months');
    expect(formatHeatmapRangeLabel('all')).toBe('all available history');
    expect(formatHeatmapRangeLabel('2026')).toBe('2026');
    expect(formatHeatmapRangeLabel('junk')).toBe('last 6 months');
  });

  it('validates a persisted selection against available options', () => {
    expect(parseStoredHeatmapYear('2025', ['2026', '2025'])).toBe('2025');
    expect(parseStoredHeatmapYear('all', ['2026'])).toBe('all');
    expect(parseStoredHeatmapYear('last6', ['2026'])).toBe('last6');
    expect(parseStoredHeatmapYear('2024', ['2026', '2025'])).toBe('last6');
    expect(parseStoredHeatmapYear(null, ['2026'])).toBe('last6');
    expect(parseStoredHeatmapYear('junk', [])).toBe('last6');
  });

  it('streaks stay combined over the visible (filtered) range', () => {
    const days = buildUnifiedHeatmapDays(
      {
        contests: { '2026-09-08': 1 },
        coding: { '2026-09-09': 1 },
        git: { '2026-09-10': 1 },
      },
      { today: TODAY, windowDays: WIDE },
    );
    const y2026 = filterUnifiedDaysByYear(days, '2026');
    const r = calcStreaks(unifiedActiveByDay(y2026), { today: TODAY });
    expect(r.current).toBe(3);
    // 2025 slice has no activity in this fixture → streak 0, longest 0.
    const y2025 = filterUnifiedDaysByYear(days, '2025');
    const r2 = calcStreaks(unifiedActiveByDay(y2025), { today: TODAY });
    expect(r2).toMatchObject({ current: 0, longest: 0 });
  });
});
