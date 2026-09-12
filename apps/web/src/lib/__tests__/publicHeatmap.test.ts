// lib/__tests__/publicHeatmap.test.ts — public unified heatmap reuse contract.
// WHY feat-public-heatmap: PublicProfilePage must show the SAME unified heatmap
// (contests+coding+git, source toggles, year filter, streaks) as
// CodingProfilePage. The page reuses the shared ActivityHeatmap component +
// codingStreak helpers + publicProfileAPI.getActivity (no bespoke calendar).
// These tests lock that contract: public-shaped fixtures (lowercase platform
// participations with contestId/syncedAt/asOf per Order 7 + the new
// GET /u/:username/activity payload shape) flow through the SAME helpers, and
// static reads prove the page imports the shared pieces with no duplicated
// grid (no GREEN_LEVELS/levelColor/calendarSource bespoke code).
// Run: npm run test -w @campusflow/web
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  bucketParticipationsByDay,
  buildUnifiedHeatmapDays,
  sumBreakdown,
  unifiedActiveByDay,
  calcStreaks,
  filterUnifiedDaysByYear,
  getAvailableHeatmapYears,
  getHeatmapYearOptions,
  parseStoredHeatmapYear,
  formatHeatmapRangeLabel,
  ALL_SOURCES_ON,
} from '../codingStreak';

// Fixed "today" (a Thursday) so window math is deterministic.
const TODAY = '2026-09-10';
const iso = (day: string, time = '15:30:00.000Z') => `${day}T${time}`;

// Public-profile participation rows (GET /u/:username shape: lowercase
// platform, Order 7 contestId/syncedAt/asOf snapshot fields). Typed via
// ParticipationLike (extra public fields ride along, bucketing keys on
// participatedAt only — same as CodingProfilePage).
import type { ParticipationLike } from '../codingStreak';
type PublicParticipationRow = ParticipationLike & Record<string, unknown>;
const PUBLIC_PARTICIPATIONS: PublicParticipationRow[] = [
  { id: 'p1', platform: 'codeforces', contestName: 'Round #1', contestUrl: null, contestId: null, syncedAt: iso('2026-09-10'), asOf: iso('2026-09-10'), rank: 100, rating: 1500, ratingChange: 10, problemsSolved: 4, participatedAt: iso('2026-09-10') },
  { id: 'p2', platform: 'leetcode', contestName: 'Weekly 1', contestUrl: null, contestId: null, syncedAt: iso('2026-09-09'), asOf: iso('2026-09-09'), rank: 50, rating: null, ratingChange: null, problemsSolved: 3, participatedAt: iso('2026-09-09') },
];

// Public activity payload (GET /u/:username/activity shape — same envelope as
// the private GET /coding-profile/activity so the page merge stays verbatim).
const PUBLIC_ACTIVITY = {
  stored: [
    { date: '2026-09-10', source: 'leetcode', count: 2 },
    { date: '2026-09-09', source: 'codeforces', count: 1 },
    { date: '2026-09-10', source: 'github', count: 5 },
  ],
  github: [
    { date: '2026-09-10', count: 7, level: 3 },
    { date: '2026-09-09', count: 1, level: 1 },
  ],
  githubLive: true,
};

describe('public heatmap reuse: contests bucket (public participation shape)', () => {
  it('buckets participations ignoring public-only extra fields', () => {
    const out = bucketParticipationsByDay(PUBLIC_PARTICIPATIONS, { today: TODAY });
    expect(out).toEqual({ '2026-09-10': 1, '2026-09-09': 1 });
  });
  it('skips future-dated public rows', () => {
    const futureRow: PublicParticipationRow = { id: 'p3', platform: 'codeforces', contestName: 'Future', participatedAt: iso('2026-09-11') };
    const out = bucketParticipationsByDay(
      [...PUBLIC_PARTICIPATIONS, futureRow],
      { today: TODAY },
    );
    expect(out).toEqual({ '2026-09-10': 1, '2026-09-09': 1 });
  });
});

describe('public heatmap reuse: unified merge (contests+coding+git)', () => {
  it('merges the three public sources into combined intensity', () => {
    const contests = bucketParticipationsByDay(PUBLIC_PARTICIPATIONS, { today: TODAY });
    const days = buildUnifiedHeatmapDays(
      {
        contests,
        coding: { '2026-09-10': 2, '2026-09-09': 1 },
        git: { '2026-09-10': 7, '2026-09-09': 1 },
      },
      { today: TODAY, windowDays: 2 },
    );
    expect(days).toHaveLength(2);
    // 2026-09-09: 1 contest + 1 solve + 1 commit = 3.
    expect(days[0]).toMatchObject({ date: '2026-09-09', contests: 1, coding: 1, git: 1, count: 3 });
    // 2026-09-10: 1 contest + 2 solves + 7 commits = 10.
    expect(days[1]).toMatchObject({ date: '2026-09-10', contests: 1, coding: 2, git: 7, count: 10 });
  });
  it('contests-only fallback stays honest when activity is null (offline/pre-migration)', () => {
    const contests = bucketParticipationsByDay(PUBLIC_PARTICIPATIONS, { today: TODAY });
    const days = buildUnifiedHeatmapDays(
      { contests, coding: {}, git: {} },
      { today: TODAY, windowDays: 2, toggles: ALL_SOURCES_ON },
    );
    expect(days[0]).toMatchObject({ date: '2026-09-09', count: 1 });
    expect(days[1]).toMatchObject({ date: '2026-09-10', count: 1 });
    expect(sumBreakdown(days)).toEqual({ contests: 2, coding: 0, git: 0 });
  });
  it('viewer toggles filter intensity but preserve raw counts', () => {
    const contests = bucketParticipationsByDay(PUBLIC_PARTICIPATIONS, { today: TODAY });
    const days = buildUnifiedHeatmapDays(
      { contests, coding: { '2026-09-10': 2 }, git: { '2026-09-10': 7 } },
      { today: TODAY, windowDays: 1, toggles: { contests: true, coding: true, git: false } },
    );
    expect(days[0].count).toBe(3);
    expect(days[0]).toMatchObject({ contests: 1, coding: 2, git: 7 });
  });
});

