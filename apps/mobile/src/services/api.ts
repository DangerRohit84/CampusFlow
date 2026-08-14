import axios from 'axios'
import * as SecureStore from 'expo-secure-store'
import Constants from 'expo-constants'
import { useAuthStore } from '../store/authStore'

const API_URL = Constants.expoConfig?.extra?.apiUrl || 'http://localhost:4000/api'

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
})

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Network errors (no response from server)
    if (!error.response) {
      console.warn('Network error:', error.message)
      return Promise.reject(error)
    }

    // 401 Unauthorized - token expired or invalid
    if (error.response.status === 401) {
      try {
        await SecureStore.deleteItemAsync('token')
        await SecureStore.deleteItemAsync('user')
        useAuthStore.getState().logout()
      } catch (e) {
        console.warn('Error during logout:', e)
      }
    }

    return Promise.reject(error)
  }
)

export const authAPI = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }).then((r) => r.data),
  register: (data: { email: string; name: string; password: string }) =>
    api.post('/auth/register', data).then((r) => r.data),
}

export const dashboardAPI = { get: () => api.get('/user/dashboard').then((r) => r.data) }
export const scheduleAPI = { getAll: () => api.get('/schedules').then((r) => r.data) }
export const assignmentAPI = { getAll: () => api.get('/assignments').then((r) => r.data) }
export const notificationAPI = {
  getAll: () => api.get('/notifications').then((r) => r.data),
  markRead: (id: string) => api.put(`/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () => api.put('/notifications/read-all').then((r) => r.data),
}
export const chatAPI = {
  ask: (content: string) => api.post('/chat/ask', { content }).then((r) => r.data),
}
export const userAPI = {
  getProfile: () => api.get('/user/profile').then((r) => r.data),
}

export default api
