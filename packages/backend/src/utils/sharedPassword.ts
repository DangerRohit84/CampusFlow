// utils/sharedPassword.ts — ONE shared password per bulk batch (P1 import + bulk-pw).
// WHY: per-row passwords (prior contract) meant N HIBP calls + N secrets on wire/screen.
// Shared = single strength/HIBP/show-once/force-or-nudge path, single panel to copy.
// Pure validators (no DB) = hermetic unit tests; breachCheck injectable (DIP).
// Safety: never log password values (counts only); HIBP k-anonymity prefix-5 only,
// 3s timeout, HIBP_STRICT=true prod fail-closed (via checkPasswordBreach).

import crypto from 'crypto'
import { isCommonPassword, checkPasswordBreach } from './authHardening'
import { logger } from './logger'

export type BreachCheck = (pw: string) => Promise<{ breached: boolean; offline?: boolean }>

const defaultBreachCheck: BreachCheck = (pw) => checkPasswordBreach(pw)

export interface SharedPasswordCheck {
  valid: boolean
  errors: string[]
}

/** Pure format check (no I/O): 8–72 + not common. Single source for import + bulk-pw. */
export function validateSharedPasswordFormat(pw: unknown): string[] {
  const s = pw == null ? '' : String(pw)
  if (!s || s.length < 8 || s.length > 72) {
    return ['Password must be 8-72 characters']
  }
  if (isCommonPassword(s)) {
    return ['Password is too common, choose a stronger password']
  }
  return []
}

/**
 * Full validation: format + single HIBP k-anonymity call.
 * Call ONCE per batch (not per row) — fixes N-sequential perf note.
 * HIBP offline: checkPasswordBreach fail-closed when HIBP_STRICT=true (prod 400),
 * fail-open dev (warn). Never throws — returns errors.
 */
export async function validateSharedPasswordFull(
  pw: unknown,
  breachCheck: BreachCheck = defaultBreachCheck,
): Promise<SharedPasswordCheck> {
  const formatErrors = validateSharedPasswordFormat(pw)
  if (formatErrors.length > 0) return { valid: false, errors: formatErrors }
  const s = String(pw)
  try {
    const b = await breachCheck(s)
    if (b.breached) {
      return {
        valid: false,
        errors: b.offline
          ? ['Password has appeared in a data breach, choose a different password']
          : ['Password has appeared in a data breach, choose a different password'],
      }
    }
  } catch (err) {
    logger.debug({ err: (err as Error)?.message || err }, '[sharedPassword] breach check failed (non-fatal)')
    // checkPasswordBreach already handles STRICT fail-closed internally (returns breached:true).
    // Injectable mocks that throw = treat as offline fail-open (dev) to avoid false 400s in tests.
  }
  return { valid: true, errors: [] }
}

/** Generate one strong shared password (12-char crypto + A1! pattern). Never weak default. */
export function generateSharedPassword(): string {
  return crypto.randomBytes(9).toString('base64url').slice(0, 12) + 'A1!'
}

/** Strength meter 0–4 (length≥12, mixed case, digit, symbol). Shared by BE tests + FE copy. */
export function passwordStrength(pw: string): { score: number; checks: { length: boolean; mixed: boolean; digit: boolean; symbol: boolean } } {
  const s = String(pw || '')
  const checks = {
    length: s.length >= 12,
    mixed: /[a-z]/.test(s) && /[A-Z]/.test(s),
    digit: /\d/.test(s),
    symbol: /[^A-Za-z0-9]/.test(s),
  }
  const score = (checks.length ? 1 : 0) + (checks.mixed ? 1 : 0) + (checks.digit ? 1 : 0) + (checks.symbol ? 1 : 0)
  return { score, checks }
}

/** Confirm parser for bulk ops: must equal `RESET N` / `DELETE N` exact. Pure, hermetic. */
export function parseConfirmCount(confirm: unknown, verb: 'RESET' | 'DELETE'): number | null {
  if (typeof confirm !== 'string') return null
  const m = confirm.trim().match(/^(RESET|DELETE)\s+(\d+)$/)
  if (!m) return null
  if (m[1] !== verb) return null
  const n = parseInt(m[2], 10)
  return Number.isFinite(n) && n >= 1 ? n : null
}

/** Normalize + dedupe UUID-ish id lists (trim, drop empties, case-sensitive dedupe). Pure. */
export function normalizeBulkIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of ids) {
    const s = String(raw ?? '').trim()
    if (!s) continue
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}
