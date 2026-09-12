import { Server as HttpServer } from 'http'
import { Server, Socket } from 'socket.io'
import jwt from 'jsonwebtoken'
import { config } from '../config'
import prisma, { withRetry } from '../config/db'
import { logger } from '../utils/logger'
import { getRedisClient, redisDel, redisGet, redisSet } from '../lib/redis'

// ---------------------------------------------------------------------------
// Multi-instance scale-out (10k concurrent sockets).
// Presence is SHARED today (Redis `presence:{userId}` with 24h TTL +
// best-effort DEL, L1 memory fast-path). Emit fan-out still needs the
// Redis adapter for cross-instance delivery (deferred dep):
//
//   npm i @socket.io/redis-adapter redis
//   import { createAdapter } from '@socket.io/redis-adapter'
//   import { createClient } from 'redis'
//   const pubClient = createClient({ url: process.env.REDIS_URL })
//   const subClient = pubClient.duplicate()
//   await Promise.all([pubClient.connect(), subClient.connect()])
//   io.adapter(createAdapter(pubClient, subClient))
//
// Presence design: false-positive safe (stale "online" → extra no-op emit,
// never a dropped notification). Crash leaks expire in 24h; clean
// disconnects DEL immediately. Without the adapter, `emitToUser` on
// instance A still only reaches sockets on A — presence sharing is step 1,
// the adapter is step 2 (see scale10k-redis report §5).
// ---------------------------------------------------------------------------

let io: Server

/** Presence store with explicit lifecycle (I-6 factory; default in-memory). */
export class PresenceStore {
  private sockets = new Map<string, string[]>()
  add(userId: string, socketId: string): number {
    const existing = this.sockets.get(userId) || []
    if (!existing.includes(socketId)) existing.push(socketId)
    this.sockets.set(userId, existing)
    return existing.length
  }
  removeBySocket(socketId: string, knownUserId?: string): string | null {
    if (knownUserId) {
      const arr = this.sockets.get(knownUserId)
      if (arr) {
        const idx = arr.indexOf(socketId)
        if (idx !== -1) {
          arr.splice(idx, 1)
          if (arr.length === 0) this.sockets.delete(knownUserId)
          else this.sockets.set(knownUserId, arr)
          return knownUserId
        }
      }
    }
    for (const [key, arr] of this.sockets.entries()) {
      const idx = arr.indexOf(socketId)
      if (idx !== -1) {
        arr.splice(idx, 1)
        if (arr.length === 0) this.sockets.delete(key)
        return key
      }
    }
    return null
  }
  isOnline(userId: string): boolean {
    const s = this.sockets.get(userId)
    return !!s && s.length > 0
  }
  clearForTests(): void {
    this.sockets.clear()
  }
}

export const presence = new PresenceStore()

const userSockets = new Map<string, string[]>()

/** Factory for presence (I-3: testable, no module-global in new code). */
export function createPresenceStore(): PresenceStore {
  return new PresenceStore()
}

/** Clear in-memory socket state for tests (teardown). */
export function clearUserSocketsForTests(): void {
  userSockets.clear()
}

/** Reset all socket singletons for tests (presence + userSockets). */
export function resetSocketStateForTests(): void {
  presence.clearForTests()
  userSockets.clear()
}

