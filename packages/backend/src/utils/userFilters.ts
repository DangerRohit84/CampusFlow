/**
 * Admin user-list filters (GET /admin/users?departmentId=&role=).
 * Pure helpers — no DB, hermetic unit-testable.
 * WHY split out: the route file pulls express+prisma (integration weight);
 * the where-building logic is Small-testable here (<100ms, no I/O).
 */

export const USER_LIST_ROLES = ['STUDENT', 'TEACHER', 'COLLEGE_ADMIN', 'SUPER_ADMIN'] as const

export type UserListRole = (typeof USER_LIST_ROLES)[number]

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

export interface UserListFilters {
  role?: UserListRole | null
  departmentId?: string | null
}

/**
 * Apply role/department filters onto an existing Prisma user where
 * (college scoping already applied by the caller). Returns a NEW object.
 */
export function applyUserListFilters(
  baseWhere: Record<string, unknown>,
  filters: UserListFilters,
): Record<string, unknown> {
  const where: Record<string, unknown> = { ...baseWhere }
  if (filters.role) where.role = filters.role
  if (filters.departmentId) where.departmentId = filters.departmentId
  return where
}
