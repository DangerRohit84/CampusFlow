/**
 * Order 11 (V-15/V-16/V-31 → P6/P9): pure helpers for the record-vs-cache fix
 * (Grade rows + AttendanceRecord rows).
 *
 * Dual-write contract (expand phase of P5, same as Order 10):
 *  - Writers fill BOTH the legacy blob AND the record rows.
 *  - Readers prefer record rows, falling back to the blob when no record rows
 *    exist yet (pre-backfill / pre-migration deploys).
 *  - Blobs are NEVER dropped in this order (contract phase is later).
 *
 * No DB / no I/O here — fully unit-testable. Mirrors the SQL backfill
 * semantics in migration 20260924000000_order11_grade_attendance so app and
 * migration agree on canonical values (caps, trimming, gpa/status derivation).
 */

export const GRADE_MAX_SUBJECTS = 50
export const GRADE_MAX_NAME = 200
export const GRADE_MAX_CODE = 50
export const GRADE_MAX_CREDITS = 10
export const GRADE_CALCULATOR_SEMESTER = 0
export const GRADE_CALCULATOR_SOURCE = 'CALCULATOR'

export const ATT_MAX_SUBJECTS = 50
export const ATT_MAX_NAME = 200
export const ATT_MAX_COUNT = 10000
export const ATT_DEFAULT_REQUIRED = 75

export type ParsedGradeSubject = {
  name: string
  code: string
  credits: number
  grade: string
}

export type GradeRecordRow = {
  subject: string
  subjectCode: string | null
  credits: number
  grade: string
  gpa: number
  semester: number
  source: string
}

export type ParsedAttendanceSubject = {
  name: string
  held: number
  attended: number
}

export type AttendanceRecordRow = {
  subject: string
  present: number
  total: number
  status: 'PRESENT' | 'ABSENT' | 'EXCUSED' | 'LATE'
}

function clampStr(v: unknown, max: number): string {
  const s = String(v ?? '').trim()
  return s.length > max ? s.slice(0, max) : s
}

function clampCount(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(ATT_MAX_COUNT, Math.trunc(n)))
}

function clampCredits(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 3
  return Math.max(0, Math.min(GRADE_MAX_CREDITS, Math.trunc(n)))
}

function parseJsonLoose(raw: unknown): unknown {
  if (raw === null || raw === undefined) return undefined
  if (typeof raw !== 'string') return raw
  const t = raw.trim()
  if (!t) return undefined
  try {
    return JSON.parse(t)
  } catch {
    return undefined
  }
}

/**
 * Canonical 10-point gpa for a letter grade (matches migration §4.1 CASE).
 * Scale "10": O=10 A+=9 A=8 A-=7 B+=6 B=5 B-=4 C+=3 C=2 C-=1 D=1 P=5 F=0.
 * Scale "4": O/A+/A=4 A-=3.7 B+=3.3 B=3 B-=2.7 C+=2.3 C=2 C-=1.7 D=1 P=2 F=0.
 * Unknown/empty → 0. Never throws.
 */
export function gradeToGpa(grade: unknown, scale: unknown = '10'): number {
  try {
    const g = String(grade ?? '').trim().toUpperCase()
    if (String(scale ?? '10').trim() === '4') {
      switch (g) {
        case 'O':
        case 'A+':
        case 'A':
          return 4.0
        case 'A-':
          return 3.7
        case 'B+':
          return 3.3
        case 'B':
          return 3.0
        case 'B-':
          return 2.7
        case 'C+':
          return 2.3
        case 'C':
          return 2.0
        case 'C-':
          return 1.7
        case 'D':
          return 1.0
        case 'P':
          return 2.0
        case 'F':
          return 0.0
        default:
          return 0.0
      }
    }
    switch (g) {
      case 'O':
        return 10.0
      case 'A+':
        return 9.0
      case 'A':
        return 8.0
      case 'A-':
        return 7.0
      case 'B+':
        return 6.0
      case 'B':
        return 5.0
      case 'B-':
        return 4.0
      case 'C+':
        return 3.0
      case 'C':
        return 2.0
      case 'C-':
        return 1.0
      case 'D':
        return 1.0
      case 'P':
        return 5.0
      case 'F':
        return 0.0
      default:
        return 0.0
    }
  } catch {
    return 0.0
  }
}

