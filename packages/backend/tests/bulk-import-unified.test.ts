/**
 * #11a unified import: POST /admin/users/import role + row extraction.
 * Hermetic (no DB): resolveBulkImportRole / extractImportRows are pure, so
 * these are Small tests (<100ms). The route delegates to the same
 * dry-run and bulk-create services covered by bulk-csv-dryrun.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { resolveBulkImportRole, extractImportRows } from '../src/utils/csvImport'

describe('resolveBulkImportRole', () => {
  it('resolveRole_explicit_body_role_wins (case-insensitive)', () => {
    expect(resolveBulkImportRole({ role: 'teacher' }, {})).toBe('TEACHER')
    expect(resolveBulkImportRole({ role: ' STUDENT ' }, { role: 'TEACHER' })).toBe('STUDENT')
  })
  it('resolveRole_type_alias_and_plural_tolerated', () => {
    expect(resolveBulkImportRole({ type: 'teachers' }, {})).toBe('TEACHER')
    expect(resolveBulkImportRole({}, { role: 'students' })).toBe('STUDENT')
    expect(resolveBulkImportRole({}, { type: 'TEACHER' })).toBe('TEACHER')
  })
  it('resolveRole_unknown_explicit_returns_null (route 400s)', () => {
    expect(resolveBulkImportRole({ role: 'PRINCIPAL' }, {})).toBeNull()
    expect(resolveBulkImportRole({}, { role: 'admin' })).toBeNull()
  })
  it('resolveRole_infers_from_payload_shape', () => {
    expect(resolveBulkImportRole({ teachers: [{ email: 'a@x.edu' }] }, {})).toBe('TEACHER')
    expect(resolveBulkImportRole({ students: [{ email: 'a@x.edu' }] }, {})).toBe('STUDENT')
  })
  it('resolveRole_defaults_student (semester onboarding compat)', () => {
    expect(resolveBulkImportRole({}, {})).toBe('STUDENT')
    expect(resolveBulkImportRole({ rows: [] }, {})).toBe('STUDENT')
    expect(resolveBulkImportRole(null, null)).toBe('STUDENT')
  })
})

describe('extractImportRows', () => {
  it('extractRows_role_specific_arrays', () => {
    const t = extractImportRows({ teachers: [{ email: 't@x.edu' }] }, 'TEACHER')
    expect(t).toHaveLength(1)
    const s = extractImportRows({ students: [{ email: 's@x.edu' }] }, 'STUDENT')
    expect(s).toHaveLength(1)
  })
  it('extractRows_generic_rows_array', () => {
    const rows = extractImportRows({ rows: [{ email: 'a@x.edu', name: 'A' }] }, 'STUDENT')
    expect(rows).toMatchObject([{ email: 'a@x.edu', name: 'A' }])
  })
  it('extractRows_csv_text_parsed (dept/year aliases)', () => {
    const rows = extractImportRows(
      { csv: 'name,email,dept,year\nAarav,a@x.edu,CSE,2024' },
      'STUDENT',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ department: 'CSE', incomingYear: '2024' })
  })
  it('extractRows_unparseable_csv_returns_empty (route 400s, never throws)', () => {
    expect(extractImportRows({ csv: 'name,department\nA,CSE' }, 'STUDENT')).toEqual([])
    expect(extractImportRows({}, 'TEACHER')).toEqual([])
    expect(extractImportRows(null, 'STUDENT')).toEqual([])
  })
})
