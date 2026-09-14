/**
 * P3 bulk delete — authoritative guards (hermetic, mock DB).
 * - 1–100 ids, DELETE N confirm exact (else 400-style throw, zero writes)
 * - self → throw (fail ENTIRE batch, differs from bulk-pw self-strip)
 * - last SUPER_ADMIN globally → throw; last COLLEGE_ADMIN in college → throw
 * - COLLEGE_ADMIN cannot delete SUPER_ADMIN targets
 * - race-deleted ids → partial:true with per-id errors (200-style, not throw)
 * - audit metadata helper strips secrets (no password keys leak)
 */
import { describe, it, expect, vi } from 'vitest'
import { bulkDeleteUsers } from '../src/services/bulkDelete'
import { buildAuditMetadata } from '../src/services/auditLog'

function fakeDb(opts: {
  targets?: Array<{ id: string; role: string; collegeId: string | null; email: string }>
  superCount?: number
  collegeAdminCount?: number
  deleteCount?: number
} = {}) {
  const txDeleteMany = vi.fn(async () => ({ count: opts.deleteCount ?? (opts.targets ?? []).length }))
  return {
    user: {
      findMany: vi.fn(async () => opts.targets ?? []),
      count: vi.fn(async (args: any) => {
        if (args?.where?.role === 'SUPER_ADMIN') return opts.superCount ?? 0
        if (args?.where?.role === 'COLLEGE_ADMIN') return opts.collegeAdminCount ?? 0
        return 0
      }),
    },
    $transaction: vi.fn(async (fn: any) => fn({ user: { deleteMany: txDeleteMany } })),
    __txDeleteMany: txDeleteMany,
  } as any
}

const T = (id: string, role = 'STUDENT', collegeId: string | null = 'c1'): any => ({
  id, role, collegeId, email: `${id}@x.edu`,
})

describe('bulkDeleteUsers guards (fail-all, zero writes)', () => {
  it('rejects_empty_and_over_100', async () => {
    const db = fakeDb()
    await expect(bulkDeleteUsers([], { actorId: 'me', actorRole: 'COLLEGE_ADMIN', collegeId: 'c1' }, { confirm: 'DELETE 0', db })).rejects.toThrow(/1–100/)
    await expect(
      bulkDeleteUsers(Array.from({ length: 101 }, (_, i) => `id-${i}`), { actorId: 'me', actorRole: 'COLLEGE_ADMIN', collegeId: 'c1' }, { confirm: 'DELETE 101', db }),
    ).rejects.toThrow(/1–100/)
    expect(db.$transaction).not.toHaveBeenCalled()
  })
  it('rejects_confirm_mismatch_zeroWrites', async () => {
    const db = fakeDb({ targets: [T('a'), T('b')] })
    await expect(
      bulkDeleteUsers(['a', 'b'], { actorId: 'me', actorRole: 'COLLEGE_ADMIN', collegeId: 'c1' }, { confirm: 'DELETE 3', db }),
    ).rejects.toThrow(/Confirmation mismatch/)
    expect(db.$transaction).not.toHaveBeenCalled()
  })
  it('rejects_self_delete_entire_batch', async () => {
    const db = fakeDb({ targets: [T('me'), T('a')] })
    await expect(
      bulkDeleteUsers(['me', 'a'], { actorId: 'me', actorRole: 'COLLEGE_ADMIN', collegeId: 'c1' }, { confirm: 'DELETE 2', db }),
    ).rejects.toThrow(/Cannot delete yourself/)
    expect(db.$transaction).not.toHaveBeenCalled()
  })
  it('rejects_last_super_admin', async () => {
    const db = fakeDb({ targets: [T('s1', 'SUPER_ADMIN', null)], superCount: 1 })
    await expect(
      bulkDeleteUsers(['s1'], { actorId: 's2', actorRole: 'SUPER_ADMIN', collegeId: null }, { confirm: 'DELETE 1', db }),
    ).rejects.toThrow(/last super admin/)
    expect(db.$transaction).not.toHaveBeenCalled()
  })
  it('rejects_last_college_admin', async () => {
    const db = fakeDb({ targets: [T('a1', 'COLLEGE_ADMIN')], collegeAdminCount: 1 })
    await expect(
      bulkDeleteUsers(['a1'], { actorId: 'me', actorRole: 'SUPER_ADMIN', collegeId: 'c1' }, { confirm: 'DELETE 1', db }),
    ).rejects.toThrow(/last college admin/)
    expect(db.$transaction).not.toHaveBeenCalled()
  })
  it('collegeAdmin_cannot_delete_superAdmin', async () => {
    const db = fakeDb({ targets: [T('s1', 'SUPER_ADMIN', null)], superCount: 3 })
    await expect(
      bulkDeleteUsers(['s1'], { actorId: 'me', actorRole: 'COLLEGE_ADMIN', collegeId: 'c1' }, { confirm: 'DELETE 1', db }),
    ).rejects.toThrow(/Not allowed/)
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})

describe('bulkDeleteUsers execution + partial', () => {
  it('happy_path_deletes_in_transaction', async () => {
    const db = fakeDb({ targets: [T('a'), T('b'), T('c')], collegeAdminCount: 2 })
    const res = await bulkDeleteUsers(['a', 'b', 'c'], { actorId: 'me', actorRole: 'COLLEGE_ADMIN', collegeId: 'c1' }, { confirm: 'DELETE 3', db })
    expect(res).toMatchObject({ success: 3, failed: 0, partial: false })
    expect(db.$transaction).toHaveBeenCalledTimes(1)
  })
  it('race_deleted_ids_partial_not_throw', async () => {
    // 5 requested, 1 already gone (lookup misses it) → success 4, failed 1.
    const db = fakeDb({ targets: [T('a'), T('b'), T('c'), T('d')], deleteCount: 4 })
    const res = await bulkDeleteUsers(['a', 'b', 'c', 'd', 'gone'], { actorId: 'me', actorRole: 'COLLEGE_ADMIN', collegeId: 'c1' }, { confirm: 'DELETE 5', db })
    expect(res.success).toBe(4)
    expect(res.failed).toBe(1)
    expect(res.partial).toBe(true)
    expect(res.errors.join(' ')).toMatch(/gone/)
  })
  it('dedupes_ids_confirm_uses_deduped_count', async () => {
    const db = fakeDb({ targets: [T('a')] })
    const res = await bulkDeleteUsers(['a', 'a'], { actorId: 'me', actorRole: 'COLLEGE_ADMIN', collegeId: 'c1' }, { confirm: 'DELETE 1', db })
    expect(res.success).toBe(1)
  })
})

describe('bulk-delete audit hygiene', () => {
  it('buildAuditMetadata_strips_secret_keys_countsOnly', () => {
    const meta = buildAuditMetadata({ requested: 5, success: 4, failed: 1, sharedPassword: 'x', passwordHash: 'y', tempPassword: 'z' } as any)
    expect(meta).not.toMatch(/sharedPassword|passwordHash|tempPassword/)
    expect(meta).toMatch(/"success":4/)
  })
})
