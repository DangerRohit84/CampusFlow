// lib/api/resources/admin.ts — admin/college/user domain APIs (SRP extract).
// WHY: lib/api.ts mixed two getUsers call shapes (positional collegeId+opts in
// AdminPage vs params-object in useAdminQueries) and split role-counts across
// 3 client round-trips. This module is the SUPERSET: union getUsers accepts
// both shapes, getRoleCounts hits the single GROUP BY endpoint, and every
// legacy method (addTeacher/bulk/registerCollege/...) is preserved so all 47
// pages keep working through lib/api.ts compat re-exports. Behavior identical.

import axios from 'axios'
import { api, API_TIMEOUTS, API_URL } from '../client'

export interface AdminUserQuery {
  collegeId?: string
  role?: string
  departmentId?: string
  page?: number
  limit?: number
  search?: string
  // P2 per-tab filters (composing, backward compat: absent = no filter).
  studentId?: string
  roll?: string
  empNumber?: string
  email?: string
  incomingYear?: number
  signal?: AbortSignal
}

export const adminAPI = {
  /**
   * Focused form (preferred): single params object. Explicit, no type-switch.
   * Example: getUsers({ collegeId, role, departmentId, page, limit, search, signal })
   */
  getUsers: (params?: AdminUserQuery) => {
    const { signal, ...query } = (params ?? {}) as AdminUserQuery & { signal?: AbortSignal }
    const cleaned: Record<string, unknown> = { ...(query as Record<string, unknown>) }
    if (cleaned.departmentId === 'all') delete cleaned.departmentId
    return api.get('/admin/users', { params: cleaned, signal }).then((r) => r.data)
  },
  /**
   * Positional form (compat): getUsersByCollege(collegeId, { departmentId, role, page, limit, signal }).
   * Kept so AdminPage's legacy call shape needs no behavior change; new code uses getUsers(params).
   */
  getUsersByCollege: (collegeId?: string, opts?: Omit<AdminUserQuery, 'collegeId' | 'search'>) => {
    const params: Record<string, unknown> = { ...(collegeId ? { collegeId } : {}) }
    if (opts?.departmentId && opts.departmentId !== 'all') params.departmentId = opts.departmentId
    if (opts?.role) params.role = opts.role
    if (opts?.page != null) params.page = opts.page
    if (opts?.limit != null) params.limit = opts.limit
    return api.get('/admin/users', { params, signal: opts?.signal }).then((r) => r.data)
  },
  // Tab-badge totals: single GROUP BY (was 3× take:1+count from the client).
  // P2: accepts the SAME search/roll/year/email filters as getUsers so badges
  // stay correct while filtering (absent = unfiltered totals, old behavior).
  getRoleCounts: (params?: { collegeId?: string; departmentId?: string; search?: string; studentId?: string; roll?: string; empNumber?: string; email?: string; incomingYear?: number; signal?: AbortSignal }) => {
    const { signal, ...query } = (params as Record<string, unknown>) || {}
    return api.get('/admin/users/role-counts', { params: query, signal: signal as AbortSignal | undefined }).then((r) => r.data)
  },
  getAnalytics: (collegeId?: string, signal?: AbortSignal) =>
    api.get('/admin/analytics', { params: collegeId ? { collegeId } : {}, signal }).then((r) => r.data),
  getColleges: (signal?: AbortSignal) => api.get('/admin/colleges', { signal }).then((r) => r.data),
  createUser: (data: unknown) => api.post('/admin/users', data).then((r) => r.data),
  addTeacher: (data: unknown) => api.post('/admin/users/teacher', data).then((r) => r.data),
  addStudent: (data: unknown) => api.post('/admin/users/student', data).then((r) => r.data),
  bulkAddTeachers: (teachers: unknown[], collegeId?: string, sharedPassword?: string) =>
    api.post('/admin/users/teachers/bulk', { teachers, ...(collegeId ? { collegeId } : {}), ...(sharedPassword ? { sharedPassword } : {}) }).then((r) => r.data),
  bulkAddStudents: (students: unknown[], collegeId?: string, sharedPassword?: string) =>
    api.post('/admin/users/students/bulk', { students, ...(collegeId ? { collegeId } : {}), ...(sharedPassword ? { sharedPassword } : {}) }).then((r) => r.data),
  updateUser: (id: string, data: unknown) => api.put(`/admin/users/${id}`, data).then((r) => r.data),
  deleteUser: (id: string) => api.delete(`/admin/users/${id}`).then((r) => r.data),
  // P3 transactional bulk delete (1–100 ids, type-to-confirm DELETE N server-side).
  bulkDeleteUsers: (ids: string[], confirm: string, collegeId?: string) =>
    api.post('/admin/users/bulk-delete', { ids, confirm, ...(collegeId ? { collegeId } : {}) }).then((r) => r.data as { success: number; failed: number; errors: string[]; partial: boolean }),
  // Bulk password (Option A shared set/reset + §10 nudge-only). Set: sharedPassword
  // required. Reset: autoGenerate=true (sharedPassword must be absent).
  bulkPassword: (payload: { ids: string[]; mode: 'shared-set' | 'shared-reset'; sharedPassword?: string; autoGenerate?: boolean; confirm: string; nudgeUsers?: boolean; dryRun?: boolean; collegeId?: string }) =>
    api.post('/admin/users/bulk-password', payload).then((r) => r.data as {
      success: number; failed: number; skippedSelf: number; partial: boolean; errors: string[];
      nudgeEnabled: boolean; sharedTempPassword?: string; sharedPasswordEcho: false;
      sharedPassword?: { valid: boolean; errors: string[] }; validCount?: number; dryRun?: true;
    }),
  getHackathons: (collegeId?: string, signal?: AbortSignal) =>
    api.get('/admin/hackathons', { params: collegeId ? { collegeId } : {}, signal }).then((r) => r.data),
  getForms: (collegeId?: string, signal?: AbortSignal) =>
    api.get('/admin/forms', { params: collegeId ? { collegeId } : {}, signal }).then((r) => r.data),
  deleteHackathon: (id: string) => api.delete(`/admin/hackathons/${id}`).then((r) => r.data),
  deleteForm: (id: string) => api.delete(`/admin/forms/${id}`).then((r) => r.data),
  registerCollege: (data: unknown) => api.post('/admin/colleges/register', data).then((r) => r.data),
  registerCollegePublic: (data: unknown) => axios.post(`${API_URL}/colleges/register`, data).then((r) => r.data),
  approveCollege: (id: string) => api.put(`/admin/colleges/${id}/approve`).then((r) => r.data),
  rejectCollege: (id: string) => api.put(`/admin/colleges/${id}/reject`).then((r) => r.data),
  deleteCollege: (id: string) => api.delete(`/admin/colleges/${id}`).then((r) => r.data),
}

