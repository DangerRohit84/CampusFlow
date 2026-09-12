// types/api.ts — compat barrel (ISP split).
// WHY: was a 263-line fat file (User+College+Hackathon+Form+Room+AI in one).
// Split into focused files below; this barrel re-exports all so existing
// imports keep working. New code SHOULD import from the focused file.
// Narrow DTOs: HackathonCard/HackathonDetail (opportunity.ts), RoomCard (room.ts)
// with toHackathonCard/toRoomCard mappers — list pages must not depend on
// _count/regs/rounds.
export type { User } from './user'
export type { Department, College } from './college'
export type {
  Hackathon,
  HackathonCard,
  HackathonDetail,
  HackathonRegistration,
  HackathonRound,
} from './opportunity'
export { toHackathonCard } from './opportunity'
export type { Form, FormField, FormResponse, FormAnswer, FormRoom } from './form'
export type { Room, RoomCard, RoomMember, Resource, Notification } from './room'
export { toRoomCard } from './room'
export type {
  DashboardData,
  Message,
  ChatSession,
  ChatProvider,
  AiProvider,
  AiRouting,
} from './ai'
export type { CodingProfile } from './codingProfile'
export { PLATFORM_SYNC_TTL_MS, getSyncAgeMs, isPlatformStale, formatSyncAge } from './codingProfile'
