/**
 * Cron ack-first 202 for free schedulers (QStash / cron-job.org).
 * Covers: shared wrapper handleJob responds 202 immediately then runs detached,
 * auth/secret checks stay synchronous (401/503), opportunities running-guard
 * (like profileSyncInFlight), manual POST /fetch/* untouched.
 * Hermetic: no DB/network (slow runners mocked, toggle-OFF for live routes).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';

import {
  handleJob,
  runOpportunitiesJob,
  __resetInternalCronForTests,
  __isOpportunitiesJobInFlightForTests,
} from '../src/routes/internalCron';
import { logger } from '../src/utils/logger';
import internalCronRouter from '../src/routes/internalCron';

const BACKEND_SRC = path.resolve(__dirname, '../src');
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(BACKEND_SRC, rel), 'utf8');
}

function mockRes() {
  const state: { statusCode: number; body: any } = { statusCode: 200, body: null };
  const res: any = {
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    json(payload: any) {
      state.body = payload;
      return res;
    },
    _state: state,
  };
  return res;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('handleJob ack-first 202 (free schedulers)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('responds 202 immediately with started payload while slow runner still pending', async () => {
    let completed = false;
    const slowRunner = async () => {
      await delay(400);
      completed = true;
      return { done: true };
    };
    const handler = handleJob('contests', slowRunner);
    const res = mockRes();
    const t0 = Date.now();
    await handler({} as any, res);
    const elapsed = Date.now() - t0;
    expect(res._state.statusCode).toBe(202);
    expect(res._state.body).toMatchObject({ ok: true, job: 'contests', status: 'started' });
    expect(typeof res._state.body.startedAt).toBe('string');
    // Ack must not wait for the 400ms runner.
    expect(elapsed).toBeLessThan(200);
    expect(completed).toBe(false);
    // Detached runner eventually completes (flush setImmediate + 400ms).
    await delay(600);
    expect(completed).toBe(true);
  });

  it('runs detached runner to completion and logs info (no result in HTTP body)', async () => {
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    let sideEffect = 0;
    const runner = async () => {
      await delay(50);
      sideEffect = 42;
      return { answer: 42 };
    };
    const handler = handleJob('cleanup', runner);
    const res = mockRes();
    await handler({} as any, res);
    expect(res._state.statusCode).toBe(202);
    expect(res._state.body).not.toHaveProperty('answer');
    expect(res._state.body).not.toHaveProperty('finishedAt');
    await delay(200);
    expect(sideEffect).toBe(42);
    expect(infoSpy).toHaveBeenCalled();
    const msg = String(infoSpy.mock.calls.map((c) => c[1] ?? c[0]).join(' '));
    expect(msg).toContain('completed (detached)');
  });

  it('logs detached errors but still acks 202 (no throw, no 500)', async () => {
    const errSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const failing = async () => {
      await delay(20);
      throw new Error('boom-detached');
    };
    const handler = handleJob('contests', failing);
    const res = mockRes();
    await expect(handler({} as any, res)).resolves.not.toThrow();
    expect(res._state.statusCode).toBe(202);
    expect(res._state.body).toMatchObject({ ok: true, status: 'started' });
    await delay(150);
    expect(errSpy).toHaveBeenCalled();
  });

  it('uses setImmediate to detach (static) and keeps 202 shape', () => {
    const src = readSrc('routes/internalCron.ts');
    expect(src).toContain('setImmediate');
    expect(src).toContain("status: 'started'");
    expect(src).toContain('status(202)');
    expect(src).toContain('job completed (detached)');
  });
});

describe('opportunities running-guard (like profileSyncInFlight)', () => {
  beforeEach(() => {
    __resetInternalCronForTests();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    __resetInternalCronForTests();
  });

  it('second overlapping run returns all-zero fast while first holds guard', async () => {
    const zero = {
      hackathonsFetched: 0,
      hackathonsSkipped: 0,
      internshipsFetched: 0,
      internshipsSkipped: 0,
      hackathonsEnriched: 0,
      internshipsEnriched: 0,
    };
    // First holds guard via slow isEnabled(false after 300ms) — no DB touched.
    const p1 = runOpportunitiesJob({
      isEnabled: async () => {
        await delay(300);
        return false;
      },
    });
    await delay(20);
    expect(__isOpportunitiesJobInFlightForTests()).toBe(true);
    const t0 = Date.now();
    const res2 = await runOpportunitiesJob({ isEnabled: async () => false });
    const elapsed = Date.now() - t0;
    expect(res2).toEqual(zero);
    expect(elapsed).toBeLessThan(150);
    const res1 = await p1;
    expect(res1).toEqual(zero);
    expect(__isOpportunitiesJobInFlightForTests()).toBe(false);
  });

  it('guard resets after first completes (serial runs both consult toggle)', async () => {
    const calls: string[] = [];
    const mk = (name: string, val: boolean) => async () => {
      calls.push(name);
      return val;
    };
    const r1 = await runOpportunitiesJob({ isEnabled: mk('first', false) });
    expect(r1.hackathonsFetched).toBe(0);
    expect(__isOpportunitiesJobInFlightForTests()).toBe(false);
    const r2 = await runOpportunitiesJob({ isEnabled: mk('second', false) });
    expect(r2.hackathonsFetched).toBe(0);
    expect(calls).toEqual(['first', 'second']);
  });

  it('guards intact (static): opportunities + profileSync + manual fetch untouched', () => {
    const cronSrc = readSrc('routes/internalCron.ts');
    expect(cronSrc).toContain('opportunitiesInFlight');
    expect(cronSrc).toContain('__resetInternalCronForTests');
    expect(cronSrc).toContain('already running');
    const engineSrc = readSrc('services/syncEngine.ts');
    expect(engineSrc).toContain('profileSyncInFlight');
    const fetchSrc = readSrc('routes/fetch.ts');
    expect(fetchSrc).not.toContain('handleJob');
    expect(fetchSrc).not.toContain("status: 'started'");
  });
});

describe('cron auth unchanged (401/503 synchronous, before 202)', () => {
  const OLD_CRON = process.env.CRON_SECRET;
  const OLD_AUTO = process.env.AUTO_FETCH_ENABLED;
  let app: express.Express;

  beforeEach(() => {
    __resetInternalCronForTests();
    app = express();
    app.use(express.json());
    app.use('/internal/cron', internalCronRouter);
  });

  afterEach(() => {
    __resetInternalCronForTests();
    if (OLD_CRON === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = OLD_CRON;
    if (OLD_AUTO === undefined) delete process.env.AUTO_FETCH_ENABLED;
    else process.env.AUTO_FETCH_ENABLED = OLD_AUTO;
  });

  it('503 when CRON_SECRET unset (fail-closed, no 202)', async () => {
    delete process.env.CRON_SECRET;
    const res = await request(app).post('/internal/cron/contests');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it('401 on wrong secret (synchronous, no detached run)', async () => {
    process.env.CRON_SECRET = 'correct-secret-value-for-tests-1234567890';
    const res = await request(app)
      .post('/internal/cron/opportunities')
      .set('x-cron-secret', 'wrong-secret');
    expect(res.status).toBe(401);
  });

  it('202 fast on correct secret (live contests route, toggle OFF keeps detached hermetic)', async () => {
    process.env.CRON_SECRET = 'correct-secret-value-for-tests-1234567890';
    process.env.AUTO_FETCH_ENABLED = 'false';
    const t0 = Date.now();
    const res = await request(app)
      .post('/internal/cron/contests')
      .set('x-cron-secret', 'correct-secret-value-for-tests-1234567890');
    const elapsed = Date.now() - t0;
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ ok: true, job: 'contests', status: 'started' });
    expect(typeof res.body.startedAt).toBe('string');
    expect(elapsed).toBeLessThan(2000);
  });

  it('202 fast on opportunities route with guard (toggle OFF, no DB)', async () => {
    process.env.CRON_SECRET = 'correct-secret-value-for-tests-1234567890';
    process.env.AUTO_FETCH_ENABLED = 'false';
    const res = await request(app)
      .post('/internal/cron/opportunities')
      .set('x-cron-secret', 'correct-secret-value-for-tests-1234567890');
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ ok: true, job: 'opportunities', status: 'started' });
    // Detached zero-run must release guard quickly.
    await delay(300);
    expect(__isOpportunitiesJobInFlightForTests()).toBe(false);
  });
});
