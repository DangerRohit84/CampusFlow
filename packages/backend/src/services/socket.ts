import { Server as HttpServer } from 'http'
import { Server, Socket } from 'socket.io'
import jwt from 'jsonwebtoken'
import { config } from '../config'
import prisma from '../config/db'

let io: Server

const userSockets = new Map<string, string[]>()

export function initSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: (process.env.FRONTEND_URL || 'http://localhost:3000,http://localhost:5173').split(',').map((o: string) => o.trim()),
      methods: ['GET', 'POST'],
    },
  })

  io.on('connection', (socket: Socket) => {
    // Verify JWT from handshake auth
    const token = socket.handshake.auth?.token || socket.handshake.query?.token
    if (!token || typeof token !== 'string') {
      console.log('Socket connection rejected: no token provided')
      socket.disconnect()
      return
    }

    let userId: string
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as { userId: string }
      userId = decoded.userId
    } catch {
      console.log('Socket connection rejected: invalid token')
      socket.disconnect()
      return
    }

    // Store verified userId on socket for later use
    socket.data.userId = userId
    console.log('Client connected:', socket.id, '(user:', userId, ')')

    socket.on('auth:join', async () => {
      // Use verified userId from JWT — never trust client input
      try {
        const user = await prisma.user.findUnique({ where: { id: userId } })
        if (!user) {
          socket.emit('error', { message: 'Invalid user' })
          return
        }
        // Guard duplicate joins: 'connect' can fire multiple times (reconnect, StrictMode double-mount, HMR)
        // Without this, the same socket.id would be pushed twice and disconnect only removes one entry -> leak.
        const existing = userSockets.get(userId) || []
        if (existing.includes(socket.id)) {
          socket.join(`user:${userId}`)
          console.log(`User ${userId} already joined (${existing.length} connections) - duplicate ignored (${socket.id})`)
          return
        }
        socket.join(`user:${userId}`)
        const sockets = userSockets.get(userId) || []
        sockets.push(socket.id)
        userSockets.set(userId, sockets)
        console.log(`User ${userId} joined (${sockets.length} connections)`)
      } catch (err: any) {
        // A DB blip (e.g. Neon compute waking up) must never take down the
        // server — skip joining gracefully; client can re-emit auth:join.
        console.error('[Socket] auth:join failed:', err?.message || err)
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
              console.log(`User ${uid} left (0 connections)`)
            } else {
              // Mutated array is still referenced in Map, but set again for clarity
              userSockets.set(uid, sockets)
              console.log(`User ${uid} left (${sockets.length} connections)`)
            }
          }
        }
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
      }
      console.log('Client disconnected:', socket.id)
    })
  })

  return io
}

export function getIO(): Server {
  if (!io) throw new Error('Socket.IO not initialized')
  return io
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

// Assignment real-time broadcasts — hubId-scoped, filtered client-side
// Using global emit (all connected clients receive; client filters by hubId)
// At scale, narrow to college room: io.to(`college:${collegeId}`).emit(...)
function safeEmit(event: string, payload: any) {
  try {
    getIO().emit(event, payload)
  } catch {
    // io not initialized yet (e.g., during early boot or tests) — ignore
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

// Announcements realtime — global emit, client invalidates list
export function broadcastAnnouncementMutation(payload: any = {}) {
  safeEmit('announcement:mutated', payload)
  safeEmit('announcement:created', payload)
  safeEmit('announcement:updated', payload)
  safeEmit('announcement:deleted', payload)
}

// Rooms realtime — global emit for room list/members/resources mutations (chat already has dedicated events)
export function broadcastRoomMutation(payload: any = {}) {
  safeEmit('room:mutated', payload)
  safeEmit('room:updated', payload)
  safeEmit('room:created', payload)
  safeEmit('room:deleted', payload)
}

// Internships realtime — covers internships + internshipStaging approvals
export function broadcastInternshipMutation(payload: any = {}) {
  safeEmit('internship:mutated', payload)
  safeEmit('internship:updated', payload)
  safeEmit('internship:created', payload)
  safeEmit('internship:deleted', payload)
  safeEmit('internship:staging:updated', payload)
}

// Hackathons realtime — covers hackathons + hackathonStaging approvals
export function broadcastHackathonMutation(payload: any = {}) {
  safeEmit('hackathon:mutated', payload)
  safeEmit('hackathon:updated', payload)
  safeEmit('hackathon:created', payload)
  safeEmit('hackathon:deleted', payload)
  safeEmit('hackathon:staging:updated', payload)
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