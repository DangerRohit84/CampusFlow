/**
 * P0-A RED: staging counts dirty-flag aggregate push.
 * Server emits only on change, client setQueryData, fallback slow poll + ETag.
 * These tests MUST fail before implementation (helpers don't exist yet).
 */
import { describe, it, expect } from 'vitest'

describe('P0-A staging counts dirty-flag', () => {
  it('builds tenant-segmented cache keys', async () => {
    const mod = await import('../src/services/stagingCounts')
    expect(mod.stagingCountsKey('hack', 'global')).toBe('staging-counts:hack:global')
    expect(mod.stagingCountsKey('int', 'college:abc')).toBe('staging-counts:int:college:abc')
  })

  it('derives scope from user (SUPER_ADMIN=global, else college)', async () => {
    const mod = await import('../src/services/stagingCounts')
    expect(mod.scopeForUser(null)).toBe('global')
    expect(mod.scopeForUser({ role: 'SUPER_ADMIN', collegeId: 'c1' } as any)).toBe('global')
    expect(mod.scopeForUser({ role: 'TEACHER', collegeId: 'c1' } as any)).toBe('college:c1')
    expect(mod.scopeForUser({ role: 'TEACHER', collegeId: null } as any)).toBe('college:none')
  })

  it('hashes counts stably (same object => same hash, changed => different)', async () => {
    const mod = await import('../src/services/stagingCounts')
    const a = { total: 5, enriched: 3, pending: 2, approved: 1, rejected: 0 }
    const b = { total: 5, enriched: 3, pending: 2, approved: 1, rejected: 0 }
    const c = { total: 5, enriched: 3, pending: 1, approved: 2, rejected: 0 }
    expect(mod.countsPayloadHash(a)).toBe(mod.countsPayloadHash(b))
    expect(mod.countsPayloadHash(a)).not.toBe(mod.countsPayloadHash(c))
  })

  it('emits only on change (dirty-flag + version bump)', async () => {
    const mod = await import('../src/services/stagingCounts')
    mod.__resetStagingCountsForTests()
    const scope = 'test:dirty-flag-scope'
    const a = { total: 2, enriched: 1, pending: 1, approved: 0, rejected: 0 }
    const b = { total: 2, enriched: 1, pending: 0, approved: 1, rejected: 0 }
    const first = mod.shouldEmitCounts(scope, 'hack', a)
    expect(first.emit).toBe(true)
    expect(first.version).toBe(1)
    const same = mod.shouldEmitCounts(scope, 'hack', a)
    expect(same.emit).toBe(false)
    expect(same.version).toBe(1)
    const changed = mod.shouldEmitCounts(scope, 'hack', b)
    expect(changed.emit).toBe(true)
    expect(changed.version).toBe(2)
  })

  it('bustStagingCounts is fail-open (never throws)', async () => {
    const mod = await import('../src/services/stagingCounts')
    await expect(mod.bustStagingCounts('hack', 'global')).resolves.toBeUndefined()
    await expect(mod.bustStagingCounts('both')).resolves.toBeUndefined()
  })

  it('builds stable ETag + matches If-None-Match (fallback poll 304)', async () => {
    const mod = await import('../src/services/stagingCounts')
    const counts = { total: 1, enriched: 1, pending: 0, approved: 1, rejected: 0 }
    const etag = mod.buildCountsEtag(counts)
    expect(etag.startsWith('W/"')).toBe(true)
    expect(mod.isCountsNotModified(etag, etag)).toBe(true)
    expect(mod.isCountsNotModified(`${etag}, W/"other"`, etag)).toBe(true)
    expect(mod.isCountsNotModified(null, etag)).toBe(false)
    expect(mod.isCountsNotModified(undefined, etag)).toBe(false)
  })
})
