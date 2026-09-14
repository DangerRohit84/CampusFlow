// lib/api/resources/assignments.ts - assignments/grades/attendance (SRP extract).
// WHY: assignment-hub + grades + attendance flows, one home.
// Moved verbatim from lib/api.ts; AbortSignal threading preserved.
import { api, API_TIMEOUTS } from '../client'

// Assignments
export const assignmentAPI = {
  getAll: (status?: string) => api.get('/assignments', { params: { status } }).then((r) => r.data),
  getUpcoming: () => api.get('/assignments/upcoming').then((r) => r.data),
  create: (data: any) => api.post('/assignments', data).then((r) => r.data),
  update: (id: string, data: any) => api.put(`/assignments/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/assignments/${id}`).then((r) => r.data),
}

export const assignmentHubAPI = {
  getHubs: (params?: { page?: number; limit?: number; search?: string; scope?: string; submissionMode?: string; collegeId?: string; status?: string; signal?: AbortSignal }) => {
    const { signal, ...query } = params || {}
    return api.get('/assignments/hub', { params: query, signal }).then(r => {
      const b = r.data
      if (Array.isArray(b)) return { data: b, pagination: { page: 1, limit: b.length, total: b.length, pages: 1 } }
      return b
    })
  },
  getHub: (id: string) => api.get(`/assignments/hub/${id}`).then(r => r.data),
  create: (data: any) => {
    const hasFile = data instanceof FormData
    // Do NOT force Content-Type - let browser/axios set boundary. Override default application/json.
    // Upload-audit-all: multipart (≤5×10MB) needs fetch (60s), not the 15s
    // default — same abort-after-success class of bug as timetable vision.
    return api.post('/assignments/hub', data, hasFile ? { headers: { 'Content-Type': undefined } as any, timeout: API_TIMEOUTS.fetch } : {}).then(r => r.data)
  },
  update: (id: string, data: any) => {
    const hasFile = data instanceof FormData
    // QA compat: return api.put(`/assignments/hub/${id}`, data, hasFile ? { headers: { 'Content-Type': 'multipart/form-data' } }
    // Upload-audit-all: multipart needs fetch (60s) — see create above.
    return api.put(`/assignments/hub/${id}`, data, hasFile ? { headers: { 'Content-Type': undefined } as any, timeout: API_TIMEOUTS.fetch } : {}).then(r => r.data)
  },
  delete: (id: string) => api.delete(`/assignments/hub/${id}`).then(r => r.data),
  submit: (hubId: string, payload: { content?: string; file?: File; files?: File[] }) => {
    const fd = new FormData()
    if (payload.content) fd.append('content', payload.content)
    const allFiles: File[] = []
    if (payload.files?.length) allFiles.push(...payload.files)
    if (payload.file) allFiles.push(payload.file)
    // Dedupe by reference
    const uniq = Array.from(new Set(allFiles))
    uniq.slice(0, 5).forEach(f => fd.append('files', f))
    // Fallback keep single file field for legacy if needed (already appended as files)
    // Upload-audit-all: multipart submission (≤5 files, 10MB each, Cloudinary
    // persist) needs fetch (60s), not the 15s default.
    return api.post(`/assignments/hub/${hubId}/submissions`, fd, { headers: { 'Content-Type': undefined } as any, timeout: API_TIMEOUTS.fetch }).then(r => r.data)
  },
  listSubmissions: (hubId: string, params?: { page?: number; limit?: number }) =>
    api.get(`/assignments/hub/${hubId}/submissions`, { params }).then(r => r.data),
  grade: (submissionId: string, data: { grade?: string; points?: number; feedback?: string }) =>
    api.put(`/assignments/submissions/${submissionId}/grade`, data).then(r => r.data),
  mySubmissions: () => api.get('/assignments/my-submissions').then(r => r.data),
  stats: (hubId: string) => api.get(`/assignments/hub/${hubId}/stats`).then(r => r.data),
  offlineSubmit: (hubId: string, data: { studentId: string; offlineNote?: string; content?: string; points?: number; grade?: string; feedback?: string }) =>
    api.post(`/assignments/hub/${hubId}/submissions/offline`, data).then(r => r.data),
  bulkGrade: (hubId: string, data: { grades: Array<{ studentId: string; points?: number; grade?: string; feedback?: string; offlineNote?: string; content?: string }> }) =>
    api.post(`/assignments/hub/${hubId}/submissions/bulk-grade`, data).then(r => r.data),
  getPending: (hubId: string) => api.get(`/assignments/hub/${hubId}/pending`).then(r => r.data),
}

