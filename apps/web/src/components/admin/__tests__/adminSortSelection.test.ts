/**
 * Admin users sorting + cross-page selection (sortable columns, URL-synced).
 * Hermetic pure tests (no DOM):
 * - getSortableColumns(role) returns per-tab columns (students name/email/
 *   studentId; teachers name/email/empNumber; admins name/email)
 * - normalizeAdminSort parses ?sort=&order= (whitelisted, default name asc)
 * - nextSortOrder toggles asc<->desc (first click on new column -> asc)
 * - buildAdminUserQuery includes sort/order (additive, old backend ignores)
 * - mergeSelection caps at 500 with capped flag (cross-page persistence)
 */
import { describe, it, expect } from 'vitest'
import {
  getSortableColumns,
  normalizeAdminSort,
  nextSortOrder,
  mergeSelection,
  MAX_BULK_SELECTION,
  buildAdminUserQuery,
} from '../bulkHelpers'

describe('getSortableColumns per-tab', () => {
  it('students_name_email_studentId', () => {
    expect(getSortableColumns('STUDENT').map((c) => c.field)).toEqual(['name', 'email', 'studentId'])
  })
  it('teachers_name_email_empNumber', () => {
    expect(getSortableColumns('TEACHER').map((c) => c.field)).toEqual(['name', 'email', 'empNumber'])
  })
  it('admins_name_email_only', () => {
    expect(getSortableColumns('COLLEGE_ADMIN').map((c) => c.field)).toEqual(['name', 'email'])
  })
})

describe('normalizeAdminSort URL parsing', () => {
  it('defaults_name_asc_on_absent_invalid', () => {
    expect(normalizeAdminSort(undefined, undefined)).toEqual({ field: 'name', order: 'asc' })
    expect(normalizeAdminSort('passwordHash', 'desc')).toEqual({ field: 'name', order: 'desc' })
    expect(normalizeAdminSort('email', 'sideways')).toEqual({ field: 'email', order: 'asc' })
  })
  it('accepts_whitelisted_case_insensitive', () => {
    expect(normalizeAdminSort('Email', 'DESC')).toEqual({ field: 'email', order: 'desc' })
    expect(normalizeAdminSort('studentId', 'asc')).toEqual({ field: 'studentId', order: 'asc' })
  })
})

describe('nextSortOrder toggle', () => {
  it('same_column_toggles', () => {
    expect(nextSortOrder('name', 'asc', 'name')).toBe('desc')
    expect(nextSortOrder('name', 'desc', 'name')).toBe('asc')
  })
  it('new_column_starts_asc', () => {
    expect(nextSortOrder('name', 'desc', 'email')).toBe('asc')
  })
})

describe('buildAdminUserQuery includes sort (additive)', () => {
  it('students_query_carries_sort_order', () => {
    const q = buildAdminUserQuery('STUDENT', 'all', 1, 50, { q: '' }, 'c1', { field: 'email', order: 'desc' })
    expect(q).toMatchObject({ sort: 'email', order: 'desc' })
  })
  it('omits_sort_when_absent_backend_defaults_name_asc', () => {
    // Backward compat: old callers omit sort (backend defaults to name asc);
    // AdminPage always passes its URL-synced sort explicitly (see above test).
    const q = buildAdminUserQuery('STUDENT', 'all', 1, 50, {}, 'c1')
    expect(q).not.toHaveProperty('sort')
    expect(q).not.toHaveProperty('order')
  })
})

describe('mergeSelection cross-page cap 500', () => {
  it('caps_at_500', () => {
    expect(MAX_BULK_SELECTION).toBe(500)
  })
  it('merges_deduped', () => {
    const r = mergeSelection(['a'], ['b', 'c'])
    expect(r.selected.sort()).toEqual(['a', 'b', 'c'])
    expect(r.capped).toBe(false)
  })
  it('truncates_at_cap_with_flag', () => {
    const base = Array.from({ length: 499 }, (_, i) => `id-${i}`)
    const r = mergeSelection(base, ['new-1', 'new-2', 'new-3'])
    expect(r.selected).toHaveLength(500)
    expect(r.capped).toBe(true)
    expect(r.selected).toContain('new-1')
  })
  it('dedupes_existing_before_cap', () => {
    const base = ['a', 'b']
    const r = mergeSelection(base, ['b', 'c'])
    expect(r.selected.sort()).toEqual(['a', 'b', 'c'])
    expect(r.capped).toBe(false)
  })
})
