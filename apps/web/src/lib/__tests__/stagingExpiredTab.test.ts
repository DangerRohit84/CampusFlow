/**
 * Expired tab + no-moderation for expired (AdminOpportunitiesPage).
 * Spec (fix: expired still showing in pending): pending/all/approved EXCLUDE
 * expired (expired only in Expired tab); rejected KEEPS expired (appears in
 * both rejected and expired); expired rows show only View Details
 * (no Approve/Reject); Hide checkbox removed.
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  isStagingExpired,
  filterStagingExpiredOnly,
  filterStagingFreshOnly,
  canModerateStagingItem,
  computeAdjustedStagingTabCounts,
} from '../stagingExpiry'

// Fixed clock: 28 Sept 2026 00:00 UTC.
const NOW_28_SEPT = new Date('2026-09-28T00:00:00.000Z').getTime()

describe('expired tab filtering keeps expired in both status + expired', () => {
  it('pending expired appears in expired tab', () => {
    const items = [
      { id: 'pending-expired', status: 'PENDING', deadline: '2026-09-17', _isExpired: true },
      { id: 'pending-fresh', status: 'PENDING', deadline: '2026-10-05', _isExpired: false },
    ]
    const expired = filterStagingExpiredOnly(items, NOW_28_SEPT)
    expect(expired.map((i) => i.id)).toEqual(['pending-expired'])
  })

  it('rejected expired appears in expired tab AND stays in rejected', () => {
    const items = [
      { id: 'rejected-expired', status: 'REJECTED', deadline: '2026-09-18', _isExpired: true },
      { id: 'rejected-fresh', status: 'REJECTED', deadline: '2026-10-05', _isExpired: false },
    ]
    // Expired tab shows only expired.
    const expired = filterStagingExpiredOnly(items, NOW_28_SEPT)
    expect(expired.map((i) => i.id)).toEqual(['rejected-expired'])
    // Rejected tab keeps expired (no hiding): source still expired.
    expect(isStagingExpired('2026-09-18', NOW_28_SEPT)).toBe(true)
  })

  it('expired tab recomputes from deadline when _isExpired stamp missing', () => {
    const items = [
      { id: 'hackophobia', status: 'PENDING', deadline: '2026-09-17' },
      { id: 'fresh-future', status: 'PENDING', deadline: '2026-10-05' },
    ]
    expect(filterStagingExpiredOnly(items, NOW_28_SEPT).map((i) => i.id)).toEqual([
      'hackophobia',
    ])
  })

  it('expired tab sorts newest expired first (deadline desc)', () => {
    const items = [
      { id: 'hackophobia', deadline: '2026-09-17' },
      { id: 'devhack', deadline: '2026-09-18' },
    ]
    expect(filterStagingExpiredOnly(items, NOW_28_SEPT).map((i) => i.id)).toEqual([
      'devhack',
      'hackophobia',
    ])
  })
})

describe('pending/all/approved exclude expired, rejected keeps expired (fix: expired still showing in pending)', () => {
  it('pending excludes expired (fresh only)', () => {
    const items = [
      { id: 'pending-expired', status: 'PENDING', deadline: '2026-09-17', _isExpired: true },
      { id: 'pending-fresh', status: 'PENDING', deadline: '2026-10-05', _isExpired: false },
    ]
    expect(filterStagingFreshOnly(items, NOW_28_SEPT).map((i) => i.id)).toEqual([
      'pending-fresh',
    ])
  })

  it('all/approved exclude expired via fresh-only filter', () => {
    const items = [
      { id: 'old', deadline: '2026-09-17', _isExpired: true },
      { id: 'fresh-a', deadline: '2026-10-05', _isExpired: false },
      { id: 'fresh-b', deadline: '2026-10-06', _isExpired: false },
    ]
    expect(filterStagingFreshOnly(items, NOW_28_SEPT).map((i) => i.id)).toEqual([
      'fresh-a',
      'fresh-b',
    ])
  })

  it('fresh-only recomputes from deadline when _isExpired stamp missing', () => {
    const items = [
      { id: 'hackophobia', status: 'PENDING', deadline: '2026-09-17' },
      { id: 'fresh-future', status: 'PENDING', deadline: '2026-10-05' },
    ]
    expect(filterStagingFreshOnly(items, NOW_28_SEPT).map((i) => i.id)).toEqual([
      'fresh-future',
    ])
  })

  it('null deadline is fresh (fail-open, never blank queue)', () => {
    const items = [{ id: 'no-deadline', deadline: null } as any]
    expect(filterStagingFreshOnly(items, NOW_28_SEPT).map((i) => i.id)).toEqual([
      'no-deadline',
    ])
  })

  it('expired tab still shows ONLY expired (regression guard)', () => {
    const items = [
      { id: 'pending-expired', status: 'PENDING', deadline: '2026-09-17', _isExpired: true },
      { id: 'pending-fresh', status: 'PENDING', deadline: '2026-10-05', _isExpired: false },
    ]
    expect(filterStagingExpiredOnly(items, NOW_28_SEPT).map((i) => i.id)).toEqual([
      'pending-expired',
    ])
  })

  it('AdminOpportunitiesPage pending/all/approved filter out expired, rejected keeps expired', () => {
    const pagePath = path.resolve(__dirname, '../../pages/AdminOpportunitiesPage.tsx')
    const src = fs.readFileSync(pagePath, 'utf8')
    // Pending/all/approved must exclude expired (fresh-only filter).
    expect(src).toContain('filterStagingFreshOnly')
    // Rejected tab keeps expired (still sorted bottom, not filtered).
    expect(src).toContain('sortStagingWithExpiredBottom')
    // Expired tab still only expired.
    expect(src).toContain('filterStagingExpiredOnly')
  })

  it('AdminOpportunitiesPage badges exclude expired for fresh tabs (counts mismatch fix)', () => {
    const pagePath = path.resolve(__dirname, '../../pages/AdminOpportunitiesPage.tsx')
    const src = fs.readFileSync(pagePath, 'utf8')
    // Badges must not use raw API aggregates for fresh tabs — they must
    // adjust for expired (client-side) so Pending/All match fresh lists.
    expect(src).toContain('computeAdjustedStagingTabCounts')
  })
})

describe('tab counts exclude expired for fresh tabs (fix: All2/Pending2 vs Expired2 mismatch)', () => {
  it('2 expired pending -> pending 0, expired 2, all 0 (rejected untouched)', () => {
    const base = [
      { id: 'hackophobia', status: 'PENDING', deadline: '2026-09-17', _isExpired: true },
      { id: 'devhack', status: 'PENDING', deadline: '2026-09-18', _isExpired: true },
    ]
    const counts = computeAdjustedStagingTabCounts(
      base,
      { all: 2, pending: 2, approved: 0, rejected: 19 },
      NOW_28_SEPT,
    )
    expect(counts.pending).toBe(0)
    expect(counts.expired).toBe(2)
    expect(counts.all).toBe(0)
    expect(counts.rejected).toBe(19)
    expect(counts.approved).toBe(0)
  })

  it('fresh pending untouched, rejected keeps expired', () => {
    const base = [
      { id: 'fresh-a', status: 'PENDING', deadline: '2026-10-05', _isExpired: false },
      { id: 'rejected-expired', status: 'REJECTED', deadline: '2026-09-18', _isExpired: true },
    ]
    const counts = computeAdjustedStagingTabCounts(
      base,
      { all: 5, pending: 3, approved: 1, rejected: 19 },
      NOW_28_SEPT,
    )
    // 1 expired total (rejected) -> all 5-1=4, pending 3-0=3 (no pending expired),
    // approved 1-0=1, rejected stays 19, expired 1.
    expect(counts.all).toBe(4)
    expect(counts.pending).toBe(3)
    expect(counts.approved).toBe(1)
    expect(counts.rejected).toBe(19)
    expect(counts.expired).toBe(1)
  })

  it('never goes negative (clamps at 0)', () => {
    const base = [
      { id: 'stale-page', status: 'PENDING', deadline: '2026-09-17', _isExpired: true },
    ]
    const counts = computeAdjustedStagingTabCounts(
      base,
      { all: 0, pending: 0, approved: 0, rejected: 0 },
      NOW_28_SEPT,
    )
    expect(counts.pending).toBe(0)
    expect(counts.all).toBe(0)
    expect(counts.approved).toBe(0)
    expect(counts.expired).toBe(1)
  })

  it('recomputes expired from deadline when _isExpired stamp missing', () => {
    const base = [
      { id: 'hackophobia', status: 'PENDING', deadline: '2026-09-17' },
      { id: 'fresh-future', status: 'PENDING', deadline: '2026-10-05' },
    ]
    const counts = computeAdjustedStagingTabCounts(
      base,
      { all: 2, pending: 2, approved: 0, rejected: 0 },
      NOW_28_SEPT,
    )
    expect(counts.expired).toBe(1)
    expect(counts.pending).toBe(1)
    expect(counts.all).toBe(1)
  })
})

describe('expired rows have no Approve/Reject (View Details only)', () => {
  it('expired pending cannot be moderated', () => {
    expect(
      canModerateStagingItem({ _isExpired: true, deadline: '2026-09-17' }, NOW_28_SEPT),
    ).toBe(false)
  })

  it('expired rejected cannot be moderated', () => {
    expect(
      canModerateStagingItem({ _isExpired: true, deadline: '2026-09-18' }, NOW_28_SEPT),
    ).toBe(false)
  })

  it('deadline-only expired cannot be moderated (stamp missing)', () => {
    expect(canModerateStagingItem({ deadline: '2026-09-17' }, NOW_28_SEPT)).toBe(false)
  })

  it('fresh rows can be moderated', () => {
    expect(
      canModerateStagingItem({ _isExpired: false, deadline: '2026-10-05' }, NOW_28_SEPT),
    ).toBe(true)
  })

  it('null deadline is moderatable (fail-open)', () => {
    expect(canModerateStagingItem({ deadline: null }, NOW_28_SEPT)).toBe(true)
  })
})

describe('Hide expired checkbox removed', () => {
  it('AdminOpportunitiesPage has no Hide expired checkbox or hide logic', () => {
    const pagePath = path.resolve(__dirname, '../../pages/AdminOpportunitiesPage.tsx')
    const src = fs.readFileSync(pagePath, 'utf8')
    expect(src).not.toContain('Hide expired')
    expect(src).not.toContain('hideExpired')
    expect(src).not.toContain('filterStagingByHideExpired')
    expect(src).not.toContain('STAGING_HIDE_EXPIRED_KEY')
    expect(src).not.toContain('getHideExpiredDefault')
    expect(src).not.toContain('loadHideExpired')
    expect(src).not.toContain('saveHideExpired')
  })

  it('stagingExpiry no longer exports hide helpers', () => {
    const libPath = path.resolve(__dirname, '../stagingExpiry.ts')
    const src = fs.readFileSync(libPath, 'utf8')
    expect(src).not.toContain('filterStagingByHideExpired')
    expect(src).not.toContain('getHideExpiredDefault')
    expect(src).not.toContain('loadHideExpired')
    expect(src).not.toContain('saveHideExpired')
    expect(src).not.toContain('STAGING_HIDE_EXPIRED_KEY')
  })
})