export const superAdminAPI = {
  // Union form: getDashboard({ collegeId, from, to }) [SuperAdminDashboardPage]
  // or getDashboard(signal) [RQ queryFn]. AbortSignal detected, never sent as params.
  getDashboard: (paramsOrSignal?: { collegeId?: string; from?: string; to?: string } | AbortSignal) => {
    const isSignal = typeof AbortSignal !== 'undefined' && paramsOrSignal instanceof AbortSignal
    return api
      .get('/admin/super/dashboard', isSignal ? { signal: paramsOrSignal as AbortSignal } : { params: paramsOrSignal })
      .then((r) => r.data)
  },
  getColleges: (signal?: AbortSignal) => api.get('/admin/colleges', { signal }).then((r) => r.data),
}

export const collegeAPI = {
  // Authed list (admin surfaces).
  list: () => api.get('/colleges/list').then((r) => r.data),
  publicList: () => api.get('/colleges/public').then((r) => r.data),
  register: (data: unknown) => api.post('/colleges/register', data).then((r) => r.data),
  getDepartments: (collegeId: string) => api.get(`/colleges/${collegeId}/departments`).then((r) => r.data),
  // Public (unauthenticated) list with legacy-alias fallback for rolling deploys.
  getPublicList: () =>
    axios
      .get(`${API_URL}/colleges/list`)
      .then((r) => r.data)
      .catch(async (e) => {
        if (e?.response?.status === 404) {
          return axios.get(`${API_URL}/colleges/public`).then((r) => r.data)
        }
        throw e
      }),
  getDepartmentsPublic: (collegeId: string) =>
    axios.get(`${API_URL}/colleges/${collegeId}/departments`).then((r) => r.data),
}

