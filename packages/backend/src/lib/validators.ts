/**
 * CampusFlow shared validators — zod guards + canonical Json arrays.
 *
 * Context (Order 3, V-07→V-12): list columns are now native `Json`
 * (`themes`, `targetDepartments`, `targetYears`, `solutions` with
 * `@default("[]")` + GIN where queried). The 10k dual-write window
 * (String compat + Json twin via dualWrite* / readDualJson) is RETIRED —
 * migration 20260920000000_order3_json_twins backfilled Json from String,
 * logged conflicts via RAISE NOTICE, dropped the String losers and renamed
 * *Json → base. New DB code writes ONLY Json arrays (see normalize* below).
 *
 * Backward compat: HTTP clients may still send array OR its JSON encoding
 * (mobile caches, CSV imports), and pre-migration rows could surface as
 * Strings in stale read replicas — so every normalizer/reader below accepts
 * `array | json-string | null | undefined` and never throws (garbage → []).
 * `dualWrite*` / `readDualJson` remain as deprecated shims (perf-db.test +
 * contestFetcher history) — do NOT use in new DB writes; use normalize*.
 *
 * This file is the single source of truth for:
 * - Role / Status enums (zod today → Prisma enums later, see perf-db.md)
 * - targetDepartments / targetYears / themes / solutions shapes
 * - deadline coercion (String → Date, null-safe)
 * - canonical Json normalizers (String compat + Json canonical)
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Role / Status enums (zod guards today; Prisma enums later — additive only)
// Order 4 (V-04 slice 1 + V-30): Prisma enums landed (UserRole, StagingDecision,
// StagingStatus, HackathonStatus, InternshipStatus, ContestStatus, CollegeStatus,
// FormStatus, ReportStatus/Scope/IssueType, Priority shared, TaskStatus,
// AssignmentStatus, SubmissionStatus, RegistrationStatus shared, SourceHealthStatus,
// Platform shared). Zod below is the app SSOT and MUST match schema.prisma values
// exactly (prisma validate + db-fix-04-enums.test.ts enforce). Deferred to Order 12
// (stay String in DB): Hackathon/Internship.mode, Notification.type, Task.category,
// FormField.type, Room.chatMode, Resource.*, PlatformSettings.*, AuditLog.*, etc.
// ---------------------------------------------------------------------------

export const RoleEnum = z.enum(['SUPER_ADMIN', 'COLLEGE_ADMIN', 'TEACHER', 'STUDENT'])
export type RoleEnumType = z.infer<typeof RoleEnum>

export const HackathonStatusEnum = z.enum(['DRAFT', 'PUBLISHED', 'COMPLETED', 'CANCELLED'])
export type HackathonStatus = z.infer<typeof HackathonStatusEnum>

export const InternshipStatusEnum = z.enum(['ACTIVE', 'ENDED'])
export type InternshipStatus = z.infer<typeof InternshipStatusEnum>

export const StagingStatusEnum = z.enum(['DRAFT', 'PENDING', 'ACTIVE', 'APPROVED', 'REJECTED'])
export type StagingStatus = z.infer<typeof StagingStatusEnum>

export const ContestStatusEnum = z.enum(['UPCOMING', 'ONGOING', 'ENDED'])
export type ContestStatus = z.infer<typeof ContestStatusEnum>

export const CollegeStatusEnum = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'])
export type CollegeStatus = z.infer<typeof CollegeStatusEnum>

export const FormStatusEnum = z.enum(['ACTIVE', 'CLOSED', 'DRAFT'])
export type FormStatus = z.infer<typeof FormStatusEnum>

export const ReportStatusEnum = z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'])
export type ReportStatus = z.infer<typeof ReportStatusEnum>

export const ReportPriorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
export const TaskStatusEnum = z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
export const AssignmentScopeEnum = z.enum(['ALL', 'DEPARTMENT', 'ROOM'])
export const SubmissionModeEnum = z.enum(['ONLINE', 'OFFLINE', 'HYBRID'])

// Order 4 additions: shared where values match, per-domain where not (mirror Prisma).
export const PriorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
export type Priority = z.infer<typeof PriorityEnum>

export const AssignmentStatusEnum = z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
export type AssignmentStatus = z.infer<typeof AssignmentStatusEnum>

export const SubmissionStatusEnum = z.enum(['SUBMITTED', 'LATE', 'GRADED', 'RETURNED'])
export type SubmissionStatus = z.infer<typeof SubmissionStatusEnum>

export const RegistrationStatusEnum = z.enum(['REGISTERED', 'SELECTED', 'REJECTED', 'COMPLETED', 'ACCEPTED'])
export type RegistrationStatus = z.infer<typeof RegistrationStatusEnum>

export const StagingDecisionEnum = z.enum(['APPROVED', 'REJECTED'])
export type StagingDecision = z.infer<typeof StagingDecisionEnum>

export const ReportScopeEnum = z.enum(['COLLEGE', 'WEBSITE'])
export type ReportScope = z.infer<typeof ReportScopeEnum>

export const ReportIssueTypeEnum = z.enum(['DESIGN', 'BUG', 'CRASH', 'PERFORMANCE', 'SECURITY', 'FEATURE_REQUEST', 'OTHER'])
export type ReportIssueType = z.infer<typeof ReportIssueTypeEnum>

export const PlatformEnum = z.enum(['CODEFORCES', 'CODECHEF', 'LEETCODE', 'ATCODER', 'HACKERRANK', 'GFG', 'OTHER'])
export type Platform = z.infer<typeof PlatformEnum>

export const SourceHealthStatusEnum = z.enum(['OK', 'DEGRADED', 'DOWN', 'UNKNOWN'])
export type SourceHealthStatus = z.infer<typeof SourceHealthStatusEnum>

// ---------------------------------------------------------------------------
// Order 12 (V-04-rest slice 2): zod SSOT for the 3 closed remainder domains.
// Must match schema.prisma enums exactly (prisma validate + db-fix-12 test
// enforce). All other remainder text stays String by design (see schema header).
// Repair 20260926020000: ScheduleType expands to 4 real values (seed audit:
// CLASS/LAB + SEMINAR Placement Prep + OTHER Club Meeting). App SSOT mirrors
// PG enum exactly; route coercions preserve all four (ghosts → CLASS).
// ---------------------------------------------------------------------------

export const ScheduleTypeEnum = z.enum(['CLASS', 'LAB', 'SEMINAR', 'OTHER'])
export type ScheduleType = z.infer<typeof ScheduleTypeEnum>

export const ChatMessageRoleEnum = z.enum(['USER', 'ASSISTANT'])
export type ChatMessageRole = z.infer<typeof ChatMessageRoleEnum>

export const GradeSourceEnum = z.enum(['MANUAL', 'CALCULATOR'])
export type GradeSource = z.infer<typeof GradeSourceEnum>

// ---------------------------------------------------------------------------
// Order 12 (V-23 keep-lite): RRULE-lite grammar for Task.recurrence.
// NULL/empty = one-shot (no recurrence). No DB CHECK yet (legacy rows predate
// the grammar); writers SHOULD validate via this helper. Extract to
// RecurrenceRule only if "occurrences next week" queries materialize.
// ---------------------------------------------------------------------------

const RECURRENCE_RE = /^(DAILY|WEEKLY|MONTHLY)(;INTERVAL=\d+)?(;COUNT=\d+)?$/;

/** Validate Task.recurrence against the documented RRULE-lite grammar (never throws). */
export function isValidRecurrence(input: unknown): boolean {
  if (input === null || input === undefined) return true;
  const s = String(input).trim();
  if (!s) return true;
  if (s.length > 200) return false;
  return RECURRENCE_RE.test(s.toUpperCase());
}

