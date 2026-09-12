// lib/api/resources/opportunities.ts — hackathons/internships/contests (SRP extract).
// WHY: lib/api.ts forced limit:50/100 overrides per resource with "prevents
// hiding X" comments (M-3 drift). One DEFAULT_LIST_LIMIT + per-resource MAX,
// documented here; frontend passes explicit limit instead of silent override.
// All queryFns thread AbortSignal (state-sync contract). Behavior identical.

import { api, API_TIMEOUTS } from '../client'

export const DEFAULT_LIST_LIMIT = 20
export const MAX_LIST_LIMIT = {
  hackathons: 50,
  internships: 50,
  contests: 100,
  rooms: 50,
  forms: 50,
} as const

function clampLimit(n: number | undefined, max: number): number {
  if (!n || !Number.isFinite(n) || n < 1) return DEFAULT_LIST_LIMIT
  return Math.min(Math.floor(n), max)
}

function unwrapList(b: unknown): unknown {
  if (Array.isArray(b)) return b
  const obj = b as { data?: unknown }
  if (obj?.data) return obj.data
  return b
}

export const hackathonAPI = {
  getAll: (params?: { page?: number; limit?: number; search?: string; status?: string; mine?: boolean; signal?: AbortSignal }) => {
    const { signal, ...query } = (params ?? {}) as Record<string, unknown>
    // Explicit default (was silent `{ limit: 50, ...query }`): no-limit callers get
    // MAX (50) — behavior identical — but caller limits are now clamped to MAX
    // (previously unbounded, e.g. limit:100000). Paged callers prefer getPaged().
    // ?mine=true filters to own registrations only (register leftovers #5).
    const requested = query.limit as number | undefined
    const effective = { ...query, limit: clampLimit(requested ?? MAX_LIST_LIMIT.hackathons, MAX_LIST_LIMIT.hackathons) } as Record<string, unknown>
    if (effective.mine === false || effective.mine === undefined) delete effective.mine
    else effective.mine = true
    return api.get('/hackathons', { params: effective, signal: signal as AbortSignal | undefined }).then((r) => unwrapList(r.data))
  },
  getPaged: (page = 1, limit = DEFAULT_LIST_LIMIT, search?: string, signal?: AbortSignal, mine?: boolean) =>
    api.get('/hackathons', { params: { page, limit: clampLimit(limit, MAX_LIST_LIMIT.hackathons), ...(search ? { search } : {}), ...(mine ? { mine: true } : {}) }, signal }).then((r) => {
      const b = r.data
      if (Array.isArray(b)) return { data: b, pagination: { page: 1, limit: b.length, total: b.length, pages: 1 } }
      return b
    }),
  getOne: (id: string) => api.get(`/hackathons/${id}`).then((r) => r.data),
  create: (data: unknown) => api.post('/hackathons', data).then((r) => r.data),
  delete: (id: string) => api.delete(`/hackathons/${id}`).then((r) => r.data),
  // WHY: backend toFetchDetailsEnvelope returns {...fields, details} — canonical
  // is wrapped r.data.details, fallback r.data keeps old direct clients working.
  fetchDetails: (url: string) => api.post('/hackathons/fetch-details', { url }).then((r) => r.data.details ?? r.data),
  register: (id: string, data: unknown) => api.post(`/hackathons/${id}/register`, data).then((r) => r.data),
  unregister: (id: string) => api.delete(`/hackathons/${id}/register`).then((r) => r.data),
  remind: (id: string, message: string) => api.post(`/hackathons/${id}/remind`, { message }).then((r) => r.data),
  updateRound: (id: string, regId: string, data: unknown) => api.put(`/hackathons/${id}/registrations/${regId}/round`, data).then((r) => r.data),
  submitResult: (id: string, regId: string, data: unknown) => api.put(`/hackathons/${id}/registrations/${regId}/result`, data).then((r) => r.data),
  addRound: (id: string, data: unknown) => api.post(`/hackathons/${id}/rounds`, data).then((r) => r.data),
  updateRoundDetails: (hackathonId: string, roundId: string, data: unknown) =>
    api.put(`/hackathons/${hackathonId}/rounds/${roundId}`, data).then((r) => r.data),
  deleteRound: (hackathonId: string, roundId: string) =>
    api.delete(`/hackathons/${hackathonId}/rounds/${roundId}`).then((r) => r.data),
  updateRegistrationStatus: (hackathonId: string, regId: string, data: unknown) =>
    api.put(`/hackathons/${hackathonId}/registrations/${regId}/status`, data).then((r) => r.data),
  exportOne: async (id: string, filename?: string) => {
    const res = await api.get(`/hackathons/${id}/export`, { responseType: 'blob' })
    const url = window.URL.createObjectURL(new Blob([res.data]))
    const a = document.createElement('a')
    a.href = url
    a.download = filename || `Hackathon_${id}.xlsx`
    a.click()
    window.URL.revokeObjectURL(url)
  },
  exportAll: async () => {
    const res = await api.get('/hackathons/export/all', { responseType: 'blob' })
    const url = window.URL.createObjectURL(new Blob([res.data]))
    const a = document.createElement('a')
    a.href = url
    a.download = 'All_Hackathons.xlsx'
    a.click()
    window.URL.revokeObjectURL(url)
  },
  getStaging: (page = 1, limit = DEFAULT_LIST_LIMIT, status?: string, signal?: AbortSignal, cursor?: string) =>
    api.get('/hackathons/staging', { params: { page, limit: clampLimit(limit, MAX_LIST_LIMIT.hackathons), status, cursor }, signal }).then((r) => r.data),
  getStagingOne: (id: string) => api.get(`/hackathons/staging/${id}`).then((r) => r.data),
  updateStaging: (id: string, data: unknown) => api.put(`/hackathons/staging/${id}`, data).then((r) => r.data),
  deleteStaging: (id: string) => api.delete(`/hackathons/staging/${id}`).then((r) => r.data),
  approveStaging: (id: string) => api.post(`/hackathons/staging/${id}/approve`).then((r) => r.data),
  rejectStaging: (id: string) => api.post(`/hackathons/staging/${id}/reject`).then((r) => r.data),
  fetchExternal: () => api.post('/hackathons/fetch-external', {}, { timeout: API_TIMEOUTS.fetch }).then((r) => r.data),
  reEnrich: () => api.post('/hackathons/staging/re-enrich', {}, { timeout: API_TIMEOUTS.fetch }).then((r) => r.data),
  getCounts: (signal?: AbortSignal) => api.get('/hackathons/staging/counts', { signal }).then((r) => r.data),
}

