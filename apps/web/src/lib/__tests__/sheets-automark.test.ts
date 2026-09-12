// lib/__tests__/sheets-automark.test.ts — Sheets auto-mark (§4).
// WHY: CF full-history (contestId-index join) + LC recent-20 (slug join)
// auto-check rows with a distinct auto source; manual is never unmarked and
// dismissed autos never re-mark. Pure client logic — locked here.
// Run: npm run test -w @campusflow/web
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SHEETS_MARKS_KEY_V2,
  applyAutoMarks,
  cfKeyFromSheetUrl,
  combinedMarked,
  isAutoMark,
  lcSlugFromSheetUrl,
  loadSheetMarksV2,
  mapSolvedToSheetKeys,
  sheetItemKey,
  toggleSheetMarkV2,
} from '../sheets';

const TRACKS = [
  {
    id: 'a2oj-ladder4',
    steps: [
      {
        id: 'l4-p1',
        items: [
          { order: 1, sourceUrl: 'https://codeforces.com/problemset/problem/4/A' },
          { order: 2, sourceUrl: 'https://codeforces.com/problemset/problem/71/A' },
        ],
      },
    ],
  },
  {
    id: 'neetcode-150',
    steps: [
      {
        id: 'nc-arrays',
        items: [
          { order: 1, sourceUrl: 'https://leetcode.com/problems/two-sum/' },
          { order: 2, sourceUrl: 'https://leetcode.com/problems/valid-anagram/' },
        ],
      },
    ],
  },
] as const;

function lsMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };
}

describe('sheet URL join extractors', () => {
  it('extracts CF contestId-index only from real CF URLs', () => {
    expect(cfKeyFromSheetUrl('https://codeforces.com/problemset/problem/4/A')).toBe('4-A');
    expect(cfKeyFromSheetUrl('https://codeforces.com/problemset/problem/484/E/')).toBe('484-E');
    expect(cfKeyFromSheetUrl('https://leetcode.com/problems/two-sum/')).toBeNull();
    expect(cfKeyFromSheetUrl('http://codeforces.com/problemset/problem/4/A')).toBeNull();
    expect(cfKeyFromSheetUrl(null)).toBeNull();
  });

  it('extracts LC slugs only from real LC URLs', () => {
    expect(lcSlugFromSheetUrl('https://leetcode.com/problems/two-sum/')).toBe('two-sum');
    expect(lcSlugFromSheetUrl('https://codeforces.com/problemset/problem/4/A')).toBeNull();
    expect(lcSlugFromSheetUrl('https://leetcode.com/problems/Bad_Slug/')).toBeNull();
  });
});

describe('mapSolvedToSheetKeys (CF join + LC join)', () => {
  it('maps CF solved keys to ladder rows via contestId-index', () => {
    const keys = mapSolvedToSheetKeys(TRACKS as any, { cfSolved: new Set(['4-A']), lcSolved: new Set() });
    expect(keys).toEqual(['a2oj-ladder4/l4-p1/1']);
  });

  it('maps LC solved slugs to Striver/NeetCode rows via titleSlug', () => {
    const keys = mapSolvedToSheetKeys(TRACKS as any, { cfSolved: new Set(), lcSolved: ['two-sum'] });
    expect(keys).toEqual(['neetcode-150/nc-arrays/1']);
  });

  it('maps both feeds at once, dedupes, ignores unknown solves', () => {
    const keys = mapSolvedToSheetKeys(TRACKS as any, {
      cfSolved: ['4-A', '9999-Z', '4-A'],
      lcSolved: ['two-sum', 'ghost-slug-xyz'],
    });
    expect(keys.sort()).toEqual(['a2oj-ladder4/l4-p1/1', 'neetcode-150/nc-arrays/1']);
  });

  it('returns [] on empty feeds (never invents)', () => {
    expect(mapSolvedToSheetKeys(TRACKS as any, {})).toEqual([]);
    expect(mapSolvedToSheetKeys([], { cfSolved: ['4-A'] })).toEqual([]);
  });
});