export function initSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: config.frontendUrls,
      methods: ['GET', 'POST'],
    },
  })

  io.on('connection', (socket: Socket) => {
    // Verify JWT from handshake auth
    const token = socket.handshake.auth?.token || socket.handshake.query?.token
    if (!token || typeof token !== 'string') {
      logger.warn('[socket] connection rejected: no token')
      socket.disconnect()
      return
    }

    let userId: string
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as { userId: string }
      userId = decoded.userId
    } catch {
      logger.warn('[socket] connection rejected: invalid token')
      socket.disconnect()
      return
    }

    // Store verified userId on socket for later use
    socket.data.userId = userId
    logger.debug({ socketId: socket.id, userId }, '[socket] client connected')

    socket.on('auth:join', async () => {
      // Use verified userId from JWT — never trust client input
      // Explicit retry (no Proxy auto-magic): Neon wake blips must not drop joins.
      // Fast-local: select id-only (index-only scan, minimal TLS bytes on
      // IST→us-east-2). JWT already verified above, so existence check is enough —
      // no need for full user row (was User.findUnique full-row ~6000ms in dev).
      try {
        const user = await withRetry(() => prisma.user.findUnique({ where: { id: userId }, select: { id: true, collegeId: true, role: true } }), {
          label: 'socket.auth:join',
          retries: 2,
          baseDelayMs: 400,
        })
        if (!user) {
          socket.emit('error', { message: 'Invalid user' })
          return
        }
        // Guard duplicate joins: 'connect' can fire multiple times (reconnect, StrictMode double-mount, HMR)
        // Without this, the same socket.id would be pushed twice and disconnect only removes one entry -> leak.
        const existing = userSockets.get(userId) || []
        if (existing.includes(socket.id)) {
          socket.join(`user:${userId}`)
          logger.debug({ userId, socketId: socket.id, connections: existing.length }, '[socket] duplicate join ignored')
          return
        }
        socket.join(`user:${userId}`)
        // College room for scoped broadcasts (I-11: replaces global emit storms).
        // I-10 fix: NEVER trust handshake collegeId — verify membership from DB
        // (user.collegeId + role lookup above). Join college:${user.collegeId} only;
        // target after authorize check, otherwise ignore client value.
        try {
          const requested = (socket.handshake.auth as { collegeId?: string } | undefined)?.collegeId
          const ownCollegeId = (user as any).collegeId as string | null | undefined
          const role = (user as any).role as string | undefined
          if (ownCollegeId) {
            socket.join(`college:${ownCollegeId}`)
          }
          if (requested && requested !== ownCollegeId && role === 'SUPER_ADMIN') {
            // SUPER_ADMIN impersonation is gated server-side elsewhere (roles.ts);
            // socket join alone grants no data — still join for scoped emits.
            socket.join(`college:${String(requested)}`)
            logger.debug({ userId, requested }, '[socket] super-admin college room joined')
          } else if (requested && requested !== ownCollegeId) {
            logger.warn({ userId, requested }, '[socket] college join rejected (membership mismatch)')
          }
        } catch { /* optional room — never fail join */ }
        const sockets = userSockets.get(userId) || []
        sockets.push(socket.id)
        userSockets.set(userId, sockets)
        presence.add(userId, socket.id)
        markPresenceOnlineShared(userId)
        logger.debug({ userId, connections: sockets.length }, '[socket] user joined')
      } catch (err: unknown) {
        // A DB blip (e.g. Neon compute waking up) must never take down the
        // server — skip joining gracefully; client can re-emit auth:join.
        logger.warn({ err: (err as Error)?.message || err }, '[Socket] auth:join failed')
      }
    })

    socket.on('disconnect', () => {
      const uid = (socket.data?.userId as string | undefined) || userId
      // Direct O(1) lookup via verified uid instead of iterating entire map.
      // Also handles the duplicate-push bug: only one entry per socket.id exists now.
      if (uid) {
        const sockets = userSockets.get(uid)
        if (sockets) {
          const idx = sockets.indexOf(socket.id)
          if (idx !== -1) {
            sockets.splice(idx, 1)
            if (sockets.length === 0) {
              userSockets.delete(uid)
              markPresenceOfflineShared(uid)
              logger.debug({ userId: uid }, '[socket] user left (0 connections)')
            } else {
              // Mutated array is still referenced in Map, but set again for clarity
              userSockets.set(uid, sockets)
              logger.debug({ userId: uid, connections: sockets.length }, '[socket] user left')
            }
          }
        }
        presence.removeBySocket(socket.id, uid)
      } else {
        // Fallback: iterate (pre-auth disconnect)
        for (const [key, sockets] of userSockets.entries()) {
          const idx = sockets.indexOf(socket.id)
          if (idx !== -1) {
            sockets.splice(idx, 1)
            if (sockets.length === 0) userSockets.delete(key)
            break
          }
        }
        presence.removeBySocket(socket.id)
      }
      logger.debug({ socketId: socket.id }, '[socket] client disconnected')
    })
  })

  return io
}

export function getIO(): Server {
  if (!io) throw new Error('Socket.IO not initialized')
  return io
}

/** True when the user has ≥1 live socket (used to avoid fan-out emits to offline users). */
export function isUserOnline(userId: string): boolean {
  const sockets = userSockets.get(userId)
  return !!sockets && sockets.length > 0
}

