/**
 * BOLA / IDOR hermetic API suite — 8 cases (CampusFlow 10k testing gate).
 *
 * Hermetic like p0-parity.test.ts: no DB, no network, in-memory fixtures only.
 * Uses supertest against a minimal Express app that mirrors production guards
 * in packages/backend/src/routes/hackathons.ts / internships.ts / publicProfile.ts
 * via the SAME helpers from src/utils/roles.ts:
 *   canAccessCollege / maskEmail / safeFilename / contentDisposition / escapeExcelValue
 *
 * Coverage (8):
 *   1. cross-college hack detail 403 (B-college -> A-UUID) + same-college 200
 *   2. hack export role+tenant gate (STUDENT 403, x-college TEACHER 403, owner 200 + safe header)
 *   3. hack rounds cross-college 403 (F03 tenant+owner)
 *   4. hack staging cross-college 403 (F04/F15)
 *   5. internship detail cross-college 403 (parity with hack detail)
 *   6. internship export cross-college 403 (parity with hack export)
 *   7. public email mask (anon masked, authed full)
 *   8. filename injection (CRLF/quotes stripped, RFC5987 header, CSV formula guard)
 */
import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import {
  canAccessCollege,
  maskEmail,
  safeFilename,
  contentDisposition,
  escapeExcelValue,
} from '../src/utils/roles'

// ── Test Data Builders (sensible defaults, override only what matters) ──
const collegeA = '11111111-1111-4111-8111-111111111111'
const collegeB = '22222222-2222-4222-8222-222222222222'

type TestUser = { id: string; role: string; collegeId: string | null; name?: string; email?: string }

function aUser(overrides: Partial<TestUser> = {}): TestUser {
  return {
    id: 'user-a-1',
    role: 'STUDENT',
    collegeId: collegeA,
    name: 'Alice',
    email: 'alice@college-a.edu',
    ...overrides,
  }
}

const users: Record<string, TestUser> = {
  studentA: aUser({ id: 'stu-a', role: 'STUDENT', collegeId: collegeA }),
  studentB: aUser({ id: 'stu-b', role: 'STUDENT', collegeId: collegeB, email: 'bob@college-b.edu' }),
  teacherA: aUser({ id: 'tch-a', role: 'TEACHER', collegeId: collegeA, email: 'tch@college-a.edu' }),
  teacherB: aUser({ id: 'tch-b', role: 'TEACHER', collegeId: collegeB, email: 'tch@college-b.edu' }),
  adminA: aUser({ id: 'adm-a', role: 'COLLEGE_ADMIN', collegeId: collegeA }),
  superAdmin: aUser({ id: 'sup-1', role: 'SUPER_ADMIN', collegeId: null }),
}

// In-memory tenant resources (collegeA-owned)
const hackA = {
  id: 'hack-aaa',
  collegeId: collegeA,
  creatorId: 'tch-a',
  title: 'Smart India Hackathon',
  registrations: [
    { userId: 'stu-a', teamName: 'Alpha' },
    { userId: 'stu-other', teamName: 'Beta' },
  ],
}
const stagingA = { id: 'staging-aaa', collegeId: collegeA, title: 'Draft Hack' }
const internshipA = {
  id: 'intern-aaa',
  collegeId: collegeA,
  creatorId: 'tch-a',
  title: 'SDE Intern',
  registrations: [{ userId: 'stu-a' }, { userId: 'stu-other' }],
}
const publicUser = { username: 'janedoe', email: 'jane.doe@college.edu', name: 'Jane Doe' }

