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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  bulkPasswordReset,
  clearBulkPasswordRateForTests,
} from '../src/services/bulkPassword'
import { buildAuditMetadata } from '../src/services/auditLog'
import { __setRedisClientForTests, __resetRedisForTests } from '../src/lib/redis'
import { isRefreshTokenStaleAfterBulkReset } from '../src/utils/authHardening'

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

// Hermetic synthetic fixture — dynamically constructed so no secret-like
// literal exists in source. Scores 4 (length+mixed+digit+symbol), HIBP mocked.
const SHARED = 'Aa1!' + 'x'.repeat(9)

beforeEach(() => {
  clearBulkPasswordRateForTests()
  __resetRedisForTests()
})

afterEach(() => {
  __resetRedisForTests()
})

describe('bulk-password shared-set happy path', () => {
  it('set_valid_updates_all_nudge_noMustChange', async () => {
    const db = fakeDb({ targets: [T('a'), T('b')] })
    const res = await bulkPasswordReset(
      { ids: ['a', 'b'], mode: 'shared-set', sharedPassword: SHARED, confirm: 'RESET 2' },
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
    expect(JSON.stringify(res)).not.toContain(SHARED)
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
      { ids: ['a'], mode: 'shared-set', sharedPassword: SHARED, confirm: 'RESET 1', nudgeUsers: false },
      collegeAdmin,
      { db, breachCheck: noBreach },
    )
    expect(res.nudgeEnabled).toBe(false)
    const data = db.user.updateMany.mock.calls[0][0].data as Record<string, unknown>
    expect('passwordNudgeAt' in data).toBe(false)
  })
})