export const userAPI = {
  me: () => api.get('/auth/me').then((r) => r.data),
  getDashboard: (signal?: AbortSignal) => api.get('/user/dashboard', { signal }).then((r) => r.data),
  getProfile: () => api.get('/user/profile').then((r) => r.data),
  updateProfile: (data: unknown) => api.put('/user/profile', data).then((r) => r.data),
  getGrades: () => api.get('/user/grades').then((r) => r.data),
  getGradeStats: () => api.get('/user/grades/stats').then((r) => r.data),
  getIntegrations: () => api.get('/user/integrations').then((r) => r.data),
  checkUsername: (username: string) => api.get(`/user/check-username/${encodeURIComponent(username)}`).then((r) => r.data),
  setUsername: (username: string) => api.put('/user/username', { username }).then((r) => r.data),
  suggestUsername: () => api.get('/user/suggest-username').then((r) => r.data),
  // #12 self-delete (privacy.md §3): password-confirmed erasure, anonymize-not-delete.
  deleteMe: (password: string) => api.delete('/user/me', { data: { password } }).then((r) => r.data),
}

export const departmentAPI = {
  getAll: (collegeId?: string, signal?: AbortSignal) =>
    api.get('/departments', { params: collegeId ? { collegeId } : {}, signal }).then((r) => r.data),
  create: (data: unknown) => api.post('/departments', data).then((r) => r.data),
  update: (id: string, data: unknown) => api.put(`/departments/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/departments/${id}`).then((r) => r.data),
}

// #11 bulk CSV dry-run + audit log + platform KPIs + AI metering.
// Upload-audit-all: bulk writes (≤50 rows × user-create + audit) can exceed
// the 15s default — fetch (60s) on all six import entry points below.
export interface BulkDryRunRow {
  index: number
  email: string
  name: string
  valid: boolean
  errors: string[]
}

export interface BulkDryRunReport {
  dryRun: boolean
  total: number
  validCount: number
  invalidCount: number
  rows: BulkDryRunRow[]
  errors: string[]
  // P1 shared-password validation (single HIBP call, server authoritative).
  sharedPassword?: { valid: boolean; errors: string[] }
  passwordColumnIgnored?: boolean
  warnings?: string[]
}

export const bulkImportAPI = {
  dryRunTeachers: (rows: unknown[], collegeId?: string, sharedPassword?: string) =>
    api.post('/admin/users/teachers/bulk', { teachers: rows, ...(collegeId ? { collegeId } : {}), ...(sharedPassword ? { sharedPassword } : {}), dryRun: true }, { timeout: API_TIMEOUTS.fetch }).then((r) => r.data as BulkDryRunReport),
  dryRunStudents: (rows: unknown[], collegeId?: string, sharedPassword?: string) =>
    api.post('/admin/users/students/bulk', { students: rows, ...(collegeId ? { collegeId } : {}), ...(sharedPassword ? { sharedPassword } : {}), dryRun: true }, { timeout: API_TIMEOUTS.fetch }).then((r) => r.data as BulkDryRunReport),
  // #11a unified import: one path for both roles ({role} + {rows} or {csv}).
  // Dry-run (?dryRun=true) returns the per-row report with zero writes.
  dryRunImport: (role: 'STUDENT' | 'TEACHER', rows: unknown[], collegeId?: string, sharedPassword?: string) =>
    api.post('/admin/users/import', { role, rows, ...(collegeId ? { collegeId } : {}), ...(sharedPassword ? { sharedPassword } : {}), dryRun: true }, { timeout: API_TIMEOUTS.fetch }).then((r) => r.data as BulkDryRunReport & { role: string }),
  dryRunImportCsv: (role: 'STUDENT' | 'TEACHER', csv: string, collegeId?: string, sharedPassword?: string) =>
    api.post('/admin/users/import', { role, csv, ...(collegeId ? { collegeId } : {}), ...(sharedPassword ? { sharedPassword } : {}), dryRun: true }, { timeout: API_TIMEOUTS.fetch }).then((r) => r.data as BulkDryRunReport & { role: string }),
  importRows: (role: 'STUDENT' | 'TEACHER', rows: unknown[], collegeId?: string, sharedPassword?: string) =>
    api.post('/admin/users/import', { role, rows, ...(collegeId ? { collegeId } : {}), ...(sharedPassword ? { sharedPassword } : {}) }, { timeout: API_TIMEOUTS.fetch }).then((r) => r.data as { role: string; success: number; failed: number; errors: string[]; tempPasswords?: Array<{ email: string; tempPassword: string }> }),
  importCsv: (role: 'STUDENT' | 'TEACHER', csv: string, collegeId?: string, sharedPassword?: string) =>
    api.post('/admin/users/import', { role, csv, ...(collegeId ? { collegeId } : {}), ...(sharedPassword ? { sharedPassword } : {}) }, { timeout: API_TIMEOUTS.fetch }).then((r) => r.data as { role: string; success: number; failed: number; errors: string[]; tempPasswords?: Array<{ email: string; tempPassword: string }> }),
}

