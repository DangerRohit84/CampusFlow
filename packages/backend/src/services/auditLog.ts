// services/auditLog.ts — #11 minimal admin-mutation audit trail.
// WHY: admin mutations (user create/delete, approve/reject, college actions,
// bulk imports, AI quota changes) had no forensic trail — SuperAdmin could not
// answer "who approved X / deleted Y". Single best-effort writer + guarded
// reader so pre-migration deploys (table absent) stay green: every DB touch is
// `(db as any).auditLog?` + try/catch, returning null/[] instead of throwing
// (SourceHealth / SyncThrottle fallback pattern). No secrets: metadata is a
// caller-built JSON string — never pass passwordHash/apiKey/tempPassword.

import prisma from '../config/db'
import { logger } from '../utils/logger'

export const AuditActions = {
  USER_CREATE: 'USER_CREATE',
  USER_UPDATE: 'USER_UPDATE',
  USER_DELETE: 'USER_DELETE',
  USER_BULK_CREATE: 'USER_BULK_CREATE',
  USER_BULK_DRY_RUN: 'USER_BULK_DRY_RUN',
  COLLEGE_REGISTER: 'COLLEGE_REGISTER',
  COLLEGE_APPROVE: 'COLLEGE_APPROVE',
  COLLEGE_REJECT: 'COLLEGE_REJECT',
  COLLEGE_DELETE: 'COLLEGE_DELETE',
  AI_QUOTA_UPDATE: 'AI_QUOTA_UPDATE',
} as const

export type AuditAction = (typeof AuditActions)[keyof typeof AuditActions] | string

export interface AuditEntry {
  actorId?: string | null
  actorEmail?: string | null
  actorRole?: string | null
  action: AuditAction
  entityType?: string | null
  entityId?: string | null
  collegeId?: string | null
  /** Json|String (caller-owned, must not contain secrets). String kept for test compat; writer converts to Json for DB. */
  metadata?: string | Record<string, unknown> | null
}

type DbLike = {
  auditLog?: {
    create?: (args: unknown) => Promise<unknown>
    findMany?: (args: unknown) => Promise<unknown[]>
    count?: (args: unknown) => Promise<number>
  }
}

/** Build a safe metadata string (strips secret-looking keys, caps length). Kept string for test compat. */
export function buildAuditMetadata(input: Record<string, unknown> | null | undefined): string | null {
  if (!input || typeof input !== 'object') return null
  const DENY = ['password', 'passwordhash', 'temppassword', 'apikey', 'token', 'secret', 'authorization']
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (DENY.includes(k.toLowerCase())) continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v == null) {
      clean[k] = v
    } else {
      try {
        clean[k] = JSON.parse(JSON.stringify(v))
      } catch {
        clean[k] = String(v)
      }
    }
  }
  try {
    return JSON.stringify(clean).slice(0, 2000)
  } catch {
    return null
  }
}

/** Build safe metadata as Json object for DB writes (string builder above kept for tests). */
export function buildAuditMetadataJson(input: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  const s = buildAuditMetadata(input)
  if (!s) return null
  try {
    const p: unknown = JSON.parse(s)
    if (p && typeof p === 'object' && !Array.isArray(p)) return p as Record<string, unknown>
    return null
  } catch {
    return null
  }
}

/** Best-effort write. Resolves null when the table is absent (pre-migration). */
export async function recordAudit(entry: AuditEntry, db: DbLike = prisma as unknown as DbLike): Promise<null> {
  try {
    const create = (db as DbLike)?.auditLog?.create
    if (typeof create !== 'function') return null
    await create.call((db as DbLike).auditLog, {
      data: {
        actorId: entry.actorId ?? null,
        actorEmail: entry.actorEmail ?? null,
        actorRole: entry.actorRole ?? null,
        action: String(entry.action),
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        collegeId: entry.collegeId ?? null,
        metadata: (entry as any).metadata === null || (entry as any).metadata === undefined ? null : (typeof (entry as any).metadata === 'string' ? (() => { try { const q = JSON.parse(((entry as any).metadata as string).trim() || 'null'); return (q && typeof q === 'object' && !Array.isArray(q)) ? q : null } catch { return null } })() : (entry as any).metadata) as any,
      },
    })
  } catch (err) {
    logger.debug({ err: (err as Error)?.message || err }, '[auditLog] write failed (non-fatal)')
  }
  return null
}

export interface AuditListParams {
  collegeId?: string | null
  action?: string | null
  actorId?: string | null
  search?: string | null
  from?: Date | null
  to?: Date | null
  page?: number
  limit?: number
}

/** Guarded reader — [] when table absent. Search matches actorEmail/action/entityId. */
export async function listAuditLogs(
  params: AuditListParams = {},
  db: DbLike = prisma as unknown as DbLike,
): Promise<{ data: unknown[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, params.page ?? 1)
  const limit = Math.min(100, Math.max(1, params.limit ?? 25))
  try {
    const store = (db as DbLike)?.auditLog
    if (typeof store?.findMany !== 'function' || typeof store?.count !== 'function') {
      return { data: [], total: 0, page, limit }
    }
    const where: Record<string, unknown> = {}
    if (params.collegeId) where.collegeId = params.collegeId
    if (params.action) where.action = params.action
    if (params.actorId) where.actorId = params.actorId
    if (params.from || params.to) {
      const range: Record<string, Date> = {}
      if (params.from) range.gte = params.from
      if (params.to) range.lte = params.to
      where.createdAt = range
    }
    if (params.search) {
      const q = String(params.search)
      where.OR = [
        { actorEmail: { contains: q, mode: 'insensitive' } },
        { action: { contains: q, mode: 'insensitive' } },
        { entityId: { contains: q, mode: 'insensitive' } },
      ]
    }
    const [rows, total] = await Promise.all([
      store.findMany!({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: (page - 1) * limit,
      }),
      store.count!({ where }),
    ])
    return { data: rows, total, page, limit }
  } catch (err) {
    logger.debug({ err: (err as Error)?.message || err }, '[auditLog] list failed (non-fatal)')
    return { data: [], total: 0, page, limit }
  }
}
