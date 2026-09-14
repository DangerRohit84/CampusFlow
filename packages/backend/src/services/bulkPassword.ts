// services/bulkPassword.ts — Bulk password actions via checkbox multi-select (shared set + force-reset).
// WHY: a whole class forgetting the shared onboarding password needs one action
// to restore access (not per-user tickets). Option A (RECOMMENDED, V1): ONE shared
// password for all selected — admin-typed `shared-set` or auto-generated
// `shared-reset`. Reuses P1 validator + show-once + nudge (single HIBP call,
// single panel to copy, single audit entry).
// §10 ADDENDUM (2026-09-14, SUPERSEDES forced block): optional change, NO forced
// block — nudge only, mustChangePassword stays false (DO NOT set it here; leave
// untouched so import cohorts keep their flag). Nudge trigger is passwordNudgeAt
// (set when nudgeUsers=true default, cleared on change-password). No route block:
// all routes accessible with shared pw; FE shows a dismissible banner.
// Safety: never echo admin-chosen pw (only auto-generated sharedTempPassword
// crosses wire once over TLS). No per-user list. buildAuditMetadata strips both.
// Guards authoritative server-side: self-strip (NOT fail-all — differs from delete),
// college scope, role matrix (COLLEGE_ADMIN→STUDENT/TEACHER only; SUPER_ADMIN→any
// except SUPER_ADMIN), 1–100 ids, RESET N confirm, 5 ops/10min + 1000 users/day
// rate limit (in-memory V1, same single-instance documented limit as
// authHardening attempts; test hook clearBulkPasswordRateForTests).
// Sessions: per-user JWT revocation is not possible statelessly (no per-user jti
// registry); change-password revokes the caller's jti. Bulk-pw does NOT claim
// revocation — access TTL (1d) bounds the window + nudge drives rotation.
// Documented residual risk in the impl report (acceptance "old sessions 401"
// NOT met by design — honest gap, see report).
// Injectable `db` + `breachCheck` for hermetic tests (DIP); logger on every catch.

import bcrypt from 'bcryptjs'
import prisma from '../config/db'
import { logger } from '../utils/logger'
import {
  validateSharedPasswordFull,
  generateSharedPassword,
  parseConfirmCount,
  normalizeBulkIds,
  type BreachCheck,
} from '../utils/sharedPassword'

type Db = typeof prisma

export type BulkPasswordMode = 'shared-set' | 'shared-reset'

export interface BulkPasswordInput {
  ids: unknown
  collegeId?: unknown
  mode?: unknown
  sharedPassword?: unknown
  autoGenerate?: unknown
  /** @deprecated §10: ignored if sent (nudge-only now). */
  forceMustChange?: unknown
  /** Default true. false = kiosk edge (no banner). */
  nudgeUsers?: unknown
  confirm?: unknown
  dryRun?: unknown
}

export interface BulkPasswordResult {
  success: number
  failed: number
  skippedSelf: number
  partial: boolean
  errors: string[]
  /** §10: nudge trigger on (default) vs off (kiosk). */
  nudgeEnabled: boolean
  /** Only when mode=shared-reset on confirm — single show-once value. NEVER on dry-run. */
  sharedTempPassword?: string
  /** Always false on wire (never echo secrets). */
  sharedPasswordEcho: false
  /** §10: dry-run only — shared validation hint (server authoritative). */
  sharedPassword?: { valid: boolean; errors: string[] }
  validCount?: number
  dryRun?: true
}

export interface BulkPasswordContext {
  actorId: string
  actorRole: string
  actorCollegeId: string | null
  /** Resolved target college scope (deriveCollegeId result). Null = global (super-admin). */
  scopeCollegeId: string | null
}

export interface BulkPasswordOptions {
  db?: Db
  breachCheck?: BreachCheck
}

// --- Rate limit (in-memory V1, per-actor) ---
// 5 ops/10min/actor + 1000 users/day/actor. Process-local (same documented limit
// as authHardening attempts/Maps). Counters keyed `actorId`; ops window sliding,
// users/day fixed calendar-ish (24h rolling). 429 surfaces retryAfterSec.
const OPS_WINDOW_MS = 10 * 60 * 1000
const OPS_LIMIT = 5
const USERS_DAY_MS = 24 * 60 * 60 * 1000
const USERS_DAY_LIMIT = 1000

interface ActorBucket {
  opsAt: number[]
  usersAt: Array<{ at: number; n: number }>
}

const buckets = new Map<string, ActorBucket>()

/** Test-only: clear rate-limit state (isolates hermetic tests). */
export function clearBulkPasswordRateForTests(): void {
  buckets.clear()
}

