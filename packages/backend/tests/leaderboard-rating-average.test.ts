// packages/backend/tests/leaderboard-rating-average.test.ts — TDD RED for average rating.
// WHY: college leaderboard must use AVERAGE (mean of available ratings, ignore
// nulls, fail-open) named "rating", not best/max. Sorting uses the average.
// API compat: old `bestRating` kept deprecated alongside new `rating` (no break).
// Run: npm run test -w @campusflow/backend -- leaderboard-rating-average
import { describe, it, expect } from 'vitest'
import {
  averageRatings,
  toLeaderboardRating,
  sortLeaderboardGroups,
  mapLeaderboardGroup,
} from '../src/services/leaderboardRating'

describe('averageRatings (mean of available, ignore nulls, fail-open)', () => {
  it('averages available platform/contest ratings', () => {
    expect(averageRatings([1500, 1800])).toBe(1650)
  })
  it('ignores null/undefined/NaN/Infinity', () => {
    expect(averageRatings([1500, null, undefined, NaN, Infinity as any, 1700])).toBe(1600)
  })
  it('fail-open null when none available', () => {
    expect(averageRatings([])).toBeNull()
    expect(averageRatings([null, undefined])).toBeNull()
  })
  it('single rating returns itself', () => {
    expect(averageRatings([1350])).toBe(1350)
  })
})

describe('toLeaderboardRating (DB _avg.rating -> display, fail-open 0)', () => {
  it('rounds finite averages', () => {
    expect(toLeaderboardRating(1650.4)).toBe(1650)
    expect(toLeaderboardRating(1650.6)).toBe(1651)
  })
  it('fail-open 0 for null/NaN/Infinity', () => {
    expect(toLeaderboardRating(null)).toBe(0)
    expect(toLeaderboardRating(undefined)).toBe(0)
    expect(toLeaderboardRating(NaN)).toBe(0)
    expect(toLeaderboardRating(Infinity)).toBe(0)
  })
})

describe('leaderboard sort uses average (ties deterministic, missing fail-open)', () => {
  it('sorts rating(avg) desc, then totalContests desc (positions by rating)', () => {
    const groups = [
      { userId: 'a', _count: { _all: 5 }, _avg: { rating: 1500 }, _max: { rating: 2000 } },
      { userId: 'b', _count: { _all: 5 }, _avg: { rating: 1700 }, _max: { rating: 1700 } },
      { userId: 'c', _count: { _all: 8 }, _avg: { rating: 1200 }, _max: { rating: 1200 } },
    ]
    const sorted = sortLeaderboardGroups(groups as any).map((g: any) => g.userId)
    // rating-primary: b (1700) first despite fewer contests than c; c (1200) last
    // (higher average, not max — a has max 2000 but avg 1500 so second)
    expect(sorted).toEqual(['b', 'a', 'c'])
  })
  it('ties on contests+average break deterministically (userId asc)', () => {
    const groups = [
      { userId: 'b', _count: { _all: 3 }, _avg: { rating: 1500 }, _max: { rating: 1500 } },
      { userId: 'a', _count: { _all: 3 }, _avg: { rating: 1500 }, _max: { rating: 1500 } },
    ]
    const sorted = sortLeaderboardGroups(groups as any).map((g: any) => g.userId)
    expect(sorted).toEqual(['a', 'b'])
  })
  it('missing average sorts as 0 (fail-open)', () => {
    const groups = [
      { userId: 'a', _count: { _all: 3 }, _avg: { rating: null }, _max: { rating: null } },
      { userId: 'b', _count: { _all: 3 }, _avg: { rating: 1400 }, _max: { rating: 1400 } },
    ]
    const sorted = sortLeaderboardGroups(groups as any).map((g: any) => g.userId)
    expect(sorted[0]).toBe('b')
  })
})

describe('mapLeaderboardGroup adds rating alongside deprecated bestRating', () => {
  it('emits rating (avg rounded) + bestRating (max, deprecated)', () => {
    const g: any = { userId: 'u1', _count: { _all: 4 }, _avg: { rank: 12.4, rating: 1650.6 }, _max: { rating: 1900 } }
    const u: any = { name: 'A', department: { name: 'CSE' }, departmentId: 'd1', incomingYear: 2023, avatar: null }
    const row = mapLeaderboardGroup(g, u)
    expect(row.rating).toBe(1651)
    expect(row.bestRating).toBe(1900) // deprecated compat
    expect(row.totalContests).toBe(4)
    expect(row.avgRank).toBe(12)
  })
  it('null average maps to 0 rating (fail-open, displays as —)', () => {
    const row = mapLeaderboardGroup(
      { userId: 'u2', _count: { _all: 1 }, _avg: { rank: null, rating: null }, _max: { rating: null } } as any,
      null,
    )
    expect(row.rating).toBe(0)
    expect(row.bestRating).toBe(0)
  })
})