/** Normalize recurrence input → canonical UPPER string or null (never throws). */
export function normalizeRecurrence(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  if (!s) return null;
  const up = s.toUpperCase().slice(0, 200);
  return RECURRENCE_RE.test(up) ? up : s.slice(0, 200);
}

// ---------------------------------------------------------------------------
// Canonical Json: accept array OR its JSON encoding (dual-read, never throws)
// ---------------------------------------------------------------------------

function jsonArrayOf(item: z.ZodTypeAny) {
  return z.preprocess(
    (v) => {
      if (v === undefined || v === null) return []
      if (typeof v === 'string') {
        const trimmed = v.trim()
        if (trimmed === '') return []
        try {
          return JSON.parse(trimmed)
        } catch {
          return v // let downstream array check fail with a clear error
        }
      }
      return v
    },
    z.array(item as any).default([])
  )
}

export const targetDepartmentsSchema = jsonArrayOf(z.string())
export const targetYearsSchema = jsonArrayOf(z.number().int().min(1).max(6))
export const themesSchema = jsonArrayOf(z.string())
export const solutionsSchema = jsonArrayOf(z.string())

/** Strict parse that never throws — returns [] on garbage (list filters stay open). */
export function parseJsonArraySafe(raw: unknown): string[] {
  const parsed = targetDepartmentsSchema.safeParse(raw)
  return parsed.success ? (parsed.data as string[]) : []
}

