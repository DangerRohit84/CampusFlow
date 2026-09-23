// lib/api/client.ts — axios instance + interceptors (SRP extract from lib/api.ts).
// WHY: 56KB god module mixed client config, auth, 15 domain APIs, Groq keys,
// socket re-exports. This file owns ONLY transport: baseURL, timeouts,
// no-cache, null-guard, auth header, superadmin scoping, 304/401 handling.
// Behavior identical; AbortSignal threading preserved on every queryFn.
// New code: `import { api, API_TIMEOUTS } from '../lib/api/client'`.

import axios from 'axios'

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000'
export const API_URL = `${API_BASE}/api`

export const API_TIMEOUTS = {
  auth: 10000,
  default: 15000,
  fetch: 60000,
} as const

export const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: API_TIMEOUTS.default,
  // C2: cookie migration — send HttpOnly cookies (campusflow_token/cf_refresh/cf_csrf)
  // alongside Bearer during dual-support. CORS already credentials:true server-side.
  withCredentials: true,
  validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
})

function getCsrfToken(): string | null {
  try {
    const m = document.cookie.match(/(?:^|;\s*)cf_csrf=([^;]+)/)
    if (m?.[1]) return decodeURIComponent(m[1].trim())
  } catch {}
  try {
    return localStorage.getItem('campusflow-csrf')
  } catch {}
  return null
}

export function setCsrfTokenForTests(token: string): void {
  try { localStorage.setItem('campusflow-csrf', token) } catch {}
}

export function getSuperAdminOverrideCollegeId(): string | null {
  try {
    const raw = localStorage.getItem('campusflow-superadmin-college')
    if (raw) {
      const parsed = JSON.parse(raw)
      const id = parsed?.state?.selectedCollegeId || parsed?.selectedCollegeId || null
      if (id) return String(id)
    }
  } catch { /* storage unavailable — fall through */ }
  try {
    const legacy = localStorage.getItem('superadmin_selectedCollegeId')
    if (legacy) return String(legacy)
  } catch { /* ignore */ }
  try {
    const sp = new URLSearchParams(window.location.search)
    const q = sp.get('collegeId')
    if (q) return String(q)
  } catch { /* ignore */ }
  return null
}

api.interceptors.request.use((config) => {
  try {
    if (String(config.method || 'get').toLowerCase() === 'get') {
      config.headers = {
        ...(config.headers || {}),
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      } as never
    }
  } catch { /* header patch is best-effort */ }
  if (config.data === null) {
    config.data = {}
  }
  if (config.data === 'null') {
    config.data = {}
  }
  const stored = localStorage.getItem('campusflow-auth')
  let isSuperAdmin = false
  // Public auth routes must never carry a stale Bearer from the previous session
  // (superadmin → college-admin account switch without logout would otherwise send
  // the OLD superadmin JWT on the NEW login POST). /auth/me + change-password +
  // logout still need auth; only login/register/refresh/csrf are public.
  const earlyUrl = String((config as { url?: unknown }).url || '')
  const isPublicAuthRoute =
    earlyUrl.includes('/auth/login') ||
    earlyUrl.includes('/auth/register') ||
    earlyUrl.includes('/auth/refresh') ||
    earlyUrl.includes('/auth/csrf')
  if (stored) {
    try {
      const { state } = JSON.parse(stored)
      if (state?.token && !isPublicAuthRoute) {
        // Dual support (C2 migration): keep Bearer during transition; cookie
        // (withCredentials) is authoritative once frontend stops persisting token.
        // VITE_API_URL allowlist — token only sent to API_BASE (single host).
        config.headers.Authorization = `Bearer ${state.token}`
      }
      if (state?.user?.role === 'SUPER_ADMIN') isSuperAdmin = true
      // Persist CSRF token from login/register response for double-submit
      if (state?.csrfToken) {
        try { localStorage.setItem('campusflow-csrf', String(state.csrfToken)) } catch {}
      }
    } catch { /* corrupt auth blob — request goes unauthenticated */ }
  }
  // CSRF double-submit (C2): echo cf_csrf cookie in X-CSRF-Token for mutations.
  // Bearer-only requests skip server check, but always send when available.
  try {
    const method = String(config.method || 'get').toLowerCase()
    if (['post', 'put', 'patch', 'delete'].includes(method)) {
      const csrf = getCsrfToken()
      if (csrf) {
        ;(config.headers as Record<string, string>)['X-CSRF-Token'] = csrf
      }
    }
  } catch { /* csrf best-effort */ }
  if (isSuperAdmin && !isPublicAuthRoute) {
    const overrideId = getSuperAdminOverrideCollegeId()
    if (overrideId) {
      const url = String(config.url || '')
      // Auth routes must never carry stale superadmin tenant headers from the
      // previous session (account-switch login POST would inherit override).
      // Headers were previously added unconditionally; only the param/body
      // patch was gated by excludeExact — move the gate up to cover headers too.
      const excludeExact = ['/admin/super/dashboard', '/admin/colleges', '/auth/', '/colleges/public', '/colleges/list', '/colleges/register']
      const isExcluded = excludeExact.some((p) => url.includes(p))
      if (!isExcluded) {
        try {
          ;(config.headers as Record<string, string>)['x-superadmin-college-id'] = overrideId
          ;(config.headers as Record<string, string>)['x-college-id'] = overrideId
        } catch { /* ignore */ }
      }
      const allowList = ['/user/dashboard', '/rooms', '/alumni', '/assignments/hub', '/forms', '/hackathons', '/internships', '/contests', '/timetable', '/tasks', '/announcements', '/departments', '/admin/analytics', '/admin/users', '/admin/hackathons', '/admin/forms', '/schedules', '/grades', '/attendance', '/coding-profile', '/reports']
      const isAllowed = allowList.some((p) => url.includes(p))
      if (!isExcluded && isAllowed) {
        const params: Record<string, unknown> = ((config.params as Record<string, unknown>) = (config.params as Record<string, unknown>) || {})
        if (!params.collegeId && !url.includes('collegeId=')) {
          params.collegeId = overrideId
        }
        const method = String(config.method || '').toLowerCase()
        if (['post', 'put', 'patch'].includes(method)) {
          try {
            if (config.data instanceof FormData) {
              if (!config.data.has('collegeId')) config.data.append('collegeId', overrideId)
            } else if (config.data && typeof config.data === 'object' && !Array.isArray(config.data)) {
              if (!(config.data as Record<string, unknown>).collegeId) (config.data as Record<string, unknown>).collegeId = overrideId
            } else if (!config.data || (typeof config.data === 'object' && Object.keys(config.data as object).length === 0)) {
              if (!config.data) config.data = {}
              if (typeof config.data === 'object' && !(config.data as Record<string, unknown>).collegeId) (config.data as Record<string, unknown>).collegeId = overrideId
            }
          } catch { /* body patch best-effort */ }
        }
      }
      try {
        if (!localStorage.getItem('superadmin_selectedCollegeId')) {
          localStorage.setItem('superadmin_selectedCollegeId', overrideId)
        }
      } catch { /* ignore */ }
    }
  }
  return config
})