describe('v2 marks: auto vs manual precedence', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', lsMock());
  });

  it('starts empty, migrates v1 done → manual', () => {
    expect(loadSheetMarksV2()).toEqual({ manual: [], auto: [], dismissed: [] });
    localStorage.setItem('cf-sheets-marks-v1', JSON.stringify({ done: ['neetcode-150/nc-arrays/1'] }));
    expect(loadSheetMarksV2()).toEqual({ manual: ['neetcode-150/nc-arrays/1'], auto: [], dismissed: [] });
  });

  it('applyAutoMarks adds solved, never unmarks manual', () => {
    const base = { manual: ['a2oj-ladder4/l4-p1/1'], auto: [], dismissed: [] };
    const next = applyAutoMarks(['a2oj-ladder4/l4-p1/1', 'a2oj-ladder4/l4-p1/2'], base);
    // 1 already manual → not duplicated to auto; 2 added as auto.
    expect(next.manual).toEqual(['a2oj-ladder4/l4-p1/1']);
    expect(next.auto).toEqual(['a2oj-ladder4/l4-p1/2']);
    // Second run is append-only (no removal).
    const again = applyAutoMarks(['a2oj-ladder4/l4-p1/2'], next);
    expect(again.auto).toEqual(['a2oj-ladder4/l4-p1/2']);
  });

  it('never re-adds dismissed autos (user uncheck sticks)', () => {
    let m = { manual: [] as string[], auto: [] as string[], dismissed: [] as string[] };
    m = applyAutoMarks(['a2oj-ladder4/l4-p1/1'], m);
    expect(m.auto).toEqual(['a2oj-ladder4/l4-p1/1']);
    // User unchecks the auto row → dismissed.
    m = toggleSheetMarkV2('a2oj-ladder4/l4-p1/1', m);
    expect(m.auto).toEqual([]);
    expect(m.dismissed).toEqual(['a2oj-ladder4/l4-p1/1']);
    // Next auto run must NOT re-add.
    m = applyAutoMarks(['a2oj-ladder4/l4-p1/1'], m);
    expect(m.auto).toEqual([]);
    expect(m.dismissed).toEqual(['a2oj-ladder4/l4-p1/1']);
  });

  it('toggle: unmarked → manual, manual → unmarked, auto → dismissed', () => {
    const k = sheetItemKey('neetcode-150', 'nc-arrays', 1);
    let m = toggleSheetMarkV2(k, { manual: [], auto: [], dismissed: [] });
    expect(m.manual).toEqual([k]);
    m = toggleSheetMarkV2(k, m);
    expect(m.manual).toEqual([]);
    // Auto row uncheck → dismissed (not manual).
    const auto = { manual: [] as string[], auto: [k], dismissed: [] as string[] };
    const un = toggleSheetMarkV2(k, auto);
    expect(un.auto).toEqual([]);
    expect(un.manual).toEqual([]);
    expect(un.dismissed).toEqual([k]);
    // Re-checking a dismissed row goes manual (and un-dismisses).
    const re = toggleSheetMarkV2(k, un);
    expect(re.manual).toEqual([k]);
    expect(re.dismissed).toEqual([]);
  });

  it('combinedMarked + isAutoMark drive progress bars + badges', () => {
    const m1 = sheetItemKey('neetcode-150', 'nc-arrays', 1);
    const m2 = sheetItemKey('a2oj-ladder4', 'l4-p1', 1);
    const m = { manual: [m1], auto: [m2], dismissed: [] as string[] };
    // combinedMarked needs full v2 shape; dismissed ignored for progress.
    expect(combinedMarked(m as any)).toEqual(new Set([m1, m2]));
    expect(isAutoMark(m2, m as any)).toBe(true);
    expect(isAutoMark(m1, m as any)).toBe(false);
  });

  it('persists under the v2 key with source fields', () => {
    const k = sheetItemKey('a2oj-ladder4', 'l4-p1', 1);
    toggleSheetMarkV2(k);
    const raw = JSON.parse(localStorage.getItem(SHEETS_MARKS_KEY_V2)!);
    expect(raw.manual).toContain(k);
    expect(raw).toHaveProperty('auto');
    expect(raw).toHaveProperty('dismissed');
  });

  it('survives corrupted v2 storage', () => {
    localStorage.setItem(SHEETS_MARKS_KEY_V2, 'not-json{{{');
    expect(loadSheetMarksV2()).toEqual({ manual: [], auto: [], dismissed: [] });
  });
});
