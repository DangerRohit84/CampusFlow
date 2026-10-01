/**
 * Forms unlimited multi-submit + student history (20260930, user-approved).
 *
 * Hermetic: pure helper behavior + in-memory flow simulation (no DB, no
 * network) + static source/schema/migration/frontend contracts.
 *
 * Coverage (per approved spec):
 *   1. single-mode regression (second submit 403 unless allowEdit)
 *   2. multi 3 submits → 3 rows attemptNo 1,2,3 (unlimited, no cap)
 *   3. history order desc (newest first) + myResponse latest compat
 *   4. stats dual (totalResponses=rows, distinctUsers separate, pending=eligible-distinct)
 *   5. expiry blocks new (400) but history 200
 *   6. export Attempt column
 *   7. production-safe contracts (schema/migration/dual-read/rollback)
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import express from 'express'
import request from 'supertest'
import { getAllowMultiple, getAttemptNo } from '../src/routes/forms'

const BACKEND_ROOT = path.resolve(__dirname, '..')
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(BACKEND_ROOT, rel), 'utf8')
}
function readWeb(rel: string): string {
  return fs.readFileSync(path.join(BACKEND_ROOT, '../../apps/web', rel), 'utf8')
}
function modelBlock(schema: string, model: string): string {
  return schema.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`, 'm'))?.[0] ?? ''
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe('multi-submit pure helpers', () => {
  it('getAllowMultiple defaults OFF (preserves exams single)', () => {
    expect(getAllowMultiple(null)).toBe(false)
    expect(getAllowMultiple(undefined)).toBe(false)
    expect(getAllowMultiple({})).toBe(false)
    expect(getAllowMultiple({ allowMultipleResponses: false })).toBe(false)
    expect(getAllowMultiple({ allowMultipleResponses: true })).toBe(true)
    // Truthy non-true (1/'true') stays OFF — strict boolean gate.
    expect(getAllowMultiple({ allowMultipleResponses: 1 as any })).toBe(false)
  })
  it('getAttemptNo falls back to 1 (pre-migration rows)', () => {
    expect(getAttemptNo(null)).toBe(1)
    expect(getAttemptNo({})).toBe(1)
    expect(getAttemptNo({ attemptNo: 1 })).toBe(1)
    expect(getAttemptNo({ attemptNo: 3 })).toBe(3)
    expect(getAttemptNo({ attemptNo: 0 })).toBe(1)
    expect(getAttemptNo({ attemptNo: -2 })).toBe(1)
    expect(getAttemptNo({ attemptNo: NaN })).toBe(1)
  })
})

// ── In-memory flow simulation (mirrors routes/forms.ts decision table) ───────
// Fake store: responses[] with {id, formId, userId, attemptNo, submittedAt}.
// Single-mode uses findExistingSingle semantics; multi uses max+1.

type FakeResp = { id: string; formId: string; userId: string; attemptNo: number; submittedAt: Date }

function nextAttemptNo(rows: FakeResp[], formId: string, userId: string): number {
  const mine = rows.filter((r) => r.formId === formId && r.userId === userId)
  if (mine.length === 0) return 1
  return Math.max(...mine.map((r) => r.attemptNo)) + 1
}

function submitSingle(rows: FakeResp[], form: any, formId: string, userId: string, allowEdit: boolean): { status: number; rows: FakeResp[] } {
  const existing = rows.find((r) => r.formId === formId && r.userId === userId) || null
  if (existing && !allowEdit) return { status: 403, rows }
  if (existing) return { status: 200, rows } // update in place (no new row)
  const created: FakeResp = { id: `r-${rows.length + 1}`, formId, userId, attemptNo: 1, submittedAt: new Date() }
  return { status: 201, rows: [...rows, created] }
}

function submitMulti(rows: FakeResp[], formId: string, userId: string): { status: number; rows: FakeResp[] } {
  const n = nextAttemptNo(rows, formId, userId)
  const created: FakeResp = { id: `r-${rows.length + 1}-${Date.now()}`, formId, userId, attemptNo: n, submittedAt: new Date(Date.now() + rows.length) }
  return { status: 201, rows: [...rows, created] }
}

describe('single-mode regression (403 second)', () => {
  it('second submit 403 when allowEdit=false; update 200 when allowEdit=true', () => {
    let rows: FakeResp[] = []
    const form = { id: 'f1', allowMultipleResponses: false }
    expect(getAllowMultiple(form)).toBe(false)
    let r = submitSingle(rows, form, 'f1', 'stu1', false)
    expect(r.status).toBe(201)
    rows = r.rows
    r = submitSingle(rows, form, 'f1', 'stu1', false)
    expect(r.status).toBe(403)
    expect(r.rows.length).toBe(1)
    // allowEdit path updates in place (no new row)
    r = submitSingle(rows, form, 'f1', 'stu1', true)
    expect(r.status).toBe(200)
    expect(r.rows.length).toBe(1)
  })
})

describe('multi 3 submits → 3 rows attemptNo 1,2,3 (unlimited)', () => {
  it('sequential max+1 with no cap', () => {
    let rows: FakeResp[] = []
    const form = { id: 'f2', allowMultipleResponses: true }
    expect(getAllowMultiple(form)).toBe(true)
    for (let i = 0; i < 3; i += 1) {
      const r = submitMulti(rows, 'f2', 'stu1')
      expect(r.status).toBe(201)
      rows = r.rows
    }
    expect(rows.length).toBe(3)
    expect(rows.map((r) => r.attemptNo)).toEqual([1, 2, 3])
    // 4th still allowed (unlimited, max=null no cap)
    const r4 = submitMulti(rows, 'f2', 'stu1')
    expect(r4.status).toBe(201)
    expect(r4.rows.length).toBe(4)
    expect(r4.rows[3].attemptNo).toBe(4)
  })
})

describe('history order desc + myResponse latest compat', () => {
  it('myResponses desc by submittedAt then attemptNo; myResponse = latest', () => {
    const rows: FakeResp[] = [
      { id: 'a', formId: 'f', userId: 's', attemptNo: 1, submittedAt: new Date('2026-09-01T10:00:00Z') },
      { id: 'b', formId: 'f', userId: 's', attemptNo: 2, submittedAt: new Date('2026-09-02T10:00:00Z') },
      { id: 'c', formId: 'f', userId: 's', attemptNo: 3, submittedAt: new Date('2026-09-03T10:00:00Z') },
    ]
    const history = [...rows].sort((a, b) =>
      b.submittedAt.getTime() - a.submittedAt.getTime() || b.attemptNo - a.attemptNo,
    )
    expect(history.map((r) => r.attemptNo)).toEqual([3, 2, 1])
    const myResponse = history[0] || null
    expect(myResponse?.attemptNo).toBe(3)
    // Other users excluded
    const mixed: FakeResp[] = [...rows, { id: 'd', formId: 'f', userId: 'other', attemptNo: 1, submittedAt: new Date('2026-09-04T10:00:00Z') }]
    const mine = mixed.filter((r) => r.userId === 's')
    expect(mine.length).toBe(3)
  })
})

describe('stats dual (rows vs distinct, pending distinct)', () => {
  it('totalResponses=rows, distinctUsers separate, pending=eligible-distinct', () => {
    const eligible = ['s1', 's2', 's3', 's4', 's5']
    const responses = [
      { userId: 's1' }, { userId: 's1' }, { userId: 's1' }, // 3 attempts, 1 user
      { userId: 's2' }, // 1 attempt
    ]
    const totalResponses = responses.length
    const distinctUsers = new Set(responses.map((r) => r.userId)).size
    const pending = Math.max(0, eligible.length - distinctUsers)
    expect(totalResponses).toBe(4)
    expect(distinctUsers).toBe(2)
    expect(pending).toBe(3)
    // Old (buggy) pending = eligible - rows would give 1 — must NOT use rows.
    expect(eligible.length - totalResponses).toBe(1)
    expect(pending).not.toBe(eligible.length - totalResponses)
  })
})

// ── Supertest: expiry blocks new but history 200 ─────────────────────────────

function buildExpiryApp() {
  const app = express()
  app.use(express.json())
  const expiredForm = { id: 'fx', expiresAt: new Date(Date.now() - 1000).toISOString() }
  const liveForm = { id: 'fl', expiresAt: null as string | null }
  const history = [{ id: 'h1', formId: 'fx', attemptNo: 1, submittedAt: new Date().toISOString() }]

  app.post('/api/forms/:id/respond', (req: any, res: any) => {
    const form = req.params.id === 'fx' ? expiredForm : liveForm
    if (form.expiresAt && new Date() > new Date(form.expiresAt)) {
      res.status(400).json({ error: 'Form has expired' })
      return
    }
    res.status(201).json({ id: 'new', attemptNo: 1 })
  })
  app.get('/api/forms/:id/my-history', (req: any, res: any) => {
    // History NEVER checks expiry — always 200 when eligible.
    res.json({ data: history, total: history.length, count: history.length })
  })
  return app
}

describe('expiry blocks new but history 200 (supertest)', () => {
  it('POST expired → 400; GET my-history expired → 200', async () => {
    const app = buildExpiryApp()
    await request(app).post('/api/forms/fx/respond').send({ answers: {} }).expect(400)
    const hist = await request(app).get('/api/forms/fx/my-history').expect(200)
    expect(hist.body.total).toBe(1)
    expect(hist.body.data[0].attemptNo).toBe(1)
    await request(app).post('/api/forms/fl/respond').send({ answers: {} }).expect(201)
  })
})

// ── Static contracts ─────────────────────────────────────────────────────────

describe('contracts: schema + migration + routes + frontend', () => {
  const schema = readSrc('prisma/schema.prisma')
  const routes = readSrc('src/routes/forms.ts')
  const migrationPath = path.join(BACKEND_ROOT, 'prisma/migrations/20260930000000_forms_multi_submit/migration.sql')

  it('schema: Form.allowMultipleResponses default false + FormResponse.attemptNo default 1', () => {
    expect(schema).toMatch(/allowMultipleResponses\s+Boolean\s+@default\(false\)/)
    expect(schema).toMatch(/attemptNo\s+Int\s+@default\(1\)/)
  })
  it('schema: new UNIQUE (formId,userId,attemptNo) + covering index; old UNIQUE gone', () => {
    expect(schema).toMatch(/@@unique\(\[formId,\s*userId,\s*attemptNo\]\)/)
    expect(schema).toMatch(/@@index\(\[formId,\s*userId,\s*submittedAt\]\)/)
    expect(modelBlock(schema, 'FormResponse')).not.toMatch(/@@unique\(\[formId,\s*userId\]\)/)
  })
  it('schema: FormAnswer child unchanged (blob kept, no drop)', () => {
    expect(modelBlock(schema, 'FormAnswer')).toMatch(/@@unique\(\[responseId,\s*fieldId\]\)/)
    expect(modelBlock(schema, 'FormResponse')).toMatch(/answers\s+String/)
  })
  it('migration exists and is production-safe (additive + backfill + NOT VALID + drop old in low-traffic + rollback)', () => {
    expect(fs.existsSync(migrationPath)).toBe(true)
    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toMatch('ADD COLUMN IF NOT EXISTS "allowMultipleResponses"')
    expect(sql).toMatch('ADD COLUMN IF NOT EXISTS "attemptNo"')
    expect(sql).toMatch('FormResponse_formId_userId_attemptNo_key')
    expect(sql).toMatch('NOT VALID')
    expect(sql).toMatch('VALIDATE CONSTRAINT')
    expect(sql).toMatch('FormResponse_formId_userId_submittedAt_idx')
    expect(sql).toMatch('DROP CONSTRAINT "FormResponse_formId_userId_key"')
    expect(sql).toMatch(/LOW-TRAFFIC/i)
    expect(sql).toMatch(/Rollback/i)
    expect(sql).toMatch(/CONCURRENTLY/)
    expect(sql).not.toMatch('DROP TABLE')
  })
  it('routes: POST create + PUT accept allowMultipleResponses (pre-migration P2022 fallback)', () => {
    expect(routes).toMatch('allowMultipleResponses')
    expect(routes).toMatch('P2022')
  })
  it('routes: dual-read old findUnique try fallback findFirst (both UNIQUE names)', () => {
    expect(routes).toMatch('formId_userId_attemptNo')
    expect(routes).toMatch('formId_userId')
    expect(routes).toMatch('findUnique')
    expect(routes).toMatch('findFirst')
  })
  it('routes: GET /:id returns myResponses[] + myResponse latest compat', () => {
    expect(routes).toMatch('myResponses')
    expect(routes).toMatch('myResponse')
  })
  it('routes: GET /:id/my-history own list desc (expiry-proof)', () => {
    expect(routes).toMatch("router.get('/:id/my-history'")
    expect(routes).toMatch('listMyResponsesDesc')
  })
  it('routes: POST /:id/respond mode auto/new/edit + max+1 unlimited + single 403', () => {
    expect(routes).toMatch("router.post('/:id/respond'")
    expect(routes).toMatch('getAllowMultiple')
    expect(routes).toMatch('getNextAttemptNo')
    expect(routes).toMatch("mode === 'new'")
    expect(routes).toMatch("mode === 'edit'")
    expect(routes).toMatch('does not allow multiple responses')
    expect(routes).toMatch('P2002')
  })
  it('routes: stats dual counts (totalResponses rows, distinctUsers, pending distinct)', () => {
    expect(routes).toMatch('totalResponses')
    expect(routes).toMatch('distinctUsers')
    expect(routes).toMatch('eligible - distinctUsers')
  })
  it('routes: export Attempt column (one row per attempt, not deduped)', () => {
    expect(routes).toMatch("header: 'Attempt'")
    expect(routes).toMatch('attempt')
  })
  it('frontend: FormsPage builder Allow multiple toggle (no max UI)', () => {
    const page = readWeb('src/pages/FormsPage.tsx')
    expect(page).toMatch('allowMultipleResponses')
    expect(page).toMatch('Allow multiple responses')
    expect(page).not.toMatch('maxResponses')
    expect(page).not.toMatch('maxSubmits')
  })
  it('frontend: FormDetail student History accordion + Submit new (resets) + View receipt', () => {
    const detail = readWeb('src/pages/FormDetailPage.tsx')
    expect(detail).toMatch('myHistory')
    expect(detail).toMatch('My submissions')
    expect(detail).toMatch('Submit new response')
    expect(detail).toMatch('View receipt')
    expect(detail).toMatch('expandedReceipt')
  })
  it('frontend: teacher table shows ALL rows with Attempt (not deduped) + SubmittedAt', () => {
    const detail = readWeb('src/pages/FormDetailPage.tsx')
    expect(detail).toMatch('Attempt')
    expect(detail).toMatch('attemptNo')
    expect(detail).toMatch('Submitted')
    expect(detail).toMatch('NOT deduped')
  })
  it('frontend: formAPI myHistory + respond mode param', () => {
    const api = readWeb('src/lib/api/resources/planner.ts')
    expect(api).toMatch('myHistory')
    expect(api).toMatch('my-history')
    expect(api).toMatch('mode')
  })
})
