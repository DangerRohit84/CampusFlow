// lib/alumniGuards.ts — alumni frontend-only pure guards (no DOM, no network).
// WHY: backend masks contact until ACCEPTED (alumniService.maskAlumniProfile) +
// college-scopes every handler. Frontend must NEVER unmask client-side and must
// enforce the same scoping in UI (defense-in-depth; server is authoritative).
// All helpers are pure so vitest covers them hermetically (cloudinary.test.ts
// pattern). No PII is logged or reconstructed here — masked stays masked.

export const MASKED_PHONE = '•••'

export const MENTORSHIP_MESSAGE_MIN = 10
export const MENTORSHIP_MESSAGE_MAX = 2000
export const MENTORSHIP_TOPIC_MAX = 200

/** Topic chips for the request modal (client-only UX; server stores one topic string). */
export const MENTORSHIP_TOPIC_CHIPS = [
  'Career guidance',
  'Placements',
  'Higher studies',
  'Resume review',
  'Interview prep',
  'Research',
  'Startup',
  'Open source',
] as const

export interface AlumniCardLike {
  userId?: string
  collegeId?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  isVerified?: boolean
  createdAt?: string | Date | null
  responseRate?: number | null
  totalRequests?: number
  [k: string]: unknown
}

export interface MentorshipRowLike {
  id: string
  status: string
  slaDueAt?: string | Date | null
  expiresAt?: string | Date | null
  chatSessionId?: string | null
  [k: string]: unknown
}

/** True when the email value is a backend mask (`j***@domain`), never raw. */
export function isMaskedEmail(v: unknown): boolean {
  return typeof v === 'string' && v.includes('***')
}

/** True when the phone value is the backend mask (`•••`). */
export function isMaskedPhone(v: unknown): boolean {
  return v === MASKED_PHONE
}

/**
 * True when EITHER contact field is still masked. Frontend must render the
 * locked-contact panel in this case and must NOT attempt to reveal raw PII.
 */
export function isContactMasked(p: Pick<AlumniCardLike, 'contactEmail' | 'contactPhone'>): boolean {
  return isMaskedEmail(p.contactEmail) || isMaskedPhone(p.contactPhone)
}

/** True when contact is visible (backend returned raw values on an ACCEPTED link / owner). */
export function canSeeContact(p: Pick<AlumniCardLike, 'contactEmail' | 'contactPhone'>): boolean {
  if (p.contactEmail == null && p.contactPhone == null) return false
  return !isContactMasked(p)
}

/** Display label for response rate — null (no requests yet) renders as "New". */
export function formatResponseRate(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return 'New'
  const pct = Math.round(Math.min(1, Math.max(0, rate)) * 100)
  return `${pct}%`
}

/** Badge variant for response rate (Badge.tsx vocabulary). */
export function responseRateVariant(rate: number | null | undefined): 'neutral' | 'success' | 'warning' | 'danger' {
  if (rate == null || !Number.isFinite(rate)) return 'neutral'
  if (rate >= 0.7) return 'success'
  if (rate >= 0.4) return 'warning'
  return 'danger'
}

/** Verification overdue when unverified and older than 24h (mirrors backend VERIFICATION_SLA_HOURS). */
export function isVerificationOverdueClient(
  p: Pick<AlumniCardLike, 'isVerified' | 'createdAt'>,
  now: Date = new Date(),
): boolean {
  if (p.isVerified) return false
  if (p.createdAt == null) return false
  const d = p.createdAt instanceof Date ? p.createdAt : new Date(String(p.createdAt))
  if (Number.isNaN(d.getTime())) return false
  return now.getTime() - d.getTime() > 24 * 3_600_000
}

/** SLA breach when PENDING and past slaDueAt (mirrors backend isSlaBreached). */
export function isSlaBreachedClient(
  r: Pick<MentorshipRowLike, 'status' | 'slaDueAt'>,
  now: Date = new Date(),
): boolean {
  if (r.status !== 'PENDING') return false
  if (!r.slaDueAt) return false
  const d = r.slaDueAt instanceof Date ? r.slaDueAt : new Date(String(r.slaDueAt))
  if (Number.isNaN(d.getTime())) return false
  return now.getTime() > d.getTime()
}

