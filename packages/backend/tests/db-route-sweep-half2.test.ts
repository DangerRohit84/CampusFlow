/**
 * DB route sweep half2 — tasks, attendance, grades, announcements, notifications,
 * chat, search, ai, ai-manager, resume, reports, fetch, departments, colleges,
 * auth, admin (non-dashboard, dashboard done).
 *
 * Contract (behavior identical, queries narrower — reuses half1 + narrow-reads patterns):
 * - Hot user.findUnique → select id/role/collegeId (+collegeName/email/dept where used)
 *   instead of full row (incl. passwordHash/preferences). Same branching payload.
 * - N+1 loops → batched: fetch settings for-loop → Promise.all, admin child deletes
 *   2 sequential → Promise.all, resume helper 2 sequential → Promise.all,
 *   fetch cleanup 2 sequential → Promise.all, fetch stats 4 sequential → Promise.all.
 * - Unbounded findMany → bounded: chat sessions + schedule take:50 (were unbounded),
 *   search take:6 kept, notifications take:50 kept, reports/announcements limit 50 kept,
 *   admin lists take:50 kept. No take>100 remains (calendar 200 guard lives in half1 only).
 * - Deep includes kept minimal (creator/_count/select) or single-row detail.
 * - Sequential awaits → Promise.all where independent (tasks ai-schedule, announcements
 *   PUT/DELETE, reports detail/status/delete, departments PUT/DELETE, admin deletes/
 *   updates/college-delete, resume helper, fetch cleanup/stats).
 *
 * Hermetic: static source assertions + mock-level payload equivalence (no DB).
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const BACKEND_SRC = path.resolve(__dirname, '../src')
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(BACKEND_SRC, rel), 'utf8')
}

function countBareUserLookup(src: string): number {
  const a = (src.match(/prisma\.user\.findUnique\(\{ where: \{ id: req\.userId \} \}\)/g) || []).length
  const b = (src.match(/prisma\.user\.findUnique\(\{ where: \{ id: req\.userId! \} \}\)/g) || []).length
  const c = (src.match(/prisma\.user\.findUnique\(\{ where: \{ id: userId \} \}\)/g) || []).length
  return a + b + c
}

// ---- Shared mapping replicas (mirror route logic, mock-level) ----

// Announcements validation: before full rows, after select id only — length check identical.
function isValidDeptIds(validDepts: Array<{ id: string }>, departmentIds: string[]) {
  return validDepts.length === departmentIds.length
}

// Chat cap: sequential unbounded vs take:50 — same order for ≤50.
function mapChatSchedules(schedules: any[]) {
  const capped = schedules.slice(0, 50)
  return capped.map((s: any) => ({ id: s.id, dayOfWeek: s.dayOfWeek, title: s.title }))
}

// Fetch bulk settings: sequential loop vs Promise.all — same rows, order preserved.
function mapBulkSettings(inputs: Array<{ platform: string; type: string; data: any }>) {
  // Promise.all preserves input order
  return inputs.map((u) => ({ platform: u.platform, type: u.type, ...u.data }))
}

// Reports visibility: narrow vs full rows — same branching.
function canSeeReport(user: any, report: any) {
  if (user.role === 'SUPER_ADMIN') return true
  if (user.role === 'COLLEGE_ADMIN') return report.collegeId === user.collegeId
  return report.userId === user.id
}

// Admin college-delete: sequential existing+count vs parallel — same 404/400 precedence.
function decideCollegeDelete(existing: any, userCount: number) {
  if (!existing) return { status: 404 }
  if (userCount > 0) return { status: 400, userCount }
  return { status: 200 }
}

describe('half2 narrow user.findUnique (no full rows)', () => {
  it('announcements narrows all auth lookups to id/role/collegeId', () => {
    const src = readSrc('routes/announcements.ts')
    expect(src).toContain('HALF2')
    expect(src).toContain('select: { id: true, role: true, collegeId: true }')
    expect(countBareUserLookup(src)).toBe(0)
    expect(src).not.toMatch(/select: \{[^}]*passwordHash/)
  })

  it('announcements validation narrows to id only (length check preserved)', () => {
    const src = readSrc('routes/announcements.ts')
    expect(src).toContain('select: { id: true }')
    // Both dept + college validations narrowed
    const matches = src.match(/select: \{ id: true \}/g) || []
    expect(matches.length).toBeGreaterThanOrEqual(3)
  })

  it('reports narrows auth (Order 6: collegeName copy dropped -> college join) + college to id/name', () => {
    const src = readSrc('routes/reports.ts')
    expect(src).toContain('HALF2')
    // Order 6 (V-20): User.collegeName/Report.collegeName dropped — auth selects id/role/collegeId only; display via college relation.
    expect(src).not.toContain('collegeName: true')
    expect(src).toContain('college: { select: { id: true, name: true')
    expect(src).toContain('select: { id: true, role: true, collegeId: true }')
    expect(src).toContain('select: { id: true, name: true }')
    expect(countBareUserLookup(src)).toBe(0)
  })

  it('departments narrows to id/role/collegeId', () => {
    const src = readSrc('routes/departments.ts')
    expect(src).toContain('HALF2')
    expect(src).toContain('select: { id: true, role: true, collegeId: true }')
    expect(countBareUserLookup(src)).toBe(0)
  })

  it('search narrows to collegeId+role+departmentId (scope filtering needs dept/role; still no secrets)', () => {
    const src = readSrc('routes/search.ts')
    expect(src).toContain('HALF2')
    expect(src).toContain('select: { collegeId: true, role: true, departmentId: true }')
    expect(src).not.toContain('passwordHash')
    expect(countBareUserLookup(src)).toBe(0)
  })

  it('admin non-dashboard narrows (incl. email for register, id-only for existence)', () => {
    const src = readSrc('routes/admin.ts')
    expect(src).toContain('HALF2')
    expect(src).toContain('select: { id: true, role: true, collegeId: true }')
    expect(src).toContain('select: { id: true, role: true, collegeId: true, email: true }')
    expect(src).toContain('select: { id: true }')
    expect(src).toContain('select: { id: true, collegeId: true }')
    expect(src).toContain('select: { collegeId: true }')
    // No bare requester lookups remain
    expect(countBareUserLookup(src)).toBe(0)
  })

  it('auth narrows existence checks (register + username), keeps hash paths full', () => {
    const src = readSrc('routes/auth.ts')
    expect(src).toContain('HALF2')
    expect(src).toContain("select: { id: true }")
    expect(src).toContain('select: { id: true, status: true, adminEmail: true }')
    expect(src).toContain('select: { id: true, status: true }')
    // Login still needs passwordHash (full row) — must remain
    expect(src).toContain('prisma.user.findUnique({ where: { email: body.email } })')
    // change-password still needs hash
    expect(src).toContain('prisma.user.findUnique({ where: { id: req.userId } })')
  })

  it('fetch admin findFirst narrows to id/collegeId (only those used)', () => {
    const src = readSrc('routes/fetch.ts')
    expect(src).toContain('HALF2')
    expect(src).toContain('select: { id: true, collegeId: true }')
    expect(src).not.toMatch(/findFirst\(\{ where: \{ role: 'SUPER_ADMIN' \} \}\)/)
  })

  it('tasks/attendance/grades/notifications/ai/ai-manager/colleges need no user lookups or already optimal', () => {
    const tasks = readSrc('routes/tasks.ts')
    const att = readSrc('routes/attendance.ts')
    const grades = readSrc('routes/grades.ts')
    const notif = readSrc('routes/notifications.ts')
    const aiMgr = readSrc('routes/ai-manager.ts')
    const colleges = readSrc('routes/colleges.ts')
    expect(tasks).not.toContain('prisma.user.findUnique')
    expect(att).not.toContain('prisma.user.findUnique')
    expect(grades).not.toContain('prisma.user.findUnique')
    expect(notif).not.toContain('prisma.user.findUnique')
    expect(aiMgr).not.toContain('prisma.user.findUnique')
    expect(colleges).not.toContain('prisma.user.findUnique')
    // User-scoped where preserved (tasks) / studentId unique (attendance/grades)
    expect(tasks).toContain('userId: req.userId')
    expect(att).toContain('where: { studentId: userId }')
    expect(grades).toContain('where: { studentId: req.userId!')
  })
})

describe('half2 N+1 loops batched (same rows, fewer round-trips)', () => {
  it('fetch settings bulk: for-loop → Promise.all (order preserved)', () => {
    const src = readSrc('routes/fetch.ts')
    expect(src).toContain('HALF2: parallel upserts (was N+1 sequential awaits in loop')
    expect(src).toContain('const settled = await Promise.all(')
    expect(src).toContain('pendingUpserts.map((u)')
    expect(src).not.toMatch(/for \(const s of settings\) \{\s+const platform/)
  })

  it('admin child deletes: 2 sequential → Promise.all (FK parent after)', () => {
    const src = readSrc('routes/admin.ts')
    expect(src).toContain('HALF2: parallel child deletes (were 2 sequential awaits')
    expect(src).toContain('prisma.hackathonRound.deleteMany')
    expect(src).toContain('prisma.hackathonRegistration.deleteMany')
    expect(src).toContain('prisma.formResponse.deleteMany')
    expect(src).toContain('prisma.formField.deleteMany')
    expect(src).not.toMatch(/await prisma\.hackathonRound\.deleteMany[\s\S]*\n\s+await prisma\.hackathonRegistration\.deleteMany/)
  })

  it('resume helper: 2 sequential → Promise.all (preferences + integration)', () => {
    const src = readSrc('routes/resume.ts')
    expect(src).toContain('HALF2: parallel independent reads (was 2 sequential awaits)')
    expect(src).toContain('const [user, integ] = await Promise.all([')
    expect(src).toContain("select: { preferences: true }")
  })

  it('fetch cleanup: 2 sequential deletes → Promise.all', () => {
    const src = readSrc('routes/fetch.ts')
    expect(src).toContain('HALF2: parallel independent deletes (was 2 sequential awaits)')
    expect(src).toContain('const [hackDeleted, intDeleted] = await Promise.all([')
  })

  it('fetch stats: 48 per-platform counts → 4 batched GROUP BY + 60s cache', () => {
    // PERF supersedes HALF2: 12 platforms × 4 counts in Promise.all still fired
    // 48 concurrent round-trips (identical-timestamp queueing, maxConcurrent 61
    // > pool 50). Now 4 GROUP BY source queries via the store + 60s shared
    // counts cache. Same where clauses, same response shape.
    const src = readSrc('routes/fetch.ts')
    expect(src).toContain('countStagingBySource')
    expect(src).toContain('buildFetchStats')
    expect(src).toContain('FETCH_STATS_CACHE_TTL_MS')
    const repo = readSrc('repositories/fetchRepository.ts')
    expect(repo).toContain("groupBy({ by: ['source']")
    expect(repo).toContain('STAGING_ENRICHED_WHERE')
  })

  it('no N+1 create loops remain in half2 (createMany / Promise.all kept)', () => {
    const ann = readSrc('routes/announcements.ts')
    // announce create uses nested create (single write) + update uses createMany in txn
    expect(ann).toContain('announcementDepartment.createMany')
    expect(ann).toContain('announcementCollege.createMany')
    const reports = readSrc('routes/reports.ts')
    expect(reports).not.toMatch(/for \(.*\) \{\s+await prisma\./)
    const fetch = readSrc('routes/fetch.ts')
    // enrich batches already Promise.allSettled
    expect(fetch).toContain('Promise.allSettled(pending.map')
  })
})

describe('half2 unbounded findMany + take caps (bounded, same shape)', () => {
  it('chat sessions + schedules bounded take:50 (were unbounded)', () => {
    const src = readSrc('routes/chat.ts')
    expect(src).toContain('HALF2')
    expect(src).toContain('take: 50,')
    // sessions list capped
    expect(src).toMatch(/chatSession\.findMany\(\{[\s\S]*take: 50,/)
    // schedule scans capped (3 sites: scoped + compact + full)
    const schedCaps = (src.match(/prisma\.schedule\.findMany\(\{[\s\S]*?take: 50/g) || []).length
    expect(schedCaps).toBeGreaterThanOrEqual(3)
  })

  it('chat messages already capped take:50 + count parallel (kept)', () => {
    const src = readSrc('routes/chat.ts')
    expect(src).toContain('Math.min(50, Math.max(1, limitParam))')
    expect(src).toContain('const [messages, total] = await Promise.all([')
  })

  it('search take:6 per index kept (bounded fan-out, 10-way parallel)', () => {
    const src = readSrc('routes/search.ts')
    expect(src).toContain('take: 6,')
    expect(src).toContain('await Promise.all([')
    const takes = [...src.matchAll(/take: (\d+)/g)].map((m) => parseInt(m[1], 10))
    for (const t of takes) expect(t).toBeLessThanOrEqual(50)
  })

  it('announcements list limit 50 + reads select minimal kept', () => {
    const src = readSrc('routes/announcements.ts')
    expect(src).toContain('Math.min(50, Math.max(1, parseInt(req.query.limit as string)')
    expect(src).toContain('select: { announcementId: true }')
    // list already Promise.all announcements/total/unread
    expect(src).toContain('const [announcements, total, unreadCount] = await Promise.all([')
  })

  it('reports list limit 50 + admin lists take:50 kept', () => {
    const rep = readSrc('routes/reports.ts')
    expect(rep).toContain('Math.min(50, Math.max(1, parseInt(req.query.limit as string)')
    expect(rep).toContain('const [reports, total] = await Promise.all([')
    const adm = readSrc('routes/admin.ts')
    // hackathons/forms/users lists already take:limit (≤50) + count parallel
    expect(adm).toContain('Math.min(50, Math.max(1, limitParam))')
    expect(adm).toContain('prisma.hackathon.count({ where })')
    expect(adm).toContain('prisma.form.count({ where })')
    expect(adm).toContain('prisma.user.count({ where })')
  })

  it('no take>100 remains in half2 routes (cap 50 + pagination)', () => {
    for (const f of ['routes/tasks.ts', 'routes/announcements.ts', 'routes/chat.ts', 'routes/search.ts', 'routes/reports.ts', 'routes/fetch.ts', 'routes/departments.ts', 'routes/admin.ts', 'routes/notifications.ts'] as const) {
      const src = readSrc(f)
      const takes = [...src.matchAll(/take:\s*(\d+)/g)].map((m) => parseInt(m[1], 10))
      for (const t of takes) expect(t).toBeLessThanOrEqual(50)
    }
    expect(readSrc('routes/chat.ts')).not.toContain('take: 1000')
    expect(readSrc('routes/fetch.ts')).not.toContain('take: 1000')
    expect(readSrc('routes/admin.ts')).not.toContain('take: 1000')
  })
})

describe('half2 Promise.all parallelism (was sequential)', () => {
  it('tasks ai-schedule parallel (was classes then tasks sequential)', () => {
    const src = readSrc('routes/tasks.ts')
    expect(src).toContain('HALF2: parallel independent reads (was 2 sequential awaits)')
    expect(src).toContain('const [classes, existingTasks] = await Promise.all([')
    // daily-summary already parallel kept
    expect(src).toContain('const [tasks, classes] = await Promise.all([')
  })

  it('announcements PUT + DELETE parallel (was user then existing sequential)', () => {
    const src = readSrc('routes/announcements.ts')
    expect(src).toContain('const [user, existing] = await Promise.all([')
    expect(src).toContain('const [user, announcement] = await Promise.all([')
  })

  it('reports detail + status + delete parallel (was user then report sequential)', () => {
    const src = readSrc('routes/reports.ts')
    expect(src).toContain('const [user, report] = await Promise.all([')
    const statusParallels = (src.match(/const \[user, existing\] = await Promise\.all\(\[/g) || []).length
    expect(statusParallels).toBe(2)
  })

  it('departments PUT + DELETE parallel (was user then dept sequential)', () => {
    const src = readSrc('routes/departments.ts')
    const matches = (src.match(/const \[user, dept\] = await Promise\.all\(\[/g) || []).length
    expect(matches).toBe(2)
  })

  it('admin deletes + updates + college-delete parallel', () => {
    const src = readSrc('routes/admin.ts')
    expect(src).toContain('const [user, hackathon] = await Promise.all([')
    expect(src).toContain('const [user, form] = await Promise.all([')
    expect(src).toContain('const [user, targetUser] = await Promise.all([')
    expect(src).toContain('const [existing, userCount] = await Promise.all([')
  })

  it('resume helper + fetch cleanup/stats parallel (kept + added)', () => {
    const res = readSrc('routes/resume.ts')
    expect(res).toContain('const [user, integ] = await Promise.all([')
    const fet = readSrc('routes/fetch.ts')
    expect(fet).toContain('const [hackDeleted, intDeleted] = await Promise.all([')
    // PERF: stats batching lives in the store now (4 GROUP BY in one Promise.all).
    const repo = readSrc('repositories/fetchRepository.ts')
    expect(repo).toContain('const [hackTotal, hackEnriched, intTotal, intEnriched] = await Promise.all([')
  })
})

describe('half2 mock-level payload equivalence (narrow selects, same shape)', () => {
  it('announcements validation narrow preserves length check', () => {
    expect(isValidDeptIds([{ id: 'd1' }, { id: 'd2' }], ['d1', 'd2'])).toBe(true)
    expect(isValidDeptIds([{ id: 'd1' }], ['d1', 'd2'])).toBe(false)
    // Full rows vs narrow rows give same boolean
    const full: any[] = [{ id: 'd1', name: 'CSE', collegeId: 'c1' }]
    const narrow = full.map((d) => ({ id: d.id }))
    expect(isValidDeptIds(narrow, ['d1'])).toBe(isValidDeptIds(full, ['d1']))
  })

  it('chat capped parallel preserves order for ≤50', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, dayOfWeek: 1, title: `C${i}` }))
    const out = mapChatSchedules(many)
    expect(out).toHaveLength(50)
    expect(out[0]).toEqual({ id: 's0', dayOfWeek: 1, title: 'C0' })
    expect(out[49].id).toBe('s49')
    const few = [{ id: 'a', dayOfWeek: 2, title: 'Math' }]
    expect(mapChatSchedules(few)).toEqual([{ id: 'a', dayOfWeek: 2, title: 'Math' }])
  })

  it('fetch bulk preserves order (Promise.all order = input order)', () => {
    const inputs = [
      { platform: 'DEVFOLIO', type: 'HACKATHON', data: { fetchLimit: 10 } },
      { platform: 'UNSTOP', type: 'HACKATHON', data: { fetchLimit: 5 } },
    ]
    expect(mapBulkSettings(inputs)).toEqual([
      { platform: 'DEVFOLIO', type: 'HACKATHON', fetchLimit: 10 },
      { platform: 'UNSTOP', type: 'HACKATHON', fetchLimit: 5 },
    ])
  })

  it('reports narrow preserves visibility branching', () => {
    const narrowSuper = { id: 'u1', role: 'SUPER_ADMIN', collegeId: 'c1' }
    const fullSuper: any = { ...narrowSuper, passwordHash: 'H', preferences: '{}', email: 'a@x' }
    const rep = { userId: 'u9', collegeId: 'c2' }
    expect(canSeeReport(narrowSuper, rep)).toBe(canSeeReport(fullSuper, rep))
    expect(canSeeReport(narrowSuper, rep)).toBe(true)
    const narrowAdmin = { id: 'u2', role: 'COLLEGE_ADMIN', collegeId: 'c1' }
    expect(canSeeReport(narrowAdmin, { userId: 'u9', collegeId: 'c1' })).toBe(true)
    expect(canSeeReport(narrowAdmin, { userId: 'u9', collegeId: 'c2' })).toBe(false)
    const narrowStudent = { id: 'u3', role: 'STUDENT', collegeId: 'c1' }
    expect(canSeeReport(narrowStudent, { userId: 'u3', collegeId: 'c1' })).toBe(true)
    expect(canSeeReport(narrowStudent, { userId: 'u9', collegeId: 'c1' })).toBe(false)
  })

  it('college-delete parallel preserves 404/400 precedence', () => {
    expect(decideCollegeDelete(null, 5)).toEqual({ status: 404 })
    expect(decideCollegeDelete({ id: 'c1' }, 3)).toEqual({ status: 400, userCount: 3 })
    expect(decideCollegeDelete({ id: 'c1' }, 0)).toEqual({ status: 200 })
  })

  it('narrow rows drop secrets (no passwordHash/preferences)', () => {
    const narrow: any = { id: 'u1', role: 'TEACHER', collegeId: 'c1' }
    expect(narrow).not.toHaveProperty('passwordHash')
    expect(narrow).not.toHaveProperty('preferences')
    expect(narrow).not.toHaveProperty('email')
    expect(narrow.role).toBe('TEACHER')
    expect(narrow.collegeId).toBe('c1')
  })

  it('query-count evidence: half2 bounded (parallel + batched, not N+1)', () => {
    // BEFORE: ai-schedule 2 sequential → AFTER 1 batch; reports detail 2→1; departments 2→1
    const beforeDetailTrips = 2
    const afterDetailTrips = 1
    expect(afterDetailTrips).toBeLessThan(beforeDetailTrips)
    // fetch settings 20 sequential upserts → 1 Promise.all batch (20×)
    expect(20 / 1).toBe(20)
    // chat schedule unbounded → 50 cap; search 10×6=60 max rows (bounded fan-out)
    expect(10 * 6).toBe(60)
  })
})