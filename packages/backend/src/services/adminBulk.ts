// services/adminBulk.ts — batched bulk user import (N+1 fix for admin.ts:1121,1205).
// WHY: bulk teachers/students did 4 sequential Prisma round-trips per row
// (findUnique email + findFirst dept-by-name + findUnique dept-by-id + create)
// → 400 round-trips for 100 rows (p95 regression, Neon pool exhaustion).
// Batched: 3 pre-fetch queries (existing emails + depts by id + depts by name)
// + 1 createMany per type (4 round-trips total regardless of N).
// P1 shared-password (2026-09-14, SUPERSEDES per-row password contract):
// ONE sharedPassword per batch (admin-chosen, required on confirm, optional on
// dry-run). CSV `password` column DEPRECATED: server ignores if present (warn +
// ignore, not 400 this release), logs count only. ADMIN-SET validation is
// format-only (8-72 + common, HIBP SKIPPED — see validateAdminSharedPassword
// accepted-risk note; self-set register/change-password KEEP HIBP) + single
// bcrypt hash reused for all rows (perf). All created
// users get mustChangePassword=true (nudge-only, NO route block — see §10 addendum
// philosophy). FE displays its held field value as show-once (never re-transmitted).
// Validation semantics verbatim (per-row errors, dept-name resolution,
// incomingYear parse) + dry-run parity (Name required, year range).
// Result shape additive ({success,failed,errors} + mustChangePassword +
// nudgeEnabled (§10 nudge-only, no route block) +
// sharedPasswordEcho:false + passwordColumnIgnored). Injectable `db` +
// `breachCheck` for hermetic tests (DIP); logger on every catch (no silent {});
// never log password values (counts only).
// RELEASE COMMS (2026-09-14, P1 SUPERSEDE — copy into changelog, no behavior
// change beyond message clarity): "Bulk import confirm now REQUIRES sharedPassword
// (one password for the whole batch, 8-72 chars, not common; HIBP skipped on
// admin paths — see accepted-risk note). Old
// automation that confirmed without sharedPassword will now get 400
// { error: 'Shared password is required...' } (zero writes) instead of a silent
// 200. Fix: send { sharedPassword } on confirm, or dry-run first for the hint.
// CSV `password` column stays warn-ignored (not 400) this release."

import bcrypt from 'bcryptjs'
import prisma from '../config/db'
import { logger } from '../utils/logger'
import type { BreachCheck as SharedBreachCheck } from '../utils/sharedPassword'

export interface BulkRow {
  email?: unknown
  name?: unknown
  /** @deprecated P1 shared-password: ignored if present (warn + ignore). Use sharedPassword opt. */
  password?: unknown
  departmentId?: unknown
  department?: unknown
  empNumber?: unknown
  studentId?: unknown
  incomingYear?: unknown
}

export interface BulkResult {
  success: number
  failed: number
  errors: string[]
  /**
   * @deprecated P1 shared-password: per-row show-once REMOVED. FE holds the shared
   * value it sent and displays it as show-once (avoids re-transmitting secret).
   * Kept optional for backward-compat with old callers/tests (always absent on new path).
   */
  tempPasswords?: Array<{ email: string; tempPassword: string }>
  /** P1: always false on wire (never echo secrets). */
  sharedPasswordEcho?: false
  /** P1: true when all created rows got mustChangePassword=true. */
  mustChangePassword?: boolean
  /**
   * P1 §10 nudge-only (no route block): true when the batch should show the
   * dismissible shared-password banner (FE localStorage `nudgeDismissed:<userId>`,
   * no login redirect/block). Additive — old callers ignore it. Always true on
   * success (banner ORs mustChangePassword/passwordNudge).
   */
  nudgeEnabled?: boolean
  /** P1: true when legacy CSV password column was stripped. */
  passwordColumnIgnored?: boolean
  warnings?: string[]
  /**
   * P1 route helper (additive): true when the batch failed SOLELY on shared-password
   * validation (missing/invalid/hash-fail; HIBP skipped on admin paths) with
   * zero writes. Routes map this to 400 with a clear message (old API callers
   * without sharedPassword get a 400, not a 200 with failed counts). Never
   * true when any row was written.
   */
  sharedPasswordInvalid?: boolean
}