/** Filter a user list down to currently-online users (cap-safe, O(n)). */
export function filterOnlineUsers(userIds: string[]): string[] {
  return userIds.filter((id) => isUserOnline(id))
}

// ---------------------------------------------------------------------------
// Shared presence (Redis L2, L1 fast-path). Fail-open, never blocks sockets.
// ---------------------------------------------------------------------------

const PRESENCE_REDIS_PREFIX = 'presence:'
/** Crash-leak bound (safe direction: stale online → extra no-op emit). */
const PRESENCE_TTL_MS = 24 * 60 * 60 * 1000

function presenceKey(userId: string): string {
  return `${PRESENCE_REDIS_PREFIX}${userId}`
}

function markPresenceOnlineShared(userId: string): void {
  try {
    if (getRedisClient()) void redisSet(presenceKey(userId), '1', PRESENCE_TTL_MS)
  } catch {}
}

function markPresenceOfflineShared(userId: string): void {
  try {
    if (getRedisClient()) void redisDel(presenceKey(userId))
  } catch {}
}

/**
 * Cross-instance online check: L1 (this replica) → shared Redis (any replica).
 * Single-instance behavior identical (L1 hit, no Redis needed).
 */
export async function isUserOnlineShared(userId: string): Promise<boolean> {
  if (isUserOnline(userId)) return true
  try {
    if (!getRedisClient()) return false
    const hit = await redisGet<string>(presenceKey(userId))
    return hit !== null && hit !== undefined
  } catch {
    return false
  }
}

/** Cross-instance filter (async; prefers shared presence). */
export async function filterOnlineUsersShared(userIds: string[]): Promise<string[]> {
  const out: string[] = []
  for (const id of userIds) {
    // Sequential is fine (callers pass small batches; avoids Redis stampede).
    if (await isUserOnlineShared(id)) out.push(id)
  }
  return out
}

export function emitToUser(userId: string, event: string, data: any) {
  getIO().to(`user:${userId}`).emit(event, data)
}

export function emitNotification(userId: string, notification: {
  id: string
  title: string
  message: string
  type: string
  priority: string
  createdAt: Date
}) {
  emitToUser(userId, 'notification:new', notification)
}

export function emitScheduleUpdate(userId: string, schedule: any) {
  emitToUser(userId, 'schedule:update', schedule)
}

export function emitAssignmentUpdate(userId: string, assignment: any) {
  emitToUser(userId, 'assignment:update', assignment)
}

// Fan out a room chat message to every recipient's personal socket room
export function emitRoomMessage(recipientIds: string[], message: any) {
  const io = getIO()
  for (const userId of recipientIds) {
    io.to(`user:${userId}`).emit('room:message:new', message)
  }
}

// Fan out a "deleted for everyone" tombstone notice to every recipient's personal socket room
export function emitRoomMessageDeleted(recipientIds: string[], payload: { messageId: string; roomId: string }) {
  const io = getIO()
  for (const userId of recipientIds) {
    io.to(`user:${userId}`).emit('room:message:deleted', payload)
  }
}

export function emitRoomMessageEdited(
  recipientIds: string[],
  payload: { messageId: string; roomId: string; content: string; editedAt: Date },
) {
  const io = getIO()
  for (const userId of recipientIds) {
    io.to(`user:${userId}`).emit('room:message:edited', payload)
  }
}

// Fan out a pin/unpin change to every recipient's personal socket room
// Threads-lite (#8): single event with isPinned flag (pin + unpin share it).
export function emitRoomMessagePin(
  recipientIds: string[],
  payload: { messageId: string; roomId: string; isPinned: boolean; pinnedBy?: string | null },
) {
  const io = getIO()
  for (const userId of recipientIds) {
    io.to(`user:${userId}`).emit('room:message:pin', payload)
  }
}

// Fan out a reaction change to every recipient's personal socket room
export function emitRoomMessageReaction(
  recipientIds: string[],
  payload: {
    messageId: string
    roomId: string
    userId: string
    emoji: string
    action: 'added' | 'removed'
    reactions: Record<string, number>
    myReactions: string[]
    myReactionsByUser?: Record<string, string[]>
  },
) {
  const io = getIO()
  for (const userId of recipientIds) {
    // Each recipient gets their own myReactions computed by the caller
    io.to(`user:${userId}`).emit('room:message:reaction', payload)
  }
}

