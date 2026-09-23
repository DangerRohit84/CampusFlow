// services/alumniService.ts — alumni directory + mentorship ledger helpers.
// WHY: routes stay thin (reports.ts pattern); pure fns here are vitest-coverable
// without Neon (contestReminderService.ts pattern). DB/socket only enter via the
// exported job runners with injected deps (notificationService DIP pattern).
//
// Prod-safety: every cron hook checks isAlumniCronEnabled() FIRST (env
// ALUMNI_CRON_ENABLED==='true'). Default OFF — internalCron wiring stays
// commented until Phase 2 frontend + admin SOP land. Mirrors isAutoFetchEnabled
// master-toggle + DISABLE_EMBEDDED_CRON.

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Zod SSOT (mirrors validators.ts enums; status stays DB-String by design).
// ---------------------------------------------------------------------------

export const AlumniStatusEnum = z.enum(['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED'])
export type AlumniRequestStatus = z.infer<typeof AlumniStatusEnum>

// Allowlist for external profile links: http(s) only.
// WHY (security S1): z.string().url() accepts any WHATWG-valid scheme,
// including `javascript:`/`data:` which would execute as stored XSS when
// rendered as <a href>. Refine to ^https?:// and enforce the same guard
// client-side (alumniGuards.isSafeExternalUrl).
const httpUrlField = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine((v) => /^https?:\/\//i.test(v), { message: 'URL must start with http:// or https://' })

export const alumniProfileSchema = z.object({
  graduationYear: z.number().int().min(1950).max(2100).optional().nullable(),
  degree: z.string().trim().max(120).optional().nullable(),
  department: z.string().trim().max(120).optional().nullable(),
  company: z.string().trim().max(200).optional().nullable(),
  roleTitle: z.string().trim().max(200).optional().nullable(),
  location: z.string().trim().max(200).optional().nullable(),
  bio: z.string().trim().max(5000).optional().nullable(),
  skills: z.array(z.string().trim().max(60)).max(30).optional().default([]),
  linkedinUrl: httpUrlField.optional().nullable().or(z.literal('')),
  githubUrl: httpUrlField.optional().nullable().or(z.literal('')),
  portfolioUrl: httpUrlField.optional().nullable().or(z.literal('')),
  contactEmail: z.string().trim().email().max(320).optional().nullable().or(z.literal('')),
  contactPhone: z.string().trim().max(40).optional().nullable(),
  isAvailableForMentorship: z.boolean().optional(),
})

export const mentorshipRequestSchema = z.object({
  alumniUserId: z.string().min(1, 'alumniUserId is required'),
  message: z.string().trim().min(10, 'message min 10 chars').max(2000).optional(),
  topic: z.string().trim().max(200).optional().nullable(),
})

export const mentorshipRespondSchema = z.object({
  action: z.enum(['ACCEPT', 'DECLINE', 'CANCEL']),
})

// ---------------------------------------------------------------------------
// Business constants (single place; routes + cron share).
// ---------------------------------------------------------------------------

/** Max new requests per requester per UTC day (abuse cap, college NAT-safe). */
export const MENTORSHIP_DAILY_LIMIT = 5
/** Verification queue SLA: admin must verify within 24h of profile creation. */
export const VERIFICATION_SLA_HOURS = 24
/** Alumni response SLA: respond within 3 days of request creation. */
export const RESPONSE_SLA_DAYS = 3
/** Auto-expire: PENDING requests die after 14 days (cron, disabled by default). */
export const AUTO_EXPIRE_DAYS = 14

// ---------------------------------------------------------------------------
// Pure helpers (no DB — unit-test directly).
// ---------------------------------------------------------------------------

export interface AlumniProfileLike {
  id?: string
  userId: string
  collegeId?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  isVerified?: boolean
  createdAt?: Date | string
  totalRequests?: number
  acceptedRequests?: number
  respondedRequests?: number
  avgResponseHours?: number | null
  [k: string]: unknown
}

const MASKED = '•••'

/** Mask an email (j***@domain) — publicProfile.ts maskEmail parity, local copy to avoid import cycle. */
export function maskEmailLocal(email: unknown): string | null {
  if (typeof email !== 'string') return null
  const at = email.indexOf('@')
  if (at <= 0) return null
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  if (!local || !domain) return null
  return `${local[0]}***@${domain}`
}

/**
 * Mask contact until an ACCEPTED request exists between viewer and alumni.
 * Public directory shows everything EXCEPT contactEmail/contactPhone.
 * Returns a shallow copy (never mutates the DB row).
 */
export function maskAlumniProfile<T extends AlumniProfileLike>(profile: T, opts: { canSeeContact: boolean }): T {
  if (opts.canSeeContact) return profile
  return {
    ...profile,
    contactEmail: profile.contactEmail ? maskEmailLocal(profile.contactEmail) ?? MASKED : null,
    contactPhone: profile.contactPhone ? MASKED : null,
  }
}

/** Verification overdue when unverified and older than 24h (queue SLA). */
export function isVerificationOverdue(p: Pick<AlumniProfileLike, 'isVerified' | 'createdAt'>, now: Date = new Date()): boolean {
  if (p.isVerified) return false
  const created = p.createdAt instanceof Date ? p.createdAt : new Date(p.createdAt as string)
  if (Number.isNaN(created.getTime())) return false
  return now.getTime() - created.getTime() > VERIFICATION_SLA_HOURS * 3_600_000
}

/** Sort verification queue: overdue first, then oldest (admin <24h triage). */
export function sortVerificationQueue<T extends Pick<AlumniProfileLike, 'isVerified' | 'createdAt'>>(rows: T[], now: Date = new Date()): T[] {
  const ts = (r: T): number => {
    const like = r as unknown as AlumniProfileLike
    const d = like.createdAt instanceof Date
      ? (like.createdAt as Date).getTime()
      : new Date(String(like.createdAt)).getTime()
    return Number.isFinite(d) ? d : Number.MAX_SAFE_INTEGER
  }
  return [...rows].sort((a, b) => {
    const ao = isVerificationOverdue(a as unknown as AlumniProfileLike, now) ? 0 : 1
    const bo = isVerificationOverdue(b as unknown as AlumniProfileLike, now) ? 0 : 1
    if (ao !== bo) return ao - bo
    return ts(a) - ts(b)
  })
}

/** SLA + expiry dates for a new request (dual-write at POST time). */
export function slaDatesForNewRequest(createdAt: Date = new Date()): { slaDueAt: Date; expiresAt: Date } {
  const slaDueAt = new Date(createdAt.getTime() + RESPONSE_SLA_DAYS * 86_400_000)
  const expiresAt = new Date(createdAt.getTime() + AUTO_EXPIRE_DAYS * 86_400_000)
  return { slaDueAt, expiresAt }
}

/** Start of UTC day (for the 5/d quota count query). */
export function startOfUtcDay(d: Date = new Date()): Date {
  const c = new Date(d)
  c.setUTCHours(0, 0, 0, 0)
  return c
}

/**
 * Missing-table guard (defense-in-depth, M2 lock).
 * WHY: after `prisma generate` with the new schema but before `migrate deploy`,
 * the client HAS the models so the shape guard passes, then missing tables throw
 * P2021/P2022. Routes map those to 503 "run prisma migrate" (never 500).
 */
export function isMissingTable(err: unknown): boolean {
  const code = (err as { code?: string } | null | undefined)?.code
  return code === 'P2021' || code === 'P2022'
}

/**
 * College-admin scoping helper (M1 lock).
 * WHY: PATCH /request/:id and PATCH /:userId/verify share the same rule —
 * COLLEGE_ADMIN may act only inside their own college (null denies fail-closed),
 * SUPER_ADMIN is global. Other roles return false (handled by party checks).
 */
export function canCollegeAdminAccess(
  me: { role?: string; collegeId?: string | null },
  resourceCollegeId?: string | null,
): boolean {
  if (me.role === 'SUPER_ADMIN') return true
  if (me.role !== 'COLLEGE_ADMIN') return false
  const mc = me.collegeId ?? null
  const rc = resourceCollegeId ?? null
  if (!mc || !rc) return false
  return mc === rc
}

/** Response rate 0..1 (null when no requests yet — avoids 0% vs no-data confusion). */
export function calcResponseRate(p: Pick<AlumniProfileLike, 'totalRequests' | 'respondedRequests'>): number | null {
  const total = Number(p.totalRequests ?? 0)
  const responded = Number(p.respondedRequests ?? 0)
  if (!Number.isFinite(total) || total <= 0) return null
  if (!Number.isFinite(responded) || responded < 0) return 0
  return Math.min(1, responded / total)
}

/**
 * Fold a response event into profile counters (pure — route persists the result).
 * - accepted=true bumps acceptedRequests.
 * - Every ACCEPT/DECLINE bumps respondedRequests + running avgResponseHours.
 */
export function foldResponseCounters(
  prev: Pick<AlumniProfileLike, 'acceptedRequests' | 'respondedRequests' | 'avgResponseHours'>,
  event: { accepted: boolean; responseHours: number },
): { acceptedRequests: number; respondedRequests: number; avgResponseHours: number } {
  const responded = Math.max(0, Number(prev.respondedRequests ?? 0)) + 1
  const accepted = Math.max(0, Number(prev.acceptedRequests ?? 0)) + (event.accepted ? 1 : 0)
  const prevAvg = Number(prev.avgResponseHours)
  const hrs = Number.isFinite(event.responseHours) && event.responseHours >= 0 ? event.responseHours : 0
  const avg = Number.isFinite(prevAvg) && (Number(prev.respondedRequests ?? 0) > 0)
    ? (prevAvg * Number(prev.respondedRequests ?? 0) + hrs) / responded
    : hrs
  return { acceptedRequests: accepted, respondedRequests: responded, avgResponseHours: Math.round(avg * 10) / 10 }
}

/** SLA breach when PENDING and past slaDueAt (cron nudges alumni). */
export function isSlaBreached(r: { status: string; slaDueAt?: Date | string | null }, now: Date = new Date()): boolean {
  if (r.status !== 'PENDING') return false
  if (!r.slaDueAt) return false
  const d = r.slaDueAt instanceof Date ? r.slaDueAt : new Date(String(r.slaDueAt))
  if (Number.isNaN(d.getTime())) return false
  return now.getTime() > d.getTime()
}

/** Expirable when PENDING and past expiresAt (cron flips to EXPIRED). */
export function isExpirable(r: { status: string; expiresAt?: Date | string | null }, now: Date = new Date()): boolean {
  if (r.status !== 'PENDING') return false
  if (!r.expiresAt) return false
  const d = r.expiresAt instanceof Date ? r.expiresAt : new Date(String(r.expiresAt))
  if (Number.isNaN(d.getTime())) return false
  return now.getTime() > d.getTime()
}

/** Cron master toggle — OFF by default (Phase 1 ships dormant; Phase 2 enables after admin SOP). */
export function isAlumniCronEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.ALUMNI_CRON_ENABLED || '').toLowerCase() === 'true'
}