/**
 * Normalize a GradeData.subjects blob (array | JSON string of
 * {name,code,credits,grade}) into canonical subjects. Never throws.
 * Mirrors the SQL backfill (empty names skipped, credits clamped, grade kept
 * raw for gpa derivation). Caps at GRADE_MAX_SUBJECTS.
 */
export function parseGradeSubjectsInput(raw: unknown): ParsedGradeSubject[] {
  try {
    const arr = parseJsonLoose(raw)
    if (!Array.isArray(arr)) return []
    const out: ParsedGradeSubject[] = []
    for (const item of arr) {
      if (out.length >= GRADE_MAX_SUBJECTS) break
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const rec = item as Record<string, unknown>
      const name = clampStr(rec.name ?? rec.subject ?? rec.title, GRADE_MAX_NAME)
      if (!name) continue
      const code = clampStr(rec.code ?? rec.subjectCode ?? '', GRADE_MAX_CODE)
      const credits = clampCredits(rec.credits ?? 3)
      const grade = clampStr(rec.grade ?? 'F', 10) || 'F'
      out.push({ name, code, credits, grade })
    }
    return out
  } catch {
    return []
  }
}

/** Build Grade calculator rows from canonical subjects (semester=0, source=CALCULATOR). */
export function buildGradeRows(
  subjects: ParsedGradeSubject[],
  scale: unknown = '10',
): GradeRecordRow[] {
  try {
    if (!Array.isArray(subjects)) return []
    return subjects.slice(0, GRADE_MAX_SUBJECTS).map((s) => ({
      subject: clampStr((s as any)?.name, GRADE_MAX_NAME),
      subjectCode: clampStr((s as any)?.code, GRADE_MAX_CODE) || null,
      credits: clampCredits((s as any)?.credits),
      grade: clampStr((s as any)?.grade, 10) || 'F',
      gpa: gradeToGpa((s as any)?.grade, scale),
      semester: GRADE_CALCULATOR_SEMESTER,
      source: GRADE_CALCULATOR_SOURCE,
    }))
  } catch {
    return []
  }
}

/**
 * Resolve calculator subjects for GET /data: record rows win when present,
 * otherwise parse the blob. Returns compat shape {name, code, credits, grade}.
 * Never throws.
 */
export function resolveGradeSubjects(source: {
  subjects?: unknown
  gradeRows?: Array<{
    subject?: unknown
    subjectCode?: unknown
    credits?: unknown
    grade?: unknown
  }> | null
}): ParsedGradeSubject[] {
  try {
    const rows = (source as any)?.gradeRows
    if (Array.isArray(rows) && rows.length > 0) {
      const out: ParsedGradeSubject[] = []
      for (const r of rows) {
        const name = clampStr((r as any)?.subject, GRADE_MAX_NAME)
        if (!name) continue
        out.push({
          name,
          code: clampStr((r as any)?.subjectCode, GRADE_MAX_CODE),
          credits: clampCredits((r as any)?.credits),
          grade: clampStr((r as any)?.grade, 10) || 'F',
        })
        if (out.length >= GRADE_MAX_SUBJECTS) break
      }
      if (out.length > 0) return out
    }
    return parseGradeSubjectsInput((source as any)?.subjects)
  } catch {
    return []
  }
}

/** True when the student has queryable Grade record rows (read-new path active). */
export function hasGradeRows(source: {
  gradeRows?: Array<unknown> | null
}): boolean {
  return Array.isArray((source as any)?.gradeRows) && (source as any).gradeRows.length > 0
}

/**
 * Normalize an AttendanceData.subjects blob (array | JSON string of
 * {name,held,attended}) into canonical subjects. Never throws. Mirrors the
 * SQL backfill (empty names skipped, counts clamped 0..ATT_MAX_COUNT).
 */
