// lib/__tests__/codingProblems.test.ts — Problems-tab helpers.
// WHY: recommendations (difficulty-split heuristic + why-labels), explore
// filters, localStorage marks, and URL sync are pure client logic — locked
// here. Run: npm run test -w @campusflow/web
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PROBLEMS_MARKS_KEY,
  buildProblemFilterSearch,
  collectTopics,
  filterProblems,
  loadProblemMarks,
  parseProblemFilters,
  recommendProblems,
  toggleSolvedMark,
  toggleStarredMark,
  trackProblemsEvent,
  type ProblemItem,
} from '../codingProblems';

const POOL: ProblemItem[] = [
  { title: 'Two Sum', titleSlug: 'two-sum', difficulty: 'Easy', topics: ['array', 'hash-table'], url: 'https://leetcode.com/problems/two-sum/' },
  { title: 'Valid Parentheses', titleSlug: 'valid-parentheses', difficulty: 'Easy', topics: ['stack'], url: 'https://leetcode.com/problems/valid-parentheses/' },
  { title: '3Sum', titleSlug: '3sum', difficulty: 'Medium', topics: ['array', 'two-pointers'], url: 'https://leetcode.com/problems/3sum/' },
  { title: 'Median of Two Sorted Arrays', titleSlug: 'median-of-two-sorted-arrays', difficulty: 'Hard', topics: ['array', 'binary-search'], paidOnly: false, url: 'https://leetcode.com/problems/median-of-two-sorted-arrays/' },
];

function lsMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };
}

describe('recommendProblems (difficulty-split heuristic)', () => {
  it('picks one per band with why-labels referencing the LC split', () => {
    const recs = recommendProblems(POOL, { easySolved: 5, mediumSolved: 12, hardSolved: 1 });
    expect(recs).toHaveLength(3);
    expect(recs.map((r) => r.item.difficulty)).toEqual(['Easy', 'Medium', 'Hard']);
    expect(recs[0].why).toContain('5 easy solved');
    expect(recs[1].why).toContain('12 solved');
    expect(recs[2].why).toContain('1 hard solved');
  });

  it('skips locally-solved rows (unsolved-first)', () => {
    const recs = recommendProblems(POOL, null, new Set(['two-sum']));
    expect(recs[0].item.titleSlug).toBe('valid-parentheses');
  });

  it('falls back to generic whys when no LC stat exists', () => {
    const recs = recommendProblems(POOL, null);
    expect(recs[0].why).toBe('Warm-up · fundamentals');
    expect(recs[1].why).toBe('Core interview pattern');
    expect(recs[2].why).toBe('Stretch goal');
  });

  it('returns [] for an empty pool (honest empty state, never fake)', () => {
    expect(recommendProblems([], { easySolved: 1 })).toEqual([]);
  });
});

describe('filterProblems (explore)', () => {
  it('filters by difficulty + topic + query', () => {
    expect(filterProblems(POOL, { topic: '', difficulty: 'Easy', query: '', hideSolved: false })).toHaveLength(2);
    expect(filterProblems(POOL, { topic: 'stack', difficulty: '', query: '', hideSolved: false }).map((p) => p.titleSlug)).toEqual(['valid-parentheses']);
    expect(filterProblems(POOL, { topic: '', difficulty: '', query: 'median', hideSolved: false }).map((p) => p.titleSlug)).toEqual(['median-of-two-sorted-arrays']);
  });

  it('hideSolved drops marked rows', () => {
    const out = filterProblems(POOL, { topic: '', difficulty: '', query: '', hideSolved: true }, new Set(['two-sum', '3sum']));
    expect(out.map((p) => p.titleSlug).sort()).toEqual(['median-of-two-sorted-arrays', 'valid-parentheses']);
  });

  it('collects sorted unique topics', () => {
    expect(collectTopics(POOL)).toEqual(['array', 'binary-search', 'hash-table', 'stack', 'two-pointers']);
  });
});

describe('localStorage marks (v1)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', lsMock());
  });

  it('loads empty when nothing stored, survives corruption', () => {
    expect(loadProblemMarks()).toEqual({ solved: [], starred: [] });
    localStorage.setItem(PROBLEMS_MARKS_KEY, 'not-json{{{');
    expect(loadProblemMarks()).toEqual({ solved: [], starred: [] });
  });

  it('toggles solved/starred and persists under the v1 key', () => {
    let m = toggleSolvedMark('two-sum');
    expect(m.solved).toContain('two-sum');
    m = toggleSolvedMark('two-sum', m);
    expect(m.solved).not.toContain('two-sum');
    const s = toggleStarredMark('3sum');
    expect(s.starred).toContain('3sum');
    expect(JSON.parse(localStorage.getItem(PROBLEMS_MARKS_KEY)!).starred).toContain('3sum');
  });
});

describe('URL-synced filters', () => {
  it('parses ?problemsTopic=&problemsDifficulty=&problemsQ=', () => {
    expect(parseProblemFilters('?problemsTopic=array&problemsDifficulty=Medium&problemsQ=sum')).toEqual({ topic: 'array', difficulty: 'Medium', query: 'sum' });
    expect(parseProblemFilters('?problemsDifficulty=bogus')).toEqual({ topic: '', difficulty: '', query: '' });
    expect(parseProblemFilters('')).toEqual({ topic: '', difficulty: '', query: '' });
  });

  it('builds a shareable suffix, omitting empties', () => {
    expect(buildProblemFilterSearch({ topic: 'array', difficulty: 'Easy', query: '' })).toBe('?problemsTopic=array&problemsDifficulty=Easy');
    expect(buildProblemFilterSearch({ topic: '', difficulty: '', query: '' })).toBe('');
  });
});

describe('trackProblemsEvent (trivial analytics)', () => {
  it('never throws when no provider is loaded', () => {
    vi.stubGlobal('window', {});
    expect(() => trackProblemsEvent('impression')).not.toThrow();
    expect(() => trackProblemsEvent('mark', { kind: 'solved' })).not.toThrow();
  });
});
