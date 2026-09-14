import { io } from 'socket.io-client'

let socket: ReturnType<typeof io> | null = null
let currentToken: string | null = null

export function connectSocket(token?: string | null) {
  // WHY cookie-only: HttpOnly migration (authStore dual-support) means token
  // may be null while user session lives in cookies. Gate on user/auth in
  // Layout, not token-only — connect with empty auth + withCredentials so
  // cookie session still gets realtime.
  const nextToken = token ?? null
  // Singleton guard: reuse existing socket if token unchanged - prevents orphaning
  // a "connecting" socket when Layout re-renders rapidly (e.g., StrictMode, HMR, or pathname churn).
  // Previously: `if (socket?.connected) return` would create a NEW socket while old was still
  // connecting (connected === false), overwriting the variable and leaking the old connection.
  if (socket) {
    if (currentToken === nextToken) {
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
    auth: nextToken ? { token: nextToken } : {},
    transports: ['websocket', 'polling'],
    withCredentials: true,
  })
  currentToken = nextToken

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

// P0-A: fail-open socket liveness (socket dead = old poll behavior).
// Never throws; null/disconnected => fallback slow poll + single fetch.
export function isSocketConnected(): boolean {
  try {
    return !!socket && (socket as { connected?: boolean }).connected === true
  } catch {
    return false
  }
}

/** Test seam: inject a fake socket (vitest) without touching the singleton. */
export function __setSocketForTests(s: unknown): void {
  try {
    socket = s as ReturnType<typeof io> | null
  } catch {}
}

export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
    socket = null
    currentToken = null
  }
}
