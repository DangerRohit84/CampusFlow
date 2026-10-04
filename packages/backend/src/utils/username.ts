// utils/username.ts — username setup/change flow SSOT (TDD GREEN).
// WHY: sanitize/isValid were copy-pasted in auth.ts, user.ts, publicProfile.ts
// (drift risk). This module is the single source for the new flow:
// provisional auto-set (setByUser=false) -> free setup -> max-3 changes.
// - MAX_USERNAME_CHANGES=3 for STUDENT/TEACHER/COLLEGE_ADMIN.
// - SUPER_ADMIN exempt (operational renames, documented choice).
// - Usernames are stored lowercased via sanitize, so exact match after
//   sanitize == case-insensitive uniqueness (no extra collation needed).
// Pre-migration safe: all readers treat missing cols (undefined) as
// setByUser=false / count=0 (prompt + full budget, never lockout).

export const MAX_USERNAME_CHANGES = 3

export function sanitizeUsernameValue(raw: string): string {
  return String(raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_.-]/g, '')
    .replace(/^[._-]+/, '')
    .slice(0, 20)
}

export function isValidUsernameValue(u: string): boolean {
  return /^[a-z0-9]([a-z0-9._-]{1,18}[a-z0-9])?$/.test(u) && u.length >= 3 && u.length <= 20
}

export interface UsernameFlowFields {
  username?: string | null
  usernameSetByUser?: boolean | null
  usernameChangeCount?: number | null
  role?: string | null
}

/** True when the user must be prompted to set/keep their username. */
export function needsUsernameSetup(user: UsernameFlowFields | null | undefined): boolean {
  if (!user?.username) return true
  return (user as { usernameSetByUser?: unknown }).usernameSetByUser !== true
}

/** Remaining change budget, clamped 0..MAX. Missing count (pre-migration) = full budget. */
export function remainingUsernameChanges(user: UsernameFlowFields | null | undefined): number {
  const count = Number((user as { usernameChangeCount?: unknown } | null | undefined)?.usernameChangeCount ?? 0)
  const safe = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  return Math.max(0, MAX_USERNAME_CHANGES - safe)
}

/** True when a counted change is allowed for this role/count. */
export function isUsernameChangeAllowed(
  user: UsernameFlowFields | null | undefined,
  role?: string | null,
): boolean {
  const r = String(role ?? (user as { role?: unknown } | null | undefined)?.role ?? '').toUpperCase()
  if (r === 'SUPER_ADMIN') return true
  const count = Number((user as { usernameChangeCount?: unknown } | null | undefined)?.usernameChangeCount ?? 0)
  const safe = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  return safe < MAX_USERNAME_CHANGES
}

export type UsernameChangeGate =
  | { allowed: true }
  | { allowed: false; status: 403; error: string }

/** Route gate: allowed or 403 with message (SUPER_ADMIN always allowed). */
export function canChangeUsername(
  user: UsernameFlowFields | null | undefined,
  role?: string | null,
): UsernameChangeGate {
  if (isUsernameChangeAllowed(user, role)) return { allowed: true }
  return {
    allowed: false,
    status: 403,
    error: `Maximum username changes reached (${MAX_USERNAME_CHANGES}). Contact support if you need an exception.`,
  }
}

/** Case-insensitive equality (both sides sanitized first). Used for keep-detection. */
export function isSameUsername(a: string, b: string): boolean {
  return sanitizeUsernameValue(a) === sanitizeUsernameValue(b)
}
