// services/selfDelete.ts — #12 DELETE /user/me pure helpers (hermetic).
// WHY: privacy.md §3 mandates anonymize-not-delete (FK graph has no
// onDelete:Cascade on regs/submissions/responses — hard delete would orphan
// or 500). Pure helpers here are unit-tested without DB; the route in
// routes/user.ts wires them to prisma + bcrypt + auditLog.
// No PII in logs: audit metadata is { selfDelete:true } only.

import { randomBytes, randomUUID } from 'crypto'
import { buildAuditMetadata, type AuditEntry } from './auditLog'

export interface AnonymizedUserPatch {
  id: string
  name: string
  email: string
  username: null
  passwordHash: string
  role: string
  collegeId: null
  studentId: null
  empNumber: null
  departmentId: null
  incomingYear: null
  outgoingYear: null
  avatar: null
  portfolioUrl: null
  preferences: null
}

/** Build the anonymized patch for a user id. Unique email per call (uuid). */
export function buildAnonymizedUser(id: string): AnonymizedUserPatch {
  return {
    id,
    name: 'Deleted User',
    email: `deleted_${randomUUID()}@deleted.local`,
    username: null,
    passwordHash: randomBytes(32).toString('hex'),
    role: 'STUDENT',
    collegeId: null,
    studentId: null,
    empNumber: null,
    departmentId: null,
    incomingYear: null,
    outgoingYear: null,
    avatar: null,
    portfolioUrl: null,
    preferences: null,
  }
}

/** Detect an already-anonymized row → second DELETE returns 404. */
export function isDeletedUser(
  user: { email?: string | null; name?: string | null } | null | undefined,
): boolean {
  if (!user?.email) return false
  return user.email.endsWith('@deleted.local')
}

/** Audit entry for self-delete — no PII payload (id + role only). */
export function buildSelfDeleteAudit(userId: string, role?: string | null): AuditEntry {
  return {
    actorId: userId,
    actorEmail: null,
    actorRole: role ?? null,
    action: 'USER_SELF_DELETE',
    entityType: 'User',
    entityId: userId,
    collegeId: null,
    metadata: buildAuditMetadata({ selfDelete: true }),
  }
}
