/**
 * P0-A RED: admin counts socket patch (kill 60s poll -> setQueryData).
 */
import { describe, it, expect } from 'vitest'

describe('P0-A admin counts socket patch', () => {
  it('identifies dedicated counts push (no invalidate path)', async () => {
    const mod = await import('../queryDiscipline')
    expect(mod.isStagingCountsPush('staging:counts:updated')).toBe(true)
    expect(mod.isStagingCountsPush('hackathon:mutated')).toBe(false)
    expect(mod.isStagingCountsPush('internship:mutated')).toBe(false)
  })

  it('merges per-kind counts without fetch (approve: pending-1 approved+1)', async () => {
    const mod = await import('../queryDiscipline')
    const old = {
      h: { total: 5, enriched: 3, pending: 2, approved: 1, rejected: 0 },
      i: { total: 4, enriched: 2, pending: 2, approved: 1, rejected: 1 },
    }
    const patched = mod.mergeStagingCounts(old as any, {
      kind: 'hack',
      action: 'approved',
    } as any)
    expect(patched.h.pending).toBe(1)
    expect(patched.h.approved).toBe(2)
    expect(patched.h.total).toBe(5)
    // Other kind untouched.
    expect(patched.i).toEqual(old.i)
  })

  it('merges full aggregate push (server dirty-flag payload, no GET)', async () => {
    const mod = await import('../queryDiscipline')
    const old = {
      h: { total: 1, enriched: 0, pending: 1, approved: 0, rejected: 0 },
      i: { total: 1, enriched: 0, pending: 1, approved: 0, rejected: 0 },
    }
    const fresh = {
      h: { total: 1, enriched: 1, pending: 0, approved: 1, rejected: 0 },
      i: { total: 1, enriched: 0, pending: 1, approved: 0, rejected: 0 },
    }
    const patched = mod.mergeStagingCounts(old as any, { counts: fresh } as any)
    expect(patched).toEqual(fresh)
  })

  it('never goes negative on duplicate pushes (idempotent patch)', async () => {
    const mod = await import('../queryDiscipline')
    const old = {
      h: { total: 1, enriched: 0, pending: 0, approved: 1, rejected: 0 },
      i: { total: 0, enriched: 0, pending: 0, approved: 0, rejected: 0 },
    }
    const patched = mod.mergeStagingCounts(old as any, {
      kind: 'hack',
      action: 'approved',
    } as any)
    expect(patched.h.pending).toBe(0)
    expect(patched.h.approved).toBe(1)
  })

  it('uses socket push when connected, slow poll fallback when dead', async () => {
    const mod = await import('../queryDiscipline')
    expect(mod.shouldUseSocketPush({ connected: true } as any)).toBe(true)
    expect(mod.shouldUseSocketPush(null)).toBe(false)
    expect(mod.shouldUseSocketPush({ connected: false } as any)).toBe(false)
  })
})
