/**
 * #6 contest alarms — reminder CRUD validation, GCal URL builder, scoping.
 * Hermetic: pure fns + injected fakes only (no Neon, no socket).
 */
import { describe, it, expect } from 'vitest';
import {
  ALLOWED_REMINDER_MINUTES,
  parseMinutesBefore,
  computeRemindAt,
  buildGoogleCalendarUrl,
  canUserSeeContest,
  validateReminderRequest,
  isReminderDue,
  filterDueReminders,
  buildReminderNotification,
  runContestRemindersJob,
  toGCalStamp,
} from '../src/services/contestReminderService';

const contest = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  title: 'Weekly Contest 519',
  platform: 'LEETCODE',
  url: 'https://leetcode.com/contest/weekly-contest-519/',
  startTime: '2026-09-12T15:30:00.000Z',
  duration: 90,
  collegeId: null,
  creatorId: null,
  ...over,
});

describe('reminder CRUD validation', () => {
  it('allows exactly 15|60|1440', () => {
    expect(ALLOWED_REMINDER_MINUTES).toEqual([15, 60, 1440]);
    for (const m of [15, 60, 1440]) expect(parseMinutesBefore(m)).toBe(m);
  });

  it('rejects other leads (0, 5, 30, 120, strings, null)', () => {
    for (const bad of [0, 5, 30, 120, 1441, '30', '', null, undefined, {}, NaN, 15.5]) {
      expect(parseMinutesBefore(bad as any), JSON.stringify(bad)).toBeNull();
    }
  });

  it('accepts numeric strings only when they are allowed leads', () => {
    // Route body may arrive as string via form posts — "60" is tolerable.
    expect(parseMinutesBefore('60' as any)).toBe(60);
    expect(parseMinutesBefore('30' as any)).toBeNull();
  });

  it('computeRemindAt subtracts lead from start', () => {
    const at = computeRemindAt('2026-09-12T15:30:00.000Z', 60);
    expect(at.toISOString()).toBe('2026-09-12T14:30:00.000Z');
    expect(computeRemindAt('2026-09-12T15:30:00.000Z', 1440).toISOString()).toBe(
      '2026-09-11T15:30:00.000Z',
    );
  });

  it('computeRemindAt throws on invalid startTime (route maps to 400)', () => {
    expect(() => computeRemindAt('not-a-date', 15)).toThrow();
  });

  it('validateReminderRequest 400s when lead already passed', () => {
    const now = new Date('2026-09-12T15:25:00.000Z');
    const res = validateReminderRequest(15, contest(), now) as { error: string; status: number };
    expect(res.status).toBe(400);
    expect(res.error).toMatch(/already passed/i);
  });

  it('validateReminderRequest 400s unknown lead, 404s missing contest', () => {
    expect((validateReminderRequest(30, contest()) as any).status).toBe(400);
    expect((validateReminderRequest(60, null) as any).status).toBe(404);
  });

  it('validateReminderRequest ok carries remindAt + minutes', () => {
    const now = new Date('2026-09-10T00:00:00.000Z');
    const res = validateReminderRequest(60, contest(), now) as { remindAt: Date; minutesBefore: number };
    expect(res.minutesBefore).toBe(60);
    expect(res.remindAt.toISOString()).toBe('2026-09-12T14:30:00.000Z');
  });
});

describe('GCal URL builder (zero-backend template)', () => {
  it('builds action=TEMPLATE with text/dates/details', () => {
    const url = buildGoogleCalendarUrl(contest());
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(u.searchParams.get('action')).toBe('TEMPLATE');
    expect(u.searchParams.get('text')).toBe('Weekly Contest 519');
    // 90 min duration → 15:30Z–17:00Z
    expect(u.searchParams.get('dates')).toBe('20260912T153000Z/20260912T170000Z');
    expect(u.searchParams.get('details')).toContain('LEETCODE');
    expect(u.searchParams.get('details')).toContain('https://leetcode.com/contest/weekly-contest-519/');
    expect(u.searchParams.get('location')).toBe('https://leetcode.com/contest/weekly-contest-519/');
  });

  it('defaults missing duration to 180m (matches computeStatus fallback)', () => {
    const url = buildGoogleCalendarUrl(contest({ duration: null }));
    expect(new URL(url).searchParams.get('dates')).toBe('20260912T153000Z/20260912T183000Z');
  });

  it('clamps absurd durations and throws on bad start', () => {
    const url = buildGoogleCalendarUrl(contest({ duration: 10_000_000 }));
    const [, end] = new URL(url).searchParams.get('dates')!.split('/');
    // clamped to 14 days → 2026-09-26T15:30Z
    expect(end).toBe('20260926T153000Z');
    expect(() => buildGoogleCalendarUrl(contest({ startTime: 'junk' }))).toThrow();
  });

  it('toGCalStamp is UTC zero-padded (no dashes/colons)', () => {
    expect(toGCalStamp(new Date('2026-01-05T03:04:05.000Z'))).toBe('20260105T030405Z');
  });
});