function pruneBucket(b: ActorBucket, now: number): void {
  b.opsAt = b.opsAt.filter((t) => now - t < OPS_WINDOW_MS)
  b.usersAt = b.usersAt.filter((e) => now - e.at < USERS_DAY_MS)
  // Cap growth (abuse of distinct actors is bounded by Map; per-actor slices capped).
  if (b.opsAt.length > OPS_LIMIT * 2) b.opsAt = b.opsAt.slice(-OPS_LIMIT * 2)
  if (b.usersAt.length > 100) b.usersAt = b.usersAt.slice(-100)
}

export function checkBulkPasswordRate(
  actorId: string,
  usersRequested: number,
  now = Date.now(),
): { allowed: boolean; retryAfterSec?: number } {
  const b = buckets.get(actorId) ?? { opsAt: [], usersAt: [] }
  pruneBucket(b, now)
  if (b.opsAt.length >= OPS_LIMIT) {
    const oldest = Math.min(...b.opsAt)
    const retryAfterSec = Math.max(1, Math.ceil((oldest + OPS_WINDOW_MS - now) / 1000))
    buckets.set(actorId, b)
    return { allowed: false, retryAfterSec }
  }
  const usersInDay = b.usersAt.reduce((a, e) => a + e.n, 0)
  if (usersInDay + usersRequested > USERS_DAY_LIMIT) {
    const oldest = b.usersAt.length ? Math.min(...b.usersAt.map((e) => e.at)) : now
    const retryAfterSec = Math.max(1, Math.ceil((oldest + USERS_DAY_MS - now) / 1000))
    buckets.set(actorId, b)
    return { allowed: false, retryAfterSec }
  }
  buckets.set(actorId, b)
  return { allowed: true }
}

function recordBulkPasswordRate(actorId: string, usersAffected: number, now = Date.now()): void {
  const b = buckets.get(actorId) ?? { opsAt: [], usersAt: [] }
  b.opsAt.push(now)
  if (usersAffected > 0) b.usersAt.push({ at: now, n: usersAffected })
  pruneBucket(b, now)
  buckets.set(actorId, b)
}

function err400(message: string): Error {
  const e = new Error(message) as Error & { status?: number }
  e.status = 400
  return e
}

function err403(message: string): Error {
  const e = new Error(message) as Error & { status?: number }
  e.status = 403
  return e
}

function err429(message: string, retryAfterSec: number): Error {
  const e = new Error(message) as Error & { status?: number; retryAfterSec?: number }
  e.status = 429
  e.retryAfterSec = retryAfterSec
  return e
}

function normalizeMode(raw: unknown): BulkPasswordMode | null {
  const v = String(raw ?? '').trim().toLowerCase()
  if (v === 'shared-set') return 'shared-set'
  if (v === 'shared-reset') return 'shared-reset'
  return null
}

/**
 * Authoritative bulk password reset. Zero writes on 400/403/429 (throws with
 * .status for the route to map). Returns partial result (200-style) for
 * race/not-found/wrong-college rows. NEVER throws for per-row issues.
 */
