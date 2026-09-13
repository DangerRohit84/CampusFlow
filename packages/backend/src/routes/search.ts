import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import { tryToPlatformEnumStrict } from '../lib/enums'
import { isAssignmentVisibleToUser } from '../utils/assignmentVisibility'

const router = Router()
router.use(authenticate)

// 10k SEARCH BUDGET (bounded fan-out, no behavior change):
// - Per-source take:6 × 10 sources = 60 rows max per request (was already 6 each;
//   made explicit via constants). Global cap 60 enforced via slice (no-op today,
//   guards future source adds).
// - Query max 100 chars (trim + slice) — prevents `contains` full-scan abuse via
//   10k-char input; realistic queries <50 chars unaffected.
// - 10 parallel findMany in ONE Promise.all (was already parallel); each ≤6 rows,
//   total ≤60 rows + 1 narrow auth read = 11 queries/request. Pool 50 holds
//   200-user burst via per-user limiter buckets (see load-10k-smoke.mjs).
export const SEARCH_PER_SOURCE_LIMIT = 6
export const SEARCH_GLOBAL_MAX = 60
export const SEARCH_QUERY_MAX_LEN = 100

// Search across all user data
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { q } = req.query
    if (!q || typeof q !== 'string') {
      res.status(400).json({ error: 'Search query required' })
      return
    }

    const trimmed = q.trim().slice(0, SEARCH_QUERY_MAX_LEN)
    if (!trimmed) {
      res.status(400).json({ error: 'Search query required' })
      return
    }
    const query = trimmed.toLowerCase()
    const userId = req.userId!

    // HALF2: narrow auth read (was full row incl. secrets/preferences; only college/role/dept used for scoping)
    // topbottom F12a: auth-read failure must degrade to global scope, not 500.
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { collegeId: true, role: true, departmentId: true } }).catch(() => null)
    const collegeId = (user as { collegeId?: string | null } | null)?.collegeId || null
    const userRole = (user as { role?: string } | null)?.role || null
    const userDepartmentId = (user as { departmentId?: string | null } | null)?.departmentId || null
    const isSuperSearch = userRole === 'SUPER_ADMIN'
    // Use mode insensitive for Postgres; contains is sufficient
    const like = { contains: query, mode: 'insensitive' as const }
    // topbottom F12a: EVERY branch isolated — one table blip degrades to [],
    // never 500s the whole search (4 branches lacked .catch before).
    const [schedules, assignments, assignmentHubs, notifications, hackathons, internships, forms, rooms, codingContests, tasks] = await Promise.all([
      prisma.schedule.findMany({
        where: { userId, OR: [{ title: like }, { course: like }, { location: like }] }, take: 6,
      }).catch(() => [] as any[]),
      prisma.assignment.findMany({
        where: { userId, OR: [{ title: like }, { courseId: like }, { description: like }] }, take: 6,
      }).catch(() => [] as any[]),
      // AssignmentHub — college-scoped, visible via assignmentVisibility OR at least by college/global where
      // ROOM-scope leak fix: null-college scopes to global-only (collegeId null),
      // never the whole table. ROOM/DEPARTMENT scope is post-filtered below via
      // membership (see safeAssignmentHubs).
      prisma.assignmentHub.findMany({
        where: collegeId ? { collegeId, OR: [{ title: like }, { description: like }] } : { collegeId: null, OR: [{ title: like }, { description: like }] },
        take: 6, orderBy: { dueDate: 'desc' }
      }).catch(()=>[] as any[]),
      prisma.notification.findMany({
        where: { userId, OR: [{ title: like }, { message: like }] }, take: 6,
      }).catch(() => [] as any[]),
      prisma.hackathon.findMany({
        where: collegeId ? { collegeId, OR: [{ title: like }, { organizer: like }] } : { collegeId: null, OR: [{ title: like }, { organizer: like }] },
        take: 6, orderBy: { createdAt: 'desc' }
      }).catch(()=>[] as any[]),
      prisma.internship.findMany({
        // Internship.collegeId is required (no global rows): null-college
        // callers match nothing (fail-closed, never the whole table).
        where: collegeId ? { collegeId, OR: [{ title: like }, { company: like }, { role: like }] } : { id: '__no_college__' },
        take: 6, orderBy: { createdAt: 'desc' }
      }).catch(()=>[] as any[]),
      prisma.form.findMany({
        where: collegeId ? { collegeId, OR: [{ title: like }, { description: like }] } : { collegeId: null, OR: [{ title: like }, { description: like }] },
        take: 6, orderBy: { createdAt: 'desc' }
      }).catch(()=>[] as any[]),
      prisma.room.findMany({
        where: { OR: [{ name: like }, { description: like }] }, take: 6, orderBy: { createdAt: 'desc' }
      }).catch(()=>[] as any[]),
      prisma.codingContest.findMany({
        // Order 4: platform is native Platform enum — no contains/mode filter.
        // Title keeps contains; platform uses exact equals when query is a valid
        // platform key (LEETCODE/CODECHEF/...), else title-only (avoids P2000
        // on invalid enum + keeps search total ≤6). Validated against the REAL
        // enum (no `as any` lie).
        where: (() => { const p = tryToPlatformEnumStrict(trimmed); return p ? { OR: [{ title: like }, { platform: { equals: p } }] } : { OR: [{ title: like }] } })(),
        take: 6,
        orderBy: { startTime: 'desc' },
      }).catch(()=>[] as any[]),
      prisma.task.findMany({
        where: { userId, OR: [{ title: like }, { description: like }] }, take: 6,
      }).catch(() => [] as any[]),
    ])

    // topbottom F12b: join codes are room keys. The list endpoint scopes rooms
    // to member/own; search must not leak `Code <joinCode>` for rooms the
    // requester can't access (they could join any room). Strip unless the
    // requester is SUPER_ADMIN, the room teacher, or a member. Fail-closed:
    // lookup failure → strip.
    const accessibleRoomIds = new Set<string>()
    try {
      const roomRows = rooms as any[]
      const [meRow, myMemberships] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { role: true } }).catch(() => null),
        roomRows.length
          ? prisma.roomMember.findMany({ where: { studentId: userId, roomId: { in: roomRows.map((r: any) => r.id) } }, select: { roomId: true } }).catch(() => [] as Array<{ roomId: string }>)
          : Promise.resolve([] as Array<{ roomId: string }>),
      ])
      const isSuper = !!meRow && (meRow as any).role === 'SUPER_ADMIN'
      for (const m of (myMemberships as Array<{ roomId: string }>) || []) accessibleRoomIds.add(m.roomId)
      for (const r of roomRows) {
        if (isSuper || r.teacherId === userId || accessibleRoomIds.has(r.id)) accessibleRoomIds.add(r.id)
      }
    } catch { /* fail-closed: accessibleRoomIds stays as-is (likely empty) */ }
    const safeRooms = (rooms as any[]).map((r: any) =>
      accessibleRoomIds.has(r.id) ? r : { ...r, joinCode: undefined },
    )

    // ROOM-scope leak fix: assignmentHub search must not expose DEPARTMENT/ROOM
    // rows the requester cannot open. Reuse the canonical visibility helper
    // (single source of truth with assignmentHub list/detail). STUDENT and
    // null-college callers are filtered; staff (TEACHER/COLLEGE_ADMIN) keep
    // college-filtered results (ownership/admin checked at detail routes).
    let safeAssignmentHubs: typeof assignmentHubs = assignmentHubs
    try {
      const needsScopeFilter = !isSuperSearch && (userRole === 'STUDENT' || !collegeId || !userRole)
      if (needsScopeFilter && safeAssignmentHubs.length) {
        const hubRoomIds = [...new Set(
          safeAssignmentHubs
            .filter((h: any) => h?.scope === 'ROOM' && typeof h?.roomId === 'string' && h.roomId)
            .map((h: any) => h.roomId as string),
        )]
        const hubMemberIds = new Set<string>()
        for (const id of accessibleRoomIds) hubMemberIds.add(id)
        if (hubRoomIds.length) {
          const missing = hubRoomIds.filter((id) => !hubMemberIds.has(id))
          if (missing.length) {
            const rows = await prisma.roomMember
              .findMany({ where: { studentId: userId, roomId: { in: missing } }, select: { roomId: true } })
              .catch(() => [] as Array<{ roomId: string }>)
            for (const m of rows || []) hubMemberIds.add(m.roomId)
          }
        }
        const viewer = { id: userId, role: userRole || 'STUDENT', collegeId, departmentId: userDepartmentId }
        safeAssignmentHubs = safeAssignmentHubs.filter((h: any) =>
          isAssignmentVisibleToUser(
            { id: h.id, collegeId: h.collegeId ?? null, scope: h.scope, departmentId: h.departmentId ?? null, roomId: h.roomId ?? null },
            viewer,
            hubMemberIds,
          ),
        )
      }
    } catch { /* fail-closed: on lookup failure keep DB college-filtered rows (no extra leak beyond prior behavior) */ }

    const results = [
      ...schedules.map((s: any) => ({ type: 'schedule', id: s.id, title: s.title, subtitle: `${s.course || ''} · ${s.location || ''}`.replace(/^ · | · $/g,''), data: s })),
      ...assignments.map((a: any) => ({ type: 'assignment', id: a.id, title: a.title, subtitle: `${a.courseId} · Due: ${a.dueDate.toISOString().split('T')[0]}`, data: a })),
      ...safeAssignmentHubs.map((h: { id: string; title: string; dueDate: Date | string; scope: string }) => ({ type: 'assignmentHub', id: h.id, title: h.title, subtitle: `Due ${new Date(h.dueDate).toLocaleDateString()} · ${h.scope}`, data: h })),
      ...notifications.map((n: any) => ({ type: 'notification', id: n.id, title: n.title, subtitle: n.message, data: n })),
      ...(hackathons as any[]).map((h: any) => ({ type: 'hackathon', id: h.id, title: h.title, subtitle: `${h.organizer || ''} · ${h.mode || ''}`.replace(/^ · | · $/g,''), data: h })),
      ...(internships as any[]).map((i: any) => ({ type: 'internship', id: i.id, title: i.title, subtitle: `${i.company || ''} · ${i.role || ''}`.replace(/^ · | · $/g,''), data: i })),
      ...(forms as any[]).map((f: any) => ({ type: 'form', id: f.id, title: f.title, subtitle: f.description || 'Form', data: f })),
      ...(safeRooms as any[]).map((r: any) => ({ type: 'room', id: r.id, title: r.name, subtitle: r.description || (r.joinCode ? `Code ${r.joinCode}` : 'Room'), data: r })),
      ...(codingContests as any[]).map((c: any) => ({ type: 'contest', id: c.id, title: c.title, subtitle: `${c.platform} · ${c.status}`, data: c })),
      ...tasks.map((t: any) => ({ type: 'task', id: t.id, title: t.title, subtitle: `${t.category || 'personal'} · ${new Date(t.date).toLocaleDateString()}`, data: t })),
    ]

    // Global cap: 10 sources × SEARCH_PER_SOURCE_LIMIT (6) = SEARCH_GLOBAL_MAX (60).
    const capped = results.slice(0, SEARCH_GLOBAL_MAX)
    // CACHE-ALL: own+college-scoped search slice (take:6 bounded fan-out) — private edge SWR.
    res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
    res.json({ results: capped, total: capped.length })
  } catch (error) {
    res.status(500).json({ error: 'Search failed' })
  }
})

export default router