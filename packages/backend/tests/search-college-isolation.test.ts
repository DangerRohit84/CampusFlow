/**
 * Search college isolation — TDD fail-closed (security-audit FAIL Fix 3).
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

import searchRouter from '../src/routes/search'

const collegeA = '11111111-1111-4111-8111-111111111111'
const collegeB = '22222222-2222-4222-8222-222222222222'

const usersById: Record<string, any> = {
  'u-a': { collegeId: collegeA, role: 'STUDENT', departmentId: null },
  'u-b': { collegeId: collegeB, role: 'STUDENT', departmentId: null },
  'u-null': { collegeId: null, role: 'STUDENT', departmentId: null },
  'u-super': { collegeId: null, role: 'SUPER_ADMIN', departmentId: null },
}

function app() {
  const a = express()
  a.use(express.json())
  a.use('/', searchRouter)
  return a
}

const roomA = { id: 'room-a', name: 'Algebra Club A', description: 'A room', teacherId: 't-a', teacher: { collegeId: collegeA } }
const roomB = { id: 'room-b', name: 'Algebra Club B', description: 'B room', teacherId: 't-b', teacher: { collegeId: collegeB } }
const contestA = { id: 'c-a', title: 'Algebra Contest A', platform: 'LEETCODE', status: 'UPCOMING', collegeId: collegeA }
const contestB = { id: 'c-b', title: 'Algebra Contest B', platform: 'LEETCODE', status: 'UPCOMING', collegeId: collegeB }
const contestG = { id: 'c-g', title: 'Algebra Global', platform: 'LEETCODE', status: 'UPCOMING', collegeId: null }

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(dbStub)) delete dbStub[k]

  dbStub.user = {
    findUnique: vi.fn(async ({ where }: any) => usersById[where.id] ?? null),
  }
  const empty = vi.fn(async () => [])
  dbStub.schedule = { findMany: empty }
  dbStub.assignment = { findMany: empty }
  dbStub.assignmentHub = { findMany: empty }
  dbStub.notification = { findMany: empty }
  dbStub.hackathon = { findMany: empty }
  dbStub.internship = { findMany: empty }
  dbStub.form = { findMany: empty }
  dbStub.task = { findMany: empty }
  dbStub.roomMember = { findMany: vi.fn(async () => []) }

  dbStub.room = {
    findMany: vi.fn(async (args: any) => {
      const where = args?.where ?? {}
      // fixed code scopes via teacher.collegeId; fail-open has no teacher key
      const scoped = (where as any)?.teacher?.collegeId
      if (scoped === collegeA) return [roomA]
      if (scoped === collegeB) return [roomB]
      if (scoped === '__no_college__') return []
      if ((where as any)?.teacher) return []
      return [roomA, roomB] // fail-open leak
    }),
  }
  dbStub.codingContest = {
    findMany: vi.fn(async (args: any) => {
      const where = args?.where ?? {}
      const s = JSON.stringify(where)
      // SUPER global: no college key at all, just OR title
      const isSuperGlobal = !s.includes('collegeId')
      if (isSuperGlobal) return [contestA, contestB, contestG]
      // null-college global-only: AND collegeId null
      if (s.includes('"collegeId":null') && !s.includes(collegeA) && !s.includes(collegeB)) return [contestG]
      if (s.includes(collegeA)) return [contestA, contestG]
      if (s.includes(collegeB)) return [contestB, contestG]
      return [contestA, contestB, contestG]
    }),
  }
})

describe('search isolation (rooms + contests fail-closed)', () => {
  it('A-user query matching B-room/B-contest returns zero B rows', async () => {
    const res = await request(app()).get('/?q=algebra').set('x-test-user', 'u-a')
    expect(res.status).toBe(200)
    const results = (res.body as any).results as any[]
    const rooms = results.filter((r: any) => r.type === 'room')
    const contests = results.filter((r: any) => r.type === 'contest')
    expect(rooms.length).toBeGreaterThan(0)
    for (const r of rooms) expect(r.id).not.toBe('room-b')
    for (const c of contests) expect(c.id).not.toBe('c-b')
    // where must be scoped
    const roomWhere = (dbStub.room.findMany as any).mock.calls[0]?.[0]?.where
    expect(JSON.stringify(roomWhere)).toContain(collegeA)
    const contestWhere = (dbStub.codingContest.findMany as any).mock.calls[0]?.[0]?.where
    expect(JSON.stringify(contestWhere)).toContain(collegeA)
  })

  it('SUPER returns all (A+B+global)', async () => {
    const res = await request(app()).get('/?q=algebra').set('x-test-user', 'u-super')
    expect(res.status).toBe(200)
    const results = (res.body as any).results as any[]
    const ids = results.map((r: any) => r.id)
    expect(ids).toEqual(expect.arrayContaining(['room-a', 'room-b', 'c-a', 'c-b']))
  })

  it('null-college returns only global (no B rooms/contests)', async () => {
    const res = await request(app()).get('/?q=algebra').set('x-test-user', 'u-null')
    expect(res.status).toBe(200)
    const results = (res.body as any).results as any[]
    const rooms = results.filter((r: any) => r.type === 'room')
    const contests = results.filter((r: any) => r.type === 'contest')
    expect(rooms).toEqual([])
    for (const c of contests) expect(c.id).not.toBe('c-b')
    expect(contests.map((c: any) => c.id)).toContain('c-g')
  })
})

describe('static wiring (search fail-closed)', () => {
  it('rooms scoped via teacher.collegeId (not whole table)', () => {
    const s = fs.readFileSync(path.resolve(__dirname, '../src/routes/search.ts'), 'utf8')
    expect(s).toContain('teacher: { collegeId')
  })
  it('contests scoped via college OR global (not whole table)', () => {
    const s = fs.readFileSync(path.resolve(__dirname, '../src/routes/search.ts'), 'utf8')
    const seg = s.slice(s.indexOf('prisma.codingContest.findMany'))
    expect(seg).toContain('collegeId')
  })
})
