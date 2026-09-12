import { create } from 'zustand'
import * as SecureStore from 'expo-secure-store'

interface User {
  id: string
  name: string
  email: string
  role: string
  department?: string
  year?: number
  semester?: number
}

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  loading: boolean
  login: (user: User, token: string) => Promise<void>
  logout: () => Promise<void>
  loadToken: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  loading: true,
  login: async (user, token) => {
    try {
      await SecureStore.setItemAsync('token', token)
      await SecureStore.setItemAsync('user', JSON.stringify(user))
      set({ user, token, isAuthenticated: true, loading: false })
    } catch (error) {
      console.error('Error saving auth data:', error)
      set({ loading: false })
    }
  },
  logout: async () => {
    try {
      await SecureStore.deleteItemAsync('token')
      await SecureStore.deleteItemAsync('user')
    } catch (error) {
      console.error('Error clearing auth data:', error)
    } finally {
      set({ user: null, token: null, isAuthenticated: false, loading: false })
    }
  },
  loadToken: async () => {
    try {
      const token = await SecureStore.getItemAsync('token')
      const userStr = await SecureStore.getItemAsync('user')
      if (token && userStr) {
        try {
          const user = JSON.parse(userStr)
          set({ user, token, isAuthenticated: true, loading: false })
        } catch (parseError) {
          console.error('Error parsing user data:', parseError)
          // Corrupted user data - clear it
          await SecureStore.deleteItemAsync('token')
          await SecureStore.deleteItemAsync('user')
          set({ loading: false })
        }
      } else {
        set({ loading: false })
      }
    } catch (error) {
      console.error('Error loading token:', error)
      set({ loading: false })
    }
  },
}))