/** Injectable breach check (DEPRECATED on admin paths — HIBP skipped, kept for backward-compat callers; ignored). */
export type BreachCheck = SharedBreachCheck
export interface BulkOptions {
  /** @deprecated HIBP skipped on admin bulk paths (see accepted-risk note); ignored if passed. */
  breachCheck?: BreachCheck
  /** P1 shared password for the whole batch (required on confirm, optional on dry-run). */
  sharedPassword?: string
}

type Db = typeof prisma

function rowEmail(r: BulkRow): string {
  return String((r.email as string) || '').trim()
}

async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12)
}

/** Resolve departmentId for a row (name → id), collecting errors. Returns id or undefined. */
function resolveDeptId(
  row: BulkRow,
  collegeId: string,
  deptById: Map<string, { id: string; collegeId: string }>,
  deptByName: Map<string, { id: string }>,
  errors: string[],
  onFailed: () => void,
): string | undefined {
  const email = rowEmail(row)
  const mutable = row as Record<string, unknown>
  if (!mutable.departmentId && mutable.department) {
    const key = String(mutable.department).trim().toLowerCase()
    const byName = deptByName.get(key)
    if (!byName) {
      onFailed()
      errors.push(`${email}: Unknown department '${String(mutable.department).trim()}'`)
      return undefined
    }
    mutable.departmentId = byName.id
  }
  if (mutable.departmentId) {
    const id = String(mutable.departmentId)
    const dept = deptById.get(id)
    if (!dept || dept.collegeId !== collegeId) {
      onFailed()
      errors.push(`${email}: Invalid department`)
      return undefined
    }
    return id
  }
  return undefined
}

export interface BulkRowReport {
  index: number
  email: string
  name: string
  valid: boolean
  errors: string[]
}

export interface BulkDryRunResult {
  total: number
  validCount: number
  invalidCount: number
  rows: BulkRowReport[]
  errors: string[]
  /** P1: shared-password validation (ADMIN-SET format-only, HIBP skipped). Absent on dry-run → valid:false hint. */
  sharedPassword: { valid: boolean; errors: string[] }
  passwordColumnIgnored?: boolean
  warnings?: string[]
}

const DRY_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function prefetchBulkContext(
  collegeId: string,
  rows: BulkRow[],
  db: Db,
): Promise<{ existing: Set<string>; deptById: Map<string, { id: string; collegeId: string }>; deptByName: Map<string, { id: string }> }> {
  const emails = [...new Set(rows.map(rowEmail).filter(Boolean))]
  let existing = new Set<string>()
  try {
    const found = await (db as Db).user.findMany({
      where: { email: { in: emails } },
      select: { email: true },
    })
    existing = new Set(found.map((u) => String(u.email).trim().toLowerCase()))
  } catch (err) {
    logger.warn({ err: (err as Error)?.message || err }, '[adminBulk] dry-run existing-email prefetch failed')
  }
  const deptIds = [...new Set(rows.map((r) => String((r as Record<string, unknown>).departmentId || '')).filter(Boolean))]
  const deptById = new Map<string, { id: string; collegeId: string }>()
  const deptByName = new Map<string, { id: string }>()
  try {
    const [byId, allCollege] = await Promise.all([
      deptIds.length
        ? (db as Db).department.findMany({ where: { id: { in: deptIds } }, select: { id: true, collegeId: true } })
        : Promise.resolve([] as Array<{ id: string; collegeId: string }>),
      (db as Db).department.findMany({ where: { collegeId } }),
    ])
    for (const d of byId) deptById.set(d.id, d)
    for (const d of allCollege as Array<{ id: string; collegeId: string; name: string }>) {
      if (!deptById.has(d.id)) deptById.set(d.id, d)
      const key = String(d.name || '').trim().toLowerCase()
      if (key && !deptByName.has(key)) deptByName.set(key, d)
    }
  } catch (err) {
    logger.warn({ err: (err as Error)?.message || err }, '[adminBulk] dry-run department prefetch failed')
  }
  return { existing, deptById, deptByName }
}

