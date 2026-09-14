// components/admin/__tests__/adminFilters.test.ts — P2 per-tab filter wiring.
// WHY: locks plan §2 composition (students name+roll+year+dept, teachers
// name+emp+dept NO year, admins name+email, counts parity, backward compat
// absent=no filter) as hermetic vitest. Hooks delegate to these pure builders
// so tab switches can never leak `year` into teachers or `roll` into admins.
import { describe, it, expect } from 'vitest'
import {
  buildAdminUserQuery,
  buildAdminRoleCountsQuery,
} from '../bulkHelpers'

describe('buildAdminUserQuery (P2 per-tab composition)', () => {
  it('students_send_search_roll_year_dept', () => {
    expect(
      buildAdminUserQuery('STUDENT', 'd1', 1, 50, { q: ' aarav ', roll: ' STU00 ', year: '2024', email: '' }, 'c1'),
    ).toEqual({
      collegeId: 'c1',
      role: 'STUDENT',
      departmentId: 'd1',
      page: 1,
      limit: 50,
      search: 'aarav',
      studentId: 'STU00',
      incomingYear: 2024,
    })
  })
  it('teachers_send_emp_not_year (NO Year control)', () => {
    const q = buildAdminUserQuery('TEACHER', 'd1', 1, 50, { q: 'sharma', roll: 'EMP9', year: '2024', email: '' }, 'c1')
    expect(q).toMatchObject({ role: 'TEACHER', search: 'sharma', empNumber: 'EMP9' })
    expect(q).not.toHaveProperty('incomingYear')
    expect(q).not.toHaveProperty('studentId')
  })
  it('admins_send_search_email_only (no roll/year)', () => {
    const q = buildAdminUserQuery('COLLEGE_ADMIN', 'all', 2, 50, { q: 'dean', roll: 'STU00', year: '2024', email: 'dean@x.edu' }, 'c1')
    expect(q).toMatchObject({ role: 'COLLEGE_ADMIN', search: 'dean', email: 'dean@x.edu', page: 2 })
    expect(q).not.toHaveProperty('studentId')
    expect(q).not.toHaveProperty('empNumber')
    expect(q).not.toHaveProperty('incomingYear')
    expect(q).not.toHaveProperty('departmentId')
  })
  it('absent_filters_backward_compat (no extra params)', () => {
    expect(buildAdminUserQuery('STUDENT', 'all', 1, 50, {}, 'c1')).toEqual({
      collegeId: 'c1',
      role: 'STUDENT',
      page: 1,
      limit: 50,
    })
  })
})

describe('buildAdminRoleCountsQuery (badges == list parity)', () => {
  it('students_counts_match_list_filters', () => {
    expect(
      buildAdminRoleCountsQuery('STUDENT', 'd1', { q: 'aarav', roll: 'STU00', year: '2024', email: '' }, 'c1'),
    ).toEqual({
      collegeId: 'c1',
      departmentId: 'd1',
      search: 'aarav',
      studentId: 'STU00',
      incomingYear: 2024,
    })
  })
  it('teachers_counts_never_send_year (parity with ignored list year)', () => {
    const q = buildAdminRoleCountsQuery('TEACHER', 'd1', { q: 'sharma', roll: 'EMP9', year: '2024', email: '' }, 'c1')
    expect(q).toMatchObject({ search: 'sharma', empNumber: 'EMP9' })
    expect(q).not.toHaveProperty('incomingYear')
  })
  it('admins_counts_never_send_roll_year', () => {
    const q = buildAdminRoleCountsQuery('COLLEGE_ADMIN', 'all', { q: 'dean', roll: 'x', year: '2024', email: 'dean@x.edu' }, 'c1')
    expect(q).toMatchObject({ search: 'dean', email: 'dean@x.edu' })
    expect(q).not.toHaveProperty('studentId')
    expect(q).not.toHaveProperty('empNumber')
    expect(q).not.toHaveProperty('incomingYear')
  })
})