export function parseJsonNumberArraySafe(raw: unknown): number[] {
  const parsed = targetYearsSchema.safeParse(raw)
  return parsed.success ? (parsed.data as number[]) : []
}

// ---------------------------------------------------------------------------
// Deadline coercion (String/unknown → Date|null, never throws)
// ---------------------------------------------------------------------------

export function coerceDeadline(value: unknown): Date | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (typeof value === 'number') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const d = new Date(trimmed)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

/** Backfill helper: parse a legacy String deadline into Date|null (used by migration script + app fallback). */
export function parseLegacyDeadlineString(raw: string | null | undefined): Date | null {
  return coerceDeadline(raw)
}

// ---------------------------------------------------------------------------
// Canonical writers (Order 3): DB columns are Json arrays — write ONLY these.
// dualWrite* below are deprecated shims (kept for perf-db.test); new code
// must use normalize* (single Json value, no String twin).
// ---------------------------------------------------------------------------

/** Normalize client input (array | JSON-string | null) → string[] for Json cols. */
export function normalizeStringArray(input: string[] | string | null | undefined): string[] {
  return normalizeToArray<string>(input as any, (v) => v as string[]).filter((s) => typeof s === 'string')
}

/** Normalize client input → number[] for targetYears Json col. */
export function normalizeNumberArray(input: number[] | string | null | undefined): number[] {
  if (Array.isArray(input)) return (input as unknown[]).filter((n) => typeof n === 'number' && Number.isFinite(n)) as number[]
  const arr = normalizeToArray<number>(input as any, (v) => v as number[])
  return arr.filter((n) => typeof n === 'number' && Number.isFinite(n))
}

/** Normalize any JSON-ish (array | JSON-string | null) → array (objects kept for solutions). */
export function normalizeJsonArray<T = unknown>(input: T[] | string | null | undefined): T[] {
  if (Array.isArray(input)) return input as T[]
  return normalizeToArray<T>(input as any, (v) => v as T[])
}

export function normalizeDepartments(input: string[] | string | null | undefined): string[] {
  return normalizeStringArray(input)
}

export function normalizeYears(input: number[] | string | null | undefined): number[] {
  return normalizeNumberArray(input)
}

export function normalizeThemes(input: string[] | string | null | undefined): string[] {
  return normalizeStringArray(input)
}

export function normalizeSolutions<T = unknown>(input: T[] | string | null | undefined): T[] {
  return normalizeJsonArray<T>(input)
}

// ---------------------------------------------------------------------------
// Deprecated dual-write shims (pre-Order-3 compat window — do NOT use in new code)
// ---------------------------------------------------------------------------

export interface DualWriteResult<T> {
  /** Legacy String column value (JSON.stringify) — keep writing until drop. */
  stringValue: string
  /** New Json column value (native array) — canonical going forward. */
  jsonValue: T
}

function normalizeToArray<T>(input: T[] | string | null | undefined, coerce: (v: unknown) => T[]): T[] {
  if (input === null || input === undefined) return []
  if (Array.isArray(input)) return input as T[]
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (!trimmed) return []
    try {
      const parsed = JSON.parse(trimmed)
      return Array.isArray(parsed) ? (parsed as T[]) : []
    } catch {
      return []
    }
  }
  return []
}

export function dualWriteJson<T>(input: T[] | string | null | undefined): DualWriteResult<T[]> {
  const arr = normalizeToArray<T>(input as any, (v) => v as T[])
  return { stringValue: JSON.stringify(arr), jsonValue: arr }
}

export function dualWriteDepartments(input: string[] | string | null | undefined): {
  stringValue: string
  jsonValue: string[]
} {
  return dualWriteJson<string>(input)
}

export function dualWriteYears(input: number[] | string | null | undefined): {
  stringValue: string
  jsonValue: number[]
} {
  if (Array.isArray(input)) return { stringValue: JSON.stringify(input), jsonValue: input }
  const arr = normalizeToArray<number>(input as any, (v) => v as number[])
  return { stringValue: JSON.stringify(arr), jsonValue: arr }
}

export function dualWriteThemes(input: string[] | string | null | undefined): {
  stringValue: string
  jsonValue: string[]
} {
  return dualWriteJson<string>(input)
}

/**
 * Merge read (deprecated — pre-Order-3 rows only): prefer Json twin when
 * present, fall back to legacy String. Post-Order-3 rows are always Json;
 * prefer parseJsonArraySafe / direct Array.isArray checks in new code.
 */
