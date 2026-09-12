// services/adminBulk.ts — batched bulk user import (N+1 fix for admin.ts:1121,1205).
// WHY: bulk teachers/students did 4 sequential Prisma round-trips per row
// (findUnique email + findFirst dept-by-name + findUnique dept-by-id + create)
// → 400 round-trips for 100 rows (p95 regression, Neon pool exhaustion).
// Batched: 3 pre-fetch queries (existing emails + depts by id + depts by name)
// + 1 createMany per type (4 round-trips total regardless of N).
// Validation semantics verbatim (per-row errors, dept-name resolution, password
// rules, incomingYear parse). Result shape identical ({success,failed,errors}).
// Injectable `db` for hermetic tests (DIP); logger on every catch (no silent {}).

import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import prisma from '../config/db'
import { logger } from '../utils/logger'
import { isCommonPassword } from '../utils/authHardening'

export interface BulkRow {
  email?: unknown
  name?: unknown
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
}

type Db = typeof prisma

function rowEmail(r: BulkRow): string {
  return String((r.email as string) || '').trim()
}

function tempPassword(): string {
  return crypto.randomBytes(9).toString('base64url').slice(0, 12) + 'A1!'
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

function checkPassword(row: BulkRow, errors: string[], onFailed: () => void): boolean {
  const email = rowEmail(row)
  const pw = row.password == null ? '' : String(row.password)
  if (pw) {
    if (isCommonPassword(pw)) {
      onFailed()
      errors.push(`${email}: Password is too common`)
      return false
    }
    if (pw.length < 8 || pw.length > 72) {
      onFailed()
      errors.push(`${email}: Password must be 8-72 characters`)
      return false
    }
  }
  return true
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
  const pw = mutable.password
  if (pw != null && String(pw) !== '') {
    const s = String(pw)
    if (s.length < 8 || s.length > 72) errors.push('Password must be 8-72 characters')
    else if (isCommonPassword(s)) errors.push('Password is too common')
  }
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

/**
 * Dry-run validation (no writes, no password hashing): per-row report for the
 * Admin bulk-import modal. Reads only (existing emails + departments).
 */
export async function dryRunBulkTeachers(
  collegeId: string,
  rows: BulkRow[],
  db: Db = prisma,
): Promise<BulkDryRunResult> {
  const list = Array.isArray(rows) ? rows : []
  const ctx = { ...(await prefetchBulkContext(collegeId, list, db)), seen: new Set<string>() }
  const reports = list.map((r, i) => dryRunOneRow(r, i, collegeId, ctx, 'teacher'))
  const errors = reports.flatMap((r) => r.errors.map((e) => `${r.email || `(row ${r.index + 1})`}: ${e}`))
  return {
    total: list.length,
    validCount: reports.filter((r) => r.valid).length,
    invalidCount: reports.filter((r) => !r.valid).length,
    rows: reports,
    errors,
  }
}

/** Dry-run validation for students (no writes, no password hashing). */
export async function dryRunBulkStudents(
  collegeId: string,
  rows: BulkRow[],
  db: Db = prisma,
): Promise<BulkDryRunResult> {
  const list = Array.isArray(rows) ? rows : []
  const ctx = { ...(await prefetchBulkContext(collegeId, list, db)), seen: new Set<string>() }
  const reports = list.map((r, i) => dryRunOneRow(r, i, collegeId, ctx, 'student'))
  const errors = reports.flatMap((r) => r.errors.map((e) => `${r.email || `(row ${r.index + 1})`}: ${e}`))
  return {
    total: list.length,
    validCount: reports.filter((r) => r.valid).length,
    invalidCount: reports.filter((r) => !r.valid).length,
    rows: reports,
    errors,
  }
}

export async function bulkCreateTeachers(
  collegeId: string,
  teachers: BulkRow[],
  db: Db = prisma,
): Promise<BulkResult> {
  const errors: string[] = []
  let success = 0
  let failed = 0
  const onFailed = () => {
    failed++
  }
  const rows = Array.isArray(teachers) ? teachers : []
  if (rows.length === 0) return { success: 0, failed: 0, errors }

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
    const deptId = resolveDeptId(t, collegeId, deptById, deptByName, errors, onFailed)
    if (deptId === undefined && errors.length > 0 && errors[errors.length - 1].startsWith(`${email}: Unknown department`) ) continue
    if (deptId === undefined && errors.length > 0 && errors[errors.length - 1] === `${email}: Invalid department`) continue
    if (!checkPassword(t, errors, onFailed)) continue
    const pw = t.password ? String(t.password) : tempPassword()
    try {
      const passwordHash = await hashPassword(t.password ? pw : pw)
      valid.push({
        email,
        name: String(t.name || ''),
        passwordHash,
        departmentId: deptId,
        empNumber: t.empNumber ? String(t.empNumber) : undefined,
      })
    } catch (err) {
      logger.warn({ err: (err as Error)?.message || err, email }, '[adminBulk] password hash failed (teachers)')
      onFailed()
      errors.push(`${email}: ${(err as Error)?.message || 'hash failed'}`)
    }
  }

  if (valid.length > 0) {
    try {
      const res = await (db as Db).user.createMany({
        data: valid.map((v) => ({
          email: v.email,
          name: v.name,
          passwordHash: v.passwordHash,
          role: 'TEACHER',
          collegeId,
          departmentId: v.departmentId || undefined,
          empNumber: v.empNumber,
        })),
        skipDuplicates: true,
      })
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
  return { success, failed, errors }
}

export async function bulkCreateStudents(
  collegeId: string,
  students: BulkRow[],
  db: Db = prisma,
): Promise<BulkResult> {
  const errors: string[] = []
  let success = 0
  let failed = 0
  const onFailed = () => {
    failed++
  }
  const rows = Array.isArray(students) ? students : []
  if (rows.length === 0) return { success: 0, failed: 0, errors }

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
    const before = errors.length
    const deptId = resolveDeptId(s, collegeId, deptById, deptByName, errors, onFailed)
    if (errors.length > before) continue
    if (!checkPassword(s, errors, onFailed)) continue
    const incomingRaw = (s as Record<string, unknown>).incomingYear
    const incoming = incomingRaw != null && String(incomingRaw) !== '' ? parseInt(String(incomingRaw), 10) : undefined
    if (incoming !== undefined && isNaN(incoming)) {
      onFailed()
      errors.push(`${email}: Invalid incomingYear value`)
      continue
    }
    const pw = s.password ? String(s.password) : tempPassword()
    try {
      const passwordHash = await hashPassword(pw)
      valid.push({
        email,
        name: String(s.name || ''),
        passwordHash,
        departmentId: deptId,
        studentId: s.studentId ? String(s.studentId) : undefined,
        incomingYear: incoming,
        outgoingYear: incoming ? incoming + 4 : undefined,
      })
    } catch (err) {
      logger.warn({ err: (err as Error)?.message || err, email }, '[adminBulk] password hash failed (students)')
      onFailed()
      errors.push(`${email}: ${(err as Error)?.message || 'hash failed'}`)
    }
  }

  if (valid.length > 0) {
    try {
      const res = await (db as Db).user.createMany({
        data: valid.map((v) => ({
          email: v.email,
          name: v.name,
          passwordHash: v.passwordHash,
          role: 'STUDENT',
          collegeId,
          departmentId: v.departmentId || undefined,
          studentId: v.studentId,
          incomingYear: v.incomingYear,
          outgoingYear: v.outgoingYear,
        })),
        skipDuplicates: true,
      })
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
  return { success, failed, errors }
}
