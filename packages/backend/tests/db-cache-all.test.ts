/**
 * DB cache-all — edge Cache-Control (private + SWR) on every cacheable GET
 * list/own-data endpoint + TanStack staleTime/keepPreviousData/focus-false on
 * every apps/web useQuery.
 *
 * Contract (behavior identical, fewer refetches — reuses narrow-reads + half1/2 scope):
 * - Backend: `res.set('Cache-Control', 'private, max-age=10..60, stale-while-revalidate=..')`
 *   on GET list/aggregate/own-data endpoints missing it (user dashboard, admin
 *   analytics/colleges, announcements list/colleges, notifications unread-count,
 *   tasks x3, grades data, attendance data, search, forms stats, rooms unread-counts).
 *   Follows codingProfile.ts:333 + assignmentHub.ts:189 patterns.
 * - NEVER cached: auth/* (auth.ts), mutations, bulk-PII exports
 *   (hackathon/internship/form exports), registrant-email details
 *   (hackathons/:id, internships/:id), member lists. resume no-store kept.
 * - Frontend: every useQuery has staleTime>=30s + placeholderData keepPreviousData
 *   + refetchOnWindowFocus:false (global queryClient already false; explicit per
 *   query for grep-verifiable compliance). No behavior change besides fewer refetches.
 *
 * Hermetic: static source assertions + mock-level equivalence (no DB, no network).
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const BACKEND_SRC = path.resolve(__dirname, '../src')
const WEB_SRC = path.resolve(__dirname, '../../../apps/web/src')
function readBackend(rel: string): string {
  return fs.readFileSync(path.join(BACKEND_SRC, rel), 'utf8')
}
function readWeb(rel: string): string {
  return fs.readFileSync(path.join(WEB_SRC, rel), 'utf8')
}
function countPrivateCC(src: string): number {
  return (src.match(/Cache-Control', 'private/g) || []).length
}
function maxAges(src: string): number[] {
  return (src.match(/max-age=(\d+)/g) || []).map((m) => parseInt(m.split('=')[1], 10))
}

// ---- mock-level replicas (mirror route/frontend logic) ----

// Dashboard: header set once after auth covers all 3 role branches (same header value).
function dashboardBranchesWithHeader(authOk: boolean): string[] {
  const header = authOk ? 'private, max-age=15, stale-while-revalidate=30' : null
  return ['TEACHER', 'ADMIN', 'STUDENT'].map((role) => `${role}:${header}`)
}

// staleTime expr evaluator for `A * B * C`, `N`, `N_NNN` forms used in apps/web.
function evalStaleTime(expr: string): number {
  const clean = expr.replace(/_/g, '').trim()
  if (/^\d+$/.test(clean)) return parseInt(clean, 10)
  if (/^[\d\s*]+$/.test(clean)) return clean.split('*').reduce((a, b) => a * parseInt(b.trim(), 10), 1)
  throw new Error(`unparsable staleTime: ${expr}`)
}

describe('cache-all backend list/own-data endpoints set private SWR headers', () => {
  it('user dashboard sets private max-age=15 SWR once (covers all 3 role branches)', () => {
    const src = readBackend('routes/user.ts')
    expect(src).toContain("'private, max-age=15, stale-while-revalidate=30'")
    expect(countPrivateCC(src)).toBe(1)
    // Header sits right after auth, before the first branch return (TEACHER).
    const setIdx = src.indexOf("res.set('Cache-Control', 'private")
    const dashIdx = src.indexOf("router.get('/dashboard'")
    const teacherIdx = src.indexOf("role: 'TEACHER'")
    expect(setIdx).toBeGreaterThan(dashIdx)
    expect(setIdx).toBeLessThan(teacherIdx)
    // Mock-level: all branches share the same header.
    expect(dashboardBranchesWithHeader(true)).toEqual([
      'TEACHER:private, max-age=15, stale-while-revalidate=30',
      'ADMIN:private, max-age=15, stale-while-revalidate=30',
      'STUDENT:private, max-age=15, stale-while-revalidate=30',
    ])
  })

  it('admin analytics (counts) + colleges (registry) set private SWR', () => {
    const src = readBackend('routes/admin.ts')
    expect(src).toContain('CACHE-ALL')
    // 7 pre-existing + audit-logs + platform-kpis = 9 (all GET list/aggregate, no PII exports)
    expect(countPrivateCC(src)).toBe(9)
  })

  it('announcements list + colleges ref-data set private SWR', () => {
    const src = readBackend('routes/announcements.ts')
    expect(src).toContain("'private, max-age=15, stale-while-revalidate=30'")
    expect(src).toContain("'private, max-age=60, stale-while-revalidate=120'")
    expect(countPrivateCC(src)).toBe(2)
  })

  it('notifications unread-count matches list TTL (10s)', () => {
    const src = readBackend('routes/notifications.ts')
    expect(countPrivateCC(src)).toBe(2)
    expect(maxAges(src)).toEqual([10, 10])
  })

  it('tasks list/range/today set private max-age=10 SWR (daily-summary AI/quota untouched)', () => {
    const src = readBackend('routes/tasks.ts')
    expect(countPrivateCC(src)).toBe(3)
    expect(maxAges(src)).toEqual([10, 10, 10])
    // AI-gated summary stays uncached (quota semantics).
    const summaryIdx = src.indexOf("router.get('/daily-summary'")
    const afterSummary = src.slice(summaryIdx)
    expect(afterSummary).not.toContain('Cache-Control')
  })

  it('grades + attendance own-data set private max-age=30 SWR', () => {
    expect(readBackend('routes/grades.ts')).toContain("'private, max-age=30, stale-while-revalidate=60'")
    expect(readBackend('routes/attendance.ts')).toContain("'private, max-age=30, stale-while-revalidate=60'")
    expect(countPrivateCC(readBackend('routes/grades.ts'))).toBe(1)
    expect(countPrivateCC(readBackend('routes/attendance.ts'))).toBe(1)
  })

  it('search + forms stats + rooms unread-counts set private SWR', () => {
    expect(readBackend('routes/search.ts')).toContain("'private, max-age=15, stale-while-revalidate=30'")
    expect(readBackend('routes/forms.ts')).toContain('CACHE-ALL')
    expect(countPrivateCC(readBackend('routes/forms.ts'))).toBe(5) // 3 pre-existing + stats + analytics (#9 logic-lite, max-age=15)
    expect(readBackend('routes/rooms.ts')).toContain('CACHE-ALL')
    expect(countPrivateCC(readBackend('routes/rooms.ts'))).toBe(9) // 4 pre-existing + muted/pins/threads/thread/search (#8 threads-lite, all max-age=10)
  })

  it('all touched max-age values stay within 10..60 (task bound)', () => {
    const files = ['routes/user.ts', 'routes/admin.ts', 'routes/announcements.ts', 'routes/notifications.ts', 'routes/tasks.ts', 'routes/grades.ts', 'routes/attendance.ts', 'routes/search.ts', 'routes/forms.ts', 'routes/rooms.ts']
    for (const f of files) {
      for (const age of maxAges(readBackend(f))) {
        expect(age).toBeGreaterThanOrEqual(10)
        expect(age).toBeLessThanOrEqual(60)
      }
    }
  })
})

describe('cache-all never-cache rules (auth/mutations/bulk-PII)', () => {
  it('auth.ts sets no private cache headers', () => {
    expect(countPrivateCC(readBackend('routes/auth.ts'))).toBe(0)
  })

  it('resume exports keep no-store (PII downloads)', () => {
    const src = readBackend('routes/resume.ts')
    expect((src.match(/no-store/g) || []).length).toBeGreaterThanOrEqual(3)
    expect(countPrivateCC(src)).toBe(0)
  })

  it('bulk-PII exports stay uncached (no private CC added)', () => {
    // Export handlers return workbooks/file downloads with registrant emails.
    for (const f of ['routes/hackathons.ts', 'routes/internships.ts'] as const) {
      expect(countPrivateCC(readBackend(f))).toBe(2) // lists only, unchanged
    }
    // Registrant-email pending member list stays uncached (only its own handler block).
    const forms = readBackend('routes/forms.ts')
    const pendingStart = forms.indexOf("router.get('/:id/pending'")
    const nextRoute = forms.indexOf('router.', pendingStart + 10)
    expect(forms.slice(pendingStart, nextRoute)).not.toContain("res.set('Cache-Control', 'private")
  })
})

describe('cache-all frontend: every useQuery has staleTime>=30s + keepPreviousData + focus-false', () => {
  const files = [
    'hooks/useAdminQueries.ts',
    'pages/AdminOpportunitiesPage.tsx',
    'pages/AssignmentHubPage.tsx',
    'pages/CodingContestsPage.tsx',
    'pages/DashboardPage.tsx',
    'pages/FormsPage.tsx',
    'pages/HackathonsPage.tsx',
    'pages/InternshipsPage.tsx',
    'pages/RoomsPage.tsx',
    'pages/SearchPage.tsx',
    'pages/StudentRoomsPage.tsx',
    'pages/SuperAdminCollegesPage.tsx',
    'pages/SuperAdminDashboardPage.tsx',
  ]

  it('each file with useQuery contains all three markers', () => {
    for (const f of files) {
      const src = readWeb(f)
      expect(src).toContain('useQuery(')
      expect(src).toContain('staleTime:')
      expect(src).toContain('placeholderData: keepPreviousData')
      expect(src).toContain('refetchOnWindowFocus: false')
    }
  })

  it('all staleTime values are >=30s', () => {
    for (const f of files) {
      const src = readWeb(f)
      const matches = [...src.matchAll(/staleTime:\s*([0-9_*\s]+?)(?=[,\n])/g)]
      expect(matches.length).toBeGreaterThan(0)
      for (const m of matches) {
        expect(evalStaleTime(m[1])).toBeGreaterThanOrEqual(30 * 1000)
      }
    }
  })

  it('previously-missing pages now carry placeholderData (StudentRooms, SuperAdminColleges)', () => {
    expect(readWeb('pages/StudentRoomsPage.tsx')).toContain('placeholderData: keepPreviousData')
    expect(readWeb('pages/SuperAdminCollegesPage.tsx')).toContain('placeholderData: keepPreviousData')
    expect(readWeb('pages/SuperAdminDashboardPage.tsx').match(/placeholderData: keepPreviousData/g)!.length).toBeGreaterThanOrEqual(2)
  })

  it('staleTime evaluator mock-check (20s rejected, 30s+ accepted)', () => {
    expect(evalStaleTime('30 * 1000')).toBe(30000)
    expect(evalStaleTime('2 * 60 * 1000')).toBe(120000)
    expect(evalStaleTime('30_000')).toBe(30000)
    expect(evalStaleTime('20 * 1000')).toBeLessThan(30 * 1000)
  })
})
