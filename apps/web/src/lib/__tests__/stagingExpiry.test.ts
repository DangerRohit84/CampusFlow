/**
 * Approach B RED: expired staging visibility (AdminOpportunitiesPage).
 * Tests isExpired mirror + sort/filter + badge/approve helpers BEFORE impl.
 * See packages/backend/src/services/opportunities/expiry.ts (SSOT).
 */
import { describe, it, expect } from 'vitest'
import {
  isStagingExpired,
  getExpiredDaysAgo,
  formatExpiredLabel,
  sortStagingWithExpiredBottom,
  filterStagingByHideExpired,
  getHideExpiredDefault,
  buildApproveExpiredMessage,
} from '../stagingExpiry'

// Fixed clock: 28 Sept 2026 00:00 UTC (after HackOphobia 17 Sept + DEVHACK 18 Sept).
const NOW_28_SEPT = new Date('2026-09-28T00:00:00.000Z').getTime()

describe('isStagingExpired mirrors backend isExpiredByDeadline', () => {
  it('returns false for null/undefined/empty (fail-open)', () => {
    expect(isStagingExpired(null, NOW_28_SEPT)).toBe(false)
    expect(isStagingExpired(undefined, NOW_28_SEPT)).toBe(false)
    expect(isStagingExpired('', NOW_28_SEPT)).toBe(false)
  })

  it('returns false for invalid date (fail-open)', () => {
    expect(isStagingExpired('not-a-date', NOW_28_SEPT)).toBe(false)
  })

  it('marks 2026-09-17 date-only as expired on 2026-09-28 (HackOphobia)', () => {
    expect(isStagingExpired('2026-09-17', NOW_28_SEPT)).toBe(true)
  })

  it('marks 2026-09-18 date-only as expired on 2026-09-28 (DEVHACK)', () => {
    expect(isStagingExpired('2026-09-18', NOW_28_SEPT)).toBe(true)
  })

  it('keeps future date-only as fresh', () => {
    expect(isStagingExpired('2026-10-05', NOW_28_SEPT)).toBe(false)
  })

  it('treats date-only as 23:59 IST end-of-day (deadline day stays visible)', () => {
    // 2026-09-28T23:59+05:30 = 2026-09-28T18:29Z. Mid-day UTC => fresh, late UTC => expired.
    const midDayUtc = new Date('2026-09-28T10:00:00.000Z').getTime()
    const lateUtc = new Date('2026-09-28T19:00:00.000Z').getTime()
    expect(isStagingExpired('2026-09-28', midDayUtc)).toBe(false)
    expect(isStagingExpired('2026-09-28', lateUtc)).toBe(true)
  })

  it('handles full ISO datetimes by instant comparison', () => {
    expect(isStagingExpired('2026-09-01T00:00:00.000Z', NOW_28_SEPT)).toBe(true)
    expect(isStagingExpired('2026-10-01T00:00:00.000Z', NOW_28_SEPT)).toBe(false)
  })
})

describe('expired label helpers', () => {
  it('computes days ago for 17 Sept on 28 Sept as 10d', () => {
    expect(getExpiredDaysAgo('2026-09-17', NOW_28_SEPT)).toBe(10)
  })

  it('returns 0 for fresh deadlines', () => {
    expect(getExpiredDaysAgo('2026-10-05', NOW_28_SEPT)).toBe(0)
  })

  it('formats Expired Xd ago label for expired rows', () => {
    expect(formatExpiredLabel('2026-09-17', NOW_28_SEPT)).toBe('Expired 10d ago')
  })

  it('returns empty string for fresh rows', () => {
    expect(formatExpiredLabel('2026-10-05', NOW_28_SEPT)).toBe('')
  })
})