export const internshipAPI = {
  getAll: (params?: { page?: number; limit?: number; search?: string; mine?: boolean; signal?: AbortSignal }) => {
    const { signal, ...query } = (params ?? {}) as Record<string, unknown>
    const requested = query.limit as number | undefined
    const effective = { ...query, limit: clampLimit(requested ?? MAX_LIST_LIMIT.internships, MAX_LIST_LIMIT.internships) } as Record<string, unknown>
    if (effective.mine === false || effective.mine === undefined) delete effective.mine
    else effective.mine = true
    return api.get('/internships', { params: effective, signal: signal as AbortSignal | undefined }).then((r) => unwrapList(r.data))
  },
  getPaged: (page = 1, limit = DEFAULT_LIST_LIMIT, search?: string, signal?: AbortSignal, mine?: boolean) =>
    api.get('/internships', { params: { page, limit: clampLimit(limit, MAX_LIST_LIMIT.internships), ...(search ? { search } : {}), ...(mine ? { mine: true } : {}) }, signal }).then((r) => {
      const b = r.data
      if (Array.isArray(b)) return { data: b, pagination: { page: 1, limit: b.length, total: b.length, pages: 1 } }
      return b
    }),
  getOne: (id: string) => api.get(`/internships/${id}`).then((r) => r.data),
  create: (data: unknown) => api.post('/internships', data).then((r) => r.data),
  delete: (id: string) => api.delete(`/internships/${id}`).then((r) => r.data),
  register: (id: string) => api.post(`/internships/${id}/register`).then((r) => r.data),
  unregister: (id: string) => api.delete(`/internships/${id}/register`).then((r) => r.data),
  remind: (id: string, message: string) => api.post(`/internships/${id}/remind`, { message }).then((r) => r.data),
  report: (id: string, status: string) => api.put(`/internships/${id}/report`, { status }).then((r) => r.data),
  getRegistrations: (id: string) => api.get(`/internships/${id}/registrations`).then((r) => r.data),
  updateRegistration: (id: string, regId: string, status: string) =>
    api.put(`/internships/${id}/registrations/${regId}`, { status }).then((r) => r.data),
  exportOne: async (id: string) => {
    const response = await api.get(`/internships/export/${id}`, { responseType: 'blob' })
    return response.data
  },
  exportAll: async () => {
    const response = await api.get('/internships/export-all', { responseType: 'blob' })
    return response.data
  },
  fetchDetails: (url: string) => api.post('/internships/fetch-details', { url }).then((r) => r.data.details),
  getStaging: (page = 1, limit = DEFAULT_LIST_LIMIT, status?: string, signal?: AbortSignal) =>
    api.get('/internships/staging', { params: { page, limit: clampLimit(limit, MAX_LIST_LIMIT.internships), status }, signal }).then((r) => r.data),
  getStagingOne: (id: string) => api.get(`/internships/staging/${id}`).then((r) => r.data),
  updateStaging: (id: string, data: unknown) => api.put(`/internships/staging/${id}`, data).then((r) => r.data),
  deleteStaging: (id: string) => api.delete(`/internships/staging/${id}`).then((r) => r.data),
  approveStaging: (id: string) => api.post(`/internships/staging/${id}/approve`).then((r) => r.data),
  rejectStaging: (id: string) => api.post(`/internships/staging/${id}/reject`).then((r) => r.data),
  fetchExternal: () => api.post('/internships/fetch-external', {}, { timeout: API_TIMEOUTS.fetch }).then((r) => r.data),
  reEnrich: () => api.post('/internships/staging/re-enrich', {}, { timeout: API_TIMEOUTS.fetch }).then((r) => r.data),
  getCounts: (signal?: AbortSignal) => api.get('/internships/staging/counts', { signal }).then((r) => r.data),
}

