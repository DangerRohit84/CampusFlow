// components/admin/__tests__/bulkCsv.test.ts — #11 client CSV parse + template.
// WHY: the bulk-import modal parses CSV in-browser before the server dry-run;
// header aliases + quoted commas are locked here (pure, no DOM).
import { describe, it, expect } from 'vitest'
import { parseCsvClient, bulkTemplate } from '../BulkImportModal'

describe('parseCsvClient', () => {
  it('parses aliases (dept/year/studentId)', () => {
    const rows = parseCsvClient('name,email,dept,year,studentId\nAarav,a@x.edu,CSE,2024,STU1')
    expect(rows[0]).toMatchObject({ name: 'Aarav', email: 'a@x.edu', department: 'CSE', incomingYear: '2024', studentId: 'STU1' })
  })
  it('preserves quoted commas', () => {
    const rows = parseCsvClient('name,email,department\n"Sharma, Jane",j@x.edu,"CSE, Honors"')
    expect(rows[0].name).toBe('Sharma, Jane')
  })
  it('throws without email header', () => {
    expect(() => parseCsvClient('name,department\nA,CSE')).toThrow(/email/)
  })
  it('throws on empty input', () => {
    expect(() => parseCsvClient('  ')).toThrow(/empty/)
  })
})

describe('bulkTemplate', () => {
  it('has role-specific columns', () => {
    expect(bulkTemplate('TEACHER')).toContain('name,email')
    expect(bulkTemplate('STUDENT')).toContain('incomingYear')
  })
})
