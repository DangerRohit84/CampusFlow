// lib/__tests__/codingStreak.test.ts — task #7: streak calc + heatmap bucketing.
// WHY: heatmap/streaks are derived client-side from ContestParticipation rows;
// these pure helpers are the single source of truth for CodingProfilePage +
// ActivityHeatmap, so behavior (UTC days, 182-day window, levels, streak
// fallback) is locked here. Run: npm run test -w @campusflow/web
import { describe, it, expect } from 'vitest';
import {
  toDayKey,
  bucketParticipationsByDay,
  countToLevel,
  buildHeatmapDays,
  groupHeatmapByWeeks,
  calcStreaks,
  formatDayLabel,
} from '../codingStreak';

// Fixed "today" (a Thursday) so window/streak math is deterministic.
const TODAY = '2026-09-10';
const iso = (day: string, time = '15:30:00.000Z') => `${day}T${time}`;

describe('toDayKey', () => {
  it('buckets an ISO instant to its UTC date', () => {
    // 01:30 IST Sep 11 == Sep 10 UTC → UTC bucketing keeps it Sep 10.
    expect(toDayKey('2026-09-10T20:00:00.000Z')).toBe('2026-09-10');
    expect(toDayKey(iso('2026-09-01'))).toBe('2026-09-01');
  });
  it('accepts Date objects', () => {
    expect(toDayKey(new Date('2026-09-05T00:00:00.000Z'))).toBe('2026-09-05');
  });
  it('returns null for missing/invalid input', () => {
    expect(toDayKey(null)).toBeNull();
    expect(toDayKey(undefined)).toBeNull();
    expect(toDayKey('not-a-date')).toBeNull();
    expect(toDayKey('')).toBeNull();
  });
});

describe('bucketParticipationsByDay', () => {
  it('counts multiple participations on the same day', () => {
    const out = bucketParticipationsByDay(
      [
        { participatedAt: iso('2026-09-01') },
        { participatedAt: iso('2026-09-01', '18:00:00.000Z') },
        { participatedAt: iso('2026-09-02') },
      ],
      { today: TODAY },
    );
    expect(out).toEqual({ '2026-09-01': 2, '2026-09-02': 1 });
  });
  it('skips rows with missing/invalid dates', () => {
    const out = bucketParticipationsByDay(
      [{ participatedAt: null }, { participatedAt: 'junk' }, {}, { participatedAt: iso('2026-09-03') }],
      { today: TODAY },
    );
    expect(out).toEqual({ '2026-09-03': 1 });
  });
  it('ignores future-dated rows', () => {
    const out = bucketParticipationsByDay(
      [{ participatedAt: iso('2026-09-10') }, { participatedAt: iso('2026-09-11') }],
      { today: TODAY },
    );
    expect(out).toEqual({ '2026-09-10': 1 });
  });
  it('returns {} for empty input', () => {
    expect(bucketParticipationsByDay([], { today: TODAY })).toEqual({});
    expect(bucketParticipationsByDay(null, { today: TODAY })).toEqual({});
  });
});

describe('countToLevel', () => {
  it('maps counts to GitHub-style levels', () => {
    expect(countToLevel(0)).toBe(0);
    expect(countToLevel(-3)).toBe(0);
    expect(countToLevel(1)).toBe(1);
    expect(countToLevel(2)).toBe(2);
    expect(countToLevel(3)).toBe(3);
    expect(countToLevel(4)).toBe(3);
    expect(countToLevel(5)).toBe(4);
    expect(countToLevel(99)).toBe(4);
  });
});

describe('buildHeatmapDays', () => {
  it('covers 182 days ending today with no holes', () => {
    const days = buildHeatmapDays({}, { today: TODAY });
    expect(days).toHaveLength(182);
    expect(days[0].date).toBe('2026-03-13');
    expect(days[days.length - 1].date).toBe(TODAY);
    // Ascending + consecutive UTC days.
    for (let i = 1; i < days.length; i++) {
      const prev = Date.parse(`${days[i - 1].date}T00:00:00.000Z`);
      const cur = Date.parse(`${days[i].date}T00:00:00.000Z`);
      expect(cur - prev).toBe(24 * 60 * 60 * 1000);
    }
    expect(days.every((d) => d.count === 0 && d.level === 0)).toBe(true);
  });
  it('maps counts to days + levels', () => {
    const days = buildHeatmapDays({ '2026-09-10': 1, '2026-09-09': 5 }, { today: TODAY });
    const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
    expect(byDate['2026-09-10']).toMatchObject({ count: 1, level: 1 });
    expect(byDate['2026-09-09']).toMatchObject({ count: 5, level: 4 });
    expect(byDate['2026-09-08']).toMatchObject({ count: 0, level: 0 });
  });
  it('accepts a Map and a custom window', () => {
    const days = buildHeatmapDays(new Map([['2026-09-10', 2]]), { today: TODAY, windowDays: 7 });
    expect(days).toHaveLength(7);
    expect(days[6]).toMatchObject({ date: TODAY, count: 2, level: 2 });
  });
});

