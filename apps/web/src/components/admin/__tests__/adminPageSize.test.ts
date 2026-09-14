/**
 * Admin users page-size (10/25/50/100, default 50, URL-synced, cap 100).
 * RED: normalizeAdminPageSize does not exist yet; buildAdminUserQuery must
 * carry limit (backend cap 100, was 50). Selection must clear on page/filter/
 * sort change (user wish replaces cross-page persistence).
 */
import { describe, it, expect } from 'vitest'
import { buildAdminUserQuery, normalizeAdminPageSize, ADMIN_PAGE_SIZE_OPTIONS, DEFAULT_ADMIN_PAGE_SIZE } from '../bulkHelpers'

describe('admin page-size options', () => {
  it('exposes_10_25_50_100_default_50', () => {
    expect(ADMIN_PAGE_SIZE_OPTIONS).toEqual([10, 25, 50, 100])
    expect(DEFAULT_ADMIN_PAGE_SIZE).toBe(50)
  })
})

describe('normalizeAdminPageSize URL parsing', () => {
  it('defaults_50_on_absent_invalid', () => {
    expect(normalizeAdminPageSize(undefined)).toBe(50)
    expect(normalizeAdminPageSize(null)).toBe(50)
    expect(normalizeAdminPageSize('')).toBe(50)
    expect(normalizeAdminPageSize('abc')).toBe(50)
    expect(normalizeAdminPageSize('30')).toBe(50)
    expect(normalizeAdminPageSize('200')).toBe(50)
    expect(normalizeAdminPageSize('0')).toBe(50)
  })
  it('accepts_whitelisted_10_25_50_100', () => {
    expect(normalizeAdminPageSize('10')).toBe(10)
    expect(normalizeAdminPageSize('25')).toBe(25)
    expect(normalizeAdminPageSize('50')).toBe(50)
    expect(normalizeAdminPageSize('100')).toBe(100)
    expect(normalizeAdminPageSize(100)).toBe(100)
  })
})

describe('buildAdminUserQuery carries limit (cap 100)', () => {
  it('students_query_limit_100', () => {
    const q = buildAdminUserQuery('STUDENT', 'all', 1, 100, { q: '' }, 'c1', { field: 'name', order: 'asc' })
    expect(q).toMatchObject({ limit: 100 })
  })
  it('students_query_limit_10', () => {
    const q = buildAdminUserQuery('STUDENT', 'all', 2, 10, {}, 'c1')
    expect(q).toMatchObject({ page: 2, limit: 10 })
  })
})
