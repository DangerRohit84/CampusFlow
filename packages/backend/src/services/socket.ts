import { Server as HttpServer } from 'http'
import { Server, Socket } from 'socket.io'
import jwt from 'jsonwebtoken'
import { config } from '../config'
import prisma, { withRetry } from '../config/db'
import { logger } from '../utils/logger'
import { isJtiRevoked, isJtiRevokedWithDb } from '../utils/authHardening'
import { getRedisClient, redisDel, redisGet, redisSet } from '../lib/redis'

// ---------------------------------------------------------------------------
// Multi-instance scale-out (10k concurrent sockets) — Track D.
// Presence is SHARED (Redis `presence:{userId}` with 24h TTL +
// best-effort DEL, L1 memory fast-path). Emit fan-out is SHARED via
// `@socket.io/redis-adapter` when REDIS_URL is set (fail-open to single-
// replica memory when unset — dev works with zero infra).
//
// Render sticky sessions: Socket.IO long-poll → websocket upgrade needs
// stickiness. With the Redis adapter, emits work across replicas WITHOUT
// stickiness, but the handshake/upgrade is still stickier/faster WITH it.
// Render: run API with `numInstances >= 2` + session affinity when available
// (see docs/adr/scale-10k-shard-redis.md §5 + config.socketAdapter). Without
// affinity, clients transparently re-poll another replica (correct, +1 RTT).
// Config flag SOCKET_ADAPTER=redis|memory (default: redis when REDIS_URL,
// else memory) forces the mode for staging proofs.
//
// Presence design: false-positive safe (stale "online" → extra no-op emit,
// never a dropped notification). Crash leaks expire in 24h; clean
// disconnects DEL immediately.
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

export function getSocketAdapterMode(): 'redis' | 'memory' {
  try {
    // Fresh env first (tests mutate process.env per-case), config SSOT as fallback.
    // config.socketAdapter is evaluated at boot import; env may change after (staging proofs).
    const fresh = String(process.env.SOCKET_ADAPTER || '').trim().toLowerCase()
    const configured = String((config as { socketAdapter?: string }).socketAdapter || '').trim().toLowerCase()
    const forced = fresh || configured
    if (forced === 'memory') return 'memory'
    if (forced === 'redis') return getRedisClient() ? 'redis' : 'memory'
  } catch {}
  return getRedisClient() ? 'redis' : 'memory'
}

/**
 * Attach the Redis adapter for cross-replica emit fan-out (Track D P0-1).
 * Fail-open: REDIS_URL unset / adapter dep missing / Redis blip → single-
 * replica memory (dev works, prod single-replica works; multi-replica
 * without REDIS_URL silently drops cross-instance delivery — boot logs warn).
 * Never throws, never blocks initSocket.
 */
export function attachSocketAdapter(target: Server): 'redis' | 'memory' {
  const mode = getSocketAdapterMode()
  if (mode !== 'redis') {
    logger.info('[socket] adapter=memory (single-replica; set REDIS_URL + SOCKET_ADAPTER=redis for multi-replica fan-out)')
    return 'memory'
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const adapterMod = require('@socket.io/redis-adapter') as any
    const createAdapter = adapterMod?.createAdapter as ((pub: never, sub: never) => never) | undefined
    if (!createAdapter) throw new Error('redis-adapter createAdapter missing')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const IORedis = require('ioredis') as new (url: string, opts?: unknown) => { on?: (e: string, l: (...a: unknown[]) => void) => void; quit?: () => Promise<void>; disconnect?: () => void }
    const url = String(process.env.REDIS_URL || '').trim()
    if (!url) return 'memory'
    const pub = new IORedis(url, { lazyConnect: true, maxRetriesPerRequest: 2, enableReadyCheck: true })
    const sub = new IORedis(url, { lazyConnect: true, maxRetriesPerRequest: 2, enableReadyCheck: true })
    try {
      ;(pub as { on?: (e: string, l: () => void) => void }).on?.('error', () => {})
      ;(sub as { on?: (e: string, l: () => void) => void }).on?.('error', () => {})
      void (pub as unknown as { connect?: () => Promise<void> }).connect?.()?.catch(() => {})
      void (sub as unknown as { connect?: () => Promise<void> }).connect?.()?.catch(() => {})
    } catch {}
    target.adapter(createAdapter(pub as never, sub as never))
    logger.info('[socket] adapter=redis (cross-replica fan-out shared; sticky sessions recommended, not required)')
    return 'redis'
  } catch (err) {
    logger.warn({ err: (err as Error)?.message || err }, '[socket] redis adapter unavailable, falling back to memory (single-replica)')
    return 'memory'
  }
}

