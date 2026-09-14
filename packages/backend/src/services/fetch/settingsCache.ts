// services/fetch/settingsCache.ts — shared 60s cache for PlatformSettings reads.
// WHY (prod burst fix): PlatformSettings.findMany fired ×40 per dashboard burst —
// uncached in 4 places (POST /all limit-normalization, GET /config, PUT /config
// read-back, GET /settings/all) × frontend fan-out (10 PlatformCards each GET
// /fetch/settings/all on mount). platform_settings is ~10 rows, written only by
// explicit SUPER_ADMIN PUTs, so a 60s TTL is safe. Via lib/cache getOrSet so
// Redis shares it across instances when healthy, memory otherwise (same seam as
// the super-dashboard 60s cache). Writes invalidate (see below); all other
// readers get TTL-only freshness (consistent with super-dashboard precedent).
// DIP: db injectable for hermetic vitest (default prisma).

import prisma from '../../config/db'
import { cache, getOrSet } from '../../lib/cache'
import { logger } from '../../utils/logger'

export const PLATFORM_SETTINGS_CACHE_KEY = 'fetch:platform-settings'
export const PLATFORM_SETTINGS_CACHE_TTL_MS = 60_000

export interface PlatformSettingRow {
  platform: string
  type: string
  enabled?: boolean
  fetchLimit?: number
}

export interface PlatformSettingsDb {
  platformSettings: {
    findMany(args?: unknown): Promise<PlatformSettingRow[]>
  }
}

async function readUncached(db: PlatformSettingsDb): Promise<PlatformSettingRow[]> {
  const rows = await (db as PlatformSettingsDb).platformSettings.findMany()
  return Array.isArray(rows) ? rows : []
}

/**
 * Cached read — at most 1 DB round-trip per 60s per instance (shared via
 * Redis when configured). Never throws: on DB error returns [] so callers
 * fall back to defaults (same fail-open as the old per-route try/catch).
 */
export async function getCachedPlatformSettings(
  db: PlatformSettingsDb = prisma as unknown as PlatformSettingsDb
): Promise<PlatformSettingRow[]> {
  try {
    return await getOrSet<PlatformSettingRow[]>(PLATFORM_SETTINGS_CACHE_KEY, PLATFORM_SETTINGS_CACHE_TTL_MS, () =>
      readUncached(db)
    )
  } catch (err) {
    logger.warn({ err: (err as Error)?.message || err }, '[Fetch] cached platform-settings read failed, using defaults:')
    return []
  }
}

/**
 * Invalidate after explicit writes (PUT /:platform/limit, PUT /settings,
 * PUT /config). Best-effort (never throws); TTL expiry is the backstop.
 */
export async function invalidatePlatformSettingsCache(): Promise<void> {
  try {
    await cache.del(PLATFORM_SETTINGS_CACHE_KEY)
  } catch (err) {
    logger.debug({ err }, '[Fetch] platform-settings cache invalidate failed (TTL backstop covers it)')
  }
}