function dryRunOneRow(
  row: BulkRow,
  index: number,
  collegeId: string,
  ctx: { existing: Set<string>; deptById: Map<string, { id: string; collegeId: string }>; deptByName: Map<string, { id: string }>; seen: Set<string> },
  type: 'teacher' | 'student',
): BulkRowReport {
  const errors: string[] = []
  const email = rowEmail(row)
  const name = String((row as Record<string, unknown>).name ?? '').trim()
  if (!email) errors.push('Email is required')
  else if (!DRY_EMAIL_RE.test(email)) errors.push('Invalid email format')
  if (!name) errors.push('Name is required')
  const key = email.toLowerCase()
  if (email) {
    if (ctx.seen.has(key)) errors.push('Duplicate email in upload')
    else ctx.seen.add(key)
    if (ctx.existing.has(key)) errors.push('Email already exists')
  }
  const mutable = row as Record<string, unknown>
  let deptId: string | undefined
  if (!mutable.departmentId && mutable.department) {
    const byName = ctx.deptByName.get(String(mutable.department).trim().toLowerCase())
    if (!byName) errors.push(`Unknown department '${String(mutable.department).trim()}'`)
    else deptId = byName.id
  } else if (mutable.departmentId) {
    const dept = ctx.deptById.get(String(mutable.departmentId))
    if (!dept || dept.collegeId !== collegeId) errors.push('Invalid department')
    else deptId = String(mutable.departmentId)
  }
  void deptId
  // P1: row.password ignored (deprecated). No per-row password validation —
  // sharedPassword is validated once per batch (format-only, HIBP skipped).
  if (type === 'student') {
    const raw = mutable.incomingYear
    if (raw != null && String(raw).trim() !== '') {
      const y = parseInt(String(raw), 10)
      const nowY = new Date().getFullYear()
      if (isNaN(y) || y < 1990 || y > nowY + 6) errors.push('Invalid incomingYear value')
    }
  }
  return { index, email, name, valid: errors.length === 0, errors }
}

/** P1: validate sharedPassword once per batch (format-only, HIBP SKIPPED on admin paths — see validateAdminSharedPassword accepted-risk note). Absent → valid:false hint (dry-run rows-only). */
async function checkSharedForDryRun(
  sharedPassword: unknown,
  _breachCheck?: BreachCheck | undefined,
): Promise<{ valid: boolean; errors: string[] }> {
  void _breachCheck
  if (sharedPassword == null || String(sharedPassword) === '') {
    return { valid: false, errors: ['Shared password required on confirm'] }
  }
  const { validateAdminSharedPassword } = await import('../utils/sharedPassword.js').catch(() => ({ validateAdminSharedPassword: null as any }))
  if (typeof validateAdminSharedPassword === 'function') {
    return validateAdminSharedPassword(sharedPassword)
  }
  // Fallback (should never hit): format-only.
  const { validateSharedPasswordFormat } = await import('../utils/sharedPassword.js').catch(() => ({ validateSharedPasswordFormat: () => [] as string[] }))
  const errs = (validateSharedPasswordFormat as any)(sharedPassword) as string[]
  return { valid: errs.length === 0, errors: errs }
}

function toDryRunResult(
  reports: BulkRowReport[],
  sharedPassword: { valid: boolean; errors: string[] },
  passwordColumnIgnored?: boolean,
): BulkDryRunResult {
  const errors = reports.flatMap((r) => r.errors.map((e) => `${r.email || `(row ${r.index + 1})`}: ${e}`))
  const warnings: string[] = []
  if (passwordColumnIgnored) warnings.push('password column ignored — use shared password field')
  return {
    total: reports.length,
    validCount: reports.filter((r) => r.valid).length,
    invalidCount: reports.filter((r) => !r.valid).length,
    rows: reports,
    errors,
    sharedPassword,
    ...(passwordColumnIgnored ? { passwordColumnIgnored: true as const } : {}),
    ...(warnings.length ? { warnings } : {}),
  }
}

