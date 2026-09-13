import { Router, Response, NextFunction } from 'express'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { notifyUsers } from '../services/notificationService'
import { emitRoomMessage, emitRoomMessageDeleted, emitRoomMessageReaction, emitRoomMessageEdited, emitRoomMessagePin, broadcastRoomMutation } from '../services/socket'
import { roomAccessStore } from '../repositories/roomRepository'
import { uploadFile, deleteFile } from '../config/storage'
import { validateUploadMagicBytes, scanBufferForMalware } from '../utils/uploadScan'
import { getSuperAdminTargetCollegeId } from '../utils/roles'
import { logger } from '../utils/logger'

const router = Router()
router.use(authenticate)

// Room chat limits + access + wire shape live in services/room/* (SRP split).
// Re-exported here for compat; new code imports from services/room directly.
import {
  CHAT_MODES,
  MAX_MESSAGE_LENGTH,
  REPLY_PREVIEW_MAX_LENGTH,
  isCollegeAdminForRoom,
  computeCanChat,
  chatDeniedMessage,
  serializeRoomMessage,
  messageWithReplyInclude,
  truncateContent,
  rankMessages,
  SEARCH_CANDIDATE_CAP,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
  getMutedRoomIds,
  setRoomMuted,
} from '../services/room';
export {
  CHAT_MODES,
  MAX_MESSAGE_LENGTH,
  REPLY_PREVIEW_MAX_LENGTH,
  isCollegeAdminForRoom,
  computeCanChat,
  chatDeniedMessage,
  serializeRoomMessage,
  messageWithReplyInclude,
  truncateContent,
  rankMessages,
  SEARCH_CANDIDATE_CAP,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
  getMutedRoomIds,
  setRoomMuted,
};

// Shared access check for chat endpoints: creator, college admin, or member
// DIP: user lookup via roomAccessStore (Prisma in prod, fake in tests).
// Room graph still via prisma (incremental migration — room read model next).
async function authorizeRoomChatAccess(roomId: string, userId: string) {
  const user = await roomAccessStore.findUserById(userId)
  if (!user) return null

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: {
      teacher: { select: { collegeId: true } },
      members: { select: { studentId: true } },
      chatAllowedMembers: { select: { userId: true } },
    },
  })
  if (!room) return null

  const isTeacher = user.role === 'TEACHER' || user.role === 'COLLEGE_ADMIN' || user.role === 'SUPER_ADMIN'
  const isCreator = isTeacher && room.teacherId === userId
  const isAdmin = !isCreator && isCollegeAdminForRoom(user, room.teacher.collegeId ?? null)
  const isMember = !isTeacher && room.members.some((m: any) => m.studentId === userId)

  if (!isCreator && !isAdmin && !isMember) return null
  return { user, room, isAdmin, isCreator }
}

// Threads-lite (#8): pin permission = room creator, college admin, or CR.
// DIP: membership lookup is a narrow select (isCR only), same shape as other guards.
async function canPinInRoom(
  auth: { room: { id: string; teacherId: string }; isAdmin: boolean; isCreator: boolean },
  userId: string,
): Promise<boolean> {
  if (auth.isCreator || auth.isAdmin) return true
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_studentId: { roomId: auth.room.id, studentId: userId } },
    select: { isCR: true },
  })
  return membership?.isCR === true
}

// Pins ride additive columns (migration 20260914000000). If deploy hasn't
// applied it yet, Prisma throws P2022/undefined-column — surface 501 (not 500)
// so clients can hide pin UI instead of reporting a crash.
function isMissingPinColumnError(e: unknown): boolean {
  const code = (e as { code?: string })?.code
  if (code === 'P2022') return true
  const msg = String((e as { message?: unknown })?.message ?? e ?? '')
  return /column/i.test(msg) && /(does not exist|not exist|no such column)/i.test(msg) && /pin/i.test(msg)
}

/** Max pinned messages per room (bounds the pinned bar + pins query). */
export const MAX_PINNED_PER_ROOM = 20

/** Zero-out unread counts for rooms the user muted (prefs-based, no migration). */
function applyMuteToUnreadCounts(
  unreadMap: Map<string, number>,
  mutedIds: string[],
): Map<string, number> {
  if (mutedIds.length === 0) return unreadMap
  const muted = new Set(mutedIds)
  for (const id of muted) if (unreadMap.has(id)) unreadMap.set(id, 0)
  return unreadMap
}

// Helper: generate 6-char join code
function generateJoinCode(): string {
  return crypto.randomBytes(3).toString('hex').toUpperCase()
}

// Helper: detect file type from extension
function getFileType(filename: string): string {
  const ext = path.extname(filename).toLowerCase()
  switch (ext) {
    case '.pdf': return 'pdf'
    case '.ppt':
    case '.pptx': return 'ppt'
    case '.doc':
    case '.docx': return 'doc'
    case '.xls':
    case '.xlsx': return 'xls'
    case '.jpg':
    case '.jpeg':
    case '.png':
    case '.gif': return 'image'
    default: return 'other'
  }
}

// Active-content extensions rejected regardless of claimed mimetype (client Content-Type is spoofable)
export const blockedUploadExtensions = ['.html', '.htm', '.xhtml', '.svg', '.xml', '.js', '.mjs', '.css']

// Configure multer for file uploads (kept in memory; persisted via storage backend)
// Streaming cap: 10MB (aborts the multipart stream via limits.fileSize).
// Magic-byte + scan-stub verification runs in the handler before uploadFile.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit (rooms chat + resources)
  fileFilter: (req, file, cb) => {
    if (blockedUploadExtensions.includes(path.extname(file.originalname).toLowerCase())) {
      cb(new Error('File type not allowed'))
      return
    }
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/jpeg',
      'image/png',
      'image/gif',
      'text/plain',
      'application/zip',
      'application/x-rar-compressed'
    ]
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('File type not allowed'))
    }
  }
})

// ─── RoomRead helpers ────────────────────────────────────────────────────────
// Batch unread counts via single GROUP BY (vs N+1 Promise.all per room).
// Mirrors isDeleted + hides logic from GET /:id/messages. Excludes self-sent and counts only > lastReadAt.
async function getUnreadCountsForUser(userId: string, roomIds: string[]): Promise<Map<string, number>> {
  if (roomIds.length === 0) return new Map()
  try {
    // Single SQL with LEFT JOIN to RoomRead to apply per-room threshold in one scan.
    // Uses indexes on RoomMessage(roomId,createdAt) and RoomRead(userId,roomId)
    const rows: Array<{ roomId: string; count: bigint | number }> = await prisma.$queryRaw`
      SELECT rm."roomId" as "roomId", COUNT(*)::int as count
      FROM "RoomMessage" rm
      LEFT JOIN "RoomRead" rr ON rr."roomId" = rm."roomId" AND rr."userId" = ${userId}
      WHERE rm."roomId" = ANY(${roomIds}::text[])
        AND rm."senderId" != ${userId}
        AND rm."isDeleted" = false
        AND NOT EXISTS (SELECT 1 FROM "MessageHide" mh WHERE mh."messageId" = rm."id" AND mh."userId" = ${userId})
        AND (rr."lastReadAt" IS NULL OR rm."createdAt" > rr."lastReadAt")
      GROUP BY rm."roomId"
    ` as any

    // Fallback if raw query fails due to driver quirks: use groupBy+filter
    if (Array.isArray(rows) && rows.length >= 0) {
      const map = new Map<string, number>()
      for (const r of rows) map.set((r as any).roomId, Number((r as any).count))
      // ensure zero entries
      for (const id of roomIds) if (!map.has(id)) map.set(id, 0)
      return map
    }
  } catch (e) {
    logger.error({ err: e }, 'Batch unread raw query failed, falling back to batched counts:')
  }
  // Batched fallback: 1 query for all messages then group in JS (still 1 DB round-trip vs N)
  try {
    const reads = await prisma.roomRead.findMany({ where: { userId, roomId: { in: roomIds } } })
    const readMap = new Map<string, Date>(reads.map((r: any) => [r.roomId, r.lastReadAt]))
    // Find earliest threshold to narrow DB scan
    let minDate: Date | undefined
    for (const d of readMap.values()) if (!minDate || d < minDate) minDate = d
    const msgs = await prisma.roomMessage.findMany({
      where: {
        roomId: { in: roomIds },
        senderId: { not: userId },
        isDeleted: false,
        hides: { none: { userId } },
        ...(minDate ? { createdAt: { gt: minDate } } : {}),
      },
      select: { roomId: true, createdAt: true },
    })
    const counts = new Map<string, number>()
    for (const id of roomIds) counts.set(id, 0)
    for (const m of msgs) {
      const threshold = readMap.get(m.roomId)
      if (threshold && m.createdAt <= threshold) continue
      counts.set(m.roomId, (counts.get(m.roomId) || 0) + 1)
    }
    return counts
  } catch (fallbackErr) {
    logger.error({ err: fallbackErr }, 'Fallback unread counts failed:')
    return new Map(roomIds.map((id) => [id, 0]))
  }
}