export async function bulkPasswordReset(
  input: BulkPasswordInput,
  ctx: BulkPasswordContext,
  opts: BulkPasswordOptions = {},
): Promise<BulkPasswordResult> {
  const db = (opts.db ?? prisma) as Db
  const b = input as unknown as Record<string, unknown>
  const isDryRun = b.dryRun === true

  // --- Normalize ids (dedupe) + split self ---
  const deduped = normalizeBulkIds(input.ids)
  if (deduped.length < 1 || deduped.length > 100) {
    throw err400('Select 1–100 users')
  }
  const skippedSelf = deduped.includes(ctx.actorId) ? 1 : 0
  const nonSelfIds = deduped.filter((id) => id !== ctx.actorId)
  if (nonSelfIds.length < 1) {
    throw err400('Cannot reset only yourself — use Change Password')
  }

  // --- Mode ---
  const mode = normalizeMode(input.mode)
  if (!mode) {
    throw err400('Invalid mode. Use shared-set or shared-reset.')
  }
  const autoGenerate = b.autoGenerate === true
  if (mode === 'shared-set' && autoGenerate) {
    throw err400('autoGenerate must be false for shared-set')
  }
  if (mode === 'shared-reset' && !autoGenerate) {
    throw err400('autoGenerate must be true for shared-reset')
  }
  const hasShared = input.sharedPassword != null && String(input.sharedPassword) !== ''
  if (mode === 'shared-set' && !hasShared && !isDryRun) {
    throw err400('Shared password is required. Set one password for all selected users.')
  }
  if (mode === 'shared-reset' && hasShared) {
    throw err400('Do not send sharedPassword with shared-reset (autoGenerate=true)')
  }
  if (b.forceMustChange !== undefined) {
    logger.debug('[bulkPassword] deprecated forceMustChange ignored (nudge-only §10)')
  }
  const nudgeEnabled = b.nudgeUsers === false ? false : true

  // --- Confirm gate: RESET <nonSelfDedupedCount> exact (confirm counts EXCLUDE self) ---
  const confirmN = parseConfirmCount(input.confirm, 'RESET')
  if (confirmN == null || confirmN !== nonSelfIds.length) {
    throw err400(`Confirmation mismatch — type RESET ${nonSelfIds.length}`)
  }

  // --- Resolve effective shared value (dry-run may omit) ---
  let effectiveShared: string | null = null
  let generatedOnce: string | undefined
  if (mode === 'shared-reset') {
    generatedOnce = generateSharedPassword()
    effectiveShared = generatedOnce
  } else if (hasShared) {
    effectiveShared = String(input.sharedPassword)
  }

  // --- Shared validation (single HIBP call per batch) ---
  if (effectiveShared != null) {
    const check = await validateSharedPasswordFull(effectiveShared, opts.breachCheck)
    if (!check.valid) {
      if (isDryRun) {
        return {
          success: 0,
          failed: nonSelfIds.length,
          skippedSelf,
          partial: false,
          errors: [...check.errors],
          nudgeEnabled,
          sharedPasswordEcho: false,
          sharedPassword: { valid: false, errors: check.errors },
          validCount: 0,
          dryRun: true,
        }
      }
      throw err400(check.errors[0] ?? 'Invalid shared password')
    }
  } else if (isDryRun) {
    // Dry-run without shared: validate ids/scope only + hint.
    const hint = { valid: false, errors: ['Shared password required on confirm'] }
    const targets = await lookupTargets(db, nonSelfIds)
    const scopeCheck = checkScopeAndRole(targets, ctx)
    if (!scopeCheck.ok) throw scopeCheck.error
    const part0 = partitionScope(targets.found, ctx)
    return {
      success: 0,
      failed: 0,
      skippedSelf,
      partial: false,
      errors: [],
      nudgeEnabled,
      sharedPasswordEcho: false,
      sharedPassword: hint,
      validCount: part0.inScope.length,
      dryRun: true,
    }
  }

  // --- Look up targets + scope/role guards (fail-fast 403, zero writes) ---
  const targets = await lookupTargets(db, nonSelfIds)
  const scopeCheck = checkScopeAndRole(targets, ctx)
  if (!scopeCheck.ok) throw scopeCheck.error
  // Row-level college partition: wrong-college rows become per-row partial
  // failures (plan §2), in-scope rows proceed. Non-super scope = own college;
  // super scope = explicit college when supplied, else global.
  const part = partitionScope(targets.found, ctx)

  if (isDryRun) {
    const check = effectiveShared != null
      ? { valid: true as const, errors: [] as string[] }
      : { valid: false as const, errors: ['Shared password required on confirm'] }
    return {
      success: 0,
      failed: 0,
      skippedSelf,
      partial: false,
      errors: [],
      nudgeEnabled,
      sharedPasswordEcho: false,
      sharedPassword: check,
      validCount: part.inScope.length,
      dryRun: true,
    }
  }

  // --- Rate limit (confirm only, after validation so bad requests don't burn budget) ---
  const rate = checkBulkPasswordRate(ctx.actorId, part.inScope.length)
  if (!rate.allowed) {
    throw err429(`Too many password resets — retry in ${rate.retryAfterSec ?? 60}s`, rate.retryAfterSec ?? 60)
  }

  // --- Execute: single hash, updateMany scoped, nudge trigger ---
  // effectiveShared is non-null here (shared-set required, shared-reset generated).
  const plain = effectiveShared as string
  let hash: string
  try {
    const bcryptMod = await import('bcryptjs').catch(() => null) as typeof import('bcryptjs') | null
    hash = bcryptMod ? await bcryptMod.hash(plain, 12) : await (await import('bcryptjs')).hash(plain, 12)
  } catch (err) {
    logger.warn({ err: (err as Error)?.message || err }, '[bulkPassword] hash failed')
    throw err400('Failed to hash shared password')
  }

  const inScopeIds = part.inScope.map((t) => t.id)
  const missingErrors = targets.missing.map((id) => `${id}: not found (already deleted?)`)
  const wrongCollegeErrors = part.wrongCollege.map((t) => `${t.email ?? t.id}: Not in your college`)

  let updated = 0
  try {
    // §10: set passwordHash + passwordNudgeAt (when enabled). mustChangePassword
    // untouched (stays false for this cohort). Pre-migration safe: P2022 fallback.
    const data: Record<string, unknown> = { passwordHash: hash }
    if (nudgeEnabled) data.passwordNudgeAt = new Date()
    try {
      const res = await (db as any).user.updateMany({
        where: { id: { in: inScopeIds } },
        data,
      })
      updated = (res as { count: number })?.count ?? 0
    } catch (err: any) {
      if (err?.code === 'P2022' || /passwordNudgeAt/i.test(String(err?.message || ''))) {
        logger.warn('[bulkPassword] passwordNudgeAt column missing (pre-migration) — updating hash only')
        const res = await (db as any).user.updateMany({
          where: { id: { in: inScopeIds } },
          data: { passwordHash: hash },
        })
        updated = (res as { count: number })?.count ?? 0
      } else throw err
    }
  } catch (err: any) {
    if ((err as any)?.status) throw err
    logger.warn({ err: (err as Error)?.message || err }, '[bulkPassword] updateMany failed')
    throw err400('Failed to reset passwords')
  }

  const short = inScopeIds.length - updated
  const errors = [...missingErrors, ...wrongCollegeErrors]
  if (short > 0) errors.push(`${short} row(s) not updated (race deleted?)`)
  const failed = missingErrors.length + wrongCollegeErrors.length + Math.max(0, short)

  recordBulkPasswordRate(ctx.actorId, updated)

  return {
    success: updated,
    failed,
    skippedSelf,
    partial: failed > 0,
    errors: errors.slice(0, 50),
    nudgeEnabled,
    ...(mode === 'shared-reset' ? { sharedTempPassword: generatedOnce as string } : {}),
    sharedPasswordEcho: false,
  }
}

