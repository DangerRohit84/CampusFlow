// types/room.ts — rooms + members + resources + notifications (ISP split).
import type { User } from './user'

export interface Room {
  id: string
  name: string
  description?: string
  teacherId: string
  joinCode: string
  teacher?: User
  members?: RoomMember[]
  resources?: Resource[]
  _count?: { members: number; resources: number }
}

/** Sidebar row (narrow — use in lists, not detail). */
export interface RoomCard {
  id: string
  name: string
  joinCode: string
  _count?: { members: number; resources: number }
}

export interface RoomMember {
  id: string
  roomId: string
  studentId: string
  isCR: boolean
  joinedAt?: string
  room?: Room
  student?: User
}

export interface Resource {
  id: string
  roomId: string
  uploaderId: string
  name: string
  originalName: string
  mimeType: string
  size: number
  category: 'LECTURE' | 'ASSIGNMENT' | 'REFERENCE' | 'OTHER'
  description?: string
  uploader?: User
  room?: Room
}

export interface Notification {
  id: string
  title: string
  message: string
  type: 'CR_APPOINTED' | 'CR_REMOVED' | 'RESOURCE_UPLOADED' | 'ROOM_JOINED' | 'ROOM_LEFT' | 'FORM_LINKED' | 'GENERAL'
  read: boolean
  roomId: string
  userId?: string
  room?: Room
  createdAt?: string
}

/** Narrow a full Room to its card (pure). */
export function toRoomCard(r: Room): RoomCard {
  return { id: r.id, name: r.name, joinCode: r.joinCode, _count: r._count }
}
