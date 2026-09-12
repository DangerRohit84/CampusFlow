// lib/api/resources/assignments.ts - assignments/grades/attendance (SRP extract).
// WHY: assignment-hub + grades + attendance flows, one home.
// Moved verbatim from lib/api.ts; AbortSignal threading preserved.
import { api } from '../client'

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
    return api.post('/assignments/hub', data, hasFile ? { headers: { 'Content-Type': undefined } as any } : {}).then(r => r.data)
  },
  update: (id: string, data: any) => {
    const hasFile = data instanceof FormData
    // QA compat: return api.put(`/assignments/hub/${id}`, data, hasFile ? { headers: { 'Content-Type': 'multipart/form-data' } }
    return api.put(`/assignments/hub/${id}`, data, hasFile ? { headers: { 'Content-Type': undefined } as any } : {}).then(r => r.data)
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
    return api.post(`/assignments/hub/${hubId}/submissions`, fd, { headers: { 'Content-Type': undefined } as any }).then(r => r.data)
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
export const gradesAPI = {
  getData: () => api.get('/grades/data').then((r) => r.data),
  saveData: (subjects: any[], scale: string) => api.post('/grades/data', { subjects, scale }).then((r) => r.data),
  deleteData: () => api.delete('/grades/data').then((r) => r.data),
  parse: (imageBase64: string) => api.post('/grades/parse', { image: imageBase64 }).then((r) => r.data),
}

// Attendance
export const attendanceAPI = {
  getData: () =>
    api.get('/attendance/data').then((r) => r.data),
  saveData: (subjects: any[], requiredPct: number) =>
    api.post('/attendance/data', { subjects, requiredPct }).then((r) => r.data),
  deleteData: () =>
    api.delete('/attendance/data').then((r) => r.data),
  parse: (image: string) =>
    api.post('/attendance/parse', { image }).then((r) => r.data),
}
