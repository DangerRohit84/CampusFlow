// opportunities/registrations.ts — register leftovers SSOT (SRP).
// WHY: unregister + remind-registered + ?mine=true were implemented twice
// (hackathons.ts + internships.ts) with copy-pasted guards. Single source
// here for validation/payload/where so both routes + hermetic tests share it.
// No DB I/O in this file (pure) — routes own Prisma calls; tests inject fakes.

export const REMIND_MESSAGE_MAX_LEN = 1000

export type OpportunityKind = 'hackathon' | 'internship'

/**
 * Parse ?mine=true (own registrations only).
 * Accepts 'true' (case-insensitive), '1', 'mine'. Everything else → false.
 */
export function parseMineParam(query: unknown): boolean {
  const raw = (query as Record<string, unknown> | null | undefined)?.mine
  if (raw === true) return true
  if (typeof raw === 'number') return raw === 1
  if (typeof raw !== 'string') return false
  const v = raw.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'mine'
}

/**
 * Apply ?mine=true to a list `where` clause.
 * Returns a new where that ANDs the base with
 * `{ registrations: { some: { userId } } }` when mine is true,
 * otherwise returns baseWhere unchanged (same reference).
 */
export function applyMineFilter<T extends Record<string, unknown>>(
  baseWhere: T,
  userId: string,
  mine: boolean,
): T {
  if (!mine) return baseWhere
  const mineClause = { registrations: { some: { userId } } }
  if (!baseWhere || Object.keys(baseWhere).length === 0) {
    return mineClause as unknown as T
  }
  return { AND: [baseWhere, mineClause] } as unknown as T
}

/** Only students may (un)register. Returns error string or null when allowed. */
export function unregisterRoleError(role: string | null | undefined): string | null {
  if (role !== 'STUDENT') return 'Only students can unregister'
  return null
}

/** Only staff may remind registered users. */
export function canRemind(role: string | null | undefined): boolean {
  return role === 'TEACHER' || role === 'COLLEGE_ADMIN' || role === 'SUPER_ADMIN'
}

export function remindRoleError(role: string | null | undefined): string | null {
  if (!canRemind(role)) return 'Only teachers or admins can send reminders'
  return null
}

/**
 * Validate POST /:id/remind body { message }.
 * Returns { ok:true, message } with trimmed message, or { ok:false, error }.
 */
export function validateRemindMessage(
  body: unknown,
): { ok: true; message: string } | { ok: false; error: string } {
  const raw = (body as Record<string, unknown> | null | undefined)?.message
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, error: 'Message is required' }
  }
  const message = raw.trim()
  if (message.length > REMIND_MESSAGE_MAX_LEN) {
    return { ok: false, error: `Message too long (max ${REMIND_MESSAGE_MAX_LEN} characters)` }
  }
  return { ok: true, message }
}

/**
 * Build the notificationService payload for a remind.
 * Scoping (registered-only) is enforced by the caller passing only
 * registered userIds to notifyUsers — this helper only shapes the content.
 */
export function buildRemindNotification(
  kind: OpportunityKind,
  title: string,
  message: string,
  sourceId: string,
): { title: string; message: string; type: string; source: string } {
  const label = kind === 'hackathon' ? 'Hackathon' : 'Internship'
  return {
    title: `${label} reminder: ${title}`,
    message,
    type: kind === 'hackathon' ? 'HACKATHON' : 'INTERNSHIP',
    source: sourceId,
  }
}

/** Extract registered userIds from registration rows (deduped, non-empty). */
export function registeredUserIds(
  regs: Array<{ userId?: unknown } | null | undefined>,
): string[] {
  const seen = new Set<string>()
  for (const r of regs) {
    const id = (r as { userId?: unknown } | null | undefined)?.userId
    if (typeof id === 'string' && id.length > 0) seen.add(id)
  }
  return Array.from(seen)
}
