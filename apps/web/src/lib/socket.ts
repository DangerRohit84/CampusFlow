import { io } from 'socket.io-client'

let socket: ReturnType<typeof io> | null = null

export function connectSocket(token: string) {
  if (socket?.connected) return socket

  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000'
  // socket.io connects to the origin (no /api path)
  const WS_URL = API_BASE.endsWith('/api') ? API_BASE.slice(0, -4) : API_BASE

  socket = io(WS_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
  })

  socket.on('connect', () => console.log('[Socket] Connected'))
  socket.on('disconnect', () => console.log('[Socket] Disconnected'))

  return socket
}

export function getSocket() {
  return socket
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}