describe('sortStagingWithExpiredBottom', () => {
  it('keeps fresh first (stable) and expired bottom sorted deadline desc', () => {
    const items = [
      { id: 'hackophobia', deadline: '2026-09-17' },
      { id: 'fresh-future', deadline: '2026-10-05' },
      { id: 'devhack', deadline: '2026-09-18' },
    ]
    const sorted = sortStagingWithExpiredBottom(items, NOW_28_SEPT)
    expect(sorted.map((i) => i.id)).toEqual(['fresh-future', 'devhack', 'hackophobia'])
  })

  it('preserves fresh order when no expired rows', () => {
    const items = [
      { id: 'a', deadline: '2026-10-05' },
      { id: 'b', deadline: '2026-10-06' },
    ]
    expect(sortStagingWithExpiredBottom(items, NOW_28_SEPT).map((i) => i.id)).toEqual(['a', 'b'])
  })
})

describe('filterStagingByHideExpired', () => {
  it('hides expired rows when toggle ON', () => {
    const items = [
      { id: 'fresh', _isExpired: false },
      { id: 'old', _isExpired: true },
    ]
    expect(filterStagingByHideExpired(items, true).map((i) => i.id)).toEqual(['fresh'])
  })

  it('keeps all rows when toggle OFF (college admin see-all)', () => {
    const items = [
      { id: 'fresh', _isExpired: false },
      { id: 'old', _isExpired: true },
    ]
    expect(filterStagingByHideExpired(items, false).map((i) => i.id)).toEqual(['fresh', 'old'])
  })

  it('hides deadline-only expired rows with no _isExpired stamp (leak fix)', () => {
    // WHY: AdminOpportunitiesPage stamps _isExpired, but pagination stale or
    // mapping gaps can leave deadline-only rows. Filter must recompute.
    const items = [
      { id: 'hackophobia', deadline: '2026-09-17' },
      { id: 'fresh-future', deadline: '2026-10-05' },
    ]
    expect(filterStagingByHideExpired(items, true, NOW_28_SEPT).map((i) => i.id)).toEqual([
      'fresh-future',
    ])
  })

  it('hides expired ISO and Date deadlines without stamp (DEVHACK edge)', () => {
    const items = [
      { id: 'devhack-iso', deadline: '2026-09-18T00:00:00.000Z' },
      { id: 'devhack-date', deadline: new Date('2026-09-18T00:00:00.000Z') },
      { id: 'fresh', deadline: '2026-10-05' },
    ]
    expect(filterStagingByHideExpired(items, true, NOW_28_SEPT).map((i) => i.id)).toEqual(['fresh'])
  })

  it('keeps fresh deadline-only rows when hide ON', () => {
    const items = [{ id: 'fresh', deadline: '2026-10-05' }]
    expect(filterStagingByHideExpired(items, true, NOW_28_SEPT).map((i) => i.id)).toEqual(['fresh'])
  })

  it('keeps null-deadline rows when hide ON (fail-open)', () => {
    const items = [{ id: 'no-deadline', deadline: null }]
    expect(filterStagingByHideExpired(items, true, NOW_28_SEPT).map((i) => i.id)).toEqual([
      'no-deadline',
    ])
  })
})

describe('getHideExpiredDefault', () => {
  it('defaults ON for TEACHER (cleaner queue)', () => {
    expect(getHideExpiredDefault('TEACHER')).toBe(true)
  })

  it('defaults ON for COLLEGE_ADMIN/SUPER_ADMIN (hide expired by default, toggle OFF for see-all)', () => {
    expect(getHideExpiredDefault('COLLEGE_ADMIN')).toBe(true)
    expect(getHideExpiredDefault('SUPER_ADMIN')).toBe(true)
  })

  it('defaults ON for unknown roles (avoids OFF flash while auth loads)', () => {
    expect(getHideExpiredDefault(undefined)).toBe(true)
    expect(getHideExpiredDefault(null)).toBe(true)
  })
})

describe('buildApproveExpiredMessage', () => {
  it('warns deadline passed with formatted date and approve-anyway prompt', () => {
    const msg = buildApproveExpiredMessage('2026-09-18')
    expect(msg).toContain('Deadline passed')
    expect(msg).toContain('18')
    expect(msg).toContain('Approve anyway?')
  })
})