/**
 * Dry-run validation (no writes, no password hashing): per-row report for the
 * Admin bulk-import modal. Reads only (existing emails + departments) plus
 * format-only sharedPassword check (HIBP skipped on admin paths).
 */
export async function dryRunBulkTeachers(
  collegeId: string,
  rows: BulkRow[],
  db: Db = prisma,
  opts: BulkOptions = {},
): Promise<BulkDryRunResult> {
  const list = Array.isArray(rows) ? rows : []
  const passwordColumnIgnored = list.some((r) => r != null && Object.prototype.hasOwnProperty.call(r, 'password'))
  const ctx = { ...(await prefetchBulkContext(collegeId, list, db)), seen: new Set<string>() }
  const reports = list.map((r, i) => dryRunOneRow(r, i, collegeId, ctx, 'teacher'))
  const shared = await checkSharedForDryRun(opts.sharedPassword, opts.breachCheck)
  return toDryRunResult(reports, shared, passwordColumnIgnored)
}

/** Dry-run validation for students (no writes, no password hashing). */
export async function dryRunBulkStudents(
  collegeId: string,
  rows: BulkRow[],
  db: Db = prisma,
  opts: BulkOptions = {},
): Promise<BulkDryRunResult> {
  const list = Array.isArray(rows) ? rows : []
  const passwordColumnIgnored = list.some((r) => r != null && Object.prototype.hasOwnProperty.call(r, 'password'))
  const ctx = { ...(await prefetchBulkContext(collegeId, list, db)), seen: new Set<string>() }
  const reports = list.map((r, i) => dryRunOneRow(r, i, collegeId, ctx, 'student'))
  const shared = await checkSharedForDryRun(opts.sharedPassword, opts.breachCheck)
  return toDryRunResult(reports, shared, passwordColumnIgnored)
}

