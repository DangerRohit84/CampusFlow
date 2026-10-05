// packages/backend/tests/leaderboard-rating-primary.test.ts — TDD RED for rating-primary sort.
// WHY (issue #1): college leaderboard positions must follow rating(avg) desc,
// NOT contest count. Contests is secondary tie-break. Default rating desc.
// Run: npx vitest run tests/leaderboard-rating-primary.test.ts
import { describe, it, expect } from 'vitest'
import { sortLeaderboardGroups } from '../src/services/leaderboardRating'

describe('leaderboard sort rating-primary (positions by rating)', () => {
  it('higher rating wins even with fewer contests (rating primary)', () => {
    const groups = [
      { userId: 'low', _count: { _all: 10 }, _avg: { rating: 1200 }, _max: { rating: 1200 } },
      { userId: 'high', _count: { _all: 2 }, _avg: { rating: 1800 }, _max: { rating: 1800 } },
    ]
    const sorted = sortLeaderboardGroups(groups as any).map((g: any) => g.userId)
    // rating-primary: high (1800) first despite only 2 contests
    expect(sorted).toEqual(['high', 'low'])
  })
  it('tie on rating breaks by contests desc (secondary)', () => {
    const groups = [
      { userId: 'a', _count: { _all: 3 }, _avg: { rating: 1500 }, _max: { rating: 1500 } },
      { userId: 'b', _count: { _all: 7 }, _avg: { rating: 1500 }, _max: { rating: 1500 } },
    ]
    const sorted = sortLeaderboardGroups(groups as any).map((g: any) => g.userId)
    expect(sorted).toEqual(['b', 'a'])
  })
  it('tie on rating+contests breaks by userId asc (deterministic)', () => {
    const groups = [
      { userId: 'b', _count: { _all: 3 }, _avg: { rating: 1500 }, _max: { rating: 1500 } },
      { userId: 'a', _count: { _all: 3 }, _avg: { rating: 1500 }, _max: { rating: 1500 } },
    ]
    const sorted = sortLeaderboardGroups(groups as any).map((g: any) => g.userId)
    expect(sorted).toEqual(['a', 'b'])
  })
  it('missing average sorts as 0 (fail-open, last)', () => {
    const groups = [
      { userId: 'a', _count: { _all: 9 }, _avg: { rating: null }, _max: { rating: null } },
      { userId: 'b', _count: { _all: 1 }, _avg: { rating: 1400 }, _max: { rating: 1400 } },
    ]
    const sorted = sortLeaderboardGroups(groups as any).map((g: any) => g.userId)
    // b (1400) first despite fewer contests — null = 0 fail-open
    expect(sorted[0]).toBe('b')
  })
})
