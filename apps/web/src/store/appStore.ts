import { create } from 'zustand'

export type View = 'dashboard' | 'schedule' | 'chat' | 'assignments' | 'notifications' | 'settings'

interface AppState {
  sidebarOpen: boolean
  currentView: View
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setCurrentView: (view: View) => void
}

export const useAppStore = create<AppState>((set) => ({
  sidebarOpen: true,
  currentView: 'dashboard',
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setCurrentView: (view) => set({ currentView: view }),
}))