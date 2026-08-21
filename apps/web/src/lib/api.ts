import axios from 'axios'
import { io, Socket } from 'socket.io-client'
import type { Department } from '../types/api'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000'
const API_URL = `${API_BASE}/api`
const WS_URL = API_BASE

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const stored = localStorage.getItem('campusflow-auth')
  if (stored) {
    try {
      const { state } = JSON.parse(stored)
      if (state?.token) {
        config.headers.Authorization = `Bearer ${state.token}`
      }
    } catch {}
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('campusflow-auth')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// WebSocket
let socket: Socket | null = null

export function connectSocket(userId: string): Socket {
  if (socket?.connected) return socket

  socket = io(WS_URL, { transports: ['websocket', 'polling'] })
  socket.on('connect', () => {
    socket?.emit('auth:join', userId)
    console.log('WebSocket connected')
  })
  socket.on('disconnect', () => console.log('WebSocket disconnected'))
  return socket
}

export function disconnectSocket() {
  socket?.disconnect()
  socket = null
}

export function onNotification(callback: (notification: any) => void) {
  socket?.on('notification:new', callback)
  return () => socket?.off('notification:new', callback)
}

export function onScheduleUpdate(callback: (schedule: any) => void) {
  socket?.on('schedule:update', callback)
  return () => socket?.off('schedule:update', callback)
}

// Auth
export const authAPI = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }).then((r) => r.data),
  register: (data: { email: string; name: string; password: string; departmentId?: string; department?: string; role?: string; collegeId?: string; college?: string; empNumber?: string; studentId?: string; incomingYear?: number }) =>
    api.post('/auth/register', data).then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
}

// Dashboard
export const dashboardAPI = {
  get: () => api.get('/user/dashboard').then((r) => r.data),
}

// Schedules
export const scheduleAPI = {
  getAll: () => api.get('/schedules').then((r) => r.data),
  getByDay: (day: number) => api.get(`/schedules/day/${day}`).then((r) => r.data),
  create: (data: any) => api.post('/schedules', data).then((r) => r.data),
  update: (id: string, data: any) => api.put(`/schedules/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/schedules/${id}`).then((r) => r.data),
}

// Assignments
export const assignmentAPI = {
  getAll: (status?: string) => api.get('/assignments', { params: { status } }).then((r) => r.data),
  getUpcoming: () => api.get('/assignments/upcoming').then((r) => r.data),
  create: (data: any) => api.post('/assignments', data).then((r) => r.data),
  update: (id: string, data: any) => api.put(`/assignments/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/assignments/${id}`).then((r) => r.data),
}