// 1. POST / — Create room (Teacher only)
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, name: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can create rooms' })
      return
    }

    const { name, description, departmentId } = req.body

    if (!name) {
      res.status(400).json({ error: 'Room name is required' })
      return
    }

    // Validate department if provided — only that department's students may join
    let validatedDepartmentId: string | null = null
    if (departmentId != null && String(departmentId).trim() !== '') {
      const deptId = String(departmentId).trim()
      const dept = await prisma.department.findUnique({ where: { id: deptId } })
      if (!dept) {
        res.status(400).json({ error: 'Invalid department' })
        return
      }
      if (user.role !== 'SUPER_ADMIN' && user.collegeId && dept.collegeId !== user.collegeId) {
        res.status(403).json({ error: 'Department does not belong to your college' })
        return
      }
      validatedDepartmentId = dept.id
    }

    const joinCode = generateJoinCode()

    const room = await prisma.room.create({
      data: {
        name,
        description: description || '',
        joinCode,
        teacherId: req.userId!,
        departmentId: validatedDepartmentId,
      },
      include: {
        teacher: {
          select: { id: true, name: true, email: true }
        },
        department: {
          select: { id: true, name: true }
        }
      }
    })

    try { broadcastRoomMutation({ roomId: room.id, action: 'created' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.status(201).json(room)
  } catch (error) {
    logger.error({ err: error }, 'Create room error:')
    res.status(500).json({ error: 'Failed to create room' })
  }
})

// 2. GET / — List rooms (paginated, batched unread counts)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, name: true } }) // NARROW-READ half1
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20))
    const skip = (page - 1) * limit
    const search = (req.query.search as string)?.trim()
    const searchClause = search ? { name: { contains: search, mode: 'insensitive' as const } } : {}

    let rooms: any[] = []
    let total = 0

    if (user.role === 'SUPER_ADMIN') {
      // SUPER_ADMIN: global view across all colleges — supports optional ?collegeId=/header and ?teacherId= filters
      const where: any = { ...searchClause }
      const filterCollegeId = (getSuperAdminTargetCollegeId(req) as string | undefined) || (req.query.collegeId as string | undefined)
      if (filterCollegeId) {
        // HALF1: single relation filter (was two-step fetch teacherIds + IN — extra round-trip + unbounded IDs).
        // Same visible set (rooms whose teacher is in the college), one query, no ID list.
        where.teacher = { collegeId: filterCollegeId }
      }
      const [superRooms, count] = await Promise.all([
        prisma.room.findMany({
          where,
          include: {
            teacher: { select: { id: true, name: true, email: true, collegeId: true } },
            _count: { select: { members: true, resources: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.room.count({ where }),
      ])
      rooms = superRooms
      total = count
    } else if (user.role === 'TEACHER' || user.role === 'COLLEGE_ADMIN') {
      const where: any = { teacherId: req.userId!, ...searchClause }
      const [teacherRooms, count] = await Promise.all([
        prisma.room.findMany({
          where,
          include: {
            teacher: { select: { id: true, name: true, email: true } },
            _count: { select: { members: true, resources: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.room.count({ where }),
      ])
      rooms = teacherRooms
      total = count
    } else {
      // Student: paginate via RoomMember then resolve rooms
      const whereMember: any = { studentId: req.userId! }
      // Fetch paginated members with room including teacher and counts
      const memberRooms = await prisma.roomMember.findMany({
        where: whereMember,
        include: {
          room: {
            include: {
              teacher: { select: { id: true, name: true, email: true } },
              _count: { select: { members: true, resources: true } },
            },
          },
        },
        orderBy: { joinedAt: 'desc' },
        skip,
        take: limit,
      })
      let mapped = memberRooms.map((m: any) => ({
        ...m.room,
        isCR: m.isCR,
        roomMemberId: m.id,
      }))
      if (search) {
        const q = search.toLowerCase()
        mapped = mapped.filter((r: any) => r.name.toLowerCase().includes(q))
        // Total for search: count via query then filter (O(n) but limited to student's rooms, typically < 50)
        const allMemberRooms = await prisma.roomMember.findMany({
          where: whereMember,
          select: { room: { select: { name: true } } },
        })
        total = allMemberRooms.filter((m: any) => m.room.name.toLowerCase().includes(q)).length
      } else {
        total = await prisma.roomMember.count({ where: whereMember })
      }
      rooms = mapped
    }

    // Batch unread counts (single GROUP BY vs N queries)
    try {
      const roomIds = rooms.map((r: any) => r.id)
      const unreadMap = await getUnreadCountsForUser(req.userId!, roomIds)
      // Threads-lite (#8): muted rooms report 0 (client suppresses badges too).
      try {
        const prefsRow = await prisma.user.findUnique({ where: { id: req.userId! }, select: { preferences: true } })
        applyMuteToUnreadCounts(unreadMap, getMutedRoomIds(prefsRow?.preferences))
      } catch { /* mute is best-effort — unread stays correct */ }
      rooms = rooms.map((r: any) => ({ ...r, unreadCount: unreadMap.get(r.id) ?? 0 }))
    } catch (e) {
      logger.error({ err: e }, 'Unread count attach error:')
      rooms = rooms.map((r: any) => ({ ...r, unreadCount: 0 }))
    }

    res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
    // Backward compat: if client didn't ask pagination, we still return paginated envelope
    // Frontend will handle both array and {data,pagination}. For now return envelope when page/limit present or always?
    // To avoid breaking existing callers expecting array, detect if query had page/limit/search; if none, keep array but add header
    const wantsPaginated = req.query.page !== undefined || req.query.limit !== undefined || req.query.search !== undefined
    if (wantsPaginated) {
      res.json({ data: rooms, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
    } else {
      // legacy array + pagination meta via header? Send envelope anyway but include compat flag
      res.json({ data: rooms, pagination: { page, limit: total > limit ? Math.ceil(total/limit) : 1, total, pages: Math.ceil(total/limit) } })
      // Note: older frontend expects array; it will be updated to read .data fallback
    }
  } catch (error) {
    logger.error({ err: error }, 'List rooms error:')
    res.status(500).json({ error: 'Failed to list rooms' })
  }
})

// 2b. GET /unread-counts — bulk unread map for sidebar polling (must be before /:id)
router.get('/unread-counts', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, name: true } }) // NARROW-READ half1
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    let roomIds: string[] = []
    if (user.role === 'SUPER_ADMIN') {
      const allRooms = await prisma.room.findMany({ select: { id: true } })
      roomIds = allRooms.map((r) => r.id)
    } else if (user.role === 'TEACHER' || user.role === 'COLLEGE_ADMIN') {
      const teacherRooms = await prisma.room.findMany({ where: { teacherId: req.userId! }, select: { id: true } })
      roomIds = teacherRooms.map((r) => r.id)
    } else {
      const memberRooms = await prisma.roomMember.findMany({ where: { studentId: req.userId! }, select: { roomId: true } })
      roomIds = memberRooms.map((m) => m.roomId)
    }
    const unreadMap = await getUnreadCountsForUser(req.userId!, roomIds)
    const out: Record<string, number> = {}
    // Threads-lite (#8): muted rooms report 0 (client suppresses badges too).
    try {
      const prefsRow = await prisma.user.findUnique({ where: { id: req.userId! }, select: { preferences: true } })
      applyMuteToUnreadCounts(unreadMap, getMutedRoomIds(prefsRow?.preferences))
    } catch { /* mute is best-effort — unread stays correct */ }
    for (const id of roomIds) out[id] = unreadMap.get(id) ?? 0
    // CACHE-ALL: own unread-count map — private edge SWR 10s (rooms.ts:654 messages pattern).
    res.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
    res.json(out)
  } catch (error) {
    logger.error({ err: error }, 'Unread counts error:')
    res.status(500).json({ error: 'Failed to get unread counts' })
  }
})

// 2c. POST /:id/read — mark room as read (upsert RoomRead)
router.post('/:id/read', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const auth = await authorizeRoomChatAccess(id, req.userId!)
    if (!auth) {
      res.status(403).json({ error: 'Access denied' })
      return
    }
    const now = new Date()
    await prisma.roomRead.upsert({
      where: { roomId_userId: { roomId: id, userId: req.userId! } },
      create: { roomId: id, userId: req.userId!, lastReadAt: now },
      update: { lastReadAt: now },
    })
    res.json({ success: true, lastReadAt: now })
  } catch (error) {
    logger.error({ err: error }, 'Mark room read error:')
    res.status(500).json({ error: 'Failed to mark room as read' })
  }
})

// 2d. GET /muted — muted room ids for the caller (MUST stay above /:id).
// Threads-lite (#8): per-channel mute lives in User.preferences JSON
// (mutedRooms key) — no migration, localStorage mirrors it client-side.
router.get('/muted', async (req: AuthRequest, res: Response) => {
  try {
    const row = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { preferences: true },
    })
    if (!row) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    res.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
    res.json({ mutedRoomIds: getMutedRoomIds((row as any).preferences) })
  } catch (error) {
    logger.error({ err: error }, 'List muted rooms error:')
    res.status(500).json({ error: 'Failed to list muted rooms' })
  }
})

// 2e. PUT /:id/mute — mute/unmute one room. Body: { muted: boolean }.
// Any room member/creator/admin may mute for THEMSELVES (no privilege needed).
router.put('/:id/mute', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const { muted } = req.body
    if (typeof muted !== 'boolean') {
      res.status(400).json({ error: 'muted must be a boolean' })
      return
    }
    const auth = await authorizeRoomChatAccess(id, req.userId!)
    if (!auth) {
      res.status(403).json({ error: 'Access denied' })
      return
    }
    const row = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { preferences: true },
    })
    if (!row) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    const next = setRoomMuted((row as any).preferences, id, muted)
    await prisma.user.update({ where: { id: req.userId! }, data: { preferences: (typeof next === 'string' ? JSON.parse(next) : next) as any } })
    res.json({ roomId: id, muted })
  } catch (error) {
    logger.error({ err: error }, 'Mute room error:')
    res.status(500).json({ error: 'Failed to update mute preference' })
  }
})

