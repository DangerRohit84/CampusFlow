// lib/api/resources/alumni.ts — alumni directory + mentorship ledger (SRP extract).
// WHY: Phase 2 frontend talks to the Phase 1 backend (`packages/backend/src/routes/alumni.ts`).
// This file owns ONLY alumni HTTP: directory list (masked, college-scoped,
// server-paged), detail (masked until ACCEPTED), mentorship create/respond,
// my inboxes, admin verify queue. AbortSignal threading preserved on every
// queryFn (state-sync contract). College scoping is server-authoritative;
// the client only keys caches by scope (useCollegeScope) and never fabricates
// cross-college access. Contact fields are rendered as-received — the backend
// masks (`j***@domain` / `•••`) until an ACCEPTED link exists; the frontend
// must NEVER attempt to unmask (see lib/alumniGuards.ts).
import { api } from '../client'
import { DEFAULT_LIST_LIMIT } from './opportunities'

export interface AlumniUserRef {
  id: string
  name: string
  avatar?: string | null
  email?: string | null
}

export interface AlumniProfileCard {
  id: string
  userId: string
  collegeId: string | null
  graduationYear: number | null
  degree: string | null
  department: string | null
  company: string | null
  roleTitle: string | null
  location: string | null
  bio: string | null
  skills: string[]
  linkedinUrl: string | null
  githubUrl: string | null
  portfolioUrl: string | null
  /** Masked (`j***@domain`) until an ACCEPTED mentorship link exists. */
  contactEmail: string | null
  /** Masked (`•••`) until an ACCEPTED mentorship link exists. */
  contactPhone: string | null
  isVerified: boolean
  verifiedAt: string | null
  isAvailableForMentorship: boolean
  totalRequests: number
  acceptedRequests: number
  respondedRequests: number
  avgResponseHours: number | null
  /** 0..1, null when no requests yet (renders as "New"). */
  responseRate: number | null
  createdAt: string
  updatedAt: string
  user?: AlumniUserRef | null
}

export interface AlumniPagination {
  page: number
  limit: number
  total: number
  pages: number
}

export interface AlumniListResponse {
  data: AlumniProfileCard[]
  pagination: AlumniPagination
}

export type MentorshipStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'CANCELLED'

export interface MentorshipRequest {
  id: string
  requesterId: string
  alumniUserId: string
  alumniProfileId: string
  collegeId: string | null
  status: MentorshipStatus
  message: string | null
  topic: string | null
  slaDueAt: string | null
  expiresAt: string | null
  respondedAt: string | null
  chatSessionId: string | null
  createdAt: string
  updatedAt: string
}

export interface MentorshipListResponse {
  data: MentorshipRequest[]
  pagination: AlumniPagination
}

export type MentorshipBox = 'sent' | 'received' | 'all'

export interface AlumniListParams {
  search?: string
  company?: string
  graduationYear?: number
  verified?: boolean
  available?: boolean
  page?: number
  limit?: number
  collegeId?: string
  signal?: AbortSignal
}

function toListResponse(b: unknown): AlumniListResponse {
  const obj = b as { data?: AlumniProfileCard[]; pagination?: AlumniPagination }
  if (obj && Array.isArray(obj.data)) {
    return {
      data: obj.data,
      pagination: obj.pagination ?? { page: 1, limit: obj.data.length, total: obj.data.length, pages: 1 },
    }
  }
  if (Array.isArray(b)) {
    const arr = b as AlumniProfileCard[]
    return { data: arr, pagination: { page: 1, limit: arr.length, total: arr.length, pages: 1 } }
  }
  return { data: [], pagination: { page: 1, limit: 0, total: 0, pages: 0 } }
}

function toMentorshipListResponse(b: unknown): MentorshipListResponse {
  const obj = b as { data?: MentorshipRequest[]; pagination?: AlumniPagination }
  if (obj && Array.isArray(obj.data)) {
    return {
      data: obj.data,
      pagination: obj.pagination ?? { page: 1, limit: obj.data.length, total: obj.data.length, pages: 1 },
    }
  }
  if (Array.isArray(b)) {
    const arr = b as MentorshipRequest[]
    return { data: arr, pagination: { page: 1, limit: arr.length, total: arr.length, pages: 1 } }
  }
  return { data: [], pagination: { page: 1, limit: 0, total: 0, pages: 0 } }
}

