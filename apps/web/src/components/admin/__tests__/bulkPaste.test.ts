// components/admin/__tests__/bulkPaste.test.ts — #11a paste-CSV path.
// WHY: the modal's "paste CSV" textarea feeds the same parseCsvClient as file
// upload, but pasted text carries BOM/CRLF/blank-line quirks from spreadsheets.
// Locks that pasted input parses identically to uploaded files.
import { describe, it, expect } from 'vitest'
import { parseCsvClient } from '../BulkImportModal'

describe('parseCsvClient (paste path)', () => {
  it('handles BOM + CRLF + blank lines from spreadsheet paste', () => {
    const pasted = '﻿name,email,department\r\n\r\n"Aarav Kumar",aarav@college.edu,"Computer Science"\r\n\r\n'
    const rows = parseCsvClient(pasted)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'Aarav Kumar', email: 'aarav@college.edu' })
  })
  it('parses multi-row paste with template header', () => {
    const pasted = 'name,email,department,incomingYear,studentId\nA,a@x.edu,CSE,2024,STU1\nB,b@x.edu,CSE,2023,STU2'
    const rows = parseCsvClient(pasted)
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({ incomingYear: '2023', studentId: 'STU2' })
  })
  it('throws friendly error on header-only paste', () => {
    expect(() => parseCsvClient('name,email\n')).toThrow(/header row plus/)
  })
})
