// lib/__tests__/codingProblems-cf.test.ts — Codeforces browser helpers (plan §2).
// WHY: tag pills + rating-band filter + sort query must be pure + honest
// (no invented ratings/counts). Run: npm run test -w @campusflow/web
import { describe, it, expect } from 'vitest';
import {
  CF_RATING_BANDS,
  buildCfQuery,
  formatSolvedCount,
  cfProblemKey,
  type CfProblemItem,
} from '../codingProblems';

describe('CF_RATING_BANDS', () => {
  it('starts with All (null band) and covers 800+ bands', () => {
    expect(CF_RATING_BANDS[0]).toMatchObject({ label: 'All', min: null, max: null });
    expect(CF_RATING_BANDS.length).toBeGreaterThanOrEqual(4);
    for (const b of CF_RATING_BANDS.slice(1)) {
      expect(b.min).not.toBeNull();
    }
  });
});

describe('buildCfQuery', () => {
  it('builds tag + rating-band + sort params, omitting empties', () => {
    const q = buildCfQuery({ tags: ['dp', 'math'], bandIndex: 1, sort: 'rating', order: 'asc', limit: 50 });
    expect(q.tags).toBe('dp;math');
    expect(q.sort).toBe('rating');
    expect(q.order).toBe('asc');
    expect(Number(q.minRating)).toBeGreaterThanOrEqual(500);
  });

  it('omits tags/ratings when All/empty', () => {
    const q = buildCfQuery({ tags: [], bandIndex: 0, sort: 'solvedCount', order: 'desc', limit: 50 });
    expect(q.tags).toBeUndefined();
    expect(q.minRating).toBeUndefined();
    expect(q.maxRating).toBeUndefined();
    expect(q.sort).toBe('solvedCount');
  });
});

describe('formatSolvedCount', () => {
  it('formats honestly (never invents)', () => {
    expect(formatSolvedCount(0)).toBe('0');
    expect(formatSolvedCount(999)).toBe('999');
    expect(formatSolvedCount(25000)).toMatch(/25/);
    expect(formatSolvedCount(-5)).toBe('0');
  });
});

describe('cfProblemKey', () => {
  it('keys by contestId-index', () => {
    const p = { contestId: 1730, index: 'A' } as CfProblemItem;
    expect(cfProblemKey(p)).toBe('1730-A');
  });
});