export function parseAttendanceSubjectsInput(raw: unknown): ParsedAttendanceSubject[] {
  try {
    const arr = parseJsonLoose(raw)
    if (!Array.isArray(arr)) return []
    const out: ParsedAttendanceSubject[] = []
    for (const item of arr) {
      if (out.length >= ATT_MAX_SUBJECTS) break
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const rec = item as Record<string, unknown>
      const name = clampStr(rec.name ?? rec.subject ?? rec.title, ATT_MAX_NAME)
      if (!name) continue
      out.push({ name, held: clampCount(rec.held ?? rec.total), attended: clampCount(rec.attended ?? rec.present) })
    }
    return out
  } catch {
    return []
  }
}

/** Percentage for one subject (100 when total=0 so empty subjects never flag low). */
export function attendancePct(present: unknown, total: unknown): number {
  try {
    const p = clampCount(present)
    const t = clampCount(total)
    if (t <= 0) return 100
    return Math.round((p / t) * 10000) / 100
  } catch {
    return 100
  }
}

/** True when pct < requiredPct with total > 0 (empty subjects never low). */
export function isBelowThreshold(present: unknown, total: unknown, requiredPct: unknown = ATT_DEFAULT_REQUIRED): boolean {
  try {
    const t = clampCount(total)
    if (t <= 0) return false
    const req = Number(requiredPct)
    const threshold = Number.isFinite(req) ? req : ATT_DEFAULT_REQUIRED
    return attendancePct(present, total) < threshold
  } catch {
    return false
  }
}

/** Derive record status from counters vs threshold (matches migration §4.2). */
export function deriveAttendanceStatus(
  present: unknown,
  total: unknown,
  requiredPct: unknown = ATT_DEFAULT_REQUIRED,
): 'PRESENT' | 'ABSENT' {
  try {
    const t = clampCount(total)
    if (t <= 0) return 'PRESENT'
    return isBelowThreshold(present, total, requiredPct) ? 'ABSENT' : 'PRESENT'
  } catch {
    return 'PRESENT'
  }
}

/** Build AttendanceRecord rows from canonical subjects (one per subject). */
export function buildAttendanceRecordRows(
  subjects: ParsedAttendanceSubject[],
  requiredPct: unknown = ATT_DEFAULT_REQUIRED,
): AttendanceRecordRow[] {
  try {
    if (!Array.isArray(subjects)) return []
    return subjects.slice(0, ATT_MAX_SUBJECTS).map((s) => {
      const present = clampCount((s as any)?.attended)
      const total = clampCount((s as any)?.held)
      return {
        subject: clampStr((s as any)?.name, ATT_MAX_NAME),
        present,
        total,
        status: deriveAttendanceStatus(present, total, requiredPct),
      }
    })
  } catch {
    return []
  }
}

/**
 * Resolve attendance subjects for GET /data: record rows win when present
 * (mapped to {name, held, attended}), otherwise parse the blob. Never throws.
 */
export function resolveAttendanceSubjects(source: {
  subjects?: unknown
  recordRows?: Array<{
    subject?: unknown
    present?: unknown
    total?: unknown
    attended?: unknown
    held?: unknown
  }> | null
}): ParsedAttendanceSubject[] {
  try {
    const rows = (source as any)?.recordRows
    if (Array.isArray(rows) && rows.length > 0) {
      const out: ParsedAttendanceSubject[] = []
      for (const r of rows) {
        const name = clampStr((r as any)?.subject ?? (r as any)?.name, ATT_MAX_NAME)
        if (!name) continue
        const attended = clampCount((r as any)?.present ?? (r as any)?.attended)
        const held = clampCount((r as any)?.total ?? (r as any)?.held)
        out.push({ name, held, attended })
        if (out.length >= ATT_MAX_SUBJECTS) break
      }
      if (out.length > 0) return out
    }
    return parseAttendanceSubjectsInput((source as any)?.subjects)
  } catch {
    return []
  }
}

/** True when the student has queryable AttendanceRecord rows (read-new path active). */
export function hasAttendanceRecords(source: {
  recordRows?: Array<unknown> | null
}): boolean {
  return Array.isArray((source as any)?.recordRows) && (source as any).recordRows.length > 0
}
