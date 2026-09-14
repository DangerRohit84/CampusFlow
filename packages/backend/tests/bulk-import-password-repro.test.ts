/**
 * P1 shared-password bulk import (SUPERSEDES the per-row password contract this
 * file originally covered — see plan-shared-password-filters-bulkdelete.md §1).
 * Migration record (2026-09-14):
 * - CSV `password` column REMOVED from templates; legacy header still maps
 *   (parseCsv alias) but is warn+ignored, never validated per-row.
 * - ONE sharedPassword per batch (required on confirm, optional on dry-run);
 *   single HIBP call per batch; single bcrypt hash reused; show-once is the
 *   FE-held value (server never echoes secrets).
 * - Row semantics kept: Name required, incomingYear range, dept resolution,
 *   in-batch + existing dupes, dry-run==confirm parity.
 * Covers valid/invalid rows + shared set/ignore paths (counts only, no secrets).
 */
import { describe, it, expect, vi } from 'vitest'
import { parseCsv, validateRowsLocal, csvTemplate } from '../src/utils/csvImport'
import { dryRunBulkStudents, bulkCreateStudents } from '../src/services/adminBulk'

function fakeDb(opts: { existing?: string[]; depts?: Array<{ id: string; collegeId: string; name: string }>; createManyImpl?: any } = {}) {
  return {
    user: {
      findMany: vi.fn(async () => (opts.existing ?? []).map((email) => ({ email }))),
      createMany: vi.fn(opts.createManyImpl ?? (async ({ data }: any) => ({ count: Array.isArray(data) ? data.length : 0 }))),
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

// Hermetic shared-password opts (never real HIBP in tests).
const cleanBreach = () => vi.fn(async () => ({ breached: false, offline: false }))
const SHARED = 'StrongX9!q2wE'

describe('P1 templates carry no password column (shared field instead)', () => {
  it('student template omits password column', () => {
    expect(csvTemplate('student')).not.toMatch(/password/i)
    expect(csvTemplate('student')).toContain('incomingYear')
  })
  it('teacher template omits password column', () => {
    expect(csvTemplate('teacher')).not.toMatch(/password/i)
  })
  it('parseCsv still maps legacy password alias (detect → warn + ignore)', () => {
    const rows = parseCsv('name,email,password\nA,a@x.edu,StrongPass!9xQ2')
    expect(rows[0]).toMatchObject({ name: 'A', email: 'a@x.edu' })
    expect(String((rows[0] as any).password)).toBe('StrongPass!9xQ2')
  })
})

describe('P1 dry-run vs bulk accuracy (row semantics kept)', () => {
  it('validateRowsLocal ignores per-row password (shared validated once)', () => {
    const issues = validateRowsLocal([{ name: 'A', email: 'a@x.edu', password: 'password123' }], 'student')
    expect(issues[0].errors.join(';')).not.toMatch(/too common/i)
    expect(issues[0].errors).toEqual([])
  })
  it('bulkCreate rejects missing name (dry-run does)', async () => {
    const db = fakeDb()
    const res = await bulkCreateStudents('c1', [{ name: '', email: 'a@x.edu' } as any], db, {
      sharedPassword: SHARED, breachCheck: cleanBreach(),
    })
    expect(res.success).toBe(0)
    expect(res.failed).toBe(1)
  })
  it('bulkCreate rejects out-of-range incomingYear (dry-run does)', async () => {
    const db = fakeDb()
    const res = await bulkCreateStudents('c1', [{ name: 'A', email: 'a@x.edu', incomingYear: '1800' } as any], db, {
      sharedPassword: SHARED, breachCheck: cleanBreach(),
    })
    expect(res.success).toBe(0)
    expect(res.failed).toBe(1)
    expect(res.errors.join('\n')).toMatch(/incomingYear/)
  })
})

describe('P1 shared set vs legacy per-row passwords', () => {
  it('shared password passes when strong (mock HIBP clean, single call)', async () => {
    const db = fakeDb()
    const breachCheck = vi.fn(async () => ({ breached: false, offline: false }))
    const res = await bulkCreateStudents(
      'c1',
      [{ name: 'A', email: 'a@x.edu' } as any, { name: 'B', email: 'b@x.edu' } as any],
      db,
      { sharedPassword: 'Strong!9xQ2mZvL4', breachCheck },
    )
    expect(res.success).toBe(2)
    expect(breachCheck).toHaveBeenCalledTimes(1)
    expect(res.sharedPasswordEcho).toBe(false)
  })
  it('breached shared password rejected (HIBP hook), zero writes', async () => {
    const db = fakeDb()
    const breachCheck = vi.fn(async () => ({ breached: true, offline: false }))
    const res = await bulkCreateStudents(
      'c1',
      [{ name: 'A', email: 'a@x.edu' } as any],
      db,
      { sharedPassword: 'Strong!9xQ2mZvL4', breachCheck },
    )
    expect(res.success).toBe(0)
    expect(res.failed).toBe(1)
    expect(res.errors.join('\n')).toMatch(/breach/i)
    expect(db.user.createMany).not.toHaveBeenCalled()
  })
  it('legacy per-row passwords ignored — confirm uses shared, no per-row echo', async () => {
    const db = fakeDb()
    const res: any = await bulkCreateStudents(
      'c1',
      [{ name: 'A', email: 'a@x.edu', password: 'OldPerRow!9x' } as any],
      db,
      { sharedPassword: SHARED, breachCheck: cleanBreach() },
    )
    expect(res.success).toBe(1)
    expect(res.passwordColumnIgnored).toBe(true)
    // No per-row show-once (removed); FE holds the shared value instead.
    expect(res.tempPasswords).toBeUndefined()
    expect(res.sharedPasswordEcho).toBe(false)
  })
  it('dry-run validates shared once (breached → sharedPassword.invalid)', async () => {
    const db = fakeDb()
    const breachCheck = vi.fn(async () => ({ breached: true, offline: false }))
    const report = await dryRunBulkStudents(
      'c1',
      [{ name: 'A', email: 'a@x.edu' } as any],
      db,
      { sharedPassword: 'Strong!9xQ2mZvL4', breachCheck },
    )
    expect(report.sharedPassword.valid).toBe(false)
    expect(report.sharedPassword.errors.join('\n')).toMatch(/breach/i)
    expect(breachCheck).toHaveBeenCalledTimes(1)
  })
  it('dry-run passes rows when shared clean', async () => {
    const db = fakeDb()
    const report = await dryRunBulkStudents(
      'c1',
      [{ name: 'A', email: 'a@x.edu' } as any],
      db,
      { sharedPassword: SHARED, breachCheck: cleanBreach() },
    )
    expect(report.validCount).toBe(1)
    expect(report.sharedPassword.valid).toBe(true)
  })
})
