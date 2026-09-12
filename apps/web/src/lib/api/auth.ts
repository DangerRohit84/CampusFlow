// lib/api/auth.ts — auth domain API (SRP extract from lib/api.ts).
import { api, API_TIMEOUTS } from './client'

export const authAPI = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }, { timeout: API_TIMEOUTS.auth }).then((r) => r.data),
  register: (data: { email: string; name: string; password: string; username?: string; departmentId?: string; department?: string; role?: string; collegeId?: string; college?: string; empNumber?: string; studentId?: string; incomingYear?: number }) =>
    api.post('/auth/register', data, { timeout: API_TIMEOUTS.auth }).then((r) => r.data),
  me: () => api.get('/auth/me', { timeout: API_TIMEOUTS.auth }).then((r) => r.data),
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    api.post('/auth/change-password', data, { timeout: API_TIMEOUTS.auth }).then((r) => r.data),
  refresh: (refreshToken?: string) =>
    api.post('/auth/refresh', refreshToken ? { refreshToken } : {}, { timeout: API_TIMEOUTS.auth }).then((r) => r.data),
  csrf: () => api.get('/auth/csrf', { timeout: API_TIMEOUTS.auth }).then((r) => r.data),
  logout: () => api.post('/auth/logout', {}, { timeout: API_TIMEOUTS.auth }).then((r) => r.data).catch(() => ({ message: 'Logged out (local)' })),
}