describe('groupHeatmapByWeeks', () => {
  it('packs days into Sun–Sat columns of 7 with leading blanks', () => {
    const days = buildHeatmapDays({}, { today: TODAY });
    const weeks = groupHeatmapByWeeks(days);
    expect(weeks.length).toBeGreaterThan(0);
    for (const w of weeks) expect(w).toHaveLength(7);
    // 2026-03-13 is a Friday → 5 leading blanks (Sun–Thu).
    expect(weeks[0].slice(0, 5).every((c) => c === null)).toBe(true);
    expect(weeks[0][5]?.date).toBe('2026-03-13');
    // All 182 days preserved in order.
    expect(weeks.flat().filter((c) => c !== null)).toHaveLength(182);
  });
  it('returns [] for empty input', () => {
    expect(groupHeatmapByWeeks([])).toEqual([]);
  });
});

describe('calcStreaks', () => {
  it('returns zeros for no activity', () => {
    expect(calcStreaks({}, { today: TODAY })).toEqual({
      current: 0,
      longest: 0,
      totalActiveDays: 0,
      lastActiveDate: null,
    });
    expect(calcStreaks([], { today: TODAY }).current).toBe(0);
  });
  it('counts a single active today as 1/1', () => {
    const r = calcStreaks({ '2026-09-10': 2 }, { today: TODAY });
    expect(r).toMatchObject({ current: 1, longest: 1, totalActiveDays: 1, lastActiveDate: '2026-09-10' });
  });
  it('counts a 5-day run ending today', () => {
    const r = calcStreaks(
      ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'],
      { today: TODAY },
    );
    expect(r).toMatchObject({ current: 5, longest: 5, totalActiveDays: 5 });
  });
  it('keeps the streak alive when today is inactive but yesterday is active', () => {
    const r = calcStreaks(['2026-09-07', '2026-09-08', '2026-09-09'], { today: TODAY });
    expect(r.current).toBe(3);
    expect(r.longest).toBe(3);
  });
  it('drops to 0 when neither today nor yesterday is active', () => {
    const r = calcStreaks(['2026-09-01', '2026-09-02', '2026-09-03'], { today: TODAY });
    expect(r.current).toBe(0);
    expect(r.longest).toBe(3);
    expect(r.lastActiveDate).toBe('2026-09-03');
  });
  it('breaks the current streak at gaps but keeps the longest run', () => {
    const r = calcStreaks(
      {
        '2026-08-01': 1,
        '2026-08-02': 1,
        '2026-08-03': 1,
        '2026-08-04': 1,
        '2026-08-05': 1,
        '2026-09-09': 1,
        '2026-09-10': 1,
      },
      { today: TODAY },
    );
    expect(r.current).toBe(2);
    expect(r.longest).toBe(5);
    expect(r.totalActiveDays).toBe(7);
  });
  it('ignores zero-count days and malformed keys', () => {
    const r = calcStreaks(
      { '2026-09-09': 1, '2026-09-10': 3, '2026-09-08': 0, junk: 2 } as Record<string, number>,
      { today: TODAY },
    );
    expect(r).toMatchObject({ current: 2, longest: 2, totalActiveDays: 2 });
  });
  it('handles unsorted input and Map input', () => {
    const r = calcStreaks(['2026-09-10', '2026-09-08', '2026-09-09'], { today: TODAY });
    expect(r.current).toBe(3);
    const m = calcStreaks(new Map([['2026-09-10', 1]]), { today: TODAY });
    expect(m.current).toBe(1);
  });
});

describe('formatDayLabel', () => {
  it('pluralizes correctly', () => {
    expect(formatDayLabel('2026-09-10', 0)).toMatch(/^No contests on /);
    expect(formatDayLabel('2026-09-10', 1)).toMatch(/^1 contest on /);
    expect(formatDayLabel('2026-09-10', 4)).toMatch(/^4 contests on /);
  });
});
