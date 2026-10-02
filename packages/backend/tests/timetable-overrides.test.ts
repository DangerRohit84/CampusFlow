/**
 * Timetable editable Period Grid — temporary range+time overrides (Approach A).
 * TDD RED: this file must FAIL before implementation exists.
 *
 * Covers (user-approved):
 * - merge template+overrides over a date range
 * - CANCELLED removes template on date, Revert (delete override) restores
 * - ADDED_TEMP only affects its range (Oct 6-11 style) with start/end times
 * - save clearExisting only clears templates, preserves overrides
 * - clash warnings (time overlap + room soft clash)
 * - validation start<end (400)
 * - owner-only isolation
 * - GET no date returns templates (preserve current behaviour)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ---------- flexible DB stub (mutated per test) ----------
const dbStub: any = vi.hoisted(() => ({} as any));
vi.mock('../src/config/db', () => ({ __esModule: true, default: dbStub }));
vi.mock('../src/middleware/auth', () => ({
  __esModule: true,
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = (req as any).__testUserId || 'u1';
    next();
  },
  authorize: () => (_req: any, _res: any, next: any) => next(),
}));
const socketMocks = vi.hoisted(() => ({ broadcastScheduleMutation: vi.fn() }));
vi.mock('../src/services/socket', () => ({ __esModule: true, ...socketMocks }));

// Pure merge lib (does NOT exist yet — RED)
import {
  mergeTimetableForDate,
  mergeTimetableForRange,
  findClashes,
  validateOverrideInput,
  isDateInRange,
} from '../src/lib/timetableMerge';

import schedulesRouter from '../src/routes/schedules';
import timetableRouter from '../src/routes/timetable';

function app(router: any, mount = '/'): any {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res: any, next: any) => {
    req.__testUserId = req.headers['x-test-user'] || 'u1';
    next();
  });
  a.use(mount, router);
  return a;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(dbStub)) delete dbStub[k];
});

const templateMon = {
  id: 's-mon',
  userId: 'u1',
  title: 'Data Structures',
  course: 'CS201',
  location: 'Room 301',
  teacher: 'Sharma',
  dayOfWeek: 0, // Monday
  startTime: '09:00',
  endTime: '10:00',
  startMinutes: 540,
  endMinutes: 600,
  type: 'CLASS',
  color: '#5c7cfa',
  recurring: true,
};

describe('timetableMerge pure logic', () => {
  it('merge template+overrides over range: EDITED replaces time/room on matching dates only', () => {
    const edited = {
      id: 'o1',
      userId: 'u1',
      baseScheduleId: 's-mon',
      kind: 'EDITED',
      title: 'Data Structures (Hall B)',
      location: 'Hall B',
      startTime: '10:00',
      endTime: '11:00',
      startMinutes: 600,
      endMinutes: 660,
      validFrom: new Date('2026-10-05T00:00:00.000Z'),
      validUntil: new Date('2026-10-11T00:00:00.000Z'),
    };
    // 2026-10-05 is Monday, 2026-10-06 is Tuesday
    const mon = mergeTimetableForDate([templateMon], [edited], '2026-10-05');
    expect(mon).toHaveLength(1);
    expect((mon[0] as any)._overrideKind).toBe('EDITED');
    expect(mon[0].startTime).toBe('10:00');
    expect(mon[0].location).toBe('Hall B');

    // Tuesday has no Monday template → empty (override must not leak)
    const tue = mergeTimetableForDate([templateMon], [edited], '2026-10-06');
    expect(tue).toHaveLength(0);
  });

  it('CANCELLED removes template on date; range merge marks cancelled struck-through', () => {
    const cancelled = {
      id: 'o-cancel',
      userId: 'u1',
      baseScheduleId: 's-mon',
      kind: 'CANCELLED',
      validFrom: new Date('2026-10-05T00:00:00.000Z'),
      validUntil: new Date('2026-10-05T00:00:00.000Z'),
    };
    const merged = mergeTimetableForRange([templateMon], [cancelled], '2026-10-05', '2026-10-12');
    const oct5 = merged.filter((e: any) => e.date === '2026-10-05');
    // Cancelled entries stay visible struck-through with flag (UI Revert)
    expect(oct5).toHaveLength(1);
    expect((oct5[0] as any)._overrideKind).toBe('CANCELLED');
    expect((oct5[0] as any)._cancelled).toBe(true);
    // Next Monday (2026-10-12) unaffected
    const oct12 = merged.filter((e: any) => e.date === '2026-10-12');
    expect(oct12).toHaveLength(1);
    expect((oct12[0] as any)._overrideKind).toBeUndefined();
  });

  it('ADDED_TEMP Oct 6-11 with start/end times only affects range (daily)', () => {
    const temp = {
      id: 'o-temp',
      userId: 'u1',
      baseScheduleId: null,
      kind: 'ADDED_TEMP',
      title: 'Fest Rehearsal',
      location: 'Hall A',
      dayOfWeek: null, // daily in range
      startTime: '14:00',
      endTime: '15:30',
      startMinutes: 840,
      endMinutes: 930,
      validFrom: new Date('2026-10-06T00:00:00.000Z'),
      validUntil: new Date('2026-10-11T00:00:00.000Z'),
    };
    const inside = mergeTimetableForDate([], [temp], '2026-10-08');
    expect(inside).toHaveLength(1);
    expect(inside[0].title).toBe('Fest Rehearsal');
    expect(inside[0].startTime).toBe('14:00');
    expect((inside[0] as any)._overrideKind).toBe('TEMP');

    const before = mergeTimetableForDate([], [temp], '2026-10-05');
    expect(before).toHaveLength(0);
    const after = mergeTimetableForDate([], [temp], '2026-10-12');
    expect(after).toHaveLength(0);
  });

  it('isDateInRange is inclusive on both ends (date-only)', () => {
    expect(
      isDateInRange('2026-10-06', new Date('2026-10-06T00:00:00.000Z'), new Date('2026-10-11T00:00:00.000Z'))
    ).toBe(true);
    expect(
      isDateInRange('2026-10-11', new Date('2026-10-06T00:00:00.000Z'), new Date('2026-10-11T00:00:00.000Z'))
    ).toBe(true);
    expect(
      isDateInRange('2026-10-12', new Date('2026-10-06T00:00:00.000Z'), new Date('2026-10-11T00:00:00.000Z'))
    ).toBe(false);
  });

  it('clash warnings: time overlap + same-room soft clash', () => {
    const entries = [
      { id: 'a', title: 'Math', startTime: '09:00', endTime: '10:00', startMinutes: 540, endMinutes: 600, location: 'Room 301' },
      { id: 'b', title: 'Physics', startTime: '09:30', endTime: '10:30', startMinutes: 570, endMinutes: 630, location: 'Room 302' },
      { id: 'c', title: 'Chem', startTime: '11:00', endTime: '12:00', startMinutes: 660, endMinutes: 720, location: 'Room 301' },
    ];
    const warnings = findClashes(entries as any);
    expect(warnings.length).toBeGreaterThan(0);
    const overlap = warnings.find((w: any) => w.type === 'overlap');
    expect(overlap).toBeTruthy();
    expect(overlap.entryIds).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('room soft clash: same room overlapping times flagged separately', () => {
    const entries = [
      { id: 'a', title: 'Math', startTime: '09:00', endTime: '10:00', startMinutes: 540, endMinutes: 600, location: 'Room 301' },
      { id: 'b', title: 'Physics', startTime: '09:30', endTime: '10:30', startMinutes: 570, endMinutes: 630, location: 'Room 301' },
    ];
    const warnings = findClashes(entries as any);
    const room = warnings.find((w: any) => w.type === 'room');
    expect(room).toBeTruthy();
  });

  it('validateOverrideInput rejects start>=end and bad range', () => {
    expect(
      validateOverrideInput({ kind: 'ADDED_TEMP', validFrom: '2026-10-06', validUntil: '2026-10-11', startTime: '11:00', endTime: '10:00', title: 'X' })
    ).toMatch(/start/i);
    expect(
      validateOverrideInput({ kind: 'ADDED_TEMP', validFrom: '2026-10-12', validUntil: '2026-10-11', startTime: '09:00', endTime: '10:00', title: 'X' })
    ).toMatch(/range|valid/i);
    expect(
      validateOverrideInput({ kind: 'EDITED', validFrom: '2026-10-06', validUntil: '2026-10-11', startTime: '09:00', endTime: '10:00' })
    ).toMatch(/baseScheduleId/i);
    expect(
      validateOverrideInput({ kind: 'ADDED_TEMP', validFrom: '2026-10-06', validUntil: '2026-10-11', startTime: '09:00', endTime: '10:00', title: 'Fest' })
    ).toBeNull();
  });
});

describe('timetable API merged views', () => {
  it('GET /timetable no date returns templates (preserve current)', async () => {
    dbStub.schedule = { findMany: vi.fn().mockResolvedValue([templateMon]) };
    // pre-migration safe: scheduleOverride may be absent
    (dbStub as any).scheduleOverride = { findMany: vi.fn().mockResolvedValue([]) };
    const res = await request(app(timetableRouter, '/timetable')).get('/timetable');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(dbStub.schedule.findMany).toHaveBeenCalled();
  });

  it('GET /timetable?date= returns merged (CANCELLED flagged, EDITED applied)', async () => {
    dbStub.schedule = { findMany: vi.fn().mockResolvedValue([templateMon]) };
    (dbStub as any).scheduleOverride = {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'o1',
          userId: 'u1',
          baseScheduleId: 's-mon',
          kind: 'EDITED',
          title: 'DS Hall B',
          location: 'Hall B',
          startTime: '10:00',
          endTime: '11:00',
          startMinutes: 600,
          endMinutes: 660,
          validFrom: new Date('2026-10-05T00:00:00.000Z'),
          validUntil: new Date('2026-10-05T00:00:00.000Z'),
        },
      ]),
    };
    const res = await request(app(timetableRouter, '/timetable')).get('/timetable?date=2026-10-05');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].location).toBe('Hall B');
  });

  it('GET /timetable?from=&to= returns dated entries across range', async () => {
    dbStub.schedule = { findMany: vi.fn().mockResolvedValue([templateMon]) };
    (dbStub as any).scheduleOverride = {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'o-temp',
          userId: 'u1',
          baseScheduleId: null,
          kind: 'ADDED_TEMP',
          title: 'Fest',
          location: 'Hall A',
          dayOfWeek: null,
          startTime: '14:00',
          endTime: '15:30',
          startMinutes: 840,
          endMinutes: 930,
          validFrom: new Date('2026-10-06T00:00:00.000Z'),
          validUntil: new Date('2026-10-07T00:00:00.000Z'),
        },
      ]),
    };
    const res = await request(app(timetableRouter, '/timetable')).get('/timetable?from=2026-10-05&to=2026-10-07');
    expect(res.status).toBe(200);
    const dates = new Set((res.body as any[]).map((e) => e.date));
    expect(dates.has('2026-10-05')).toBe(true); // template Monday
    expect(dates.has('2026-10-06')).toBe(true); // temp daily
    expect(dates.has('2026-10-07')).toBe(true);
  });

  it('POST /timetable/save clearExisting only clears templates, preserves overrides', async () => {
    const delMany = vi.fn().mockResolvedValue({ count: 1 });
    const create = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'n1', ...data }));
    dbStub.schedule = { deleteMany: delMany, create };
    const res = await request(app(timetableRouter, '/timetable'))
      .post('/timetable/save')
      .send({ classes: [{ title: 'Math', dayOfWeek: 0, startTime: '09:00', endTime: '10:00' }], clearExisting: true });
    expect(res.status).toBe(200);
    expect(delMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    // overrides must NOT be deleted unless clearOverrides=true
    expect((dbStub as any).scheduleOverride?.deleteMany).toBeUndefined();
  });

  it('POST /timetable/save clearOverrides=true also clears overrides', async () => {
    dbStub.schedule = { deleteMany: vi.fn().mockResolvedValue({ count: 1 }), create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'n1', ...data })) };
    (dbStub as any).scheduleOverride = { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) };
    const res = await request(app(timetableRouter, '/timetable'))
      .post('/timetable/save')
      .send({ classes: [{ title: 'Math', dayOfWeek: 0, startTime: '09:00', endTime: '10:00' }], clearExisting: true, clearOverrides: true });
    expect(res.status).toBe(200);
    expect((dbStub as any).scheduleOverride.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  it('upload keeps automatically recursing every week: save creates recurring dayOfWeek templates (no date)', async () => {
    const create = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'n1', ...data }));
    dbStub.schedule = { deleteMany: vi.fn().mockResolvedValue({ count: 1 }), create };
    delete (dbStub as any).scheduleOverride;
    const res = await request(app(timetableRouter, '/timetable'))
      .post('/timetable/save')
      .send({ classes: [{ title: 'Physics', course: 'PH101', location: 'Room 5', dayOfWeek: 2, startTime: '11:00', endTime: '12:00', type: 'CLASS' }], clearExisting: true });
    expect(res.status).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    // Weekly template contract: dayOfWeek 0-6 + recurring=true, no dated fields
    expect(data.dayOfWeek).toBe(2);
    expect(data.recurring).toBe(true);
    expect(data.validFrom).toBeUndefined();
    expect(data.validUntil).toBeUndefined();
    expect(data.title).toBe('Physics');
  });
});

describe('schedule override CRUD (owner-only)', () => {
  it('POST /schedules/overrides creates ADDED_TEMP with validation + clash warnings', async () => {
    dbStub.schedule = { findMany: vi.fn().mockResolvedValue([]) };
    (dbStub as any).scheduleOverride = {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'o-new', ...data })),
    };
    const res = await request(app(schedulesRouter, '/schedules'))
      .post('/schedules/overrides')
      .send({ kind: 'ADDED_TEMP', title: 'Fest', validFrom: '2026-10-06', validUntil: '2026-10-11', startTime: '14:00', endTime: '15:30', location: 'Hall A' });
    expect(res.status).toBe(201);
    expect(res.body.override.title).toBe('Fest');
    expect(Array.isArray(res.body.warnings)).toBe(true);
  });

  it('POST /schedules/overrides rejects start>=end with 400', async () => {
    const res = await request(app(schedulesRouter, '/schedules'))
      .post('/schedules/overrides')
      .send({ kind: 'ADDED_TEMP', title: 'Bad', validFrom: '2026-10-06', validUntil: '2026-10-11', startTime: '15:30', endTime: '14:00' });
    expect(res.status).toBe(400);
  });

  it('POST /schedules/overrides EDITED requires ownership of base schedule', async () => {
    dbStub.schedule = { findFirst: vi.fn().mockResolvedValue(null) };
    (dbStub as any).scheduleOverride = { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() };
    const res = await request(app(schedulesRouter, '/schedules'))
      .post('/schedules/overrides')
      .send({ kind: 'EDITED', baseScheduleId: 'other-user-schedule', validFrom: '2026-10-06', validUntil: '2026-10-11', startTime: '10:00', endTime: '11:00' });
    expect(res.status).toBe(404);
  });

  it('DELETE /schedules/overrides/:id reverts (owner-only)', async () => {
    (dbStub as any).scheduleOverride = {
      delete: vi.fn().mockResolvedValue({ id: 'o1', userId: 'u1' }),
    };
    const res = await request(app(schedulesRouter, '/schedules')).delete('/schedules/overrides/o1');
    expect(res.status).toBe(200);
    expect((dbStub as any).scheduleOverride.delete).toHaveBeenCalledWith({ where: { id: 'o1', userId: 'u1' } });
  });
});