export async function bulkCreateTeachers(
  collegeId: string,
  teachers: BulkRow[],
  db: Db = prisma,
  opts: BulkOptions = {},
): Promise<BulkResult> {
  const errors: string[] = []
  const warnings: string[] = []
  let success = 0
  let failed = 0
  const onFailed = () => {
    failed++
  }
  const rows = Array.isArray(teachers) ? teachers : []
  if (rows.length === 0) return { success: 0, failed: 0, errors }
  const passwordColumnIgnored = rows.some((r) => r != null && Object.prototype.hasOwnProperty.call(r, 'password'))
  if (passwordColumnIgnored) warnings.push('password column ignored — use shared password field')
  // P1: sharedPassword REQUIRED on confirm (route 400s first; service guards with zero writes).
  // Clear 400 for old callers without sharedPassword (intentional supersede — see
  // header RELEASE COMMS; no behavior change beyond message clarity).
  if (opts.sharedPassword == null || String(opts.sharedPassword) === '') {
    return {
      success: 0,
      failed: rows.length,
      errors: ['Shared password is required. Set one password for all rows in this import. Provide sharedPassword (8-72 chars) on confirm — old callers without it get 400 (P1 shared-password required, see release notes).'],
      sharedPasswordEcho: false,
      sharedPasswordInvalid: true,
      ...(passwordColumnIgnored ? { passwordColumnIgnored: true as const } : {}),
      ...(warnings.length ? { warnings } : {}),
    }
  }
  // ADMIN-SET shared validation (2026-09-14): format-only (8-72 + common),
  // HIBP SKIPPED — see validateAdminSharedPassword accepted-risk note.
  // opts.breachCheck is ignored (kept for backward-compat callers).
  const { validateAdminSharedPassword } = await import('../utils/sharedPassword.js').catch(() => ({ validateAdminSharedPassword: null as any }))
  if (typeof validateAdminSharedPassword === 'function') {
    const check = await (validateAdminSharedPassword as any)(opts.sharedPassword)
    if (!check.valid) {
      return {
        success: 0,
        failed: rows.length,
        errors: [...check.errors],
        sharedPasswordEcho: false,
        sharedPasswordInvalid: true,
        ...(passwordColumnIgnored ? { passwordColumnIgnored: true as const } : {}),
        ...(warnings.length ? { warnings } : {}),
      }
    }
  }
  // Single bcrypt hash reused for all rows (perf: bcrypt 12 ~200ms; N hashes would stall).
  let sharedHash: string
  try {
    sharedHash = await hashPassword(String(opts.sharedPassword))
  } catch (err) {
    logger.warn({ err: (err as Error)?.message || err }, '[adminBulk] shared password hash failed (teachers)')
    return {
      success: 0,
      failed: rows.length,
      errors: ['Failed to hash shared password'],
      sharedPasswordEcho: false,
      sharedPasswordInvalid: true,
      ...(passwordColumnIgnored ? { passwordColumnIgnored: true as const } : {}),
    }
  }

  const emails = [...new Set(rows.map(rowEmail).filter(Boolean))]
  let existing = new Set<string>()
  try {
    const found = await (db as Db).user.findMany({
      where: { email: { in: emails } },
      select: { email: true },
    })
    existing = new Set(found.map((u) => String(u.email).trim().toLowerCase()))
  } catch (err) {
    logger.warn({ err: (err as Error)?.message || err }, '[adminBulk] existing-email prefetch failed (teachers)')
  }

  const deptIds = [...new Set(rows.map((r) => String((r as Record<string, unknown>).departmentId || '')).filter(Boolean))]
  const deptNames = [...new Set(rows.map((r) => String((r as Record<string, unknown>).department || '').trim().toLowerCase()).filter(Boolean))]
  const deptById = new Map<string, { id: string; collegeId: string }>()
  const deptByName = new Map<string, { id: string }>()
  try {
    // Batched: fetch requested ids + ALL college depts (name resolution happens
    // in-memory after prefetch, so resolved ids are already present — the
    // prefetch-before-resolve ordering bug that broke the first batched cut).
    const [byId, allCollege] = await Promise.all([
      deptIds.length
        ? (db as Db).department.findMany({ where: { id: { in: deptIds } }, select: { id: true, collegeId: true } })
        : Promise.resolve([] as Array<{ id: string; collegeId: string }>),
      (db as Db).department.findMany({ where: { collegeId } }),
    ])
    for (const d of byId) deptById.set(d.id, d)
    for (const d of allCollege as Array<{ id: string; collegeId: string; name: string }>) {
      if (!deptById.has(d.id)) deptById.set(d.id, d)
      const key = String(d.name || '').trim().toLowerCase()
      if (key && !deptByName.has(key)) deptByName.set(key, d)
    }
  } catch (err) {
    logger.warn({ err: (err as Error)?.message || err }, '[adminBulk] department prefetch failed (teachers)')
  }

  const seenInBatch = new Set<string>()
  const valid: Array<{ email: string; name: string; passwordHash: string; departmentId?: string; empNumber?: string }> = []
  for (const t of rows) {
    const email = rowEmail(t)
    if (!email) {
      onFailed()
      errors.push(`(missing email): Email is required`)
      continue
    }
    const key = email.toLowerCase()
    if (seenInBatch.has(key)) {
      onFailed()
      errors.push(`${email}: Duplicate email in upload`)
      continue
    }
    seenInBatch.add(key)
    if (existing.has(key)) {
      onFailed()
      errors.push(`${email}: Email already exists`)
      continue
    }
    // Dry-run parity: Name is required (was missing → empty-name users created).
    const tName = String((t as Record<string, unknown>).name ?? '').trim()
    if (!tName) {
      onFailed()
      errors.push(`${email}: Name is required`)
      continue
    }
    // Teacher parity with students dry-run (same before/after guard — dept
    // errors fail the row, missing dept stays optional).
    const beforeDept = errors.length
    const deptId = resolveDeptId(t, collegeId, deptById, deptByName, errors, onFailed)
    if (errors.length > beforeDept) continue
    // P1: row.password ignored (deprecated). Trim empNumber (teacher parity).
    const empRaw = (t as Record<string, unknown>).empNumber
    const empNumber = empRaw != null && String(empRaw).trim() !== '' ? String(empRaw).trim() : undefined
    valid.push({
      email,
      name: tName,
      passwordHash: sharedHash,
      departmentId: deptId,
      empNumber,
    })
  }

  if (valid.length > 0) {
    // P1: mustChangePassword=true for all batch rows (nudge-only, NO route block —
    // see §10 addendum philosophy). Response also carries nudgeEnabled:true so FE
    // shows the dismissible banner (localStorage, no forced redirect).
    // Pre-migration safe: try with flag, fallback without on P2022 (unknown column).
    const baseData = valid.map((v) => ({
      email: v.email,
      name: v.name,
      passwordHash: v.passwordHash,
      role: 'TEACHER',
      collegeId,
      departmentId: v.departmentId || undefined,
      empNumber: v.empNumber,
    }))
    try {
      let res: { count: number }
      try {
        res = await (db as Db).user.createMany({
          data: baseData.map((d) => ({ ...d, mustChangePassword: true })) as any,
          skipDuplicates: true,
        })
      } catch (err: any) {
        if (err?.code === 'P2022' || /mustChangePassword/i.test(String(err?.message || ''))) {
          logger.warn('[adminBulk] mustChangePassword column missing (pre-migration) — creating without flag')
          res = await (db as Db).user.createMany({ data: baseData as any, skipDuplicates: true })
        } else throw err
      }
      success = res.count
      const skipped = valid.length - res.count
      for (let i = 0; i < skipped; i++) {
        onFailed()
      }
      if (skipped > 0) errors.push(`${skipped} row(s) skipped as duplicates`)
      // Order 12 CTI dual-write (best-effort, pre-migration safe): mirror
      // empNumber twins into StaffProfile rows for the just-created teachers.
      try {
        const emails = valid.map((v) => v.email)
        const created = await (db as Db).user.findMany({ where: { email: { in: emails }, collegeId }, select: { id: true, empNumber: true } }).catch(() => [])
        const rows = (created as Array<{ id: string; empNumber: string | null }>)
          .filter((u) => u?.id)
          .map((u) => ({ userId: u.id, empNumber: u.empNumber ?? undefined }))
        if (rows.length > 0) {
          await (db as any)?.staffProfile?.createMany?.({ data: rows, skipDuplicates: true }).catch(() => null)
        }
      } catch (err) {
        logger.warn({ err: (err as Error)?.message || err }, '[adminBulk] staff profile dual-write skipped')
      }
    } catch (err) {
      logger.warn({ err: (err as Error)?.message || err }, '[adminBulk] teachers createMany failed')
      // Fallback parity: report all valid as failed (original would fail per-row).
      for (const v of valid) {
        onFailed()
        errors.push(`${v.email}: ${(err as Error)?.message || 'insert failed'}`)
      }
    }
  }
  return {
    success,
    failed,
    errors,
    sharedPasswordEcho: false as const,
    mustChangePassword: true,
    nudgeEnabled: true as const,
    ...(passwordColumnIgnored ? { passwordColumnIgnored: true as const } : {}),
    ...(warnings.length ? { warnings } : {}),
  }
}

