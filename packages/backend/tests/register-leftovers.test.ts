/**
 * Register leftovers #5 — Unregister + remind-registered + ?mine=true.
 *
 * Hermetic (no DB, no network):
 *  - pure helper unit tests (services/opportunities/registrations.ts)
 *  - supertest flow tests against a minimal Express app that mirrors the
 *    production guards in routes/hackathons.ts + routes/internships.ts via
 *    the SAME helpers (canAccessCollege + registrations SSOT)
 *  - static wiring checks that frontend + routes actually expose the three
 *    features (Register toggles to Unregister, teacher Remind button, mine
 *    tab) so refactors cannot silently drop them.
 *
 * Flows locked:
 *  1. register -> unregister -> reregister (dup 400, unregister 404 when absent)
 *  2. remind scoping (staff of college only, {message} required, registered-only)
 *  3. mine filter (?mine=true returns own registrations only)
 */
import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import fs from 'fs'
import path from 'path'
import {
  parseMineParam,
  applyMineFilter,
  unregisterRoleError,
  canRemind,
  remindRoleError,
  validateRemindMessage,
  buildRemindNotification,
  registeredUserIds,
  REMIND_MESSAGE_MAX_LEN,
} from '../src/services/opportunities/registrations'
import { canAccessCollege } from '../src/utils/roles'

// ─── Pure helpers ────────────────────────────────────────────────────────────

describe('registrations SSOT — pure helpers', () => {
  it('parseMineParam accepts true/1/mine (case-insensitive), rejects everything else', () => {
    expect(parseMineParam({ mine: 'true' })).toBe(true)
    expect(parseMineParam({ mine: 'TRUE' })).toBe(true)
    expect(parseMineParam({ mine: ' True ' })).toBe(true)
    expect(parseMineParam({ mine: '1' })).toBe(true)
    expect(parseMineParam({ mine: 'mine' })).toBe(true)
    expect(parseMineParam({ mine: true })).toBe(true)
    expect(parseMineParam({ mine: 1 })).toBe(true)
    expect(parseMineParam({})).toBe(false)
    expect(parseMineParam({ mine: 'false' })).toBe(false)
    expect(parseMineParam({ mine: '' })).toBe(false)
    expect(parseMineParam({ mine: 'yes' })).toBe(false)
    expect(parseMineParam({ mine: false })).toBe(false)
    expect(parseMineParam(null)).toBe(false)
  })

  it('applyMineFilter returns base untouched when mine=false, ANDs registrations.some when true', () => {
    const base = { collegeId: 'c1' }
    // Same reference when off (no accidental clone breaking === checks).
    expect(applyMineFilter(base, 'u1', false)).toBe(base)
    // Empty base → bare mine clause (no AND wrapper).
    expect(applyMineFilter({} as Record<string, unknown>, 'u1', true)).toEqual({
      registrations: { some: { userId: 'u1' } },
    })
    // Non-empty base → AND [base, mine].
    expect(applyMineFilter(base, 'u1', true)).toEqual({
      AND: [base, { registrations: { some: { userId: 'u1' } } }],
    })
  })

  it('unregister is student-only', () => {
    expect(unregisterRoleError('STUDENT')).toBeNull()
    expect(unregisterRoleError('TEACHER')).toMatch(/only students/i)
    expect(unregisterRoleError('COLLEGE_ADMIN')).toMatch(/only students/i)
    expect(unregisterRoleError('SUPER_ADMIN')).toMatch(/only students/i)
    expect(unregisterRoleError(null)).toMatch(/only students/i)
  })

  it('remind is staff-only (teacher/admin of college)', () => {
    expect(canRemind('TEACHER')).toBe(true)
    expect(canRemind('COLLEGE_ADMIN')).toBe(true)
    expect(canRemind('SUPER_ADMIN')).toBe(true)
    expect(canRemind('STUDENT')).toBe(false)
    expect(canRemind(null)).toBe(false)
    expect(remindRoleError('STUDENT')).toMatch(/teacher|admin/i)
    expect(remindRoleError('TEACHER')).toBeNull()
  })

  it('validateRemindMessage requires 1..1000 chars (trims)', () => {
    expect(validateRemindMessage({})).toEqual({ ok: false, error: 'Message is required' })
    expect(validateRemindMessage({ message: '' })).toEqual({ ok: false, error: 'Message is required' })
    expect(validateRemindMessage({ message: '   ' })).toEqual({ ok: false, error: 'Message is required' })
    expect(validateRemindMessage({ message: 42 })).toEqual({ ok: false, error: 'Message is required' })
    const tooLong = 'x'.repeat(REMIND_MESSAGE_MAX_LEN + 1)
    const longRes = validateRemindMessage({ message: tooLong })
    expect(longRes.ok).toBe(false)
    if (!longRes.ok) expect(longRes.error).toMatch(/too long/i)
    expect(validateRemindMessage({ message: '  hello  ' })).toEqual({ ok: true, message: 'hello' })
    const maxOk = validateRemindMessage({ message: 'y'.repeat(REMIND_MESSAGE_MAX_LEN) })
    expect(maxOk.ok).toBe(true)
  })

  it('buildRemindNotification shapes HACKATHON/INTERNSHIP payloads with source', () => {
    expect(buildRemindNotification('hackathon', 'SIH 2026', 'Round 2 tomorrow', 'h1')).toEqual({
      title: 'Hackathon reminder: SIH 2026',
      message: 'Round 2 tomorrow',
      type: 'HACKATHON',
      source: 'h1',
    })
    expect(buildRemindNotification('internship', 'SDE Intern', 'Apply soon', 'i1')).toEqual({
      title: 'Internship reminder: SDE Intern',
      message: 'Apply soon',
      type: 'INTERNSHIP',
      source: 'i1',
    })
  })

  it('registeredUserIds dedupes + drops empty (remind fan-out list)', () => {
    expect(registeredUserIds([{ userId: 'a' }, { userId: 'b' }, { userId: 'a' }, null, {}, { userId: '' }])).toEqual(['a', 'b'])
    expect(registeredUserIds([])).toEqual([])
  })
})