export function readDualJson<T>(jsonValue: T | null | undefined, stringValue: string | null | undefined, fallback: T): T {
  if (jsonValue !== null && jsonValue !== undefined) return jsonValue
  if (typeof stringValue === 'string' && stringValue.trim() !== '') {
    try {
      const parsed = JSON.parse(stringValue)
      return parsed as T
    } catch {
      return fallback
    }
  }
  return fallback
}

// ---------------------------------------------------------------------------
// Order 5 — CHECK mirrors (V-27 scope + V-03 role fields) → P7
// DB CHECKs live in migration 20260922000000_order5_9; these zod/app guards
// mirror them so violations surface as 400, not 500/P2000.
// ---------------------------------------------------------------------------

/** Mirror of chk_assignmenthub_scope: ALL→both null, DEPARTMENT→dept only, ROOM→room only. */
export function isValidAssignmentScope(
  scope: string,
  departmentId: string | null | undefined,
  roomId: string | null | undefined,
): boolean {
  const dept = departmentId ? String(departmentId).trim() : ''
  const room = roomId ? String(roomId).trim() : ''
  if (scope === 'ALL') return !dept && !room
  if (scope === 'DEPARTMENT') return !!dept && !room
  if (scope === 'ROOM') return !!room && !dept
  return false
}

export function assignmentScopeError(
  scope: string,
  departmentId: string | null | undefined,
  roomId: string | null | undefined,
): string | null {
  if (isValidAssignmentScope(scope, departmentId, roomId)) return null
  if (scope === 'DEPARTMENT') return 'departmentId required for DEPARTMENT scope'
  if (scope === 'ROOM') return 'roomId required for ROOM scope'
  if (scope === 'ALL') return 'departmentId/roomId must be empty for ALL scope'
  return 'Invalid scope (must be ALL, DEPARTMENT, or ROOM)'
}

/** Mirror of chk_user_role_fields: STUDENT↔no empNumber, non-STUDENT↔no studentId. */
export function validateUserRoleFields(
  role: string,
  opts: { studentId?: string | null; empNumber?: string | null },
): string | null {
  const sid = opts.studentId ? String(opts.studentId).trim() : ''
  const emp = opts.empNumber ? String(opts.empNumber).trim() : ''
  if (role === 'STUDENT' && emp) return 'STUDENT must not have empNumber'
  if (role !== 'STUDENT' && sid) return `${role} must not have studentId`
  return null
}

// ---------------------------------------------------------------------------
// Order 6 — Display-copy projections (V-01/02/20/21) → P1/P6
// DB copies dropped; API keeps `collegeName`/`departmentName`/`courseName` keys
// as join projections for compat. These helpers build the projection.
// ---------------------------------------------------------------------------

/** Resolve college display name via relation (never the dropped copy). */
export function projectCollegeName(college: { name?: string | null } | null | undefined): string | null {
  const n = college?.name
  return typeof n === 'string' && n.trim() ? n : null
}

/** Resolve department display name via relation. */
export function projectDepartmentName(dept: { name?: string | null } | null | undefined): string | null {
  const n = dept?.name
  return typeof n === 'string' && n.trim() ? n : null
}

/** Resolve course display name via relation (Grade.courseName dropped). */
export function projectCourseName(course: { name?: string | null } | null | undefined): string | null {
  const n = course?.name
  return typeof n === 'string' && n.trim() ? n : null
}

// ---------------------------------------------------------------------------
// Order 7 — Leaderboard snapshot contract (V-29) → P1/P6
// contestName/contestUrl/rating/... are SNAPSHOT_AT_SYNC (asOf syncedAt);
// canonical is CodingContest when contestId set. Prefer canonical.
// ---------------------------------------------------------------------------

export interface SnapshotParticipation {
  contestId?: string | null
  contestName: string
  contestUrl?: string | null
}

export interface CanonicalContest {
  title: string
  url: string
}

/** Prefer canonical contest title/url when linked, else snapshot. */
export function resolveContestDisplay(
  p: SnapshotParticipation,
  contest?: CanonicalContest | null,
): { name: string; url: string | null; asOf: 'canonical' | 'snapshot' } {
  if (p.contestId && contest && typeof contest.title === 'string' && contest.title.trim()) {
    return {
      name: contest.title,
      url: typeof contest.url === 'string' ? contest.url : p.contestUrl ?? null,
      asOf: 'canonical',
    }
  }
  return { name: p.contestName, url: p.contestUrl ?? null, asOf: 'snapshot' }
}

