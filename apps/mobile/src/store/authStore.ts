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
    await SecureStore.setItemAsync('token', token)
    await SecureStore.setItemAsync('user', JSON.stringify(user))
    set({ user, token, isAuthenticated: true })
  },
  logout: async () => {
    await SecureStore.deleteItemAsync('token')
    await SecureStore.deleteItemAsync('user')
    set({ user: null, token: null, isAuthenticated: false })
  },
  loadToken: async () => {
    const token = await SecureStore.getItemAsync('token')
    const userStr = await SecureStore.getItemAsync('user')
    if (token && userStr) {
      set({ user: JSON.parse(userStr), token, isAuthenticated: true, loading: false })
    } else {
      set({ loading: false })
    }
  },
}))