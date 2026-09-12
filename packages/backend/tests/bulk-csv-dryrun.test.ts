/**
 * #11 bulk CSV import (dry-run): pure CSV parse + local validation + dry-run
 * service paths. Hermetic (no DB): fake db asserts dry-run performs reads
 * only (createMany must never be called) and returns per-row reports.
 */
import { describe, it, expect, vi } from 'vitest'
import { parseCsv, validateRowsLocal, csvTemplate, MAX_CSV_ROWS } from '../src/utils/csvImport'
import { dryRunBulkTeachers, dryRunBulkStudents } from '../src/services/adminBulk'

describe('parseCsv', () => {
  it('parseCsv_valid_header_maps_aliases (dept/year/studentId)', () => {
    const rows = parseCsv('name,email,dept,year,studentId\nAarav,a@x.edu,"Computer Science",2024,STU1')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'Aarav', email: 'a@x.edu', department: 'Computer Science', incomingYear: '2024', studentId: 'STU1' })
  })
  it('parseCsv_quoted_commas_preserved', () => {
    const rows = parseCsv('name,email,department\n"Sharma, Jane",j@x.edu,"CSE, Honors"')
    expect(rows[0].name).toBe('Sharma, Jane')
    expect(rows[0].department).toBe('CSE, Honors')
  })
  it('parseCsv_missing_email_header_throws', () => {
    expect(() => parseCsv('name,department\nA,CSE')).toThrow(/email/)
  })
  it('parseCsv_missing_name_header_throws', () => {
    expect(() => parseCsv('email,department\na@x.edu,CSE')).toThrow(/name/)
  })
  it('parseCsv_empty_throws', () => {
    expect(() => parseCsv('   ')).toThrow(/empty/)
  })
  it('parseCsv_header_only_throws', () => {
    expect(() => parseCsv('name,email\n')).toThrow(/header row plus/)
  })
  it('parseCsv_caps_at_MAX_CSV_ROWS', () => {
    const lines = ['name,email', ...Array.from({ length: MAX_CSV_ROWS + 50 }, (_, i) => `N${i},n${i}@x.edu`)]
    expect(parseCsv(lines.join('\n'))).toHaveLength(MAX_CSV_ROWS)
  })
  it('csvTemplate_has_required_headers', () => {
    expect(csvTemplate('teacher')).toContain('name,email')
    expect(csvTemplate('student')).toContain('incomingYear')
  })
})

describe('validateRowsLocal', () => {
  it('validateRowsLocal_valid_rows_have_no_issues', () => {
    const issues = validateRowsLocal([{ name: 'A', email: 'a@x.edu' }], 'student')
    expect(issues[0].errors).toEqual([])
  })
  it('validateRowsLocal_flags_bad_email_missing_name_dupes', () => {
    const issues = validateRowsLocal(
      [
        { name: '', email: 'bad' },
        { name: 'B', email: 'b@x.edu' },
        { name: 'B2', email: 'B@x.edu' },
      ],
      'student',
    )
    expect(issues[0].errors).toContain('Invalid email format')
    expect(issues[0].errors).toContain('Name is required')
    expect(issues[2].errors).toContain('Duplicate email in upload')
  })
  it('validateRowsLocal_flags_bad_year_and_short_password', () => {
    const issues = validateRowsLocal([{ name: 'A', email: 'a@x.edu', incomingYear: 'abc', password: 'short' }], 'student')
    expect(issues[0].errors).toContain('Invalid incomingYear value')
    expect(issues[0].errors).toContain('Password must be 8-72 characters')
  })
})

function fakeDb(opts: { existing?: string[]; depts?: Array<{ id: string; collegeId: string; name: string }> } = {}) {
  return {
    user: {
      findMany: vi.fn(async () => (opts.existing ?? []).map((email) => ({ email }))),
      createMany: vi.fn(async () => {
        throw new Error('dry-run must not write')
      }),
    },
    department: {
      findMany: vi.fn(async (args: any) => {
        const all = opts.depts ?? []
        if (args?.where?.id?.in) return all.filter((d) => args.where.id.in.includes(d.id))
        if (args?.where?.collegeId) return all.filter((d) => d.collegeId === args.where.collegeId)
        return all
      }),
    },
  } as any
}

describe('dryRunBulkTeachers', () => {
  it('dryRun_valid_rows_reported_valid_no_writes', async () => {
    const db = fakeDb({ depts: [{ id: 'd1', collegeId: 'c1', name: 'Computer Science' }] })
    const res = await dryRunBulkTeachers('c1', [{ name: 'J', email: 'j@x.edu', department: 'Computer Science' }], db)
    expect(res.total).toBe(1)
    expect(res.validCount).toBe(1)
    expect(res.invalidCount).toBe(0)
    expect(res.rows[0].valid).toBe(true)
    expect(db.user.createMany).not.toHaveBeenCalled()
  })
  it('dryRun_flags_dupes_unknown_dept_existing', async () => {
    const db = fakeDb({ existing: ['taken@x.edu'], depts: [{ id: 'd1', collegeId: 'c1', name: 'CSE' }] })
    const res = await dryRunBulkTeachers(
      'c1',
      [
        { name: 'A', email: 'taken@x.edu' },
        { name: 'B', email: 'b@x.edu', department: 'Nope' },
        { name: 'C', email: 'b@x.edu' },
        { name: '', email: 'c@x.edu' },
      ],
      db,
    )
    expect(res.validCount).toBe(0)
    expect(res.invalidCount).toBe(4)
    expect(res.errors.join('\n')).toMatch(/already exists/)
    expect(res.errors.join('\n')).toMatch(/Unknown department/)
    expect(res.errors.join('\n')).toMatch(/Duplicate email in upload/)
    expect(db.user.createMany).not.toHaveBeenCalled()
  })
})

describe('dryRunBulkStudents', () => {
  it('dryRun_invalid_year_reported_no_writes', async () => {
    const db = fakeDb()
    const res = await dryRunBulkStudents('c1', [{ name: 'A', email: 'a@x.edu', incomingYear: 'nope' }], db)
    expect(res.validCount).toBe(0)
    expect(res.rows[0].errors).toContain('Invalid incomingYear value')
    expect(db.user.createMany).not.toHaveBeenCalled()
  })
})