// Grades
// Upload-audit-all: vision parse hits AI (backend 4k-token budget) — fetch
// (60s), not the 15s default (same abort-after-success bug as timetable).
// normalizeGradeSubjects is the tolerant reader (SSOT with GradesPage):
// backend already normalizes, but legacy/cached payloads drift
// (title/courseCode/score keys, bare array) — never throw, [] on unknown.
export function normalizeGradeSubjects(result: unknown): any[] {
  const arr = Array.isArray(result)
    ? result
    : result && typeof result === 'object'
      ? ((result as Record<string, unknown>).subjects ?? (result as Record<string, unknown>).data ?? (result as Record<string, unknown>).courses ?? [])
      : []
  if (!Array.isArray(arr)) return []
  return arr
    .filter((s) => s && typeof s === 'object')
    .map((s: any) => ({
      name: String(s.name ?? s.title ?? s.course ?? s.subject ?? '').trim(),
      code: String(s.code ?? s.courseCode ?? '').trim(),
      credits: Number.isFinite(Number(s.credits ?? s.credit)) ? Math.floor(Number(s.credits ?? s.credit)) : 0,
      grade: String(s.grade ?? s.score ?? s.mark ?? '').trim(),
    }))
    .filter((s) => s.name.length > 0)
}

export const gradesAPI = {
  getData: () => api.get('/grades/data').then((r) => r.data),
  saveData: (subjects: any[], scale: string) => api.post('/grades/data', { subjects, scale }).then((r) => r.data),
  deleteData: () => api.delete('/grades/data').then((r) => r.data),
  parse: (imageBase64: string) => api.post('/grades/parse', { image: imageBase64 }, { timeout: API_TIMEOUTS.fetch }).then((r) => r.data),
}

// Attendance
// Upload-audit-all: same vision-timeout + tolerant-reader treatment as grades.
export function normalizeAttendanceSubjects(result: unknown): any[] {
  const arr = Array.isArray(result)
    ? result
    : result && typeof result === 'object'
      ? ((result as Record<string, unknown>).subjects ?? (result as Record<string, unknown>).data ?? [])
      : []
  if (!Array.isArray(arr)) return []
  const toCount = (v: unknown): number => {
    const n = typeof v === 'number' ? v : parseInt(String(v ?? '').trim(), 10)
    return Number.isFinite(n) && (n as number) >= 0 ? Math.floor(n as number) : 0
  }
  return arr
    .filter((s) => s && typeof s === 'object')
    .map((s: any) => ({
      name: String(s.name ?? s.subject ?? s.course ?? s.title ?? '').trim(),
      held: toCount(s.held ?? s.total ?? s.classes),
      attended: toCount(s.attended ?? s.present ?? s.attend),
    }))
    .filter((s) => s.name.length > 0)
}

export const attendanceAPI = {
  getData: () =>
    api.get('/attendance/data').then((r) => r.data),
  saveData: (subjects: any[], requiredPct: number) =>
    api.post('/attendance/data', { subjects, requiredPct }).then((r) => r.data),
  deleteData: () =>
    api.delete('/attendance/data').then((r) => r.data),
  parse: (image: string) =>
    api.post('/attendance/parse', { image }, { timeout: API_TIMEOUTS.fetch }).then((r) => r.data),
}
