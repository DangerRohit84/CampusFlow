/**
 * RED: Expired tab + no-moderation for expired (AdminOpportunitiesPage).
 * TDD RED step — these MUST fail before prod implementation.
 * Spec: expired stays visible in original status tab AND in expired tab;
 * expired rows show only View Details (no Approve/Reject); Hide checkbox removed.
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  isStagingExpired,
  filterStagingExpiredOnly,
  canModerateStagingItem,
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
