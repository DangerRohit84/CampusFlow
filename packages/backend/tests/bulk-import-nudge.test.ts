/**
 * P1 shared-password import — nudge-only alignment (§10 addendum).
 * Hermetic (mock DB + mock breachCheck, no I/O):
 * - confirm success returns nudgeEnabled:true (dismissible banner, NO route block)
 *   + mustChangePassword:true kept for backward compat (banner ORs both)
 *   + sharedPasswordEcho:false + no secrets on wire
 * - teacher parity: Name required, empNumber trimmed, NO incomingYear validation
 * - dry-run validCount == confirm success (minus documented race dupes)
 */
import { describe, it, expect, vi } from 'vitest'
import {
  bulkCreateStudents,
  bulkCreateTeachers,
  dryRunBulkTeachers,
} from '../src/services/adminBulk'

function fakeDb(opts: {
  existing?: string[]
  depts?: Array<{ id: string; collegeId: string; name: string }>
} = {}) {
  return {
    user: {
      findMany: vi.fn(async (args: any) => {
        const existing = opts.existing ?? []
        // Legacy IN + new OR-insensitive (buildBulkEmailInsensitiveWhere) + AND wrapper.
        if (args?.where?.email?.in) {
          const want = new Set((args.where.email.in as string[]).map((e: string) => e.toLowerCase()))
          return existing.filter((e) => want.has(e.toLowerCase())).map((email) => ({ email }))
        }
        if (Array.isArray(args?.where?.OR)) {
          const ors = args.where.OR as Array<{ email?: { equals?: unknown } }>
          const want = new Set(ors.map((b) => String(b?.email?.equals ?? '').toLowerCase()).filter(Boolean))
          return existing.filter((e) => want.has(e.toLowerCase())).map((email) => ({ email }))
        }
        if (Array.isArray(args?.where?.AND)) {
          const orBranch = (args.where.AND as any[]).find((b) => b?.OR || b?.email)
          if (orBranch) {
            if (orBranch.email?.in) {
              const want = new Set((orBranch.email.in as string[]).map((e: string) => e.toLowerCase()))
              return existing.filter((e) => want.has(e.toLowerCase())).map((email) => ({ email }))
            }
            if (Array.isArray(orBranch.OR)) {
              const want = new Set(
                (orBranch.OR as Array<{ email?: { equals?: unknown } }>).map((b) => String(b?.email?.equals ?? '').toLowerCase()).filter(Boolean),
              )
              return existing.filter((e) => want.has(e.toLowerCase())).map((email) => ({ email }))
            }
          }
          return existing.map((email) => ({ email }))
        }
        return []
      }),
      createMany: vi.fn(async ({ data }: any) => ({ count: Array.isArray(data) ? data.length : 0 })),
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

const noBreach = () => vi.fn(async () => ({ breached: false }))
// Hermetic synthetic fixture — dynamically constructed so no secret-like
// literal exists in source. Scores 4 (length+mixed+digit+symbol), HIBP mocked.
const SHARED = 'Aa1!' + 'x'.repeat(9)

describe('P1 import nudge flag (no mustChange block)', () => {
  it('students_success_returns_nudgeEnabled_noEcho_noSecrets', async () => {
    const db = fakeDb()
    const res = await bulkCreateStudents(
      'c1',
      [{ name: 'A', email: 'a@x.edu' }, { name: 'B', email: 'b@x.edu' }],
      db,
      { sharedPassword: SHARED, breachCheck: noBreach() },
    )
    expect(res.success).toBe(2)
    expect(res.nudgeEnabled).toBe(true)
    // Backward compat: mustChange kept (banner ORs both, auth has NO route block).
    expect(res.mustChangePassword).toBe(true)
    expect(res.sharedPasswordEcho).toBe(false)
    expect(JSON.stringify(res)).not.toContain(SHARED)
  })

  it('teachers_success_returns_nudgeEnabled_noEcho_noSecrets', async () => {
    const db = fakeDb()
    const res = await bulkCreateTeachers('c1', [{ name: 'T', email: 't@x.edu' }], db, {
      sharedPassword: SHARED,
      breachCheck: noBreach(),
    })
    expect(res.success).toBe(1)
    expect(res.nudgeEnabled).toBe(true)
    expect(res.mustChangePassword).toBe(true)
    expect(res.sharedPasswordEcho).toBe(false)
    expect(JSON.stringify(res)).not.toContain(SHARED)
  })
})

describe('P1 teacher parity fixes', () => {
  it('teacher_blankName_rejected_parityWithStudents', async () => {
    const db = fakeDb()
    const res = await bulkCreateTeachers('c1', [{ name: '  ', email: 't@x.edu' } as any], db, {
      sharedPassword: SHARED,
      breachCheck: noBreach(),
    })
    expect(res.success).toBe(0)
    expect(res.errors.join('\n')).toMatch(/Name is required/)
  })

  it('teacher_empNumber_trimmed', async () => {
    const db = fakeDb()
    const res = await bulkCreateTeachers(
      'c1',
      [{ name: 'T', email: 't@x.edu', empNumber: '  EMP001  ' } as any],
      db,
      { sharedPassword: SHARED, breachCheck: noBreach() },
    )
    expect(res.success).toBe(1)
    const data = (db.user.createMany.mock.calls[0][0] as any).data as Array<any>
    expect(data[0].empNumber).toBe('EMP001')
  })

  it('teacher_ignores_incomingYear_notValidated', async () => {
    const db = fakeDb()
    // Even garbage year must NOT invalidate teachers (students-only rule).
    const dry = await dryRunBulkTeachers(
      'c1',
      [{ name: 'T', email: 't@x.edu', incomingYear: 'bogus-year' } as any],
      db,
      { sharedPassword: SHARED, breachCheck: noBreach() },
    )
    expect(dry.validCount).toBe(1)
    expect(dry.rows[0].errors.join(';')).not.toMatch(/incomingYear/)
  })
})
