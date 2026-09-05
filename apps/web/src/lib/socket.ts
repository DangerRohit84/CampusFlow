import { io } from 'socket.io-client'

let socket: ReturnType<typeof io> | null = null
let currentToken: string | null = null

export function connectSocket(token: string) {
  // Singleton guard: reuse existing socket if token unchanged - prevents orphaning
  // a "connecting" socket when Layout re-renders rapidly (e.g., StrictMode, HMR, or pathname churn).
  // Previously: `if (socket?.connected) return` would create a NEW socket while old was still
  // connecting (connected === false), overwriting the variable and leaking the old connection.
  if (socket) {
    if (currentToken === token) {
      // Same session - reuse instance; if it was disconnected (manual or network), reconnect via same instance
      if (socket.disconnected) {
        socket.connect()
      }
      return socket
    }
    // Token changed (re-login) - teardown old socket fully before creating new one
    socket.removeAllListeners()
    socket.disconnect()
    socket = null
    currentToken = null
  }

  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000'
  // socket.io connects to the origin (no /api path)
  const WS_URL = API_BASE.endsWith('/api') ? API_BASE.slice(0, -4) : API_BASE

  socket = io(WS_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
  })
  currentToken = token

  socket.on('connect', () => {
    console.log('[Socket] Connected', socket?.id)
    // Auto-join on every (re)connect so server's userSockets stays accurate even after network reconnect
    socket?.emit('auth:join')
  })
  socket.on('disconnect', (reason) => console.log('[Socket] Disconnected', reason))

  return socket
}

export function getSocket() {
  return socket
}

export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
    socket = null
    currentToken = null
  }
}
