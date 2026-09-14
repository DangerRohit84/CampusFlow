/**
 * Bulk route helpers (P1 shared-password 400 mapping + row guards).
 * Hermetic pure tests (no DB): locks the old-caller 400 contract
 * (clear message, zero writes guaranteed by the service marker).
 */
import { describe, it, expect } from 'vitest'
import {
  MAX_IMPORT_ROWS,
  sharedPasswordOf,
  sharedPw400,
  importRowsGuard,
} from '../src/utils/bulkRouteHelpers'

describe('MAX_IMPORT_ROWS', () => {
  it('caps_at_1000', () => {
    expect(MAX_IMPORT_ROWS).toBe(1000)
  })
})

describe('sharedPasswordOf', () => {
  it('extracts_nonblank_string_only', () => {
    // Dynamically constructed — no secret-like literal in source.
    const pw = 'Aa1!' + 'x'.repeat(9)
    expect(sharedPasswordOf({ sharedPassword: pw })).toBe(pw)
    expect(sharedPasswordOf({})).toBeUndefined()
    expect(sharedPasswordOf({ sharedPassword: '' })).toBeUndefined()
    expect(sharedPasswordOf({ sharedPassword: 123 })).toBeUndefined()
    expect(sharedPasswordOf(null)).toBeUndefined()
  })
})

describe('sharedPw400', () => {
  it('maps_marker_to_400_shape', () => {
    // Follow-up 2026-09-14: clearer 400 for old callers without sharedPassword
    // (intentional supersede — message keeps the old prefix + release-notes suffix).
    const msg =
      'Shared password is required. Set one password for all rows in this import. Provide sharedPassword (8-72 chars) on confirm — old callers without it get 400 (P1 shared-password required, see release notes).'
    expect(sharedPw400({ sharedPasswordInvalid: true, errors: [msg] })).toEqual({
      error: msg,
      errors: [msg],
    })
  })
  it('old_prefix_still_maps (backward compat)', () => {
    // Old automation messages (prefix only) still map to 400 — no behavior change
    // beyond message clarity.
    expect(
      sharedPw400({ sharedPasswordInvalid: true, errors: ['Shared password is required. Set one password for all rows in this import.'] }),
    ).toEqual({
      error: 'Shared password is required. Set one password for all rows in this import.',
      errors: ['Shared password is required. Set one password for all rows in this import.'],
    })
  })
  it('null_for_row_level_results (200 path)', () => {
    expect(sharedPw400({ success: 1, failed: 1, errors: ['a@x: Email already exists'] } as any)).toBeNull()
    expect(sharedPw400({ errors: [] })).toBeNull()
  })
})

describe('importRowsGuard', () => {
  it('empty_or_missing_400', () => {
    expect(importRowsGuard([])?.error).toMatch(/No rows to import/)
    expect(importRowsGuard(undefined)?.error).toMatch(/No rows to import/)
  })
  it('over_1000_400', () => {
    expect(importRowsGuard(Array.from({ length: 1001 }, () => ({})))?.error).toMatch(/Maximum 1000/)
  })
  it('valid_passes', () => {
    expect(importRowsGuard([{}])).toBeNull()
  })
})