// Assignment real-time broadcasts — college-scoped when collegeId is known,
// global fallback otherwise (backward compat). Clients join `college:<id>` on
// auth:join, so scoped emits reach the right tenant without waking every socket.
/**
 * @deprecated Use scopedEmit() (college room first, global fallback).
 * Kept for callers without tenant context (cron, public feeds).
 */
function safeEmit(event: string, payload: unknown) {
  try {
    getIO().emit(event, payload)
  } catch (err) {
    // io not initialized yet (e.g., during early boot or tests) — log at debug, never silent.
    logger.debug({ err, event }, '[socket] safeEmit skipped (io not ready)')
  }
}

/** Scoped emit: college room when payload carries collegeId, else global (compat). */
function scopedEmit(event: string, payload: unknown) {
  try {
    const collegeId = (payload as { collegeId?: unknown } | null)?.collegeId
    if (typeof collegeId === 'string' && collegeId) {
      getIO().to(`college:${collegeId}`).emit(event, payload)
      return
    }
    getIO().emit(event, payload)
  } catch (err) {
    logger.debug({ err, event }, '[socket] scopedEmit skipped (io not ready)')
  }
}

/**
 * Scoped emit (I-11 fix): prefer college rooms over global fan-out.
 * Falls back to global emit when collegeId is absent (backward compat).
 * Batching: callers should emit ONE `*:mutated` per mutation, not 3-5
 * (broadcast helpers below already coalesce to 1-2 events each).
 */
export function emitToCollege(collegeId: string | null | undefined, event: string, payload: unknown) {
  try {
    if (collegeId) {
      getIO().to(`college:${collegeId}`).emit(event, payload)
      return
    }
    getIO().emit(event, payload)
  } catch (err) {
    logger.debug({ err, event, collegeId }, '[socket] emitToCollege skipped (io not ready)')
  }
}

/** Batched emit: one socket round-trip for N events (reduces wake-ups). */
export function emitBatch(toUserId: string | null, events: Array<{ event: string; data: unknown }>, collegeId?: string | null) {
  try {
    const target = toUserId ? getIO().to(`user:${toUserId}`) : collegeId ? getIO().to(`college:${collegeId}`) : getIO()
    for (const e of events) target.emit(e.event, e.data)
  } catch (err) {
    logger.debug({ err }, '[socket] emitBatch skipped (io not ready)')
  }
}

export function emitAssignmentSubmissionUpdated(hubId: string, submission: any, extra: any = {}) {
  safeEmit('assignment:submission:updated', { hubId, submission, ...extra })
}

export function emitAssignmentGraded(hubId: string, submission: any) {
  safeEmit('assignment:graded', { hubId, submission })
}

export function emitAssignmentOfflineMarked(hubId: string, submission: any) {
  safeEmit('assignment:offline:marked', { hubId, submission })
}

export function emitAssignmentBulkGraded(hubId: string, submissions: any[]) {
  safeEmit('assignment:bulk:graded', { hubId, submissions })
}

export function emitAssignmentStatsUpdated(hubId: string) {
  safeEmit('assignment:stats:updated', { hubId })
}

export function emitAssignmentPendingUpdated(hubId: string) {
  safeEmit('assignment:pending:updated', { hubId })
}

export function broadcastAssignmentMutation(hubId: string) {
  safeEmit('assignment:mutated', { hubId })
  safeEmit('assignment:hub:updated', { hubId })
  // also emit generic submission update so older clients listening to that still refresh
  safeEmit('assignment:submission:updated', { hubId })
}
export function emitAssignmentHubUpdated(hubId: string, hub: any) {
  safeEmit('assignment:hub:updated', { hubId, hub })
}

// Forms realtime — mirrors assignment pattern (global emit, client filters by formId)
export function emitFormUpdated(formId: string, form?: any) {
  safeEmit('form:updated', { formId, form })
}
export function emitFormResponseUpdated(formId: string, response: any, extra: any = {}) {
  safeEmit('form:response:updated', { formId, response, ...extra })
}
export function emitFormExtended(formId: string, expiresAt: string) {
  safeEmit('form:extended', { formId, expiresAt })
}
export function broadcastFormMutation(formId: string) {
  safeEmit('form:mutated', { formId })
  safeEmit('form:updated', { formId })
  safeEmit('form:response:updated', { formId })
}

