import { useAuthStore } from '../store/authStore'
import { useSuperAdminCollegeStore } from '../store/superAdminCollegeStore'

/**
 * Reactive college scope — single source of truth for tenant scoping.
 *
 * WHY this exists (stale-CRUD root cause):
 * - Pages computed scope via `currentCollegeScope()` (raw localStorage read).
 *   That value is NOT reactive: switching college in the super-admin store
 *   never re-rendered the page, so the React Query key kept the OLD collegeId
 *   and showed the previous college's cached list until a full refresh.
 * - `qk.*` keys are hierarchical on this scope, so a reactive scope both
 *   isolates caches per college AND auto-refetches on switch (new key).
 *
 * Priority: explicit user.collegeId → super-admin override store → ?collegeId URL.
 * Returns `null` when unscoped (personal scope → qk normalizes to 'mine').
 */
export function useCollegeScope(): string | null {
  const userCollegeId = useAuthStore((s) => (s.user as any)?.collegeId ?? null)
  const overrideId = useSuperAdminCollegeStore((s) => s.selectedCollegeId)

  if (userCollegeId) return String(userCollegeId)
  if (overrideId) return String(overrideId)

  try {
    const sp = new URLSearchParams(window.location.search)
    const q = sp.get('collegeId')
    if (q) return String(q)
  } catch {}

  return null
}
