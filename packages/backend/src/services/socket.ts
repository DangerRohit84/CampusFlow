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
      for (const [userId, sockets] of userSockets.entries()) {
        const idx = sockets.indexOf(socket.id)
        if (idx !== -1) {
          sockets.splice(idx, 1)
          if (sockets.length === 0) userSockets.delete(userId)
          break
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