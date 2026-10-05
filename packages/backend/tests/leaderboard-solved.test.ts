// packages/backend/tests/leaderboard-solved.test.ts — TDD RED for solved count (sum, not average).
// WHY: college leaderboard must show Solved = SUM of platformStats.problemsSolved
// (total, not mean). Rating is average; solved is total. Uses existing totalSolved
// logic (publicProfile.ts + CodingProfilePage: sum valid problemsSolved, fail-open 0).
// Sorting stays rating-primary (totalContests desc, rating avg desc); solved display only.
// Run: npm run test -w @campusflow/backend -- leaderboard-solved
import { describe, it, expect } from 'vitest'
import {
  totalSolvedFromPlatformStats,
  mapLeaderboardGroup,
} from '../src/services/leaderboardRating'

describe('totalSolvedFromPlatformStats (SUM, fail-open 0)', () => {
  it('sums problemsSolved across valid platforms (total, not average)', () => {
    const stats = [
      { platform: 'leetcode', valid: true, problemsSolved: 150 },
      { platform: 'codeforces', valid: true, problemsSolved: 80 },
      { platform: 'codechef', valid: true, problemsSolved: 20 },
    ]
    // 150 + 80 + 20 = 250 (mean would be ~83 — must NOT average)
    expect(totalSolvedFromPlatformStats(stats)).toBe(250)
  })
  it('ignores invalid platforms (valid === false)', () => {
    const stats = [
      { platform: 'leetcode', valid: true, problemsSolved: 100 },
      { platform: 'codeforces', valid: false, problemsSolved: 999 },
    ]
    expect(totalSolvedFromPlatformStats(stats)).toBe(100)
  })
  it('fail-open 0 for null/undefined/empty', () => {
    expect(totalSolvedFromPlatformStats(null)).toBe(0)
    expect(totalSolvedFromPlatformStats(undefined)).toBe(0)
    expect(totalSolvedFromPlatformStats([])).toBe(0)
    expect(totalSolvedFromPlatformStats([null, undefined] as any)).toBe(0)
  })
  it('parses legacy JSON string rows (Json|String dual-read)', () => {
    const raw = JSON.stringify([
      { platform: 'leetcode', valid: true, problemsSolved: 10 },
      { platform: 'gfg', valid: true, problemsSolved: 5 },
    ])
    expect(totalSolvedFromPlatformStats(raw)).toBe(15)
  })
  it('ignores non-numeric problemsSolved (fail-open, no string concat)', () => {
    const stats = [
      { platform: 'leetcode', valid: true, problemsSolved: 50 },
      { platform: 'codeforces', valid: true, problemsSolved: 'oops' },
      { platform: 'gfg', valid: true },
    ] as any
    expect(totalSolvedFromPlatformStats(stats)).toBe(50)
  })
})

describe('mapLeaderboardGroup adds username + totalSolved (additive, fail-open)', () => {
  it('emits username + totalSolved alongside rating/bestRating', () => {
    const g: any = { userId: 'u1', _count: { _all: 4 }, _avg: { rank: 12.4, rating: 1650.6 }, _max: { rating: 1900 } }
    const u: any = { name: 'A', username: 'alex_johnson', department: { name: 'CSE' }, departmentId: 'd1', incomingYear: 2023, avatar: null }
    const stats = [{ platform: 'leetcode', valid: true, problemsSolved: 120 }]
    const row = mapLeaderboardGroup(g, u, stats)
    expect(row.username).toBe('alex_johnson')
    expect(row.totalSolved).toBe(120)
    // Existing contract intact (additive-only)
    expect(row.rating).toBe(1651)
    expect(row.bestRating).toBe(1900)
  })
  it('null username + missing stats fail-open (null + 0, no throw)', () => {
    const row = mapLeaderboardGroup(
      { userId: 'u2', _count: { _all: 1 }, _avg: { rank: null, rating: null }, _max: { rating: null } } as any,
      null,
      null,
    )
    expect(row.username).toBeNull()
    expect(row.totalSolved).toBe(0)
    expect(row.rating).toBe(0)
  })
  it('omitted stats param fail-opens to 0 (backward compat)', () => {
    const g: any = { userId: 'u3', _count: { _all: 2 }, _avg: { rating: 1500 }, _max: { rating: 1600 } }
    const u: any = { name: 'B', username: 'bob', department: { name: 'IT' } }
    const row = (mapLeaderboardGroup as any)(g, u)
    expect(row.totalSolved).toBe(0)
    expect(row.username).toBe('bob')
  })
})