interface FoundTarget {
  id: string
  role: string
  collegeId: string | null
  email?: string
}

async function lookupTargets(
  db: Db,
  ids: string[],
): Promise<{ found: FoundTarget[]; missing: string[]; wrongCollege: FoundTarget[]; outOfScope: FoundTarget[] }> {
  let rows: FoundTarget[] = []
  try {
    rows = (await (db as any).user.findMany({
      where: { id: { in: ids } },
      select: { id: true, role: true, collegeId: true, email: true },
    })) as FoundTarget[]
  } catch (err) {
    logger.warn({ err: (err as Error)?.message || err }, '[bulkPassword] target lookup failed')
    throw err400('Failed to look up users')
  }
  const foundIds = new Set(rows.map((r) => r.id))
  const missing = ids.filter((id) => !foundIds.has(id))
  return { found: rows, missing, wrongCollege: [], outOfScope: [] }
}

/**
 * Scope + role matrix (fail-fast, zero writes):
 * - SUPER_ADMIN role targets: always 403 (out of scope §8 — even for super actors).
 * - COLLEGE_ADMIN actor: targets must be STUDENT/TEACHER (peer admin → 403).
 * - Non-super actor with explicit other-college scope: 403 (scope escalation).
 * - Row-level wrong-college: NOT fail-fast → caller partitions into per-row
 *   partial failures (plan §2), except strict tenant case below.
 * Returns partitioned wrongCollege rows for partial reporting.
 */
function checkScopeAndRole(
  targets: { found: FoundTarget[]; missing: string[]; wrongCollege: FoundTarget[]; outOfScope: FoundTarget[] },
  ctx: BulkPasswordContext,
): { ok: boolean; error?: Error } {
  // SUPER_ADMIN targets are never bulk-resettable (§8 out of scope).
  if (targets.found.some((t) => t.role === 'SUPER_ADMIN')) {
    return { ok: false, error: err403('Not allowed to reset this role') }
  }
  if (ctx.actorRole === 'COLLEGE_ADMIN') {
    // Peer college-admin (or any admin) targets → 403 zero writes.
    if (targets.found.some((t) => t.role === 'COLLEGE_ADMIN')) {
      return { ok: false, error: err403('Not allowed to reset this role') }
    }
    // Scope escalation via explicit collegeId param → 403.
    if (ctx.scopeCollegeId && ctx.actorCollegeId && ctx.scopeCollegeId !== ctx.actorCollegeId) {
      return { ok: false, error: err403('Not in your college') }
    }
  }
  return { ok: true }
}

/**
 * Partition found targets into in-scope vs wrong-college for partial reporting.
 * Non-super actors: scope = own college. Super actors: scope = explicit college
 * when supplied, else global (all in scope).
 */
export function partitionScope(
  found: FoundTarget[],
  ctx: BulkPasswordContext,
): { inScope: FoundTarget[]; wrongCollege: FoundTarget[] } {
  if (ctx.actorRole === 'SUPER_ADMIN' && !ctx.scopeCollegeId) {
    return { inScope: found, wrongCollege: [] }
  }
  const scope = ctx.actorRole === 'SUPER_ADMIN' ? ctx.scopeCollegeId : ctx.actorCollegeId
  const inScope = found.filter((t) => t.collegeId === scope)
  const wrongCollege = found.filter((t) => t.collegeId !== scope)
  return { inScope, wrongCollege }
}
