/**
 * Centralized role helpers — SUPER_ADMIN is global platform owner.
 * COLLEGE_ADMIN is tenant-scoped. Never treat them as equivalent.
 * Order 4: ROLES mirrors Prisma UserRole enum (STUDENT/TEACHER/COLLEGE_ADMIN/
 * SUPER_ADMIN). DB migration maps legacy variants (ADMIN→COLLEGE_ADMIN,
 * STAFF→TEACHER, SUPER→SUPER_ADMIN; unknowns→STUDENT + RAISE NOTICE log).
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

/**
 * P0 SECURITY parity (Classroom/Canvas): filename sanitization for
 * Content-Disposition headers. Strips CR/LF/quotes/path separators to
 * prevent header injection / response splitting, collapses whitespace to
 * underscores, removes non-word chars, and caps length.
 * Always use with: `attachment; filename="..."`; plus filename* UTF-8 param.
 */
export function safeFilename(raw: string | null | undefined, fallback = 'export'): string {
  const base = String(raw ?? '').trim() || fallback
  // Strip CR/LF/quotes first (header injection), then path separators + controls
  const stripped = base
    .replace(/[\r\n"]/g, '')
    .replace(/[\0-\x1f\x7f]/g, '')
    .replace(/[\\/:*?<>|]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^\w\-.]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100)
  return stripped || fallback
}

/** Build a safe Content-Disposition value with both filename and RFC5987 filename*. */
export function contentDisposition(filename: string): string {
  const safe = safeFilename(filename)
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`
}

/**
 * CSV/Excel formula-injection guard (F27). Prefixes values starting with
 * = + - @ (also tab/CR) with a single quote so Excel treats them as text.
 * Apply to every user-controlled cell before workbook.addRow().
 */
export function escapeExcelValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`
  return value
}

/**
 * PII masking for public profiles (F05/W7). Turns jane.doe@example.com
 * into j***@example.com. Returns null/empty unchanged.
 */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email || typeof email !== 'string') return email ?? null
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  const first = local.charAt(0) || '*'
  return `${first}***@${domain}`
}
