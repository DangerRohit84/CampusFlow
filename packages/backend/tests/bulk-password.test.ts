/**
 * Bulk password actions (Option A shared set/reset + §10 nudge-only addendum).
 * Hermetic service tests (mock DB + mock breachCheck):
 * - shared-set happy: all updated + nudgeEnabled + NO mustChangePassword write
 * - shared-reset happy: sharedTempPassword returned once, never echoes chosen pw
 * - weak/breached → 400 zero writes, single HIBP call
 * - self stripped (skippedSelf) — batch proceeds (differs from delete fail-all)
 * - role matrix 403s: college-admin→peer admin, any→SUPER_ADMIN, cross-college scope
 * - partial: missing + wrong-college rows reported, in-scope updated
 * - confirm mismatch → 400 zero writes; ids 1–100 enforced
 * - rate limit: 6th op/10min → 429 with Retry-After
 * - dryRun: zero writes + sharedPassword hint
 * - audit metadata strips sharedPassword/sharedTempPassword/passwordHash
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  bulkPasswordReset,
  clearBulkPasswordRateForTests,
} from '../src/services/bulkPassword'
import { buildAuditMetadata } from '../src/services/auditLog'

const noBreach = async () => ({ breached: false })

function fakeDb(opts: {
  targets?: Array<{ id: string; role: string; collegeId: string | null; email: string }>
  updated?: number
} = {}) {
  return {
    user: {
      findMany: vi.fn(async () => opts.targets ?? []),
      // Respect the scoped `where.id.in` (models Prisma updateMany counts —
      // wrong-college rows are NOT updated, they become partial failures).
      updateMany: vi.fn(async (args: any) => {
        const want = new Set((args?.where?.id?.in ?? []) as string[])
        const n = (opts.targets ?? []).filter((t) => want.has(t.id)).length
        return { count: opts.updated ?? n }
      }),
    },
  } as any
}

const T = (id: string, role = 'STUDENT', collegeId: string | null = 'c1'): any => ({
  id, role, collegeId, email: `${id}@x.edu`,
})

const collegeAdmin = { actorId: 'admin1', actorRole: 'COLLEGE_ADMIN', actorCollegeId: 'c1', scopeCollegeId: 'c1' }

beforeEach(() => {
  clearBulkPasswordRateForTests()
})

describe('bulk-password shared-set happy path', () => {
  it('set_valid_updates_all_nudge_noMustChange', async () => {
    const db = fakeDb({ targets: [T('a'), T('b')] })
    const res = await bulkPasswordReset(
      { ids: ['a', 'b'], mode: 'shared-set', sharedPassword: 'StrongX9!q2wE', confirm: 'RESET 2' },
      collegeAdmin,
      { db, breachCheck: noBreach },
    )
    expect(res).toMatchObject({ success: 2, failed: 0, skippedSelf: 0, partial: false, nudgeEnabled: true, sharedPasswordEcho: false })
    expect((res as any).sharedTempPassword).toBeUndefined()
    expect((res as any).mustChangePassword).toBeUndefined()
    // §10: passwordHash + passwordNudgeAt written; mustChangePassword untouched.
    const data = db.user.updateMany.mock.calls[0][0].data as Record<string, unknown>
    expect(data.passwordHash).toBeTruthy()
    expect(data.passwordNudgeAt).toBeInstanceOf(Date)
    expect('mustChangePassword' in data).toBe(false)
    expect(JSON.stringify(res)).not.toContain('StrongX9!q2wE')
  })
  it('reset_auto_generates_temp_once', async () => {
    const db = fakeDb({ targets: [T('a')] })
    const res = await bulkPasswordReset(
      { ids: ['a'], mode: 'shared-reset', autoGenerate: true, confirm: 'RESET 1' },
      collegeAdmin,
      { db, breachCheck: noBreach },
    )
    expect(res.success).toBe(1)
    expect(typeof res.sharedTempPassword).toBe('string')
    expect((res.sharedTempPassword as string).length).toBeGreaterThanOrEqual(8)
  })
  it('nudgeUsers_false_skips_nudge_trigger', async () => {
    const db = fakeDb({ targets: [T('a')] })
    const res = await bulkPasswordReset(
      { ids: ['a'], mode: 'shared-set', sharedPassword: 'StrongX9!q2wE', confirm: 'RESET 1', nudgeUsers: false },
      collegeAdmin,
      { db, breachCheck: noBreach },
    )
    expect(res.nudgeEnabled).toBe(false)
    const data = db.user.updateMany.mock.calls[0][0].data as Record<string, unknown>
    expect('passwordNudgeAt' in data).toBe(false)
  })
})

describe('bulk-password validation (400, zero writes)', () => {
  it('weak_and_breached_shared_400_singleHIBP', async () => {
    const db = fakeDb({ targets: [T('a'), T('b')] })
    await expect(
      bulkPasswordReset({ ids: ['a', 'b'], mode: 'shared-set', sharedPassword: 'short', confirm: 'RESET 2' }, collegeAdmin, { db, breachCheck: noBreach }),
    ).rejects.toThrow(/8-72/)
    const localBreach = vi.fn(async () => ({ breached: true }))
    await expect(
      bulkPasswordReset({ ids: ['a', 'b'], mode: 'shared-set', sharedPassword: 'StrongX9!q2wE', confirm: 'RESET 2' }, collegeAdmin, { db, breachCheck: localBreach }),
    ).rejects.toThrow(/data breach/)
    expect(localBreach).toHaveBeenCalledTimes(1)
    expect(db.user.updateMany).not.toHaveBeenCalled()
  })
  it('confirm_mismatch_400_zeroWrites', async () => {
    const db = fakeDb({ targets: [T('a'), T('b')] })
    await expect(
      bulkPasswordReset({ ids: ['a', 'b'], mode: 'shared-set', sharedPassword: 'StrongX9!q2wE', confirm: 'RESET 5' }, collegeAdmin, { db, breachCheck: noBreach }),
    ).rejects.toThrow(/Confirmation mismatch/)
    expect(db.user.updateMany).not.toHaveBeenCalled()
  })
  it('ids_limits_enforced', async () => {
    const db = fakeDb()
    await expect(
      bulkPasswordReset({ ids: [], mode: 'shared-set', sharedPassword: 'StrongX9!q2wE', confirm: 'RESET 0' }, collegeAdmin, { db, breachCheck: noBreach }),
    ).rejects.toThrow(/1–100/)
    expect(db.user.updateMany).not.toHaveBeenCalled()
  })
  it('reset_with_sharedPassword_sent_400', async () => {
    const db = fakeDb({ targets: [T('a')] })
    await expect(
      bulkPasswordReset({ ids: ['a'], mode: 'shared-reset', autoGenerate: true, sharedPassword: 'x'.repeat(12) + 'A1!', confirm: 'RESET 1' }, collegeAdmin, { db, breachCheck: noBreach }),
    ).rejects.toThrow(/Do not send sharedPassword/)
    expect(db.user.updateMany).not.toHaveBeenCalled()
  })
})

describe('bulk-password guards (self-strip, roles, scope)', () => {
  it('self_stripped_batch_proceeds', async () => {
    const db = fakeDb({ targets: [T('a'), T('b')] })
    const res = await bulkPasswordReset(
      { ids: ['admin1', 'a', 'b'], mode: 'shared-set', sharedPassword: 'StrongX9!q2wE', confirm: 'RESET 2' },
      collegeAdmin,
      { db, breachCheck: noBreach },
    )
    expect(res.skippedSelf).toBe(1)
    expect(res.success).toBe(2)
    const where = db.user.updateMany.mock.calls[0][0].where as { id: { in: string[] } }
    expect(where.id.in).not.toContain('admin1')
  })
  it('collegeAdmin_peer_admin_403_zeroWrites', async () => {
    const db = fakeDb({ targets: [T('peer', 'COLLEGE_ADMIN')] })
    await expect(
      bulkPasswordReset({ ids: ['peer'], mode: 'shared-set', sharedPassword: 'StrongX9!q2wE', confirm: 'RESET 1' }, collegeAdmin, { db, breachCheck: noBreach }),
    ).rejects.toThrow(/Not allowed to reset this role/)
    expect(db.user.updateMany).not.toHaveBeenCalled()
  })
  it('superAdmin_targets_403_even_for_superActor', async () => {
    const db = fakeDb({ targets: [T('s1', 'SUPER_ADMIN', null)] })
    await expect(
      bulkPasswordReset(
        { ids: ['s1'], mode: 'shared-reset', autoGenerate: true, confirm: 'RESET 1' },
        { actorId: 'root', actorRole: 'SUPER_ADMIN', actorCollegeId: null, scopeCollegeId: null },
        { db, breachCheck: noBreach },
      ),
    ).rejects.toThrow(/Not allowed to reset this role/)
    expect(db.user.updateMany).not.toHaveBeenCalled()
  })
  it('wrongCollege_rows_partial_not_403', async () => {
    const db = fakeDb({ targets: [T('a', 'STUDENT', 'c1'), T('x', 'STUDENT', 'other')] })
    const res = await bulkPasswordReset(
      { ids: ['a', 'x'], mode: 'shared-set', sharedPassword: 'StrongX9!q2wE', confirm: 'RESET 2' },
      collegeAdmin,
      { db, breachCheck: noBreach },
    )
    expect(res.success).toBe(1)
    expect(res.failed).toBe(1)
    expect(res.partial).toBe(true)
    expect(res.errors.join(' ')).toMatch(/Not in your college/)
  })
  it('missing_rows_partial', async () => {
    const db = fakeDb({ targets: [T('a')], updated: 1 })
    const res = await bulkPasswordReset(
      { ids: ['a', 'gone'], mode: 'shared-set', sharedPassword: 'StrongX9!q2wE', confirm: 'RESET 2' },
      collegeAdmin,
      { db, breachCheck: noBreach },
    )
    expect(res.success).toBe(1)
    expect(res.failed).toBe(1)
    expect(res.partial).toBe(true)
  })
})

describe('bulk-password rate limit + dryRun + audit', () => {
  it('6th_op_in_10min_429', async () => {
    const mk = () => fakeDb({ targets: [T('a')] })
    for (let i = 0; i < 5; i++) {
      await bulkPasswordReset(
        { ids: ['a'], mode: 'shared-set', sharedPassword: 'StrongX9!q2wE', confirm: 'RESET 1' },
        collegeAdmin,
        { db: mk(), breachCheck: noBreach },
      )
    }
    const db6 = mk()
    const err = await bulkPasswordReset(
      { ids: ['a'], mode: 'shared-set', sharedPassword: 'StrongX9!q2wE', confirm: 'RESET 1' },
      collegeAdmin,
      { db: db6, breachCheck: noBreach },
    ).catch((e: any) => e)
    expect((err as any)?.status).toBe(429)
    expect(db6.user.updateMany).not.toHaveBeenCalled()
  })
  it('dryRun_zeroWrites_hint', async () => {
    const db = fakeDb({ targets: [T('a')] })
    const res = await bulkPasswordReset(
      { ids: ['a'], mode: 'shared-set', confirm: 'RESET 1', dryRun: true },
      collegeAdmin,
      { db, breachCheck: noBreach },
    )
    expect(res.dryRun).toBe(true)
    expect(res.sharedPassword?.valid).toBe(false)
    expect(db.user.updateMany).not.toHaveBeenCalled()
  })
  it('audit_metadata_strips_secrets', () => {
    const meta = buildAuditMetadata({
      mode: 'shared-set', success: 2, failed: 0, sharedPassword: 'x', sharedTempPassword: 'y', passwordHash: 'z',
    } as any)
    expect(meta).not.toMatch(/sharedPassword|sharedTempPassword|passwordHash/)
    expect(meta).toMatch(/"success":2/)
  })
})
