// lib/__tests__/sheets.test.ts — Sheets-browser helpers (plan §3).
// WHY: manual checkmarks (localStorage v1) + per-step/per-track bars are pure
// client logic — locked here. Run: npm run test -w @campusflow/web
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SHEETS_MARKS_KEY,
  loadSheetMarks,
  sheetItemKey,
  stepProgress,
  toggleSheetMark,
  trackProgress,
} from '../sheets';

const STEP = {
  id: 'nc-arrays',
  items: [
    { order: 1, title: 'Two Sum', sourceUrl: 'https://leetcode.com/problems/two-sum/', topic: 'array', difficulty: 'Easy' },
    { order: 2, title: 'Valid Anagram', sourceUrl: 'https://leetcode.com/problems/valid-anagram/', topic: 'hash-table', difficulty: 'Easy' },
    { order: 3, title: 'Group Anagrams', sourceUrl: 'https://leetcode.com/problems/group-anagrams/', topic: 'hash-table', difficulty: 'Medium' },
    { order: 4, title: 'Top K Frequent Elements', sourceUrl: 'https://leetcode.com/problems/top-k-frequent-elements/', topic: 'hash-table', difficulty: 'Medium' },
  ],
} as const;

const TRACK = {
  id: 'neetcode-150',
  steps: [
    STEP as unknown as (typeof STEP & { title: string; order: number }),
    {
      id: 'nc-pointers',
      title: 'Two Pointers',
      order: 2,
      items: [
        { order: 1, title: 'Container With Most Water', sourceUrl: 'https://leetcode.com/problems/container-with-most-water/', topic: 'two-pointers', difficulty: 'Medium' },
        { order: 2, title: '3Sum', sourceUrl: 'https://leetcode.com/problems/3sum/', topic: 'two-pointers', difficulty: 'Medium' },
      ],
    },
  ],
} as const;

function lsMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };
}

describe('sheetItemKey', () => {
  it('builds stable track/step/order keys', () => {
    expect(sheetItemKey('neetcode-150', 'nc-arrays', 1)).toBe('neetcode-150/nc-arrays/1');
  });
});

describe('localStorage sheet marks (v1)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', lsMock());
  });

  it('loads empty when nothing stored, survives corruption', () => {
    expect(loadSheetMarks()).toEqual([]);
    localStorage.setItem(SHEETS_MARKS_KEY, 'not-json{{{');
    expect(loadSheetMarks()).toEqual([]);
  });

  it('drops malformed keys on load (never inflates bars)', () => {
    localStorage.setItem(SHEETS_MARKS_KEY, JSON.stringify({ done: ['neetcode-150/nc-arrays/1', 'evil', 42, '../x', 'a/b/c/d'] }));
    expect(loadSheetMarks()).toEqual(['neetcode-150/nc-arrays/1']);
  });

  it('toggles marks and persists under the v1 key', () => {
    const k = sheetItemKey('neetcode-150', 'nc-arrays', 1);
    let m = toggleSheetMark(k);
    expect(m).toContain(k);
    expect(JSON.parse(localStorage.getItem(SHEETS_MARKS_KEY)!).done).toContain(k);
    m = toggleSheetMark(k, m);
    expect(m).not.toContain(k);
  });

  it('ignores malformed toggle keys', () => {
    expect(toggleSheetMark('not a key', [])).toEqual([]);
  });
});

describe('stepProgress (per-step bars)', () => {
  it('computes done/total/pct, ignoring stale keys', () => {
    expect(stepProgress('neetcode-150', STEP)).toEqual({ done: 0, total: 4, pct: 0 });
    const half = stepProgress('neetcode-150', STEP, new Set(['neetcode-150/nc-arrays/1', 'neetcode-150/nc-arrays/2', 'striver-a2z/other/9']));
    expect(half).toEqual({ done: 2, total: 4, pct: 50 });
    expect(stepProgress('neetcode-150', STEP, ['neetcode-150/nc-arrays/1', 'neetcode-150/nc-arrays/2', 'neetcode-150/nc-arrays/3', 'neetcode-150/nc-arrays/4']).pct).toBe(100);
  });

  it('rounds honestly and never NaNs on empty steps', () => {
    expect(stepProgress('t', { id: 's', items: [] })).toEqual({ done: 0, total: 0, pct: 0 });
    const p = stepProgress('neetcode-150', STEP, ['neetcode-150/nc-arrays/1']);
    expect(p).toEqual({ done: 1, total: 4, pct: 25 });
  });
});

describe('trackProgress (per-track bars)', () => {
  it('aggregates steps (done/total/pct + perStep)', () => {
    const all = trackProgress(TRACK, []);
    expect(all).toMatchObject({ done: 0, total: 6, pct: 0 });
    expect(all.perStep).toHaveLength(2);
    const some = trackProgress(TRACK, ['neetcode-150/nc-arrays/1', 'neetcode-150/nc-pointers/1', 'neetcode-150/nc-pointers/2']);
    expect(some).toMatchObject({ done: 3, total: 6, pct: 50 });
    expect(some.perStep[1]).toEqual({ done: 2, total: 2, pct: 100 });
  });

  it('handles track with no steps without NaN', () => {
    expect(trackProgress({ id: 'empty', steps: [] }, [])).toMatchObject({ done: 0, total: 0, pct: 0 });
  });
});