let authExpiredNotified = false

api.interceptors.response.use(
  (response) => {
    if (response?.status === 304) {
      const err = new Error('Not Modified (cached)') as Error & { code?: string; config?: unknown; response?: unknown }
      err.code = 'ERR_NOT_MODIFIED'
      err.config = response.config
      err.response = response
      return Promise.reject(err)
    }
    return response
  },
  async (error) => {
    const original = error?.config as (typeof error.config & { _retry?: boolean }) | undefined
    if (error?.response?.status === 401 && original && !original._retry) {
      original._retry = true
      try {
        const stored = localStorage.getItem('campusflow-auth')
        const token: string | null = stored ? (JSON.parse(stored)?.state?.token ?? null) : null
        const sent = String(original?.headers?.Authorization || '')
        if (token && !sent.includes(String(token).slice(-8))) {
          original.headers = { ...(original.headers || {}), Authorization: `Bearer ${token}` }
          return api(original)
        }
      } catch { /* single-flight retry best-effort */ }
    }
    if (error?.response?.status === 401) {
      // Deterministic logout→login (2026-09-14): fire-and-forget /auth/logout
      // + failed /auth/login|register must NEVER trigger the expired-session
      // side effects (save redirect + dispatch logout + 60ms pushState). A
      // logout 401 (expired token) would otherwise re-dispatch logout AFTER a
      // successful re-login's navigate() and push back to /login until refresh;
      // a failed login would clear a still-valid existing session.
      try {
        const failedUrl = String((original as { url?: unknown })?.url || '')
        if (failedUrl.includes('/auth/logout') || failedUrl.includes('/auth/login') || failedUrl.includes('/auth/register')) {
          return Promise.reject(error)
        }
      } catch { /* url check best-effort — fall through to normal 401 path */ }
      try {
        const from = window.location.pathname + window.location.search
        if (from && !from.startsWith('/login') && !from.startsWith('/register')) {
          try { sessionStorage.setItem('postLoginRedirect', from) } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      try {
        window.dispatchEvent(new CustomEvent('auth:expired', { detail: { from: window.location.pathname } }))
      } catch { /* ignore */ }
      if (!authExpiredNotified) {
        authExpiredNotified = true
        setTimeout(() => { authExpiredNotified = false }, 5000)
        setTimeout(() => {
          try {
            if (window.location.pathname !== '/login' && window.location.pathname !== '/register') {
              try {
                window.history.pushState({}, '', '/login')
                window.dispatchEvent(new PopStateEvent('popstate'))
              } catch {
                window.location.href = '/login'
              }
            }
          } catch { /* ignore */ }
        }, 60)
      }
    }
    return Promise.reject(error)
  },
)

export function resetAuthExpiredForTests(): void {
  authExpiredNotified = false
}

export default api
