// services/fetch/health.ts — per-source fetch health (task #4 remainder).
// WHY: GET /stats only counted staging rows; PlatformSettings.lastFetchAt is
// never written (dead signal), and per-platform failures inside Fetch All were
// swallowed (isolated warn, no surface). Admins could not tell which source
// was down vs slow. This module owns: status derivation (OK/DEGRADED/DOWN/
// UNKNOWN), an injectable store (DIP: Prisma in prod, in-memory fake in
// tests + graceful fallback when the migration hasn't landed), and the
// failed-platform selector used by POST /fetch/retry-failed.
//
// Status rule (single place, tested):
//   totalRuns === 0            -> UNKNOWN (never run)
//   consecutiveFails >= 3      -> DOWN (persistent failure)
//   consecutiveFails >= 1      -> DEGRADED (latest run failed)
//   successRate < 80           -> DEGRADED (flaky history)
//   lastLatencyMs > 30_000     -> DEGRADED (too slow, even on success)
//   else                       -> OK
//
// KISS: successRate is a plain 0-100 float; no decay window (last N runs is
// future work if flaky-source triage needs it).

import prisma from '../../config/db';
import { logger } from '../../utils/logger';

export type SourceStatus = 'OK' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';

export interface SourceHealthRecord {
  platform: string;
  status: SourceStatus;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  totalRuns: number;
  successRuns: number;
  /** 0-100 */
  successRate: number;
  consecutiveFails: number;
  fetchedCount: number;
  updatedAt: string | null;
}

export interface RecordRunInput {
  platform: string;
  /** true when the fetch produced a usable result (even 0 items counts if no throw) */
  ok: boolean;
  latencyMs?: number | null;
  error?: string | null;
  /** items fetched from this source in this run (saved or raw, for display) */
  fetchedCount?: number | null;
}

export const SLOW_FETCH_MS = 30_000;
export const DOWN_AFTER_CONSECUTIVE_FAILS = 3;
export const DEGRADED_BELOW_SUCCESS_RATE = 80;

export function normalizePlatformKey(platform: string): string {
  return String(platform || '').toUpperCase().trim();
}

export function isSourceStatus(v: unknown): v is SourceStatus {
  return v === 'OK' || v === 'DEGRADED' || v === 'DOWN' || v === 'UNKNOWN';
}

/** Pure status derivation — unit-tested, no I/O. */
export function deriveSourceStatus(args: {
  totalRuns: number;
  consecutiveFails: number;
  successRate: number;
  lastLatencyMs?: number | null;
}): SourceStatus {
  const { totalRuns, consecutiveFails, successRate, lastLatencyMs } = args;
  if (!totalRuns || totalRuns <= 0) return 'UNKNOWN';
  if (consecutiveFails >= DOWN_AFTER_CONSECUTIVE_FAILS) return 'DOWN';
  if (consecutiveFails >= 1) return 'DEGRADED';
  if (successRate < DEGRADED_BELOW_SUCCESS_RATE) return 'DEGRADED';
  if (lastLatencyMs != null && lastLatencyMs > SLOW_FETCH_MS) return 'DEGRADED';
  return 'OK';
}

