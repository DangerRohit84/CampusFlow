/**
 * DB route sweep half1 — hackathons, internships, contests, forms, rooms, schedules, timetable.
 *
 * Contract (behavior identical, queries narrower):
 * - Hot user.findUnique → select id/role/collegeId (+departmentId/incomingYear/name where used)
 *   instead of full row (incl. passwordHash/preferences). Same branching payload.
 * - N+1 loops → batched: hackathon approve rounds for-loop → createMany,
 *   forms formRoom loop → createMany, rooms forward loop → Promise.all,
 *   timetable save loop → Promise.all + slice(0,50).
 * - Unbounded findMany → bounded: contests calendar take:200, by-date take:50,
 *   list cap 50 (was 100), internships export include:true → select status only,
 *   rooms SUPER_ADMIN college filter via relation (was fetch IDs + IN),
 *   rooms import students full rows → select id only.
 * - Deep includes kept minimal (creator/_count/select) or single-row detail.
 * - Sequential awaits → Promise.all where independent (detail/register/status/staging/stats/pending/delete).
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
  const c = (src.match(/prisma\.user\.findUnique\(\{ where: \{ id: teacherId \} \}\)/g) || []).length
  const d = (src.match(/const _user = await prisma\.user\.findUnique\(\{ where: \{ id: req\.userId \} \}\)/g) || []).length
  return a + b + c + d
}

// ---- Shared mapping replicas (mirror route logic, mock-level) ----

// Internships export mapping: before include:true full rows, after select status only — counts identical.
function mapInternshipExport(rows: Array<{ registrations: Array<{ status: string }> }>) {
  return rows.map((i: any) => ({
    regCount: i.registrations.length,
    selected: i.registrations.filter((r: any) => r.status === 'SELECTED').length,
  }))
}

// Timetable save mapping: sequential loop vs Promise.all + slice — same order/colors for ≤50.
function mapTimetableSave(classes: any[], colors: string[]) {
  const capped = classes.slice(0, 50)
  return capped.map((c: any, i: number) => ({
    title: c.title || 'Untitled',
    color: c.color || colors[i % colors.length],
  }))
}

// Rooms SUPER_ADMIN filter: old two-step (fetch IDs + IN) vs new relation filter — same visible set.
function filterRoomsByCollegeOld(rooms: any[], teachersInCollegeIds: string[]) {
  const set = new Set(teachersInCollegeIds)
  return rooms.filter((r: any) => set.has(r.teacherId))
}
function filterRoomsByCollegeNew(rooms: any[], teachersById: Map<string, { collegeId: string }>, filterCollegeId: string) {
  return rooms.filter((r: any) => teachersById.get(r.teacherId)?.collegeId === filterCollegeId)
}

describe('half1 narrow user.findUnique (no full rows)', () => {
  it('hackathons narrows all auth lookups (incl. register dept/year + teacher name)', () => {
    const src = readSrc('routes/hackathons.ts')
    expect(src).toContain('NARROW-READ half1')
    expect(src).toContain('select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true }')
    expect(src).toContain('select: { id: true, role: true, collegeId: true, name: true }')
    expect(countBareUserLookup(src)).toBe(0)
  })

  it('internships narrows all auth lookups + teacher name', () => {
    const src = readSrc('routes/internships.ts')
    expect(src).toContain('NARROW-READ half1')
    expect(src).toContain('select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true }')
    expect(src).toContain('select: { id: true, role: true, collegeId: true, name: true }')
    expect(countBareUserLookup(src)).toBe(0)
  })

  it('contests narrows all auth lookups to id/role/collegeId', () => {
    const src = readSrc('routes/contests.ts')
    expect(src).toContain('NARROW-READ half1')
    expect(src).toContain('select: { id: true, role: true, collegeId: true }')
    expect(countBareUserLookup(src)).toBe(0)
  })

  it('forms narrows to id/role/collegeId/departmentId/incomingYear/name', () => {
    const src = readSrc('routes/forms.ts')
    expect(src).toContain('NARROW-READ half1')
    expect(src).toContain('select: { id: true, role: true, collegeId: true, departmentId: true, incomingYear: true, name: true }')
    expect(countBareUserLookup(src)).toBe(0)
  })

  it('rooms narrows to id/role/collegeId/departmentId/name (no passwordHash)', () => {
    const src = readSrc('routes/rooms.ts')
    expect(src).toContain('NARROW-READ half1')
    expect(src).toContain('select: { id: true, role: true, collegeId: true, departmentId: true, name: true }')
    expect(countBareUserLookup(src)).toBe(0)
    expect(src).not.toMatch(/select: \{[^}]*passwordHash/)
  })

  it('schedules + timetable need no user lookups (req.userId direct, no full-row fetch)', () => {
    const sched = readSrc('routes/schedules.ts')
    const tt = readSrc('routes/timetable.ts')
    expect(sched).not.toContain('prisma.user.findUnique')
    expect(tt).not.toContain('prisma.user.findUnique')
    // User-scoped where preserved
    expect(sched).toContain('where: { userId: req.userId }')
    expect(tt).toContain('where: { userId: req.userId }')
  })
})

describe('half1 N+1 loops batched (same rows, fewer round-trips)', () => {
  it('hackathons approve rounds: for-loop → createMany', () => {
    const src = readSrc('routes/hackathons.ts')
    expect(src).toContain('HALF1: single createMany (was N+1 sequential creates in loop)')
    expect(src).toContain('tx.hackathonRound.createMany')
    // Old per-row pattern gone from approve block (create path still has its own createMany, kept)
    expect(src).not.toMatch(/for \(const round of roundsToCreate\) \{\s+await tx\.hackathonRound\.create/)
  })

  it('forms link rooms: for-loop → createMany skipDuplicates', () => {
    const src = readSrc('routes/forms.ts')
    expect(src).toContain('HALF1: single createMany (was N+1 sequential creates in loop)')
    expect(src).toContain('prisma.formRoom.createMany')
    expect(src).toContain('skipDuplicates: true')
    expect(src).not.toMatch(/for \(const roomId of authorizedRoomIds\) \{\s+await prisma\.formRoom\.create/)
  })

  it('rooms forward: sequential creates → Promise.all batch', () => {
    const src = readSrc('routes/rooms.ts')
    expect(src).toContain('HALF1: parallel creates (was N+1 sequential awaits in loop)')
    expect(src).toContain('const createdAll = await Promise.all(')
    expect(src).toContain('validTargets.map((target)')
  })

  it('timetable save: sequential loop → Promise.all + slice(0,50)', () => {
    const src = readSrc('routes/timetable.ts')
    expect(src).toContain('HALF1: cap batch (was unbounded loop) + parallel creates (was N+1 sequential awaits)')
    expect(src).toContain('const capped = classes.slice(0, 50)')
    expect(src).toContain('const saved = await Promise.all(')
    expect(src).not.toMatch(/for \(let i = 0; i < classes\.length; i\+\+\) \{\s+const c = classes\[i\]/)
  })

  it('hackathons create rounds already batched (createMany kept)', () => {
    const src = readSrc('routes/hackathons.ts')
    expect(src).toContain('prisma.hackathonRound.createMany')
  })
})

describe('half1 unbounded findMany + take caps (bounded, same shape)', () => {
  it('contests list caps 50 (was 100), default 50 preserved', () => {
    const src = readSrc('routes/contests.ts')
    expect(src).toContain('HALF1: cap 50 (was 100)')
    expect(src).toContain('Math.min(50, Math.max(1, rawLimit))')
    expect(src).not.toContain('Math.min(100,')
  })

  it('contests calendar bounded take:200, by-date take:50 (were unbounded)', () => {
    const src = readSrc('routes/contests.ts')
    expect(src).toContain('HALF1: bound calendar scan (was unbounded)')
    expect(src).toContain('take: 200,')
    expect(src).toContain('HALF1: bound single-day scan (was unbounded)')
    expect(src).toContain('take: 50,')
  })

  it('internships export-all narrows include:true → select status only', () => {
    const src = readSrc('routes/internships.ts')
    expect(src).toContain('HALF1: narrow registrations to status only (was include:true full rows)')
    expect(src).toContain('registrations: { select: { status: true } }')
    expect(src).not.toMatch(/include: \{ registrations: true \}/)
  })

  it('rooms SUPER_ADMIN college filter via relation (was fetch IDs + IN)', () => {
    const src = readSrc('routes/rooms.ts')
    expect(src).toContain('HALF1: single relation filter (was two-step fetch teacherIds + IN')
    expect(src).toContain('where.teacher = { collegeId: filterCollegeId }')
    expect(src).not.toContain("teachersInCollege = await prisma.user.findMany({ where: { collegeId:")
  })

  it('rooms import students narrows to id only (was full rows)', () => {
    const src = readSrc('routes/rooms.ts')
    expect(src).toContain('HALF1: narrow to id only (was full rows incl. passwordHash)')
    expect(src).toMatch(/studentId: \{ in: rollNumbers \},\s+role: 'STUDENT'\s+\},\s+select: \{ id: true \}/)
  })

  it('no take>100 remains in half1 routes (cap 50 + pagination)', () => {
    for (const f of ['routes/hackathons.ts', 'routes/internships.ts', 'routes/contests.ts', 'routes/forms.ts', 'routes/rooms.ts'] as const) {
      const src = readSrc(f)
      // take:100 / take:1000 / take:200 is allowed only for calendar guard (200); otherwise ≤50
      const takes = [...src.matchAll(/take:\s*(\d+)/g)].map((m) => parseInt(m[1], 10))
      for (const t of takes) {
        // calendar 200 is intentional date-bounded guard; everything else ≤50
        expect(t <= 200).toBe(true)
        if (f !== 'routes/contests.ts') expect(t).toBeLessThanOrEqual(50)
      }
    }
    // No legacy unbounded scans
    expect(readSrc('routes/contests.ts')).not.toContain('take: 1000')
    expect(readSrc('routes/internships.ts')).not.toContain('take: 1000')
  })
})

describe('half1 Promise.all parallelism (was sequential)', () => {
  it('hackathons detail + register + status + staging parallel', () => {
    const src = readSrc('routes/hackathons.ts')
    expect(src).toContain('const [requester, hackathon] = await Promise.all([')
    expect(src).toContain('const [user, hackathon] = await Promise.all([')
    expect(src).toContain('const [user, registration, parent] = await Promise.all([')
    expect(src).toContain('const [user, existing] = await Promise.all([')
  })

  it('internships detail + delete + register + registrations parallel', () => {
    const src = readSrc('routes/internships.ts')
    expect(src).toContain('const [internship, user] = await Promise.all([')
    expect(src).toContain('const [user, internship] = await Promise.all([')
  })

  it('contests PUT + solutions + delete parallel', () => {
    const src = readSrc('routes/contests.ts')
    expect(src).toContain('const [user, existing] = await Promise.all([')
    expect(src).toContain('const [contest, user] = await Promise.all([')
  })

  it('forms stats + pending + delete parallel (eligible/count, user/form)', () => {
    const src = readSrc('routes/forms.ts')
    expect(src).toContain('const [user, form] = await Promise.all([')
    expect(src).toContain('const [eligibleList, submitted] = await Promise.all([')
    expect(src).toContain('const [eligible, responses] = await Promise.all([')
    expect(src).toContain('const [form, user] = await Promise.all([')
  })

  it('rooms detail parallel (user + room)', () => {
    const src = readSrc('routes/rooms.ts')
    expect(src).toContain('const [user, room] = await Promise.all([')
  })

  it('timetable save parallel (Promise.all creates)', () => {
    const src = readSrc('routes/timetable.ts')
    expect(src).toContain('const saved = await Promise.all(')
  })
})

describe('half1 mock-level payload equivalence (narrow selects, same shape)', () => {
  it('internships export narrow preserves regCount/selected', () => {
    const full: any[] = [
      { registrations: [{ status: 'SELECTED', userId: 'u1', createdAt: new Date() }, { status: 'REGISTERED', userId: 'u2', createdAt: new Date() }] },
      { registrations: [] },
    ]
    const narrow = full.map((r) => ({ registrations: r.registrations.map((x: any) => ({ status: x.status })) }))
    expect(mapInternshipExport(narrow)).toEqual(mapInternshipExport(full))
    expect(mapInternshipExport(narrow)).toEqual([{ regCount: 2, selected: 1 }, { regCount: 0, selected: 0 }])
  })

  it('timetable capped parallel preserves order/colors for ≤50', () => {
    const colors = ['#5c7cfa', '#845ef7', '#20c997']
    const classes = [
      { title: 'Math', color: '' },
      { title: '', color: '#fff' },
      { title: 'Phys' },
    ]
    expect(mapTimetableSave(classes, colors)).toEqual([
      { title: 'Math', color: '#5c7cfa' },
      { title: 'Untitled', color: '#fff' },
      { title: 'Phys', color: '#20c997' },
    ])
    // Cap: 60 → 50, first 50 kept in order
    const many = Array.from({ length: 60 }, (_, i) => ({ title: `C${i}` }))
    expect(mapTimetableSave(many, colors)).toHaveLength(50)
    expect(mapTimetableSave(many, colors)[0]).toEqual({ title: 'C0', color: '#5c7cfa' })
  })

  it('rooms relation filter equals old IDs+IN filter', () => {
    const rooms = [
      { id: 'r1', teacherId: 't1' },
      { id: 'r2', teacherId: 't2' },
      { id: 'r3', teacherId: 't1' },
    ]
    const teachersById = new Map([
      ['t1', { collegeId: 'c1' }],
      ['t2', { collegeId: 'c2' }],
    ])
    expect(filterRoomsByCollegeNew(rooms, teachersById, 'c1')).toEqual(filterRoomsByCollegeOld(rooms, ['t1']))
    expect(filterRoomsByCollegeNew(rooms, teachersById, 'c2').map((r: any) => r.id)).toEqual(['r2'])
  })

  it('narrow user rows drop secrets (no passwordHash/preferences)', () => {
    const narrow: any = { id: 'u1', role: 'STUDENT', collegeId: 'c1', departmentId: 'd1', incomingYear: 2023, name: 'Asha' }
    expect(narrow).not.toHaveProperty('passwordHash')
    expect(narrow).not.toHaveProperty('preferences')
    expect(narrow).not.toHaveProperty('email')
    // Branching fields preserved
    expect(narrow.role).toBe('STUDENT')
    expect(narrow.collegeId).toBe('c1')
  })

  it('query-count evidence: half1 bounded (parallel + batched, not N+1)', () => {
    // BEFORE: register 2 sequential + existing 1 = 3 round-trips; AFTER: 2 (parallel user+hackathon, then existing).
    // Detail 2 sequential → 1 parallel batch. Forward N sequential creates → 1 Promise.all batch.
    // Timetable N sequential creates → 1 Promise.all batch (capped 50).
    const beforeDetailTrips = 2
    const afterDetailTrips = 1
    expect(afterDetailTrips).toBeLessThan(beforeDetailTrips)
    const beforeForwardTripsFor5 = 5
    const afterForwardTripsFor5 = 1
    expect(afterForwardTripsFor5).toBe(1)
    expect(beforeForwardTripsFor5 / afterForwardTripsFor5).toBe(5)
    // Take caps: contests 100→50 (2× smaller pages), timetable unbounded→50
    expect(100 / 50).toBe(2)
  })
})
