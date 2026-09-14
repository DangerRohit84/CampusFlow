// utils/bulkRouteHelpers.ts — pure route helpers for bulk import/delete/password.
// WHY split out: routes/admin.ts pulls express+prisma (integration weight);
// these shapes are hermetic Small-testable here (<100ms, no I/O), mirroring
// the userFilters.ts precedent. P1 shared-password (2026-09-14): ONE
// sharedPassword per batch (required on confirm, optional on dry-run).

export const MAX_IMPORT_ROWS = 1000

/** Extract sharedPassword from a bulk body (absent/blank → undefined). */
export function sharedPasswordOf(body: unknown): string | undefined {
  const v = (body as Record<string, unknown> | null | undefined)?.sharedPassword
  return typeof v === 'string' && v !== '' ? v : undefined
}

/**
 * Map a service shared-password failure (guaranteed zero writes via
 * sharedPasswordInvalid) to a clear 400 for old API callers without
 * sharedPassword. Null = normal 200 path (row-level errors stay 200).
 *
 * RELEASE COMMS (2026-09-14, P1 SUPERSEDE — copy into changelog):
 * "Bulk import confirm now REQUIRES sharedPassword (one password for the whole
 * batch, 8-72 chars, not common; HIBP skipped on admin paths — see
 * accepted-risk note). Old automation that confirmed without
 * sharedPassword will now get 400 { error: 'Shared password is required...' }
 * (zero writes) instead of a silent 200. Fix: send { sharedPassword } on confirm,
 * or dry-run first for the { valid, errors } hint. CSV `password` column stays
 * warn-ignored (not 400) this release. No other contract change."
 */
export function sharedPw400(results: {
  sharedPasswordInvalid?: boolean
  errors: string[]
}): { error: string; errors: string[] } | null {
  if (!results.sharedPasswordInvalid) return null
  return { error: results.errors[0] ?? 'Invalid shared password', errors: results.errors }
}

/** Confirm-time row guards (dry-run reports empty via the service instead). */
export function importRowsGuard(rows: unknown): { error: string } | null {
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      error:
        'No rows to import. Send {rows} (or {teachers}/{students}) or {csv} text with a name+email header.',
    }
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return { error: `Maximum ${MAX_IMPORT_ROWS} rows per import` }
  }
  return null
}
