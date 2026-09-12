// store/authRedirect.test.ts — locks role → landing map (login-redirect fix).
// WHY: college-admin login toasted but stayed on /login after a superadmin
// session. Root causes: no explicit COLLEGE_ADMIN landing, stale superadmin
// postLoginRedirect honored cross-role, stale superadmin scope. These pure
// helpers are the contract LoginPage + GuestRoute/LandingRoute must follow.
import { describe, it, expect } from 'vitest'
import { getLandingRouteForRole, isSuperAdminRoute, resolvePostLoginDest } from '../lib/authRedirect'

describe('getLandingRouteForRole', () => {
  it('maps SUPER_ADMIN to /superadmin', () => {
    expect(getLandingRouteForRole('SUPER_ADMIN')).toBe('/superadmin')
  })
  it('maps COLLEGE_ADMIN explicitly to /dashboard (not fallthrough)', () => {
    expect(getLandingRouteForRole('COLLEGE_ADMIN')).toBe('/dashboard')
  })
  it('maps STUDENT and TEACHER to /dashboard', () => {
    expect(getLandingRouteForRole('STUDENT')).toBe('/dashboard')
    expect(getLandingRouteForRole('TEACHER')).toBe('/dashboard')
  })
  it('falls back to /dashboard for unknown/null/undefined', () => {
    expect(getLandingRouteForRole('UNKNOWN' as never)).toBe('/dashboard')
    expect(getLandingRouteForRole(null)).toBe('/dashboard')
    expect(getLandingRouteForRole(undefined)).toBe('/dashboard')
    expect(getLandingRouteForRole('')).toBe('/dashboard')
  })
})

describe('isSuperAdminRoute', () => {
  it('detects superadmin-only routes', () => {
    expect(isSuperAdminRoute('/superadmin')).toBe(true)
    expect(isSuperAdminRoute('/superadmin/colleges')).toBe(true)
    expect(isSuperAdminRoute('/superadmin/colleges/abc?collegeId=abc')).toBe(true)
    expect(isSuperAdminRoute('/admin/fetch')).toBe(true)
    expect(isSuperAdminRoute('/admin/ai-manager')).toBe(true)
    expect(isSuperAdminRoute('/admin/dashboard')).toBe(true)
  })
  it('rejects tenant + public routes and junk', () => {
    expect(isSuperAdminRoute('/dashboard')).toBe(false)
    expect(isSuperAdminRoute('/admin')).toBe(false)
    expect(isSuperAdminRoute('/login')).toBe(false)
    expect(isSuperAdminRoute('')).toBe(false)
    expect(isSuperAdminRoute(null)).toBe(false)
    expect(isSuperAdminRoute('https://evil.com/superadmin')).toBe(false)
  })
})

describe('resolvePostLoginDest', () => {
  it('honors valid saved redirect for same-role user', () => {
    expect(resolvePostLoginDest('/schedule', 'COLLEGE_ADMIN')).toBe('/schedule')
    expect(resolvePostLoginDest('/superadmin/colleges', 'SUPER_ADMIN')).toBe('/superadmin/colleges')
    expect(resolvePostLoginDest('/dashboard?tab=1', 'STUDENT')).toBe('/dashboard?tab=1')
  })
  it('ignores stale superadmin saved route after switch to COLLEGE_ADMIN', () => {
    // Exact bug: superadmin 401 saved /superadmin/..., college-admin login honored it → 403 bounce.
    expect(resolvePostLoginDest('/superadmin/colleges/xyz', 'COLLEGE_ADMIN')).toBe('/dashboard')
    expect(resolvePostLoginDest('/superadmin', 'STUDENT')).toBe('/dashboard')
    expect(resolvePostLoginDest('/admin/fetch', 'TEACHER')).toBe('/dashboard')
  })
  it('falls back to role landing for /login, /register, junk', () => {
    expect(resolvePostLoginDest('/login', 'COLLEGE_ADMIN')).toBe('/dashboard')
    expect(resolvePostLoginDest('/register', 'COLLEGE_ADMIN')).toBe('/dashboard')
    expect(resolvePostLoginDest('', 'COLLEGE_ADMIN')).toBe('/dashboard')
    expect(resolvePostLoginDest(null, 'COLLEGE_ADMIN')).toBe('/dashboard')
    expect(resolvePostLoginDest('https://evil.com', 'COLLEGE_ADMIN')).toBe('/dashboard')
  })
  it('falls back to /superadmin landing for SUPER_ADMIN with junk saved', () => {
    expect(resolvePostLoginDest('/login', 'SUPER_ADMIN')).toBe('/superadmin')
    expect(resolvePostLoginDest(null, 'SUPER_ADMIN')).toBe('/superadmin')
  })
})
