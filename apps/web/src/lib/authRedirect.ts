// lib/authRedirect.ts — role → landing route map (SRP: single source of truth).
// WHY: LoginPage + GuestRoute/LandingRoute hardcoded '/dashboard' for every role.
// SUPER_ADMIN's home is /superadmin (not /dashboard); COLLEGE_ADMIN/STUDENT/
// TEACHER home is /dashboard. After an account switch (superadmin → college-admin)
// a stale postLoginRedirect (e.g. /superadmin/colleges/xxx saved by the 401
// handler during the previous session) would send a COLLEGE_ADMIN to a
// SuperAdminGuard route → /403 bounce that looks like "stayed on /login".
// Pure functions (no window/storage) so vitest node env can lock behavior.

export type LandingRole = 'STUDENT' | 'TEACHER' | 'COLLEGE_ADMIN' | 'SUPER_ADMIN' | string | null | undefined

/** Canonical landing route per role. COLLEGE_ADMIN is explicit (not fallthrough). */
export function getLandingRouteForRole(role: LandingRole): string {
  if (role === 'SUPER_ADMIN') return '/superadmin'
  return '/dashboard'
}

/** Superadmin-only routes (guarded by SuperAdminGuard in App.tsx). */
export function isSuperAdminRoute(path: unknown): boolean {
  if (typeof path !== 'string' || !path.startsWith('/')) return false
  if (path === '/superadmin' || path.startsWith('/superadmin/')) return true
  if (path === '/admin/fetch' || path.startsWith('/admin/fetch')) return true
  if (path === '/admin/ai-manager' || path.startsWith('/admin/ai-manager')) return true
  if (path === '/admin/dashboard' || path.startsWith('/admin/dashboard')) return true
  return false
}

/**
 * Resolve post-login destination.
 * - Honors saved postLoginRedirect (401 intent preservation) when valid.
 * - Ignores /login, /register, non-absolute, empty (fall back to role landing).
 * - Ignores superadmin-only saved routes for non-SUPER_ADMIN (account-switch
 *   stale redirect → would 403-bounce and look like "no redirect").
 */
export function resolvePostLoginDest(saved: unknown, role: LandingRole): string {
  const landing = getLandingRouteForRole(role)
  if (typeof saved !== 'string' || !saved) return landing
  if (!saved.startsWith('/')) return landing
  if (saved.startsWith('/login') || saved.startsWith('/register')) return landing
  if (role !== 'SUPER_ADMIN' && isSuperAdminRoute(saved)) return landing
  return saved
}
