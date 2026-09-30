// apps/web/src/lib/__tests__/rating-average.test.ts — TDD RED for average rating.
// WHY: college leaderboard + My Stats must show AVERAGE (mean of available
// platform ratings, ignore nulls, fail-open) labeled "Rating", not best/max.
// Run: npm run test -w @campusflow/web -- rating-average
import { describe, it, expect } from 'vitest';
import { averageRatings, averagePlatformRatings } from '../rating';

describe('averageRatings (mean, ignore nulls, fail-open null)', () => {
  it('averages Codeforces + CodeChef ratings', () => {
    expect(averageRatings([1500, 1800])).toBe(1650);
  });
  it('ignores null/undefined/NaN/Infinity (missing platforms)', () => {
    expect(averageRatings([1600, null, undefined, NaN, Infinity as any])).toBe(1600);
  });
  it('fail-open null when no rated platform', () => {
    expect(averageRatings([])).toBeNull();
    expect(averageRatings([null, undefined])).toBeNull();
  });
  it('single platform returns itself', () => {
    expect(averageRatings([1350])).toBe(1350);
  });
});

describe('averagePlatformRatings (platformStats -> rounded average or null)', () => {
  it('averages valid numeric ratings only', () => {
    const stats = [
      { platform: 'codeforces', rating: 1500, valid: true },
      { platform: 'codechef', rating: 1700, valid: true },
      { platform: 'leetcode', rating: null, valid: true },
    ] as any;
    expect(averagePlatformRatings(stats)).toBe(1600);
  });
  it('ignores invalid entries', () => {
    const stats = [
      { platform: 'codeforces', rating: 1500, valid: false },
      { platform: 'codechef', rating: 1700, valid: true },
    ] as any;
    expect(averagePlatformRatings(stats)).toBe(1700);
  });
  it('rounds halves up and returns null when none', () => {
    expect(averagePlatformRatings([{ platform: 'codeforces', rating: 1650.6, valid: true }] as any)).toBe(1651);
    expect(averagePlatformRatings([])).toBeNull();
    expect(averagePlatformRatings([{ platform: 'gfg', rating: null, valid: true }] as any)).toBeNull();
  });
});