export const codingContestAPI = {
  getAll: (params?: { platform?: string; status?: string; startDate?: string; endDate?: string; page?: number; limit?: number; search?: string; signal?: AbortSignal }) => {
    const { signal, ...query } = (params ?? {}) as Record<string, unknown>
    const requested = query.limit as number | undefined
    return api.get('/contests', { params: { ...query, limit: clampLimit(requested ?? MAX_LIST_LIMIT.contests, MAX_LIST_LIMIT.contests) }, signal: signal as AbortSignal | undefined }).then((r) => unwrapList(r.data))
  },
  getPaged: (page = 1, limit = 50, extra?: { platform?: string; status?: string; search?: string }, signal?: AbortSignal) =>
    api.get('/contests', { params: { page, limit, ...extra }, signal }).then((r) => {
      const b = r.data
      if (Array.isArray(b)) return { data: b, pagination: { page: 1, limit: b.length, total: b.length, pages: 1 } }
      return b
    }),
  getByDate: (date: string) => api.get(`/contests/by-date/${date}`).then((r) => r.data),
  getCalendar: (start: string, end: string) =>
    api.get('/contests/calendar', { params: { start, end } }).then((r) => r.data),
  create: (data: unknown) => api.post('/contests', data).then((r) => r.data),
  delete: (id: string) => api.delete(`/contests/${id}`).then((r) => r.data),
  updateSolutions: (id: string, solutions: unknown[]) =>
    api.put(`/contests/${id}/solutions`, { solutions }).then((r) => r.data),
  addSolution: (id: string, data: { problemName: string; solutionUrl: string; language?: string }) =>
    api.post(`/contests/${id}/solutions`, data).then((r) => r.data),
  removeSolution: (id: string, solutionIndex: number) =>
    api.delete(`/contests/${id}/solutions/${solutionIndex}`).then((r) => r.data),
  getParticipantCounts: () =>
    api.get('/contests/participant-counts').then((r) => r.data),
  fetchNow: () => api.post('/contests/fetch-now').then((r) => r.data),
  // #6 contest alarms: per-user remind-me (minutesBefore ∈ 15|60|1440).
  remind: (id: string, minutesBefore: 15 | 60 | 1440) =>
    api.post(`/contests/${id}/remind`, { minutesBefore }).then((r) => r.data),
  getReminders: () => api.get('/contests/reminders/mine').then((r) => r.data),
  deleteReminder: (reminderId: string) =>
    api.delete(`/contests/reminders/${reminderId}`).then((r) => r.data),
}