// Notifications (unified via room notifications)
export const notificationAPI = {
  getAll: (unread?: boolean) => api.get('/rooms/notifications/list').then((r) => r.data),
  getUnreadCount: () => api.get('/rooms/notifications/list').then((r) => r.data.filter((n: any) => !n.isRead).length),
  markRead: (id: string) => api.post(`/rooms/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () => api.put('/rooms/notifications/read-all').then((r) => r.data),
  delete: (id: string) => api.delete(`/rooms/notifications/${id}`).then((r) => r.data),
}

// Chat
export const chatAPI = {
  getSessions: () => api.get('/chat/sessions').then((r) => r.data),
  createSession: () => api.post('/chat/sessions').then((r) => r.data),
  getMessages: (sessionId: string) => api.get(`/chat/sessions/${sessionId}/messages`).then((r) => r.data),
  sendMessage: (sessionId: string, content: string, provider?: { baseUrl?: string; apiKey?: string; model?: string }) =>
    api.post(`/chat/sessions/${sessionId}/messages`, { content, provider }).then((r) => r.data),
  ask: (content: string, provider?: { baseUrl?: string; apiKey?: string; model?: string }) =>
    api.post('/chat/ask', { content, provider }).then((r) => r.data),
  summarize: (content: string, provider?: { baseUrl?: string; apiKey?: string; model?: string }) =>
    api.post('/chat/summarize', { content, provider }).then((r) => r.data),
}

// AI
export const aiAPI = {
  summarize: (content: string, type?: string) =>
    api.post('/ai/summarize', { content, type }).then((r) => r.data),
  studyPlan: (subjects: string[], daysLeft: number, hoursPerDay: number) =>
    api.post('/ai/study-plan', { subjects, daysLeft, hoursPerDay }).then((r) => r.data),
  checkConflicts: (dayOfWeek: number, startTime: string, endTime: string, excludeId?: string) =>
    api.post('/ai/check-conflicts', { dayOfWeek, startTime, endTime, excludeId }).then((r) => r.data),
  getInsights: () => api.get('/ai/insights').then((r) => r.data),
}

// Search
export const searchAPI = {
  search: (q: string) => api.get('/search', { params: { q } }).then((r) => r.data),
}

// Tasks (Personal Planner)
export const taskAPI = {
  getAll: (params?: { date?: string; category?: string; status?: string }) =>
    api.get('/tasks', { params }).then((r) => r.data),
  getRange: (start: string, end: string) =>
    api.get('/tasks/range', { params: { start, end } }).then((r) => r.data),
  getToday: () => api.get('/tasks/today').then((r) => r.data),
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
  getAll: () => api.get('/timetable').then((r) => r.data),
  getToday: () => api.get('/timetable/today').then((r) => r.data),
  uploadImage: (file: File, provider?: { baseUrl?: string; apiKey?: string; model?: string }) => {
    const formData = new FormData()
    formData.append('timetable', file)
    if (provider) formData.append('provider', JSON.stringify(provider))
    return api.post('/timetable/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data)
  },
  parseText: (text: string) => api.post('/timetable/parse-text', { text }).then((r) => r.data),
  save: (classes: any[], clearExisting?: boolean) => api.post('/timetable/save', { classes, clearExisting }).then((r) => r.data),
  clear: () => api.delete('/timetable/clear').then((r) => r.data),
}

// Hackathons
export const hackathonAPI = {
  getAll: () => api.get('/hackathons').then((r) => r.data),
  getOne: (id: string) => api.get(`/hackathons/${id}`).then((r) => r.data),
  create: (data: any) => api.post('/hackathons', data).then((r) => r.data),
  delete: (id: string) => api.delete(`/hackathons/${id}`).then((r) => r.data),
  fetchDetails: (url: string) => api.post('/hackathons/fetch-details', { url }).then((r) => r.data),
  register: (id: string, data: any) => api.post(`/hackathons/${id}/register`, data).then((r) => r.data),
  updateRound: (id: string, regId: string, data: any) => api.put(`/hackathons/${id}/registrations/${regId}/round`, data).then((r) => r.data),
  submitResult: (id: string, regId: string, data: any) => api.put(`/hackathons/${id}/registrations/${regId}/result`, data).then((r) => r.data),
  addRound: (id: string, data: any) => api.post(`/hackathons/${id}/rounds`, data).then((r) => r.data),
  updateRoundDetails: (hackathonId: string, roundId: string, data: any) =>
    api.put(`/hackathons/${hackathonId}/rounds/${roundId}`, data).then((r) => r.data),
  deleteRound: (hackathonId: string, roundId: string) =>
    api.delete(`/hackathons/${hackathonId}/rounds/${roundId}`).then((r) => r.data),
  updateRegistrationStatus: (hackathonId: string, regId: string, data: any) =>
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
  // Staging methods
  getStaging: (page = 1, limit = 20, status?: string) => api.get('/hackathons/staging', { params: { page, limit, status } }).then((r) => r.data),
  getStagingOne: (id: string) => api.get(`/hackathons/staging/${id}`).then((r) => r.data),
  updateStaging: (id: string, data: any) => api.put(`/hackathons/staging/${id}`, data).then((r) => r.data),
  deleteStaging: (id: string) => api.delete(`/hackathons/staging/${id}`).then((r) => r.data),
  approveStaging: (id: string) => api.post(`/hackathons/staging/${id}/approve`).then((r) => r.data),
  rejectStaging: (id: string) => api.post(`/hackathons/staging/${id}/reject`).then((r) => r.data),
  fetchExternal: () => api.post('/hackathons/fetch-external').then((r) => r.data),
  reEnrich: () => api.post('/hackathons/staging/re-enrich').then((r) => r.data),
  getCounts: () => api.get('/hackathons/staging/counts').then((r) => r.data),
}

// Internships
export const internshipAPI = {
  getAll: () => api.get('/internships').then((r) => r.data),
  getOne: (id: string) => api.get(`/internships/${id}`).then((r) => r.data),
  create: (data: any) => api.post('/internships', data).then((r) => r.data),
  delete: (id: string) => api.delete(`/internships/${id}`).then((r) => r.data),
  register: (id: string) => api.post(`/internships/${id}/register`).then((r) => r.data),
  report: (id: string, status: string) =>
    api.put(`/internships/${id}/report`, { status }).then((r) => r.data),
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
  // Staging methods
  getStaging: (page = 1, limit = 20, status?: string) => api.get('/internships/staging', { params: { page, limit, status } }).then((r) => r.data),
  getStagingOne: (id: string) => api.get(`/internships/staging/${id}`).then((r) => r.data),
  updateStaging: (id: string, data: any) => api.put(`/internships/staging/${id}`, data).then((r) => r.data),
  deleteStaging: (id: string) => api.delete(`/internships/staging/${id}`).then((r) => r.data),
  approveStaging: (id: string) => api.post(`/internships/staging/${id}/approve`).then((r) => r.data),
  rejectStaging: (id: string) => api.post(`/internships/staging/${id}/reject`).then((r) => r.data),
  fetchExternal: () => api.post('/internships/fetch-external').then((r) => r.data),
  reEnrich: () => api.post('/internships/staging/re-enrich').then((r) => r.data),
  getCounts: () => api.get('/internships/staging/counts').then((r) => r.data),
}

// Coding Contests
export const codingContestAPI = {
  getAll: (params?: { platform?: string; status?: string; startDate?: string; endDate?: string }) =>
    api.get('/contests', { params }).then((r) => r.data),
  getByDate: (date: string) => api.get(`/contests/by-date/${date}`).then((r) => r.data),
  getCalendar: (start: string, end: string) =>
    api.get('/contests/calendar', { params: { start, end } }).then((r) => r.data),
  create: (data: any) => api.post('/contests', data).then((r) => r.data),
  delete: (id: string) => api.delete(`/contests/${id}`).then((r) => r.data),
  updateSolutions: (id: string, solutions: any[]) =>
    api.put(`/contests/${id}/solutions`, { solutions }).then((r) => r.data),
  fetchNow: () => api.post('/contests/fetch-now').then((r) => r.data),
}

// Forms
export const formAPI = {
  getAll: () => api.get('/forms').then((r) => r.data),
  getOne: (id: string) => api.get(`/forms/${id}`).then((r) => r.data),
  create: (data: any) => api.post('/forms', data).then((r) => r.data),
  delete: (id: string) => api.delete(`/forms/${id}`).then((r) => r.data),
  respond: (id: string, answers: any) => api.post(`/forms/${id}/respond`, { answers }).then((r) => r.data),
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
}

// Rooms
export const roomAPI = {
  // Room CRUD
  getAll: () => api.get('/rooms').then((r) => r.data),
  getOne: (id: string) => api.get(`/rooms/${id}`).then((r) => r.data),
  create: (data: { name: string; description?: string; departmentId?: string; targetYears?: number[] }) =>
    api.post('/rooms', data).then((r) => r.data),
  update: (id: string, data: { name?: string; description?: string; departmentId?: string; targetYears?: number[] }) =>
    api.put(`/rooms/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/rooms/${id}`).then((r) => r.data),

  // Class Representative (CR)
  makeCR: (roomId: string, studentId: string) =>
    api.post(`/rooms/${roomId}/make-cr`, { studentId }).then((r) => r.data),
  removeCR: (roomId: string, studentId: string) =>
    api.post(`/rooms/${roomId}/remove-cr`, { studentId }).then((r) => r.data),

  // Join / Leave
  joinByCode: (roomId: string, code: string) =>
    api.post(`/rooms/${roomId}/join`, { code }).then((r) => r.data),
  joinByCodeOnly: (code: string) =>
    api.post('/rooms/join', { code }).then((r) => r.data),
  leave: (roomId: string) => api.post(`/rooms/${roomId}/leave`).then((r) => r.data),

  // Members
  getMembers: (roomId: string) => api.get(`/rooms/${roomId}/members`).then((r) => r.data),

  // Resources
  uploadResource: (roomId: string, formData: FormData) =>
    api.post(`/rooms/${roomId}/resources`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data),
  getResources: (roomId: string) => api.get(`/rooms/${roomId}/resources`).then((r) => r.data),
  deleteResource: (roomId: string, resourceId: string) =>
    api.delete(`/rooms/${roomId}/resources/${resourceId}`).then((r) => r.data),

  // Notifications
  getNotifications: () => api.get('/rooms/notifications/list').then((r) => r.data),
  markNotificationRead: (id: string) => api.post(`/rooms/notifications/${id}/read`).then((r) => r.data),

  // Bulk import
  bulkImport: (roomId: string, rollNumbers: string[]) =>
    api.post('/rooms/import', { roomId, rollNumbers }).then((r) => r.data),
}

// Departments
export const departmentAPI = {
  getAll: (collegeId?: string) => api.get('/departments', { params: collegeId ? { collegeId } : {} }).then((r) => r.data),
  create: (data: { name: string }) => api.post('/departments', data).then((r) => r.data),
  update: (id: string, data: { name: string }) => api.put(`/departments/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/departments/${id}`).then((r) => r.data),
}

// Match AI department codes/abbreviations to actual department names
const DEPT_ABBREV_MAP: Record<string, string> = {
  'CSE': 'computer', 'CS': 'computer', 'COMPUTER SCIENCE': 'computer',
  'IT': 'information tech', 'INFORMATION TECHNOLOGY': 'information tech',
  'ECE': 'electronics', 'ELECTRONICS': 'electronics',
  'EEE': 'electrical', 'ELECTRICAL': 'electrical', 'EE': 'electrical',
  'MECH': 'mechanical', 'ME': 'mechanical', 'MECHANICAL': 'mechanical',
  'CIVIL': 'civil',
  'EIE': 'instrumentation', 'INSTRUMENTATION': 'instrumentation',
  'ISE': 'information sc', 'INFORMATION SCIENCE': 'information sc',
}

export function matchAICodesToDepartments(aiCodes: string[], departments: Department[]): string[] {
  if (!aiCodes?.length || !departments?.length) return []
  if (aiCodes.includes('ALL')) return departments.map((d) => d.name)

  const matched: string[] = []
  for (const code of aiCodes) {
    const normalizedCode = code.toUpperCase().trim()
    const mapped = DEPT_ABBREV_MAP[normalizedCode]
    const dept = departments.find(
      (d) => d.name.toUpperCase() === normalizedCode || d.name.toUpperCase().includes(mapped || normalizedCode)
    )
    if (dept) matched.push(dept.name)
  }
  return matched
}

// Admin
export const adminAPI = {
  getUsers: (collegeId?: string) => api.get('/admin/users', { params: collegeId ? { collegeId } : {} }).then((r) => r.data),
  addTeacher: (data: any) => api.post('/admin/users/teacher', data).then((r) => r.data),
  addStudent: (data: any) => api.post('/admin/users/student', data).then((r) => r.data),
  bulkAddTeachers: (teachers: any[]) => api.post('/admin/users/teachers/bulk', { teachers }).then((r) => r.data),
  bulkAddStudents: (students: any[]) => api.post('/admin/users/students/bulk', { students }).then((r) => r.data),
  updateUser: (id: string, data: any) => api.put(`/admin/users/${id}`, data).then((r) => r.data),
  deleteUser: (id: string) => api.delete(`/admin/users/${id}`).then((r) => r.data),
  getAnalytics: (collegeId?: string) => api.get('/admin/analytics', { params: collegeId ? { collegeId } : {} }).then((r) => r.data),
  getColleges: () => api.get('/admin/colleges').then((r) => r.data),
  registerCollege: (data: any) => api.post('/admin/colleges/register', data).then((r) => r.data),
  registerCollegePublic: (data: any) => axios.post(`${API_URL}/colleges/register`, data).then((r) => r.data),
  approveCollege: (id: string) => api.put(`/admin/colleges/${id}/approve`).then((r) => r.data),
  rejectCollege: (id: string) => api.put(`/admin/colleges/${id}/reject`).then((r) => r.data),
  deleteCollege: (id: string) => api.delete(`/admin/colleges/${id}`).then((r) => r.data),
  getHackathons: (collegeId?: string) => api.get('/admin/hackathons', { params: collegeId ? { collegeId } : {} }).then((r) => r.data),
  getForms: (collegeId?: string) => api.get('/admin/forms', { params: collegeId ? { collegeId } : {} }).then((r) => r.data),
  deleteHackathon: (id: string) => api.delete(`/admin/hackathons/${id}`).then((r) => r.data),
  deleteForm: (id: string) => api.delete(`/admin/forms/${id}`).then((r) => r.data),
}

// College
export const collegeAPI = {
  getPublicList: () => axios.get(`${API_URL}/colleges/public`).then((r) => r.data),
}

// User
export const userAPI = {
  getProfile: () => api.get('/user/profile').then((r) => r.data),
  updateProfile: (data: any) => api.put('/user/profile', data).then((r) => r.data),
  getGrades: () => api.get('/user/grades').then((r) => r.data),
  getGradeStats: () => api.get('/user/grades/stats').then((r) => r.data),
  getAttendance: () => api.get('/user/attendance').then((r) => r.data),
  getAttendanceStats: () => api.get('/user/attendance/stats').then((r) => r.data),
  getIntegrations: () => api.get('/user/integrations').then((r) => r.data),
}

// Attendance
export const attendanceAPI = {
  parse: (text: string) =>
    api.post('/attendance/parse', { text }).then((r) => r.data),
  predict: (subjects: any[], targetPercentage?: number) =>
    api.post('/attendance/predict', { subjects, targetPercentage }).then((r) => r.data),
  save: (records: any[], source: string) =>
    api.post('/attendance/save', { records, source }).then((r) => r.data),
  getHistory: () =>
    api.get('/attendance/history').then((r) => r.data),
}

// Coding Profile
export const codingProfileAPI = {
  get: () => api.get('/coding-profile').then((r) => r.data),
  update: (data: any) => api.put('/coding-profile', data).then((r) => r.data),
  sync: () => api.post('/coding-profile/sync').then((r) => r.data),
  getParticipations: () => api.get('/coding-profile/participations').then((r) => r.data),
  getLeaderboard: (params?: { platform?: string; departmentId?: string; year?: string }) =>
    api.get('/coding-profile/leaderboard', { params }).then((r) => r.data),
  getContestParticipants: (contestId: string) =>
    api.get(`/coding-profile/contest/${contestId}/participants`).then((r) => r.data),
  syncAll: () => api.post('/coding-profile/sync-all').then((r) => r.data),
}

export default api