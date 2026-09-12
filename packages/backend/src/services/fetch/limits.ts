// services/fetch/limits.ts — Fetch-All limit normalization (SRP extract from routes/fetch.ts).
// WHY: 50-line tick/target normalization (client selection vs PlatformSettings
// vs default 10) was inline in POST /all. Pure-ish helper with injectable
// settings reader for tests (DIP). Behavior identical (0 => undefined/All,
// missing = disabled when client sent keys, DB fallback when empty).

import { logger } from '../../utils/logger';

export interface PlatformSettingRow {
  platform: string;
  type: string;
  enabled?: boolean;
  fetchLimit?: number;
}

export async function normalizeFetchLimits(
  limits: Record<string, unknown>,
  allPlatforms: string[],
  platformType: Record<string, string>,
  readSettings: () => Promise<PlatformSettingRow[]>,
): Promise<Record<string, number | undefined>> {
  const incomingKeys = new Set(Object.keys(limits || {}).map((k) => String(k).toUpperCase()));
  const normalized: Record<string, number | undefined> = {};
  for (const [k, v] of Object.entries(limits || {})) {
    const up = String(k).toUpperCase();
    if (!allPlatforms.includes(up)) continue;
    const num = Number(v);
    if (!Number.isFinite(num) || num < 0 || num > 50) continue;
    normalized[up] = num === 0 ? undefined : num;
  }
  if (incomingKeys.size === 0) {
    try {
      const dbSettings = await readSettings();
      if (dbSettings.length > 0) {
        for (const p of allPlatforms) {
          const type = platformType[p];
          const s = dbSettings.find((x) => x.platform === p && x.type === type);
          if (s && s.enabled === false) {
            logger.info(`[Fetch] Skipping ${p} (disabled via PlatformSettings)`);
            continue;
          }
          const raw = s ? (s.fetchLimit ?? 10) : 10;
          normalized[p] = raw === 0 ? undefined : raw;
        }
      } else {
        for (const p of allPlatforms) normalized[p] = 10;
      }
    } catch (e: unknown) {
      logger.warn({ err: (e as Error)?.message || e }, '[Fetch] DB settings read failed, defaulting to 10 each:');
      for (const p of allPlatforms) if (!(p in normalized)) normalized[p] = 10;
    }
  } else {
    logger.info(
      `[Fetch] Fetch All selection: ${Object.entries(normalized)
        .map(([k, v]) => `${k}:${v === undefined ? 'All' : v}`)
        .join(', ')} (omitted = disabled)`,
    );
  }
  return normalized;
}
