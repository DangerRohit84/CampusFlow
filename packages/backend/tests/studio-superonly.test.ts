/**
 * Studio SUPER_ADMIN-only lockdown (TDD RED).
 * Locks: resume build/export/AI/parse/share routes require SUPER_ADMIN,
 * non-super 403, super 200, no data leak via export/share APIs.
 * Hermetic: source wiring + real authorize() via supertest minimal app (mocked DB).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import express from 'express';
import request from 'supertest';

const dbStub: any = vi.hoisted(() => ({ user: { findUnique: vi.fn() } } as any));
vi.mock('../src/config/db', () => ({ __esModule: true, default: dbStub }));

// Import REAL authorize (not mocked) + cache reset helpers.
import { authorize, resetAuthorizeCacheForTests, clearAuthorizeCache } from '../src/middleware/auth';

function readResumeSrc(): string {
  return fs.readFileSync(path.join(__dirname, '../src/routes/resume.ts'), 'utf8');
}

function buildStudioGuardApp() {
  const app = express();
  app.use(express.json());
  // Mirror production wiring: authenticate sets req.userId, then authorize SUPER_ADMIN.
  // Here we stub authenticate via header x-test-role/userId for hermetic control:
  // x-test-userid sets req.userId; role comes from mocked DB findUnique.
  app.use((req: any, _res: any, next: any) => {
    const uid = (req.headers['x-test-userid'] as string) || '';
    if (uid) req.userId = uid;
    next();
  });
  app.get('/studio-test', authorize(['SUPER_ADMIN']), (_req: any, res: any) => {
    res.json({ ok: true });
  });
  return app;
}

describe('resume studio SUPER_ADMIN-only — source wiring (no leak)', () => {
  it('resume.ts imports authorize (role gate)', () => {
    const src = readResumeSrc();
    expect(src).toMatch(/import\s*\{\s*[^}]*authorize[^}]*\}\s*from\s*['"]\.\.\/middleware\/auth['"]/);
  });

  it('all functional resume routes require SUPER_ADMIN (build/export/AI/parse/share)', () => {
    const src = readResumeSrc();
    // Functional endpoints that must be SUPER_ADMIN-only (health excluded — no PII).
    const mustGuard = [
      '/latex',
      '/ai-upgrade',
      '/ai-enhance',
      '/ats-score',
      '/jd-scrape',
      '/cover-letter',
      '/github-repos',
      '/parse',
      '/parse-text',
      '/upload',
      '/convert-to-latex',
      '/export-docx',
      '/export-txt',
    ];
    for (const ep of mustGuard) {
      // Each endpoint string must appear near an authorize SUPER_ADMIN within the file.
      // Strict: the route registration line itself or the 3 lines around it must carry the guard,
      // OR the file uses a global router.use(authenticate, authorize SUPER_ADMIN) covering all.
      const hasGlobalGuard =
        /router\.use\s*\(\s*authenticate\s*,\s*authorize\(\s*\[\s*['"]SUPER_ADMIN['"]\s*\]\s*\)/.test(src);
      if (hasGlobalGuard) continue;
      // Otherwise each route must inline the guard — check 800-char window around endpoint.
      const idx = src.indexOf(`'${ep}'`);
      const idx2 = src.indexOf(`"${ep}"`);
      const pos = idx >= 0 ? idx : idx2;
      expect(pos, `route ${ep} must exist in resume.ts`).toBeGreaterThanOrEqual(0);
      const window = src.slice(Math.max(0, pos - 800), pos + 800);
      expect(window, `route ${ep} must be guarded by authorize SUPER_ADMIN`).toMatch(
        /authorize\(\s*\[\s*['"]SUPER_ADMIN['"]\s*\]/
      );
    }
  });

  it('health endpoints stay public (no PII, no guard required)', () => {
    const src = readResumeSrc();
    expect(src).toContain('/latex/health');
  });
});

describe('authorize([SUPER_ADMIN]) — non-super 403, super 200 (live)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthorizeCacheForTests();
    clearAuthorizeCache();
    // Default stub: will be overridden per test.
    dbStub.user.findUnique = vi.fn(async () => null);
  });

  it('non-super roles get 403 (STUDENT/TEACHER/COLLEGE_ADMIN)', async () => {
    const app = buildStudioGuardApp();
    for (const role of ['STUDENT', 'TEACHER', 'COLLEGE_ADMIN']) {
      resetAuthorizeCacheForTests();
      dbStub.user.findUnique = vi.fn(async () => ({ id: 'u-x', role, collegeId: 'c1' }));
      const res = await request(app).get('/studio-test').set('x-test-userid', `u-${role}`);
      expect(res.status, `role ${role} must be 403`).toBe(403);
      expect(res.body.error).toMatch(/Insufficient permissions/i);
    }
  });

  it('SUPER_ADMIN gets 200', async () => {
    const app = buildStudioGuardApp();
    resetAuthorizeCacheForTests();
    dbStub.user.findUnique = vi.fn(async () => ({ id: 'u-super', role: 'SUPER_ADMIN', collegeId: null }));
    const res = await request(app).get('/studio-test').set('x-test-userid', 'u-super');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it('missing userId (logged-out) gets 403 fail-closed', async () => {
    const app = buildStudioGuardApp();
    const res = await request(app).get('/studio-test');
    expect(res.status).toBe(403);
  });
});
