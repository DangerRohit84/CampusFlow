/**
 * TDD RED: admin user-list filters (teacher dept display + dept/role filters).
 * Spec:
 * - GET /admin/users accepts ?departmentId= and ?role= (STUDENT|TEACHER|COLLEGE_ADMIN|SUPER_ADMIN)
 * - Missing/empty params = no filtering (backward compat, keeps pagination envelope)
 * - Invalid ?role= -> caller 400s (fail fast); unknown ?departmentId= just matches nothing
 * - Pure where-builder is hermetic (no DB) so these are Small tests (<100ms).
 */
import { describe, it, expect } from 'vitest'
import {
  normalizeRoleFilter,
  normalizeDepartmentFilter,
  applyUserListFilters,
} from '../src/utils/userFilters'

describe('normalizeRoleFilter', () => {
  it('roleFilter_missing_returns_null (no filtering, backward compat)', () => {
    expect(normalizeRoleFilter(undefined)).toBeNull()
    expect(normalizeRoleFilter('')).toBeNull()
    expect(normalizeRoleFilter('   ')).toBeNull()
  })
  it('roleFilter_validRole_returns_uppercase', () => {
    expect(normalizeRoleFilter('teacher')).toBe('TEACHER')
    expect(normalizeRoleFilter('STUDENT')).toBe('STUDENT')
    expect(normalizeRoleFilter(' college_admin ')).toBe('COLLEGE_ADMIN')
    expect(normalizeRoleFilter('super_admin')).toBe('SUPER_ADMIN')
  })
  it('roleFilter_unknown_returns_null (caller 400s)', () => {
    expect(normalizeRoleFilter('PRINCIPAL')).toBeNull()
    expect(normalizeRoleFilter('student,teacher')).toBeNull()
  })
})

describe('normalizeDepartmentFilter', () => {
  it('departmentFilter_missing_returns_null (no filtering)', () => {
    expect(normalizeDepartmentFilter(undefined)).toBeNull()
    expect(normalizeDepartmentFilter('')).toBeNull()
    expect(normalizeDepartmentFilter('   ')).toBeNull()
  })
  it('departmentFilter_id_returns_trimmed', () => {
    expect(normalizeDepartmentFilter('  dept-123  ')).toBe('dept-123')
  })
})

describe('applyUserListFilters', () => {
  const collegeWhere = { collegeId: 'college-1' }
  it('applyUserListFilters_noFilters_returns_base_where_untouched', () => {
    expect(applyUserListFilters(collegeWhere, {})).toEqual({ collegeId: 'college-1' })
    // Must not mutate the input object.
    expect(collegeWhere).toEqual({ collegeId: 'college-1' })
  })
  it('applyUserListFilters_role_adds_role', () => {
    expect(applyUserListFilters(collegeWhere, { role: 'TEACHER' })).toEqual({
      collegeId: 'college-1',
      role: 'TEACHER',
    })
  })
  it('applyUserListFilters_department_adds_departmentId', () => {
    expect(applyUserListFilters(collegeWhere, { departmentId: 'dept-9' })).toEqual({
      collegeId: 'college-1',
      departmentId: 'dept-9',
    })
  })
  it('applyUserListFilters_roleAndDepartment_combine (teachers of one dept)', () => {
    expect(
      applyUserListFilters(collegeWhere, { role: 'STUDENT', departmentId: 'dept-9' }),
    ).toEqual({ collegeId: 'college-1', role: 'STUDENT', departmentId: 'dept-9' })
  })
  it('applyUserListFilters_globalScope_keeps_global (super admin unscoped)', () => {
    expect(applyUserListFilters({}, { role: 'TEACHER' })).toEqual({ role: 'TEACHER' })
  })
})
