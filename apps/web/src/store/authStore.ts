import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { authAPI } from '../lib/api'
import { type User } from '../types/api'
import { useSuperAdminCollegeStore } from './superAdminCollegeStore'
import { queryClient } from '../lib/queryClient'
import { disconnectSocket } from '../lib/socket'
import { clearLogoutStorage } from '../lib/logout'

// C2 dual support (migration in progress per AUTH-HTTPONLY-PLAN.md):
// - Access JWT 1d (was 7d) + rotating refresh (cf_refresh 30d Strict) + CSRF (cf_csrf/X-CSRF-Token).
// - Backend sets HttpOnly cookies on login/register/refresh AND returns { user, token, csrfToken }.
// - Frontend keeps { user, token } in localStorage during 1-release dual-accept (header wins,
//   cookie fallback server-side) + withCredentials:true sends cookies. Next release: stop
//   persisting token (keep { user } only), rely on cookies + refresh rotation.
// WHY localStorage still: stateless JWT shared with mobile (expo-secure-store), no SSR.
interface AuthState {
  user: User | null
  token: string | null
  csrfToken: string | null
  isAuthenticated: boolean
  loading: boolean
  login: (email: string, password: string) => Promise<{ user: User; token: string | null }>
  register: (data: { email: string; name: string; password: string; username?: string; departmentId?: string; department?: string; role?: string; collegeId?: string; college?: string; empNumber?: string; studentId?: string; incomingYear?: number }) => Promise<{ user: User; token: string | null }>
  logout: () => Promise<void>
  updateUser: (user: Partial<User>) => void
  setUser: (user: User) => void
}

// Account-switch hygiene: a previous SUPER_ADMIN session leaves tenant scope
// (campusflow-superadmin-college + legacy keys + store memory). If the next
// login is NOT superadmin, that stale scope would pollute useCollegeScope /
// the api interceptor for the new COLLEGE_ADMIN session. Clear both storage
// AND store memory synchronously before persisting the new session.
function clearStaleSuperAdminScope(): void {
  try {
    localStorage.removeItem('campusflow-superadmin-college')
  } catch {}
  try {
    localStorage.removeItem('superadmin_selectedCollegeId')
  } catch {}
  try {
    localStorage.removeItem('superadmin_selectedCollegeName')
  } catch {}
  try {
    useSuperAdminCollegeStore.getState().clear()
  } catch {}
}

// Persist-then-navigate order: zustand/persist writes via subscribe, but the
// api interceptor reads Bearer from localStorage (not memory). Dual-write the
// new auth blob synchronously BEFORE login() resolves so the dashboard's first
// request (fired right after navigate) can never read a stale superadmin token
// or an empty blob and 401-bounce back to /login.
// WHY same shape as memory (incl. loading:false): guards read memory
// (isAuthenticated+user) while interceptor reads storage — both must see the
// same truth in the same tick, otherwise student lands only after refresh.
function writeAuthBlobSync(user: User, token: string | null, csrfToken: string | null): void {
  try {
    localStorage.setItem(
      'campusflow-auth',
      JSON.stringify({ state: { user, token, csrfToken, isAuthenticated: true, loading: false }, version: 0 }),
    )
  } catch {}
}

