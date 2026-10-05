// apps/web/src/lib/__tests__/leaderboard-sort.test.ts — TDD RED for sortable leaderboard.
// WHY (issue #1): college leaderboard positions by rating(avg) desc by default.
// Click on column header toggles asc/desc with arrow. Rank numbers follow current sort.
// Frontend sort is client-side over the (filtered) page slice; backend default is rating desc.
import { describe, it, expect } from 'vitest';
import { sortLeaderboardRows, type LeaderboardSortKey, type SortDir } from '../leaderboardSort';

const rows = [
  { userId: 'a', name: 'Alice', totalContests: 10, totalSolved: 50, rating: 1200, bestRating: 1200 },
  { userId: 'b', name: 'Bob', totalContests: 2, totalSolved: 200, rating: 1800, bestRating: 1800 },
  { userId: 'c', name: 'Cara', totalContests: 5, totalSolved: 100, rating: 1500, bestRating: 1500 },
] as any[];

describe('sortLeaderboardRows rating-primary default', () => {
  it('default rating desc puts highest rating first (positions by rating)', () => {
    const out = sortLeaderboardRows(rows, 'rating', 'desc').map((r: any) => r.userId);
    expect(out).toEqual(['b', 'c', 'a']);
  });
  it('rating asc reverses (toggle)', () => {
    const out = sortLeaderboardRows(rows, 'rating', 'asc').map((r: any) => r.userId);
    expect(out).toEqual(['a', 'c', 'b']);
  });
  it('contests desc/asc toggles', () => {
    expect(sortLeaderboardRows(rows, 'contests', 'desc').map((r: any) => r.userId)).toEqual(['a', 'c', 'b']);
    expect(sortLeaderboardRows(rows, 'contests', 'asc').map((r: any) => r.userId)).toEqual(['b', 'c', 'a']);
  });
  it('solved desc/asc toggles', () => {
    expect(sortLeaderboardRows(rows, 'solved', 'desc').map((r: any) => r.userId)).toEqual(['b', 'c', 'a']);
    expect(sortLeaderboardRows(rows, 'solved', 'asc').map((r: any) => r.userId)).toEqual(['a', 'c', 'b']);
  });
  it('name asc/desc toggles (locale, deterministic)', () => {
    expect(sortLeaderboardRows(rows, 'name', 'asc').map((r: any) => r.userId)).toEqual(['a', 'b', 'c']);
    expect(sortLeaderboardRows(rows, 'name', 'desc').map((r: any) => r.userId)).toEqual(['c', 'b', 'a']);
  });
  it('null rating fail-open 0 sorts last on desc', () => {
    const withNull = [...rows, { userId: 'd', name: 'Dan', totalContests: 99, totalSolved: 999, rating: null, bestRating: null }] as any[];
    const out = sortLeaderboardRows(withNull, 'rating', 'desc').map((r: any) => r.userId);
    expect(out[out.length - 1]).toBe('d');
  });
  it('does not mutate input (pure)', () => {
    const copy = [...rows];
    sortLeaderboardRows(rows, 'rating', 'desc');
    expect(rows.map((r: any) => r.userId)).toEqual(copy.map((r: any) => r.userId));
  });
});

describe('toggle helper (header click cycles desc -> asc)', () => {
  it('same key flips dir, new key defaults sensibly', async () => {
    const { nextSort } = await import('../leaderboardSort');
    expect(nextSort('rating', 'desc', 'rating')).toEqual({ key: 'rating', dir: 'asc' });
    expect(nextSort('rating', 'asc', 'rating')).toEqual({ key: 'rating', dir: 'desc' });
    // new key: rating/solved/contests default desc, name defaults asc
    expect(nextSort('rating', 'desc', 'solved')).toEqual({ key: 'solved', dir: 'desc' });
    expect(nextSort('rating', 'desc', 'name')).toEqual({ key: 'name', dir: 'asc' });
  });
});
