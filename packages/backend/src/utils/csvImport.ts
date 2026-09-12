// utils/csvImport.ts — #11 pure CSV parsing + local row validation for bulk import.
// WHY: bulk import needs a dry-run report (errors per row) before any DB
// write. CSV parsing + format checks are pure (no DB) so they are hermetic
// Small tests (<100ms); DB checks (duplicate email, dept resolution) stay in
// services/adminBulk.ts dry-run paths. Header aliases are case-insensitive:
// name/email/dept|department|departmentId/year|incomingYear/studentId|empNumber/password.
// Formula-injection guard: values starting with = + - @ are left as-is here
// (storage is DB text, never Excel) — escapeExcelValue applies on export only.

import type { BulkRow } from '../services/adminBulk'

export const MAX_CSV_ROWS = 1000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const ALIASES: Record<string, string> = {
  name: 'name',
  fullname: 'name',
  'full name': 'name',
  email: 'email',
  'email address': 'email',
  dept: 'department',
  department: 'department',
  departmentname: 'department',
  'department name': 'department',
  departmentid: 'departmentId',
  'department id': 'departmentId',
  year: 'incomingYear',
  incomingyear: 'incomingYear',
  'incoming year': 'incomingYear',
  studentid: 'studentId',
  'student id': 'studentId',
  rollnumber: 'studentId',
  'roll number': 'studentId',
  empnumber: 'empNumber',
  'emp number': 'empNumber',
  password: 'password',
}

/** Split one CSV line honoring double-quoted commas + escaped quotes. */
function splitLine(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      cells.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur)
  return cells.map((c) => c.trim())
}

/** Parse CSV text → BulkRow[] using the header row. Throws on empty input. */
export function parseCsv(text: string): BulkRow[] {
  if (!text || !text.trim()) throw new Error('CSV is empty')
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length < 2) throw new Error('CSV needs a header row plus at least one data row')
  const headers = splitLine(lines[0]).map((h) => ALIASES[h.trim().toLowerCase()] ?? '')
  if (!headers.includes('email')) throw new Error("CSV header must include 'email'")
  if (!headers.includes('name')) throw new Error("CSV header must include 'name'")
  const rows: BulkRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i])
    const row: Record<string, string> = {}
    headers.forEach((key, idx) => {
      if (!key) return
      row[key] = (cells[idx] ?? '').trim()
    })
    rows.push(row as BulkRow)
    if (rows.length >= MAX_CSV_ROWS) break
  }
  return rows
}

export interface LocalRowIssue {
  index: number
  email: string
  errors: string[]
}

/**
 * Local format validation (no DB): email shape, name required, year numeric,
 * role-specific id presence is optional (backend fills nothing — just format).
 * Returns per-row issues; valid rows have empty errors.
 */
export function validateRowsLocal(rows: BulkRow[], type: 'teacher' | 'student'): LocalRowIssue[] {
  const seen = new Set<string>()
  return rows.map((row, idx) => {
    const errors: string[] = []
    const email = String((row as Record<string, unknown>).email ?? '').trim()
    const name = String((row as Record<string, unknown>).name ?? '').trim()
    if (!email) errors.push('Email is required')
    else if (!EMAIL_RE.test(email)) errors.push('Invalid email format')
    if (!name) errors.push('Name is required')
    const key = email.toLowerCase()
    if (email && seen.has(key)) errors.push('Duplicate email in upload')
    if (email) seen.add(key)
    const yearRaw = (row as Record<string, unknown>).incomingYear
    if (type === 'student' && yearRaw != null && String(yearRaw).trim() !== '') {
      const y = parseInt(String(yearRaw), 10)
      const nowY = new Date().getFullYear()
      if (isNaN(y) || y < 1990 || y > nowY + 6) errors.push('Invalid incomingYear value')
    }
    const pw = (row as Record<string, unknown>).password
    if (pw != null && String(pw) !== '' && (String(pw).length < 8 || String(pw).length > 72)) {
      errors.push('Password must be 8-72 characters')
    }
    return { index: idx, email, errors }
  })
}

/** CSV template for the Admin UI download (role-specific columns). */
export function csvTemplate(type: 'teacher' | 'student'): string {
  if (type === 'teacher') return 'name,email,department,password\n"Jane Sharma",jane@college.edu,"Computer Science",\n'
  return 'name,email,department,incomingYear,studentId\n"Aarav Kumar",aarav@college.edu,"Computer Science",2024,STU001\n'
}

export type BulkImportRole = 'STUDENT' | 'TEACHER'

/**
 * #11a unified import role resolution (pure, hermetic).
 * WHY split out: POST /admin/users/import accepts role via body.role/type or
 * ?role=/type= (case-insensitive, plural tolerated). Explicit-but-unknown
 * values return null so the route can 400 fail-fast (userFilters pattern).
 * With no explicit role, infer from payload shape (teachers-only →
 * TEACHER, students-only → STUDENT), else default STUDENT (backward compat
 * with student-heavy semester onboarding).
 */
export function resolveBulkImportRole(
  body: Record<string, unknown> | null | undefined,
  query: Record<string, unknown> | null | undefined,
): BulkImportRole | null {
  const raw = (body as any)?.role ?? (body as any)?.type ?? (query as any)?.role ?? (query as any)?.type
  if (raw != null && String(raw).trim() !== '') {
    const v = String(raw).trim().toUpperCase()
    if (v === 'STUDENT' || v === 'STUDENTS') return 'STUDENT'
    if (v === 'TEACHER' || v === 'TEACHERS') return 'TEACHER'
    return null
  }
  const hasTeachers = Array.isArray((body as any)?.teachers)
  const hasStudents = Array.isArray((body as any)?.students)
  if (hasTeachers && !hasStudents) return 'TEACHER'
  if (hasStudents && !hasTeachers) return 'STUDENT'
  return 'STUDENT'
}

/**
 * #11a unified row extraction for POST /admin/users/import (pure, hermetic).
 * Accepts JSON row arrays ({rows} generic, or role-specific {teachers} /
 * {students}) or raw CSV text ({csv} string — file content sent as JSON for
 * API clients; express.json has no text/csv parser). Unparseable {csv}
 * returns [] so the route can 400 with a friendly message. Never throws.
 */
export function extractImportRows(
  body: Record<string, unknown> | null | undefined,
  role: BulkImportRole,
): BulkRow[] {
  const b = (body ?? {}) as Record<string, unknown>
  const key = role === 'TEACHER' ? 'teachers' : 'students'
  const direct = (b as any)[key]
  if (Array.isArray(direct)) return direct as BulkRow[]
  if (Array.isArray((b as any).rows)) return (b as any).rows as BulkRow[]
  if (typeof (b as any).csv === 'string' && (b as any).csv.trim()) {
    try {
      return parseCsv((b as any).csv)
    } catch {
      return []
    }
  }
  return []
}
