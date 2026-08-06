import axios from 'axios'
import { io, Socket } from 'socket.io-client'

const API_URL = 'http://localhost:4000/api'
const WS_URL = 'http://localhost:4000'

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
  register: (data: { email: string; name: string; password: string; departmentId?: string; role?: string; collegeId?: string; empNumber?: string; studentId?: string; incomingYear?: number }) =>
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

// Notifications
export const notificationAPI = {
  getAll: (unread?: boolean) => api.get('/notifications', { params: { unread } }).then((r) => r.data),
  getUnreadCount: () => api.get('/notifications/unread-count').then((r) => r.data),
  markRead: (id: string) => api.put(`/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () => api.put('/notifications/read-all').then((r) => r.data),
  delete: (id: string) => api.delete(`/notifications/${id}`).then((r) => r.data),
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
  getAll: () => api.get('/departments').then((r) => r.data),
  create: (data: { name: string }) => api.post('/departments', data).then((r) => r.data),
  update: (id: string, data: { name: string }) => api.put(`/departments/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/departments/${id}`).then((r) => r.data),
}

// Admin
export const adminAPI = {
  getUsers: () => api.get('/admin/users').then((r) => r.data),
  addTeacher: (data: any) => api.post('/admin/users/teacher', data).then((r) => r.data),
  addStudent: (data: any) => api.post('/admin/users/student', data).then((r) => r.data),
  bulkAddTeachers: (teachers: any[]) => api.post('/admin/users/teachers/bulk', { teachers }).then((r) => r.data),
  bulkAddStudents: (students: any[]) => api.post('/admin/users/students/bulk', { students }).then((r) => r.data),
  updateUser: (id: string, data: any) => api.put(`/admin/users/${id}`, data).then((r) => r.data),
  deleteUser: (id: string) => api.delete(`/admin/users/${id}`).then((r) => r.data),
  getAnalytics: () => api.get('/admin/analytics').then((r) => r.data),
  getColleges: () => api.get('/admin/colleges').then((r) => r.data),
  registerCollege: (data: any) => api.post('/admin/colleges/register', data).then((r) => r.data),
  registerCollegePublic: (data: any) => axios.post(`${API_URL}/colleges/register`, data).then((r) => r.data),
  approveCollege: (id: string) => api.put(`/admin/colleges/${id}/approve`).then((r) => r.data),
  rejectCollege: (id: string) => api.put(`/admin/colleges/${id}/reject`).then((r) => r.data),
  deleteCollege: (id: string) => api.delete(`/admin/colleges/${id}`).then((r) => r.data),
  getHackathons: () => api.get('/admin/hackathons').then((r) => r.data),
  getForms: () => api.get('/admin/forms').then((r) => r.data),
  deleteHackathon: (id: string) => api.delete(`/admin/hackathons/${id}`).then((r) => r.data),
  deleteForm: (id: string) => api.delete(`/admin/forms/${id}`).then((r) => r.data),
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

export default api