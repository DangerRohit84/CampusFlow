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
import { buildAdminUserQuery, buildAdminRoleCountsQuery } from '../components/admin/bulkHelpers'

/**
 * @deprecated Import from `../lib/queryKeys` (`qk.admin.*`) instead.
 * Kept for one release so AdminPage prefetch/invalidate needs no churn.
 * SSOT lives in qk.admin — these are identical references, never drift.
 */
export const adminKeys = {
  bundle: (collegeId: string | null) => qk.admin.bundle(collegeId),
  users: (collegeId: string | null, role: string, dept: string, page: number, filters?: { q?: string; roll?: string; year?: string; email?: string }, sort?: { field?: string; order?: string }, pageSize?: number) =>
    qk.admin.users(collegeId, role, dept, page, filters, sort, pageSize),
  roleCounts: (collegeId: string | null, dept: string, filters?: { q?: string; roll?: string; year?: string; email?: string }) =>
    qk.admin.roleCounts(collegeId, dept, filters),
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

/** Paged users (60s stale, server-side page/limit/total). P2 filters + sort compose. */
export function useAdminUsers(
  collegeId: string | null,
  role: string,
  dept: string,
  page: number,
  pageSize = 50,
  enabled = true,
  filters?: { q?: string; roll?: string; year?: string; email?: string },
  sort?: { field?: string; order?: string },
) {
  const q = (filters?.q ?? '').trim()
  const roll = (filters?.roll ?? '').trim()
  const year = (filters?.year ?? '').trim()
  const email = (filters?.email ?? '').trim()
  const sortField = (sort?.field ?? 'name').trim() || 'name'
  const sortOrder = (sort?.order ?? 'asc').trim().toLowerCase() === 'desc' ? 'desc' : 'asc'
  // Page-size (user wish): clamp 1..100, default 50 (backend cap 100).
  const limit = Number.isFinite(pageSize) ? Math.min(100, Math.max(1, Math.floor(pageSize))) || 50 : 50
  return useQuery({
    queryKey: qk.admin.users(collegeId, role, dept, page, { q, roll, year, email }, { field: sortField, order: sortOrder }, limit),
    queryFn: ({ signal }) => {
      // P2 builders own per-tab gating (teachers NO year, admins no roll/year)
      // so list/counts stay in parity; backend remains authoritative (ignores too).
      // Sort is additive: whitelisted at both ends, omitted = backend name asc.
      const params = buildAdminUserQuery(role, dept, page, limit, { q, roll, year, email }, collegeId || undefined, { field: sortField as 'name' | 'email' | 'studentId' | 'empNumber', order: sortOrder as 'asc' | 'desc' })
      return adminAPI.getUsers({ ...params, signal })
    },
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    enabled,
  })
}

/** Role totals for tab badges (60s stale). P2: same filters as the list. */
export function useAdminRoleCounts(
  collegeId: string | null,
  dept: string,
  enabled = true,
  filters?: { q?: string; roll?: string; year?: string; email?: string },
  // Active tab role — maps the shared roll box to the single role-appropriate
  // param (backend ANDs; studentId+empNumber together would match nothing).
  activeRole?: string,
) {
  const q = (filters?.q ?? '').trim()
  const roll = (filters?.roll ?? '').trim()
  const year = (filters?.year ?? '').trim()
  const email = (filters?.email ?? '').trim()
  return useQuery({
    queryKey: qk.admin.roleCounts(collegeId, dept, { q, roll, year, email }),
    queryFn: ({ signal }) => {
      const params = buildAdminRoleCountsQuery(activeRole, dept, { q, roll, year, email }, collegeId || undefined)
      return adminAPI.getRoleCounts({ ...params, signal })
    },
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
