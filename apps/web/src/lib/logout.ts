// lib/logout.ts — fast deterministic logout contract (SRP: single source of truth).
// WHY: clicking Log out refreshed then landed on dashboard (slow await on
// network + navigate raced stale isAuthenticated=true → GuestRoute bounced to
// /dashboard, plus refetch storms + lingering socket). Logout must clear
// state/storage synchronously, cancel queries (no refetch), disconnect socket
// promptly, then land on /login (never dashboard) in <300ms local with no
// awaits on network and no full page reload. Pure helpers here so vitest node
// env can lock the contract; authStore.logout + handlers implement it.

/** Canonical post-logout destination. Never /dashboard (guard flash). */
export const LOGOUT_DEST = '/login'

/**
 * Effective auth check for guards (GuestRoute/LandingRoute/ProtectedRoute).
 * WHY: GuestRoute checked isAuthenticated alone. During the logout race
 * (navigate fired while store still held isAuthenticated=true, user still set),
 * it bounced a logging-out user to /dashboard. Requiring user presence closes
 * the flash: logged-out (user null) → never dashboard, even if a stale true
 * lingers one tick.
 */
export function isEffectivelyAuthenticated(isAuthenticated: unknown, user: unknown): boolean {
  return Boolean(isAuthenticated && user)
}

/**
 * Synchronously clear all logout-relevant storage.
 * - campusflow-auth: overwritten with cleared blob (not just removed) so the
 *   api interceptor (reads storage, not memory) sees logged-out same tick.
 * - campusflow-csrf + superadmin scope keys: removed (stale tenant must never
 *   pollute the next session).
 * - sessionStorage postLoginRedirect: removed (401 intent from the previous
 *   session must not steer the next login).
 * Best-effort (private mode): never throws.
 */
export function clearLogoutStorage(): void {
  try {
    localStorage.removeItem('campusflow-superadmin-college')
  } catch {}
  try {
    localStorage.removeItem('superadmin_selectedCollegeId')
  } catch {}
  try {
    localStorage.removeItem('superadmin_selectedCollegeName')
  } catch {}
  try {
    localStorage.removeItem('campusflow-csrf')
  } catch {}
  try {
    sessionStorage.removeItem('postLoginRedirect')
  } catch {}
  // Overwrite AFTER removals so the cleared blob wins same tick (persist
  // subscribe will serialize the same cleared state on next set() anyway).
  try {
    localStorage.setItem(
      'campusflow-auth',
      JSON.stringify({
        state: { user: null, token: null, csrfToken: null, isAuthenticated: false, loading: false },
        version: 0,
      }),
    )
  } catch {}
}