export interface AuditLogItem {
  id: string
  actorId: string | null
  actorEmail: string | null
  actorRole: string | null
  action: string
  entityType: string | null
  entityId: string | null
  collegeId: string | null
  metadata: string | null
  createdAt: string
}

export const auditAPI = {
  list: (params?: { collegeId?: string; action?: string; actorId?: string; search?: string; from?: string; to?: string; page?: number; limit?: number; signal?: AbortSignal }) => {
    const { signal, ...query } = (params ?? {}) as Record<string, unknown>
    return api.get('/admin/audit-logs', { params: query, signal: signal as AbortSignal | undefined }).then((r) => r.data as { data: AuditLogItem[]; pagination: { page: number; limit: number; total: number; pages: number } })
  },
}

export interface PlatformKpis {
  range: { collegeId: string | null; from: string; to: string }
  dau: { day: string; count: number }[]
  // #11b additive (optional so cached/older payloads stay type-safe):
  // wau = trailing-7d active users/day, fetches = fetched items/day.
  wau?: { day: string; count: number }[]
  fetches?: { day: string; count: number }[]
  fetchSources?: { contests: number; hackathons: number; internships: number }
  registrations: { day: string; count: number }[]
  syncs: { day: string; count: number }[]
  ai: { day: string; tokens: number; requests: number; costCents: number }[]
  totals: { dau: number; registrations: number; syncs: number; aiTokens: number; aiRequests: number; aiCostCents: number; wau?: number; fetches?: number }
}

export const platformKpisAPI = {
  get: (params?: { collegeId?: string; from?: string; to?: string; signal?: AbortSignal }) => {
    const { signal, ...query } = (params ?? {}) as Record<string, unknown>
    return api.get('/admin/super/platform-kpis', { params: query, signal: signal as AbortSignal | undefined }).then((r) => r.data as PlatformKpis)
  },
}

export interface AiUsageRow {
  collegeId: string
  feature: string
  day: string
  requests: number
  tokens: number
  costCents: number
}

export interface AiQuota {
  collegeId: string
  dailyTokenCap: number
  monthlyTokenCap: number | null
  totalCostCapCents: number | null
  enabled: boolean
}

export const aiManagerAPI = {
  getUsage: (params?: { collegeId?: string; from?: string; to?: string; feature?: string; signal?: AbortSignal }) => {
    const { signal, ...query } = (params ?? {}) as Record<string, unknown>
    return api.get('/ai-manager/usage', { params: query, signal: signal as AbortSignal | undefined }).then((r) => r.data as { usage: AiUsageRow[]; totals: { requests: number; tokens: number; costCents: number } })
  },
  getQuota: (collegeId: string, signal?: AbortSignal) =>
    api.get(`/ai-manager/quota/${collegeId}`, { signal }).then((r) => r.data as { quota: AiQuota }),
  updateQuota: (collegeId: string, data: Partial<Pick<AiQuota, 'dailyTokenCap' | 'monthlyTokenCap' | 'totalCostCapCents' | 'enabled'>>) =>
    api.put(`/ai-manager/quota/${collegeId}`, data).then((r) => r.data as { quota: AiQuota }),
}
