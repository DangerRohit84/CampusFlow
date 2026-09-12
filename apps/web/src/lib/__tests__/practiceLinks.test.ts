// lib/__tests__/practiceLinks.test.ts — curated links guard (plan §4).
// WHY: the Links tab must never invent a catalog — it links out to 4 real
// practice hubs only. These tests lock the 4-card shape + https URLs.
// Run: npm run test -w @campusflow/web
import { describe, it, expect } from 'vitest';
import {
  PRACTICE_LINKS,
  PRACTICE_LINKS_NOTICE,
  ATCODER_SNAPSHOT_URL,
  ATCODER_SNAPSHOT_RAW_URL,
  ATCODER_LIBRARY_URL,
} from '../practiceLinks';

describe('practiceLinks (plan §4 curated links)', () => {
  it('exposes exactly the 4 expected platforms in order', () => {
    expect(PRACTICE_LINKS.map((l) => l.id)).toEqual(['codechef', 'hackerrank', 'gfg', 'atcoder']);
  });

  it('links out via real https URLs with labels + honest reasons', () => {
    for (const l of PRACTICE_LINKS) {
      expect(l.browseUrl).toMatch(/^https:\/\//);
      expect(l.browseLabel.trim().length).toBeGreaterThan(0);
      expect(l.whyNoCatalog.trim().length).toBeGreaterThan(0);
      expect(l.name.trim().length).toBeGreaterThan(0);
    }
  });

  it('points at the real practice hubs (no invented deep links)', () => {
    const byId = Object.fromEntries(PRACTICE_LINKS.map((l) => [l.id, l.browseUrl]));
    expect(byId.codechef).toContain('codechef.com/practice');
    expect(byId.hackerrank).toContain('hackerrank.com/domains/algorithms');
    expect(byId.gfg).toContain('geeksforgeeks.org/explore');
    expect(byId.atcoder).toContain('atcoder.jp/contests');
  });

  it('is honest about no live catalog', () => {
    expect(PRACTICE_LINKS_NOTICE.toLowerCase()).toContain('no live catalog');
  });

  it('credits the AtCoder community snapshot + library (not a problems API)', () => {
    expect(ATCODER_SNAPSHOT_URL).toContain('kenkoooo.com/atcoder');
    expect(ATCODER_SNAPSHOT_RAW_URL).toContain('merged-problems.json');
    expect(ATCODER_LIBRARY_URL).toContain('ac-library');
  });
});
