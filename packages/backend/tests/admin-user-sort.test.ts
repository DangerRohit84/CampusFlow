/**
 * Admin user-list sorting (sortable columns: Name, Email, Roll Number).
 * Hermetic pure tests (no DB):
 * - normalizeUserListSort whitelists name/email/studentId/empNumber only
 *   (case-insensitive, trims; invalid/absent -> 'name' default per spec)
 * - normalizeUserListOrder allows asc/desc only (default asc)
 * - buildUserListOrderBy returns stable Prisma orderBy ([{field: dir}, {id: dir}])
 *   so pagination stays deterministic; never injects non-whitelisted fields.
 * Backward compat: absent sort -> name asc (same shape, new default order).
 */
import { describe, it, expect } from 'vitest'
import {
  normalizeUserListSort,
  normalizeUserListOrder,
  buildUserListOrderBy,
  USER_LIST_SORT_FIELDS,
} from '../src/utils/userFilters'

describe('admin user-list sort whitelist', () => {
  it('whitelists_only_name_email_studentId_empNumber', () => {
    expect([...USER_LIST_SORT_FIELDS].sort()).toEqual(
      ['email', 'empNumber', 'name', 'studentId'].sort(),
    )
  })
  it('normalizeSort_accepts_whitelisted_case_insensitive', () => {
    expect(normalizeUserListSort('name')).toBe('name')
    expect(normalizeUserListSort(' Email ')).toBe('email')
    expect(normalizeUserListSort('STUDENTID')).toBe('studentId')
    expect(normalizeUserListSort('empnumber')).toBe('empNumber')
  })
  it('normalizeSort_rejects_non_whitelisted_to_default_name', () => {
    expect(normalizeUserListSort(undefined)).toBe('name')
    expect(normalizeUserListSort('')).toBe('name')
    expect(normalizeUserListSort('passwordHash')).toBe('name')
    expect(normalizeUserListSort('createdAt')).toBe('name')
    expect(normalizeUserListSort('role; DROP TABLE users')).toBe('name')
  })
  it('normalizeOrder_asc_desc_only_default_asc', () => {
    expect(normalizeUserListOrder(undefined)).toBe('asc')
    expect(normalizeUserListOrder('')).toBe('asc')
    expect(normalizeUserListOrder('asc')).toBe('asc')
    expect(normalizeUserListOrder('DESC')).toBe('desc')
    expect(normalizeUserListOrder(' Asc ')).toBe('asc')
    expect(normalizeUserListOrder('random')).toBe('asc')
    expect(normalizeUserListOrder('desc; DROP')).toBe('asc')
  })
})

describe('buildUserListOrderBy stable pagination', () => {
  it('default_name_asc_with_id_tiebreaker', () => {
    expect(buildUserListOrderBy('name', 'asc')).toEqual([{ name: 'asc' }, { id: 'asc' }])
  })
  it('email_desc_with_id_tiebreaker', () => {
    expect(buildUserListOrderBy('email', 'desc')).toEqual([{ email: 'desc' }, { id: 'asc' }])
  })
  it('studentId_roll_sort', () => {
    expect(buildUserListOrderBy('studentId', 'asc')).toEqual([{ studentId: 'asc' }, { id: 'asc' }])
  })
  it('empNumber_teacher_sort', () => {
    expect(buildUserListOrderBy('empNumber', 'desc')).toEqual([{ empNumber: 'desc' }, { id: 'asc' }])
  })
})
