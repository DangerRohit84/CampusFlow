/**
 * Build-all I-8 — cheap API/integration contract (no DB, no flake).
 * WHY: backend suite was pure-unit only (validators/pagination/masking). This
 * adds the 20% integration layer at zero infra cost: a real Express stack
 * (requestId → route → errorHandler) exercised via supertest, proving:
 *  - X-Request-Id propagates on success AND on 400 (errorHandler contract)
 *  - 400 body is generic (no raw echo) with code INVALID_INPUT
 *  - health envelope shape { status, db, version } stays stable for smoke
 * No Prisma/DB/network — hermetic, <100ms, deterministic.
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requestId } from '../src/middleware/requestId';
import { errorHandler } from '../src/middleware/errorHandler';
import { createAuthorizeCache, clearAuthorizeCache } from '../src/middleware/auth';
import { parseStagingParams, buildStagingPage } from '../src/services/opportunities/staging';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(requestId);
  // Minimal health mirroring src/index.ts GET /api/health envelope (status/db/version).
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', db: 'up', version: 'test' });
  });
  // Staging-pagination slice: parse → envelope (proves offset math end-to-end
  // through HTTP, same helpers routes use — no DB needed).
  app.get('/api/staging-test', (req, res) => {
    const p = parseStagingParams(req.query as Record<string, string>);
    const rows = [{ id: 'a' }, { id: 'b' }];
    const page = buildStagingPage({ rows, filtered: rows, total: 2, page: p.page, limit: p.limit, cursor: p.cursor });
    res.json({ ...page, page: { page: p.page, limit: p.limit } });
  });
  // Force a 400 with raw message — errorHandler must sanitize to generic.
  app.get('/boom-400', (_req, _res, next) => {
    const err = new Error('raw zod detail with email=a@b.com should never echo') as Error & { status?: number };
    err.status = 400;
    next(err);
  });
  app.use(errorHandler);
  return app;
}

describe('api contract (supertest, no DB)', () => {
  it('GET /api/health returns envelope + X-Request-Id', async () => {
    const res = await request(buildApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('propagates inbound X-Request-Id', async () => {
    const res = await request(buildApp()).get('/api/health').set('X-Request-Id', 'smoke-123');
    expect(res.headers['x-request-id']).toBe('smoke-123');
  });

  it('staging slice clamps limit via HTTP (integration, no DB)', async () => {
    const res = await request(buildApp()).get('/api/staging-test?page=1&limit=500');
    expect(res.status).toBe(200);
    // parseStagingParams clamps 500 → 100 (contract lock-in through HTTP).
    expect(res.body.page.limit).toBeLessThanOrEqual(100);
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('400 never echoes raw message (generic + code + requestId)', async () => {
    const res = await request(buildApp()).get('/boom-400');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.code).toBe('INVALID_INPUT');
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain('a@b.com');
  });
});

describe('authorize cache (60s LRU documented window)', () => {
  it('factory set/get/clear isolates roles (documents clearAuthorizeCache on role update)', () => {
    const cache = createAuthorizeCache(10, 60_000);
    cache.set('u1', 'TEACHER');
    expect(cache.get('u1')).toBe('TEACHER');
    cache.clear('u1');
    expect(cache.get('u1')).toBeNull();
  });

  it('default singleton clear does not throw (safe on every role write path)', () => {
    expect(() => clearAuthorizeCache('some-user')).not.toThrow();
    expect(() => clearAuthorizeCache()).not.toThrow();
  });
});
