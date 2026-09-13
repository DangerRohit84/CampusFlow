/**
 * SuperAdmin auto-fetch master toggle + per-platform targets.
 * Covers: env parsing, precedence (env > DB > default-ON), never-throw
 * fallbacks (missing table/stale client/DB error → default ON), DB persist,
 * cron skip for BOTH auto-fetch jobs (opportunities + contests) with manual
 * fetch unaffected (route-level: no flag check in POST /fetch/*), and
 * per-platform caps (normalize + capItemsByLimits).
 * Hermetic: DB/env injected, no network, no real Prisma.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseAutoFetchEnv,
  readAutoFetchDb,
  getAutoFetchState,
  isAutoFetchEnabled,
  setAutoFetchEnabled,
} from '../src/services/fetch/autoFetch';
import { normalizeFetchLimits, capItemsByLimits } from '../src/services/fetch/limits';
import { runContestsJob, runOpportunitiesJob } from '../src/routes/internalCron';

const ALL = ['DEVFOLIO', 'DEVPOST', 'MLH'];
const TYPES: Record<string, string> = { DEVFOLIO: 'HACKATHON', DEVPOST: 'HACKATHON', MLH: 'HACKATHON' };

describe('parseAutoFetchEnv', () => {
  it('parses true-ish values', () => {
    for (const v of ['true', 'TRUE', ' 1 ', 'yes', 'Y', 'on', 'ON']) {
      expect(parseAutoFetchEnv(v)).toBe(true);
    }
  });
  it('parses false-ish values', () => {
    for (const v of ['false', 'FALSE', ' 0 ', 'no', 'N', 'off', 'OFF']) {
      expect(parseAutoFetchEnv(v)).toBe(false);
    }
  });
  it('returns undefined for unset/blank/garbage (never throws)', () => {
    expect(parseAutoFetchEnv(undefined)).toBeUndefined();
    expect(parseAutoFetchEnv(null)).toBeUndefined();
    expect(parseAutoFetchEnv('')).toBeUndefined();
    expect(parseAutoFetchEnv('   ')).toBeUndefined();
    expect(parseAutoFetchEnv('maybe')).toBeUndefined();
    expect(parseAutoFetchEnv(12345)).toBeUndefined();
  });
});

describe('isAutoFetchEnabled precedence', () => {
  const OLD = process.env.AUTO_FETCH_ENABLED;
  afterEach(() => {
    if (OLD === undefined) delete process.env.AUTO_FETCH_ENABLED;
    else process.env.AUTO_FETCH_ENABLED = OLD;
  });

  it('env=false forces OFF even when DB says true (kill-switch, no DB hit)', async () => {
    const db = { fetchConfig: { findUnique: vi.fn(async () => { throw new Error('must not be called'); }) } };
    await expect(isAutoFetchEnabled({ env: { AUTO_FETCH_ENABLED: 'false' } as NodeJS.ProcessEnv, db })).resolves.toBe(false);
    expect(db.fetchConfig.findUnique).not.toHaveBeenCalled();
  });

  it('env=true forces ON even when DB says false', async () => {
    const db = { fetchConfig: { findUnique: vi.fn(async () => ({ autoFetchEnabled: false })) } };
    await expect(isAutoFetchEnabled({ env: { AUTO_FETCH_ENABLED: 'true' } as NodeJS.ProcessEnv, db })).resolves.toBe(true);
  });

  it('falls back to DB when env unset', async () => {
    const off = { fetchConfig: { findUnique: vi.fn(async () => ({ autoFetchEnabled: false })) } };
    const on = { fetchConfig: { findUnique: vi.fn(async () => ({ autoFetchEnabled: true })) } };
    await expect(isAutoFetchEnabled({ env: {} as NodeJS.ProcessEnv, db: off })).resolves.toBe(false);
    await expect(isAutoFetchEnabled({ env: {} as NodeJS.ProcessEnv, db: on })).resolves.toBe(true);
  });

  it('defaults ON when no row / stale client / DB throws (never throws)', async () => {
    const noRow = { fetchConfig: { findUnique: vi.fn(async () => null) } };
    const stale = {};
    const p2021 = { fetchConfig: { findUnique: vi.fn(async () => { const e = new Error('relation "fetch_config" does not exist') as Error & { code: string }; e.code = 'P2021'; throw e; }) } };
    const boom = { fetchConfig: { findUnique: vi.fn(async () => { throw new Error('Neon blip'); }) } };
    for (const db of [noRow, stale, p2021, boom]) {
      await expect(isAutoFetchEnabled({ env: {} as NodeJS.ProcessEnv, db })).resolves.toBe(true);
    }
    await expect(readAutoFetchDb(stale)).resolves.toBeNull();
  });

  it('getAutoFetchState reports the winning source', async () => {
    const dbOff = { fetchConfig: { findUnique: vi.fn(async () => ({ autoFetchEnabled: false })) } };
    await expect(getAutoFetchState({ env: { AUTO_FETCH_ENABLED: '0' } as NodeJS.ProcessEnv, db: dbOff }))
      .resolves.toMatchObject({ autoFetchEnabled: false, effectiveAutoFetch: false, source: 'env' });
    await expect(getAutoFetchState({ env: {} as NodeJS.ProcessEnv, db: dbOff }))
      .resolves.toMatchObject({ autoFetchEnabled: false, effectiveAutoFetch: false, source: 'db' });
    await expect(getAutoFetchState({ env: {} as NodeJS.ProcessEnv, db: {} }))
      .resolves.toMatchObject({ autoFetchEnabled: true, effectiveAutoFetch: true, source: 'default' });
  });
});

describe('setAutoFetchEnabled', () => {
  it('upserts the singleton row and echoes the stored value', async () => {
    const upsert = vi.fn(async (args: unknown) => ({ autoFetchEnabled: (args as { update: { autoFetchEnabled: boolean } }).update.autoFetchEnabled }));
    const db = { fetchConfig: { upsert } };
    await expect(setAutoFetchEnabled(false, db)).resolves.toBe(false);
    expect(upsert).toHaveBeenCalledWith({
      where: { id: 'global' },
      update: { autoFetchEnabled: false },
      create: { id: 'global', autoFetchEnabled: false },
    });
    await expect(setAutoFetchEnabled(true, db)).resolves.toBe(true);
  });
});

describe('cron master-toggle skip', () => {
  it('runOpportunitiesJob returns all-zero when toggle is OFF (before any DB/fetch)', async () => {
    const res = await runOpportunitiesJob({ isEnabled: async () => false });
    expect(res).toEqual({
      hackathonsFetched: 0, hackathonsSkipped: 0,
      internshipsFetched: 0, internshipsSkipped: 0,
      hackathonsEnriched: 0, internshipsEnriched: 0,
    });
  });

  it('runContestsJob returns zero when toggle is OFF (before any fetch)', async () => {
    const res = await runContestsJob({ isEnabled: async () => false });
    expect(res).toEqual({ fetched: 0, updated: 0 });
  });
});

describe('per-platform targets', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('normalizeFetchLimits: DB fallback skips disabled + maps 0→All( undefined)', async () => {
    const readSettings = async () => [
      { platform: 'DEVFOLIO', type: 'HACKATHON', enabled: true, fetchLimit: 5 },
      { platform: 'DEVPOST', type: 'HACKATHON', enabled: false, fetchLimit: 10 },
      { platform: 'MLH', type: 'HACKATHON', enabled: true, fetchLimit: 0 },
    ];
    const out = await normalizeFetchLimits({}, ALL, TYPES, readSettings);
    expect(out).toEqual({ DEVFOLIO: 5, MLH: undefined });
    expect('DEVPOST' in out).toBe(false);
  });

  it('normalizeFetchLimits: explicit client map wins; unknown/invalid dropped', async () => {
    const readSettings = vi.fn(async () => [{ platform: 'DEVFOLIO', type: 'HACKATHON', enabled: true, fetchLimit: 5 }]);
    const out = await normalizeFetchLimits(
      { devfolio: 3, NOPE: 5, mlh: 99, devpost: -1 },
      ALL, TYPES, readSettings,
    );
    expect(out).toEqual({ DEVFOLIO: 3 });
    expect(readSettings).not.toHaveBeenCalled();
  });

  it('normalizeFetchLimits: DB failure defaults every platform to 10', async () => {
    const out = await normalizeFetchLimits({}, ALL, TYPES, async () => { throw new Error('db down'); });
    expect(out).toEqual({ DEVFOLIO: 10, DEVPOST: 10, MLH: 10 });
  });

  it('capItemsByLimits: caps per source, uncapped when undefined/0, order preserved', () => {
    const items = [
      { source: 'DEVFOLIO', title: 'a' }, { source: 'DEVFOLIO', title: 'b' }, { source: 'DEVFOLIO', title: 'c' },
      { source: 'MLH', title: 'd' }, { source: 'DEVPOST', title: 'e' },
    ];
    expect(capItemsByLimits(items, { DEVFOLIO: 2, MLH: undefined, DEVPOST: 0 }).map((i) => i.title))
      .toEqual(['a', 'b', 'd', 'e']);
    expect(capItemsByLimits(items, {})).toHaveLength(5);
  });
});