// Deterministic account-switch hygiene (logout→login fix, 2026-09-14):
// college-scoped RQ keys (not user-scoped) + keepPreviousData 60s would flash
// the PREVIOUS tenant's lists after login as a different user, looking like
// "login fails" until manual refresh (which clears in-memory cache + socket).
// Clear queries + disconnect socket synchronously on account switch (same-tick,
// no await), mirroring logout(). Best-effort, never throws.
function clearQueriesAndSocketSync(): void {
  try {
    void queryClient.cancelQueries().catch(() => {})
  } catch {}
  try {
    queryClient.clear()
  } catch {}
  try {
    disconnectSocket()
  } catch {}
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      csrfToken: null,
      isAuthenticated: false,
      loading: false,
      login: async (email, password) => {
        const prevUserId = get().user?.id ?? null
        set({ loading: true })
        try {
          const data = await authAPI.login(email, password)
          try {
            if ((data as any).csrfToken) localStorage.setItem('campusflow-csrf', String((data as any).csrfToken))
          } catch {}
          const nextUser = data.user as User
          const nextToken = (data.token as string | null) ?? null
          const nextCsrf = ((data as any).csrfToken as string | null) || null
          const isAccountSwitch = !!(prevUserId && nextUser?.id && prevUserId !== nextUser.id)
          // Clear stale superadmin scope when switching accounts or landing as non-superadmin.
          // WHY: superadmin → college-admin without this keeps selectedCollegeId override,
          // polluting the new session's college scope + api headers.
          if (nextUser?.role !== 'SUPER_ADMIN' || isAccountSwitch) {
            clearStaleSuperAdminScope()
          }
          // Deterministic post-login hygiene (logout→login fix): drop previous
          // tenant's RQ cache + old socket BEFORE persisting the new session,
          // same-tick, no await. Otherwise college-scoped keys flash old lists.
          if (isAccountSwitch) {
            clearQueriesAndSocketSync()
          }
          // Same-tick: memory set + storage dual-write, no await between —
          // navigate() after await sees both (guards read memory, interceptor
          // reads storage). Order: set then write so manual blob wins over
          // persist-subscribe serialization for this tick.
          set({ user: nextUser, token: nextToken, csrfToken: nextCsrf, isAuthenticated: true, loading: false })
          writeAuthBlobSync(nextUser, nextToken, nextCsrf)
          return { user: nextUser, token: nextToken }
        } catch (error: any) {
          set({ loading: false })
          throw new Error(error.response?.data?.error || 'Login failed')
        }
      },
      register: async (formData) => {
        const prevUserId = get().user?.id ?? null
        set({ loading: true })
        try {
          const data = await authAPI.register(formData)
          try {
            if ((data as any).csrfToken) localStorage.setItem('campusflow-csrf', String((data as any).csrfToken))
          } catch {}
          const nextUser = data.user as User
          const nextToken = (data.token as string | null) ?? null
          const nextCsrf = ((data as any).csrfToken as string | null) || null
          const isAccountSwitch = !!(prevUserId && nextUser?.id && prevUserId !== nextUser.id)
          if (nextUser?.role !== 'SUPER_ADMIN' || isAccountSwitch) {
            clearStaleSuperAdminScope()
          }
          if (isAccountSwitch) {
            clearQueriesAndSocketSync()
          }
          set({ user: nextUser, token: nextToken, csrfToken: nextCsrf, isAuthenticated: true, loading: false })
          writeAuthBlobSync(nextUser, nextToken, nextCsrf)
          return { user: nextUser, token: nextToken }
        } catch (error: any) {
          set({ loading: false })
          throw new Error(error.response?.data?.error || 'Registration failed')
        }
      },
      logout: async () => {
        // Fast deterministic logout (<300ms local): fire-and-forget server
        // logout (no await) then sync local teardown, no refetch, no reload.
        // WHY: awaiting authAPI.logout (10s timeout) before set() held
        // isAuthenticated=true while handlers already navigated to /login →
        // GuestRoute bounced to /dashboard (refresh-then-dashboard) + slow.
        try {
          void authAPI.logout().catch(() => {})
        } catch {}
        // Cancel in-flight queries instead of refetching (no refetch storm)
        // + drop cache so the next login never flashes previous tenant lists.
        try {
          void queryClient.cancelQueries().catch(() => {})
        } catch {}
        try {
          queryClient.clear()
        } catch {}
        // Prompt socket teardown (Layout's token-falsy effect is backup only).
        try {
          disconnectSocket()
        } catch {}
        // Sync storage clear so the interceptor (reads storage, not memory)
        // sees logged-out same tick; also drops stale superadmin scope +
        // postLoginRedirect so the next login never inherits them.
        // Defense in depth: server clears HttpOnly cookies on /auth/logout.
        try {
          clearLogoutStorage()
        } catch {}
        try {
          clearStaleSuperAdminScope()
        } catch {}
        // Same-tick memory clear so guards read logged-out before navigate().
        set({ user: null, token: null, csrfToken: null, isAuthenticated: false, loading: false })
      },
      setUser: (user) => set({ user, isAuthenticated: true }),
      updateUser: (updates) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        })),
    }),
    { name: 'campusflow-auth' }
  )
)