function buildApp() {
  const app = express()
  app.use(express.json())

  // Fake auth: x-test-user header selects fixture; missing => 401 (except public routes).
  // Mirrors authenticate() fail-closed + authorize() role check shape.
  function fakeAuth(allowedRoles?: string[]) {
    return (req: any, res: any, next: any) => {
      const key = req.header('x-test-user')
      const user = key ? (users as any)[key] : null
      if (!user) {
        res.status(401).json({ error: 'No token provided' })
        return
      }
      req.testUser = user as TestUser
      if (allowedRoles && !(allowedRoles as string[]).includes((user as TestUser).role)) {
        res.status(403).json({ error: 'Insufficient permissions' })
        return
      }
      next()
    }
  }

  // IMPORTANT: /staging/:id before /:id (same order as hackathons.ts) or :id shadows staging.
  app.get('/api/hackathons/staging/:id', fakeAuth(['TEACHER', 'COLLEGE_ADMIN', 'SUPER_ADMIN']), (req: any, res: any) => {
    // Given a staging draft owned by collegeA
    if (req.params.id !== stagingA.id) {
      res.status(404).json({ error: 'Staging hackathon not found' })
      return
    }
    // When requester is x-college → Then 403 (F15 tenant gate, mirrors hackathons.ts:770)
    if ((stagingA as any).collegeId && !canAccessCollege(req.testUser, (stagingA as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    res.json(stagingA)
  })

  app.get('/api/hackathons/:id/export', fakeAuth(), (req: any, res: any) => {
    const u = req.testUser as TestUser
    // Given role gate (mirrors hackathons.ts:1199 — only staff may bulk-export PII)
    if (u.role !== 'TEACHER' && u.role !== 'COLLEGE_ADMIN' && u.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Export requires teacher or admin role' })
      return
    }
    if (req.params.id !== hackA.id) {
      res.status(404).json({ error: 'Hackathon not found' })
      return
    }
    // When x-college → Then 403 (F02 tenant gate, mirrors :1219)
    if (!canAccessCollege(u, (hackA as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    // TEACHER may only export own (mirrors :1224)
    if (u.role === 'TEACHER' && (hackA as any).creatorId !== u.id) {
      res.status(403).json({ error: 'Can only export your own hackathons' })
      return
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', contentDisposition(`${safeFilename(hackA.title, 'hackathon')}.xlsx`))
    res.send('fake-xlsx-bytes')
  })

  app.get('/api/hackathons/:id', fakeAuth(), (req: any, res: any) => {
    const u = req.testUser as TestUser
    if (req.params.id !== hackA.id) {
      res.status(404).json({ error: 'Hackathon not found' })
      return
    }
    // When B-college guesses A-UUID → Then 403 (F01 BOLA, mirrors hackathons.ts:807)
    if (!canAccessCollege(u, (hackA as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    // STUDENT own-only (mirrors :813 — strip other students' PII)
    if (u.role === 'STUDENT') {
      const own = (hackA as any).registrations.filter((r: any) => r.userId === u.id)
      res.json({ ...hackA, registrations: own })
      return
    }
    res.json(hackA)
  })

  app.post('/api/hackathons/:id/rounds', fakeAuth(['TEACHER', 'COLLEGE_ADMIN', 'SUPER_ADMIN']), (req: any, res: any) => {
    const u = req.testUser as TestUser
    if (req.params.id !== hackA.id) {
      res.status(404).json({ error: 'Hackathon not found' })
      return
    }
    // F03: tenant + owner (mirrors hackathons.ts:1005/1010)
    if (!canAccessCollege(u, (hackA as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    if (u.role === 'TEACHER' && (hackA as any).creatorId !== u.id) {
      res.status(403).json({ error: 'Can only add rounds to your own hackathons' })
      return
    }
    res.status(201).json({ id: 'round-1', hackathonId: hackA.id, ...req.body })
  })

  app.get('/api/internships/:id', fakeAuth(), (req: any, res: any) => {
    const u = req.testUser as TestUser
    if (req.params.id !== internshipA.id) {
      res.status(404).json({ error: 'Internship not found' })
      return
    }
    // Parity with hack detail (mirrors internships.ts:290)
    if (!canAccessCollege(u, (internshipA as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    if (u.role === 'STUDENT') {
      const own = (internshipA as any).registrations.filter((r: any) => r.userId === u.id)
      res.json({ ...internshipA, registrations: own })
      return
    }
    res.json(internshipA)
  })

  app.get('/api/internships/export/:id', fakeAuth(), (req: any, res: any) => {
    const u = req.testUser as TestUser
    if (u.role !== 'TEACHER' && u.role !== 'COLLEGE_ADMIN' && u.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Not authorized' })
      return
    }
    if (req.params.id !== internshipA.id) {
      res.status(404).json({ error: 'Internship not found' })
      return
    }
    // Mirrors internships.ts:562
    if (!canAccessCollege(u, (internshipA as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', contentDisposition(`${safeFilename(internshipA.title, 'internship')}-registrations.xlsx`))
    res.send('fake-xlsx-bytes')
  })

  // Public profile: anon gets masked, authed gets full (mirrors publicProfile.ts:266)
  app.get('/api/u/:username', (req: any, res: any) => {
    if (req.params.username !== publicUser.username) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    const auth = req.header('authorization')
    const isAuthed = !!auth && auth.startsWith('Bearer ')
    const visibleEmail = isAuthed ? publicUser.email : maskEmail(publicUser.email)
    res.set('X-Robots-Tag', 'noindex, nofollow')
    res.json({ user: { ...publicUser, email: visibleEmail } })
  })

  // Filename probe: proves F17 header-injection guard end-to-end via HTTP header
  app.get('/api/export/filename', fakeAuth(), (req: any, res: any) => {
    const title = String(req.query.title ?? '')
    const cells = Array.isArray(req.query.cell) ? req.query.cell : [req.query.cell].filter(Boolean)
    const escaped = (cells as string[]).map((c) => escapeExcelValue(String(c)))
    res.setHeader('Content-Disposition', contentDisposition(title || 'export'))
    res.json({ safe: safeFilename(title), escaped })
  })

  return app
}

describe('BOLA hermetic API suite (supertest, no DB)', () => {
  it('1. cross-college hack detail is denied (B-college -> A-UUID 403), same-college allowed', async () => {
    // Given hackA owned by collegeA
    const app = buildApp()
    // When studentB (collegeB) guesses hackA UUID → Then 403 (F01 BOLA)
    const denied = await request(app).get(`/api/hackathons/${hackA.id}`).set('x-test-user', 'studentB')
    expect(denied.status).toBe(403)
    expect(denied.body.error).toMatch(/different college/i)
    // When studentA (same college) reads → Then 200 with own-only registrations
    const allowed = await request(app).get(`/api/hackathons/${hackA.id}`).set('x-test-user', 'studentA')
    expect(allowed.status).toBe(200)
    expect(allowed.body.id).toBe(hackA.id)
    expect(allowed.body.registrations).toHaveLength(1)
    expect(allowed.body.registrations[0].userId).toBe('stu-a')
  })

  it('2. hack export requires staff + same college (STUDENT 403, x-college TEACHER 403, owner 200 + safe header)', async () => {
    const app = buildApp()
    // Given hackA / When STUDENT exports → Then 403 (F02, avoids silent exfil confusion)
    const student = await request(app).get(`/api/hackathons/${hackA.id}/export`).set('x-test-user', 'studentA')
    expect(student.status).toBe(403)
    // When x-college TEACHER exports → Then 403 tenant gate
    const cross = await request(app).get(`/api/hackathons/${hackA.id}/export`).set('x-test-user', 'teacherB')
    expect(cross.status).toBe(403)
    // When owner TEACHER exports → Then 200 + safe Content-Disposition (F17 header)
    const owner = await request(app).get(`/api/hackathons/${hackA.id}/export`).set('x-test-user', 'teacherA')
    expect(owner.status).toBe(200)
    expect(owner.headers['content-disposition']).toContain('attachment;')
    expect(owner.headers['content-disposition']).toContain('filename="')
    expect(owner.headers['content-disposition']).toContain("filename*=UTF-8''")
    expect(owner.headers['content-disposition']).not.toMatch(/[\r\n]/)
  })

  it('3. hack rounds cross-college write is denied (F03 tenant+owner)', async () => {
    const app = buildApp()
    // Given hackA (creator tch-a, collegeA)
    // When teacherB (x-college) POSTs a round → Then 403
    const denied = await request(app)
      .post(`/api/hackathons/${hackA.id}/rounds`)
      .set('x-test-user', 'teacherB')
      .send({ roundNumber: 1, title: 'Qualifier' })
    expect(denied.status).toBe(403)
    // When owner teacherA POSTs → Then 201
    const allowed = await request(app)
      .post(`/api/hackathons/${hackA.id}/rounds`)
      .set('x-test-user', 'teacherA')
      .send({ roundNumber: 1, title: 'Qualifier' })
    expect(allowed.status).toBe(201)
    expect(allowed.body.hackathonId).toBe(hackA.id)
  })

  it('4. hack staging cross-college read is denied (F04/F15)', async () => {
    const app = buildApp()
    // Given stagingA owned by collegeA
    // When teacherB (collegeB) reads → Then 403
    const denied = await request(app).get(`/api/hackathons/staging/${stagingA.id}`).set('x-test-user', 'teacherB')
    expect(denied.status).toBe(403)
    // When teacherA (same college) reads → Then 200
    const allowed = await request(app).get(`/api/hackathons/staging/${stagingA.id}`).set('x-test-user', 'teacherA')
    expect(allowed.status).toBe(200)
    expect(allowed.body.id).toBe(stagingA.id)
  })

  it('5. internship detail cross-college is denied (parity with hack detail)', async () => {
    const app = buildApp()
    // Given internshipA owned by collegeA
    // When studentB guesses UUID → Then 403 (mirrors internships.ts:290)
    const denied = await request(app).get(`/api/internships/${internshipA.id}`).set('x-test-user', 'studentB')
    expect(denied.status).toBe(403)
    // When studentA reads → Then 200 own-only
    const allowed = await request(app).get(`/api/internships/${internshipA.id}`).set('x-test-user', 'studentA')
    expect(allowed.status).toBe(200)
    expect(allowed.body.registrations).toHaveLength(1)
  })

  it('6. internship export cross-college is denied (parity with hack export)', async () => {
    const app = buildApp()
    // When STUDENT exports → Then 403 (staff-only, mirrors internships.ts:552)
    const student = await request(app).get(`/api/internships/export/${internshipA.id}`).set('x-test-user', 'studentA')
    expect(student.status).toBe(403)
    // When x-college TEACHER exports → Then 403 tenant gate
    const cross = await request(app).get(`/api/internships/export/${internshipA.id}`).set('x-test-user', 'teacherB')
    expect(cross.status).toBe(403)
    // When same-college TEACHER exports → Then 200 + safe header
    const allowed = await request(app).get(`/api/internships/export/${internshipA.id}`).set('x-test-user', 'teacherA')
    expect(allowed.status).toBe(200)
    expect(allowed.headers['content-disposition']).toContain('attachment;')
  })

  it('7. public profile masks email for anon, reveals for authed (F05/W7)', async () => {
    const app = buildApp()
    // Given public user jane.doe@college.edu
    // When anon (no Bearer) reads → Then masked j***@college.edu
    const anon = await request(app).get(`/api/u/${publicUser.username}`)
    expect(anon.status).toBe(200)
    expect(anon.body.user.email).toBe('j***@college.edu')
    expect(anon.headers['x-robots-tag']).toMatch(/noindex/)
    // When authed (Bearer) reads → Then full email
    const authed = await request(app).get(`/api/u/${publicUser.username}`).set('authorization', 'Bearer fake-valid')
    expect(authed.status).toBe(200)
    expect(authed.body.user.email).toBe(publicUser.email)
  })

  it('8. filename injection is neutralized (CRLF/quotes stripped, CSV formulas escaped)', async () => {
    const app = buildApp()
    // Given CRLF + quote injection attempt (response splitting, F17)
    const evil = 'evil\r\nContent-Length: 0".xlsx'
    // When export header is built → Then no CR/LF/quote in header, safe fallback present
    const res = await request(app)
      .get('/api/export/filename')
      .query({ title: evil, cell: ['=1+1', 'plain'] })
      .set('x-test-user', 'teacherA')
    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).not.toMatch(/[\r\n]/)
    // Header must carry both filename="..." and RFC5987 filename*
    expect(res.headers['content-disposition']).toContain('filename="')
    expect(res.headers['content-disposition']).toContain("filename*=UTF-8''")
    // Body proves safeFilename + escapeExcelValue parity (F27 CSV injection)
    expect(res.body.safe).not.toMatch(/[\r\n"]/)
    expect(res.body.safe).not.toMatch(/[\\/]/)
    expect(res.body.escaped[0]).toBe("'=1+1")
    expect(res.body.escaped[1]).toBe('plain')
  })
})
