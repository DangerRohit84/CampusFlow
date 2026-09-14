/**
 * P1 shared-password bulk import (SUPERSEDES per-row password contract).
 * Hermetic service tests (mock DB + mock breachCheck, no I/O):
 * - sharedPassword REQUIRED on confirm → sharedPasswordInvalid + zero writes
 * - weak/common/breached → zero writes, single HIBP call per batch (not N)
 * - valid shared → all rows share one hash + mustChangePassword + echo:false
 * - legacy CSV `password` column → warn + ignore (not 400)
 * - dry-run without shared → rows validate + sharedPassword.valid:false hint
 */
import { describe, it, expect, vi } from 'vitest'
import {
  bulkCreateStudents,
  bulkCreateTeachers,
  dryRunBulkStudents,
  dryRunBulkTeachers,
} from '../src/services/adminBulk'

function fakeDb(opts: {
  existing?: string[]
  depts?: Array<{ id: string; collegeId: string; name: string }>
} = {}) {
  return {
    user: {
      findMany: vi.fn(async (args: any) => {
        if (args?.where?.email?.in) {
          const want = new Set((args.where.email.in as string[]).map((e: string) => e.toLowerCase()))
          return (opts.existing ?? []).filter((e) => want.has(e.toLowerCase())).map((email) => ({ email }))
        }
        // CTI dual-write re-read (select id/studentId/...): return empty (best-effort skip)
        return []
      }),
      createMany: vi.fn(async () => ({ count: 2 })),
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

const noBreach = vi.fn(async () => ({ breached: false }))
const breached = vi.fn(async () => ({ breached: true }))

describe('P1 shared-password required on confirm', () => {
  it('confirm_without_sharedPassword_400shape_zeroWrites', async () => {
    const db = fakeDb()
    const res = await bulkCreateStudents('c1', [{ name: 'A', email: 'a@x.edu' }], db, {})
    expect(res.sharedPasswordInvalid).toBe(true)
    expect(res.success).toBe(0)
    expect(res.errors.join(' ')).toMatch(/Shared password is required/)
    expect(db.user.createMany).not.toHaveBeenCalled()
  })
  it('teachers_confirm_without_sharedPassword_zeroWrites', async () => {
    const db = fakeDb()
    const res = await bulkCreateTeachers('c1', [{ name: 'T', email: 't@x.edu' }], db, {})
    expect(res.sharedPasswordInvalid).toBe(true)
    expect(res.success).toBe(0)
    expect(db.user.createMany).not.toHaveBeenCalled()
  })
})

describe('P1 shared-password strength + single HIBP call', () => {
  it('weak_shared_rejected_zeroWrites (too short)', async () => {
    const db = fakeDb()
    const res = await bulkCreateStudents(
      'c1',
      [{ name: 'A', email: 'a@x.edu' }, { name: 'B', email: 'b@x.edu' }],
      db,
      { sharedPassword: 'short', breachCheck: noBreach },
    )
    expect(res.sharedPasswordInvalid).toBe(true)
    expect(res.errors.join(' ')).toMatch(/8-72/)
    expect(db.user.createMany).not.toHaveBeenCalled()
    // Format fails before HIBP — zero breach calls.
    expect(noBreach).not.toHaveBeenCalled()
  })
  it('common_shared_rejected_zeroWrites', async () => {
    const db = fakeDb()
    const res = await bulkCreateStudents('c1', [{ name: 'A', email: 'a@x.edu' }], db, {
      sharedPassword: 'password123',
      breachCheck: noBreach,
    })
    expect(res.sharedPasswordInvalid).toBe(true)
    expect(res.errors.join(' ')).toMatch(/too common/)
    expect(db.user.createMany).not.toHaveBeenCalled()
  })
  it('breached_shared_rejected_singleHIBPCall', async () => {
    const db = fakeDb()
    const localBreach = vi.fn(async () => ({ breached: true }))
    const res = await bulkCreateStudents(
      'c1',
      [{ name: 'A', email: 'a@x.edu' }, { name: 'B', email: 'b@x.edu' }],
      db,
      { sharedPassword: 'StrongX9!q2wE', breachCheck: localBreach },
    )
    expect(res.sharedPasswordInvalid).toBe(true)
    expect(res.errors.join(' ')).toMatch(/data breach/)
    expect(localBreach).toHaveBeenCalledTimes(1) // single call per batch, not N
    expect(db.user.createMany).not.toHaveBeenCalled()
  })
  it('valid_shared_singleHash_mustChange_noEcho', async () => {
    const db = fakeDb()
    const localBreach = vi.fn(async () => ({ breached: false }))
    const res = await bulkCreateStudents(
      'c1',
      [{ name: 'A', email: 'a@x.edu' }, { name: 'B', email: 'b@x.edu' }],
      db,
      { sharedPassword: 'StrongX9!q2wE', breachCheck: localBreach },
    )
    expect(res.sharedPasswordInvalid).toBeUndefined()
    expect(localBreach).toHaveBeenCalledTimes(1)
    expect(db.user.createMany).toHaveBeenCalledTimes(1)
    // Single bcrypt hash reused: both rows share passwordHash.
    const data = (db.user.createMany.mock.calls[0][0] as any).data as Array<any>
    expect(data).toHaveLength(2)
    expect(data[0].passwordHash).toBe(data[1].passwordHash)
    expect(data[0].mustChangePassword).toBe(true)
    expect(res.sharedPasswordEcho).toBe(false)
    expect(res.mustChangePassword).toBe(true)
    expect(JSON.stringify(res)).not.toContain('StrongX9!q2wE')
  })
})

describe('P1 legacy password column warn+ignore', () => {
  it('rows_with_password_key_still_validate_flagIgnored', async () => {
    const db = fakeDb()
    const res = await dryRunBulkStudents(
      'c1',
      [{ name: 'A', email: 'a@x.edu', password: 'oldsecret123' } as any],
      db,
      { sharedPassword: 'StrongX9!q2wE', breachCheck: noBreach },
    )
    expect(res.passwordColumnIgnored).toBe(true)
    expect(res.warnings?.join(' ')).toMatch(/password column ignored/)
    expect(res.validCount).toBe(1)
  })
  it('confirm_with_password_col_warns_but_uses_shared', async () => {
    const db = fakeDb()
    const res = await bulkCreateStudents(
      'c1',
      [{ name: 'A', email: 'a@x.edu', password: 'oldsecret123' } as any],
      db,
      { sharedPassword: 'StrongX9!q2wE', breachCheck: noBreach },
    )
    expect(res.passwordColumnIgnored).toBe(true)
    expect(db.user.createMany).toHaveBeenCalled()
  })
})

describe('P1 dry-run shared hint', () => {
  it('dryRun_without_shared_validates_rows_hint_invalid', async () => {
    const db = fakeDb()
    const res = await dryRunBulkTeachers('c1', [{ name: 'T', email: 't@x.edu' }], db, {})
    expect(res.validCount).toBe(1)
    expect(res.sharedPassword.valid).toBe(false)
    expect(res.sharedPassword.errors.join(' ')).toMatch(/Shared password required/)
    expect(db.user.createMany).not.toHaveBeenCalled()
  })
  it('dryRun_with_breached_shared_reports_invalid', async () => {
    const db = fakeDb()
    const res = await dryRunBulkStudents('c1', [{ name: 'A', email: 'a@x.edu' }], db, {
      sharedPassword: 'StrongX9!q2wE',
      breachCheck: breached,
    })
    expect(res.sharedPassword.valid).toBe(false)
    expect(res.sharedPassword.errors.join(' ')).toMatch(/data breach/)
  })
})