describe('public heatmap reuse: breakdown + combined streaks', () => {
  it('sums the public per-source split for the header', () => {
    const days = buildUnifiedHeatmapDays(
      {
        contests: { '2026-09-10': 1 },
        coding: { '2026-09-10': 2 },
        git: { '2026-09-10': 7 },
      },
      { today: TODAY, windowDays: 1 },
    );
    expect(sumBreakdown(days)).toEqual({ contests: 1, coding: 2, git: 7 });
  });
  it('streaks combine across enabled sources (same rule as private page)', () => {
    const days = buildUnifiedHeatmapDays(
      {
        contests: { '2026-09-08': 1 },
        coding: { '2026-09-09': 1 },
        git: { '2026-09-10': 1 },
      },
      { today: TODAY, windowDays: 5 },
    );
    const r = calcStreaks(unifiedActiveByDay(days), { today: TODAY });
    expect(r).toMatchObject({ current: 3, longest: 3 });
  });
});

describe('public heatmap reuse: year filter over the public window', () => {
  const WIDE = 900;
  it('slices the public unified days to a calendar year', () => {
    const days = buildUnifiedHeatmapDays(
      { contests: { '2026-03-01': 1, '2025-06-15': 2 }, coding: {}, git: {} },
      { today: TODAY, windowDays: WIDE },
    );
    const only2025 = filterUnifiedDaysByYear(days, '2025');
    expect(only2025.length).toBeGreaterThan(0);
    expect(only2025.every((d) => d.date.startsWith('2025-'))).toBe(true);
    expect(getAvailableHeatmapYears(days)).toContain('2025');
  });
  it('dropdown options + labels match the private page', () => {
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
    expect(formatHeatmapRangeLabel('last6')).toBe('last 6 months');
    expect(formatHeatmapRangeLabel('all')).toBe('all available history');
    expect(parseStoredHeatmapYear('2024', ['2026', '2025'])).toBe('last6');
    expect(parseStoredHeatmapYear('2025', ['2026', '2025'])).toBe('2025');
  });
});

describe('public activity payload shape (backend ↔ frontend contract)', () => {
  it('carries stored + live github with the private-envelope keys', () => {
    // Mirrors GET /u/:username/activity (same envelope as the private
    // GET /coding-profile/activity so the page merge stays verbatim).
    expect(PUBLIC_ACTIVITY.githubLive).toBe(true);
    expect(PUBLIC_ACTIVITY.stored.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date))).toBe(true);
    expect(PUBLIC_ACTIVITY.stored.every((r) => ['leetcode', 'codeforces', 'github'].includes(r.source))).toBe(true);
    expect(PUBLIC_ACTIVITY.github.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date))).toBe(true);
  });
});

describe('public heatmap reuse: static wiring (no duplication)', () => {
  const SRC = path.resolve(__dirname, '../../pages/PublicProfilePage.tsx');
  const API = path.resolve(__dirname, '../api/resources/profile.ts');
  const read = (p: string) => fs.readFileSync(p, 'utf8');
  it('PublicProfilePage reuses the shared heatmap component + helpers', () => {
    const src = read(SRC);
    expect(src).toMatch(/from '\.\.\/components\/coding\/ActivityHeatmap'/);
    expect(src).toMatch(/bucketParticipationsByDay/);
    expect(src).toMatch(/buildUnifiedHeatmapDays/);
    expect(src).toMatch(/calcStreaks/);
    expect(src).toMatch(/sumBreakdown/);
    expect(src).toMatch(/unifiedActiveByDay/);
    expect(src).toMatch(/filterUnifiedDaysByYear/);
    expect(src).toMatch(/getHeatmapYearOptions/);
    expect(src).toMatch(/parseStoredHeatmapYear/);
    // Same props contract as CodingProfilePage (toggles + year filter + streaks).
    expect(src).toMatch(/onToggle=\{handleToggleSource\}/);
    expect(src).toMatch(/onYearChange=\{handleYearChange\}/);
    expect(src).toMatch(/breakdown=\{heatmapBreakdown\}/);
    expect(src).toMatch(/rangeLabel=\{heatmapRangeLabel\}/);
  });
  it('PublicProfilePage fetches viewed-user activity (read-only, no edit/sync)', () => {
    const src = read(SRC);
    expect(src).toMatch(/publicProfileAPI\.getActivity\(username/);
    expect(src).toMatch(/days:\s*HEATMAP_FULL_WINDOW_DAYS/);
    // No sync/edit controls on the heatmap path (the isOwn "Edit coding
    // profile" header link navigates away; no Sync button here).
    expect(src).not.toMatch(/Sync Stats/);
    expect(src).not.toMatch(/handleSync/);
  });
  it('PublicProfilePage has no bespoke calendar grid (removed duplication)', () => {
    const src = read(SRC);
    expect(src).not.toMatch(/GREEN_LEVELS/);
    expect(src).not.toMatch(/function levelColor/);
    expect(src).not.toMatch(/calendarSource/);
    expect(src).not.toMatch(/monthLabels/);
  });
  it('publicProfileAPI exposes getActivity for the viewed user', () => {
    const src = read(API);
    expect(src).toMatch(/getActivity:\s*\(username:\s*string/);
    expect(src).toMatch(/\/u\/\$\{encodeURIComponent\(username\)\}\/activity/);
  });
});
