// store/logoutStore.test.ts — locks fast deterministic logout (state cleared,
// dest login, no dashboard flash, no network await, no refetch storm).
// WHY: logout awaited authAPI.logout (10s timeout) before set() while handlers
// did logout(); navigate('/login') unawaited → GuestRoute saw stale
// isAuthenticated=true → bounced to /dashboard (refresh then dashboard) + slow.
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('zustand/middleware', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return {
    ...orig,
    persist: (fn: unknown) => fn,
  }
})

const serverLogout = vi.fn()
vi.mock('../lib/api', () => ({
  authAPI: {
    login: vi.fn(),
    register: vi.fn(),
    logout: () => serverLogout(),
  },
}))

const cancelQueries = vi.fn(() => Promise.resolve())
const clearQueries = vi.fn()
vi.mock('../lib/queryClient', () => ({
  queryClient: {
    cancelQueries: () => cancelQueries(),
    clear: () => clearQueries(),
  },
}))

const disconnectSocket = vi.fn()
vi.mock('../lib/socket', () => ({
  disconnectSocket: () => disconnectSocket(),
  connectSocket: vi.fn(),
  getSocket: vi.fn(() => null),
}))

function installMemoryStorage() {
  const mem = new Map<string, string>()
  ;(globalThis as any).localStorage = {
    getItem: (k: string) => (mem.has(k) ? (mem.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      mem.set(k, String(v))
    },
    removeItem: (k: string) => {
      mem.delete(k)
    },
    clear: () => mem.clear(),
  }
  const smem = new Map<string, string>()
  ;(globalThis as any).sessionStorage = {
    getItem: (k: string) => (smem.has(k) ? (smem.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      smem.set(k, String(v))
    },
    removeItem: (k: string) => {
      smem.delete(k)
    },
    clear: () => smem.clear(),
  }
}

describe('authStore.logout (fast deterministic)', () => {
  beforeEach(() => {
    vi.resetModules()
    installMemoryStorage()
    serverLogout.mockReset()
    cancelQueries.mockClear()
    clearQueries.mockClear()
    disconnectSocket.mockClear()
    // Default: server hangs (proves fire-and-forget). Resolves only if awaited 5s.
    serverLogout.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({}), 5000)))
  })

  it('clears token/user synchronously even when server logout hangs (no await)', async () => {
    const { useAuthStore } = await import('./authStore')
    // Seed authed session + polluted scope (superadmin switch residue).
    useAuthStore.setState({
      user: { id: 'u1', email: 'a@x.edu', name: 'A', role: 'COLLEGE_ADMIN' } as never,
      token: 'tok-1',
      csrfToken: 'csrf-1',
      isAuthenticated: true,
      loading: false,
    })
    localStorage.setItem('campusflow-auth', JSON.stringify({ state: { user: { id: 'u1' }, token: 'tok-1', isAuthenticated: true }, version: 0 }))
    localStorage.setItem('campusflow-csrf', 'csrf-1')
    localStorage.setItem('campusflow-superadmin-college', JSON.stringify({ state: { selectedCollegeId: 'c1' } }))
    localStorage.setItem('superadmin_selectedCollegeId', 'c1')
    sessionStorage.setItem('postLoginRedirect', '/superadmin/colleges/c1')

    const start = Date.now()
    const maybePromise = (useAuthStore.getState().logout as () => unknown)()
    const elapsedSyncMs = Date.now() - start

    // WHY sync: handlers navigate('/login',{replace:true}) in the same tick.
    // If state still reads authed here, GuestRoute bounces to /dashboard.
    const snap = useAuthStore.getState()
    expect(snap.user).toBeNull()
    expect(snap.token).toBeNull()
    expect(snap.isAuthenticated).toBe(false)
    expect(elapsedSyncMs).toBeLessThan(300)

    // Storage must read logged-out same tick (interceptor reads storage).
    const raw = localStorage.getItem('campusflow-auth')
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string).state.isAuthenticated).toBe(false)
    expect(JSON.parse(raw as string).state.token).toBeNull()
    expect(localStorage.getItem('campusflow-csrf')).toBeNull()
    expect(localStorage.getItem('campusflow-superadmin-college')).toBeNull()
    expect(localStorage.getItem('superadmin_selectedCollegeId')).toBeNull()
    expect(sessionStorage.getItem('postLoginRedirect')).toBeNull()

    // Fire-and-forget: server was poked but we never waited 5s for it.
    expect(serverLogout).toHaveBeenCalledTimes(1)
    expect(elapsedSyncMs).toBeLessThan(300)

    // Cleanup: let the hanging promise settle without holding the test (5s).
    // logout() must have returned already; awaiting it must resolve fast (<300ms
    // beyond the sync part) — it must NOT await the 5s server promise.
    if (maybePromise instanceof Promise) {
      const t0 = Date.now()
      await Promise.race([maybePromise, new Promise((_, rej) => setTimeout(() => rej(new Error('logout awaited network')), 300))])
      expect(Date.now() - t0).toBeLessThan(300)
    }
  })

  it('cancels in-flight queries (no refetch storm) and disconnects socket promptly', async () => {
    const { useAuthStore } = await import('./authStore')
    useAuthStore.setState({
      user: { id: 'u1', email: 'a@x.edu', name: 'A', role: 'STUDENT' } as never,
      token: 'tok-1',
      csrfToken: null,
      isAuthenticated: true,
      loading: false,
    })
    const maybePromise = (useAuthStore.getState().logout as () => unknown)()
    if (maybePromise instanceof Promise) await maybePromise.catch(() => {})
    expect(cancelQueries).toHaveBeenCalledTimes(1)
    expect(clearQueries).toHaveBeenCalledTimes(1)
    expect(disconnectSocket).toHaveBeenCalledTimes(1)
  })
})