// ---------------------------------------------------------------------------
// Order 8 — Temporal helpers (V-22/32) → P10
// ---------------------------------------------------------------------------

/** "HH:MM" (24h, zero-padded or not) + "h:MM AM/PM" → minutes since midnight, else null. */
export function timeToMinutes(input: unknown): number | null {
  if (input === null || input === undefined) return null
  const s = String(input).trim()
  if (!s) return null
  const m = s.match(/^(\d{1,2})\s*:\s*(\d{2})\s*([AP]M)?$/i)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  const ap = (m[3] || '').toUpperCase()
  if (!Number.isFinite(h) || !Number.isFinite(min) || min < 0 || min > 59) return null
  if (ap) {
    if (h < 1 || h > 12) return null
    if (ap === 'AM') h = h % 12
    else h = (h % 12) + 12
  } else if (h < 0 || h > 23) return null
  const total = h * 60 + min
  return total >= 0 && total <= 1439 ? total : null
}

/** Minutes → "HH:MM" zero-padded (for dual-write + ordering). */
export function minutesToTime(min: number | null | undefined): string | null {
  if (min === null || min === undefined || !Number.isInteger(min) || min < 0 || min > 1439) return null
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Combine a day Date + "HH:MM" time into an absolute Date (local), else day alone. */
export function combineDateAndTime(day: Date, time: unknown): Date | null {
  if (!(day instanceof Date) || Number.isNaN(day.getTime())) return null
  const mins = timeToMinutes(time)
  const d = new Date(day)
  if (mins === null) return d
  d.setHours(Math.floor(mins / 60), mins % 60, 0, 0)
  return d
}

/** "YYYY-MM-DD" day bucket → Date at UTC midnight (for AiUsage.dayDate), else null. */
export function dayDateFromBucket(bucket: unknown): Date | null {
  if (typeof bucket !== 'string') return null
  const t = bucket.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null
  const d = new Date(`${t}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Weekly-template weekday guard (topbottom-backend audit F14).
 * Schedule.dayOfWeek / timetable `classes[].dayOfWeek` contract is Monday=0..Sunday=6
 * (see schema Schedule comment + schedules.ts zod 0–6 guard). Timetable save bypassed
 * that guard — out-of-range values persisted silently and broke day queries.
 */
export function isValidDayOfWeek(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6
}

/** Coerce free-text startDate ("Immediate", ISO, etc.) → Date|null (unparseable → null). */
export function coerceStartAt(input: unknown): Date | null {
  return coerceDeadline(input)
}

// ---------------------------------------------------------------------------
// Order 9 — Json helpers (V-05/06/19/13-ops) → P2
// All readers accept Json|String (rollout + stale replicas); writers pass Json.
// ---------------------------------------------------------------------------

/** Parse any Json|String blob into an object ({} on missing/corrupt). */
export function parseJsonObjectSafe(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t) return {}
    try {
      const p = JSON.parse(t)
      if (p && typeof p === 'object' && !Array.isArray(p)) return p as Record<string, unknown>
      return {}
    } catch {
      return {}
    }
  }
  return {}
}

/** Normalize any Json|String object input → plain object (for Json cols). */
export function normalizeJsonObject(input: unknown): Record<string, unknown> {
  return parseJsonObjectSafe(input)
}

/** User.preferences: Json|String → object ({} default). */
export function parsePreferencesSafe(raw: unknown): Record<string, unknown> {
  return parseJsonObjectSafe(raw)
}

/** CodingProfile.platformStats: Json|String → array ([] default). */
export function parsePlatformStatsSafe(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t) return []
    try {
      const p = JSON.parse(t)
      return Array.isArray(p) ? p : []
    } catch {
      return []
    }
  }
  return []
}

/** Generic metadata blob: Json|String → object|null (null when absent). */
export function parseMetadataSafe(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t) return null
    try {
      const p = JSON.parse(t)
      if (p && typeof p === 'object' && !Array.isArray(p)) return p as Record<string, unknown>
      return null
    } catch {
      return null
    }
  }
  return null
}

/** AiProvider.headers: Json|String → Record<string,string> ({} default). */
export function parseHeadersSafe(raw: unknown): Record<string, string> {
  const o = parseJsonObjectSafe(raw)
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string') out[k] = v
    else if (v !== null && v !== undefined) out[k] = String(v)
  }
  return out
}

/** Normalize headers input → object for Json col. */
export function normalizeHeaders(input: unknown): Record<string, string> {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return parseHeadersSafe(input)
  }
  return parseHeadersSafe(input)
}
