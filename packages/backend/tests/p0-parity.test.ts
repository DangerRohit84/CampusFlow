/**
 * P0 parity harness — NOT full coverage.
 * Covers the three exploit classes that block ANY ship (F01–F05/F17):
 *   1. tenant gate (cross-college 403 via canAccessCollege)
 *   2. public email mask (maskEmail)
 *   3. filename sanitize (safeFilename / contentDisposition / escapeExcelValue)
 *
 * Pure unit tests — no DB, no network (hermetic, <100ms each).
 * Full API (supertest) + e2e (Playwright 10 paths, docs/seo.md) land next.
 */
import { describe, it, expect } from 'vitest'
import {
  canAccessCollege,
  deriveCollegeId,
  safeFilename,
  contentDisposition,
  escapeExcelValue,
  maskEmail,
} from '../src/utils/roles'

describe('tenant gate (F01-F04 P0 BOLA)', () => {
  const collegeA = '11111111-1111-4111-8111-111111111111'
  const collegeB = '22222222-2222-4222-8222-222222222222'

  it('cross-college access is denied (403 path)', () => {
    const studentA = { role: 'STUDENT', collegeId: collegeA }
    expect(canAccessCollege(studentA, collegeB)).toBe(false)
  })

  it('same-college access is allowed', () => {
    const teacherA = { role: 'TEACHER', collegeId: collegeA }
    expect(canAccessCollege(teacherA, collegeA)).toBe(true)
  })

  it('SUPER_ADMIN bypasses tenant check (global platform owner)', () => {
    const superAdmin = { role: 'SUPER_ADMIN', collegeId: null }
    expect(canAccessCollege(superAdmin, collegeA)).toBe(true)
    expect(canAccessCollege(superAdmin, collegeB)).toBe(true)
  })

  it('user without college cannot access tenant resource', () => {
    expect(canAccessCollege({ role: 'STUDENT', collegeId: null }, collegeA)).toBe(false)
  })

  it('deriveCollegeId ignores forged body collegeId for non-super-admins', () => {
    const studentA = { role: 'STUDENT', collegeId: collegeA }
    // Even if the request claims collegeB, a student stays pinned to their own college.
    expect(deriveCollegeId(studentA, collegeB)).toBe(collegeA)
  })
})

describe('public email mask (F05/W7 P0)', () => {
  it('masks local part to first char + ***', () => {
    expect(maskEmail('jane.doe@college.edu')).toBe('j***@college.edu')
  })

  it('single-char local still masks', () => {
    expect(maskEmail('a@x.edu')).toBe('a***@x.edu')
  })

  it('invalid / missing input returns safe fallback (no throw)', () => {
    expect(maskEmail(null)).toBeNull()
    expect(maskEmail(undefined)).toBeNull()
    expect(maskEmail('not-an-email')).toBe('***')
  })
})

describe('filename sanitize (F17 P0 header injection)', () => {
  it('strips CR/LF/quotes (response splitting)', () => {
    const out = safeFilename('evil\r\nContent-Length: 0".xlsx')
    expect(out).not.toMatch(/[\r\n"]/)
  })

  it('strips path separators', () => {
    expect(safeFilename('../../etc/passwd')).not.toMatch(/[\\/]/)
  })

  it('collapses whitespace to underscores and caps length', () => {
    expect(safeFilename('my  report  2024')).toBe('my_report_2024')
    expect(safeFilename('a'.repeat(500)).length).toBeLessThanOrEqual(100)
  })

  it('falls back on empty input', () => {
    expect(safeFilename('')).toBe('export')
    expect(safeFilename(null)).toBe('export')
  })

  it('contentDisposition emits filename + RFC5987 filename*', () => {
    const header = contentDisposition('hack responses.xlsx')
    expect(header).toContain('attachment;')
    expect(header).toContain('filename="hack_responses.xlsx"')
    expect(header).toContain("filename*=UTF-8''")
  })

  it('escapeExcelValue prefixes formula cells (F27 CSV injection)', () => {
    expect(escapeExcelValue('=1+1')).toBe("'=1+1")
    expect(escapeExcelValue('+cmd')).toBe("'+cmd")
    expect(escapeExcelValue('-2')).toBe("'-2")
    expect(escapeExcelValue('@sum')).toBe("'@sum")
    expect(escapeExcelValue('plain text')).toBe('plain text')
    expect(escapeExcelValue(42)).toBe(42)
  })
})