export function initSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: config.frontendUrls,
      methods: ['GET', 'POST'],
    },
  })

  // Track D: share emit fan-out across replicas when REDIS_URL is set.
  attachSocketAdapter(io)

  io.on('connection', (socket: Socket) => {
    // Verify JWT from handshake auth
    const token = socket.handshake.auth?.token || socket.handshake.query?.token
    if (!token || typeof token !== 'string') {
      logger.warn('[socket] connection rejected: no token')
      socket.disconnect()
      return
    }

    let userId: string
    let tokenJti: string | undefined
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as { userId: string; jti?: string }
      userId = decoded.userId
      tokenJti = decoded.jti
      // Revocation bypass fix: reject revoked jtis at handshake (fail-closed).
      // Sync memory check first (no await on hot path); DB read-through async
      // covers multi-replica revocations (logout/change-password on another
      // instance). DB miss/failure fails open to memory (authHardening).
      if (tokenJti && isJtiRevoked(tokenJti)) {
        logger.warn('[socket] connection rejected: token revoked')
        socket.disconnect()
        return
      }
      if (tokenJti) {
        void isJtiRevokedWithDb(tokenJti)
          .then((revoked) => {
            if (revoked) {
              logger.warn('[socket] connection rejected: token revoked (db)')
              try { socket.disconnect() } catch {}
            }
          })
          .catch(() => {})
      }
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

/**
 * Per-user college resolution (fan-out fix without caller churn).
 * Mutations for per-user entities (schedule/task/attendance/grade) carry
 * userId but no collegeId. Resolving the owner's college scopes the emit to
 * that college room (≈college size wake-ups) instead of global (10k).
 * Best-effort fire-and-forget: lookup failure fails open to global (compat),
 * never blocks the response, never throws.
 */
function emitPerUserScoped(
  events: Array<{ event: string; basePayload: any }>,
  collegeId?: string | null,
  userId?: string | null,
) {
  if (collegeId) {
    for (const e of events) emitToCollege(collegeId, e.event, { ...e.basePayload, collegeId })
    return
  }
  if (userId) {
    void prisma.user
      .findUnique({ where: { id: userId }, select: { collegeId: true } })
      .then((u) => {
        const cid = u?.collegeId ?? null
        for (const e of events) emitToCollege(cid, e.event, { ...e.basePayload, collegeId: cid ?? undefined })
      })
      .catch(() => {
        for (const e of events) emitToCollege(null, e.event, e.basePayload)
      })
    return
  }
  for (const e of events) emitToCollege(null, e.event, e.basePayload)
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

export function emitAssignmentSubmissionUpdated(hubId: string, submission: any, extra: any = {}, collegeId?: string | null) {
  const cid = collegeId ?? extra?.collegeId ?? submission?.collegeId ?? submission?.assignment?.collegeId ?? null
  emitToCollege(cid, 'assignment:submission:updated', { hubId, submission, ...extra, collegeId: cid ?? extra?.collegeId ?? undefined })
}

export function emitAssignmentGraded(hubId: string, submission: any, collegeId?: string | null) {
  const cid = collegeId ?? submission?.collegeId ?? submission?.assignment?.collegeId ?? null
  emitToCollege(cid, 'assignment:graded', { hubId, submission, collegeId: cid ?? undefined })
}

export function emitAssignmentOfflineMarked(hubId: string, submission: any, collegeId?: string | null) {
  const cid = collegeId ?? submission?.collegeId ?? submission?.assignment?.collegeId ?? null
  emitToCollege(cid, 'assignment:offline:marked', { hubId, submission, collegeId: cid ?? undefined })
}

export function emitAssignmentBulkGraded(hubId: string, submissions: any[], collegeId?: string | null) {
  const cid = collegeId ?? (Array.isArray(submissions) ? submissions[0]?.collegeId : null) ?? null
  emitToCollege(cid, 'assignment:bulk:graded', { hubId, submissions, collegeId: cid ?? undefined })
}

export function emitAssignmentStatsUpdated(hubId: string, collegeId?: string | null) {
  emitToCollege(collegeId ?? null, 'assignment:stats:updated', { hubId, collegeId: collegeId ?? undefined })
}

export function emitAssignmentPendingUpdated(hubId: string, collegeId?: string | null) {
  emitToCollege(collegeId ?? null, 'assignment:pending:updated', { hubId, collegeId: collegeId ?? undefined })
}

export function broadcastAssignmentMutation(hubId: string, collegeId?: string | null) {
  // Track D (10k): 1 scoped event per mutation (was 3×). Frontend entitySync
  // maps every `assignment:*` prefix to the assignment entity + RELATED busts
  // hubs/submissions/dashboard, so single `assignment:mutated` refreshes all.
  // Callers pass hub.collegeId (global fallback when null for compat).
  emitToCollege(collegeId ?? null, 'assignment:mutated', { hubId, collegeId: collegeId ?? undefined })
}
export function emitAssignmentHubUpdated(hubId: string, hub: any, collegeId?: string | null) {
  const cid = collegeId ?? hub?.collegeId ?? null
  emitToCollege(cid, 'assignment:hub:updated', { hubId, hub, collegeId: cid ?? undefined })
}

// Forms realtime — college-scoped (was global emit, client filters by formId)
export function emitFormUpdated(formId: string, form?: any, collegeId?: string | null) {
  const cid = collegeId ?? form?.collegeId ?? null
  emitToCollege(cid, 'form:updated', { formId, form, collegeId: cid ?? undefined })
}
export function emitFormResponseUpdated(formId: string, response: any, extra: any = {}, collegeId?: string | null) {
  const cid = collegeId ?? extra?.collegeId ?? response?.collegeId ?? null
  emitToCollege(cid, 'form:response:updated', { formId, response, ...extra, collegeId: cid ?? extra?.collegeId ?? undefined })
}
export function emitFormExtended(formId: string, expiresAt: string, collegeId?: string | null) {
  emitToCollege(collegeId ?? null, 'form:extended', { formId, expiresAt, collegeId: collegeId ?? undefined })
}
export function broadcastFormMutation(formId: string, collegeId?: string | null) {
  // Track D: 1 scoped event per mutation (was 3×). `form:mutated` busts forms
  // + dashboard via RELATED; detail/response pages refetch on mutated.
  emitToCollege(collegeId ?? null, 'form:mutated', { formId, collegeId: collegeId ?? undefined })
}

// Announcements realtime — 1 scoped event per mutation (was 4×). All
// `announcement:*` map to the announcement entity + RELATED busts dashboard.
export function broadcastAnnouncementMutation(payload: any = {}) {
  scopedEmit('announcement:mutated', payload)
}

// Rooms realtime — 1 scoped event per mutation (was 4×, chat has dedicated per-user events)
export function broadcastRoomMutation(payload: any = {}) {
  scopedEmit('room:mutated', payload)
}

// Internships realtime — 1 scoped event per mutation (was 5×, covers staging approvals via RELATED admin-staging)
export function broadcastInternshipMutation(payload: any = {}) {
  scopedEmit('internship:mutated', payload)
}

// Hackathons realtime — 1 scoped event per mutation (was 5×, covers staging approvals via RELATED admin-staging)
export function broadcastHackathonMutation(payload: any = {}) {
  scopedEmit('hackathon:mutated', payload)
}

// Contests realtime — 1 scoped event per mutation (was 4×).
// CodingContest.collegeId is nullable (null = global feed); scoped emits only
// wake the owning college room instead of all 10k sockets.
export function broadcastContestMutation(payload: any = {}) {
  const cid = payload?.collegeId ?? payload?.contest?.collegeId ?? null
  emitToCollege(cid, 'contest:mutated', { ...payload, collegeId: cid ?? payload?.collegeId ?? undefined })
}

// Timetable / Calendar realtime — college-scoped when collegeId present.
// Schedule rows are per-user; when only userId is present the owner's college
// is resolved best-effort (see emitPerUserScoped) so only the owning college
// room wakes (cross-device refresh preserved, global storm gone).
export function broadcastScheduleMutation(payload: any = {}) {
  // Track D: 1 scoped event per mutation (was 2× schedule+calendar).
  // Both map to the schedule entity (bridge `calendar:` → schedule +
  // SOCKET_EVENTS[schedule] includes task:mutated/schedule:mutated), and
  // RELATED busts timetable/dashboard. Task pages listen schedule:mutated
  // via SOCKET_EVENTS[task], so cross-freshness preserved.
  const cid = payload?.collegeId ?? null
  const uid = payload?.userId ?? null
  if (cid || !uid) {
    emitToCollege(cid, 'schedule:mutated', { ...payload, collegeId: cid ?? payload?.collegeId ?? undefined })
    return
  }
  emitPerUserScoped(
    [
      { event: 'schedule:mutated', basePayload: { ...payload } },
    ],
    null,
    uid,
  )
}

// Coding profile realtime — 2 scoped events max (cross-entity: profile + leaderboard).
// Kept at 2 (within 1–2 budget) because contest pages subscribe to
// `contest:mutated` directly via SOCKET_EVENTS[contest] (manual leaderboard),
// while `coding:profile:mutated` alone would only bridge to coding-profile
// (RELATED does bust contests, but direct-socket manual pages would miss).
// Per-user handled via emitToUser('profile-sync') elsewhere.
export function broadcastCodingProfileMutation(payload: any = {}) {
  const cid = payload?.collegeId ?? null
  const uid = payload?.userId ?? null
  if (cid || !uid) {
    emitToCollege(cid, 'coding:profile:mutated', { ...payload, collegeId: cid ?? payload?.collegeId ?? undefined })
    emitToCollege(cid, 'contest:mutated', { ...payload, collegeId: cid ?? payload?.collegeId ?? undefined })
    return
  }
  emitPerUserScoped(
    [
      { event: 'coding:profile:mutated', basePayload: { ...payload } },
      { event: 'contest:mutated', basePayload: { ...payload } },
    ],
    null,
    uid,
  )
}

// Attendance / Grades per-user — 1 scoped mutated per mutation (was 2×).
// `*:mutated` busts dashboard via RELATED; direct-socket manual pages listen
// to `*:mutated` in SOCKET_EVENTS[attendance|grade].
export function broadcastAttendanceMutation(payload: any = {}) {
  const cid = payload?.collegeId ?? null
  const uid = payload?.userId ?? null
  if (cid || !uid) {
    emitToCollege(cid, 'attendance:mutated', { ...payload, collegeId: cid ?? payload?.collegeId ?? undefined })
    return
  }
  emitPerUserScoped(
    [
      { event: 'attendance:mutated', basePayload: { ...payload } },
    ],
    null,
    uid,
  )
}
export function broadcastGradeMutation(payload: any = {}) {
  const cid = payload?.collegeId ?? null
  const uid = payload?.userId ?? null
  if (cid || !uid) {
    emitToCollege(cid, 'grade:mutated', { ...payload, collegeId: cid ?? payload?.collegeId ?? undefined })
    return
  }
  emitPerUserScoped(
    [
      { event: 'grade:mutated', basePayload: { ...payload } },
    ],
    null,
    uid,
  )
}

// Tasks — Track D: 1 scoped event per mutation (was 3× task+schedule+calendar).
// `task:mutated` busts schedules/timetable/dashboard via RELATED[task], and
// SOCKET_EVENTS[schedule] includes `task:mutated`, so Schedule/Calendar pages
// refresh cross-device without waking 10k sockets 3×.
export function broadcastTaskMutation(payload: any = {}) {
  const cid = payload?.collegeId ?? null
  const uid = payload?.userId ?? null
  if (cid || !uid) {
    emitToCollege(cid, 'task:mutated', { ...payload, collegeId: cid ?? payload?.collegeId ?? undefined })
    return
  }
  emitPerUserScoped(
    [
      { event: 'task:mutated', basePayload: { ...payload } },
    ],
    null,
    uid,
  )
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