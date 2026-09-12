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

  tasks: (tab?: string) => (['tasks', tab ?? 'all'] as const),

  schedules: () => (['schedules'] as const),
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
  departments: () => (['departments'] as const),

  notifications: () => (['notifications'] as const),

  search: (q: string) => (['search', q.trim().toLowerCase()] as const),

  adminStaging: (status?: string, hPage?: number, iPage?: number) =>
    (['admin-staging', status ?? 'all', hPage ?? 1, iPage ?? 1] as const),
  adminCounts: () => (['admin-counts'] as const),
  adminColleges: () => (['admin-colleges'] as const),
  // Admin SSOT (I-7 fix): single key factory for AdminPage + useAdminQueries +
  // entitySync invalidation. Shapes preserved verbatim so existing cache hits.
  // New code MUST use qk.admin* — `adminKeys` in useAdminQueries.ts re-exports
  // these (deprecated) so prefetch/invalidate can never drift to dead keys.
  admin: {
    bundle: (collegeId: CollegeScope) =>
      (['admin', normScope(collegeId), 'bundle'] as const),
    users: (collegeId: CollegeScope, role: string, dept: string, page: number) =>
      (['admin-users', normScope(collegeId), role, dept, page] as const),
    roleCounts: (collegeId: CollegeScope, dept: string) =>
      (['admin-role-counts', normScope(collegeId), dept] as const),
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