// ─── Hermetic API app (mirrors production guards) ────────────────────────────

const collegeA = '11111111-1111-4111-8111-111111111111'
const collegeB = '22222222-2222-4222-8222-222222222222'

type TestUser = { id: string; role: string; collegeId: string | null }

function testUser(id: string, role: string, collegeId: string | null): TestUser {
  return { id, role, collegeId }
}

const users: Record<string, TestUser> = {
  studentA: testUser('stu-a', 'STUDENT', collegeA),
  studentA2: testUser('stu-a2', 'STUDENT', collegeA),
  studentA3: testUser('stu-a3', 'STUDENT', collegeA),
  studentB: testUser('stu-b', 'STUDENT', collegeB),
  teacherA: testUser('tch-a', 'TEACHER', collegeA),
  teacherB: testUser('tch-b', 'TEACHER', collegeB),
  adminA: testUser('adm-a', 'COLLEGE_ADMIN', collegeA),
  superAdmin: testUser('sup-1', 'SUPER_ADMIN', null),
}

const hackA = { id: 'hack-aaa', collegeId: collegeA, title: 'SIH 2026' }
const hackB = { id: 'hack-bbb', collegeId: collegeB, title: 'Hack B' }
const internA = { id: 'intern-aaa', collegeId: collegeA, title: 'SDE Intern' }
const internB = { id: 'intern-bbb', collegeId: collegeB, title: 'Intern B' }

