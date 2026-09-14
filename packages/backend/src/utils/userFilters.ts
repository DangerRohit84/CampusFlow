/**
 * Admin user-list filters (GET /admin/users?departmentId=&role=&search=&studentId=&empNumber=&incomingYear=&email=).
 * Pure helpers — no DB, hermetic unit-testable.
 * WHY split out: the route file pulls express+prisma (integration weight);
 * the where-building logic is Small-testable here (<100ms, no I/O).
 * P2 (2026-09-14): per-tab search+filters composing with pagination + correct counts.
 * Backward compat: absent = no filter (old behavior). incomingYear on
 * teachers/admins is ignored silently (keeps tab switch simple).
 * Sort (2026-09-14, additive): ?sort=&order= whitelisted to name/email/
 * studentId/empNumber only, default name asc. Frontend exposes per-tab
 * sortable columns (students: name/email/studentId; teachers: name/email/
 * empNumber; admins: name/email). Invalid sort falls back to default (never
 * 400, never injects arbitrary column — Prisma orderBy is allow-listed).
 */

export const USER_LIST_ROLES = ['STUDENT', 'TEACHER', 'COLLEGE_ADMIN', 'SUPER_ADMIN'] as const

export type UserListRole = (typeof USER_LIST_ROLES)[number]

/**
 * Sortable columns for GET /admin/users (allow-list only — prevents Prisma
 * orderBy injection via arbitrary ?sort= values).
 * Per-tab exposure (frontend): students name/email/studentId, teachers
 * name/email/empNumber, college_admins name/email. Backend accepts all four
 * regardless of role (harmless: sorting by an empty column is still
 * deterministic via the id tiebreaker).
 */
export const USER_LIST_SORT_FIELDS = ['name', 'email', 'studentId', 'empNumber'] as const

export type UserListSortField = (typeof USER_LIST_SORT_FIELDS)[number]

export type UserListSortOrder = 'asc' | 'desc'

/**
 * Normalize ?sort= (also accepts ?sortBy= alias at the caller).
 * Case-insensitive, trimmed. Returns the canonical whitelisted field, or
 * 'name' default when absent/invalid (never throws, never 400 — additive).
 */
export function normalizeUserListSort(raw: unknown): UserListSortField {
  const v = String(raw ?? '').trim().toLowerCase()
  if (!v) return 'name'
  const found = (USER_LIST_SORT_FIELDS as readonly string[]).find(
    (f) => f.toLowerCase() === v,
  )
  return (found as UserListSortField | undefined) ?? 'name'
}

/**
 * Normalize ?order= (also accepts ?sortOrder=/?dir= aliases at the caller).
 * 'asc'|'desc' case-insensitive, trimmed. Default 'asc' on absent/invalid
 * (never 400 — keeps old clients working).
 */
export function normalizeUserListOrder(raw: unknown): UserListSortOrder {
  const v = String(raw ?? '').trim().toLowerCase()
  return v === 'desc' ? 'desc' : 'asc'
}

/**
 * Build a stable Prisma orderBy for the user list: [{field: dir}, {id: 'asc'}].
 * The id tiebreaker keeps page/limit/cursor pagination deterministic when
 * names/emails collide. Field is already allow-listed by normalizeUserListSort
 * (callers must not pass raw query values here).
 */
export function buildUserListOrderBy(
  sort: UserListSortField,
  order: UserListSortOrder,
): Array<Record<string, unknown>> {
  return [{ [sort]: order }, { id: 'asc' }]
}

/** Normalize ?role= (case-insensitive). Null = absent/invalid (caller 400s on non-empty invalid). */
export function normalizeRoleFilter(raw: unknown): UserListRole | null {
  const v = String(raw ?? '').trim().toUpperCase()
  if (!v) return null
  return (USER_LIST_ROLES as readonly string[]).includes(v) ? (v as UserListRole) : null
}

/** True when ?role= was supplied but is not a known role (fail fast with 400). */
export function isInvalidRoleFilter(raw: unknown): boolean {
  const v = String(raw ?? '').trim()
  return v.length > 0 && normalizeRoleFilter(v) === null
}

/** Normalize ?departmentId=. Null = absent (no filtering, backward compat). */
export function normalizeDepartmentFilter(raw: unknown): string | null {
  const v = String(raw ?? '').trim()
  return v ? v : null
}

/** Normalize ?search= (name contains, case-insensitive, trim, slice 100). Null = absent. */
export function normalizeSearch(raw: unknown): string | null {
  const v = String(raw ?? '').trim()
  if (!v) return null
  return v.slice(0, 100)
}

