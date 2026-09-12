/**
 * Top-to-bottom backend audit regressions (`.ai/reports/topbottom-backend.md`).
 *
 * Covers the 15 runtime findings (F1–F14) left UNVERIFIED by prior sweeps
 * (enums/platform-casing/partial-fetch are proven elsewhere and untouched).
 * Hermetic: pure-unit + static source assertions + supertest with mocked DB
 * (no network, no live writes).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import express from 'express';
import request from 'supertest';

import { isPrismaNotFound, isPrismaFkViolation } from '../src/lib/prismaErrors';
import {
  isValidDayOfWeek,
  coerceDeadline,
  parsePreferencesSafe,
} from '../src/lib/validators';

// ---------- flexible DB stub (mutated per test) ----------
const dbStub: any = vi.hoisted(() => ({} as any));
vi.mock('../src/config/db', () => ({ __esModule: true, default: dbStub }));
vi.mock('../src/middleware/auth', () => ({
  __esModule: true,
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = 'u1';
    next();
  },
  authorize: () => (_req: any, _res: any, next: any) => next(),
}));
const socketMocks = vi.hoisted(() => ({
  broadcastTaskMutation: vi.fn(),
  broadcastScheduleMutation: vi.fn(),
  broadcastContestMutation: vi.fn(),
}));
vi.mock('../src/services/socket', () => ({ __esModule: true, ...socketMocks }));
const aiManagerMocks = vi.hoisted(() => ({
  getProviders: vi.fn(),
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
  toggleProvider: vi.fn(),
  testProvider: vi.fn(),
  getRouting: vi.fn(),
  updateRouting: vi.fn(),
}));
vi.mock('../src/services/ai-manager', () => ({ __esModule: true, ...aiManagerMocks }));

import tasksRouter from '../src/routes/tasks';
import notificationsRouter from '../src/routes/notifications';
import aiManagerRouter from '../src/routes/ai-manager';
import fetchRouter from '../src/routes/fetch';
import searchRouter from '../src/routes/search';
import contestsRouter from '../src/routes/contests';

function app(router: any, mount = '/'): any {
  const a = express();
  a.use(express.json());
  a.use(mount, router);
  return a;
}

function p2025(): any {
  return Object.assign(new Error('No record found for update.'), { code: 'P2025' });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(dbStub)) delete dbStub[k];
});

// ---------- F4 helper unit ----------
describe('isPrismaNotFound / isPrismaFkViolation', () => {
  it('flags P2025 only', () => {
    expect(isPrismaNotFound({ code: 'P2025' })).toBe(true);
    expect(isPrismaNotFound({ code: 'P2003' })).toBe(false);
    expect(isPrismaNotFound({ code: 'P2002' })).toBe(false);
    expect(isPrismaNotFound(new Error('x'))).toBe(false);
    expect(isPrismaNotFound(null)).toBe(false);
  });
  it('flags P2003 only', () => {
    expect(isPrismaFkViolation({ code: 'P2003' })).toBe(true);
    expect(isPrismaFkViolation({ code: 'P2025' })).toBe(false);
    expect(isPrismaFkViolation(undefined)).toBe(false);
  });
});

// ---------- F14 + date/parse unit ----------
describe('isValidDayOfWeek', () => {
  it('accepts Monday=0..Sunday=6 integers', () => {
    for (const d of [0, 1, 2, 3, 4, 5, 6]) expect(isValidDayOfWeek(d)).toBe(true);
  });
  it('rejects out-of-range / non-integers / non-numbers', () => {
    for (const d of [-1, 7, 99, 1.5, NaN, '1', null, undefined, {}, []]) {
      expect(isValidDayOfWeek(d)).toBe(false);
    }
  });
});

describe('coerceDeadline validity gate (F3)', () => {
  it('null on garbage, Date on valid', () => {
    expect(coerceDeadline('garbage')).toBeNull();
    expect(coerceDeadline('')).toBeNull();
    expect(coerceDeadline('2026-09-11')).toBeInstanceOf(Date);
  });
});

describe('parsePreferencesSafe fallback (F9)', () => {
  it('degrades corrupt strings to {}', () => {
    expect(parsePreferencesSafe('{corrupt')).toEqual({});
    expect(parsePreferencesSafe(undefined)).toEqual({});
    expect(parsePreferencesSafe({ a: 1 })).toEqual({ a: 1 });
  });
});

// ---------- F4 behavioral: P2025 → 404 ----------
describe('scoped mutations map P2025 to 404 (F4)', () => {
  it('DELETE /tasks/:id missing → 404 (was 500)', async () => {
    dbStub.task = { delete: vi.fn(async () => { throw p2025(); }) };
    const res = await request(app(tasksRouter)).delete('/abc');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
  it('PUT /notifications/:id/read missing → 404 (was 500)', async () => {
    dbStub.notification = { update: vi.fn(async () => { throw p2025(); }) };
    const res = await request(app(notificationsRouter)).put('/abc/read');
    expect(res.status).toBe(404);
  });
  it('DELETE /notifications/:id missing → 404 (was 500)', async () => {
    dbStub.notification = { delete: vi.fn(async () => { throw p2025(); }) };
    const res = await request(app(notificationsRouter)).delete('/abc');
    expect(res.status).toBe(404);
  });
});

// ---------- F3 behavioral: invalid dates → 400 ----------
describe('task date validity (F3)', () => {
  it('POST /tasks garbage date → 400 (was 500)', async () => {
    const res = await request(app(tasksRouter))
      .post('/')
      .send({ title: 't', date: 'not-a-date' });
    expect(res.status).toBe(400);
  });
  it('PUT /tasks/:id garbage date → 400 (was 500)', async () => {
    dbStub.task = { update: vi.fn(async () => ({ id: 'x' })) };
    const res = await request(app(tasksRouter)).put('/x').send({ date: 'garbage' });
    expect(res.status).toBe(400);
  });
  it('POST /tasks/ai-schedule non-array tasks → 400 (was TypeError 500)', async () => {
    const res = await request(app(tasksRouter))
      .post('/ai-schedule')
      .send({ tasks: 'do stuff', date: '2026-09-11' });
    expect(res.status).toBe(400);
  });
  it('POST /tasks/ai-schedule bad date → 400 (was 500)', async () => {
    const res = await request(app(tasksRouter))
      .post('/ai-schedule')
      .send({ tasks: ['a'], date: 'garbage' });
    expect(res.status).toBe(400);
  });
});

// ---------- F2 behavioral: ai-manager never hangs ----------
describe('ai-manager error mapping (F2)', () => {
  it('POST /providers/:id/test unknown provider → 404 (was unhandled)', async () => {
    aiManagerMocks.testProvider.mockRejectedValue(new Error('Provider not found'));
    const res = await request(app(aiManagerRouter)).post('/providers/abc/test');
    expect(res.status).toBe(404);
  });
  it('DELETE /providers/:id built-in → 400 (was unhandled)', async () => {
    aiManagerMocks.deleteProvider.mockRejectedValue(new Error('Cannot delete built-in provider'));
    const res = await request(app(aiManagerRouter)).delete('/providers/abc');
    expect(res.status).toBe(400);
  });
  it('GET /providers DB failure → 500 JSON (was unhandled)', async () => {
    aiManagerMocks.getProviders.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const res = await request(app(aiManagerRouter)).get('/providers');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
  });
});

// ---------- F10 behavioral ----------
describe('fetch unknown platform (F10)', () => {
  it('POST /fetch/:platform ghost → 400 (was 500)', async () => {
    const res = await request(app(fetchRouter)).post('/nope-not-a-platform').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown platform/i);
  });
});

// ---------- F12 behavioral: search isolation + joinCode strip ----------
describe('search resilience + room privacy (F12)', () => {
  it('strips joinCode for non-member rooms and never leaks it', async () => {
    dbStub.user = { findUnique: vi.fn(async () => ({ collegeId: null, role: 'STUDENT' })) };
    const empty = vi.fn(async () => []);
    dbStub.schedule = { findMany: empty };
    dbStub.assignment = { findMany: empty };
    dbStub.assignmentHub = { findMany: empty };
    dbStub.notification = { findMany: empty };
    dbStub.hackathon = { findMany: empty };
    dbStub.internship = { findMany: empty };
    dbStub.form = { findMany: empty };
    dbStub.codingContest = { findMany: empty };
    dbStub.task = { findMany: empty };
    dbStub.room = {
      findMany: vi.fn(async () => [
        { id: 'r1', name: 'Algebra Club', description: '', joinCode: 'SECRET-1', teacherId: 't9' },
      ]),
    };
    dbStub.roomMember = { findMany: vi.fn(async () => []) };
    const res = await request(app(searchRouter)).get('/?q=algebra');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('SECRET-1');
    const roomHit = (res.body.results as any[]).find((r: any) => r.type === 'room');
    expect(roomHit).toBeTruthy();
    expect(roomHit.subtitle).not.toContain('SECRET-1');
  });
});

// ---------- F1 behavioral: contest PUT applies validated fields ----------
describe('contest PUT applies sanitizedData (F1)', () => {
  it('PUT /contests/:id forwards title (was silently dropped)', async () => {
    dbStub.user = {
      findUnique: vi.fn(async () => ({ id: 'u1', role: 'TEACHER', collegeId: 'c1' })),
    };
    dbStub.codingContest = {
      findUnique: vi.fn(async () => ({
        id: 'ct1',
        creatorId: 'u1',
        collegeId: 'c1',
        startTime: '2026-01-01T00:00:00.000Z',
        duration: 120,
      })),
      update: vi.fn(async (args: any) => ({ id: 'ct1', ...args.data })),
    };
    const res = await request(app(contestsRouter)).put('/ct1').send({ title: 'New Title' });
    expect(res.status).toBe(200);
    const updateArg = (dbStub.codingContest.update as any).mock.calls[0][0];
    expect(updateArg.data.title).toBe('New Title');
    expect('solutions' in updateArg.data).toBe(false);
  });
});

// ---------- static wiring assertions (fail if a fix regresses) ----------
const SRC = path.resolve(__dirname, '../src');
function src(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

describe('static wiring (topbottom F1–F14)', () => {
  it('F1: contests PUT writes sanitizedData', () => {
    const s = src('routes/contests.ts');
    expect(s).toContain('data: sanitizedData');
    expect(s).not.toMatch(/sanitizedData[\s\S]{0,200}data: \{ solutions: solutions as any \}/);
  });
  it('F2: ai-manager maps provider errors', () => {
    const s = src('routes/ai-manager.ts');
    expect(s).toContain('mapProviderError');
    expect((s.match(/\btry\s*\{/g) || []).length).toBeGreaterThanOrEqual(10);
  });
  it('F3/F4: tasks validates dates + maps P2025', () => {
    const s = src('routes/tasks.ts');
    expect(s).toContain('isPrismaNotFound');
    expect(s).toContain('Invalid date. Must be a parseable date string');
  });
  it('F4: schedules/assignments/notifications map P2025', () => {
    for (const f of ['routes/schedules.ts', 'routes/assignments.ts', 'routes/notifications.ts']) {
      expect(src(f)).toContain('isPrismaNotFound');
    }
  });
  it('F4 helper exists and is pure', () => {
    expect(src('lib/prismaErrors.ts')).toContain("code === 'P2025'");
  });
  it('F5: ai check-conflicts validates params', () => {
    expect(src('routes/ai.ts')).toContain('dayOfWeek must be an integer 0-6');
  });
  it('F6: chat isolates AI failure with 502 + userMessage', () => {
    const s = src('routes/chat.ts');
    expect(s).toContain('502');
    expect(s).toContain('userMessage, error');
    expect(s).toContain('CGPA:n/a');
  });
  it('F7: hackathons/internships create validates required fields', () => {
    expect(src('routes/hackathons.ts')).toContain('Title is required');
    expect(src('routes/internships.ts')).toContain('Missing required fields');
  });
  it('F8/F9: user profile strips unknown scalars + safe prefs', () => {
    const s = src('routes/user.ts');
    expect(s).toContain('parsePreferencesSafe');
    expect(s).not.toMatch(/\.\.\.\(department && \{ department/);
  });
  it('F10: fetch validates platform key', () => {
    expect(src('routes/fetch.ts')).toContain('Unknown platform');
  });
  it('F11: resume alias has no own limiter (single pass)', () => {
    const s = src('routes/resume.ts');
    expect(s).toContain("router.post('/ai-enhance', async");
  });
  it('F12: search isolates all branches + strips joinCode', () => {
    const s = src('routes/search.ts');
    expect(s).toContain('safeRooms');
    expect(s).toContain('joinCode: undefined');
  });
  it('F13: tasks ai-schedule validates array input', () => {
    expect(src('routes/tasks.ts')).toContain('Tasks must be a non-empty array');
  });
  it('F14: timetable save guards dayOfWeek', () => {
    expect(src('routes/timetable.ts')).toContain('isValidDayOfWeek');
    expect(src('lib/validators.ts')).toContain('isValidDayOfWeek');
  });
});
