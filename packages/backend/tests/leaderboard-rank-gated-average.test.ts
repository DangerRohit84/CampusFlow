// packages/backend/tests/leaderboard-rank-gated-average.test.ts — TDD RED for rank-gated average.
// WHY (issue #2): average must only include platforms where rank exists.
// If platform has rating but no rank, skip it. Solved SUM unchanged.
// Fail-open null when none ranked.
// Run: npx vitest run tests/leaderboard-rank-gated-average.test.ts
import { describe, it, expect } from 'vitest'
import {
  averagePlatformRatings,
  hasRankForAverage,
} from '../src/services/leaderboardRating'

describe('hasRankForAverage (rank present, not null/0)', () => {
  it('true when rankTitle present', () => {
    expect(hasRankForAverage({ platform: 'codeforces', rating: 1500, valid: true, rankTitle: 'Expert' } as any)).toBe(true)
  })
  it('true when globalRank > 0', () => {
    expect(hasRankForAverage({ platform: 'codechef', rating: 1700, valid: true, globalRank: 1234 } as any)).toBe(true)
  })
  it('true when stars/division present (CodeChef)', () => {
    expect(hasRankForAverage({ platform: 'codechef', rating: 1700, valid: true, stars: 3 } as any)).toBe(true)
    expect(hasRankForAverage({ platform: 'codechef', rating: 1700, valid: true, division: 'Div 2' } as any)).toBe(true)
  })
  it('false when no rank fields (rating alone insufficient)', () => {
    expect(hasRankForAverage({ platform: 'codeforces', rating: 1500, valid: true } as any)).toBe(false)
    expect(hasRankForAverage({ platform: 'codechef', rating: 1700, valid: true, globalRank: null } as any)).toBe(false)
    expect(hasRankForAverage({ platform: 'codechef', rating: 1700, valid: true, globalRank: 0 } as any)).toBe(false)
    expect(hasRankForAverage({ platform: 'codechef', rating: 1700, valid: true, countryRank: 0 } as any)).toBe(false)
  })
})

describe('averagePlatformRatings rank-gated (skip unranked)', () => {
  it('skips rating without rank', () => {
    const stats = [
      { platform: 'codeforces', rating: 1500, valid: true }, // no rank -> skip
      { platform: 'codechef', rating: 1700, valid: true, globalRank: 100 },
    ] as any
    expect(averagePlatformRatings(stats)).toBe(1700)
  })
  it('averages only ranked platforms', () => {
    const stats = [
      { platform: 'codeforces', rating: 1500, valid: true, rankTitle: 'Expert' },
      { platform: 'codechef', rating: 1700, valid: true, globalRank: 50 },
      { platform: 'codeforces', rating: 1900, valid: true }, // unranked -> skip
    ] as any
    // (1500 + 1700) / 2 = 1600, NOT (1500+1700+1900)/3
    expect(averagePlatformRatings(stats)).toBe(1600)
  })
  it('fail-open null when none ranked', () => {
    expect(averagePlatformRatings([{ platform: 'cf', rating: 1500, valid: true } as any])).toBeNull()
    expect(averagePlatformRatings([])).toBeNull()
  })
  it('ignores invalid entries even when ranked', () => {
    const stats = [
      { platform: 'codeforces', rating: 1500, valid: false, rankTitle: 'Expert' },
      { platform: 'codechef', rating: 1700, valid: true, globalRank: 10 },
    ] as any
    expect(averagePlatformRatings(stats)).toBe(1700)
  })
})
