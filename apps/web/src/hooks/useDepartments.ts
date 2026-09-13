import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { departmentAPI } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useCollegeScope } from './useCollegeScope'

/**
 * Shared departments reference-data hook (PERPAGE-HALF1).
 *
 * WHY: 7 pages (Hackathons, Internships, HackathonDetail, InternshipDetail,
 * CodingProfile, ContestLeaderboard, AssignmentDetail) each ran an uncached
 * `departmentAPI.getAll()` in a mount `useEffect` — every mount = 1 GET,
 * StrictMode double-mount = 2 GETs, zero cross-page dedupe. Departments
 * change rarely (admin CRUD), so one shared RQ key with a long staleTime
 * serves all pages from cache after the first fetch.
 *
 * Behavior identical: same array data (`r.data` passthrough), no params
 * (pages previously called `getAll()` with no collegeId — backend scopes by
 * auth). `enabled` lets callers skip the fetch when the picker/filter is
 * not needed (e.g. student view of a ROOM-scope assignment).
 */
export function useDepartments(options?: { enabled?: boolean }) {
  const collegeScope = useCollegeScope()
  return useQuery({
    queryKey: qk.departments(collegeScope),
    queryFn: ({ signal }) => departmentAPI.getAll(collegeScope ?? undefined, signal as any),
    // Ref-data: stale 10min (>> 30s page minimum), gc 30min so background
    // tabs keep it. Focus refetch OFF — dept list must never reload on tab
    // switch; admin CRUD busts via notifyEntityMutated('department')
    // which invalidates the ['departments'] prefix (see entitySync.ts).
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: options?.enabled ?? true,
  })
}
