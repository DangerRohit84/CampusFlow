// packages/backend/tests/leaderboard-sort-guard.test.ts — TDD RED for H1 sort-return + M1 CSV compat guard.
// WHY (dev-lead CHANGES_REQUESTED H1): sortLeaderboardGroups is PURE (returns [...groups].sort,
// no mutation). Calling it without using the return leaves `groups` in DB groupBy insertion
// order — leaderboard order WRONG in prod. This guard locks that the route USES the sorted return.
// Run: npx vitest run tests/leaderboard-sort-guard.test.ts
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function readRoute(): string {
  return fs.readFileSync(path.join(__dirname, '../src/routes/codingProfile.ts'), 'utf8')
}

describe('leaderboard route uses sorted return (H1)', () => {
  it('assigns sortLeaderboardGroups return instead of discarding', () => {
    const src = readRoute()
    // Pure-return discipline: [...x].sort() never mutates — must assign.
    expect(src).toMatch(/const\s+sorted\s*=\s*sortLeaderboardGroups\s*\(/)
  })
  it('paginates + maps from the sorted array (not the raw groups)', () => {
    const src = readRoute()
    expect(src).toContain('sorted.length')
    expect(src).toContain('sorted.slice(')
    // pageGroups must derive from sorted, not groups.slice
    expect(src).not.toMatch(/const\s+pageGroups\s*=\s*groups\.slice/)
  })
  it('pure helper does not mutate input (proves discard is a bug)', () => {
    // Documents WHY the guard above is load-bearing: if the helper mutated,
    // discarding would be harmless. It does not — so discard breaks order.
    // This is a contract lock on leaderboardRating.ts purity.
    const svc = fs.readFileSync(path.join(__dirname, '../src/services/leaderboardRating.ts'), 'utf8')
    expect(svc).toContain('return [...groups].sort(')
  })
})