// 2f. GET /:id/pins — pinned messages, newest pinned first (cap 20).
// Threads-lite (#8): pin/unpin is teacher/CR-only; everyone with room access can READ.
router.get('/:id/pins', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const auth = await authorizeRoomChatAccess(id, req.userId!)
    if (!auth) {
      res.status(403).json({ error: 'Access denied' })
      return
    }
    try {
      const pins = await prisma.roomMessage.findMany({
        where: { roomId: id, isPinned: true, isDeleted: false, hides: { none: { userId: req.userId! } } },
        orderBy: [{ pinnedAt: 'desc' }, { createdAt: 'desc' }],
        take: MAX_PINNED_PER_ROOM,
        include: messageWithReplyInclude,
      })
      res.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
      res.json(pins.map(serializeRoomMessage))
    } catch (e) {
      if (isMissingPinColumnError(e)) {
        res.status(501).json({ error: 'Pins unavailable — migration pending' })
        return
      }
      throw e
    }
  } catch (error) {
    logger.error({ err: error }, 'List pins error:')
    res.status(500).json({ error: 'Failed to list pinned messages' })
  }
})

// 2g. GET /:id/threads — thread parents (messages with ≥1 reply), most replies first.
// Threads-lite (#8): replyToId IS the thread parent — groupBy for exact counts
// + one bounded findMany for the parents (HALF1 take-cap: every take ≤ 50).
router.get('/:id/threads', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const auth = await authorizeRoomChatAccess(id, req.userId!)
    if (!auth) {
      res.status(403).json({ error: 'Access denied' })
      return
    }
    const limitParam = parseInt(String(req.query.limit || '20'), 10)
    const limit = Number.isFinite(limitParam) ? Math.min(50, Math.max(1, limitParam)) : 20

    const groups = await prisma.roomMessage.groupBy({
      by: ['replyToId'],
      where: {
        roomId: id,
        replyToId: { not: null },
        isDeleted: false,
        hides: { none: { userId: req.userId! } },
      },
      _count: { _all: true },
    })
    if (groups.length === 0) {
      res.json({ data: [] })
      return
    }
    const top = [...groups]
      .sort((a, b) => b._count._all - a._count._all)
      .slice(0, limit)
    const parentIds = top.map((g) => g.replyToId as string)
    const countByParent = new Map(top.map((g) => [g.replyToId as string, g._count._all]))

    const parents = await prisma.roomMessage.findMany({
      where: { id: { in: parentIds }, roomId: id, hides: { none: { userId: req.userId! } } },
      take: limit,
      include: messageWithReplyInclude,
    })
    const byId = new Map(parents.map((p: any) => [p.id, p]))
    // Preserve most-replies-first order; drop parents the caller hid (scope=me).
    const data: Record<string, unknown>[] = []
    for (const pid of parentIds) {
      const p = byId.get(pid)
      if (p) data.push({ ...serializeRoomMessage(p), replyCount: countByParent.get(pid) ?? 0 })
    }
    res.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
    res.json({ data })
  } catch (error) {
    logger.error({ err: error }, 'List threads error:')
    res.status(500).json({ error: 'Failed to list threads' })
  }
})

// 3. GET /:id — Get single room
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    // HALF1: user + room independent → Promise.all (was sequential).
    const [user, room] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, name: true } }), // NARROW-READ half1
      prisma.room.findUnique({
        where: { id },
        include: {
          teacher: {
            select: { id: true, name: true, email: true, collegeId: true }
          },
          members: {
            include: {
              student: {
                select: { id: true, name: true, email: true, studentId: true }
              }
            }
          },
          resources: true,
          chatAllowedMembers: {
            include: {
              user: {
                select: { id: true, name: true, email: true, studentId: true }
              }
            }
          }
        },
      }),
    ])
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    // Check access
    const isTeacher = user.role === 'TEACHER' || user.role === 'COLLEGE_ADMIN' || user.role === 'SUPER_ADMIN'
    const isCreator = isTeacher && room.teacherId === req.userId
    const isAdmin = !isCreator && isCollegeAdminForRoom(user, room.teacher.collegeId ?? null)
    const isMember = !isTeacher && room.members.some((m: any) => m.studentId === req.userId)

    if (!isCreator && !isAdmin && !isMember) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    // Group resources by category
    const groupedResources = room.resources.reduce((acc: Record<string, any[]>, resource: any) => {
      const category = resource.category
      if (!acc[category]) acc[category] = []
      acc[category].push(resource)
      return acc
    }, {} as Record<string, any[]>)

    const allowedUserIds = new Set(room.chatAllowedMembers.map((a: any) => a.userId))
    const canChat = computeCanChat(room.chatMode, isCreator, isAdmin, allowedUserIds.has(req.userId!))

    res.json({
      ...room,
      groupedResources,
      chatMode: room.chatMode,
      canChat,
      canManageSettings: isCreator || isAdmin,
      allowedMembers: room.chatAllowedMembers.map((a: any) => a.user)
    })
  } catch (error) {
    logger.error({ err: error }, 'Get room error:')
    res.status(500).json({ error: 'Failed to get room' })
  }
})

// 3b. PUT /:id/settings — Update chat settings (Creator or college admin only)
router.put('/:id/settings', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, name: true } }) // NARROW-READ half1
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const room = await prisma.room.findUnique({
      where: { id },
      include: { teacher: { select: { collegeId: true } } }
    })
    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    const isTeacher = user.role === 'TEACHER' || user.role === 'COLLEGE_ADMIN' || user.role === 'SUPER_ADMIN'
    const isCreator = isTeacher && room.teacherId === req.userId
    const isAdmin = !isCreator && isCollegeAdminForRoom(user, room.teacher.collegeId ?? null)

    if (!isCreator && !isAdmin) {
      res.status(403).json({ error: 'Only the room creator or college admins can change chat settings' })
      return
    }

    const { chatMode, allowedUserIds } = req.body

    if (!chatMode || !CHAT_MODES.includes(chatMode)) {
      res.status(400).json({ error: `chatMode must be one of: ${CHAT_MODES.join(', ')}` })
      return
    }

    // Validate allowlist: every picked user must be a current room member
    let sanitizedAllowedIds: string[] = []
    if (chatMode === 'SELECTED') {
      if (allowedUserIds !== undefined && !Array.isArray(allowedUserIds)) {
        res.status(400).json({ error: 'allowedUserIds must be an array of user ids' })
        return
      }
      const requested: string[] = Array.isArray(allowedUserIds) ? allowedUserIds.filter((v: any) => typeof v === 'string') : []
      const unique = Array.from(new Set(requested))
      if (unique.length > 0) {
        const memberIds = await prisma.roomMember.findMany({
          where: { roomId: id, studentId: { in: unique } },
          select: { studentId: true }
        })
        const memberSet = new Set(memberIds.map((m: any) => m.studentId))
        const invalid = unique.filter((uid) => !memberSet.has(uid))
        if (invalid.length > 0) {
          res.status(400).json({ error: `${invalid.length} selected user(s) are not members of this room` })
          return
        }
      }
      sanitizedAllowedIds = unique
    }

    await prisma.$transaction([
      prisma.roomChatAllowedMember.deleteMany({ where: { roomId: id } }),
      prisma.room.update({ where: { id }, data: { chatMode } }),
      prisma.roomChatAllowedMember.createMany({
        data: sanitizedAllowedIds.map((userId) => ({ roomId: id, userId })),
        skipDuplicates: true,
      }),
    ])

    const updatedRoom = await prisma.room.findUnique({
      where: { id },
      include: {
        chatAllowedMembers: {
          include: {
            user: { select: { id: true, name: true, email: true, studentId: true } }
          }
        }
      }
    })

    try { broadcastRoomMutation({ roomId: id, action: 'settings:updated' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.json({
      chatMode: updatedRoom!.chatMode,
      allowedMembers: updatedRoom!.chatAllowedMembers.map((a: any) => a.user)
    })
  } catch (error) {
    logger.error({ err: error }, 'Update room settings error:')
    res.status(500).json({ error: 'Failed to update room settings' })
  }
})

// 3c. GET /:id/messages — List room chat messages (creator, admins and members)
router.get('/:id/messages', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, name: true } }) // NARROW-READ half1
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const room = await prisma.room.findUnique({
      where: { id },
      include: {
        teacher: { select: { collegeId: true } },
        members: { select: { studentId: true } },
        chatAllowedMembers: { select: { userId: true } }
      }
    })
    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    const isTeacher = user.role === 'TEACHER' || user.role === 'COLLEGE_ADMIN' || user.role === 'SUPER_ADMIN'
    const isCreator = isTeacher && room.teacherId === req.userId
    const isAdmin = !isCreator && isCollegeAdminForRoom(user, room.teacher.collegeId ?? null)
    const isMember = !isTeacher && room.members.some((m: any) => m.studentId === req.userId)

    if (!isCreator && !isAdmin && !isMember) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    // Latest page first, then chronological order for rendering.
    // `hides: { none }` excludes messages this user hid via scope=me deletes;
    // tombstoned (isDeleted) messages stay in the list but are stripped server-side.
    // 10k scale: cursor pagination (take:50 max) + count. Uses (roomId, createdAt)
    // index (see schema) with id tiebreak for stable keyset. Dual-mode: no query
    // → capped array (compat); ?cursor/?limit/?page → envelope with total+nextCursor.
    const wantsPaged = req.query.cursor != null || req.query.limit != null || req.query.page != null
    const limitParam = parseInt(String(req.query.limit || '50'), 10)
    const limit = Number.isFinite(limitParam) ? Math.min(50, Math.max(1, limitParam)) : 50
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
    const cursorId = req.query.cursor ? String(req.query.cursor) : null
    const where: any = { roomId: id, hides: { none: { userId: req.userId! } } }
    const cursorClause: any = cursorId ? { cursor: { id: cursorId }, skip: 1 } : { skip: (page - 1) * limit }
    const [messages, total] = await Promise.all([
      prisma.roomMessage.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        ...cursorClause,
        include: messageWithReplyInclude,
      }),
      wantsPaged ? prisma.roomMessage.count({ where }) : Promise.resolve(-1),
    ])

    const data = [...messages].reverse().map(serializeRoomMessage)
    res.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
    if (wantsPaged) {
      const pages = Math.ceil((total as number) / limit)
      // messages[] is desc; oldest in batch is last → cursor for "load older".
      const nextCursor = messages.length === limit ? (messages[messages.length - 1] as any)?.id ?? null : null
      res.json({ data, pagination: { page, limit, total, pages, nextCursor } })
      return
    }
    res.json(data)
  } catch (error) {
    logger.error({ err: error }, 'List messages error:')
    res.status(500).json({ error: 'Failed to load messages' })
  }
})

