// lib/api/resources/rooms.ts - rooms/chat/notifications (SRP extract).
// WHY: this module used to re-export the socket singleton + wrap socket events
// (api layer depended on transport + realtime — M-4 layering smell). Socket
// helpers now live in `lib/socketChannels.ts`; pages import `lib/socket`
// directly. This file is HTTP-only. AbortSignal threading preserved.
import { api, API_TIMEOUTS } from '../client'
import { MAX_LIST_LIMIT } from './opportunities'

// Deprecated compat: import from '../socket' / '../socketChannels' instead.
// Kept for one release so legacy deep importers don't break; logs once in DEV.
// eslint-disable-next-line @typescript-eslint/no-var-requires
export { connectSocket, disconnectSocket, getSocket } from '../../socket'
export { onNotification, onScheduleUpdate } from '../../socketChannels'

// Notifications (unified via room notifications)
export const notificationAPI = {
  getAll: (unread?: boolean) => api.get('/rooms/notifications/list').then((r) => r.data),
  getUnreadCount: () => api.get('/rooms/notifications/list').then((r) => r.data.filter((n: any) => !n.isRead).length),
  markRead: (id: string) => api.post(`/rooms/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () => api.put('/rooms/notifications/read-all').then((r) => r.data),
  delete: (id: string) => api.delete(`/rooms/notifications/${id}`).then((r) => r.data),
}

// Chat
// Upload-audit-all: AI text calls (ask/summarize/sendMessage) share the
// backend AI budget — fetch (60s), not the 15s default that aborted vision/
// long generations mid-flight (timetable precedent).
export const chatAPI = {
  getSessions: () => api.get('/chat/sessions').then((r) => r.data),
  createSession: () => api.post('/chat/sessions').then((r) => r.data),
  getMessages: (sessionId: string) => api.get(`/chat/sessions/${sessionId}/messages`).then((r) => r.data),
  sendMessage: (sessionId: string, content: string, provider?: { baseUrl?: string; apiKey?: string; model?: string }) =>
    api.post(`/chat/sessions/${sessionId}/messages`, { content, provider }, { timeout: API_TIMEOUTS.fetch }).then((r) => r.data),
  ask: (content: string, provider?: { baseUrl?: string; apiKey?: string; model?: string }) =>
    api.post('/chat/ask', { content, provider }, { timeout: API_TIMEOUTS.fetch }).then((r) => r.data),
  summarize: (content: string, provider?: { baseUrl?: string; apiKey?: string; model?: string }) =>
    api.post('/chat/summarize', { content, provider }, { timeout: API_TIMEOUTS.fetch }).then((r) => r.data),
}

// Rooms
export const roomAPI = {
  // Explicit limit (no silent magic): default 50 preserved for dashboards/sidebars
  // that need the full list, but now named + clamped (was bare `{ limit: 50 }`).
  // Paged callers SHOULD use getPaged(page, limit) instead. Behavior identical.
  getAll: (params?: { page?: number; limit?: number; search?: string; signal?: AbortSignal }) => {
    const { signal, ...query } = (params ?? {}) as { signal?: AbortSignal; page?: number; limit?: number; search?: string }
    const limit = query.limit == null
      ? MAX_LIST_LIMIT.rooms
      : Math.min(Math.max(Math.floor(query.limit), 1), MAX_LIST_LIMIT.rooms)
    const effective = { ...query, limit }
    return api.get('/rooms', { params: effective, signal }).then((r) => {
      const b = r.data
      if (Array.isArray(b)) return b
      if (b?.data) return b.data
      return b
    })
  },
  getPaged: (page = 1, limit = 20, search?: string, signal?: AbortSignal) =>
    api.get('/rooms', { params: { page, limit, ...(search ? { search } : {}) }, signal }).then((r) => {
      const b = r.data
      if (Array.isArray(b)) return { data: b, pagination: { page: 1, limit: b.length, total: b.length, pages: 1 } }
      return b
    }),
  getOne: (id: string) => api.get(`/rooms/${id}`).then((r) => r.data),
  create: (data: { name: string; description?: string; departmentId?: string; targetYears?: number[] }) =>
    api.post('/rooms', data).then((r) => r.data),
  update: (id: string, data: { name?: string; description?: string; departmentId?: string; targetYears?: number[] }) =>
    api.put(`/rooms/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/rooms/${id}`).then((r) => r.data),

  // Class Representative (CR)
  makeCR: (roomId: string, studentId: string) =>
    api.post(`/rooms/${roomId}/make-cr`, { studentId }).then((r) => r.data),
  removeCR: (roomId: string, studentId: string) =>
    api.post(`/rooms/${roomId}/remove-cr`, { studentId }).then((r) => r.data),

  // Join / Leave
  joinByCode: (roomId: string, code: string) =>
    api.post(`/rooms/${roomId}/join`, { code }).then((r) => r.data),
  joinByCodeOnly: (code: string) =>
    api.post('/rooms/join', { code }).then((r) => r.data),
  leave: (roomId: string) => api.post(`/rooms/${roomId}/leave`).then((r) => r.data),

  // Members
  getMembers: (roomId: string) => api.get(`/rooms/${roomId}/members`).then((r) => r.data),

  // Chat
  getMessages: (roomId: string) => api.get(`/rooms/${roomId}/messages`).then((r) => r.data),
  // Multipart: at least one of content / file is required by the backend.
  // Upload-audit-all: ≤10MB Cloudinary persist needs fetch (60s), not 15s.
  sendMessage: (roomId: string, payload: { content?: string; file?: File; replyToId?: string }) => {
    const formData = new FormData()
    if (payload.content) formData.append('content', payload.content)
    if (payload.file) formData.append('file', payload.file)
    if (payload.replyToId) formData.append('replyToId', payload.replyToId)
    return api.post(`/rooms/${roomId}/messages`, formData, {
      headers: { 'Content-Type': undefined } as any,
      timeout: API_TIMEOUTS.fetch,
    }).then((r) => r.data)
  },
  // scope=me hides the message for the current user only;
  // scope=everyone tombstones it for all recipients (sender/creator/admin only)
  deleteMessage: (roomId: string, messageId: string, scope: 'me' | 'everyone' = 'me') =>
    api.delete(`/rooms/${roomId}/messages/${messageId}`, { params: { scope } }).then((r) => r.data),
  // Edit a message (sender only)
  editMessage: (roomId: string, messageId: string, content: string) =>
    api.put(`/rooms/${roomId}/messages/${messageId}`, { content }).then((r) => r.data),
  // Forward a message to other rooms; backend skips invalid targets and reports them
  forwardMessage: (roomId: string, messageId: string, targetRoomIds: string[]) =>
    api.post(`/rooms/${roomId}/messages/${messageId}/forward`, { targetRoomIds }).then((r) => r.data),
  // Toggle a reaction on a message (add if not present, remove if present)
  toggleReaction: (roomId: string, messageId: string, emoji: string) =>
    api.post(`/rooms/${roomId}/messages/${messageId}/reactions`, { emoji }).then((r) => r.data),
  // Threads-lite (#8): nested threads — replyToId IS the thread parent
  getThreads: (roomId: string, limit = 20) =>
    api.get(`/rooms/${roomId}/threads`, { params: { limit } }).then((r) => r.data),
  getThread: (roomId: string, messageId: string) =>
    api.get(`/rooms/${roomId}/messages/${messageId}/thread`).then((r) => r.data),
  // Pins — teacher/CR to write, every member to read
  getPins: (roomId: string) => api.get(`/rooms/${roomId}/pins`).then((r) => r.data),
  pinMessage: (roomId: string, messageId: string) =>
    api.post(`/rooms/${roomId}/messages/${messageId}/pin`).then((r) => r.data),
  unpinMessage: (roomId: string, messageId: string) =>
    api.delete(`/rooms/${roomId}/messages/${messageId}/pin`).then((r) => r.data),
  // Ranked search within a room (exact > prefix > fuzzy, server-ranked)
  searchMessages: (roomId: string, q: string, limit = 20) =>
    api.get(`/rooms/${roomId}/messages/search`, { params: { q, limit } }).then((r) => r.data),
  // Per-channel mute — backend pref (User.preferences) + localStorage mirror (see roomMute.ts)
  getMutedRooms: () =>
    api.get('/rooms/muted').then((r) => r.data) as Promise<{ mutedRoomIds: string[] }>,
  setRoomMuted: (roomId: string, muted: boolean) =>
    api.put(`/rooms/${roomId}/mute`, { muted }).then((r) => r.data),
  updateChatSettings: (roomId: string, data: { chatMode: string; allowedUserIds?: string[] }) =>
    api.put(`/rooms/${roomId}/settings`, data).then((r) => r.data),

  // Resources
  // Upload-audit-all: ≤10MB persist needs fetch (60s), not the 15s default.
  uploadResource: (roomId: string, formData: FormData) =>
    api.post(`/rooms/${roomId}/resources`, formData, {
      headers: { 'Content-Type': undefined } as any,
      timeout: API_TIMEOUTS.fetch,
    }).then((r) => r.data),
  getResources: (roomId: string) => api.get(`/rooms/${roomId}/resources`).then((r) => r.data),
  deleteResource: (roomId: string, resourceId: string) =>
    api.delete(`/rooms/${roomId}/resources/${resourceId}`).then((r) => r.data),

  // Notifications
  getNotifications: () => api.get('/rooms/notifications/list').then((r) => r.data),
  markNotificationRead: (id: string) => api.post(`/rooms/notifications/${id}/read`).then((r) => r.data),

  // Read tracking (sidebar unread badges)
  getUnreadCounts: () => api.get('/rooms/unread-counts').then((r) => r.data) as Promise<Record<string, number>>,
  markRead: (roomId: string) => api.post(`/rooms/${roomId}/read`).then((r) => r.data),

  // PERPAGE-HALF1: deduped markRead — RoomDetail + StudentRoomDetail mount
  // effects fire markRead on mount AND on every switch-to-chat tab, and
  // React StrictMode double-invokes mount effects in dev (2 concurrent POSTs
  // for one open). The endpoint is idempotent, so concurrent duplicates for
  // the same room share ONE in-flight promise; sequential calls still fire
  // (a later mark after new messages must not be swallowed — no time throttle).
  markReadDeduped: (() => {
    const inflight = new Map<string, Promise<unknown>>()
    return (roomId: string) => {
      const hit = inflight.get(roomId)
      if (hit) return hit
      const p = api.post(`/rooms/${roomId}/read`).then((r) => r.data).finally(() => {
        if (inflight.get(roomId) === p) inflight.delete(roomId)
      })
      inflight.set(roomId, p)
      return p
    }
  })(),

  // Bulk import
  bulkImport: (roomId: string, rollNumbers: string[]) =>
    api.post('/rooms/import', { roomId, rollNumbers }).then((r) => r.data),
}
