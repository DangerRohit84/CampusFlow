import { Server as HttpServer } from 'http'
import { Server, Socket } from 'socket.io'

let io: Server

const userSockets = new Map<string, string[]>()

export function initSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
    },
  })

  io.on('connection', (socket: Socket) => {
    console.log('Client connected:', socket.id)

    socket.on('auth:join', (userId: string) => {
      socket.join(`user:${userId}`)
      const sockets = userSockets.get(userId) || []
      sockets.push(socket.id)
      userSockets.set(userId, sockets)
      console.log(`User ${userId} joined (${sockets.length} connections)`)
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