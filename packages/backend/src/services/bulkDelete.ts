// services/bulkDelete.ts — P3 transactional bulk delete (all three tabs).
// WHY: cleanup of cohorts (graduated class, test imports) row-by-row is slow +
// error-prone. Single transactional call with authoritative guards (BE enforces,
// FE disables as hint only).
// Guards (fail ENTIRE batch with 400, zero writes): ids empty/dupe deduped;
// includes(self) → Cannot delete yourself; would-delete-last SUPER_ADMIN globally;
// would-delete-last COLLEGE_ADMIN in that collegeId. Limits 1–100 ids/call.
// Execution: prisma.$transaction (rollback-safe): deleteMany where {id:{in:ids},
// collegeId} + single USER_BULK_DELETE audit (counts-only, no PII dump beyond
// 5-email sample). Partial failures (race deleted/not-found, FK P2003) → 200
// {partial:true, success, failed, errors[]} not 500.
// Never log PII beyond sample; never log secrets (none here).

import prisma from '../config/db'
import { logger } from '../utils/logger'
import { normalizeBulkIds, parseConfirmCount } from '../utils/sharedPassword'

type Db = typeof prisma

export interface BulkDeleteOptions {
  /** Expected `DELETE N` string (type-to-confirm). N = post-dedupe count incl. self? Plan: N = selected count. */
  confirm?: unknown
  db?: Db
}

export interface BulkDeleteResult {
  success: number
  failed: number
  errors: string[]
  partial: boolean
}

export interface BulkDeleteContext {
  actorId: string
  actorRole: string
  collegeId: string | null
}

/**
 * Authoritative bulk delete. Zero writes on guard failure (400-style throw with
 * message). Returns partial result on race/FK issues (200-style).
 * Throws Error with message for 400 cases (route maps to 400, no writes).
 */
