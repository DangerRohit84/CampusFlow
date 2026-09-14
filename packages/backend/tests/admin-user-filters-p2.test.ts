/**
 * P2 user-list filters (per-tab search+filters composing with pagination).
 * Hermetic pure tests (no DB):
 * - normalize helpers (search slice, studentId/roll alias handled by caller,
 *   empNumber, email, incomingYear range + invalid flag)
 * - applyUserListFilters builds Prisma AND (contains+insensitive, year equality)
 * - backward compat: absent = no filter (old behavior, base where untouched)
 * - contract helper: students list where == counts where under student filters
 *   (mirrors route wiring: list adds role, counts group by role, rest identical)
 */
import { describe, it, expect } from 'vitest'
import {
  normalizeSearch,
  normalizeStudentId,
  normalizeEmpNumber,
  normalizeEmailFilter,
  normalizeIncomingYear,
  applyUserListFilters,
} from '../src/utils/userFilters'

describe('P2 normalize helpers', () => {
  it('search_trims_slices100_absent_null', () => {
    expect(normalizeSearch(undefined)).toBeNull()
    expect(normalizeSearch('   ')).toBeNull()
    expect(normalizeSearch('  aarav ')).toBe('aarav')
    expect(normalizeSearch('x'.repeat(150))).toHaveLength(100)
  })
  it('studentId_empNumber_email_trim_absent_null', () => {
    expect(normalizeStudentId(undefined)).toBeNull()
    expect(normalizeStudentId(' STU001 ')).toBe('STU001')
    expect(normalizeEmpNumber(' EMP9 ')).toBe('EMP9')
    expect(normalizeEmailFilter(' a@x.edu ')).toBe('a@x.edu')
    expect(normalizeEmailFilter('')).toBeNull()
  })
  it('incomingYear_valid_range_invalid_flag', () => {
    const nowY = new Date().getFullYear()
    expect(normalizeIncomingYear('2024')).toEqual({ value: 2024, invalid: false })
    expect(normalizeIncomingYear('')).toEqual({ value: null, invalid: false })
    expect(normalizeIncomingYear(undefined)).toEqual({ value: null, invalid: false })
    expect(normalizeIncomingYear('nope')).toEqual({ value: null, invalid: true })
    expect(normalizeIncomingYear('1800')).toEqual({ value: null, invalid: true })
    expect(normalizeIncomingYear(String(nowY + 7))).toEqual({ value: null, invalid: true })
    expect(normalizeIncomingYear(String(nowY + 6))).toEqual({ value: nowY + 6, invalid: false })
  })
})

describe('P2 applyUserListFilters composition', () => {
  const base = { collegeId: 'c1' }
  it('absent_filters_old_behavior', () => {
    expect(applyUserListFilters(base, {})).toEqual({ collegeId: 'c1' })
    expect(applyUserListFilters(base, { search: null, studentId: null, empNumber: null, email: null, incomingYear: null })).toEqual({ collegeId: 'c1' })
  })
  it('student_filters_AND_together', () => {
    expect(
      applyUserListFilters(base, { role: 'STUDENT', search: 'aarav', studentId: 'STU00', incomingYear: 2024, departmentId: 'd1' }),
    ).toEqual({
      collegeId: 'c1',
      role: 'STUDENT',
      departmentId: 'd1',
      AND: [
        { name: { contains: 'aarav', mode: 'insensitive' } },
        { studentId: { contains: 'STU00', mode: 'insensitive' } },
        { incomingYear: 2024 },
      ],
    })
  })
  it('teacher_filters_no_year_control', () => {
    const where = applyUserListFilters(base, { role: 'TEACHER', search: 'sharma', empNumber: 'EMP9' })
    expect(where).toEqual({
      collegeId: 'c1',
      role: 'TEACHER',
      AND: [
        { name: { contains: 'sharma', mode: 'insensitive' } },
        { empNumber: { contains: 'EMP9', mode: 'insensitive' } },
      ],
    })
  })
  it('admin_email_filter', () => {
    const where = applyUserListFilters(base, { role: 'COLLEGE_ADMIN', email: 'dean@' })
    expect(where).toEqual({
      collegeId: 'c1',
      role: 'COLLEGE_ADMIN',
      AND: [{ email: { contains: 'dean@', mode: 'insensitive' } }],
    })
  })
  it('does_not_mutate_base', () => {
    const b = { collegeId: 'c1' }
    applyUserListFilters(b, { search: 'x' })
    expect(b).toEqual({ collegeId: 'c1' })
  })
})

describe('P2 list/counts parity contract', () => {
  it('students_list_where_matches_counts_where_plus_role', () => {
    // Mirrors routes/admin.ts wiring: list adds {role}, counts group by role —
    // every other filter must be identical or badges disagree with the list.
    const base = { collegeId: 'c1' }
    const shared = {
      departmentId: 'd1',
      search: 'aarav',
      studentId: 'STU00',
      empNumber: null,
      email: null,
      incomingYear: 2024,
    } as const
    const listWhere = applyUserListFilters(base, { ...shared, role: 'STUDENT' })
    const countsWhere = applyUserListFilters(base, { ...shared })
    expect(countsWhere).toEqual({
      collegeId: 'c1',
      departmentId: 'd1',
      AND: [
        { name: { contains: 'aarav', mode: 'insensitive' } },
        { studentId: { contains: 'STU00', mode: 'insensitive' } },
        { incomingYear: 2024 },
      ],
    })
    // List = counts + role only.
    const { role: _r, ...listRest } = listWhere as Record<string, unknown>
    expect(listRest).toEqual(countsWhere)
  })
})