// 3d. POST /:id/messages — Send a room chat message (multipart; optional file attachment)
// Access + chatMode permissions are enforced in authorizeChatMessage before multer runs.
router.post('/:id/messages', authorizeChatMessage, upload.single('file'), handleUploadError, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const user = res.locals.chatUser
    const room = res.locals.chatRoom

    const content = typeof req.body.content === 'string' ? req.body.content.trim() : ''
    if (!content && !req.file) {
      res.status(400).json({ error: 'Message content or a file is required' })
      return
    }
    if (content.length > MAX_MESSAGE_LENGTH) {
      res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` })
      return
    }

    // Optional reply parent: must reference an existing message in the SAME room.
    // replyToId arrives as a multipart form field alongside content/file.
    const rawReplyToId = typeof req.body.replyToId === 'string' ? req.body.replyToId.trim() : ''
    let replyToId: string | null = null
    if (rawReplyToId) {
      const parent = await prisma.roomMessage.findUnique({
        where: { id: rawReplyToId },
        select: { roomId: true },
      })
      if (!parent || parent.roomId !== id) {
        res.status(400).json({ error: 'Invalid reply target' })
        return
      }
      replyToId = rawReplyToId
    }

    // Persist the attachment via the shared storage backend (same path as resources)
    let attachment: { fileUrl: string; fileName: string; fileType: string; fileSize: number } | null = null
    if (req.file) {
      // Magic-byte + scan-stub (blocks html/svg/xml/js polyglots with allowed ext)
      const magicErr = await validateUploadMagicBytes(req.file.buffer, req.file.originalname, req.file.mimetype, 'rooms')
      if (magicErr) {
        res.status(400).json({ error: magicErr })
        return
      }
      const scan = await scanBufferForMalware(req.file.buffer, req.file.originalname)
      if (!scan.clean) {
        res.status(400).json({ error: scan.reason || 'File rejected by scan' })
        return
      }
      const stored = await uploadFile(req.file.buffer, {
        folder: `rooms/${id}`,
        resourceType: 'auto',
        fileName: req.file.originalname,
      })
      attachment = {
        fileUrl: stored.url,
        fileName: req.file.originalname,
        fileType: getFileType(req.file.originalname),
        fileSize: req.file.size,
      }
    }

    // Message + mirrored Resource row are created atomically so chat attachments
    // always show up in the Resources tab
    const message = await prisma.$transaction(async (tx) => {
      const msg = await tx.roomMessage.create({
        data: {
          roomId: id,
          senderId: req.userId!,
          content,
          replyToId,
          ...(attachment ?? {})
        },
      })

      if (attachment) {
        await tx.resource.create({
          data: {
            title: attachment.fileName,
            description: `Shared in chat by ${user.name}`,
            fileUrl: attachment.fileUrl,
            fileType: attachment.fileType,
            category: 'other',
            fileSize: attachment.fileSize,
            sourceMessageId: msg.id,
            roomId: id,
            uploadedBy: req.userId!
          }
        })
      }

      return msg
    })

    // Re-fetch with the reply-parent preview so every client (HTTP response and
    // socket broadcast) renders the same serialized shape
    const saved = await prisma.roomMessage.findUnique({
      where: { id: message.id },
      include: messageWithReplyInclude,
    })
    const payload = serializeRoomMessage(saved)

    // Broadcast to creator + all members via their personal socket rooms
    const recipientIds = Array.from(new Set([room.teacherId, ...room.members.map((m: any) => m.studentId)]))
    try {
      emitRoomMessage(recipientIds, payload)
    } catch (err) {
      logger.error({ err: err }, 'Room message broadcast error:')
    }

    res.status(201).json(payload)
  } catch (error) {
    logger.error({ err: error }, 'Send message error:')
    res.status(500).json({ error: 'Failed to send message' })
  }
})

// 3e. DELETE /:id/messages/:messageId?scope=me|everyone — Delete a chat message
// scope=me (default): any room member hides the message from their own view only (idempotent).
// scope=everyone: sender, room creator or college admin tombstones it for all recipients.
router.delete('/:id/messages/:messageId', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const messageId = String(req.params.messageId)
    const scope = req.query.scope === undefined || req.query.scope === null ? 'me' : String(req.query.scope)

    if (scope !== 'me' && scope !== 'everyone') {
      res.status(400).json({ error: 'scope must be "me" or "everyone"' })
      return
    }

    const auth = await authorizeRoomChatAccess(id, req.userId!)
    if (!auth) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    const message = await prisma.roomMessage.findUnique({ where: { id: messageId } })
    if (!message || message.roomId !== id) {
      res.status(404).json({ error: 'Message not found' })
      return
    }

    if (scope === 'me') {
      // Idempotent per-user hide; other members still see the message
      await prisma.messageHide.upsert({
        where: { messageId_userId: { messageId, userId: req.userId! } },
        update: {},
        create: { messageId, userId: req.userId! },
      })
      res.json({ message: 'Message deleted for you' })
      return
    }

    // scope=everyone: sender OR creator OR college admin, and only once
    const canDeleteForEveryone =
      message.senderId === req.userId ||
      auth.room.teacherId === req.userId ||
      auth.isAdmin
    if (!canDeleteForEveryone) {
      res.status(403).json({ error: 'Only the sender, room creator or college admins can delete this message for everyone' })
      return
    }
    if (message.isDeleted) {
      res.status(400).json({ error: 'Message already deleted' })
      return
    }

    // Tombstone: keep content/attachment columns intact for audit, strip on read.
    // Threads-lite (#8): deleting also unpins (a tombstone must never stick in the pinned bar).
    await prisma.roomMessage.update({
      where: { id: messageId },
      data: { isDeleted: true, deletedAt: new Date(), isPinned: false, pinnedAt: null, pinnedBy: null },
    })

    const recipientIds = Array.from(new Set([auth.room.teacherId, ...auth.room.members.map((m: any) => m.studentId)]))
    try {
      emitRoomMessageDeleted(recipientIds, { messageId, roomId: id })
    } catch (err) {
      logger.error({ err: err }, 'Room message delete broadcast error:')
    }

    res.json({ message: 'Message deleted for everyone' })
  } catch (error) {
    logger.error({ err: error }, 'Delete message error:')
    res.status(500).json({ error: 'Failed to delete message' })
  }
})

// 3e1. PUT /:id/messages/:messageId — Edit a chat message (sender only)
router.put('/:id/messages/:messageId', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const messageId = String(req.params.messageId)
    const { content } = req.body

    if (!content || !content.trim()) {
      res.status(400).json({ error: 'Message content cannot be empty' })
      return
    }

    const auth = await authorizeRoomChatAccess(id, req.userId!)
    if (!auth) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    const message = await prisma.roomMessage.findUnique({ where: { id: messageId } })
    if (!message || message.roomId !== id) {
      res.status(404).json({ error: 'Message not found' })
      return
    }

    if (message.isDeleted) {
      res.status(400).json({ error: 'Cannot edit a deleted message' })
      return
    }

    // Only the original sender may edit their own message
    if (message.senderId !== req.userId) {
      res.status(403).json({ error: 'Only the original sender can edit their message' })
      return
    }

    const updated = await prisma.roomMessage.update({
      where: { id: messageId },
      data: { content: content.trim() },
      select: { id: true, content: true, createdAt: true, updatedAt: true },
    })

    // Broadcast edit event to all room members
    const recipientIds = Array.from(new Set([auth.room.teacherId, ...auth.room.members.map((m: any) => m.studentId)]))
    try {
      emitRoomMessageEdited(recipientIds, {
        messageId,
        roomId: id,
        content: updated.content,
        editedAt: updated.updatedAt,
      })
    } catch (err) {
      logger.error({ err: err }, 'Room message edit broadcast error:')
    }

    res.json({
      id: updated.id,
      content: updated.content,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    })
  } catch (error) {
    logger.error({ err: error }, 'Edit message error:')
    res.status(500).json({ error: 'Failed to edit message' })
  }
})

// 3f. POST /:id/messages/:messageId/forward — Forward a message to other rooms
// Body: { targetRoomIds: string[] } (non-empty, max 20). Attachment files are NOT re-uploaded:
// forwarded rows reuse the source fileUrl. Invalid targets are skipped in the summary
// instead of failing the whole request.
router.post('/:id/messages/:messageId/forward', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const messageId = String(req.params.messageId)
    const { targetRoomIds } = req.body

    if (!Array.isArray(targetRoomIds) || targetRoomIds.length === 0) {
      res.status(400).json({ error: 'targetRoomIds must be a non-empty array of room ids' })
      return
    }
    const uniqueTargets = Array.from(new Set(targetRoomIds.filter((t: unknown): t is string => typeof t === 'string' && !!t.trim())))
    if (uniqueTargets.length === 0) {
      res.status(400).json({ error: 'targetRoomIds must contain at least one valid room id' })
      return
    }
    if (uniqueTargets.length > 20) {
      res.status(400).json({ error: 'Cannot forward to more than 20 rooms at once' })
      return
    }

    const auth = await authorizeRoomChatAccess(id, req.userId!)
    if (!auth) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    const source = await prisma.roomMessage.findUnique({ where: { id: messageId } })
    if (!source || source.roomId !== id) {
      res.status(404).json({ error: 'Message not found' })
      return
    }
    if (source.isDeleted) {
      res.status(400).json({ error: 'Cannot forward a deleted message' })
      return
    }

    // Batch-load every candidate target with membership + chat-mode data
    const targets = await prisma.room.findMany({
      where: { id: { in: uniqueTargets } },
      include: {
        teacher: { select: { collegeId: true } },
        members: { select: { studentId: true } },
        chatAllowedMembers: { select: { userId: true } },
      },
    })
    const targetMap = new Map(targets.map((t) => [t.id, t]))

    const skipped: { roomId: string; reason: string }[] = []
    const validTargets: typeof targets = []

    for (const targetId of uniqueTargets) {
      const target = targetMap.get(targetId)
      if (!target) {
        skipped.push({ roomId: targetId, reason: 'Room not found' })
        continue
      }
      if (target.id === id) {
        skipped.push({ roomId: targetId, reason: 'Cannot forward to the same room' })
        continue
      }

      const isTeacherRole = auth.user.role === 'TEACHER' || auth.user.role === 'COLLEGE_ADMIN' || auth.user.role === 'SUPER_ADMIN'
      const tIsCreator = isTeacherRole && target.teacherId === req.userId
      const tIsAdmin = !tIsCreator && isCollegeAdminForRoom(auth.user, target.teacher.collegeId ?? null)
      const tIsMember = !isTeacherRole && target.members.some((m: any) => m.studentId === req.userId)

      if (!tIsCreator && !tIsAdmin && !tIsMember) {
        skipped.push({ roomId: targetId, reason: 'You are not a member of this room' })
        continue
      }

      const allowedUserIds = new Set(target.chatAllowedMembers.map((a: any) => a.userId))
      if (!computeCanChat(target.chatMode, tIsCreator, tIsAdmin, allowedUserIds.has(req.userId!))) {
        skipped.push({ roomId: targetId, reason: chatDeniedMessage(target.chatMode) })
        continue
      }

      validTargets.push(target)
    }

    // HALF1: parallel creates (was N+1 sequential awaits in loop). Same rows + broadcasts, one batch.
    const createdAll = await Promise.all(
      validTargets.map((target) =>
        prisma.roomMessage.create({
          data: {
            roomId: target.id,
            senderId: req.userId!,
            content: source.content,
            fileUrl: source.fileUrl,
            fileName: source.fileName,
            fileType: source.fileType,
            fileSize: source.fileSize,
            isForwarded: true,
          },
          include: {
            sender: { select: { id: true, name: true, email: true, avatar: true } },
          },
        }).then((created) => ({ target, created }))
      )
    )
    let forwardedCount = 0
    for (const { target, created } of createdAll) {
      const recipientIds = Array.from(new Set([target.teacherId, ...target.members.map((m: any) => m.studentId)]))
      try {
        emitRoomMessage(recipientIds, serializeRoomMessage(created))
      } catch (err) {
        logger.error({ err: err }, 'Room forward broadcast error:')
      }

      forwardedCount++
    }

    res.json({
      message: `Forwarded to ${forwardedCount} room${forwardedCount === 1 ? '' : 's'}`,
      forwarded: forwardedCount,
      skipped,
    })
  } catch (error) {
    logger.error({ err: error }, 'Forward message error:')
    res.status(500).json({ error: 'Failed to forward message' })
  }
})

// 3g. POST /:id/messages/:messageId/reactions — Toggle a reaction (add or remove)
// Body: { emoji: string }. Single emoji or compound (max 2 codepoints for ZWJ sequences).
// If the user already reacted with the same emoji it is removed; otherwise it is added.
router.post('/:id/messages/:messageId/reactions', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const messageId = String(req.params.messageId)

    const auth = await authorizeRoomChatAccess(id, req.userId!)
    if (!auth) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    // Validate emoji
    const { emoji } = req.body
    if (!emoji || typeof emoji !== 'string') {
      res.status(400).json({ error: 'emoji is required' })
      return
    }
    const trimmed = emoji.trim()
    // Allow up to 8 chars (Unicode codepoints can be 2 bytes for emoji with ZWJ)
    if (trimmed.length === 0 || trimmed.length > 8) {
      res.status(400).json({ error: 'Invalid emoji' })
      return
    }

    // Verify message exists and belongs to this room
    const message = await prisma.roomMessage.findUnique({ where: { id: messageId } })
    if (!message || message.roomId !== id) {
      res.status(404).json({ error: 'Message not found' })
      return
    }
    if (message.isDeleted) {
      res.status(400).json({ error: 'Cannot react to a deleted message' })
      return
    }

    // Toggle: check if the user already reacted with this emoji
    const existingReaction = await prisma.messageReaction.findUnique({
      where: {
        messageId_userId_emoji: {
          messageId,
          userId: req.userId!,
          emoji: trimmed,
        },
      },
    })

    let action: 'added' | 'removed'

    if (existingReaction) {
      // Remove existing reaction
      await prisma.messageReaction.delete({ where: { id: existingReaction.id } })
      action = 'removed'
    } else {
      // Add new reaction
      await prisma.messageReaction.create({
        data: {
          messageId,
          userId: req.userId!,
          emoji: trimmed,
        },
      })
      action = 'added'
    }

    // Fetch all reactions for this message to compute grouped counts
    const allReactions = await prisma.messageReaction.findMany({
      where: { messageId },
      select: { emoji: true, userId: true },
    })

    const grouped: Record<string, number> = {}
    for (const r of allReactions) {
      grouped[r.emoji] = (grouped[r.emoji] || 0) + 1
    }

    // Compute myReactions for the requesting user
    const myReactions = allReactions
      .filter((r) => r.userId === req.userId!)
      .map((r) => r.emoji)

    // Build per-user reaction lists for broadcasting
    const myReactionsByUser: Record<string, string[]> = {}
    for (const r of allReactions) {
      if (!myReactionsByUser[r.userId]) myReactionsByUser[r.userId] = []
      if (!myReactionsByUser[r.userId].includes(r.emoji)) {
        myReactionsByUser[r.userId].push(r.emoji)
      }
    }

    // Broadcast to all room members
    const recipientIds = Array.from(
      new Set([auth.room.teacherId, ...auth.room.members.map((m: any) => m.studentId)])
    )
    try {
      emitRoomMessageReaction(recipientIds, {
        messageId,
        roomId: id,
        userId: req.userId!,
        emoji: trimmed,
        action,
        reactions: grouped,
        myReactions, // placeholder; overridden per-recipient below
        myReactionsByUser,
      })
    } catch (err) {
      logger.error({ err: err }, 'Room reaction broadcast error:')
    }

    res.json({ reactions: grouped, myReactions })
  } catch (error) {
    logger.error({ err: error }, 'Toggle reaction error:')
    res.status(500).json({ error: 'Failed to toggle reaction' })
  }
})

// 3h. POST /:id/messages/:messageId/pin — Pin a message (teacher/CR only).
// Threads-lite (#8): pinned bar reads GET /:id/pins; pin state rides the
// message wire + 'room:message:pin' socket event. Cap keeps the bar bounded.
router.post('/:id/messages/:messageId/pin', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const messageId = String(req.params.messageId)

    const auth = await authorizeRoomChatAccess(id, req.userId!)
    if (!auth) {
      res.status(403).json({ error: 'Access denied' })
      return
    }
    if (!(await canPinInRoom(auth, req.userId!))) {
      res.status(403).json({ error: 'Only teachers and CRs can pin messages' })
      return
    }

    const message = await prisma.roomMessage.findUnique({ where: { id: messageId } })
    if (!message || message.roomId !== id) {
      res.status(404).json({ error: 'Message not found' })
      return
    }
    if (message.isDeleted) {
      res.status(400).json({ error: 'Cannot pin a deleted message' })
      return
    }

    try {
      if (!message.isPinned) {
        const pinnedCount = await prisma.roomMessage.count({
          where: { roomId: id, isPinned: true, isDeleted: false },
        })
        if (pinnedCount >= MAX_PINNED_PER_ROOM) {
          res.status(400).json({ error: `Pin limit reached (max ${MAX_PINNED_PER_ROOM} per room) — unpin one first` })
          return
        }
      }
      const updated = await prisma.roomMessage.update({
        where: { id: messageId },
        data: { isPinned: true, pinnedAt: new Date(), pinnedBy: req.userId! },
        include: messageWithReplyInclude,
      })
      const payload = serializeRoomMessage(updated)
      const recipientIds = Array.from(new Set([auth.room.teacherId, ...auth.room.members.map((m: any) => m.studentId)]))
      try {
        emitRoomMessagePin(recipientIds, { messageId, roomId: id, isPinned: true, pinnedBy: req.userId! })
      } catch (err) {
        logger.error({ err: err }, 'Room pin broadcast error:')
      }
      res.json(payload)
    } catch (e) {
      if (isMissingPinColumnError(e)) {
        res.status(501).json({ error: 'Pins unavailable — migration pending' })
        return
      }
      throw e
    }
  } catch (error) {
    logger.error({ err: error }, 'Pin message error:')
    res.status(500).json({ error: 'Failed to pin message' })
  }
})

// 3i. DELETE /:id/messages/:messageId/pin — Unpin (teacher/CR only, idempotent).
router.delete('/:id/messages/:messageId/pin', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const messageId = String(req.params.messageId)

    const auth = await authorizeRoomChatAccess(id, req.userId!)
    if (!auth) {
      res.status(403).json({ error: 'Access denied' })
      return
    }
    if (!(await canPinInRoom(auth, req.userId!))) {
      res.status(403).json({ error: 'Only teachers and CRs can unpin messages' })
      return
    }

    const message = await prisma.roomMessage.findUnique({ where: { id: messageId } })
    if (!message || message.roomId !== id) {
      res.status(404).json({ error: 'Message not found' })
      return
    }

    try {
      const updated = await prisma.roomMessage.update({
        where: { id: messageId },
        data: { isPinned: false, pinnedAt: null, pinnedBy: null },
        include: messageWithReplyInclude,
      })
      const payload = serializeRoomMessage(updated)
      const recipientIds = Array.from(new Set([auth.room.teacherId, ...auth.room.members.map((m: any) => m.studentId)]))
      try {
        emitRoomMessagePin(recipientIds, { messageId, roomId: id, isPinned: false })
      } catch (err) {
        logger.error({ err: err }, 'Room unpin broadcast error:')
      }
      res.json(payload)
    } catch (e) {
      if (isMissingPinColumnError(e)) {
        res.status(501).json({ error: 'Pins unavailable — migration pending' })
        return
      }
      throw e
    }
  } catch (error) {
    logger.error({ err: error }, 'Unpin message error:')
    res.status(500).json({ error: 'Failed to unpin message' })
  }
})

// 3j. GET /:id/messages/:messageId/thread — one thread: parent + direct replies (asc).
// Threads-lite (#8): single-level nesting (replies-to-replies attach to their
// direct replyToId parent; the UI renders the map depth-capped).
router.get('/:id/messages/:messageId/thread', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const messageId = String(req.params.messageId)

    const auth = await authorizeRoomChatAccess(id, req.userId!)
    if (!auth) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    const parent = await prisma.roomMessage.findFirst({
      where: { id: messageId, roomId: id, hides: { none: { userId: req.userId! } } },
      include: messageWithReplyInclude,
    })
    if (!parent) {
      res.status(404).json({ error: 'Message not found' })
      return
    }
    const replies = await prisma.roomMessage.findMany({
      where: { replyToId: messageId, roomId: id, hides: { none: { userId: req.userId! } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 50,
      include: messageWithReplyInclude,
    })
    res.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
    res.json({ parent: serializeRoomMessage(parent), replies: replies.map(serializeRoomMessage) })
  } catch (error) {
    logger.error({ err: error }, 'Get thread error:')
    res.status(500).json({ error: 'Failed to load thread' })
  }
})

// 3k. GET /:id/messages/search — ranked search within one room.
// Threads-lite (#8): exact substring > word-prefix > fuzzy (see services/room/search).
// Bounded candidate scan (latest 200, unhidden, non-deleted) keeps it index-friendly
// on Postgres AND local SQLite (no pg_trgm). `auth` unused beyond access — intentional.
router.get('/:id/messages/search', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    if (!q) {
      res.status(400).json({ error: 'q is required' })
      return
    }
    if (q.length > 200) {
      res.status(400).json({ error: 'q is too long (max 200 characters)' })
      return
    }
    const limitParam = parseInt(String(req.query.limit || String(SEARCH_DEFAULT_LIMIT)), 10)
    const limit = Number.isFinite(limitParam) ? Math.min(SEARCH_MAX_LIMIT, Math.max(1, limitParam)) : SEARCH_DEFAULT_LIMIT

    const auth = await authorizeRoomChatAccess(id, req.userId!)
    if (!auth) {
      res.status(403).json({ error: 'Access denied' })
      return
    }
    void auth

    const candidates = await prisma.roomMessage.findMany({
      where: { roomId: id, isDeleted: false, hides: { none: { userId: req.userId! } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: SEARCH_CANDIDATE_CAP,
      include: messageWithReplyInclude,
    })
    const hits = rankMessages(candidates as any, q, limit)
    res.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
    res.json({
      query: q,
      data: hits.map((h) => ({ ...serializeRoomMessage(h.message as any), rank: h.score, match: h.kind })),
    })
  } catch (error) {
    logger.error({ err: error }, 'Search messages error:')
    res.status(500).json({ error: 'Failed to search messages' })
  }
})

// 4. PUT /:id — Update room (Teacher only)
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, name: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can update rooms' })
      return
    }

    const room = await prisma.room.findUnique({ where: { id }, include: { teacher: { select: { collegeId: true } } } })
    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    const canUpdate = room.teacherId === req.userId || user.role === 'SUPER_ADMIN' || (user.role === 'COLLEGE_ADMIN' && user.collegeId && room.teacher.collegeId === user.collegeId)
    if (!canUpdate) {
      res.status(403).json({ error: 'Only room creator, college admin, or super admin can update' })
      return
    }

    const { name, description } = req.body

    const updatedRoom = await prisma.room.update({
      where: { id },
      data: {
        name: name || undefined,
        description: description !== undefined ? description : undefined,
      },
      include: {
        teacher: {
          select: { id: true, name: true, email: true }
        }
      }
    })

    try { broadcastRoomMutation({ roomId: id, action: 'updated' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.json(updatedRoom)
  } catch (error) {
    logger.error({ err: error }, 'Update room error:')
    res.status(500).json({ error: 'Failed to update room' })
  }
})

// 5. DELETE /:id — Delete room (Teacher/CollegeAdmin/Super)
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, name: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can delete rooms' })
      return
    }

    const room = await prisma.room.findUnique({ where: { id }, include: { teacher: { select: { collegeId: true } } } })
    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    const canDelete = room.teacherId === req.userId || user.role === 'SUPER_ADMIN' || (user.role === 'COLLEGE_ADMIN' && user.collegeId && room.teacher.collegeId === user.collegeId)
    if (!canDelete) {
      res.status(403).json({ error: 'Only room creator, college admin, or super admin can delete' })
      return
    }

    // Collect stored file URLs before the cascade removes the records
    const resources = await prisma.resource.findMany({ where: { roomId: id }, select: { fileUrl: true } })

    // Delete room and cascade (handled by Prisma onDelete)
    await prisma.room.delete({ where: { id } })

    // Best-effort removal from storage backend
    await Promise.allSettled(resources.map((r) => deleteFile(r.fileUrl)))

    // Remove any leftover local files
    const uploadDir = path.join(__dirname, '../../uploads/rooms', id)
    if (fs.existsSync(uploadDir)) {
      fs.rmSync(uploadDir, { recursive: true, force: true })
    }

    try { broadcastRoomMutation({ roomId: id, action: 'deleted' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.json({ message: 'Room deleted' })
  } catch (error) {
    logger.error({ err: error }, 'Delete room error:')
    res.status(500).json({ error: 'Failed to delete room' })
  }
})

// 6. POST /join — Join room by code only (no roomId needed, Student only)
router.post('/join', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, name: true } }) // NARROW-READ half1
    if (!user || user.role !== 'STUDENT') {
      res.status(403).json({ error: 'Only students can join rooms' })
      return
    }

    const { code } = req.body
    if (!code || code.length !== 6) {
      res.status(400).json({ error: 'Invalid join code' })
      return
    }

    const room = await prisma.room.findUnique({
      where: { joinCode: code.toUpperCase() },
      include: {
        teacher: { select: { id: true, name: true, email: true } }
      }
    })
    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    // Department-scoped access: if room has departmentId, only that department's students may join
    if ((room as any).departmentId != null) {
      const isPrivileged = (['TEACHER', 'COLLEGE_ADMIN', 'SUPER_ADMIN'] as string[]).includes(user.role)
      if (!isPrivileged && user.departmentId !== (room as any).departmentId) {
        res.status(403).json({ error: 'Only students from the assigned department can join this room' })
        return
      }
    }

    // Check if already a member
    const existing = await prisma.roomMember.findUnique({
      where: { roomId_studentId: { roomId: room.id, studentId: user.id } },
    })
    if (existing) {
      res.status(400).json({ error: 'Already a member of this room' })
      return
    }

    // Add as member
    await prisma.roomMember.create({
      data: { roomId: room.id, studentId: user.id },
    })

    // Create notification for other members
    const otherMembers = await prisma.roomMember.findMany({
      where: { roomId: room.id, studentId: { not: user.id } },
      select: { studentId: true }
    })
    const notificationPromises = otherMembers.map((m: any) =>
      prisma.roomNotification.create({
        data: {
          roomId: room.id,
          studentId: m.studentId,
          message: `${user.name} joined the room`,
        },
      })
    )
    await Promise.all(notificationPromises)

    try { broadcastRoomMutation({ roomId: room.id, action: 'member:joined' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.json({ message: 'Joined room successfully', room })
  } catch (error) {
    logger.error({ err: error }, 'Join room by code error:')
    res.status(500).json({ error: 'Failed to join room' })
  }
})

// 7. POST /:id/join — Join room by code + roomId (Student only)
router.post('/:id/join', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const { code } = req.body
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, name: true } }) // NARROW-READ half1
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    if (user.role !== 'STUDENT') {
      res.status(403).json({ error: 'Only students can join rooms' })
      return
    }

    if (!code) {
      res.status(400).json({ error: 'Join code is required' })
      return
    }

    const room = await prisma.room.findUnique({ where: { id } })
    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    if (room.joinCode !== String(code).toUpperCase()) {
      res.status(400).json({ error: 'Invalid join code' })
      return
    }

    // Department-scoped access: if room has departmentId, only that department's students may join
    if ((room as any).departmentId != null) {
      const isPrivileged = (['TEACHER', 'COLLEGE_ADMIN', 'SUPER_ADMIN'] as string[]).includes(user.role)
      if (!isPrivileged && user.departmentId !== (room as any).departmentId) {
        res.status(403).json({ error: 'Only students from the assigned department can join this room' })
        return
      }
    }

    // Check if already a member
    const existingMember = await prisma.roomMember.findUnique({
      where: {
        roomId_studentId: {
          roomId: id,
          studentId: req.userId!
        }
      }
    })

    if (existingMember) {
      res.status(400).json({ error: 'Already a member of this room' })
      return
    }

    // Add as member
    const member = await prisma.roomMember.create({
      data: {
        roomId: id,
        studentId: req.userId!
      }
    })

    // Create notifications for all other members
    const allMembers = await prisma.roomMember.findMany({
      where: { roomId: id },
      select: { studentId: true }
    })

    const notificationPromises = allMembers
      .filter((m: any) => m.studentId !== req.userId)
      .map((m: any) =>
        prisma.roomNotification.create({
          data: {
            roomId: id,
            studentId: m.studentId,
            message: `${user.name} joined the room`
          }
        })
      )

    await Promise.all(notificationPromises)

    try { broadcastRoomMutation({ roomId: id, action: 'member:joined' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.status(201).json({ message: 'Joined room successfully', member })
  } catch (error) {
    logger.error({ err: error }, 'Join room error:')
    res.status(500).json({ error: 'Failed to join room' })
  }
})

// 7. POST /:id/leave — Leave room (Student only)
router.post('/:id/leave', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, name: true } }) // NARROW-READ half1
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    if (user.role !== 'STUDENT') {
      res.status(403).json({ error: 'Only students can leave rooms' })
      return
    }

    const member = await prisma.roomMember.findUnique({
      where: {
        roomId_studentId: {
          roomId: id,
          studentId: req.userId!
        }
      }
    })

    if (!member) {
      res.status(400).json({ error: 'Not a member of this room' })
      return
    }

    // Remove member
    await prisma.roomMember.delete({
      where: {
        roomId_studentId: {
          roomId: id,
          studentId: req.userId!
        }
      }
    })

    // Create notifications for all remaining members
    const allMembers = await prisma.roomMember.findMany({
      where: { roomId: id },
      select: { studentId: true }
    })

    const notificationPromises = allMembers.map((m: any) =>
      prisma.roomNotification.create({
        data: {
          roomId: id,
          studentId: m.studentId,
          message: `${user.name} left the room`
        }
      })
    )

    await Promise.all(notificationPromises)

    try { broadcastRoomMutation({ roomId: id, action: 'member:left' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.json({ message: 'Left room successfully' })
  } catch (error) {
    logger.error({ err: error }, 'Leave room error:')
    res.status(500).json({ error: 'Failed to leave room' })
  }
})

// 8. GET /:id/members — List room members
router.get('/:id/members', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, name: true } }) // NARROW-READ half1
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const room = await prisma.room.findUnique({ where: { id } })
    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    // Check access
    const isTeacher = user.role === 'TEACHER' || user.role === 'COLLEGE_ADMIN' || user.role === 'SUPER_ADMIN'
    const isCreator = isTeacher && room.teacherId === req.userId
    const isMember = !isTeacher && await prisma.roomMember.findUnique({
      where: {
        roomId_studentId: {
          roomId: id,
          studentId: req.userId!
        }
      }
    })

    if (!isCreator && !isMember) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    const members = await prisma.roomMember.findMany({
      where: { roomId: id },
      include: {
        student: {
          select: {
            id: true,
            name: true,
            email: true,
            studentId: true,
          }
        }
      },
      orderBy: { joinedAt: 'asc' }
    })

    res.json(members.map((m: any) => ({
      ...m.student,
      roomId: m.roomId,
      roomMemberId: m.id,
      isCR: m.isCR,
      joinedAt: m.joinedAt,
    })))
  } catch (error) {
    logger.error({ err: error }, 'List members error:')
    res.status(500).json({ error: 'Failed to list members' })
  }
})

// Authorize chat message send BEFORE multer buffers the multipart body
async function authorizeChatMessage(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = String(req.params.id)
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, name: true } }) // NARROW-READ half1
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const room = await prisma.room.findUnique({
      where: { id },
      include: {
        teacher: { select: { collegeId: true } },
        members: { select: { studentId: true } },
        chatAllowedMembers: { select: { userId: true } }
      }
    })
    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    const isTeacher = user.role === 'TEACHER' || user.role === 'COLLEGE_ADMIN' || user.role === 'SUPER_ADMIN'
    const isCreator = isTeacher && room.teacherId === req.userId
    const isAdmin = !isCreator && isCollegeAdminForRoom(user, room.teacher.collegeId ?? null)
    const isMember = !isTeacher && room.members.some((m: any) => m.studentId === req.userId)

    if (!isCreator && !isAdmin && !isMember) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    // Enforce chatMode permissions before any upload work happens
    const allowedUserIds = new Set(room.chatAllowedMembers.map((a: any) => a.userId))
    if (!computeCanChat(room.chatMode, isCreator, isAdmin, allowedUserIds.has(req.userId!))) {
      res.status(403).json({ error: chatDeniedMessage(room.chatMode) })
      return
    }

    res.locals.chatUser = user
    res.locals.chatRoom = room
    next()
  } catch (error) {
    logger.error({ err: error }, 'Send message auth error:')
    res.status(500).json({ error: 'Failed to send message' })
  }
}

// Map multer rejections (file filter / size limit) to client errors instead of the generic 500
function handleUploadError(err: unknown, _req: AuthRequest, res: Response, next: NextFunction) {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 10MB)' : err.message
    res.status(400).json({ error: message })
    return
  }
  if (err instanceof Error && err.message === 'File type not allowed') {
    res.status(400).json({ error: 'File type not allowed' })
    return
  }
  next(err)
}

// Authorize resource uploads BEFORE multer buffers the multipart body
async function authorizeResourceUpload(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = String(req.params.id)
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, name: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can upload resources' })
      return
    }

    const room = await prisma.room.findUnique({ where: { id } })
    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    if (room.teacherId !== req.userId) {
      res.status(403).json({ error: 'Only room creator can upload resources' })
      return
    }

    res.locals.uploadUser = user
    res.locals.uploadRoom = room
    next()
  } catch (error) {
    logger.error({ err: error }, 'Upload resource auth error:')
    res.status(500).json({ error: 'Failed to upload resource' })
  }
}

// 9. POST /:id/resources — Upload resource (Teacher only)
router.post('/:id/resources', authorizeResourceUpload, upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const user = res.locals.uploadUser
    const room = res.locals.uploadRoom

    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' })
      return
    }

    const { title, description, category } = req.body

    if (!title) {
      res.status(400).json({ error: 'Title is required' })
      return
    }

    // Magic-byte + scan-stub before persist (same policy as chat attachments)
    const magicErr = await validateUploadMagicBytes(req.file.buffer, req.file.originalname, req.file.mimetype, 'rooms')
    if (magicErr) {
      res.status(400).json({ error: magicErr })
      return
    }
    const fileType = getFileType(req.file.originalname)
    const stored = await uploadFile(req.file.buffer, {
      folder: `rooms/${id}`,
      resourceType: 'auto',
      fileName: req.file.originalname,
    })
    const fileUrl = stored.url

    const resource = await prisma.resource.create({
      data: {
        title,
        description: description || '',
        fileUrl,
        fileType,
        category: category || 'other',
        fileSize: req.file.size,
        roomId: id,
        uploadedBy: req.userId!
      }
    })

    // Create notifications for all room members
    const allMembers = await prisma.roomMember.findMany({
      where: { roomId: id },
      select: { studentId: true }
    })

    const notificationPromises = allMembers.map((m: any) =>
      prisma.roomNotification.create({
        data: {
          roomId: id,
          studentId: m.studentId,
          message: `New ${category || 'other'}: ${title}`,
          resourceUrl: fileUrl
        }
      })
    )

    await Promise.all(notificationPromises)

    // Real-time notification via Notification table + Socket.IO
    try {
      const uploaderName = user.name
      const otherMemberIds = allMembers
        .filter((m: any) => m.studentId !== req.userId)
        .map((m: any) => m.studentId)

      if (otherMemberIds.length > 0) {
        await notifyUsers(otherMemberIds, {
          title: 'New Resource Uploaded',
          message: `New resource uploaded in ${room.name}: ${title}`,
          type: 'ROOM',
          source: resource.id,
        })
      }
    } catch (err) {
      logger.error({ err: err }, 'Room resource notification error:')
    }

    try { broadcastRoomMutation({ roomId: id, action: 'resource:uploaded' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.status(201).json(resource)
  } catch (error) {
    logger.error({ err: error }, 'Upload resource error:')
    res.status(500).json({ error: 'Failed to upload resource' })
  }
})

// 10. GET /:id/resources — List resources
router.get('/:id/resources', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, name: true } }) // NARROW-READ half1
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const room = await prisma.room.findUnique({ where: { id } })
    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    // Check access
    const isTeacher = user.role === 'TEACHER' || user.role === 'COLLEGE_ADMIN' || user.role === 'SUPER_ADMIN'
    const isCreator = isTeacher && room.teacherId === req.userId
    const isMember = !isTeacher && await prisma.roomMember.findUnique({
      where: {
        roomId_studentId: {
          roomId: id,
          studentId: req.userId!
        }
      }
    })

    if (!isCreator && !isMember) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    const resources = await prisma.resource.findMany({
      where: { roomId: id },
      include: {
        uploader: {
          select: { id: true, name: true, email: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    // Group by category
    const grouped = resources.reduce((acc: Record<string, any[]>, resource: any) => {
      const category = resource.category
      if (!acc[category]) acc[category] = []
      acc[category].push(resource)
      return acc
    }, {} as Record<string, any[]>)

    res.json(grouped)
  } catch (error) {
    logger.error({ err: error }, 'List resources error:')
    res.status(500).json({ error: 'Failed to list resources' })
  }
})

// 11. DELETE /:id/resources/:resourceId — Delete resource (Teacher only)
router.delete('/:id/resources/:resourceId', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const resourceId = String(req.params.resourceId)
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, name: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can delete resources' })
      return
    }

    const room = await prisma.room.findUnique({ where: { id } })
    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    if (room.teacherId !== req.userId) {
      res.status(403).json({ error: 'Only room creator can delete resources' })
      return
    }

    const resource = await prisma.resource.findUnique({ where: { id: resourceId } })
    if (!resource || resource.roomId !== id) {
      res.status(404).json({ error: 'Resource not found' })
      return
    }

    // Delete file from storage backend (best-effort)
    await deleteFile(resource.fileUrl)

    // Delete resource record
    await prisma.resource.delete({ where: { id: resourceId } })

    try { broadcastRoomMutation({ roomId: id, action: 'resource:deleted' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.json({ message: 'Resource deleted' })
  } catch (error) {
    logger.error({ err: error }, 'Delete resource error:')
    res.status(500).json({ error: 'Failed to delete resource' })
  }
})

// 12. GET /notifications — Get student's notifications
router.get('/notifications/list', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, name: true } }) // NARROW-READ half1
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    // 10k scale: cursor pagination (take:50 max) + count. Dual-mode for compat.
    const wantsPaged = req.query.cursor != null || req.query.limit != null || req.query.page != null
    const limitParam = parseInt(String(req.query.limit || '50'), 10)
    const limit = Number.isFinite(limitParam) ? Math.min(50, Math.max(1, limitParam)) : 50
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
    const cursorId = req.query.cursor ? String(req.query.cursor) : null
    const where: any = { studentId: req.userId! }
    if (req.query.unread === 'true') where.isRead = false
    const cursorClause: any = cursorId ? { cursor: { id: cursorId }, skip: 1 } : { skip: (page - 1) * limit }
    const [notifications, total] = await Promise.all([
      prisma.roomNotification.findMany({
        where,
        include: { room: { select: { id: true, name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        ...cursorClause,
      }),
      prisma.roomNotification.count({ where }),
    ])

    res.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
    if (wantsPaged) {
      const pages = Math.ceil(total / limit)
      const nextCursor = notifications.length === limit ? (notifications[notifications.length - 1] as any)?.id ?? null : null
      res.json({ data: notifications, pagination: { page, limit, total, pages, nextCursor } })
      return
    }
    res.set('X-Total-Count', String(total))
    res.json(notifications)
  } catch (error) {
    logger.error({ err: error }, 'Get notifications error:')
    res.status(500).json({ error: 'Failed to get notifications' })
  }
})

// 13. POST /notifications/:id/read — Mark notification as read
router.post('/notifications/:id/read', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, name: true } }) // NARROW-READ half1
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const notification = await prisma.roomNotification.findUnique({ where: { id } })
    if (!notification || notification.studentId !== req.userId) {
      res.status(404).json({ error: 'Notification not found' })
      return
    }

    await prisma.roomNotification.update({
      where: { id },
      data: { isRead: true }
    })

    res.json({ message: 'Notification marked as read' })
  } catch (error) {
    logger.error({ err: error }, 'Mark notification read error:')
    res.status(500).json({ error: 'Failed to mark notification as read' })
  }
})

// 13b. PUT /notifications/read-all — Mark all as read
router.put('/notifications/read-all', async (req: AuthRequest, res: Response) => {
  try {
    await prisma.roomNotification.updateMany({
      where: { studentId: req.userId!, isRead: false },
      data: { isRead: true },
    })
    res.json({ message: 'All notifications marked as read' })
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark all as read' })
  }
})

// 13c. DELETE /notifications/:id — Delete notification
router.delete('/notifications/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const notif = await prisma.roomNotification.findUnique({ where: { id } })
    if (!notif || notif.studentId !== req.userId) {
      res.status(404).json({ error: 'Notification not found' })
      return
    }
    await prisma.roomNotification.delete({ where: { id } })
    res.json({ message: 'Notification deleted' })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete notification' })
  }
})

// 14. POST /import — Bulk import students (Teacher only, optional)
router.post('/import', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, name: true } }) // NARROW-READ half1
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ error: 'Only teachers can import students' })
      return
    }

    const { roomId, rollNumbers } = req.body

    if (!roomId || !rollNumbers || !Array.isArray(rollNumbers)) {
      res.status(400).json({ error: 'roomId and rollNumbers array are required' })
      return
    }

    const room = await prisma.room.findUnique({ where: { id: roomId } })
    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    if (room.teacherId !== req.userId) {
      res.status(403).json({ error: 'Only room creator can import students' })
      return
    }

    // Find students by studentId (roll number)
    // HALF1: narrow to id only (was full rows incl. passwordHash). Only id is used below.
    const students = await prisma.user.findMany({
      where: {
        studentId: { in: rollNumbers },
        role: 'STUDENT'
      },
      select: { id: true },
    })

    // Filter out already existing members
    const existingMembers = await prisma.roomMember.findMany({
      where: {
        roomId,
        studentId: { in: students.map((s: any) => s.id) }
      }
    })

    const existingStudentIds = new Set(existingMembers.map((m: any) => m.studentId))
    const newStudents = students.filter((s: any) => !existingStudentIds.has(s.id))

    // Add new members
    const createdMembers = await prisma.roomMember.createMany({
      data: newStudents.map((s: any) => ({
        roomId,
        studentId: s.id
      }))
    })

    try { broadcastRoomMutation({ roomId, action: 'members:imported', count: createdMembers.count }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.json({
      message: `Successfully imported ${createdMembers.count} students`,
      imported: createdMembers.count,
      skipped: rollNumbers.length - createdMembers.count
    })
  } catch (error) {
    logger.error({ err: error }, 'Import students error:')
    res.status(500).json({ error: 'Failed to import students' })
  }
})

// Make a student CR (Teacher only)
router.post('/:id/make-cr', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, name: true } }) // NARROW-READ half1
    if (!user || user.role !== 'TEACHER') {
      res.status(403).json({ error: 'Only teachers can manage CR status' })
      return
    }

    const room = await prisma.room.findUnique({ where: { id } })
    if (!room || room.teacherId !== req.userId!) {
      res.status(403).json({ error: 'You can only manage CR in your own rooms' })
      return
    }

    const { studentId } = req.body
    if (!studentId) {
      res.status(400).json({ error: 'studentId is required' })
      return
    }

    const member = await prisma.roomMember.findUnique({
      where: { roomId_studentId: { roomId: id, studentId } }
    })
    if (!member) {
      res.status(404).json({ error: 'Student is not a member of this room' })
      return
    }

    const updated = await prisma.roomMember.update({
      where: { id: member.id },
      data: { isCR: true },
    })

    try { broadcastRoomMutation({ roomId: id, action: 'member:cr:added' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.json({ member: updated })
  } catch (error) {
    logger.error({ err: error }, 'Make CR error:')
    res.status(500).json({ error: 'Failed to make CR' })
  }
})

// Remove CR status (Teacher only)
router.post('/:id/remove-cr', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id)
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, role: true, collegeId: true, departmentId: true, name: true } }) // NARROW-READ half1
    if (!user || user.role !== 'TEACHER') {
      res.status(403).json({ error: 'Only teachers can manage CR status' })
      return
    }

    const room = await prisma.room.findUnique({ where: { id } })
    if (!room || room.teacherId !== req.userId!) {
      res.status(403).json({ error: 'You can only manage CR in your own rooms' })
      return
    }

    const { studentId } = req.body
    if (!studentId) {
      res.status(400).json({ error: 'studentId is required' })
      return
    }

    const member = await prisma.roomMember.findUnique({
      where: { roomId_studentId: { roomId: id, studentId } }
    })
    if (!member) {
      res.status(404).json({ error: 'Student is not a member of this room' })
      return
    }

    const updated = await prisma.roomMember.update({
      where: { id: member.id },
      data: { isCR: false },
    })

    try { broadcastRoomMutation({ roomId: id, action: 'member:cr:removed' }) } catch (err) { logger.debug({ err }, '[broadcast] non-fatal (client still gets 200)') }
    res.json({ member: updated })
  } catch (error) {
    logger.error({ err: error }, 'Remove CR error:')
    res.status(500).json({ error: 'Failed to remove CR' })
  }
})

export default router