// ---------------------------------------------------------------------------
// Cron job runners (disabled by default; internalCron wires them in Phase 2).
// Deps-injected for hermetic tests (contestReminderService pattern).
// ---------------------------------------------------------------------------

export interface AlumniCronDeps {
  now?: Date
  batchLimit?: number
  enabled?: () => boolean
  listSlaBreached?: (now: Date, limit: number) => Promise<Array<{ id: string; alumniUserId: string; requesterId: string }>>
  listExpirable?: (now: Date, limit: number) => Promise<Array<{ id: string; requesterId: string; alumniUserId: string }>>
  markExpired?: (id: string, at: Date) => Promise<void>
  notify?: (userId: string, n: { title: string; message: string; type: string; priority: string; source: string }) => Promise<unknown>
}

/** SLA nudge: notify alumni of breached PENDING requests (no DB write — advisory only). */
export async function runAlumniSlaJob(deps: AlumniCronDeps = {}): Promise<{ checked: number; nudged: number; skipped: boolean }> {
  const enabled = deps.enabled ? deps.enabled() : isAlumniCronEnabled()
  if (!enabled) return { checked: 0, nudged: 0, skipped: true }
  const now = deps.now ?? new Date()
  const limit = Math.min(Math.max(deps.batchLimit ?? 200, 1), 500)
  let listSla = deps.listSlaBreached
  let notify = deps.notify
  if (!listSla || !notify) {
    const [{ default: prisma }, { notifyUsers }] = await Promise.all([
      import('../config/db'),
      import('./notificationService'),
    ])
    listSla = listSla ?? (async (at: Date, take: number) => {
      const rows = await (prisma as never as {
        mentorshipRequest: { findMany: (a: unknown) => Promise<Array<{ id: string; alumniUserId: string; requesterId: string }>> }
      }).mentorshipRequest.findMany({
        where: { status: 'PENDING', slaDueAt: { lte: at } },
        select: { id: true, alumniUserId: true, requesterId: true },
        orderBy: { slaDueAt: 'asc' },
        take,
      })
      return rows
    })
    notify = notify ?? (async (userId: string, n) => { await notifyUsers([userId], n) })
  }
  const due = await listSla!(now, limit)
  let nudged = 0
  for (const row of due) {
    try {
      await notify!(row.alumniUserId, {
        title: 'Mentorship request awaiting your response',
        message: `A student mentorship request has been waiting 3+ days. Please accept or decline.`,
        type: 'MENTORSHIP_SLA',
        priority: 'HIGH',
        source: `mentorship:${row.id}`,
      })
      nudged++
    } catch { /* advisory — never throws the cron */ }
  }
  return { checked: due.length, nudged, skipped: false }
}

