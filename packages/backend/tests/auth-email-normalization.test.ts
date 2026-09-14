/**
 * Auth email normalization (LOGIN EMAIL CASE fix).
 * Hermetic pure tests (no DB):
 * - normalizeEmail SSOT trims + lowercases consistently
 * - register/login lookup keys collide across case/whitespace variants
 *   (the reported bug: `Example@gmail.com` vs `example@gmail.com`)
 * - college adminEmail comparison matches across variants (trim was missing)
 * - lockout keys share the bucket across variants (authHardening already did)
 *
 * Unique-constraint note (documented, NOT migrated here — prod LIVE):
 * User.email is `@unique` (case-sensitive B-tree in Postgres), so legacy
 * mixed-case rows stay distinct keys until a backfill (lowercase all emails,
 * dedupe) + case-insensitive unique (citext or lower(email) index) lands.
 * Going forward every writer stores normalizeEmail() and every lookup queries
 * it, so no NEW mixed-case rows are created.
 */
import { describe, it, expect } from 'vitest'
import {
  normalizeEmail,
  isLockedOut,
  recordFailedLogin,
  recordSuccessfulLogin,
  clearAuthHardeningForTests,
} from '../src/utils/authHardening'

describe('normalizeEmail SSOT', () => {
  it('lowercases_and_trims', () => {
    expect(normalizeEmail('Example@gmail.com')).toBe('example@gmail.com')
    expect(normalizeEmail('  EXAMPLE@Gmail.COM  ')).toBe('example@gmail.com')
    expect(normalizeEmail('example@gmail.com')).toBe('example@gmail.com')
  })
  it('handles_non_string_and_empty', () => {
    expect(normalizeEmail(null)).toBe('')
    expect(normalizeEmail(undefined)).toBe('')
    expect(normalizeEmail('')).toBe('')
    expect(normalizeEmail(123 as any)).toBe('123')
  })
  it('register_login_variants_collide_to_same_key', () => {
    // The reported bug: stored vs login forms diverged by case.
    const stored = normalizeEmail('Example@gmail.com')
    for (const variant of [
      'example@gmail.com',
      'EXAMPLE@GMAIL.COM',
      '  example@GMAIL.com  ',
      'Example@Gmail.Com',
    ]) {
      expect(normalizeEmail(variant)).toBe(stored)
    }
  })
  it('college_adminEmail_match_trims_and_lowercases_both_sides', () => {
    // auth.ts COLLEGE_ADMIN flow previously did toLowerCase() without trim —
    // ` Example@x.com ` (college form) vs `example@x.com` (register) missed.
    const storedAdmin = normalizeEmail('  Admin@College.edu ')
    const registerInput = normalizeEmail('admin@college.EDU')
    expect(storedAdmin).toBe(registerInput)
    expect(storedAdmin).toBe('admin@college.edu')
  })
  it('lockout_bucket_shared_across_case_variants', () => {
    clearAuthHardeningForTests()
    try {
      // 5 fails on mixed-case variants share one normalized bucket → locked.
      recordFailedLogin('Example@gmail.com')
      recordFailedLogin('example@GMAIL.com')
      recordFailedLogin('  EXAMPLE@gmail.com')
      recordFailedLogin('example@gmail.COM')
      recordFailedLogin('eXaMpLe@gMaIl.cOm')
      expect(isLockedOut('example@gmail.com').locked).toBe(true)
      expect(isLockedOut('EXAMPLE@GMAIL.COM').locked).toBe(true)
      // Success on any variant clears the shared bucket.
      recordSuccessfulLogin('EXAMPLE@gmail.com')
      expect(isLockedOut('example@gmail.com').locked).toBe(false)
    } finally {
      clearAuthHardeningForTests()
    }
  })
})
