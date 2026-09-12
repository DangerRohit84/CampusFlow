/**
 * #12 self-delete: pure helpers for DELETE /user/me (hermetic, no DB).
 * RED first — implementation lives in src/services/selfDelete.ts.
 */
import { describe, it, expect } from 'vitest'
import {
  buildAnonymizedUser,
  isDeletedUser,
  buildSelfDeleteAudit,
} from '../src/services/selfDelete'

describe('self-delete anonymize (privacy.md §3)', () => {
  it('buildAnonymizedUser_erases_PII_keeps_id', () => {
    const out = buildAnonymizedUser('user-123')
    expect(out.id).toBe('user-123')
    expect(out.name).toBe('Deleted User')
    expect(out.email).toMatch(/^deleted_.+@deleted\.local$/)
    expect(out.studentId).toBeNull()
    expect(out.empNumber).toBeNull()
    expect(out.avatar).toBeNull()
    expect(out.portfolioUrl).toBeNull()
    expect(out.preferences).toBeNull()
    expect(out.role).toBe('STUDENT')
    expect(out.collegeId).toBeNull()
    expect(out.username).toBeNull()
    expect(out.passwordHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('buildAnonymizedUser_unique_emails_per_call (no unique clash)', () => {
    const a = buildAnonymizedUser('u1')
    const b = buildAnonymizedUser('u2')
    expect(a.email).not.toBe(b.email)
  })

  it('isDeletedUser_detects_anonymized_rows (second delete -> 404)', () => {
    expect(isDeletedUser({ email: 'deleted_abc@deleted.local', name: 'Deleted User' } as any)).toBe(true)
    expect(isDeletedUser({ email: 'real@college.edu', name: 'Jane' } as any)).toBe(false)
    expect(isDeletedUser(null)).toBe(false)
  })

  it('buildSelfDeleteAudit_has_no_PII_payload', () => {
    const entry = buildSelfDeleteAudit('user-123', 'STUDENT')
    expect(entry.actorId).toBe('user-123')
    expect(entry.entityId).toBe('user-123')
    expect(entry.entityType).toBe('User')
    expect(entry.action).toBe('USER_SELF_DELETE')
    // metadata must not contain email/password/token
    expect(entry.metadata ?? '').not.toMatch(/password|token|@/)
  })
})