function buildApp() {
  const app = express()
  app.use(express.json())

  // In-memory registration sets per opportunity (userIds).
  const hackRegs = new Map<string, Set<string>>([[hackA.id, new Set()], [hackB.id, new Set()]])
  const internRegs = new Map<string, Set<string>>([[internA.id, new Set()], [internB.id, new Set()]])
  // Captured notify fan-out (proves registered-only scoping).
  const notified: Array<{ kind: string; id: string; userIds: string[]; message: string }> = []

  function fakeAuth(req: any, res: any, next: any) {
    const key = req.header('x-test-user')
    const user = key ? (users as any)[key] : null
    if (!user) {
      res.status(401).json({ error: 'No token provided' })
      return
    }
    req.testUser = user as TestUser
    next()
  }

  function lookup(map: Map<string, Set<string>>, id: string) {
    return map.get(id) ?? null
  }

  // ── Hackathons ──
  app.post('/api/hackathons/:id/register', fakeAuth, (req: any, res: any) => {
    const u = req.testUser as TestUser
    if (u.role !== 'STUDENT') {
      res.status(403).json({ error: 'Only students can register' })
      return
    }
    const h = req.params.id === hackA.id ? hackA : req.params.id === hackB.id ? hackB : null
    if (!h) {
      res.status(404).json({ error: 'Hackathon not found' })
      return
    }
    if (!canAccessCollege(u as any, (h as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    const set = lookup(hackRegs, h.id)!
    if (set.has(u.id)) {
      res.status(400).json({ error: 'Already registered' })
      return
    }
    set.add(u.id)
    res.status(201).json({ hackathonId: h.id, userId: u.id })
  })

  app.delete('/api/hackathons/:id/register', fakeAuth, (req: any, res: any) => {
    const u = req.testUser as TestUser
    // Mirrors production: unregisterRoleError + tenant + 404-if-absent.
    const roleErr = unregisterRoleError(u.role)
    if (roleErr) {
      res.status(403).json({ error: roleErr })
      return
    }
    const h = req.params.id === hackA.id ? hackA : req.params.id === hackB.id ? hackB : null
    if (!h) {
      res.status(404).json({ error: 'Hackathon not found' })
      return
    }
    if (!canAccessCollege(u as any, (h as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    const set = lookup(hackRegs, h.id)!
    if (!set.has(u.id)) {
      res.status(404).json({ error: 'Not registered' })
      return
    }
    set.delete(u.id)
    res.json({ success: true })
  })

  app.post('/api/hackathons/:id/remind', fakeAuth, (req: any, res: any) => {
    const u = req.testUser as TestUser
    const roleErr = remindRoleError(u.role)
    if (roleErr) {
      res.status(403).json({ error: roleErr })
      return
    }
    const h = req.params.id === hackA.id ? hackA : req.params.id === hackB.id ? hackB : null
    if (!h) {
      res.status(404).json({ error: 'Hackathon not found' })
      return
    }
    if (!canAccessCollege(u as any, (h as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    const parsed = validateRemindMessage(req.body)
    if (!parsed.ok) {
      res.status(400).json({ error: (parsed as { ok: false; error: string }).error })
      return
    }
    const regs = Array.from(lookup(hackRegs, h.id)!).map((userId) => ({ userId }))
    const userIds = registeredUserIds(regs)
    if (userIds.length === 0) {
      res.json({ notified: 0, message: 'No registered users to remind' })
      return
    }
    const payload = buildRemindNotification('hackathon', h.title, (parsed as { ok: true; message: string }).message, h.id)
    notified.push({ kind: 'hackathon', id: h.id, userIds, message: payload.message })
    res.json({ notified: userIds.length })
  })

  app.get('/api/hackathons', fakeAuth, (req: any, res: any) => {
    const u = req.testUser as TestUser
    const mine = parseMineParam(req.query)
    const all = [hackA, hackB].filter((h) => canAccessCollege(u as any, (h as any).collegeId))
    if (!mine) {
      res.json({ data: all })
      return
    }
    // Mine: AND college gate with registrations.some(userId) — mirrors applyMineFilter.
    const mineOnly = all.filter((h) => lookup(hackRegs, h.id)!.has(u.id))
    res.json({ data: mineOnly })
  })

  // ── Internships (same guards, internship copy) ──
  app.post('/api/internships/:id/register', fakeAuth, (req: any, res: any) => {
    const u = req.testUser as TestUser
    if (u.role !== 'STUDENT') {
      res.status(403).json({ error: 'Only students can register' })
      return
    }
    const it = req.params.id === internA.id ? internA : req.params.id === internB.id ? internB : null
    if (!it) {
      res.status(404).json({ error: 'Internship not found' })
      return
    }
    if (!canAccessCollege(u as any, (it as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    const set = lookup(internRegs, it.id)!
    if (set.has(u.id)) {
      res.status(400).json({ error: 'Already registered' })
      return
    }
    set.add(u.id)
    res.status(201).json({ internshipId: it.id, userId: u.id })
  })

  app.delete('/api/internships/:id/register', fakeAuth, (req: any, res: any) => {
    const u = req.testUser as TestUser
    const roleErr = unregisterRoleError(u.role)
    if (roleErr) {
      res.status(403).json({ error: roleErr })
      return
    }
    const it = req.params.id === internA.id ? internA : req.params.id === internB.id ? internB : null
    if (!it) {
      res.status(404).json({ error: 'Internship not found' })
      return
    }
    if (!canAccessCollege(u as any, (it as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    const set = lookup(internRegs, it.id)!
    if (!set.has(u.id)) {
      res.status(404).json({ error: 'Not registered' })
      return
    }
    set.delete(u.id)
    res.json({ success: true })
  })

  app.post('/api/internships/:id/remind', fakeAuth, (req: any, res: any) => {
    const u = req.testUser as TestUser
    const roleErr = remindRoleError(u.role)
    if (roleErr) {
      res.status(403).json({ error: roleErr })
      return
    }
    const it = req.params.id === internA.id ? internA : req.params.id === internB.id ? internB : null
    if (!it) {
      res.status(404).json({ error: 'Internship not found' })
      return
    }
    if (!canAccessCollege(u as any, (it as any).collegeId)) {
      res.status(403).json({ error: 'Access denied: different college' })
      return
    }
    const parsed = validateRemindMessage(req.body)
    if (!parsed.ok) {
      res.status(400).json({ error: (parsed as { ok: false; error: string }).error })
      return
    }
    const regs = Array.from(lookup(internRegs, it.id)!).map((userId) => ({ userId }))
    const userIds = registeredUserIds(regs)
    if (userIds.length === 0) {
      res.json({ notified: 0, message: 'No registered users to remind' })
      return
    }
    const payload = buildRemindNotification('internship', it.title, (parsed as { ok: true; message: string }).message, it.id)
    notified.push({ kind: 'internship', id: it.id, userIds, message: payload.message })
    res.json({ notified: userIds.length })
  })

  app.get('/api/internships', fakeAuth, (req: any, res: any) => {
    const u = req.testUser as TestUser
    const mine = parseMineParam(req.query)
    const all = [internA, internB].filter((t) => canAccessCollege(u as any, (t as any).collegeId))
    if (!mine) {
      res.json({ data: all })
      return
    }
    res.json({ data: all.filter((t) => lookup(internRegs, t.id)!.has(u.id)) })
  })

  return { app, hackRegs, internRegs, notified }
}

describe('register -> unregister -> reregister (hackathons + internships)', () => {
  it('hackathon: 201 -> dup 400 -> DELETE 200 -> DELETE 404 -> re-POST 201', async () => {
    const { app } = buildApp()
    // Given studentA unregistered / When POST register → Then 201
    const first = await request(app).post(`/api/hackathons/${hackA.id}/register`).set('x-test-user', 'studentA').send({})
    expect(first.status).toBe(201)
    // When POST again → Then 400 dup block (existing behavior preserved)
    const dup = await request(app).post(`/api/hackathons/${hackA.id}/register`).set('x-test-user', 'studentA').send({})
    expect(dup.status).toBe(400)
    expect(dup.body.error).toMatch(/already registered/i)
    // When DELETE register → Then 200 + counts drop
    const del = await request(app).delete(`/api/hackathons/${hackA.id}/register`).set('x-test-user', 'studentA')
    expect(del.status).toBe(200)
    expect(del.body.success).toBe(true)
    // When DELETE again (not registered) → Then 404
    const delAgain = await request(app).delete(`/api/hackathons/${hackA.id}/register`).set('x-test-user', 'studentA')
    expect(delAgain.status).toBe(404)
    expect(delAgain.body.error).toMatch(/not registered/i)
    // When POST after unregister → Then 201 (reregister works)
    const re = await request(app).post(`/api/hackathons/${hackA.id}/register`).set('x-test-user', 'studentA').send({})
    expect(re.status).toBe(201)
  })

  it('internship: 201 -> dup 400 -> DELETE 200 -> DELETE 404 -> re-POST 201', async () => {
    const { app } = buildApp()
    const first = await request(app).post(`/api/internships/${internA.id}/register`).set('x-test-user', 'studentA').send({})
    expect(first.status).toBe(201)
    const dup = await request(app).post(`/api/internships/${internA.id}/register`).set('x-test-user', 'studentA').send({})
    expect(dup.status).toBe(400)
    const del = await request(app).delete(`/api/internships/${internA.id}/register`).set('x-test-user', 'studentA')
    expect(del.status).toBe(200)
    const delAgain = await request(app).delete(`/api/internships/${internA.id}/register`).set('x-test-user', 'studentA')
    expect(delAgain.status).toBe(404)
    const re = await request(app).post(`/api/internships/${internA.id}/register`).set('x-test-user', 'studentA').send({})
    expect(re.status).toBe(201)
  })

  it('unregister is student-own-only: staff 403, x-college 403, same-college non-registered 404', async () => {
    const { app } = buildApp()
    // Given hackA (collegeA) / When teacher tries to unregister → Then 403
    const staff = await request(app).delete(`/api/hackathons/${hackA.id}/register`).set('x-test-user', 'teacherA')
    expect(staff.status).toBe(403)
    // When x-college student guesses A-UUID → Then 403 tenant (before 404 check)
    const cross = await request(app).delete(`/api/hackathons/${hackA.id}/register`).set('x-test-user', 'studentB')
    expect(cross.status).toBe(403)
    expect(cross.body.error).toMatch(/different college/i)
    // When same-college student who never registered → Then 404
    const absent = await request(app).delete(`/api/hackathons/${hackA.id}/register`).set('x-test-user', 'studentA2')
    expect(absent.status).toBe(404)
    // Internship parity: staff 403 + absent 404
    const iStaff = await request(app).delete(`/api/internships/${internA.id}/register`).set('x-test-user', 'teacherA')
    expect(iStaff.status).toBe(403)
    const iAbsent = await request(app).delete(`/api/internships/${internA.id}/register`).set('x-test-user', 'studentA2')
    expect(iAbsent.status).toBe(404)
  })
})

describe('remind-registered scoping (registered users only)', () => {
  it('hackathon: teacher of college notifies registered only; student/x-college denied; message required', async () => {
    const { app, notified } = buildApp()
    // Given 2 of 3 collegeA students registered (stu-a3 left out), plus x-college stu-b elsewhere
    await request(app).post(`/api/hackathons/${hackA.id}/register`).set('x-test-user', 'studentA').send({})
    await request(app).post(`/api/hackathons/${hackA.id}/register`).set('x-test-user', 'studentA2').send({})
    // When student tries to remind → Then 403 (staff-only)
    const studentTry = await request(app).post(`/api/hackathons/${hackA.id}/remind`).set('x-test-user', 'studentA').send({ message: 'hi' })
    expect(studentTry.status).toBe(403)
    // When x-college teacher tries → Then 403 tenant
    const cross = await request(app).post(`/api/hackathons/${hackA.id}/remind`).set('x-test-user', 'teacherB').send({ message: 'hi' })
    expect(cross.status).toBe(403)
    // When message missing/blank → Then 400
    const missing = await request(app).post(`/api/hackathons/${hackA.id}/remind`).set('x-test-user', 'teacherA').send({})
    expect(missing.status).toBe(400)
    const blank = await request(app).post(`/api/hackathons/${hackA.id}/remind`).set('x-test-user', 'teacherA').send({ message: '   ' })
    expect(blank.status).toBe(400)
    // When teacherA reminds → Then 200 notified=2 with registered-only fan-out
    const ok = await request(app).post(`/api/hackathons/${hackA.id}/remind`).set('x-test-user', 'teacherA').send({ message: 'Round 2 tomorrow' })
    expect(ok.status).toBe(200)
    expect(ok.body.notified).toBe(2)
    expect(notified).toHaveLength(1)
    expect(notified[0].userIds.sort()).toEqual(['stu-a', 'stu-a2'])
    // Then unregistered stu-a3 + x-college stu-b were NOT notified
    expect(notified[0].userIds).not.toContain('stu-a3')
    expect(notified[0].userIds).not.toContain('stu-b')
    expect(notified[0].message).toBe('Round 2 tomorrow')
    // College admin of same college may also remind (parity, notified still 2)
    const adminOk = await request(app).post(`/api/hackathons/${hackA.id}/remind`).set('x-test-user', 'adminA').send({ message: 'Final call' })
    expect(adminOk.status).toBe(200)
    expect(adminOk.body.notified).toBe(2)
  })

  it('internship: remind notifies registered only; empty roster returns notified 0', async () => {
    const { app, notified } = buildApp()
    // Given empty roster / When teacher reminds → Then 200 notified 0 (no crash, no college-wide blast)
    const empty = await request(app).post(`/api/internships/${internA.id}/remind`).set('x-test-user', 'teacherA').send({ message: 'hello' })
    expect(empty.status).toBe(200)
    expect(empty.body.notified).toBe(0)
    expect(notified).toHaveLength(0)
    // Given 1 registered / When remind → Then notified 1 (only them)
    await request(app).post(`/api/internships/${internA.id}/register`).set('x-test-user', 'studentA').send({})
    const ok = await request(app).post(`/api/internships/${internA.id}/remind`).set('x-test-user', 'teacherA').send({ message: 'Deadline extended' })
    expect(ok.status).toBe(200)
    expect(ok.body.notified).toBe(1)
    expect(notified[0].userIds).toEqual(['stu-a'])
    // Too-long message rejected before any fan-out
    const longMsg = 'z'.repeat(REMIND_MESSAGE_MAX_LEN + 1)
    const tooLong = await request(app).post(`/api/internships/${internA.id}/remind`).set('x-test-user', 'teacherA').send({ message: longMsg })
    expect(tooLong.status).toBe(400)
    expect(notified).toHaveLength(1)
  })
})

describe('?mine=true (own registrations only)', () => {
  it('hackathon mine returns only own: stu-a → [hackA], stu-b → [hackB], no-mine returns college list', async () => {
    const { app } = buildApp()
    await request(app).post(`/api/hackathons/${hackA.id}/register`).set('x-test-user', 'studentA').send({})
    await request(app).post(`/api/hackathons/${hackB.id}/register`).set('x-test-user', 'studentB').send({})
    // When stu-a lists with ?mine=true → Then only hackA
    const mineA = await request(app).get('/api/hackathons?mine=true').set('x-test-user', 'studentA')
    expect(mineA.status).toBe(200)
    expect(mineA.body.data.map((h: any) => h.id)).toEqual([hackA.id])
    // When stu-b lists with ?mine=true → Then only hackB (tenant + mine compose)
    const mineB = await request(app).get('/api/hackathons?mine=true').set('x-test-user', 'studentB')
    expect(mineB.body.data.map((h: any) => h.id)).toEqual([hackB.id])
    // When stu-a2 (registered nowhere) lists mine → Then []
    const mineEmpty = await request(app).get('/api/hackathons?mine=true').set('x-test-user', 'studentA2')
    expect(mineEmpty.body.data).toEqual([])
    // When stu-a lists without mine → Then college list (hackA, not hackB)
    const all = await request(app).get('/api/hackathons').set('x-test-user', 'studentA')
    expect(all.body.data.map((h: any) => h.id)).toEqual([hackA.id])
  })

  it('internship mine returns only own; unregister removes from mine', async () => {
    const { app } = buildApp()
    await request(app).post(`/api/internships/${internA.id}/register`).set('x-test-user', 'studentA').send({})
    const mineBefore = await request(app).get('/api/internships?mine=true').set('x-test-user', 'studentA')
    expect(mineBefore.body.data.map((t: any) => t.id)).toEqual([internA.id])
    // When unregister → Then mine goes empty (counts update)
    await request(app).delete(`/api/internships/${internA.id}/register`).set('x-test-user', 'studentA')
    const mineAfter = await request(app).get('/api/internships?mine=true').set('x-test-user', 'studentA')
    expect(mineAfter.body.data).toEqual([])
  })
})

// ─── Static wiring (no silent feature drops) ─────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
function readRepo(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')
}

describe('wiring — routes + frontend expose all three leftovers', () => {
  it('backend routes expose DELETE register + POST remind + ?mine on both resources', () => {
    const hacks = readRepo('packages/backend/src/routes/hackathons.ts')
    const interns = readRepo('packages/backend/src/routes/internships.ts')
    for (const [name, src] of [['hackathons', hacks], ['internships', interns]] as const) {
      expect(src, `${name} missing DELETE register`).toContain("router.delete('/:id/register'")
      expect(src, `${name} missing POST remind`).toContain("router.post('/:id/remind'")
      expect(src, `${name} missing mine filter`).toContain('parseMineParam')
      expect(src, `${name} missing registered-only notify`).toContain('notifyUsers')
      expect(src, `${name} missing 404-if-absent`).toContain('Not registered')
    }
    const ssot = readRepo('packages/backend/src/services/opportunities/registrations.ts')
    for (const fn of ['parseMineParam', 'applyMineFilter', 'validateRemindMessage', 'buildRemindNotification', 'registeredUserIds']) {
      expect(ssot, `SSOT missing ${fn}`).toContain(`export function ${fn}`)
    }
  })

  it('frontend api resources expose unregister + remind + mine', () => {
    const src = readRepo('apps/web/src/lib/api/resources/opportunities.ts')
    expect(src).toContain('unregister')
    expect(src).toContain('remind')
    expect(src).toContain('mine')
    expect(src).toContain('/register`)')
    expect(src).toContain('/remind`')
  })

  it('detail pages toggle Register→Unregister (confirm) + teacher Remind (confirm/toast)', () => {
    for (const file of ['apps/web/src/pages/HackathonDetailPage.tsx', 'apps/web/src/pages/InternshipDetailPage.tsx']) {
      const src = readRepo(file)
      expect(src, `${file} missing unregister handler`).toContain('handleUnregister')
      expect(src, `${file} missing unregister api`).toContain('.unregister(')
      expect(src, `${file} missing unregister confirm`).toContain('confirmDialog')
      expect(src, `${file} missing Unregister button`).toContain('Unregister')
      expect(src, `${file} missing remind handler`).toContain('handleRemind')
      expect(src, `${file} missing remind api`).toContain('.remind(')
      expect(src, `${file} missing Remind button`).toContain('Remind registered')
      expect(src, `${file} missing entity sync on mutation`).toContain("notifyEntityMutated('")
    }
  })

  it('list pages + query keys expose the Registered (?mine=true) tab', () => {
    const qk = readRepo('apps/web/src/lib/queryKeys.ts')
    expect(qk).toContain('mine')
    for (const file of ['apps/web/src/pages/HackathonsPage.tsx', 'apps/web/src/pages/InternshipsPage.tsx']) {
      const src = readRepo(file)
      expect(src, `${file} missing registered tab`).toContain("'registered'")
      expect(src, `${file} missing Registered label`).toContain('Registered')
      expect(src, `${file} missing mine query`).toContain('mine: true')
      expect(src, `${file} must thread AbortSignal`).toMatch(/queryFn:\s*\(\{\s*signal\s*\}/)
    }
  })
})
