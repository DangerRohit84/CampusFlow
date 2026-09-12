import { create } from 'zustand'

export type View = 'dashboard' | 'schedule' | 'chat' | 'assignments' | 'notifications' | 'settings'
export type Theme = 'light' | 'dark'

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  const stored = localStorage.getItem('campusflow-theme') as Theme | null
  if (stored === 'dark' || stored === 'light') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
  localStorage.setItem('campusflow-theme', theme)
}

interface AppState {
  sidebarOpen: boolean
  currentView: View
  theme: Theme
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setCurrentView: (view: View) => void
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
}

export const useAppStore = create<AppState>((set) => {
  // Apply stored theme on init
  const initial = getInitialTheme()
  if (typeof document !== 'undefined') {
    applyTheme(initial)
  }

  return {
    sidebarOpen: true,
    currentView: 'dashboard',
    theme: initial,
    toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
    setSidebarOpen: (open) => set({ sidebarOpen: open }),
    setCurrentView: (view) => set({ currentView: view }),
    toggleTheme: () => set((s) => {
      const next = s.theme === 'light' ? 'dark' : 'light'
      applyTheme(next)
      return { theme: next }
    }),
    setTheme: (theme) => {
      applyTheme(theme)
      set({ theme })
    },
  }
})
