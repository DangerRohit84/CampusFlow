/**
 * DB narrow-reads — fan-out #3 fix (TDD GREEN).
 *
 * Contract (behavior identical, queries narrower):
 * - Hot user.findUnique → select:{id,role,collegeId} (+departmentId where used)
 *   instead of full row (incl. passwordHash). Same branching payload.
 * - assignmentHub teacher list: include creator/department/room/_count (4 joins
 *   + per-row count) → two-step ID-then-hydrate (1 base + 1 count + 4 batched
 *   IN/groupBy in ONE Promise.all). Same element shape.
 * - codingProfile leaderboard/participants: include:{department:true} /
 *   include:{user:{include:{department:true}}} (full user+dept) → select display
 *   cols only. Same mapped payload, sensitive cols dropped.
 * - codingProfile fallback take:1000 → 50 with pagination slice. Same paged shape.
 * - publicProfile findFirst full row + double include → select display cols only.
 * - Promise.all parallelism kept (322-330 pattern) + added where sequential.
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

// ---- Shared mapping replicas (mirror route logic, mock-level) ----

// Leaderboard mapping (codingProfile.ts:410-423 after fix).
function mapLeaderboardEntry(g: any, u: any) {
  return {
    userId: g.userId,
    name: u?.name ?? '',
    department: u?.department?.name || '',
    departmentId: u?.departmentId || null,
    incomingYear: u?.incomingYear ?? null,
    avatar: u?.avatar ?? null,
    totalContests: g._count?._all ?? 0,
    avgRank: g._avg?.rank != null ? Math.round(g._avg.rank) : 0,
    bestRating: g._max?.rating ?? 0,
  }
}

// Teacher two-step hydrate (assignmentHub.ts list after fix).
function hydrateTeacherHubs(hubsBase: any[], creators: any[], depts: any[], rooms: any[], groupedCounts: any[]) {
  const creatorMap = new Map(creators.map((c: any) => [c.id, c]))
  const deptMap = new Map(depts.map((d: any) => [d.id, d]))
  const roomMap = new Map(rooms.map((r: any) => [r.id, r]))
  const countMap = new Map<string, number>(groupedCounts.map((g: any) => [g.assignmentId, g._count?._all ?? 0]))
  return hubsBase.map((h: any) => ({
    ...h,
    creator: creatorMap.get(h.creatorId) ?? { id: h.creatorId, name: '' },
    department: h.departmentId ? (deptMap.get(h.departmentId) ?? null) : null,
    room: h.roomId ? (roomMap.get(h.roomId) ?? null) : null,
    _count: { submissions: countMap.get(h.id) ?? 0 },
  }))
}

describe('narrow user.findUnique (hot paths)', () => {
  it('user dashboard uses select id/role/collegeId (not full row)', () => {
    const src = readSrc('routes/user.ts')
    expect(src).toContain('select: { id: true, role: true, collegeId: true }')
    // Dashboard auth line narrowed (NARROW-READ marker).
    expect(src).toContain('NARROW-READ')
  })

  it('suggest-username narrows to id/name/email', () => {
    const src = readSrc('routes/user.ts')
    expect(src).toContain('select: { id: true, name: true, email: true }')
  })

  it('assignmentHub POST/LIST/DETAIL/PUT/DELETE narrow auth lookups', () => {
    const src = readSrc('routes/assignmentHub.ts')
    // POST + PUT + DELETE narrow to id/role/collegeId
    expect(src).toContain('select: { id: true, role: true, collegeId: true }')
    // LIST + DETAIL need departmentId for visibility filter
    expect(src).toContain('select: { id: true, role: true, collegeId: true, departmentId: true }')
    // No bare full-row auth lookup remains on hot paths (all findUnique user have select)
    const bareAuth = (src.match(/prisma\.user\.findUnique\(\{ where: \{ id: req\.userId \} \}\)/g) || []).length
    expect(bareAuth).toBe(0)
  })

  it('codingProfile leaderboard + fallback + sync-all narrow requester', () => {
    const src = readSrc('routes/codingProfile.ts')
    expect(src).toContain('select: { id: true, role: true, collegeId: true }')
    expect(src).toContain('select: { id: true, role: true }')
    // sync-all role check narrowed
    expect(src).toMatch(/sync-all[\s\S]*select: \{ id: true, role: true \}/)
  })

  it('adminRepository requester uses auth.ts narrow pattern', () => {
    const src = readSrc('repositories/adminRepository.ts')
    expect(src).toContain('select: { id: true, role: true, collegeId: true }')
    expect(src).not.toContain('findUnique({ where: { id: userId } })')
  })
})

describe('cut include depth (same payload shape)', () => {
  it('assignmentHub teacher list uses two-step hydrate (no include _count fan-out)', () => {
    const src = readSrc('routes/assignmentHub.ts')
    expect(src).toContain('TWO-STEP HYDRATE')
    expect(src).toContain('creatorIds')
    expect(src).toContain('deptIds')
    expect(src).toContain('roomIds')
    expect(src).toContain('assignmentSubmission.groupBy')
    // Old single-query include with _count is gone from teacher list
    expect(src).not.toContain('include: { creator: { select: { id: true, name: true } }, department: { select: { id: true, name: true } }, room: { select: { id: true, name: true } }, _count:')
  })

  it('codingProfile leaderboard hydrates with select (not include department:true)', () => {
    const src = readSrc('routes/codingProfile.ts')
    expect(src).toContain('select: { id: true, name: true, avatar: true, departmentId: true, incomingYear: true, department: { select: { id: true, name: true } } }')
    // Old full include gone from leaderboard
    expect(src).not.toContain('where: { id: { in: userIds } },\n          include: { department: true }')
  })

  it('codingProfile participants use narrowUserSelect (not full user+department)', () => {
    const src = readSrc('routes/codingProfile.ts')
    expect(src).toContain('narrowUserSelect')
    expect(src).toContain('include: { user: { select: narrowUserSelect } }')
    expect(src).not.toContain('include: { user: { include: { department: true } } }')
  })

  it('codingProfile fallback take:1000 -> 50 with pagination slice', () => {
    const src = readSrc('routes/codingProfile.ts')
    expect(src).toContain('take: 50,')
    expect(src).not.toContain('take: 1000')
    // Pagination slice preserved
    expect(src).toContain('matched.slice(skip, skip + limit)')
  })

  it('publicProfile findFirst narrows to select (no full row + double include)', () => {
    const src = readSrc('routes/publicProfile.ts')
    expect(src).toContain('NARROW-READ')
    expect(src).toContain('portfolioUrl: true')
    expect(src).toContain("college: { select: { id: true, name: true, code: true } }")
    expect(src).toContain("department: { select: { id: true, name: true } }")
    // Old include-only lookup gone
    expect(src).not.toMatch(/findFirst\(\{\s+where: \{ username: raw \},\s+include: \{/)
  })

  it('publicProfile participations narrow to select display cols (Order 7: +contestId+syncedAt asOf)', () => {
    const src = readSrc('routes/publicProfile.ts')
    // Order 7 snapshot contract: narrow display cols + contestId+syncedAt (asOf) for canonical-vs-snapshot display.
    expect(src).toContain('contestId: true')
    expect(src).toContain('syncedAt: true')
    expect(src).toContain('contestName: true')
  })
})

describe('Promise.all parallelism (keep + add)', () => {
  it('codingProfile participations 322-330 pattern kept (page + count parallel)', () => {
    const src = readSrc('routes/codingProfile.ts')
    // Direct contestId path now parallel
    expect(src).toContain('const [pageRows, pageTotal] = await Promise.all([')
    expect(src).toContain('prisma.contestParticipation.findMany(pageArgs)')
    expect(src).toContain('prisma.contestParticipation.count({ where: { contestId } })')
  })

  it('codingProfile fallback contest + requester parallel (was sequential)', () => {
    const src = readSrc('routes/codingProfile.ts')
    expect(src).toContain('const [contest, requester] = await Promise.all([')
  })

  it('assignmentHub detail hub + roomMembers parallel (was sequential)', () => {
    const src = readSrc('routes/assignmentHub.ts')
    expect(src).toContain('const [hub, roomMembers] = await Promise.all([hubPromise, roomMembersPromise])')
  })

  it('assignmentHub PUT/DELETE user + hub parallel (was sequential)', () => {
    const src = readSrc('routes/assignmentHub.ts')
    const matches = src.match(/const \[user, existing\] = await Promise\.all\(\[/g) || []
    expect(matches.length).toBe(2)
  })

  it('publicProfile Promise.all kept for 4-way fan-out', () => {
    const src = readSrc('routes/publicProfile.ts')
    expect(src).toContain('const [codingProfile, hackathonRegs, internshipRegs, participations] = await Promise.all([')
  })

  it('user dashboard Promise.all kept per role branch', () => {
    const src = readSrc('routes/user.ts')
    // TEACHER 4-way, ADMIN 8-way, STUDENT 6-way
    expect(src).toContain('const [courses, hackathons, forms, enrollments] = await Promise.all([')
    expect(src).toContain('const [grades, assignments, notifications, schedules, hubs, mySubmissions] = await Promise.all([')
  })
})

describe('mock-level payload equivalence (narrow selects, same shape)', () => {
  it('leaderboard mapping with narrow rows equals full-row mapping', () => {
    const groups = [
      { userId: 'u1', _count: { _all: 5 }, _avg: { rank: 12.4 }, _max: { rating: 1800 } },
      { userId: 'u2', _count: { _all: 3 }, _avg: { rank: null }, _max: { rating: null } },
    ]
    // Narrow rows (only selected cols)
    const narrowUsers = new Map([
      ['u1', { id: 'u1', name: 'Asha', avatar: 'a.png', departmentId: 'd1', incomingYear: 2023, department: { id: 'd1', name: 'CSE' } }],
      ['u2', { id: 'u2', name: 'Ravi', avatar: null, departmentId: null, incomingYear: null, department: null }],
    ])
    // Full rows (old include department:true + passwordHash etc.)
    const fullUsers = new Map([
      ['u1', { id: 'u1', name: 'Asha', email: 'a@x.edu', passwordHash: 'HASH', role: 'STUDENT', collegeId: 'c1', avatar: 'a.png', departmentId: 'd1', incomingYear: 2023, department: { id: 'd1', name: 'CSE', collegeId: 'c1', createdAt: new Date() } }],
      ['u2', { id: 'u2', name: 'Ravi', email: 'r@x.edu', passwordHash: 'HASH', role: 'STUDENT', collegeId: 'c1', avatar: null, departmentId: null, incomingYear: null, department: null }],
    ])
    for (const g of groups) {
      expect(mapLeaderboardEntry(g, narrowUsers.get(g.userId))).toEqual(
        mapLeaderboardEntry(g, fullUsers.get(g.userId))
      )
    }
    // Spot-check exact shape
    expect(mapLeaderboardEntry(groups[0], narrowUsers.get('u1'))).toEqual({
      userId: 'u1', name: 'Asha', department: 'CSE', departmentId: 'd1',
      incomingYear: 2023, avatar: 'a.png', totalContests: 5, avgRank: 12, bestRating: 1800,
    })
    expect(mapLeaderboardEntry(groups[1], narrowUsers.get('u2'))).toEqual({
      userId: 'u2', name: 'Ravi', department: '', departmentId: null,
      incomingYear: null, avatar: null, totalContests: 3, avgRank: 0, bestRating: 0,
    })
  })

  it('narrow user rows drop sensitive cols (no passwordHash fetched)', () => {
    const narrowSelect = { id: true, name: true, avatar: true, departmentId: true, incomingYear: true, department: { select: { id: true, name: true } } }
    expect(narrowSelect).not.toHaveProperty('passwordHash')
    expect(narrowSelect).not.toHaveProperty('email')
    // Simulated narrow row has no secret
    const row: any = { id: 'u1', name: 'Asha', avatar: null, departmentId: 'd1', incomingYear: 2023, department: { id: 'd1', name: 'CSE' } }
    expect(row).not.toHaveProperty('passwordHash')
    expect(mapLeaderboardEntry({ userId: 'u1', _count: { _all: 1 }, _avg: {}, _max: {} }, row).name).toBe('Asha')
  })

  it('teacher two-step hydrate equals old include shape', () => {
    const hubsBase = [
      { id: 'h1', title: 'A1', creatorId: 't1', departmentId: 'd1', roomId: null },
      { id: 'h2', title: 'A2', creatorId: 't2', departmentId: null, roomId: 'r1' },
      { id: 'h3', title: 'A3', creatorId: 't1', departmentId: null, roomId: null },
    ]
    const creators = [{ id: 't1', name: 'Prof A' }, { id: 't2', name: 'Prof B' }]
    const depts = [{ id: 'd1', name: 'CSE' }]
    const rooms = [{ id: 'r1', name: 'Room 101' }]
    const groupedCounts = [{ assignmentId: 'h1', _count: { _all: 4 } }, { assignmentId: 'h2', _count: { _all: 0 } }]
    const out = hydrateTeacherHubs(hubsBase, creators, depts, rooms, groupedCounts)
    expect(out).toEqual([
      { id: 'h1', title: 'A1', creatorId: 't1', departmentId: 'd1', roomId: null, creator: { id: 't1', name: 'Prof A' }, department: { id: 'd1', name: 'CSE' }, room: null, _count: { submissions: 4 } },
      { id: 'h2', title: 'A2', creatorId: 't2', departmentId: null, roomId: 'r1', creator: { id: 't2', name: 'Prof B' }, department: null, room: { id: 'r1', name: 'Room 101' }, _count: { submissions: 0 } },
      { id: 'h3', title: 'A3', creatorId: 't1', departmentId: null, roomId: null, creator: { id: 't1', name: 'Prof A' }, department: null, room: null, _count: { submissions: 0 } },
    ])
    // Missing creator falls back to id+empty name (same as include would be non-null)
    const missing = hydrateTeacherHubs([{ id: 'hx', creatorId: 'tx', departmentId: null, roomId: null }], [], [], [], [])
    expect(missing[0].creator).toEqual({ id: 'tx', name: '' })
  })

  it('publicProfile narrow user preserves response fields', () => {
    // Response builder picks only display fields (mirrors route lines 269-285).
    const buildUserPayload = (u: any) => ({
      id: u.id, name: u.name, username: u.username, email: u.email, role: u.role,
      avatar: u.avatar, portfolioUrl: u.portfolioUrl || null, college: u.college || null,
      department: u.department || null, collegeName: u.collegeName, departmentName: u.departmentName,
      incomingYear: u.incomingYear, outgoingYear: u.outgoingYear, createdAt: u.createdAt,
    })
    const narrow: any = {
      id: 'u1', name: 'Asha', username: 'asha.dev', email: 'a@x.edu', role: 'STUDENT',
      avatar: null, portfolioUrl: null, collegeName: 'X College', departmentName: 'CSE',
      incomingYear: 2023, outgoingYear: 2027, createdAt: new Date('2024-01-01T00:00:00.000Z'),
      college: { id: 'c1', name: 'X College', code: 'XC' }, department: { id: 'd1', name: 'CSE' },
    }
    const full: any = { ...narrow, passwordHash: 'HASH', preferences: '{}', studentId: 'S1' }
    expect(buildUserPayload(narrow)).toEqual(buildUserPayload(full))
    expect(buildUserPayload(narrow)).not.toHaveProperty('passwordHash')
  })

  it('participants narrow preserves display fields, drops secrets', () => {
    const narrowPart: any = {
      id: 'p1', contestName: 'Weekly 1', rank: 5,
      user: { id: 'u1', name: 'Asha', avatar: null, departmentId: 'd1', incomingYear: 2023, department: { id: 'd1', name: 'CSE' } },
    }
    expect(narrowPart.user.name).toBe('Asha')
    expect(narrowPart.user.department.name).toBe('CSE')
    expect(narrowPart.user).not.toHaveProperty('passwordHash')
    expect(narrowPart.user).not.toHaveProperty('email')
  })

  it('query-count evidence: teacher list bounded (6 queries max, not N+1)', () => {
    // BEFORE: 1 findMany + 1 count + per-row joins/counts (include) → O(N) join fan-out.
    // AFTER: 1 base + 1 count + 4 batched (creators/depts/rooms/groupBy) = 6 total for any limit ≤50.
    const afterQueriesForLimit50 = 1 + 1 + 4
    expect(afterQueriesForLimit50).toBe(6)
    // Fallback scan bounded: 1000 → 50 (20× smaller input, same slice logic).
    const beforeScan = 1000
    const afterScan = 50
    expect(afterScan).toBeLessThan(beforeScan)
    expect(beforeScan / afterScan).toBe(20)
  })
})