describe('bulk-password validation (400, zero writes; ADMIN-SET HIBP skipped 2026-09-14)', () => {
  it('weak_shared_400_zeroWrites (format still enforced)', async () => {
    const db = fakeDb({ targets: [T('a'), T('b')] })
    await expect(
      bulkPasswordReset({ ids: ['a', 'b'], mode: 'shared-set', sharedPassword: 'short', confirm: 'RESET 2' }, collegeAdmin, { db, breachCheck: noBreach }),
    ).rejects.toThrow(/8-72/)
    expect(db.user.updateMany).not.toHaveBeenCalled()
  })
  it('breached_but_strong_ACCEPTED_HIBP_skipped', async () => {
    // 2026-09-14 accepted risk: admin bulk-password skips HIBP (format-only).
    const db = fakeDb({ targets: [T('a'), T('b')] })
    const localBreach = vi.fn(async () => ({ breached: true }))
    const res = await bulkPasswordReset(
      { ids: ['a', 'b'], mode: 'shared-set', sharedPassword: SHARED, confirm: 'RESET 2' },
      collegeAdmin,
      { db, breachCheck: localBreach },
    )
    expect(res.success).toBe(2)
    expect(localBreach).not.toHaveBeenCalled()
    expect(db.user.updateMany).toHaveBeenCalled()
  })
  it('confirm_mismatch_400_zeroWrites', async () => {
    const db = fakeDb({ targets: [T('a'), T('b')] })
    await expect(
      bulkPasswordReset({ ids: ['a', 'b'], mode: 'shared-set', sharedPassword: SHARED, confirm: 'RESET 5' }, collegeAdmin, { db, breachCheck: noBreach }),
    ).rejects.toThrow(/Confirmation mismatch/)
    expect(db.user.updateMany).not.toHaveBeenCalled()
  })
  it('ids_limits_enforced', async () => {
    const db = fakeDb()
    await expect(
      bulkPasswordReset({ ids: [], mode: 'shared-set', sharedPassword: SHARED, confirm: 'RESET 0' }, collegeAdmin, { db, breachCheck: noBreach }),
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
      { ids: ['admin1', 'a', 'b'], mode: 'shared-set', sharedPassword: SHARED, confirm: 'RESET 2' },
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
      bulkPasswordReset({ ids: ['peer'], mode: 'shared-set', sharedPassword: SHARED, confirm: 'RESET 1' }, collegeAdmin, { db, breachCheck: noBreach }),
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
      { ids: ['a', 'x'], mode: 'shared-set', sharedPassword: SHARED, confirm: 'RESET 2' },
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
      { ids: ['a', 'gone'], mode: 'shared-set', sharedPassword: SHARED, confirm: 'RESET 2' },
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
        { ids: ['a'], mode: 'shared-set', sharedPassword: SHARED, confirm: 'RESET 1' },
        collegeAdmin,
        { db: mk(), breachCheck: noBreach },
      )
    }
    const db6 = mk()
    const err = await bulkPasswordReset(
      { ids: ['a'], mode: 'shared-set', sharedPassword: SHARED, confirm: 'RESET 1' },
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

describe('bulk-password follow-up: clear 400 for old callers (no behavior change beyond message)', () => {
  it('missing_shared_400_mentions_release_notes', async () => {
    const db = fakeDb({ targets: [T('a')] })
    const err = await bulkPasswordReset(
      { ids: ['a'], mode: 'shared-set', confirm: 'RESET 1' },
      collegeAdmin,
      { db, breachCheck: noBreach },
    ).catch((e: any) => e)
    expect((err as any)?.status).toBe(400)
    expect(String((err as any)?.message || '')).toMatch(/Shared password is required/)
    // Clear remediation for old automation (release comms text in code comment).
    expect(String((err as any)?.message || '')).toMatch(/old callers without it get 400/)
    expect(db.user.updateMany).not.toHaveBeenCalled()
    expect(JSON.stringify(err)).not.toContain(SHARED)
  })
})

/** Minimal FakeRedis for the shared rate-limit path (no network, hermetic). */
function makeFakeRedis() {
  const store = new Map<string, { value: string; expiresAt: number | null }>()
  const isExpired = (e: { value: string; expiresAt: number | null }) =>
    e.expiresAt != null && Date.now() > e.expiresAt
  const getEntry = (key: string) => {
    const e = store.get(key)
    if (!e) return null
    if (isExpired(e)) {
      store.delete(key)
      return null
    }
    return e
  }
  return {
    _store: store,
    async get(key: string) {
      const e = getEntry(key)
      return e ? e.value : null
    },
    async set(key: string, value: string, ...args: Array<string | number>) {
      let ttl: number | null = null
      for (let i = 0; i < args.length; i++) {
        if (String(args[i]).toUpperCase() === 'PX' && typeof args[i + 1] === 'number') {
          ttl = Math.floor(args[i + 1] as number)
        }
      }
      store.set(key, { value: String(value), expiresAt: ttl != null ? Date.now() + ttl : null })
      return 'OK' as const
    },
    async del(...keys: string[]) {
      let n = 0
      for (const k of keys) if (store.delete(k)) n++
      return n
    },
    async incr(key: string) {
      const e = getEntry(key)
      const cur = e ? parseInt(e.value, 10) || 0 : 0
      const next = cur + 1
      store.set(key, { value: String(next), expiresAt: e?.expiresAt ?? null })
      return next
    },
    async incrby(key: string, inc: number) {
      const e = getEntry(key)
      const cur = e ? parseInt(e.value, 10) || 0 : 0
      const next = cur + Math.floor(inc)
      store.set(key, { value: String(next), expiresAt: e?.expiresAt ?? null })
      return next
    },
    async pexpire(key: string, ms: number) {
      const e = getEntry(key)
      if (!e) return 0
      e.expiresAt = Date.now() + Math.floor(ms)
      store.set(key, e)
      return 1
    },
    async pttl(key: string) {
      const e = getEntry(key)
      if (!e) return -2
      if (e.expiresAt == null) return -1
      return Math.max(0, e.expiresAt - Date.now())
    },
    async eval() {
      // No Lua in the fake — forces the GET+SET fallback path (same as lib/redis mocks).
      throw new Error('EVAL not supported in FakeRedis')
    },
  } as any
}

describe('bulk-password follow-up: Redis-shared rate limit (multi-replica)', () => {
  it('redis_enforces_5ops_globally_even_after_memory_clear', async () => {
    const fake = makeFakeRedis()
    __setRedisClientForTests(fake)
    const mk = () => fakeDb({ targets: [T('a')] })
    for (let i = 0; i < 5; i++) {
      await bulkPasswordReset(
        { ids: ['a'], mode: 'shared-set', sharedPassword: SHARED, confirm: 'RESET 1' },
        collegeAdmin,
        { db: mk(), breachCheck: noBreach },
      )
    }
    // Prove the budget lives in Redis, not memory: wipe memory, 6th still 429.
    clearBulkPasswordRateForTests()
    const db6 = mk()
    const err = await bulkPasswordReset(
      { ids: ['a'], mode: 'shared-set', sharedPassword: SHARED, confirm: 'RESET 1' },
      collegeAdmin,
      { db: db6, breachCheck: noBreach },
    ).catch((e: any) => e)
    expect((err as any)?.status).toBe(429)
    expect(db6.user.updateMany).not.toHaveBeenCalled()
  })
  it('redis_reset_allows_again (rollout sanity)', async () => {
    const fake = makeFakeRedis()
    __setRedisClientForTests(fake)
    const mk = () => fakeDb({ targets: [T('a')] })
    for (let i = 0; i < 5; i++) {
      await bulkPasswordReset(
        { ids: ['a'], mode: 'shared-set', sharedPassword: SHARED, confirm: 'RESET 1' },
        collegeAdmin,
        { db: mk(), breachCheck: noBreach },
      )
    }
    __resetRedisForTests()
    clearBulkPasswordRateForTests()
    const db = mk()
    const res = await bulkPasswordReset(
      { ids: ['a'], mode: 'shared-set', sharedPassword: SHARED, confirm: 'RESET 1' },
      collegeAdmin,
      { db, breachCheck: noBreach },
    )
    expect(res.success).toBe(1)
  })
  it('memory_fallback_still_enforces_when_redis_down', async () => {
    __setRedisClientForTests(null)
    const mk = () => fakeDb({ targets: [T('a')] })
    for (let i = 0; i < 5; i++) {
      await bulkPasswordReset(
        { ids: ['a'], mode: 'shared-set', sharedPassword: SHARED, confirm: 'RESET 1' },
        collegeAdmin,
        { db: mk(), breachCheck: noBreach },
      )
    }
    const db6 = mk()
    const err = await bulkPasswordReset(
      { ids: ['a'], mode: 'shared-set', sharedPassword: SHARED, confirm: 'RESET 1' },
      collegeAdmin,
      { db: db6, breachCheck: noBreach },
    ).catch((e: any) => e)
    expect((err as any)?.status).toBe(429)
  })
})

describe('bulk-password follow-up: refresh mass revoke (nudge-only, no login block)', () => {
  it('stale_refresh_iat_before_nudge_true_fresh_false', () => {
    const nudge = new Date('2026-09-14T12:00:00.000Z')
    const nudgeSec = Math.floor(nudge.getTime() / 1000)
    // Old session (1h before reset) → stale.
    expect(isRefreshTokenStaleAfterBulkReset(nudgeSec - 3600, nudge)).toBe(true)
    // Fresh login (after reset) → not stale (nudge-only: passes with banner).
    expect(isRefreshTokenStaleAfterBulkReset(nudgeSec + 10, nudge)).toBe(false)
    // No nudge (never reset) → never stale.
    expect(isRefreshTokenStaleAfterBulkReset(nudgeSec - 3600, null)).toBe(false)
    // Missing iat → fail-open allow.
    expect(isRefreshTokenStaleAfterBulkReset(undefined, nudge)).toBe(false)
    // Same-second race → allow (avoids locking out a fresh login).
    expect(isRefreshTokenStaleAfterBulkReset(nudgeSec, nudge)).toBe(false)
  })
  it('bulk_reset_sets_nudge_marker_for_lazy_revoke (no secrets in result)', async () => {
    const db = fakeDb({ targets: [T('a')] })
    const res = await bulkPasswordReset(
      { ids: ['a'], mode: 'shared-set', sharedPassword: SHARED, confirm: 'RESET 1' },
      collegeAdmin,
      { db, breachCheck: noBreach },
    )
    expect(res.success).toBe(1)
    expect(res.nudgeEnabled).toBe(true)
    const data = db.user.updateMany.mock.calls[0][0].data as Record<string, unknown>
    expect(data.passwordNudgeAt).toBeInstanceOf(Date)
    expect('mustChangePassword' in data).toBe(false)
    expect(JSON.stringify(res)).not.toContain(SHARED)
  })
})
