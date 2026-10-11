/**
 * Contest + participants college isolation — TDD fail-closed (security-audit FAIL Fix 2).
 * Hermetic: supertest + mocked prisma (no DB, no network).
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
  broadcastContestMutation: vi.fn(),
  emitToUser: vi.fn(),
  emitToCollege: vi.fn(),
  broadcastCodingProfileMutation: vi.fn(),
}))
vi.mock('../src/services/contestFetcher', () => ({
  __esModule: true,
  fetchAndStoreContests: vi.fn(async () => ({ fetched: 0, updated: 0 })),
}))
vi.mock('../src/lib/cache', () => ({
  __esModule: true,
  getOrSet: vi.fn(async (_k: string, _t: number, fn: any) => fn()),
}))
vi.mock('../src/services/conditionalGet', () => ({
  __esModule: true,
  sendConditionalList: (req: any, res: any, body: any) => res.json(body),
}))
vi.mock('../src/services/listCache', () => ({
  __esModule: true,
  CONTESTS_LIST_TTL_MS: 300000,
  contestsListKey: vi.fn(() => 'k'),
  getContestsListVersion: vi.fn(async () => 0),
  bustContestsList: vi.fn(),
  listScopeForUser: vi.fn(() => 'test'),
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

import contestsRouter from '../src/routes/contests'
import codingProfileRouter from '../src/routes/codingProfile'

const collegeA = '11111111-1111-4111-8111-111111111111'
const collegeB = '22222222-2222-4222-8222-222222222222'

const usersById: Record<string, any> = {
  'u-a': { id: 'u-a', role: 'STUDENT', collegeId: collegeA },
  'u-b': { id: 'u-b', role: 'STUDENT', collegeId: collegeB },
  'u-null': { id: 'u-null', role: 'STUDENT', collegeId: null },
  'u-super': { id: 'u-super', role: 'SUPER_ADMIN', collegeId: null },
}

const contestA = {
  id: 'contest-a',
  title: 'A Contest',
  platform: 'LEETCODE',
  url: 'https://leetcode.com/contest/a/',
  startTime: '2026-09-12T15:30:00.000Z',
  collegeId: collegeA,
  creatorId: 'teacher-a',
}
const contestGlobal = {
  id: 'contest-g',
  title: 'Global Contest',
  platform: 'LEETCODE',
  url: 'https://leetcode.com/contest/g/',
  startTime: '2026-09-12T15:30:00.000Z',
  collegeId: null,
  creatorId: null,
}

function contestsApp() {
  const a = express()
  a.use(express.json())
  a.use('/', contestsRouter)
  return a
}
function participantsApp() {
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
    findMany: vi.fn(async () => []),
  }
  dbStub.codingContest = {
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.id === 'contest-a') return contestA
      if (where.id === 'contest-g') return contestGlobal
      return null
    }),
    findMany: vi.fn(async () => []),
    count: vi.fn(async () => 0),
  }
  const narrow = { id: true, name: true, avatar: true, departmentId: true, incomingYear: true } as any
  void narrow
  dbStub.contestParticipation = {
    // primary respects where.user.collegeId when fixed; fail-open returns all
    findMany: vi.fn(async (args: any) => {
      const where = args?.where ?? {}
      const all = [
        { id: 'p-a1', contestId: 'contest-a', contestName: 'A Contest', platform: 'LEETCODE', rank: 1, user: { id: 'user-a1', name: 'Alice', collegeId: collegeA } },
        { id: 'p-b1', contestId: 'contest-a', contestName: 'A Contest', platform: 'LEETCODE', rank: 2, user: { id: 'user-b1', name: 'Bob', collegeId: collegeB } },
      ]
      const scoped = (where as any)?.user?.collegeId
      if (scoped === collegeA) return [all[0]]
      if (scoped === collegeB) return [all[1]]
      return all
    }),
    count: vi.fn(async (args: any) => {
      const where = (args as any)?.where ?? {}
      const scoped = (where as any)?.user?.collegeId
      if (scoped === collegeA || scoped === collegeB) return 1
      return 2
    }),
    groupBy: vi.fn(async () => []),
  }
  ;(dbStub as any).codingProfile = { findMany: vi.fn(async () => []) }
  dbStub.department = { findFirst: vi.fn(async () => null) }
})

describe('contest detail isolation (GET /contests/:id)', () => {
  it('B-user GET A-contest → 404, A-user → 200', async () => {
    const rb = await request(contestsApp()).get('/contest-a').set('x-test-user', 'u-b')
    expect(rb.status).toBe(404)
    const ra = await request(contestsApp()).get('/contest-a').set('x-test-user', 'u-a')
    expect(ra.status).toBe(200)
    expect((ra.body as any).id).toBe('contest-a')
  })
  it('SUPER sees A-contest (global by design)', async () => {
    const r = await request(contestsApp()).get('/contest-a').set('x-test-user', 'u-super')
    expect(r.status).toBe(200)
  })
  it('null-college sees global but not A-contest', async () => {
    const rg = await request(contestsApp()).get('/contest-g').set('x-test-user', 'u-null')
    expect(rg.status).toBe(200)
    const ra = await request(contestsApp()).get('/contest-a').set('x-test-user', 'u-null')
    expect(ra.status).toBe(404)
  })
})

describe('participants isolation (GET /coding-profile/contest/:id/participants)', () => {
  it('B-user participants for A-contest sees no A rows (scoped)', async () => {
    const res = await request(participantsApp())
      .get('/contest/contest-a/participants?limit=50&page=1')
      .set('x-test-user', 'u-b')
    expect(res.status).toBe(200)
    const rows = (res.body as any).data ?? res.body
    const ids = (rows as any[]).map((r: any) => r.user?.id ?? r.userId)
    expect(ids).not.toContain('user-a1')
    // where must be college-scoped
    const where = (dbStub.contestParticipation.findMany as any).mock.calls[0]?.[0]?.where
    expect(where?.user?.collegeId).toBe(collegeB)
  })
  it('null-college non-SUPER gets empty (fail-closed)', async () => {
    const res = await request(participantsApp())
      .get('/contest/contest-a/participants?limit=50&page=1')
      .set('x-test-user', 'u-null')
    expect(res.status).toBe(200)
    const data = (res.body as any).data ?? res.body
    expect(data).toEqual([])
  })
  it('SUPER sees all participants', async () => {
    const res = await request(participantsApp())
      .get('/contest/contest-a/participants?limit=50&page=1')
      .set('x-test-user', 'u-super')
    expect(res.status).toBe(200)
    const rows = (res.body as any).data ?? res.body
    expect((rows as any[]).length).toBe(2)
  })
})

describe('static wiring (contest + participants fail-closed)', () => {
  it('GET /:id checks canUserSeeContest (like siblings)', () => {
    const s = fs.readFileSync(path.resolve(__dirname, '../src/routes/contests.ts'), 'utf8')
    const seg = s.slice(s.indexOf("// Get single coding contest"))
    expect(seg).toContain('canUserSeeContest')
    expect(seg).toContain("404")
  })
  it('participants primary is college-scoped (user.collegeId)', () => {
    const s = fs.readFileSync(path.resolve(__dirname, '../src/routes/codingProfile.ts'), 'utf8')
    const seg = s.slice(s.indexOf('/contest/:contestId/participants'))
    expect(seg).toContain('participantUserScope')
    expect(seg).toContain('collegeId')
  })
})