/** Deep link to the existing mentorship chat thread (ChatPage owns the thread UI). */
export function getAlumniChatLink(chatSessionId: string | null | undefined): string | null {
  if (!chatSessionId || typeof chatSessionId !== 'string') return null
  const id = chatSessionId.trim()
  if (!id) return null
  return `/chat?session=${encodeURIComponent(id)}`
}

/**
 * External-link allowlist (security S1).
 * WHY: backend zod .url() alone permits `javascript:`/`data:` schemes (WHATWG).
 * Only http(s) may render as <a href>; everything else renders as text / skipped.
 * Mailto/tel are handled by separate hardcoded-scheme contact links, never here.
 */
export function isSafeExternalUrl(href: unknown): boolean {
  if (typeof href !== 'string') return false
  const t = href.trim()
  if (!t) return false
  return /^https?:\/\//i.test(t)
}

/** Filter helper: drop unsafe ext links before render (defense-in-depth). */
export function safeExternalHref(href: unknown): string | undefined {
  if (!isSafeExternalUrl(href)) return undefined
  return (href as string).trim()
}

/**
 * Fail-safe route-id decode (security S2).
 * WHY: decodeURIComponent('%%%') throws URIError → white-screen self-DoS via
 * crafted link when no error boundary wraps the route. Fall back to the raw id.
 */
export function decodeRouteId(raw: string | null | undefined): string {
  const s = String(raw ?? '')
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** Client-side validation mirror of backend mentorshipRequestSchema (message min-10). */
export function validateMentorshipMessage(message: unknown): string | null {
  const s = typeof message === 'string' ? message.trim() : ''
  if (!s) return 'Please describe what you want to learn'
  if (s.length < MENTORSHIP_MESSAGE_MIN) return `Message must be at least ${MENTORSHIP_MESSAGE_MIN} characters`
  if (s.length > MENTORSHIP_MESSAGE_MAX) return `Message must be under ${MENTORSHIP_MESSAGE_MAX} characters`
  return null
}

/** Client-side topic cap mirror (backend slices to 200). */
export function validateMentorshipTopic(topic: unknown): string | null {
  if (topic == null || topic === '') return null
  const s = String(topic).trim()
  if (s.length > MENTORSHIP_TOPIC_MAX) return `Topic must be under ${MENTORSHIP_TOPIC_MAX} characters`
  return null
}

/**
 * Client-side college guard: non-SUPER_ADMIN viewers may only open profiles
 * from their own college. Server returns 403 authoritatively; this helper
 * drives the UI (hide cross-college actions before the round-trip).
 * Null college on either side denies (fail-closed, mirrors backend).
 */
export function canViewAlumniProfile(
  viewer: { id?: string; role?: string; collegeId?: string | null },
  profile: { userId?: string; collegeId?: string | null },
): boolean {
  if (!viewer?.id) return false
  if (viewer.role === 'SUPER_ADMIN') return true
  if (profile.userId && viewer.id === profile.userId) return true
  const vc = viewer.collegeId ?? null
  const pc = profile.collegeId ?? null
  if (!vc || !pc) return false
  return vc === pc
}

/** Whether the viewer may act on a mentorship row (accept/decline vs cancel). */
export function mentorshipPermissions(
  viewerId: string | undefined,
  row: { requesterId?: string; alumniUserId?: string },
  viewerRole?: string,
): { canAcceptDecline: boolean; canCancel: boolean } {
  const isAdmin = viewerRole === 'COLLEGE_ADMIN' || viewerRole === 'SUPER_ADMIN'
  const isAlumniSide = !!viewerId && row.alumniUserId === viewerId
  const isRequesterSide = !!viewerId && row.requesterId === viewerId
  return {
    canAcceptDecline: isAlumniSide || isAdmin,
    canCancel: isRequesterSide || isAdmin,
  }
}
