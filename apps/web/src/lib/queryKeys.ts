/**
 * Central query-key factory — single source of truth for TanStack Query cache.
 *
 * WHY this exists (root cause of app-wide stale state):
 * - Pages used bare keys (['rooms'], ['hackathons']) with no college/filter
 *   scoping → cross-college pollution + search/pagination showing stale slices.
 * - Manual `useState` pages invalidated dead keys (e.g. ['assignmentHubs'])
 *   that no `useQuery` ever subscribed to → invalidations were no-ops.
 * - CRUD modals only invalidated their own list, never dashboard/counts/search.
 *
 * RULES:
 * - Every list query MUST build its key via this factory.
 * - Every mutation MUST go through `notifyEntityMutated` (entitySync.ts),
 *   which invalidates the entity + all related keys (dashboard/counts/search).
 * - Keys are hierarchical: ['entity', collegeId?, ...filters] so prefix
 *   invalidation (['entity']) catches every filtered variant.
 */

export type CollegeScope = string | null | undefined

function normScope(collegeId: CollegeScope): string {
  if (!collegeId) return 'mine'
  const s = String(collegeId).trim()
  return s ? s : 'mine'
}

export const qk = {
  dashboard: (dayIdx?: number | string, collegeId?: CollegeScope) =>
    dayIdx === undefined
      ? (['dashboard'] as const)
      : (['dashboard', String(dayIdx), normScope(collegeId)] as const),

  announcements: (page?: number, collegeId?: CollegeScope) =>
    (['announcements', normScope(collegeId), page ?? 1] as const),

  assignmentHubs: (params?: { page?: number; search?: string; scope?: string; mode?: string; status?: string; collegeId?: CollegeScope }) =>
    (['assignmentHubs', normScope(params?.collegeId), params?.page ?? 1, params?.search ?? '', params?.scope ?? 'ALL', params?.mode ?? 'ALL', params?.status ?? 'all'] as const),

  tasks: (tab?: string, collegeId?: CollegeScope) => (['tasks', normScope(collegeId), tab ?? 'all'] as const),

  schedules: (collegeId?: CollegeScope) => (['schedules', normScope(collegeId)] as const),
  timetable: () => (['timetable'] as const),

  hackathons: (search?: string, collegeId?: CollegeScope, mine?: boolean) =>
    (['hackathons', normScope(collegeId), (search ?? '').trim().toLowerCase(), mine ? 'mine' : 'all'] as const),

  internships: (search?: string, collegeId?: CollegeScope, mine?: boolean) =>
    (['internships', normScope(collegeId), (search ?? '').trim().toLowerCase(), mine ? 'mine' : 'all'] as const),

  contests: (platform?: string, collegeId?: CollegeScope) =>
    (['contests', normScope(collegeId), (platform ?? 'ALL').toUpperCase()] as const),

  forms: (collegeId?: CollegeScope) => (['forms', normScope(collegeId)] as const),

  rooms: (scope?: string, collegeId?: CollegeScope) =>
    (['rooms', normScope(collegeId), scope ?? 'all'] as const),

  attendance: () => (['attendance'] as const),
  grades: () => (['grades'] as const),

  codingProfile: () => (['coding-profile'] as const),

  // PERPAGE-HALF1: shared leaderboard key — ContestLeaderboardPage converted
  // from manual useState+useEffect (mount refetch storm, no staleTime) to RQ.
  // Prefix ['leaderboard'] is busted by useEntitySync('coding-profile')
  // (see RELATED_PREFIXES) so profile syncs refresh the board once fresh.
  leaderboard: () => (['leaderboard'] as const),

  // PERPAGE-HALF1: shared departments key — 7 pages each fired an uncached
  // departmentAPI.getAll() on every mount (StrictMode double-fire, zero
  // dedupe). useDepartments() subscribes to this ONE key (staleTime 10min)
  // so the first mount fetches and every other page reads cache.
  departments: (collegeId?: CollegeScope) => (['departments', normScope(collegeId)] as const),

  notifications: (collegeId?: CollegeScope) => (['notifications', normScope(collegeId)] as const),

  // Alumni Phase 2 (additive): directory + detail + inboxes + verify queue.
  // Keys are hierarchical on college scope so SUPER_ADMIN college switches
  // bust caches (same tenant-isolation rule as hackathons/internships).
  alumni: (search?: string, collegeId?: CollegeScope, filters?: string) =>
    (['alumni', normScope(collegeId), (search ?? '').trim().toLowerCase(), filters ?? 'all'] as const),
  alumniDetail: (userId?: string, collegeId?: CollegeScope) =>
    (['alumni-detail', normScope(collegeId), userId ?? ''] as const),
  alumniMine: (box?: string, page?: number, collegeId?: CollegeScope) =>
    (['alumni-mine', normScope(collegeId), box ?? 'all', page ?? 1] as const),
  alumniPending: (page?: number, collegeId?: CollegeScope) =>
    (['alumni-pending', normScope(collegeId), page ?? 1] as const),

  search: (q: string) => (['search', q.trim().toLowerCase()] as const),

  adminStaging: (status?: string, hPage?: number, iPage?: number) =>
    (['admin-staging', status ?? 'all', hPage ?? 1, iPage ?? 1] as const),
  adminCounts: () => (['admin-counts'] as const),
  adminColleges: () => (['admin-colleges'] as const),
  // PERF: shared fetch-settings key — 10 PlatformCards + OtherSourcesCards
  // each mount-fetched GET /fetch/settings/all (per-card useEffect, no dedupe:
  // 12 identical GETs per FetchPage visit, ×2 under StrictMode dev). One key
  // with 60s staleTime (mirrors the backend 60s settings cache) so all cards
  // share a single network trip. Limit PUTs invalidate it (see useFetchSettings).
  fetchSettings: () => (['fetch-settings'] as const),
  // Admin SSOT (I-7 fix): single key factory for AdminPage + useAdminQueries +
  // entitySync invalidation. Shapes preserved verbatim so existing cache hits.
  // New code MUST use qk.admin* — `adminKeys` in useAdminQueries.ts re-exports
  // these (deprecated) so prefetch/invalidate can never drift to dead keys.
  admin: {
    bundle: (collegeId: CollegeScope) =>
      (['admin', normScope(collegeId), 'bundle'] as const),
    // P2 per-tab filters compose into the key (q/roll/year/email). Absent =
    // '' (same fetch as unfiltered). Prefix invalidation (['admin-users'])
    // still catches every filtered variant (hierarchical keys rule).
    // Sort (2026-09-14, additive): trailing sort/order (default name/asc).
    // Old keys without sort still prefix-match for invalidation; new keys
    // bust cache once (order change) then hit. Pagination preserved (page in key).
    // Page-size (2026-09-14, user wish): trailing limit (default 50, cap 100).
    // Old keys without limit prefix-match; new keys bust once per size change.
    users: (collegeId: CollegeScope, role: string, dept: string, page: number, filters?: { q?: string; roll?: string; year?: string; email?: string }, sort?: { field?: string; order?: string }, pageSize?: number) =>
      (['admin-users', normScope(collegeId), role, dept, page, filters?.q ?? '', filters?.roll ?? '', filters?.year ?? '', filters?.email ?? '', sort?.field ?? 'name', sort?.order ?? 'asc', pageSize ?? 50] as const),
    roleCounts: (collegeId: CollegeScope, dept: string, filters?: { q?: string; roll?: string; year?: string; email?: string }) =>
      (['admin-role-counts', normScope(collegeId), dept, filters?.q ?? '', filters?.roll ?? '', filters?.year ?? '', filters?.email ?? ''] as const),
    colleges: () => (['admin-colleges'] as const),
  },
  superDashboard: (collegeId?: string, from?: string, to?: string) =>
    (['super-dashboard', collegeId ?? '', from ?? '', to ?? ''] as const),

  // #11 bulk/audit/KPI/AI-metering keys (additive — existing keys untouched).
  auditLogs: (params?: { collegeId?: string; action?: string; search?: string; page?: number }) =>
    (['audit-logs', params?.collegeId ?? '', params?.action ?? '', params?.search ?? '', params?.page ?? 1] as const),
  platformKpis: (collegeId?: string, from?: string, to?: string) =>
    (['platform-kpis', collegeId ?? '', from ?? '', to ?? ''] as const),
  aiUsage: (collegeId?: string, from?: string, to?: string) =>
    (['ai-usage', collegeId ?? '', from ?? '', to ?? ''] as const),

  // Legacy aliases kept so old invalidations still hit the new hierarchy.
  // Prefix invalidation on these catches every variant above.
  legacy: {
    hubs: ['hubs'],
    assignments: ['assignments'],
    mySubmissions: ['mySubmissions'],
  },
} as const

/** Read current college scope outside React (interceptor / helpers). */
export function currentCollegeScope(): string | null {
  try {
    const raw = localStorage.getItem('campusflow-superadmin-college')
    if (raw) {
      const parsed = JSON.parse(raw)
      const id = parsed?.state?.selectedCollegeId || parsed?.selectedCollegeId || null
      if (id) return String(id)
    }
  } catch {}
  try {
    const legacy = localStorage.getItem('superadmin_selectedCollegeId')
    if (legacy) return String(legacy)
  } catch {}
  try {
    const sp = new URLSearchParams(window.location.search)
    const q = sp.get('collegeId')
    if (q) return String(q)
  } catch {}
  return null
}
