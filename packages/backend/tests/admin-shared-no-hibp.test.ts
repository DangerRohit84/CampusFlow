/**
 * Admin-set shared passwords SKIP HIBP breach check (bulk import + bulk set/reset).
 * - Keeps length 8-72 + common-password check (format-only).
 * - Removes the HIBP network call on admin paths only (no breachCheck invocation,
 *   breached-but-strong passwords are ACCEPTED for onboarding cohorts).
 * - KEEPS breach check where users set their own password (register,
 *   change-password — those routes call checkPasswordBreach directly, untouched).
 * ACCEPTED RISK (documented in code + report): a breached shared onboarding
 * password could be credential-stuffed before rotation. Mitigations: strong
 * generated default (12b64+A1!), nudge banner (passwordNudgeAt) drives rotation,
 * change-password/register still enforce HIBP, single hash + audit counts-only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  bulkCreateStudents,
  bulkCreateTeachers,
  dryRunBulkStudents,
} from '../src/services/adminBulk'
import {
  bulkPasswordReset,
  clearBulkPasswordRateForTests,
} from '../src/services/bulkPassword'
import { validateAdminSharedPassword } from '../src/utils/sharedPassword'

function fakeImportDb() {
  return {
    user: {
      findMany: vi.fn(async () => []),
      createMany: vi.fn(async ({ data }: any) => ({ count: Array.isArray(data) ? data.length : 0 })),
    },
    department: { findMany: vi.fn(async () => []) },
  } as any
}

function fakePwDb(targets: Array<{ id: string; role: string; collegeId: string | null; email: string }>) {
  return {
    user: {
      findMany: vi.fn(async () => targets),
      updateMany: vi.fn(async (args: any) => ({ count: (args?.where?.id?.in ?? []).length })),
    },
  } as any
}

// Strong format-valid fixture (length+mixed+digit+symbol), dynamically built.
const SHARED = 'Aa1!' + 'x'.repeat(9)
const ctx = { actorId: 'admin1', actorRole: 'COLLEGE_ADMIN', actorCollegeId: 'c1', scopeCollegeId: 'c1' }

beforeEach(() => {
  clearBulkPasswordRateForTests()
})

describe('admin shared validator skips HIBP (format only)', () => {
  it('accepts_strong_even_when_breached_flag_would_fire', async () => {
    // No breachCheck param exists — format-only by construction.
    const check = await validateAdminSharedPassword(SHARED)
    expect(check.valid).toBe(true)
  })
  it('still_rejects_short_and_common', async () => {
    expect((await validateAdminSharedPassword('short')).valid).toBe(false)
    expect((await validateAdminSharedPassword('password123')).valid).toBe(false)
  })
})

describe('bulk import skips HIBP (admin-set)', () => {
  it('breached_but_strong_shared_ACCEPTED_no_breach_call', async () => {
    const db = fakeImportDb()
    const breachCheck = vi.fn(async () => ({ breached: true }))
    const res = await bulkCreateStudents('c1', [{ name: 'A', email: 'a@x.edu' }], db, {
      sharedPassword: SHARED,
      breachCheck: breachCheck as any,
    })
    expect(res.sharedPasswordInvalid).toBeUndefined()
    expect(res.success).toBe(1)
    expect(breachCheck).not.toHaveBeenCalled()
  })
  it('teachers_breached_but_strong_ACCEPTED_no_breach_call', async () => {
    const db = fakeImportDb()
    const breachCheck = vi.fn(async () => ({ breached: true }))
    const res = await bulkCreateTeachers('c1', [{ name: 'T', email: 't@x.edu' }], db, {
      sharedPassword: SHARED,
      breachCheck: breachCheck as any,
    })
    expect(res.success).toBe(1)
    expect(breachCheck).not.toHaveBeenCalled()
  })
  it('dryRun_breached_but_strong_reports_valid_no_breach_call', async () => {
    const db = fakeImportDb()
    const breachCheck = vi.fn(async () => ({ breached: true }))
    const report = await dryRunBulkStudents('c1', [{ name: 'A', email: 'a@x.edu' }], db, {
      sharedPassword: SHARED,
      breachCheck: breachCheck as any,
    })
    expect(report.sharedPassword.valid).toBe(true)
    expect(breachCheck).not.toHaveBeenCalled()
  })
})

describe('bulk password set skips HIBP (admin-set)', () => {
  it('breached_but_strong_shared_ACCEPTED_no_breach_call', async () => {
    const db = fakePwDb([{ id: 'a', role: 'STUDENT', collegeId: 'c1', email: 'a@x.edu' }])
    const breachCheck = vi.fn(async () => ({ breached: true }))
    const res = await bulkPasswordReset(
      { ids: ['a'], mode: 'shared-set', sharedPassword: SHARED, confirm: 'RESET 1' },
      ctx,
      { db, breachCheck: breachCheck as any },
    )
    expect(res.success).toBe(1)
    expect(breachCheck).not.toHaveBeenCalled()
  })
})