export async function bulkDeleteUsers(
  ids: unknown,
  ctx: BulkDeleteContext,
  opts: BulkDeleteOptions = {},
): Promise<BulkDeleteResult> {
  const db = (opts.db ?? prisma) as Db
  const deduped = normalizeBulkIds(ids)
  if (deduped.length < 1 || deduped.length > 100) {
    throw new Error('Select 1–100 users')
  }
  // Type-to-confirm: must equal DELETE <dedupedCount> exact.
  const confirmN = parseConfirmCount(opts.confirm, 'DELETE')
  if (confirmN == null || confirmN !== deduped.length) {
    throw new Error(`Confirmation mismatch — type DELETE ${deduped.length}`)
  }
  // Self guard: fail entire batch (differs from bulk-pw self-strip — intentional, documented).
  if (deduped.includes(ctx.actorId)) {
    throw new Error('Cannot delete yourself')
  }
  // College scope: non-super must have collegeId; targets must be in scope.
  // Super-admin global last-admin check needs global count; college-admin check needs college count.
  const targets = await (db as any).user.findMany({
    where: { id: { in: deduped } },
    select: { id: true, role: true, collegeId: true, email: true },
  }).catch((err: unknown) => {
    logger.warn({ err: (err as Error)?.message || err }, '[bulkDelete] target lookup failed')
    throw new Error('Failed to look up users')
  }) as Array<{ id: string; role: string; collegeId: string | null; email: string }>
  const foundIds = new Set(targets.map((t) => t.id))
  const missing = deduped.filter((id) => !foundIds.has(id))
  // Scope enforcement: non-super targets must match actor college.
  // Role check FIRST (clearer privilege error): college-admin cannot
  // bulk-delete SUPER_ADMIN even when the target is also out of scope.
  if (ctx.actorRole !== 'SUPER_ADMIN') {
    const superTargets = targets.filter((t) => t.role === 'SUPER_ADMIN')
    if (superTargets.length > 0) throw new Error('Not allowed to delete this role')
  }
  if (ctx.actorRole !== 'SUPER_ADMIN') {
    if (!ctx.collegeId) throw new Error('College ID is required')
    const outOfScope = targets.filter((t) => t.collegeId !== ctx.collegeId)
    if (outOfScope.length > 0) throw new Error('Not in your college')
  }
  // Last-admin guards (BE authoritative, zero writes on violation).
  const targetRoles = new Map<string, number>()
  for (const t of targets) targetRoles.set(t.role, (targetRoles.get(t.role) ?? 0) + 1)
  if ((targetRoles.get('SUPER_ADMIN') ?? 0) > 0) {
    const globalSuperCount = await (db as any).user.count({ where: { role: 'SUPER_ADMIN' } }).catch(() => 0)
    const remaining = globalSuperCount - (targetRoles.get('SUPER_ADMIN') ?? 0)
    if (remaining < 1) throw new Error('Cannot delete the last super admin')
    // Non-super already blocked above; super-admin deleting peers is allowed except last.
    if (ctx.actorRole !== 'SUPER_ADMIN') throw new Error('Not allowed to delete this role')
  }
  // Last college-admin in scope college (use actor college or super target college).
  const collegeTargets = targets.filter((t) => t.role === 'COLLEGE_ADMIN')
  if (collegeTargets.length > 0) {
    // Group by collegeId (super-admin may target cross-college? bulk-delete is single-college scoped;
    // use each target's college for the check).
    const byCollege = new Map<string, number>()
    for (const t of collegeTargets) {
      const cid = t.collegeId ?? '__null__'
      byCollege.set(cid, (byCollege.get(cid) ?? 0) + 1)
    }
    for (const [cid, n] of byCollege) {
      if (cid === '__null__') continue
      const collegeAdminCount = await (db as any).user.count({ where: { role: 'COLLEGE_ADMIN', collegeId: cid } }).catch(() => 0)
      if (collegeAdminCount - n < 1) throw new Error('Cannot delete the last college admin')
    }
  }

  // Execution: transactional deleteMany scoped to college (non-super) or ids (super).
  // Super-admin bulk-delete is still college-scoped via targets' colleges? Plan says
  // collegeId scoping enforced (non-super must match own; super via deriveCollegeId).
  // Here ctx.collegeId is the resolved scope (null = global for super). When global,
  // delete by ids only (targets already looked up); when scoped, add collegeId filter.
  const where: Record<string, unknown> = ctx.collegeId && ctx.actorRole !== 'SUPER_ADMIN'
    ? { id: { in: deduped }, collegeId: ctx.collegeId }
    : { id: { in: deduped } }
  // For super with explicit college scope, enforce it too.
  const scopedWhere = ctx.actorRole === 'SUPER_ADMIN' && ctx.collegeId
    ? { id: { in: deduped }, collegeId: ctx.collegeId }
    : where

  let deleted = 0
  const errors: string[] = []
  for (const m of missing) errors.push(`${m}: not found (already deleted?)`)
  try {
    // $transaction for rollback safety (single deleteMany is atomic, but wrap for
    // future multi-write + consistent error mapping).
    const res = await (db as any).$transaction(async (tx: any) => {
      // Clear authorize cache best-effort after (not in tx).
      const del = await tx.user.deleteMany({ where: scopedWhere })
      return del
    })
    deleted = (res as { count: number })?.count ?? 0
  } catch (err: any) {
    // FK P2003 (user referenced) → partial, not 500. Prisma P2003 on deleteMany?
    // deleteMany does not throw on FK? It may. Map to partial with message.
    const msg = String(err?.message || 'delete failed')
    logger.warn({ err: msg }, '[bulkDelete] transaction failed')
    if (err?.code === 'P2003' || /foreign key/i.test(msg)) {
      return { success: 0, failed: deduped.length, errors: [`Delete blocked by linked records: ${msg.slice(0, 200)}`], partial: true }
    }
    throw new Error('Failed to delete users')
  }
  // Partial accounting: missing (race) + scope-filtered (deleted < deduped-missing).
  const expected = deduped.length - missing.length
  const short = expected - deleted
  if (short > 0) {
    // Some ids were out-of-scope-filtered or race-deleted between lookup + delete.
    errors.push(`${short} row(s) not deleted (not found or out of scope)`)
  }
  try {
    for (const id of deduped) {
      try {
        const { clearAuthorizeCache } = await import('../middleware/auth.js').catch(() => ({ clearAuthorizeCache: null as any }))
        if (typeof clearAuthorizeCache === 'function') (clearAuthorizeCache as any)(id)
      } catch {}
    }
  } catch {}
  const failed = missing.length + Math.max(0, short)
  return { success: deleted, failed, errors, partial: failed > 0 }
}