export const alumniAPI = {
  /** Directory list — ALWAYS masked contact, college-scoped, server-paged. */
  list: (params?: AlumniListParams) => {
    const { signal, graduationYear, ...rest } = (params ?? {}) as AlumniListParams & { signal?: AbortSignal }
    const query: Record<string, unknown> = { ...rest }
    if (typeof graduationYear === 'number' && Number.isFinite(graduationYear)) query.graduationYear = graduationYear
    if (query.verified !== undefined) query.verified = String(query.verified)
    if (query.available !== undefined) query.available = String(query.available)
    if (!query.page) query.page = 1
    if (!query.limit) query.limit = DEFAULT_LIST_LIMIT
    if (!query.search) delete query.search
    if (!query.company) delete query.company
    if (!query.collegeId) delete query.collegeId
    return api
      .get('/alumni', { params: query, signal: signal as AbortSignal | undefined })
      .then((r) => toListResponse(r.data))
  },
  /** Single profile — masked until an ACCEPTED link exists (or owner). */
  getOne: (userId: string, signal?: AbortSignal) =>
    api.get(`/alumni/${encodeURIComponent(userId)}`, { signal }).then((r) => r.data as AlumniProfileCard),
  /** Student → alumni mentorship request (5/day quota, no self, same college — server-enforced). */
  createRequest: (data: { alumniUserId: string; message?: string; topic?: string | null }) =>
    api.post('/alumni/request', data).then((r) => r.data as MentorshipRequest),
  /** ACCEPT (alumni/admin) | DECLINE (alumni/admin) | CANCEL (requester/admin). */
  respond: (id: string, action: 'ACCEPT' | 'DECLINE' | 'CANCEL') =>
    api.patch(`/alumni/request/${encodeURIComponent(id)}`, { action }).then((r) => r.data as MentorshipRequest & { chatSessionId: string | null }),
  /** Caller-participated rows (?box=sent|received|all, optional ?alumniUserId= narrow for deep-link). */
  mine: (params?: { box?: MentorshipBox; page?: number; limit?: number; alumniUserId?: string; signal?: AbortSignal }) => {
    const { signal, alumniUserId, ...query } = (params ?? {}) as { box?: MentorshipBox; page?: number; limit?: number; alumniUserId?: string; signal?: AbortSignal }
    const finalQuery: Record<string, unknown> = { box: 'all', page: 1, limit: DEFAULT_LIST_LIMIT, ...query }
    if (typeof alumniUserId === 'string' && alumniUserId.trim()) finalQuery.alumniUserId = alumniUserId.trim()
    return api
      .get('/alumni/requests/mine', { params: finalQuery, signal: signal as AbortSignal | undefined })
      .then((r) => toMentorshipListResponse(r.data))
  },
  /** Admin verification queue — raw contact for same-college triage (admin-only, server authorize). */
  pending: (params?: { page?: number; limit?: number; collegeId?: string; signal?: AbortSignal }) => {
    const { signal, ...query } = (params ?? {}) as { page?: number; limit?: number; collegeId?: string; signal?: AbortSignal }
    return api
      .get('/alumni/pending', { params: { page: 1, limit: DEFAULT_LIST_LIMIT, ...query }, signal: signal as AbortSignal | undefined })
      .then((r) => toListResponse(r.data))
  },
  /** Admin verify/unverify (COLLEGE_ADMIN own-college, SUPER_ADMIN any — server-enforced). */
  verify: (userId: string, verified = true) =>
    api.patch(`/alumni/${encodeURIComponent(userId)}/verify`, { verified }).then((r) => r.data as AlumniProfileCard),
  /** Upsert OWN alumni profile (becomes discoverable once admin verifies). */
  upsertProfile: (data: Record<string, unknown>) =>
    api.post('/alumni/profile', data).then((r) => r.data as AlumniProfileCard),
}
