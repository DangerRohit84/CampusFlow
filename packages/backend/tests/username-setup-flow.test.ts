/**
 * Username setup flow (TDD RED).
 * Covers: first-login prompt, setup free, 3 changes ok / 4th 403,
 * uniqueness (case-insensitive), admin-added auto gets prompt,
 * format validation reuse, SUPER_ADMIN exemption.
 * Hermetic pure tests (no DB) against src/utils/username.ts.
 */
import { describe, it, expect } from 'vitest'
import {
  MAX_USERNAME_CHANGES,
  sanitizeUsernameValue,
  isValidUsernameValue,
  needsUsernameSetup,
  canChangeUsername,
  remainingUsernameChanges,
  isUsernameChangeAllowed,
  isSameUsername,
} from '../src/utils/username'

describe('username format (reuse existing rules)', () => {
  it('accepts_valid_usernames', () => {
    expect(isValidUsernameValue('alex_99')).toBe(true)
    expect(isValidUsernameValue('a.b-c_d')).toBe(true)
  })
  it('rejects_short_long_bad_edges', () => {
    expect(isValidUsernameValue('ab')).toBe(false)
    expect(isValidUsernameValue('a'.repeat(21))).toBe(false)
    expect(isValidUsernameValue('_alex')).toBe(false)
    expect(isValidUsernameValue('alex_')).toBe(false)
  })
  it('sanitizes_to_lowercase_trimmed', () => {
    expect(sanitizeUsernameValue('  Alex_99 ')).toBe('alex_99')
    expect(sanitizeUsernameValue('A@B!C')).toBe('abc')
  })
})

describe('needsUsernameSetup (first-login prompt)', () => {
  it('true_when_username_missing', () => {
    expect(needsUsernameSetup({ username: null, usernameSetByUser: false } as any)).toBe(true)
  })
  it('true_when_auto_set_not_confirmed', () => {
    // admin-added / login-backfilled provisional: username exists but not user-chosen
    expect(needsUsernameSetup({ username: 'alex_99', usernameSetByUser: false } as any)).toBe(true)
  })
  it('false_when_user_confirmed', () => {
    expect(needsUsernameSetup({ username: 'alex_99', usernameSetByUser: true } as any)).toBe(false)
  })
  it('admin_added_auto_gets_prompt', () => {
    // collegeadmin single-create / bulk import create rows with username=null,
    // setByUser=false, count=0 -> must prompt on next login
    const adminCreated = { username: null, usernameSetByUser: false, usernameChangeCount: 0 } as any
    expect(needsUsernameSetup(adminCreated)).toBe(true)
    expect(remainingUsernameChanges(adminCreated)).toBe(3)
  })
})

describe('username change budget (max 3)', () => {  it('max_is_3', () => {
    expect(MAX_USERNAME_CHANGES).toBe(3)
  })
  it('setup_free_not_counted', () => {
    // first set via setup endpoint must NOT increment count
    const before = { username: 'auto_123', usernameSetByUser: false, usernameChangeCount: 0 } as any
    expect(canChangeUsername(before, 'STUDENT')).toEqual({ allowed: true })
    // setup path leaves count at 0 (asserted in route tests / code review)
    expect(remainingUsernameChanges(before)).toBe(3)
  })
  it('allows_3_changes_blocks_4th', () => {
    for (const count of [0, 1, 2]) {
      expect(isUsernameChangeAllowed({ usernameChangeCount: count } as any, 'STUDENT')).toBe(true)
    }
    expect(isUsernameChangeAllowed({ usernameChangeCount: 3 } as any, 'STUDENT')).toBe(false)
  })
  it('remaining_decrements', () => {
    expect(remainingUsernameChanges({ usernameChangeCount: 0 } as any)).toBe(3)
    expect(remainingUsernameChanges({ usernameChangeCount: 1 } as any)).toBe(2)
    expect(remainingUsernameChanges({ usernameChangeCount: 3 } as any)).toBe(0)
  })
  it('super_admin_exempt', () => {
    // Documented choice: SUPER_ADMIN unlimited (operational renames), all other
    // roles (STUDENT/TEACHER/COLLEGE_ADMIN) share the 3-change budget.
    expect(isUsernameChangeAllowed({ usernameChangeCount: 99 } as any, 'SUPER_ADMIN')).toBe(true)
    expect(canChangeUsername({ usernameChangeCount: 3 } as any, 'SUPER_ADMIN')).toEqual({ allowed: true })
    expect(canChangeUsername({ usernameChangeCount: 3 } as any, 'STUDENT')).toEqual({
      allowed: false,
      status: 403,
      error: expect.stringContaining('Maximum'),
    })
  })
})

describe('uniqueness (case-insensitive via sanitize)', () => {
  it('same_after_sanitize_counts_as_taken', () => {
    // Usernames are stored lowercased; exact match after sanitize IS the
    // case-insensitive check (routes sanitize before findFirst + also use
    // mode:insensitive for legacy mixed-case rows).
    expect(isSameUsername('Alex_99', 'alex_99')).toBe(true)
    expect(isSameUsername('Alex_99', 'alex_98')).toBe(false)
    expect(sanitizeUsernameValue('Alex_99')).toBe(sanitizeUsernameValue('ALEX_99'))
  })
  it('keep_flow_does_not_consume_budget', () => {
    // Keep = same value confirm: routes short-circuit before the budget
    // gate, so remaining is unchanged (3 - count, count untouched).
    const provisional = { username: 'alex_99', usernameSetByUser: false, usernameChangeCount: 0 } as any
    expect(needsUsernameSetup(provisional)).toBe(true)
    expect(isSameUsername('alex_99', 'Alex_99')).toBe(true)
    expect(remainingUsernameChanges(provisional)).toBe(3)
  })
})