function toRecord(row: any, platform: string): SourceHealthRecord {
  const status = isSourceStatus(row?.status) ? row.status : 'UNKNOWN';
  return {
    platform,
    status,
    lastRunAt: row?.lastRunAt ? new Date(row.lastRunAt).toISOString() : null,
    lastSuccessAt: row?.lastSuccessAt ? new Date(row.lastSuccessAt).toISOString() : null,
    lastLatencyMs: typeof row?.lastLatencyMs === 'number' ? row.lastLatencyMs : null,
    lastError: row?.lastError != null ? String(row.lastError).slice(0, 500) : null,
    totalRuns: Number(row?.totalRuns ?? 0),
    successRuns: Number(row?.successRuns ?? 0),
    successRate: Number(row?.successRate ?? 0),
    consecutiveFails: Number(row?.consecutiveFails ?? 0),
    fetchedCount: Number(row?.fetchedCount ?? 0),
    updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

export function unknownHealth(platform: string): SourceHealthRecord {
  return {
    platform: normalizePlatformKey(platform),
    status: 'UNKNOWN',
    lastRunAt: null,
    lastSuccessAt: null,
    lastLatencyMs: null,
    lastError: null,
    totalRuns: 0,
    successRuns: 0,
    successRate: 0,
    consecutiveFails: 0,
    fetchedCount: 0,
    updatedAt: null,
  };
}

export interface SourceHealthStore {
  get(platform: string): Promise<SourceHealthRecord>;
  getAll(platforms: string[]): Promise<SourceHealthRecord[]>;
  recordRun(input: RecordRunInput): Promise<SourceHealthRecord>;
}

/** In-memory store — hermetic vitest fake + runtime fallback before migration. */
export class InMemorySourceHealthStore implements SourceHealthStore {
  private readonly rows = new Map<string, SourceHealthRecord>();

  async get(platform: string): Promise<SourceHealthRecord> {
    const key = normalizePlatformKey(platform);
    return this.rows.get(key) ?? unknownHealth(key);
  }

  async getAll(platforms: string[]): Promise<SourceHealthRecord[]> {
    return platforms.map((p) => this.rows.get(normalizePlatformKey(p)) ?? unknownHealth(p));
  }

  async recordRun(input: RecordRunInput): Promise<SourceHealthRecord> {
    const platform = normalizePlatformKey(input.platform);
    const prev = this.rows.get(platform) ?? unknownHealth(platform);
    const now = new Date().toISOString();
    const totalRuns = prev.totalRuns + 1;
    const successRuns = prev.successRuns + (input.ok ? 1 : 0);
    const consecutiveFails = input.ok ? 0 : prev.consecutiveFails + 1;
    const successRate = totalRuns > 0 ? Math.round((successRuns / totalRuns) * 1000) / 10 : 0;
    const latency = typeof input.latencyMs === 'number' && Number.isFinite(input.latencyMs)
      ? Math.max(0, Math.round(input.latencyMs))
      : null;
    const next: SourceHealthRecord = {
      platform,
      status: deriveSourceStatus({ totalRuns, consecutiveFails, successRate, lastLatencyMs: latency ?? prev.lastLatencyMs }),
      lastRunAt: now,
      lastSuccessAt: input.ok ? now : prev.lastSuccessAt,
      lastLatencyMs: latency ?? prev.lastLatencyMs,
      lastError: input.ok ? null : (input.error ? String(input.error).slice(0, 500) : 'Fetch failed'),
      totalRuns,
      successRuns,
      successRate,
      consecutiveFails,
      fetchedCount: typeof input.fetchedCount === 'number' && Number.isFinite(input.fetchedCount)
        ? Math.max(0, Math.round(input.fetchedCount))
        : prev.fetchedCount,
      updatedAt: now,
    };
    this.rows.set(platform, next);
    return next;
  }
}

interface SourceHealthDb {
  sourceHealth: {
    findUnique(args: unknown): Promise<any>;
    findMany(args: unknown): Promise<any[]>;
    upsert(args: unknown): Promise<any>;
  };
}

/**
 * Prisma store with in-memory fallback (migration-pending safe).
 * If the source_health table is absent (P2021/table-missing), reads return
 * UNKNOWN and writes go to a process-local map + warn — never throw to the
 * fetch path (health must not fail a fetch).
 */
export class PrismaSourceHealthStore implements SourceHealthStore {
  private readonly fallback = new InMemorySourceHealthStore();
  private tableMissing = false;

  constructor(private readonly db: SourceHealthDb = prisma as unknown as SourceHealthDb) {}

  private isMissingTable(err: any): boolean {
    const msg = String(err?.message || err || '');
    const code = String((err as any)?.code || '');
    return code === 'P2021' || /does not exist|no such table|source_health/i.test(msg);
  }

  async get(platform: string): Promise<SourceHealthRecord> {
    const key = normalizePlatformKey(platform);
    if (this.tableMissing) return this.fallback.get(key);
    try {
      const row = await this.db.sourceHealth.findUnique({ where: { platform: key } });
      if (!row) return unknownHealth(key);
      return toRecord(row, key);
    } catch (err: any) {
      if (this.isMissingTable(err)) {
        this.tableMissing = true;
        logger.warn('[SourceHealth] table missing (migration pending) — using in-memory fallback');
        return this.fallback.get(key);
      }
      logger.debug({ err }, '[SourceHealth] get failed (treated as UNKNOWN)');
      return unknownHealth(key);
    }
  }

  async getAll(platforms: string[]): Promise<SourceHealthRecord[]> {
    const keys = platforms.map(normalizePlatformKey);
    if (this.tableMissing) return this.fallback.getAll(keys);
    try {
      const rows = await this.db.sourceHealth.findMany({ where: { platform: { in: keys } } });
      const byKey = new Map<string, any>((rows || []).map((r: any) => [normalizePlatformKey(r.platform), r]));
      return keys.map((k) => (byKey.has(k) ? toRecord(byKey.get(k), k) : unknownHealth(k)));
    } catch (err: any) {
      if (this.isMissingTable(err)) {
        this.tableMissing = true;
        logger.warn('[SourceHealth] table missing (migration pending) — using in-memory fallback');
        return this.fallback.getAll(keys);
      }
      logger.debug({ err }, '[SourceHealth] getAll failed (treated as UNKNOWN)');
      return keys.map(unknownHealth);
    }
  }

  async recordRun(input: RecordRunInput): Promise<SourceHealthRecord> {
    const platform = normalizePlatformKey(input.platform);
    // Always advance the fallback mirror so pre-migration runs still surface
    // in-process (and post-migration we stay consistent).
    const mirrored = await this.fallback.recordRun(input);
    if (this.tableMissing) return mirrored;
    try {
      const prev = await this.db.sourceHealth.findUnique({ where: { platform } }).catch(() => null);
      const p = prev
        ? {
            totalRuns: Number(prev.totalRuns ?? 0),
            successRuns: Number(prev.successRuns ?? 0),
            consecutiveFails: Number(prev.consecutiveFails ?? 0),
            lastSuccessAt: prev.lastSuccessAt ?? null,
            lastLatencyMs: typeof prev.lastLatencyMs === 'number' ? prev.lastLatencyMs : null,
            fetchedCount: Number(prev.fetchedCount ?? 0),
          }
        : { totalRuns: 0, successRuns: 0, consecutiveFails: 0, lastSuccessAt: null, lastLatencyMs: null, fetchedCount: 0 };
      const now = new Date();
      const totalRuns = p.totalRuns + 1;
      const successRuns = p.successRuns + (input.ok ? 1 : 0);
      const consecutiveFails = input.ok ? 0 : p.consecutiveFails + 1;
      const successRate = totalRuns > 0 ? Math.round((successRuns / totalRuns) * 1000) / 10 : 0;
      const latency = typeof input.latencyMs === 'number' && Number.isFinite(input.latencyMs)
        ? Math.max(0, Math.round(input.latencyMs))
        : null;
      const lastLatencyMs = latency ?? p.lastLatencyMs;
      const status = deriveSourceStatus({ totalRuns, consecutiveFails, successRate, lastLatencyMs });
      const row = await this.db.sourceHealth.upsert({
        where: { platform },
        update: {
          status,
          lastRunAt: now,
          ...(input.ok ? { lastSuccessAt: now } : {}),
          ...(latency != null ? { lastLatencyMs: latency } : {}),
          lastError: input.ok ? null : (input.error ? String(input.error).slice(0, 500) : 'Fetch failed'),
          totalRuns,
          successRuns,
          successRate,
          consecutiveFails,
          ...(typeof input.fetchedCount === 'number' && Number.isFinite(input.fetchedCount)
            ? { fetchedCount: Math.max(0, Math.round(input.fetchedCount)) }
            : {}),
        },
        create: {
          platform,
          status,
          lastRunAt: now,
          ...(input.ok ? { lastSuccessAt: now } : {}),
          ...(latency != null ? { lastLatencyMs: latency } : {}),
          lastError: input.ok ? null : (input.error ? String(input.error).slice(0, 500) : 'Fetch failed'),
          totalRuns,
          successRuns,
          successRate,
          consecutiveFails,
          fetchedCount: typeof input.fetchedCount === 'number' && Number.isFinite(input.fetchedCount)
            ? Math.max(0, Math.round(input.fetchedCount))
            : 0,
        },
      });
      return toRecord(row, platform);
    } catch (err: any) {
      if (this.isMissingTable(err)) {
        this.tableMissing = true;
        logger.warn('[SourceHealth] table missing (migration pending) — using in-memory fallback');
      } else {
        logger.debug({ err }, '[SourceHealth] recordRun failed (non-fatal, kept in-memory)');
      }
      return mirrored;
    }
  }
}

/** Default singleton (composition root wires it; routes import this). */
export const sourceHealthStore: SourceHealthStore = new PrismaSourceHealthStore();

/** Injectable factory for tests. */
export function createInMemorySourceHealthStore(): SourceHealthStore {
  return new InMemorySourceHealthStore();
}

/** Platforms needing a retry (failing sources highlighted in UI). */
export function selectFailedPlatforms(health: SourceHealthRecord[]): string[] {
  return health
    .filter((h) => h.status === 'DOWN' || h.status === 'DEGRADED')
    .map((h) => normalizePlatformKey(h.platform));
}

/** Never-throwing recorder for fetch routes — health must not fail a fetch. */
export async function recordSourceRun(
  store: SourceHealthStore,
  input: RecordRunInput,
): Promise<void> {
  try {
    await store.recordRun(input);
  } catch (err: any) {
    logger.debug({ err }, '[SourceHealth] recordSourceRun failed (non-fatal)');
  }
}
