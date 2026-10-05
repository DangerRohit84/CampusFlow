// apps/web/src/lib/__tests__/rating-rank-gated.test.ts — TDD RED for rank-gated average.
// WHY (issue #2): average must only include platforms where rank exists.
// Rating without rank is skipped. Solved SUM unchanged (separate). Fail-open null.
import { describe, it, expect } from 'vitest';
import { averagePlatformRatings, hasRankForAverage } from '../rating';

describe('hasRankForAverage (rank present, not null/0)', () => {
  it('true when rankTitle present', () => {
    expect(hasRankForAverage({ rating: 1500, valid: true, rankTitle: 'Expert' } as any)).toBe(true);
  });
  it('true when globalRank > 0', () => {
    expect(hasRankForAverage({ rating: 1700, valid: true, globalRank: 1234 } as any)).toBe(true);
  });
  it('true when stars/division/countryRank present', () => {
    expect(hasRankForAverage({ rating: 1700, valid: true, stars: 3 } as any)).toBe(true);
    expect(hasRankForAverage({ rating: 1700, valid: true, division: 'Div 2' } as any)).toBe(true);
    expect(hasRankForAverage({ rating: 1600, valid: true, countryRank: 5 } as any)).toBe(true);
  });
  it('false when no rank fields (rating alone insufficient) + 0 treated as missing', () => {
    expect(hasRankForAverage({ rating: 1500, valid: true } as any)).toBe(false);
    expect(hasRankForAverage({ rating: 1700, valid: true, globalRank: null } as any)).toBe(false);
    expect(hasRankForAverage({ rating: 1700, valid: true, globalRank: 0 } as any)).toBe(false);
    expect(hasRankForAverage({ rating: 1700, valid: true, countryRank: 0 } as any)).toBe(false);
    expect(hasRankForAverage(null as any)).toBe(false);
  });
});

describe('averagePlatformRatings rank-gated (skip unranked)', () => {
  it('skips rating without rank', () => {
    const stats = [
      { platform: 'codeforces', rating: 1500, valid: true },
      { platform: 'codechef', rating: 1700, valid: true, globalRank: 100 },
    ] as any;
    expect(averagePlatformRatings(stats)).toBe(1700);
  });
  it('averages only ranked platforms', () => {
    const stats = [
      { platform: 'codeforces', rating: 1500, valid: true, rankTitle: 'Expert' },
      { platform: 'codechef', rating: 1700, valid: true, globalRank: 50 },
      { platform: 'codeforces', rating: 1900, valid: true },
    ] as any;
    expect(averagePlatformRatings(stats)).toBe(1600);
  });
  it('fail-open null when none ranked', () => {
    expect(averagePlatformRatings([{ platform: 'cf', rating: 1500, valid: true } as any])).toBeNull();
    expect(averagePlatformRatings([])).toBeNull();
  });
});