/** Normalize ?studentId= / ?roll= alias (students: studentId contains insensitive). Null = absent. */
export function normalizeStudentId(raw: unknown): string | null {
  const v = String(raw ?? '').trim()
  return v ? v.slice(0, 100) : null
}

/** Normalize ?empNumber= (teachers). Null = absent. */
export function normalizeEmpNumber(raw: unknown): string | null {
  const v = String(raw ?? '').trim()
  return v ? v.slice(0, 100) : null
}

/** Normalize ?email= contains (college admins; allowed for all roles, UI only exposes there). Null = absent. */
export function normalizeEmailFilter(raw: unknown): string | null {
  const v = String(raw ?? '').trim()
  return v ? v.slice(0, 100) : null
}

/**
 * Normalize ?incomingYear= int (students only; teachers/admins ignore silently).
 * Returns { value } when valid, { value: null } when absent, { invalid: true }
 * when present but out of 1990..now+6 or non-numeric (caller 400s
 * `Invalid incomingYear filter`).
 */
export function normalizeIncomingYear(raw: unknown): { value: number | null; invalid: boolean } {
  const s = String(raw ?? '').trim()
  if (!s) return { value: null, invalid: false }
  const y = parseInt(s, 10)
  const nowY = new Date().getFullYear()
  if (isNaN(y) || y < 1990 || y > nowY + 6) return { value: null, invalid: true }
  return { value: y, invalid: false }
}

export interface UserListFilters {
  role?: UserListRole | null
  departmentId?: string | null
  search?: string | null
  studentId?: string | null
  empNumber?: string | null
  email?: string | null
  incomingYear?: number | null
}

/**
 * Apply role/department + P2 search/roll/year/email filters onto an existing
 * Prisma user where (college scoping already applied by the caller).
 * Returns a NEW object. All filters AND together.
 * Prisma contains+mode:insensitive for text (case-insensitive per plan).
 */
export function applyUserListFilters(
  baseWhere: Record<string, unknown>,
  filters: UserListFilters,
): Record<string, unknown> {
  const where: Record<string, unknown> = { ...baseWhere }
  if (filters.role) where.role = filters.role
  if (filters.departmentId) where.departmentId = filters.departmentId
  const and: Record<string, unknown>[] = []
  if (filters.search) and.push({ name: { contains: filters.search, mode: 'insensitive' } })
  if (filters.studentId) and.push({ studentId: { contains: filters.studentId, mode: 'insensitive' } })
  if (filters.empNumber) and.push({ empNumber: { contains: filters.empNumber, mode: 'insensitive' } })
  if (filters.email) and.push({ email: { contains: filters.email, mode: 'insensitive' } })
  if (filters.incomingYear != null) and.push({ incomingYear: filters.incomingYear })
  if (and.length > 0) {
    const existing = (where as Record<string, unknown>).AND
    if (Array.isArray(existing)) where.AND = [...existing, ...and]
    else where.AND = and
  }
  return where
}

/**
 * Role-counts parity helper (follow-up 2026-09-14, review-bulk Important #1).
 * WHY: GET /users list ignores incomingYear for TEACHER/COLLEGE_ADMIN/SUPER_ADMIN
 * role queries (ignoreYear guard in routes/admin.ts). GET /users/role-counts
 * previously applied year globally, narrowing teacher/admin badges toward 0 while
 * their lists ignored it (direct-API drift; FE omits year for non-students so no
 * user-visible drift today, but badges must equal their tab list totals).
 * FIX: split into two wheres — studentsWhere (WITH year) for the students badge,
 * othersWhere (WITHOUT year) for teachers/admins badges — so each badge == its tab
 * list total under the same shared filters. Additive: shape unchanged
 * ({students, teachers, college_admins}), only values corrected. No migration.
 */
export interface RoleCountsWheres {
  studentsWhere: Record<string, unknown>
  othersWhere: Record<string, unknown>
  hasYearFilter: boolean
}

export function buildAdminRoleCountsWheres(
  baseWhere: Record<string, unknown>,
  filters: Omit<UserListFilters, 'role'>,
): RoleCountsWheres {
  const othersWhere = applyUserListFilters(baseWhere, { ...filters, incomingYear: null })
  const studentsWhere = applyUserListFilters(baseWhere, { ...filters })
  return { studentsWhere, othersWhere, hasYearFilter: filters.incomingYear != null }
}