export async function bulkCreateStudents(
  collegeId: string,
  students: BulkRow[],
  db: Db = prisma,
  opts: BulkOptions = {},
): Promise<BulkResult> {
  const errors: string[] = []
  const warnings: string[] = []
  let success = 0
  let failed = 0
  const onFailed = () => {
    failed++
  }
  const rows = Array.isArray(students) ? students : []
  if (rows.length === 0) return { success: 0, failed: 0, errors }
  const passwordColumnIgnored = rows.some((r) => r != null && Object.prototype.hasOwnProperty.call(r, 'password'))
  if (passwordColumnIgnored) warnings.push('password column ignored — use shared password field')
  // Same clear 400 as teachers above (old callers without sharedPassword — see header).
  if (opts.sharedPassword == null || String(opts.sharedPassword) === '') {
    return {
      success: 0,
      failed: rows.length,
      errors: ['Shared password is required. Set one password for all rows in this import. Provide sharedPassword (8-72 chars) on confirm — old callers without it get 400 (P1 shared-password required, see release notes).'],
      sharedPasswordEcho: false,
      sharedPasswordInvalid: true,
      ...(passwordColumnIgnored ? { passwordColumnIgnored: true as const } : {}),
      ...(warnings.length ? { warnings } : {}),
    }
  }
  // ADMIN-SET shared validation (2026-09-14): format-only, HIBP SKIPPED.
  const { validateAdminSharedPassword: validateAdminStudents } = await import('../utils/sharedPassword.js').catch(() => ({ validateAdminSharedPassword: null as any }))
  if (typeof validateAdminStudents === 'function') {
    const check = await (validateAdminStudents as any)(opts.sharedPassword)
    if (!check.valid) {
      return {
        success: 0,
        failed: rows.length,
        errors: [...check.errors],
        sharedPasswordEcho: false,
        sharedPasswordInvalid: true,
        ...(passwordColumnIgnored ? { passwordColumnIgnored: true as const } : {}),
        ...(warnings.length ? { warnings } : {}),
      }
    }
  }
  let sharedHash: string
  try {
    sharedHash = await hashPassword(String(opts.sharedPassword))
  } catch (err) {
    logger.warn({ err: (err as Error)?.message || err }, '[adminBulk] shared password hash failed (students)')
    return {
      success: 0,
      failed: rows.length,
      errors: ['Failed to hash shared password'],
      sharedPasswordEcho: false,
      sharedPasswordInvalid: true,
      ...(passwordColumnIgnored ? { passwordColumnIgnored: true as const } : {}),
    }
  }

  const emails = [...new Set(rows.map(rowEmail).filter(Boolean))]
  let existing = new Set<string>()
  try {
    const found = await (db as Db).user.findMany({
      where: { email: { in: emails } },
      select: { email: true },
    })
    existing = new Set(found.map((u) => String(u.email).trim().toLowerCase()))
  } catch (err) {
    logger.warn({ err: (err as Error)?.message || err }, '[adminBulk] existing-email prefetch failed (students)')
  }

  const deptIds = [...new Set(rows.map((r) => String((r as Record<string, unknown>).departmentId || '')).filter(Boolean))]
  const deptNames = [...new Set(rows.map((r) => String((r as Record<string, unknown>).department || '').trim().toLowerCase()).filter(Boolean))]
  const deptById = new Map<string, { id: string; collegeId: string }>()
  const deptByName = new Map<string, { id: string }>()
  try {
    const [byId, allCollege] = await Promise.all([
      deptIds.length
        ? (db as Db).department.findMany({ where: { id: { in: deptIds } }, select: { id: true, collegeId: true } })
        : Promise.resolve([] as Array<{ id: string; collegeId: string }>),
      (db as Db).department.findMany({ where: { collegeId } }),
    ])
    for (const d of byId) deptById.set(d.id, d)
    for (const d of allCollege as Array<{ id: string; collegeId: string; name: string }>) {
      if (!deptById.has(d.id)) deptById.set(d.id, d)
      const key = String(d.name || '').trim().toLowerCase()
      if (key && !deptByName.has(key)) deptByName.set(key, d)
    }
  } catch (err) {
    logger.warn({ err: (err as Error)?.message || err }, '[adminBulk] department prefetch failed (students)')
  }

  const seenInBatch = new Set<string>()
  const valid: Array<{
    email: string
    name: string
    passwordHash: string
    departmentId?: string
    studentId?: string
    incomingYear?: number
    outgoingYear?: number
  }> = []
  for (const s of rows) {
    const email = rowEmail(s)
    if (!email) {
      onFailed()
      errors.push(`(missing email): Email is required`)
      continue
    }
    const key = email.toLowerCase()
    if (seenInBatch.has(key)) {
      onFailed()
      errors.push(`${email}: Duplicate email in upload`)
      continue
    }
    seenInBatch.add(key)
    if (existing.has(key)) {
      onFailed()
      errors.push(`${email}: Email already exists`)
      continue
    }
    // Dry-run parity: Name is required (was missing → empty-name users created).
    const sName = String((s as Record<string, unknown>).name ?? '').trim()
    if (!sName) {
      onFailed()
      errors.push(`${email}: Name is required`)
      continue
    }
    const before = errors.length
    const deptId = resolveDeptId(s, collegeId, deptById, deptByName, errors, onFailed)
    if (errors.length > before) continue
    // Dry-run parity: incomingYear range 1990..now+6 (was isNaN-only → 1800 accepted).
    const incomingRaw = (s as Record<string, unknown>).incomingYear
    const incoming = incomingRaw != null && String(incomingRaw).trim() !== '' ? parseInt(String(incomingRaw), 10) : undefined
    if (incoming !== undefined) {
      const nowY = new Date().getFullYear()
      if (isNaN(incoming) || incoming < 1990 || incoming > nowY + 6) {
        onFailed()
        errors.push(`${email}: Invalid incomingYear value`)
        continue
      }
    }
    // P1: row.password ignored. Trim studentId (parity with empNumber trim).
    const sidRaw = (s as Record<string, unknown>).studentId
    const studentId = sidRaw != null && String(sidRaw).trim() !== '' ? String(sidRaw).trim() : undefined
    valid.push({
      email,
      name: sName,
      passwordHash: sharedHash,
      departmentId: deptId,
      studentId,
      incomingYear: incoming,
      outgoingYear: incoming ? incoming + 4 : undefined,
    })
  }

  if (valid.length > 0) {
    // P1: mustChangePassword=true (nudge-only, NO route block — §10 philosophy).
    // Response also carries nudgeEnabled:true (dismissible banner, localStorage).
    // Pre-migration fallback on P2022.
    const baseData = valid.map((v) => ({
      email: v.email,
      name: v.name,
      passwordHash: v.passwordHash,
      role: 'STUDENT',
      collegeId,
      departmentId: v.departmentId || undefined,
      studentId: v.studentId,
      incomingYear: v.incomingYear,
      outgoingYear: v.outgoingYear,
    }))
    try {
      let res: { count: number }
      try {
        res = await (db as Db).user.createMany({
          data: baseData.map((d) => ({ ...d, mustChangePassword: true })) as any,
          skipDuplicates: true,
        })
      } catch (err: any) {
        if (err?.code === 'P2022' || /mustChangePassword/i.test(String(err?.message || ''))) {
          logger.warn('[adminBulk] mustChangePassword column missing (pre-migration) — creating without flag')
          res = await (db as Db).user.createMany({ data: baseData as any, skipDuplicates: true })
        } else throw err
      }
      success = res.count
      const skipped = valid.length - res.count
      for (let i = 0; i < skipped; i++) onFailed()
      if (skipped > 0) errors.push(`${skipped} row(s) skipped as duplicates`)
      // Order 12 CTI dual-write (best-effort, pre-migration safe): mirror
      // student twins into StudentProfile rows for the just-created students.
      try {
        const emails = valid.map((v) => v.email)
        const created = await (db as Db).user.findMany({ where: { email: { in: emails }, collegeId }, select: { id: true, studentId: true, incomingYear: true, outgoingYear: true } }).catch(() => [])
        const rows = (created as Array<{ id: string; studentId: string | null; incomingYear: number | null; outgoingYear: number | null }>)
          .filter((u) => u?.id)
          .map((u) => ({ userId: u.id, studentId: u.studentId ?? undefined, incomingYear: u.incomingYear ?? undefined, outgoingYear: u.outgoingYear ?? undefined }))
        if (rows.length > 0) {
          await (db as any)?.studentProfile?.createMany?.({ data: rows, skipDuplicates: true }).catch(() => null)
        }
      } catch (err) {
        logger.warn({ err: (err as Error)?.message || err }, '[adminBulk] student profile dual-write skipped')
      }
    } catch (err) {
      logger.warn({ err: (err as Error)?.message || err }, '[adminBulk] students createMany failed')
      for (const v of valid) {
        onFailed()
        errors.push(`${v.email}: ${(err as Error)?.message || 'insert failed'}`)
      }
    }
  }
  return {
    success,
    failed,
    errors,
    sharedPasswordEcho: false as const,
    mustChangePassword: true,
    nudgeEnabled: true as const,
    ...(passwordColumnIgnored ? { passwordColumnIgnored: true as const } : {}),
    ...(warnings.length ? { warnings } : {}),
  }
}
