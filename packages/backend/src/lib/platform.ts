/**
 * Platform enum boundary — single choke point for ContestParticipation.platform
 * + CodingContest.platform (Order 4: native PG `Platform` enum, UPPERCASE).
 *
 * LIVE bug: Prisma `platform` is now a NATIVE enum (values UPPERCASE like
 * CODECHEF) but fetchers emit lowercase ("codechef") and routes pass
 * `?platform=codechef` straight to Prisma. The `as any` casts at
 * syncEngine.ts:311-313 lied to tsc — runtime rejects with
 * PrismaClientValidationError. Fix at the boundary, not with casts.
 *
 * Rule: convert at the Prisma boundary ONLY.
 * - Inbound (fetchers / query params / handle keys → Prisma): use
 *   `toPlatformEnum()` (upper-case + validate against the REAL Prisma enum,
 *   throw on unknown). Callers log/skip (sync) or 400 (routes).
 * - Outbound (DB rows → API JSON): use `toApiPlatform()` (lower-case) to keep
 *   the frontend contract stable (frontend ids are lowercase: 'leetcode',
 *   'codeforces', 'codechef', 'hackerrank', 'gfg'; PlatformLogo + history
 *   filter + platformColors all key on lowercase).
 *
 * SSOT: Prisma `Platform` enum is authoritative for DB values; zod
 * `PlatformEnum` in validators.ts mirrors it for request validation. This
 * module validates against Prisma directly so drift fails closed.
 */
import { Platform } from '@prisma/client'

const VALID_PLATFORMS: ReadonlySet<string> = new Set<string>(
  Object.values(Platform) as string[]
)

/**
 * Normalize any platform-ish input to the native Prisma `Platform` enum.
 * Trims + upper-cases, then validates against the REAL enum. Throws on
 * unknown/empty so callers fail closed (sync skips the row, routes 400).
 */
export function toPlatformEnum(input: unknown): Platform {
  const normalized = String(input ?? '').trim().toUpperCase()
  if (!normalized || !VALID_PLATFORMS.has(normalized)) {
    throw new Error(
      `Invalid platform: ${JSON.stringify(String(input ?? ''))}. ` +
        `Allowed: ${[...VALID_PLATFORMS].join(', ')}`
    )
  }
  return normalized as Platform
}

/**
 * Non-throwing variant — returns null on unknown (for best-effort paths that
 * must skip + warn instead of throwing).
 */
export function tryToPlatformEnum(input: unknown): Platform | null {
  try {
    return toPlatformEnum(input)
  } catch {
    return null
  }
}

/**
 * Map a DB enum value back to the stable API shape (lowercase).
 * Frontend contract: lowercase ids ('leetcode', 'codeforces', ...).
 */
export function toApiPlatform(dbPlatform: unknown): string {
  return String(dbPlatform ?? '').trim().toLowerCase()
}

/**
 * Map a list of participation rows back to the API shape (lowercase platform).
 * Pure — returns new objects, never mutates Prisma rows.
 */
export function toApiParticipations<T extends { platform: unknown }>(
  rows: readonly T[]
): Array<Omit<T, 'platform'> & { platform: string }> {
  return rows.map((r) => ({ ...r, platform: toApiPlatform(r.platform) }))
}