describe('college scoping (mirrors GET /contests OR logic)', () => {
  const global = contest({ collegeId: null });
  const scoped = contest({ collegeId: 'colA', creatorId: 'teacher1' });

  it('SUPER_ADMIN sees everything', () => {
    const su = { id: 'su', role: 'SUPER_ADMIN', collegeId: null };
    expect(canUserSeeContest(su, global)).toBe(true);
    expect(canUserSeeContest(su, scoped)).toBe(true);
  });

  it('same-college sees global + own college; other college denied', () => {
    const studentA = { id: 's1', role: 'STUDENT', collegeId: 'colA' };
    const studentB = { id: 's2', role: 'STUDENT', collegeId: 'colB' };
    expect(canUserSeeContest(studentA, global)).toBe(true);
    expect(canUserSeeContest(studentA, scoped)).toBe(true);
    expect(canUserSeeContest(studentB, global)).toBe(true);
    expect(canUserSeeContest(studentB, scoped)).toBe(false);
  });

  it('creator sees own row even without college', () => {
    const t = { id: 'teacher1', role: 'TEACHER', collegeId: null };
    expect(canUserSeeContest(t, scoped)).toBe(true);
    expect(canUserSeeContest({ id: 'other', role: 'TEACHER', collegeId: null }, scoped)).toBe(false);
  });
});

describe('due filtering + job fan-out', () => {
  const now = new Date('2026-09-12T14:00:00.000Z');
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    userId: 'u1',
    contestId: 'c1',
    minutesBefore: 60,
    remindAt: new Date('2026-09-12T13:59:00.000Z'),
    sent: false,
    contest: contest(),
    ...over,
  });

  it('isReminderDue: unsent+past → due; sent or future → not', () => {
    expect(isReminderDue(row(), now)).toBe(true);
    expect(isReminderDue(row({ sent: true }), now)).toBe(false);
    expect(isReminderDue(row({ remindAt: new Date('2026-09-12T15:00:00Z') }), now)).toBe(false);
  });

  it('filterDueReminders keeps only due rows', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', sent: true }), row({ id: 'c', remindAt: new Date('2026-09-13T00:00Z') })];
    expect(filterDueReminders(rows, now).map((r) => r.id)).toEqual(['a']);
  });

  it('buildReminderNotification carries contest source + HIGH priority', () => {
    const n = buildReminderNotification(contest(), 60);
    expect(n.type).toBe('CONTEST_REMINDER');
    expect(n.priority).toBe('HIGH');
    expect(n.source).toBe('contest:c1');
    expect(n.title).toContain('Weekly Contest 519');
  });

  it('runContestRemindersJob notifies due, marks sent, skips rest', async () => {
    const due = row({ id: 'due1' });
    const future = row({ id: 'fut1', remindAt: new Date('2026-09-13T00:00:00Z') });
    const notified: Array<{ userId: string; title: string }> = [];
    const marked: string[] = [];
    const res = await runContestRemindersJob({
      now,
      listDue: async () => [due] as any, // job lists only due (future never passed in)
      markSent: async (id) => {
        marked.push(id);
      },
      notify: async (userId, n) => {
        notified.push({ userId, title: n.title });
      },
    });
    expect(future.id).toBe('fut1'); // documents the non-due fixture (not passed to listDue)
    expect(res).toEqual({ checked: 1, notified: 1, failed: 0 });
    expect(notified).toHaveLength(1);
    expect(notified[0].userId).toBe('u1');
    expect(marked).toEqual(['due1']);
  });

  it('runContestRemindersJob counts failures without throwing', async () => {
    const res = await runContestRemindersJob({
      now,
      listDue: async () => [row({ id: 'x' })] as any,
      markSent: async () => {},
      notify: async () => {
        throw new Error('socket down');
      },
    });
    expect(res).toEqual({ checked: 1, notified: 0, failed: 1 });
  });
});