/** Auto-expire: flip PENDING past expiresAt → EXPIRED + notify requester. */
export async function runAlumniExpireJob(deps: AlumniCronDeps = {}): Promise<{ checked: number; expired: number; skipped: boolean }> {
  const enabled = deps.enabled ? deps.enabled() : isAlumniCronEnabled()
  if (!enabled) return { checked: 0, expired: 0, skipped: true }
  const now = deps.now ?? new Date()
  const limit = Math.min(Math.max(deps.batchLimit ?? 200, 1), 500)
  let listExp = deps.listExpirable
  let markExpired = deps.markExpired
  let notify = deps.notify
  if (!listExp || !markExpired || !notify) {
    const [{ default: prisma }, { notifyUsers }] = await Promise.all([
      import('../config/db'),
      import('./notificationService'),
    ])
    listExp = listExp ?? (async (at: Date, take: number) => {
      const rows = await (prisma as never as {
        mentorshipRequest: { findMany: (a: unknown) => Promise<Array<{ id: string; requesterId: string; alumniUserId: string }>> }
      }).mentorshipRequest.findMany({
        where: { status: 'PENDING', expiresAt: { lte: at } },
        select: { id: true, requesterId: true, alumniUserId: true },
        orderBy: { expiresAt: 'asc' },
        take,
      })
      return rows
    })
    markExpired = markExpired ?? (async (id: string, at: Date) => {
      await (prisma as never as {
        mentorshipRequest: { update: (a: unknown) => Promise<unknown> }
      }).mentorshipRequest.update({ where: { id }, data: { status: 'EXPIRED', respondedAt: at } })
    })
    notify = notify ?? (async (userId: string, n) => {
      try { await notifyUsers([userId], n) } catch { /* non-fatal */ }
    })
  }
  const due = await listExp!(now, limit)
  let expired = 0
  for (const row of due) {
    try {
      await markExpired!(row.id, now)
      await notify!(row.requesterId, {
        title: 'Mentorship request expired',
        message: 'Your mentorship request expired after 14 days without a response. You can send a new request.',
        type: 'MENTORSHIP_EXPIRED',
        priority: 'MEDIUM',
        source: `mentorship:${row.id}`,
      })
      expired++
    } catch { /* continue batch */ }
  }
  return { checked: due.length, expired, skipped: false }
}
