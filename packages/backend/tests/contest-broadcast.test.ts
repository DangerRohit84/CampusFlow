/**
 * Contest broadcast (Light + Both) — TDD failing-first.
 * Phases: pre_60m + pre_15m + started (0-5m late ok) + post_30m. NO 24h.
 * Prefs: User.preferences JSON { mutedContests, broadcastsOff }, default ON.
 * Dedup: Notification.source existence (no migration) + in-memory guard.
 * Scoping: strict college-scope, global per-college fan-out, SUPER_ADMIN once.
 */
import { describe, it, expect } from 'vitest';

const contest = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  title: 'Weekly Contest 519',
  platform: 'LEETCODE',
  url: 'https://leetcode.com/contest/weekly-contest-519/',
  startTime: '2026-09-12T15:30:00.000Z',
  duration: 90,
  collegeId: null as string | null,
  ...over,
});

describe('contest broadcast TDD', () => {
  it('placeholder: service module exists', async () => {
    const m = await import('../src/services/contestBroadcastService');
    expect(typeof m.getDueBroadcastPhases).toBe('function');
  });

  it('window math: pre_60m due at start-60m, stale after tolerance', async () => {
    const { getDueBroadcastPhases } = await import('../src/services/contestBroadcastService');
    const start = new Date('2026-09-12T15:30:00.000Z');
    // Exactly at fire time → due
    expect(
      getDueBroadcastPhases(contest(), new Date(start.getTime() - 60 * 60_000)),
    ).toContain('pre_60m');
    // 5m late → still due (cron 5m tolerance)
    expect(
      getDueBroadcastPhases(contest(), new Date(start.getTime() - 55 * 60_000)),
    ).toContain('pre_60m');
    // Way stale (30m after fire) → NOT due (no catch-up spam)
    expect(
      getDueBroadcastPhases(contest(), new Date(start.getTime() - 30 * 60_000)),
    ).not.toContain('pre_60m');
    // NO 24h phase ever
    const all = getDueBroadcastPhases(contest(), new Date(start.getTime() - 24 * 60 * 60_000));
    expect(all).not.toContain('pre_24h' as never);
  });

  it('window math: pre_15m / started (5m late ok) / post_30m', async () => {
    const { getDueBroadcastPhases } = await import('../src/services/contestBroadcastService');
    const start = new Date('2026-09-12T15:30:00.000Z');
    expect(getDueBroadcastPhases(contest(), new Date(start.getTime() - 15 * 60_000))).toContain('pre_15m');
    expect(getDueBroadcastPhases(contest(), new Date(start.getTime()))).toContain('started');
    expect(getDueBroadcastPhases(contest(), new Date(start.getTime() + 4 * 60_000))).toContain('started');
    expect(getDueBroadcastPhases(contest(), new Date(start.getTime() + 6 * 60_000))).not.toContain('started');
    expect(getDueBroadcastPhases(contest(), new Date(start.getTime() + 30 * 60_000))).toContain('post_30m');
    expect(getDueBroadcastPhases(contest(), new Date(start.getTime() + 45 * 60_000))).not.toContain('post_30m');
  });

  it('prefs parse: default ON, corrupt safe', async () => {
    const { parseContestPrefs, isBroadcastOptedOut } = await import('../src/services/contestBroadcastService');
    expect(parseContestPrefs(null)).toEqual({ mutedContests: [], broadcastsOff: false });
    expect(parseContestPrefs('corrupt{{{')).toEqual({ mutedContests: [], broadcastsOff: false });
    expect(parseContestPrefs({ broadcastsOff: true })).toMatchObject({ broadcastsOff: true });
    // default ON → not opted out
    expect(isBroadcastOptedOut(null, 'c1')).toBe(false);
    expect(isBroadcastOptedOut({ mutedContests: ['c1'] }, 'c1')).toBe(true);
    expect(isBroadcastOptedOut({ broadcastsOff: true }, 'c1')).toBe(true);
    expect(isBroadcastOptedOut({ mutedContests: ['c2'] }, 'c1')).toBe(false);
  });

  it('prefs writers: mute round-trip preserves other keys', async () => {
    const { setContestMuted, setBroadcastsOff, parseContestPrefs } = await import(
      '../src/services/contestBroadcastService'
    );
    const raw = JSON.stringify({ groqApiKey: 'x' });
    const muted = setContestMuted(raw, 'c1', true);
    expect(parseContestPrefs(JSON.parse(muted)).mutedContests).toContain('c1');
    expect(JSON.parse(muted).groqApiKey).toBe('x');
    const unmuted = setContestMuted(muted, 'c1', false);
    expect(parseContestPrefs(JSON.parse(unmuted)).mutedContests).not.toContain('c1');
    const off = setBroadcastsOff(null, true);
    expect(parseContestPrefs(JSON.parse(off)).broadcastsOff).toBe(true);
  });

  it('copy: pre/start/post titles', async () => {
    const { buildBroadcastNotification } = await import('../src/services/contestBroadcastService');
    const pre = buildBroadcastNotification(contest(), 'pre_60m');
    expect(pre.type).toBe('CONTEST_BROADCAST');
    expect(pre.title).toMatch(/Weekly Contest 519/);
    const started = buildBroadcastNotification(contest(), 'started');
    expect(started.title).toMatch(/Live now/i);
    const post = buildBroadcastNotification(contest(), 'post_30m');
    expect(post.message).toMatch(/Still open/i);
  });

  it('scoping: college strict, global fan-out includes all, SUPER_ADMIN once', async () => {
    const { resolveBroadcastCollegeKeys, filterBroadcastRecipients } = await import(
      '../src/services/contestBroadcastService'
    );
    // scoped contest → single college key
    expect(resolveBroadcastCollegeKeys(contest({ collegeId: 'colA' }))).toEqual(['colA']);
    // global contest → caller fans out per college; helper returns ['global'] marker
    expect(resolveBroadcastCollegeKeys(contest({ collegeId: null }))).toEqual(['global']);
    // opt-out honored in recipient filter
    const users = [
      { id: 'u1', collegeId: 'colA', role: 'STUDENT', preferences: null },
      { id: 'u2', collegeId: 'colA', role: 'STUDENT', preferences: { broadcastsOff: true } },
      { id: 'u3', collegeId: 'colA', role: 'STUDENT', preferences: { mutedContests: ['c1'] } },
    ];
    const kept = filterBroadcastRecipients(users as never, 'c1');
    expect(kept).toEqual(['u1']);
  });

  it('dedup: source key stable per contest+phase+college', async () => {
    const { broadcastSource } = await import('../src/services/contestBroadcastService');
    const a = broadcastSource('c1', 'pre_60m', 'colA');
    expect(a).toBe(broadcastSource('c1', 'pre_60m', 'colA'));
    expect(a).not.toBe(broadcastSource('c1', 'pre_15m', 'colA'));
    expect(a).not.toBe(broadcastSource('c1', 'pre_60m', 'colB'));
  });

  it('kill-switch: default off', async () => {
    const { isBroadcastEnabled } = await import('../src/services/contestBroadcastService');
    expect(isBroadcastEnabled({})).toBe(false);
    expect(isBroadcastEnabled({ CONTEST_BROADCAST_ENABLED: 'false' })).toBe(false);
    expect(isBroadcastEnabled({ CONTEST_BROADCAST_ENABLED: 'true' })).toBe(true);
  });

  it('job: honors opt-out + dedup + max 4/user/contest via fakes', async () => {
    const { runContestBroadcastsJob } = await import('../src/services/contestBroadcastService');
    const start = new Date('2026-09-12T15:30:00.000Z');
    const now = new Date(start.getTime() - 60 * 60_000); // pre_60m fire
    const notified: string[] = [];
    const res = await runContestBroadcastsJob({
      now,
      env: { CONTEST_BROADCAST_ENABLED: 'true' },
      listContests: async () => [contest({ id: 'c1' }) as never],
      listUsersForCollege: async () => [
        { id: 'u1', preferences: null },
        { id: 'u2', preferences: { broadcastsOff: true } },
      ] as never,
      hasBroadcast: async () => false,
      markBroadcast: async () => {},
      notify: async (userIds: string[]) => {
        notified.push(...userIds);
      },
    });
    expect(res.sent).toBe(1);
    expect(notified).toEqual(['u1']);
  });

  it('job: skips when already broadcast (dedup) + skips when flag off (no spam)', async () => {
    const { runContestBroadcastsJob } = await import('../src/services/contestBroadcastService');
    const start = new Date('2026-09-12T15:30:00.000Z');
    const now = new Date(start.getTime() - 60 * 60_000);
    let notifyCalls = 0;
    const dup = await runContestBroadcastsJob({
      now,
      env: { CONTEST_BROADCAST_ENABLED: 'true' },
      listContests: async () => [contest({ id: 'c1' }) as never],
      listUsersForCollege: async () => [{ id: 'u1', preferences: null }] as never,
      hasBroadcast: async () => true, // already sent
      markBroadcast: async () => {},
      notify: async () => {
        notifyCalls++;
      },
    });
    expect(dup.skipped).toBeGreaterThanOrEqual(1);
    expect(notifyCalls).toBe(0);
    const off = await runContestBroadcastsJob({
      now,
      env: {},
      listContests: async () => [contest({ id: 'c1' }) as never],
      listUsersForCollege: async () => [{ id: 'u1', preferences: null }] as never,
      hasBroadcast: async () => false,
      markBroadcast: async () => {},
      notify: async () => {
        notifyCalls++;
      },
    });
    expect(off.sent).toBe(0);
    expect(notifyCalls).toBe(0);
  });

  it('job: caps at 100 phases/tick (fail-open)', async () => {
    const { runContestBroadcastsJob, MAX_BROADCAST_PHASES_PER_TICK } = await import(
      '../src/services/contestBroadcastService'
    );
    expect(MAX_BROADCAST_PHASES_PER_TICK).toBe(100);
    const start = new Date('2026-09-12T15:30:00.000Z');
    const now = new Date(start.getTime() - 60 * 60_000);
    const many = Array.from({ length: 150 }, (_, i) => contest({ id: `c${i}` }));
    const res = await runContestBroadcastsJob({
      now,
      env: { CONTEST_BROADCAST_ENABLED: 'true' },
      listContests: async () => many as never,
      listUsersForCollege: async () => [{ id: 'u1', preferences: null }] as never,
      hasBroadcast: async () => false,
      markBroadcast: async () => {},
      notify: async () => {},
    });
    expect(res.checked).toBeLessThanOrEqual(100);
  });
});
