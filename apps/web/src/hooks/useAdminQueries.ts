// hooks/useAdminQueries.ts — TanStack Query migration for AdminPage (I-10 fix).
// WHY: AdminPage hand-rolled 4 Maps + 4 AbortControllers + 4 seqs + evictCache
// (~200 lines) duplicating RQ (staleTime/gcTime/keepPreviousData/focus-false).
// These hooks are the canonical data layer; AdminPage migrates loader-by-loader
// (slice 1: bundle + users + roleCounts + colleges). AbortSignal threading
// preserved via RQ queryFn({signal}). keepPreviousData prevents list flash.

import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { adminAPI, departmentAPI } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { logger } from '../lib/logger'

/**
 * @deprecated Import from `../lib/queryKeys` (`qk.admin.*`) instead.
 * Kept for one release so AdminPage prefetch/invalidate needs no churn.
 * SSOT lives in qk.admin — these are identical references, never drift.
 */
export const adminKeys = {
  bundle: (collegeId: string | null) => qk.admin.bundle(collegeId),
  users: (collegeId: string | null, role: string, dept: string, page: number) =>
    qk.admin.users(collegeId, role, dept, page),
  roleCounts: (collegeId: string | null, dept: string) =>
    qk.admin.roleCounts(collegeId, dept),
  colleges: () => qk.admin.colleges(),
}

/** Bundle: analytics + hackathons + forms + departments (2min stale, was manual Map). */
export function useAdminBundle(collegeId: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.admin.bundle(collegeId),
    queryFn: async ({ signal }) => {
      // allSettled: one failing slice (e.g. forms 500) must NOT fail the whole
      // bundle (was Promise.all — single reject blanked analytics+users).
      // Per-slice staleTime handled by callers; bundle keeps 2min.
      const [analytics, hacks, forms, depts] = await Promise.all([
        adminAPI.getAnalytics(collegeId || undefined, signal).catch((err) => {
          logger.warn('[admin] bundle analytics failed (partial)', { err })
          return null
        }),
        adminAPI.getHackathons(collegeId || undefined, signal).catch((err) => {
          logger.warn('[admin] bundle hackathons failed (partial)', { err })
          return []
        }),
        adminAPI.getForms(collegeId || undefined, signal).catch((err) => {
          logger.warn('[admin] bundle forms failed (partial)', { err })
          return []
        }),
        departmentAPI.getAll(collegeId || undefined, signal).catch((err) => {
          logger.warn('[admin] bundle departments failed (partial)', { err })
          return []
        }),
      ])
      return { analytics, hackathons: hacks, forms, departments: depts }
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    enabled: enabled && !!collegeId,
  })
}

/** Paged users (60s stale, server-side page/limit/total). */
export function useAdminUsers(
  collegeId: string | null,
  role: string,
  dept: string,
  page: number,
  pageSize = 50,
  enabled = true,
) {
  return useQuery({
    queryKey: qk.admin.users(collegeId, role, dept, page),
    queryFn: ({ signal }) =>
      adminAPI.getUsers({
        collegeId: collegeId || undefined,
        role,
        departmentId: dept !== 'all' ? dept : undefined,
        page,
        limit: pageSize,
        signal,
      }),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    enabled,
  })
}

/** Role totals for tab badges (60s stale). */
export function useAdminRoleCounts(collegeId: string | null, dept: string, enabled = true) {
  return useQuery({
    queryKey: qk.admin.roleCounts(collegeId, dept),
    queryFn: ({ signal }) =>
      adminAPI.getRoleCounts({
        collegeId: collegeId || undefined,
        departmentId: dept !== 'all' ? dept : undefined,
        signal,
      }),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    enabled,
  })
}

/** All colleges for SUPER_ADMIN picker (2min stale). */
export function useAdminColleges(enabled = true) {
  return useQuery({
    queryKey: qk.admin.colleges(),
    // Single GROUP BY source (was manual Map + unauthenticated fallback).
    // RQ owns cancellation via signal; keepPreviousData prevents list flash.
    queryFn: ({ signal }) => adminAPI.getColleges(signal),
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    enabled,
  })
}
