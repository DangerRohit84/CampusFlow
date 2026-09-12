/**
 * #4 per-source health dashboard + retry failed fetch.
 * Covers: status derivation, in-memory store math, failed selector,
 * detailed fan-out isolation (one platform throwing never fails siblings),
 * and single-platform meta timing.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveSourceStatus,
  normalizePlatformKey,
  unknownHealth,
  selectFailedPlatforms,
  createInMemorySourceHealthStore,
  recordSourceRun,
} from '../src/services/fetch/health';
import {
  fetchFromAllSourcesWithResults,
  fetchFromPlatformWithMeta,
} from '../src/services/opportunityAgent';
import { registerPlatform } from '../src/services/opportunities/registry';
import { toNormalized } from '../src/services/opportunities/types';

function norm(title: string, source: string, deadline = '') {
  return toNormalized(
    { type: 'HACKATHON', title, description: 'd', url: `https://example.com/${title}`, source },
    { deadline },
  );
}

describe('deriveSourceStatus', () => {
  it('UNKNOWN when never run', () => {
    expect(deriveSourceStatus({ totalRuns: 0, consecutiveFails: 0, successRate: 0 })).toBe('UNKNOWN');
  });
  it('OK on perfect history with fast latency', () => {
    expect(deriveSourceStatus({ totalRuns: 5, consecutiveFails: 0, successRate: 100, lastLatencyMs: 1200 })).toBe('OK');
  });
  it('DEGRADED on a single consecutive failure', () => {
    expect(deriveSourceStatus({ totalRuns: 4, consecutiveFails: 1, successRate: 75 })).toBe('DEGRADED');
  });
  it('DOWN after 3 consecutive failures', () => {
    expect(deriveSourceStatus({ totalRuns: 3, consecutiveFails: 3, successRate: 0 })).toBe('DOWN');
  });
  it('DEGRADED on flaky history even when latest succeeded', () => {
    expect(deriveSourceStatus({ totalRuns: 10, consecutiveFails: 0, successRate: 70 })).toBe('DEGRADED');
  });
  it('DEGRADED on slow success (>30s)', () => {
    expect(deriveSourceStatus({ totalRuns: 2, consecutiveFails: 0, successRate: 100, lastLatencyMs: 45_000 })).toBe('DEGRADED');
  });
});

describe('normalizePlatformKey / unknownHealth', () => {
  it('upper-cases and trims', () => {
    expect(normalizePlatformKey('  devfolio ')).toBe('DEVFOLIO');
  });
  it('unknown row is UNKNOWN with zeroed counters', () => {
    const h = unknownHealth('devfolio');
    expect(h.platform).toBe('DEVFOLIO');
    expect(h.status).toBe('UNKNOWN');
    expect(h.totalRuns).toBe(0);
    expect(h.lastSuccessAt).toBeNull();
  });
});

describe('InMemorySourceHealthStore', () => {
  it('tracks success rate + resets consecutive fails on success', async () => {
    const store = createInMemorySourceHealthStore();
    await store.recordRun({ platform: 'devfolio', ok: true, latencyMs: 500, fetchedCount: 4 });
    await store.recordRun({ platform: 'DEVFOLIO', ok: false, latencyMs: 900, error: 'boom', fetchedCount: 0 });
    let h = await store.get('devfolio');
    expect(h.totalRuns).toBe(2);
    expect(h.successRuns).toBe(1);
    expect(h.successRate).toBe(50);
    expect(h.consecutiveFails).toBe(1);
    expect(h.status).toBe('DEGRADED');
    expect(h.lastError).toContain('boom');

    await store.recordRun({ platform: 'DEVFOLIO', ok: true, latencyMs: 400, fetchedCount: 2 });
    h = await store.get('DEVFOLIO');
    expect(h.consecutiveFails).toBe(0);
    expect(h.lastError).toBeNull();
    expect(h.lastSuccessAt).not.toBeNull();
  });

  it('goes DOWN after 3 consecutive failures', async () => {
    const store = createInMemorySourceHealthStore();
    for (let i = 0; i < 3; i++) {
      await store.recordRun({ platform: 'MLH', ok: false, latencyMs: 100, error: `e${i}` });
    }
    const h = await store.get('mlh');
    expect(h.status).toBe('DOWN');
    expect(h.consecutiveFails).toBe(3);
    expect(h.successRate).toBe(0);
  });

  it('recordSourceRun never throws (health must not fail a fetch)', async () => {
    const broken = {
      get: async () => { throw new Error('db down'); },
      getAll: async () => { throw new Error('db down'); },
      recordRun: async () => { throw new Error('db down'); },
    };
    await expect(recordSourceRun(broken as any, { platform: 'X', ok: true })).resolves.toBeUndefined();
  });
});

describe('selectFailedPlatforms', () => {
  it('picks DOWN + DEGRADED only (normalized keys)', () => {
    const out = selectFailedPlatforms([
      { ...unknownHealth('DEVFOLIO'), status: 'OK' },
      { ...unknownHealth('mlh'), status: 'DEGRADED' },
      { ...unknownHealth('UNSTOP'), status: 'DOWN' },
      unknownHealth('WELLFOUND'),
    ]);
    expect(out).toEqual(['MLH', 'UNSTOP']);
  });
});

describe('fetchFromAllSourcesWithResults (isolated per-platform)', () => {
  it('one throwing platform does not fail siblings; results carry latency/count', async () => {
    registerPlatform({
      key: 'TEST_HEALTH_OK',
      type: 'HACKATHON',
      fetcher: async () => [norm('Health Ok Hack', 'TEST_HEALTH_OK'), norm('Health Ok Hack 2', 'TEST_HEALTH_OK')],
      enrichPages: [''],
    });
    registerPlatform({
      key: 'TEST_HEALTH_FAIL',
      type: 'HACKATHON',
      fetcher: async () => { throw new Error('source exploded'); },
      enrichPages: [''],
    });

    const detailed = await fetchFromAllSourcesWithResults({ TEST_HEALTH_OK: undefined, TEST_HEALTH_FAIL: undefined });
    expect(detailed.items.length).toBe(2);
    expect(detailed.items.every((i) => i.source === 'TEST_HEALTH_OK')).toBe(true);

    const byKey = new Map(detailed.results.map((r) => [r.platform, r]));
    expect(byKey.get('TEST_HEALTH_OK')?.ok).toBe(true);
    expect(byKey.get('TEST_HEALTH_OK')?.count).toBe(2);
    expect(byKey.get('TEST_HEALTH_FAIL')?.ok).toBe(false);
    expect(byKey.get('TEST_HEALTH_FAIL')?.count).toBe(0);
    expect(byKey.get('TEST_HEALTH_FAIL')?.error).toContain('exploded');
    for (const r of detailed.results) {
      expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('fetchFromPlatformWithMeta', () => {
  it('returns items + latency for a known platform', async () => {
    registerPlatform({
      key: 'TEST_HEALTH_META',
      type: 'INTERNSHIP',
      fetcher: async () => [norm('Meta Intern', 'TEST_HEALTH_META')],
      enrichPages: [''],
    });
    const out = await fetchFromPlatformWithMeta('test_health_meta');
    expect(out.items.length).toBe(1);
    expect(out.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('throws for unknown platforms (route maps to 500, no health row)', async () => {
    await expect(fetchFromPlatformWithMeta('NO_SUCH_PLATFORM_XYZ')).rejects.toThrow(/Unknown platform/);
  });
});
