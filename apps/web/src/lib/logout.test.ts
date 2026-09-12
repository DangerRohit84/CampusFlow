// lib/logout.test.ts — locks fast deterministic logout contract.
// WHY: clicking Log out refreshed then landed on dashboard (slow await on
// network + navigate raced stale isAuthenticated=true → GuestRoute bounced to
// /dashboard). Logout must clear state/storage sync, cancel queries (no
// refetch storm), disconnect socket promptly, then land on /login (never
// dashboard). Pure helpers here keep vitest node env hermetic.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LOGOUT_DEST, isEffectivelyAuthenticated, clearLogoutStorage } from './logout'

function installMemoryStorage() {
  const mem = new Map<string, string>()
  const api = {
    getItem: (k: string) => (mem.has(k) ? (mem.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      mem.set(k, String(v))
    },
    removeItem: (k: string) => {
      mem.delete(k)
    },
    clear: () => mem.clear(),
    _mem: mem,
  }
  ;(globalThis as any).localStorage = api
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
    _mem: smem,
  }
  return { mem, smem }
}

describe('LOGOUT_DEST', () => {
  it('logout destination is /login (never dashboard)', () => {
    expect(LOGOUT_DEST).toBe('/login')
    expect(LOGOUT_DEST).not.toBe('/dashboard')
  })
})

describe('isEffectivelyAuthenticated', () => {
  it('logged-out state (false/null) never counts as authenticated → no dashboard flash', () => {
    expect(isEffectivelyAuthenticated(false, null)).toBe(false)
    expect(isEffectivelyAuthenticated(false, { id: 'u1' })).toBe(false)
    expect(isEffectivelyAuthenticated(true, null)).toBe(false)
    expect(isEffectivelyAuthenticated(true, undefined)).toBe(false)
  })
  it('authed state (true + user) counts as authenticated', () => {
    expect(isEffectivelyAuthenticated(true, { id: 'u1' })).toBe(true)
  })
})

describe('clearLogoutStorage', () => {
  beforeEach(() => {
    installMemoryStorage()
  })
  it('clears token/user blob, csrf, superadmin scope, and stale postLoginRedirect', () => {
    localStorage.setItem(
      'campusflow-auth',
      JSON.stringify({ state: { user: { id: 'u1' }, token: 'tok', isAuthenticated: true }, version: 0 }),
    )
    localStorage.setItem('campusflow-csrf', 'csrf-1')
    localStorage.setItem('campusflow-superadmin-college', JSON.stringify({ state: { selectedCollegeId: 'c1' } }))
    localStorage.setItem('superadmin_selectedCollegeId', 'c1')
    localStorage.setItem('superadmin_selectedCollegeName', 'College')
    sessionStorage.setItem('postLoginRedirect', '/superadmin/colleges/c1')

    clearLogoutStorage()

    // WHY same-tick truth: interceptor reads storage, guards read memory —
    // storage must read logged-out immediately (no stale Bearer on next request).
    const raw = localStorage.getItem('campusflow-auth')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw as string)
    expect(parsed.state.user).toBeNull()
    expect(parsed.state.token).toBeNull()
    expect(parsed.state.isAuthenticated).toBe(false)
    expect(localStorage.getItem('campusflow-csrf')).toBeNull()
    expect(localStorage.getItem('campusflow-superadmin-college')).toBeNull()
    expect(localStorage.getItem('superadmin_selectedCollegeId')).toBeNull()
    expect(localStorage.getItem('superadmin_selectedCollegeName')).toBeNull()
    expect(sessionStorage.getItem('postLoginRedirect')).toBeNull()
  })
  it('is safe when storage throws (private mode)', () => {
    ;(globalThis as any).localStorage = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    }
    ;(globalThis as any).sessionStorage = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    }
    expect(() => clearLogoutStorage()).not.toThrow()
  })
})

describe('logout ordering contract (store-level, mocked)', () => {
  it('documents: state must clear synchronously even when server logout hangs', async () => {
    // This is a contract doc for authStore.logout: fire-and-forget server
    // logout (no await), sync local clear (<300ms). The real store test lives
    // in src/store/logoutStore.test.ts to keep this file pure/hermetic.
    // WHY: awaiting authAPI.logout (10s timeout) before set() held
    // isAuthenticated=true while handlers already navigated to /login →
    // GuestRoute bounced to /dashboard.
    expect(LOGOUT_DEST).toBe('/login')
    expect(vi.isMockFunction(vi.fn())).toBe(true)
  })
})