// Announcements realtime — college-scoped when collegeId present, else global (compat)
export function broadcastAnnouncementMutation(payload: any = {}) {
  scopedEmit('announcement:mutated', payload)
  scopedEmit('announcement:created', payload)
  scopedEmit('announcement:updated', payload)
  scopedEmit('announcement:deleted', payload)
}

// Rooms realtime — college-scoped when collegeId present (chat already has dedicated per-user events)
export function broadcastRoomMutation(payload: any = {}) {
  scopedEmit('room:mutated', payload)
  scopedEmit('room:updated', payload)
  scopedEmit('room:created', payload)
  scopedEmit('room:deleted', payload)
}

// Internships realtime — covers internships + internshipStaging approvals
export function broadcastInternshipMutation(payload: any = {}) {
  scopedEmit('internship:mutated', payload)
  scopedEmit('internship:updated', payload)
  scopedEmit('internship:created', payload)
  scopedEmit('internship:deleted', payload)
  scopedEmit('internship:staging:updated', payload)
}

// Hackathons realtime — covers hackathons + hackathonStaging approvals
export function broadcastHackathonMutation(payload: any = {}) {
  scopedEmit('hackathon:mutated', payload)
  scopedEmit('hackathon:updated', payload)
  scopedEmit('hackathon:created', payload)
  scopedEmit('hackathon:deleted', payload)
  scopedEmit('hackathon:staging:updated', payload)
}

// Contests realtime — coding contests CRUD + solution mutations + fetch
export function broadcastContestMutation(payload: any = {}) {
  safeEmit('contest:mutated', payload)
  safeEmit('contest:updated', payload)
  safeEmit('contest:created', payload)
  safeEmit('contest:deleted', payload)
}

// Timetable / Calendar realtime — schedule mutations
export function broadcastScheduleMutation(payload: any = {}) {
  safeEmit('schedule:mutated', payload)
  safeEmit('calendar:mutated', payload)
}

// Coding profile realtime — per-user handled via emitToUser('profile-sync'), plus global refresh for leaderboard
export function broadcastCodingProfileMutation(payload: any = {}) {
  safeEmit('coding:profile:mutated', payload)
  safeEmit('contest:mutated', payload)
}

// Attendance / Grades per-user — global mutated keeps Dashboard/Schedule/Calendar fresh across tabs/devices
export function broadcastAttendanceMutation(payload: any = {}) {
  safeEmit('attendance:mutated', payload)
  safeEmit('attendance:updated', payload)
}
export function broadcastGradeMutation(payload: any = {}) {
  safeEmit('grade:mutated', payload)
  safeEmit('grade:updated', payload)
}

// Tasks — STATE-SYNC FIX: tasks.ts previously emitted ONLY schedule:mutated,
// so cross-device TasksPage (listening for task:mutated) never refreshed.
// Emit BOTH: task:mutated for the planner + schedule/calendar for the grid.
export function broadcastTaskMutation(payload: any = {}) {
  safeEmit('task:mutated', payload)
  safeEmit('schedule:mutated', payload)
  safeEmit('calendar:mutated', payload)
}

// Colleges / users / departments / reports — STATE-SYNC FIX: entitySync.ts
// already listens for these socket events, but no route ever emitted them,
// so SuperAdmin/Admin pages only refreshed same-tab via notifyEntityMutated.
// These close the cross-device gap for admin surfaces.
export function broadcastCollegeMutation(payload: any = {}) {
  scopedEmit('college:mutated', payload)
  scopedEmit('announcement:mutated', payload)
}
export function broadcastUserMutation(payload: any = {}) {
  scopedEmit('user:mutated', payload)
  scopedEmit('college:mutated', payload)
}
export function broadcastDepartmentMutation(payload: any = {}) {
  scopedEmit('department:mutated', payload)
}
export function broadcastReportMutation(payload: any = {}) {
  scopedEmit('report:mutated', payload)
}
export function broadcastNotificationMutation(payload: any = {}) {
  scopedEmit('notification:new', payload)
}