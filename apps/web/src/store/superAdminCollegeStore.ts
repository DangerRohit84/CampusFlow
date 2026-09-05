import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SuperAdminCollegeState {
  selectedCollegeId: string | null
  selectedCollegeName: string | null
  selectedCollegeCode: string | null
  setSelectedCollege: (id: string | null, name?: string | null, code?: string | null) => void
  clear: () => void
}

// Persisted under campusflow-superadmin-college — also mirrored to legacy key superadmin_selectedCollegeId for api.ts interceptor compat
export const useSuperAdminCollegeStore = create<SuperAdminCollegeState>()(
  persist(
    (set) => ({
      selectedCollegeId: null,
      selectedCollegeName: null,
      selectedCollegeCode: null,
      setSelectedCollege: (id, name = null, code = null) =>
        set({
          selectedCollegeId: id,
          selectedCollegeName: name,
          selectedCollegeCode: code,
        }),
      clear: () => set({ selectedCollegeId: null, selectedCollegeName: null, selectedCollegeCode: null }),
    }),
    { name: 'campusflow-superadmin-college' }
  )
)

// Helper to read override outside React (e.g., api interceptor)
export function getSuperAdminCollegeId(): string | null {
  try {
    // Prefer zustand persist storage
    const raw = localStorage.getItem('campusflow-superadmin-college')
    if (raw) {
      const parsed = JSON.parse(raw)
      const id = parsed?.state?.selectedCollegeId || parsed?.selectedCollegeId || null
      if (id) return String(id)
    }
  } catch {}
  try {
    const legacy = localStorage.getItem('superadmin_selectedCollegeId')
    if (legacy) return legacy
  } catch {}
  return null
}

export function getSuperAdminCollegeName(): string | null {
  try {
    const raw = localStorage.getItem('campusflow-superadmin-college')
    if (raw) {
      const parsed = JSON.parse(raw)
      return parsed?.state?.selectedCollegeName || parsed?.selectedCollegeName || null
    }
  } catch {}
  try {
    return localStorage.getItem('superadmin_selectedCollegeName')
  } catch { return null }
}

// Keep legacy keys in sync when store changes — call from components after set
export function syncLegacyStorage(id: string | null, name: string | null) {
  try {
    if (id) localStorage.setItem('superadmin_selectedCollegeId', id)
    else localStorage.removeItem('superadmin_selectedCollegeId')
    if (name) localStorage.setItem('superadmin_selectedCollegeName', name)
    else localStorage.removeItem('superadmin_selectedCollegeName')
  } catch {}
}
