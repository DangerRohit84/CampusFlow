// components/admin/__tests__/bulkSharedPassword.test.ts — P1 + P2 + P3 + bulk-pw.
// WHY: locks the shared-password contract shift (no password column, warn+ignore
// legacy, strength/confirm/selection/year math) as hermetic vitest (<100ms, no DOM).
import { describe, it, expect } from 'vitest'
import { parseCsvClient, bulkTemplate } from '../BulkImportModal'
import {
  passwordStrengthScore,
  validateSharedPasswordLocal,
  generateSharedPasswordLocal,
  confirmMatches,
  toggleSelected,
  pageSelectionState,
  yearOptions,
  emptyStateCopy,
  stripPasswordColumn,
  sampleEmails,
} from '../bulkHelpers'

describe('bulkTemplate (P1: no password column)', () => {
  it('teacher_template_has_no_password', () => {
    const t = bulkTemplate('TEACHER')
    expect(t).toContain('name,email,department,empNumber')
    expect(t).not.toMatch(/password/i)
  })
  it('student_template_has_no_password', () => {
    const t = bulkTemplate('STUDENT')
    expect(t).toContain('incomingYear')
    expect(t).not.toMatch(/password/i)
  })
})

describe('parseCsvClient + stripPasswordColumn (legacy warn+ignore)', () => {
  it('legacy_password_header_parsed_then_stripped', () => {
    const rows = parseCsvClient('name,email,password\nA,a@x.edu,oldsecret')
    expect(rows[0]).toMatchObject({ password: 'oldsecret' })
    const { cleaned, hadColumn, ignoredCount } = stripPasswordColumn(rows)
    expect(hadColumn).toBe(true)
    expect(ignoredCount).toBe(1)
    expect(cleaned[0]).not.toHaveProperty('password')
    expect(cleaned[0]).toMatchObject({ name: 'A', email: 'a@x.edu' })
  })
  it('clean_rows_untouched_no_warn', () => {
    const rows = parseCsvClient('name,email,department\nA,a@x.edu,CSE')
    const { cleaned, hadColumn, ignoredCount } = stripPasswordColumn(rows)
    expect(hadColumn).toBe(false)
    expect(ignoredCount).toBe(0)
    expect(cleaned).toEqual(rows)
  })
})

describe('passwordStrengthScore (mirrors BE 0–4)', () => {
  it('scores_weak_and_strong', () => {
    // Hermetic synthetic fixture — dynamically constructed so no secret-like
    // literal exists in source. Scores 4 (length+mixed+digit+symbol).
    const strongSynthetic = 'Aa1!' + 'x'.repeat(9)
    expect(passwordStrengthScore('').score).toBe(0)
    expect(passwordStrengthScore(strongSynthetic).score).toBe(4)
    expect(passwordStrengthScore('abcdefgh').score).toBeLessThan(2)
  })
})

describe('validateSharedPasswordLocal (client hint, BE authoritative)', () => {
  it('rejects_short_common_accepts_strong', () => {
    const strongSynthetic = 'Aa1!' + 'x'.repeat(9)
    expect(validateSharedPasswordLocal('short')).toEqual(['Password must be 8-72 characters'])
    expect(validateSharedPasswordLocal('password123')).toEqual(['Password is too common, choose a stronger password'])
    expect(validateSharedPasswordLocal(strongSynthetic)).toEqual([])
  })
})

describe('generateSharedPasswordLocal', () => {
  it('matches_BE_shape_12b64_plus_A1', () => {
    const pw = generateSharedPasswordLocal()
    expect(pw.endsWith('A1!')).toBe(true)
    expect(pw.length).toBe(15)
    expect(validateSharedPasswordLocal(pw)).toEqual([])
  })
  it('generates_unique_values', () => {
    expect(generateSharedPasswordLocal()).not.toBe(generateSharedPasswordLocal())
  })
})

describe('confirmMatches (RESET N / DELETE N exact)', () => {
  it('exact_match_only', () => {
    expect(confirmMatches('RESET 5', 'RESET', 5)).toBe(true)
    expect(confirmMatches('reset 5', 'RESET', 5)).toBe(false)
    expect(confirmMatches('RESET 4', 'RESET', 5)).toBe(false)
    expect(confirmMatches('DELETE 3', 'DELETE', 3)).toBe(true)
    expect(confirmMatches('DELETE 3 ', 'DELETE', 3)).toBe(true)
    expect(confirmMatches('RESET 5', 'DELETE', 5)).toBe(false)
  })
})

describe('selection math (P3 checkbox col)', () => {
  it('toggleSelected_adds_removes_deduped', () => {
    expect(toggleSelected([], 'a')).toEqual(['a'])
    expect(toggleSelected(['a', 'b'], 'a')).toEqual(['b'])
    expect(toggleSelected(['a'], 'b')).toEqual(['a', 'b'])
  })
  it('pageSelectionState_all_some_none', () => {
    expect(pageSelectionState(['a', 'b'], ['a', 'b'])).toEqual({ all: true, some: false })
    expect(pageSelectionState(['a', 'b'], ['a'])).toEqual({ all: false, some: true })
    expect(pageSelectionState(['a', 'b'], [])).toEqual({ all: false, some: false })
    expect(pageSelectionState([], [])).toEqual({ all: false, some: false })
  })
})

describe('yearOptions (1990..now+6)', () => {
  it('descending_bounded', () => {
    const opts = yearOptions()
    const nowY = new Date().getFullYear()
    expect(opts[0]).toBe(String(nowY + 6))
    expect(opts[opts.length - 1]).toBe('1990')
  })
})

describe('emptyStateCopy (per-tab)', () => {
  it('copies_match_plan', () => {
    expect(emptyStateCopy('students', 'aarav')).toContain('No students match')
    expect(emptyStateCopy('teachers', '')).toBe('No teachers yet')
    expect(emptyStateCopy('college_admins', 'dean')).toContain('No college admins match')
  })
})

describe('sampleEmails (confirm modals, no secrets)', () => {
  it('first5_plus_more', () => {
    const users = Array.from({ length: 7 }, (_, i) => ({ email: `u${i}@x.edu` }))
    const { sample, more } = sampleEmails(users)
    expect(sample).toHaveLength(5)
    expect(more).toBe(2)
    expect(JSON.stringify({ sample, more })).not.toMatch(/password/i)
  })
})
