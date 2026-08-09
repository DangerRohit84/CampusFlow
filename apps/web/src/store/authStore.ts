import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { authAPI } from '../lib/api'
import { type User } from '../types/api'

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (data: { email: string; name: string; password: string; departmentId?: string; department?: string; role?: string; collegeId?: string; college?: string; empNumber?: string; studentId?: string; incomingYear?: number }) => Promise<void>
  logout: () => void
  updateUser: (user: Partial<User>) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      loading: false,
      login: async (email, password) => {
        set({ loading: true })
        try {
          const data = await authAPI.login(email, password)
          set({ user: data.user, token: data.token, isAuthenticated: true, loading: false })
        } catch (error: any) {
          set({ loading: false })
          throw new Error(error.response?.data?.error || 'Login failed')
        }
      },
      register: async (formData) => {
        set({ loading: true })
        try {
          const data = await authAPI.register(formData)
          set({ user: data.user, token: data.token, isAuthenticated: true, loading: false })
        } catch (error: any) {
          set({ loading: false })
          throw new Error(error.response?.data?.error || 'Registration failed')
        }
      },
      logout: () => set({ user: null, token: null, isAuthenticated: false }),
      updateUser: (updates) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        })),
    }),
    { name: 'campusflow-auth' }
  )
)