// store/loginLogoutSequence.test.ts — RED: logout→login must be deterministic
// (same-tick clear then persist-then-navigate) with no stale cache/socket.
// WHY: logout then login fails until manual refresh. Root cause: login as a
// different user reused previous tenant's queryClient cache (college-scoped
// keys, not user-scoped, keepPreviousData 60s) + old socket session, because
// only logout cleared (login switch only cleared superadmin scope). Manual
// refresh clears in-memory RQ cache + re-creates socket, hiding the bug.
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('zustand/middleware', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, persist: (fn: unknown) => fn }
})

const serverLogin = vi.fn()
const serverLogout = vi.fn()
vi.mock('../lib/api', () => ({
  authAPI: {
    login: (...args: unknown[]) => serverLogin(...args),
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

describe('authStore logout→login deterministic sequence', () => {
  beforeEach(() => {
    vi.resetModules()
    installMemoryStorage()
    serverLogin.mockReset()
    serverLogout.mockReset()
    cancelQueries.mockClear()
    clearQueries.mockClear()
    disconnectSocket.mockClear()
    serverLogout.mockImplementation(() => new Promise((r) => setTimeout(() => r({}), 5000)))
  })

  it('post-login clears stale queries/socket on account switch (no previous-tenant flash)', async () => {
    const { useAuthStore } = await import('./authStore')
    // Seed previous session (user A, college c1).
    useAuthStore.setState({
      user: { id: 'uA', email: 'a@x.edu', name: 'A', role: 'STUDENT' } as never,
      token: 'tok-A',
      csrfToken: 'csrf-A',
      isAuthenticated: true,
      loading: false,
    })
    // New login as DIFFERENT user (account switch).
    serverLogin.mockResolvedValue({
      user: { id: 'uB', email: 'b@x.edu', name: 'B', role: 'STUDENT' },
      token: 'tok-B',
      csrfToken: 'csrf-B',
    })
    await useAuthStore.getState().login('b@x.edu', 'pw123456')
    // Same-tick: memory + storage agree (persist-then-navigate order).
    const snap = useAuthStore.getState()
    expect(snap.isAuthenticated).toBe(true)
    expect((snap.user as any)?.id).toBe('uB')
    const raw = localStorage.getItem('campusflow-auth')
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string).state.token).toBe('tok-B')
    // Deterministic hygiene: stale tenant cache + old socket must be dropped
    // on account switch (not just on logout), else dashboard flashes uA lists.
    expect(cancelQueries).toHaveBeenCalled()
    expect(clearQueries).toHaveBeenCalled()
    expect(disconnectSocket).toHaveBeenCalled()
  })

  it('post-logout state is cleared synchronously (guard snapshot before navigate)', async () => {
    const { useAuthStore } = await import('./authStore')
    useAuthStore.setState({
      user: { id: 'uA', email: 'a@x.edu', name: 'A', role: 'STUDENT' } as never,
      token: 'tok-A',
      csrfToken: 'csrf-A',
      isAuthenticated: true,
      loading: false,
    })
    const maybe = (useAuthStore.getState().logout as () => unknown)()
    const snap = useAuthStore.getState()
    expect(snap.user).toBeNull()
    expect(snap.isAuthenticated).toBe(false)
    const raw = localStorage.getItem('campusflow-auth')
    expect(JSON.parse(raw as string).state.isAuthenticated).toBe(false)
    if (maybe instanceof Promise) await maybe.catch(() => {})
  })
})
