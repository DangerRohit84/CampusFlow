/**
 * CodingProfile tab-repeat guards (TAB REPEAT fix).
 * Pure hermetic tests (node env, no DOM):
 * - shouldFetchLeaderboard: fetch once per first visit / filter change,
 *   never on pure tab re-entry with identical filters.
 * - withTabVisited: lazy-mount-once set helper (new Set, no mutation).
 */
import { describe, it, expect } from 'vitest'
import { shouldFetchLeaderboard, withTabVisited } from '../codingTabs'

describe('shouldFetchLeaderboard', () => {
  it('fetches_on_first_leaderboard_visit', () => {
    expect(
      shouldFetchLeaderboard('leaderboard', { platform: 'all', departmentId: 'all' }, null),
    ).toBe(true)
    expect(
      shouldFetchLeaderboard('leaderboard', { platform: 'all', departmentId: 'all' }, undefined),
    ).toBe(true)
  })
  it('skips_pure_tab_reentry_with_identical_filters', () => {
    // THE reported bug: stats -> history -> leaderboard re-fetched even though
    // filters never changed. Guard must return false here.
    const last = { platform: 'all', departmentId: 'all' }
    expect(shouldFetchLeaderboard('leaderboard', { platform: 'all', departmentId: 'all' }, last)).toBe(false)
    expect(shouldFetchLeaderboard('leaderboard', { platform: 'codeforces', departmentId: 'd1' }, { platform: 'codeforces', departmentId: 'd1' })).toBe(false)
  })
  it('fetches_when_filters_change_on_leaderboard', () => {
    const last = { platform: 'all', departmentId: 'all' }
    expect(shouldFetchLeaderboard('leaderboard', { platform: 'leetcode', departmentId: 'all' }, last)).toBe(true)
    expect(shouldFetchLeaderboard('leaderboard', { platform: 'all', departmentId: 'd9' }, last)).toBe(true)
  })
  it('never_fetches_off_leaderboard_tab', () => {
    const last = { platform: 'all', departmentId: 'all' }
    for (const tab of ['stats', 'history', 'problems']) {
      expect(shouldFetchLeaderboard(tab, { platform: 'all', departmentId: 'all' }, null)).toBe(false)
      expect(shouldFetchLeaderboard(tab, { platform: 'x', departmentId: 'y' }, last)).toBe(false)
    }
  })
  it('case_variants_treated_as_distinct_filter_values', () => {
    // Filters are IDs/slugs (exact match); no normalization here by design.
    expect(
      shouldFetchLeaderboard('leaderboard', { platform: 'LeetCode', departmentId: 'all' }, { platform: 'leetcode', departmentId: 'all' }),
    ).toBe(true)
  })
})

describe('withTabVisited', () => {
  it('adds_first_visit_and_returns_new_set', () => {
    const prev = new Set(['stats'])
    const next = withTabVisited(prev, 'problems')
    expect(next.has('stats')).toBe(true)
    expect(next.has('problems')).toBe(true)
    expect(prev.has('problems')).toBe(false) // no mutation
    expect(next).not.toBe(prev)
  })
  it('repeat_visit_returns_equal_new_set', () => {
    const prev = new Set(['stats', 'problems'])
    const next = withTabVisited(prev, 'problems')
    expect([...next].sort()).toEqual(['problems', 'stats'])
    expect(next).not.toBe(prev)
  })
})
