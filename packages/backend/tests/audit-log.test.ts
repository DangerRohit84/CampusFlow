/**
 * #11 audit log: metadata sanitizer + best-effort writer/reader.
 * Hermetic (no DB): writer resolves null when the table is absent
 * (pre-migration deploy) and never throws; reader returns empty page.
 */
import { describe, it, expect, vi } from 'vitest'
import { buildAuditMetadata, recordAudit, listAuditLogs } from '../src/services/auditLog'

describe('buildAuditMetadata', () => {
  it('buildAuditMetadata_strips_secrets (password/apiKey/token)', () => {
    const out = buildAuditMetadata({ email: 'a@x.edu', password: 'x', apiKey: 'k', token: 't', count: 3 })
    expect(out).toContain('a@x.edu')
    expect(out).not.toContain('"password"')
    expect(out).not.toContain('"apiKey"')
    expect(out).not.toContain('"token"')
  })
  it('buildAuditMetadata_null_in_null_out', () => {
    expect(buildAuditMetadata(null)).toBeNull()
    expect(buildAuditMetadata(undefined)).toBeNull()
  })
  it('buildAuditMetadata_caps_length', () => {
    const out = buildAuditMetadata({ big: 'x'.repeat(5000) })
    expect((out ?? '').length).toBeLessThanOrEqual(2000)
  })
})

describe('recordAudit', () => {
  it('recordAudit_no_table_resolves_null (pre-migration safe)', async () => {
    await expect(recordAudit({ action: 'USER_DELETE' }, {} as any)).resolves.toBeNull()
    await expect(recordAudit({ action: 'USER_DELETE' }, { auditLog: {} } as any)).resolves.toBeNull()
  })
  it('recordAudit_db_error_never_throws', async () => {
    const db = { auditLog: { create: vi.fn(async () => { throw new Error('down') }) } } as any
    await expect(recordAudit({ action: 'X' }, db)).resolves.toBeNull()
  })
  it('recordAudit_writes_sanitized_shape', async () => {
    const create = vi.fn(async () => ({}))
    await recordAudit(
      { actorId: 'u1', actorEmail: 'a@x.edu', actorRole: 'SUPER_ADMIN', action: 'COLLEGE_APPROVE', entityType: 'COLLEGE', entityId: 'c1', collegeId: 'c1', metadata: '{"name":"X"}' },
      { auditLog: { create } } as any,
    )
    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0][0].data).toMatchObject({ actorId: 'u1', action: 'COLLEGE_APPROVE', entityId: 'c1' })
  })
})

describe('listAuditLogs', () => {
  it('listAuditLogs_no_table_returns_empty_page', async () => {
    await expect(listAuditLogs({}, {} as any)).resolves.toEqual({ data: [], total: 0, page: 1, limit: 25 })
  })
  it('listAuditLogs_passes_filters_and_paging', async () => {
    const findMany = vi.fn(async () => [{ id: 'a1' }])
    const count = vi.fn(async () => 1)
    const res = await listAuditLogs(
      { collegeId: 'c1', action: 'USER_DELETE', search: 'a@x', page: 2, limit: 10 },
      { auditLog: { findMany, count } } as any,
    )
    expect(res).toMatchObject({ total: 1, page: 2, limit: 10 })
    expect(findMany).toHaveBeenCalledOnce()
    const args = findMany.mock.calls[0][0]
    expect(args.where).toMatchObject({ collegeId: 'c1', action: 'USER_DELETE' })
    expect(args.skip).toBe(10)
    expect(args.take).toBe(10)
  })
})
