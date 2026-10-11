/**
 * Leaderboard college isolation — TDD fail-closed (security-audit FAIL Fix 1).
 * Hermetic: supertest + mocked prisma (no DB, no network).
 * Covers: A vs B, null fail-closed, SUPER global, forged ?collegeId ignored, dept oracle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import express from 'express'
import request from 'supertest'

const dbStub: any = vi.hoisted(() => ({} as any))
vi.mock('../src/config/db', () => ({ __esModule: true, default: dbStub }))
vi.mock('../src/middleware/auth', () => ({
  __esModule: true,
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = (req.headers['x-test-user'] as string) || 'u-a'
    next()
  },
}))
vi.mock('../src/services/socket', () => ({
  __esModule: true,
  emitToUser: vi.fn(),
  emitToCollege: vi.fn(),
  broadcastCodingProfileMutation: vi.fn(),
}))
vi.mock('../src/services/syncEngine', () => ({
  __esModule: true,
  syncUserContests: vi.fn(),
  syncAllUsers: vi.fn(),
}))
vi.mock('../src/services/githubActivity', () => ({
  __esModule: true,
  fetchGithubContributions: vi.fn(async () => null),
  getGithubCalendar: vi.fn(async () => null),
  isValidGithubUsername: vi.fn(() => true),
}))
vi.mock('../src/services/codingActivity', () => ({
  __esModule: true,
  ACTIVITY_WINDOW_DAYS: 365,
}))
vi.mock('../src/services/syncThrottleStore', () => ({
  __esModule: true,
  checkAndClaimSyncThrottle: vi.fn(async () => ({ allowed: true })),
  clearSyncThrottleStore: vi.fn(),
}))

import codingProfileRouter from '../src/routes/codingProfile'

const collegeA = '11111111-1111-4111-8111-111111111111'
const collegeB = '22222222-2222-4222-8222-222222222222'
const deptA = 'dept-aaa'
const deptB = 'dept-bbb'

const usersById: Record<string, any> = {
  'u-a': { id: 'u-a', role: 'STUDENT', collegeId: collegeA },
  'u-b': { id: 'u-b', role: 'STUDENT', collegeId: collegeB },
  'u-null': { id: 'u-null', role: 'STUDENT', collegeId: null },
  'u-super': { id: 'u-super', role: 'SUPER_ADMIN', collegeId: null },
}

function app() {
  const a = express()
  a.use(express.json())
  a.use('/', codingProfileRouter)
  return a
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(dbStub)) delete dbStub[k]

  dbStub.user = {
    findUnique: vi.fn(async ({ where }: any) => usersById[where.id] ?? null),
    findMany: vi.fn(async ({ where }: any) => {
      const ids: string[] = where?.id?.in ?? []
      return ids.map((id) => ({
        id,
        name: id === 'user-a1' ? 'Alice' : 'Bob',
        username: id,
        avatar: null,
        departmentId: id === 'user-a1' ? deptA : deptB,
        incomingYear: 2023,
        department: { id: id === 'user-a1' ? deptA : deptB, name: id === 'user-a1' ? 'CSE-A' : 'CSE-B' },
      }))
    }),
  }
  // groupBy simulates real DB filtering: respects where.user.collegeId + dept
  dbStub.contestParticipation = {
    groupBy: vi.fn(async ({ where }: any) => {
      const uf = (where as any)?.user
      const all = [
        { userId: 'user-a1', _count: { _all: 5 }, _avg: { rank: 10, rating: 1600 }, _max: { rating: 1700 } },
        { userId: 'user-b1', _count: { _all: 5 }, _avg: { rank: 12, rating: 1500 }, _max: { rating: 1550 } },
      ]
      if (!uf || Object.keys(uf).length === 0) return all // fail-open global (bug)
      if (uf.collegeId === collegeA && uf.departmentId === deptB) return [] // A + B-dept = no match
      if (uf.collegeId === collegeA) return [all[0]]
      if (uf.collegeId === collegeB) return [all[1]]
      if (uf.departmentId === deptB && !uf.collegeId) return [all[1]] // null-college + deptB leaks B
      if (uf.departmentId && !uf.collegeId) return all
      return all
    }),
    findMany: vi.fn(async () => []),
    count: vi.fn(async () => 0),
  }
  ;(dbStub as any).codingProfile = { findMany: vi.fn(async () => []) }
  dbStub.department = {
    findFirst: vi.fn(async ({ where }: any) => {
      if (where.id === deptA && where.collegeId === collegeA) return { id: deptA, collegeId: collegeA }
      if (where.id === deptB && where.collegeId === collegeB) return { id: deptB, collegeId: collegeB }
      return null
    }),
  }
})

describe('leaderboard college isolation (fail-closed)', () => {
  it('A-user sees only A rows when B rows exist (where.user.collegeId === A)', async () => {
    const res = await request(app()).get('/leaderboard?limit=50&page=1').set('x-test-user', 'u-a')
    expect(res.status).toBe(200)
    const groupByWhere = (dbStub.contestParticipation.groupBy as any).mock.calls[0]?.[0]?.where
    expect(groupByWhere?.user?.collegeId).toBe(collegeA)
    const ids = (res.body.data as any[]).map((r: any) => r.userId)
    expect(ids).toContain('user-a1')
    expect(ids).not.toContain('user-b1')
  })

  it('null-college non-SUPER gets empty (fail-closed, never global)', async () => {
    const res = await request(app()).get('/leaderboard?limit=50&page=1').set('x-test-user', 'u-null')
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
    expect(res.body.pagination.total).toBe(0)
  })

  it('null-college non-SUPER array shape also empty when no pagination', async () => {
    const res = await request(app()).get('/leaderboard').set('x-test-user', 'u-null')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('SUPER_ADMIN sees A+B (global by design)', async () => {
    const res = await request(app()).get('/leaderboard?limit=50&page=1').set('x-test-user', 'u-super')
    expect(res.status).toBe(200)
    const ids = (res.body.data as any[]).map((r: any) => r.userId)
    expect(ids).toEqual(expect.arrayContaining(['user-a1', 'user-b1']))
  })

  it('dept-from-B with A-user returns [] and validates dept belongs to college', async () => {
    const res = await request(app())
      .get(`/leaderboard?limit=50&page=1&departmentId=${deptB}`)
      .set('x-test-user', 'u-a')
    expect(res.status).toBe(200)
    // fail-closed empty (no oracle)
    const data = (res.body as any).data ?? res.body
    expect(data).toEqual([])
    // validation must have run (fail-closed proof)
    expect(dbStub.department.findFirst).toHaveBeenCalled()
    const call = (dbStub.department.findFirst as any).mock.calls[0][0]
    expect(call.where).toMatchObject({ id: deptB, collegeId: collegeA })
  })

  it('forged ?collegeId=B by A-user is ignored (still A-only)', async () => {
    const res = await request(app())
      .get(`/leaderboard?limit=50&page=1&collegeId=${collegeB}`)
      .set('x-test-user', 'u-a')
    expect(res.status).toBe(200)
    const groupByWhere = (dbStub.contestParticipation.groupBy as any).mock.calls[0]?.[0]?.where
    expect(groupByWhere?.user?.collegeId).toBe(collegeA)
    expect(groupByWhere?.user?.collegeId).not.toBe(collegeB)
    const ids = (res.body.data as any[]).map((r: any) => r.userId)
    expect(ids).not.toContain('user-b1')
  })
})

describe('static wiring (leaderboard fail-closed)', () => {
  it('fail-closed null-college guard exists (mirrors hackathons/internships)', () => {
    const s = fs.readFileSync(path.resolve(__dirname, '../src/routes/codingProfile.ts'), 'utf8')
    expect(s).toContain("requester.role !== 'SUPER_ADMIN' && !requester.collegeId")
  })
  it('dept validation via department.findFirst with collegeId exists', () => {
    const s = fs.readFileSync(path.resolve(__dirname, '../src/routes/codingProfile.ts'), 'utf8')
    expect(s).toContain('department.findFirst')
    expect(s).toContain('collegeId: requester.collegeId')
  })
})
