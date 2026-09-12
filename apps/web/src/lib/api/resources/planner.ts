// lib/api/resources/planner.ts - tasks/schedules/timetable/forms/announcements (SRP extract).
// WHY: personal-planner + forms + announcements flows, one home.
// Moved verbatim from lib/api.ts; AbortSignal threading preserved.
import { api } from '../client'

// Schedules
export const scheduleAPI = {
  getAll: () => api.get('/schedules').then((r) => r.data),
  getByDay: (day: number) => api.get(`/schedules/day/${day}`).then((r) => r.data),
  create: (data: any) => api.post('/schedules', data).then((r) => r.data),
  update: (id: string, data: any) => api.put(`/schedules/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/schedules/${id}`).then((r) => r.data),
}

// Tasks (Personal Planner) — signal makes rapid tab switches cancellable.
export const taskAPI = {
  getAll: (params?: { date?: string; category?: string; status?: string; signal?: AbortSignal }) => {
    const { signal, ...query } = (params as any) || {}
    return api.get('/tasks', { params: query, signal }).then((r) => r.data)
  },
  getRange: (start: string, end: string, signal?: AbortSignal) =>
    api.get('/tasks/range', { params: { start, end }, signal }).then((r) => r.data),
  getToday: (signal?: AbortSignal) => api.get('/tasks/today', { signal }).then((r) => r.data),
  create: (data: any) => api.post('/tasks', data).then((r) => r.data),
  update: (id: string, data: any) => api.put(`/tasks/${id}`, data).then((r) => r.data),
  toggle: (id: string) => api.put(`/tasks/${id}/toggle`).then((r) => r.data),
  delete: (id: string) => api.delete(`/tasks/${id}`).then((r) => r.data),
  aiSchedule: (tasks: string[], date: string) =>
    api.post('/tasks/ai-schedule', { tasks, date }).then((r) => r.data),
  dailySummary: () => api.get('/tasks/daily-summary').then((r) => r.data),
}

// Timetable
export const timetableAPI = {
  getAll: (opts?: { signal?: AbortSignal }) => api.get('/timetable', { signal: opts?.signal }).then((r) => r.data),
  getToday: (signal?: AbortSignal) => api.get('/timetable/today', { signal }).then((r) => r.data),
  uploadImage: (file: File, provider?: { baseUrl?: string; apiKey?: string; model?: string }) => {
    const formData = new FormData()
    formData.append('timetable', file)
    if (provider) formData.append('provider', JSON.stringify(provider))
    return api.post('/timetable/upload', formData, { headers: { 'Content-Type': undefined } as any }).then((r) => r.data)
  },
  parseText: (text: string) => api.post('/timetable/parse-text', { text }).then((r) => r.data),
  save: (classes: any[], clearExisting?: boolean) => api.post('/timetable/save', { classes, clearExisting }).then((r) => r.data),
  clear: () => api.delete('/timetable/clear').then((r) => r.data),
}

// Forms
export const formAPI = {
  getAll: (params?: { page?: number; limit?: number; search?: string; signal?: AbortSignal }) => {
    const { signal, ...query } = (params as any) || {}
    const effective: any = { limit: 50, ...(query || {}) }
    return api.get('/forms', { params: effective, signal }).then((r) => {
      const b = r.data
      if (Array.isArray(b)) return b
      if (b?.data) return b.data
      return b
    })
  },
  getPaged: (page = 1, limit = 20, search?: string, signal?: AbortSignal) =>
    api.get('/forms', { params: { page, limit, ...(search ? { search } : {}) }, signal }).then((r) => {
      const b = r.data
      if (Array.isArray(b)) return { data: b, pagination: { page: 1, limit: b.length, total: b.length, pages: 1 } }
      return b
    }),
  getOne: (id: string) => api.get(`/forms/${id}`).then((r) => r.data),
  create: (data: any) => api.post('/forms', data).then((r) => r.data),
  delete: (id: string) => api.delete(`/forms/${id}`).then((r) => r.data),
  // #9 logic-lite: extra carries startedAt/durationMs/viewedFieldIds for
  // drop-off + time-to-complete analytics. Backward compat: respond(id, answers).
  respond: (id: string, answers: any, extra?: { startedAt?: string | null; durationMs?: number | null; viewedFieldIds?: string[] }) =>
    api.post(`/forms/${id}/respond`, { answers, ...(extra?.startedAt ? { startedAt: extra.startedAt } : {}), ...(typeof extra?.durationMs === 'number' ? { durationMs: extra.durationMs } : {}), ...(extra?.viewedFieldIds ? { viewedFieldIds: extra.viewedFieldIds } : {}) }).then((r) => r.data),
  exportOne: async (id: string, filename?: string) => {
    const res = await api.get(`/forms/${id}/export`, { responseType: 'blob' })
    const url = window.URL.createObjectURL(new Blob([res.data]))
    const a = document.createElement('a')
    a.href = url
    a.download = filename || `Form_${id}.xlsx`
    a.click()
    window.URL.revokeObjectURL(url)
  },
  extend: (id: string, expiresAt: string) => api.post(`/forms/${id}/extend`, { expiresAt }).then((r) => r.data),
  update: (id: string, data: any) => api.put(`/forms/${id}`, data).then((r) => r.data),
  updateFields: (id: string, fields: any[]) => api.put(`/forms/${id}/fields`, { fields }).then((r) => r.data),
  stats: (id: string) => api.get(`/forms/${id}/stats`).then((r) => r.data),
  getPending: (id: string) => api.get(`/forms/${id}/pending`).then((r) => r.data),
  // #9 logic-lite analytics: drop-off per question + median time + score stats.
  analytics: (id: string) => api.get(`/forms/${id}/analytics`).then((r) => r.data),
  // #9 best-effort view logging for drop-off (fire-and-forget; never throws to caller).
  logViews: (id: string, fieldIds: string[]) => {
    if (!fieldIds || fieldIds.length === 0) return Promise.resolve({ logged: 0 })
    return api.post(`/forms/${id}/view`, { fieldIds }).then((r) => r.data).catch(() => ({ logged: 0 }))
  },
}

// Announcements
export const announcementsAPI = {
  list: (page = 1, limit = 10, collegeId?: string, signal?: AbortSignal) =>
    api.get('/announcements', { params: { page, limit, ...(collegeId ? { collegeId } : {}) }, signal }).then((r) => r.data),
  create: (data: { title: string; content: string; target: string; departmentIds?: string[]; targetScope?: string; collegeIds?: string[]; publishAt?: string; expiresAt?: string }) =>
    api.post('/announcements', data).then((r) => r.data),
  update: (id: string, data: { title?: string; content?: string; target?: string; departmentIds?: string[]; targetScope?: string; collegeIds?: string[]; publishAt?: string; expiresAt?: string }) =>
    api.put(`/announcements/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/announcements/${id}`).then((r) => r.data),
  listColleges: () => api.get('/announcements/colleges').then((r) => r.data),
  markRead: (id: string) => api.post(`/announcements/${id}/read`).then((r) => r.data),
  markAllRead: (collegeId?: string) => api.post('/announcements/read-all', {}, { params: collegeId ? { collegeId } : {} }).then((r) => r.data),
}
