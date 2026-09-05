/**
 * Centralized role helpers — SUPER_ADMIN is global platform owner.
 * COLLEGE_ADMIN is tenant-scoped. Never treat them as equivalent.
 */

export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  COLLEGE_ADMIN: 'COLLEGE_ADMIN',
  TEACHER: 'TEACHER',
  STUDENT: 'STUDENT',
} as const

export type Role = typeof ROLES[keyof typeof ROLES]

export function isSuperAdmin(user: { role: string } | null | undefined): boolean {
  return user?.role === ROLES.SUPER_ADMIN
}

export function isCollegeAdmin(user: { role: string } | null | undefined): boolean {
  return user?.role === ROLES.COLLEGE_ADMIN
}

export function isTeacher(user: { role: string } | null | undefined): boolean {
  return user?.role === ROLES.TEACHER
}

export function isStudent(user: { role: string } | null | undefined): boolean {
  return user?.role === ROLES.STUDENT
}

/**
 * Tenant isolation helper.
 * SUPER_ADMIN bypasses all college checks (global).
 * Others must have matching collegeId.
 * Use as: if (!canAccessCollege(user, resource.collegeId)) return 403
 */
export function canAccessCollege(
  user: { role: string; collegeId: string | null | undefined },
  resourceCollegeId: string | null | undefined,
): boolean {
  if (isSuperAdmin(user)) return true
  // resource without college is considered global/public — allow if user has no college? Keep strict.
  // For tenant resources, require exact match.
  return !!user.collegeId && user.collegeId === resourceCollegeId
}

/**
 * Resolve SUPER_ADMIN target college from multiple transport sources.
 * Frontend sends via body (JSON/FormData), query (?collegeId=), or header (x-superadmin-college-id).
 * Mirrors apps/web/src/lib/api.ts interceptor + superAdminCollegeStore + legacy localStorage keys.
 */
export function getSuperAdminTargetCollegeId(req: any, explicitCollegeId?: string | null): string | null {
  if (explicitCollegeId) return explicitCollegeId
  if (req?.body?.collegeId) return String(req.body.collegeId)
  if (req?.query?.collegeId) return String(req.query.collegeId)
  const hdr = req?.headers?.['x-superadmin-college-id'] || req?.headers?.['x-superadmin-collegeId'] || req?.headers?.['x-college-id']
  if (hdr) return String(hdr)
  return null
}

/**
 * Derive target collegeId for creation flows.
 * - SUPER_ADMIN: explicit collegeId from request body/query/header, or null (global/platform)
 * - Others: must use their own collegeId (ignore supplied)
 * Returns null for global, string for tenant, or null if missing (caller should 400 if required)
 * @param explicitCollegeId - when provided takes precedence (e.g. body.collegeId already extracted)
 * @param req - optional request to also check query/header/body fallbacks
 */
export function deriveCollegeId(
  user: { role: string; collegeId: string | null | undefined },
  explicitCollegeId?: string | null,
  req?: any,
): string | null {
  if (isSuperAdmin(user)) {
    // Prefer explicit, then any superadmin-scoped source on the request, then user's own college (usually null)
    if (explicitCollegeId) return explicitCollegeId
    if (req) {
      const fromReq = getSuperAdminTargetCollegeId(req)
      if (fromReq) return fromReq
    }
    return user.collegeId || null
  }
  return user.collegeId || null
}
