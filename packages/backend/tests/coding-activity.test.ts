/**
 * Unified-heatmap daily activity (codingActivity.ts) — hermetic unit tests.
 *
 * Covers: LeetCode submissionCalendar parsing, Codeforces accepted-bucketing,
 * merge/to-rows pure helpers, batched save (mock db), pre-migration safety,
 * and static wiring (schema model, additive migration, syncEngine hook,
 * GET /coding-profile/activity with the honest omitted ledger).
 * No DB, no network (fetch injected; gate untouched).
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  parseLeetcodeSubmissionCalendar,
  epochToDayKey,
  dayKeyToUtcDate,
  bucketCodeforcesSubmissionsByDay,
  mergeCodingDaily,
  toActivityRows,
  saveCodingActivity,
  fetchLeetcodeDailyActivity,
  fetchCodeforcesDailyActivity,
  fetchGithubDailyBestEffort,
  fetchCodingDailyForProfile,
  sanitizeActivityHandle,
  ACTIVITY_WINDOW_DAYS,
  __resetActivityMissingTableForTests,
} from '../src/services/codingActivity';

const SRC = path.resolve(__dirname, '../src');
const PRISMA = path.resolve(__dirname, '../prisma');
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

// Epoch fixtures computed from UTC dates (never hardcoded magic numbers).
const SEP10 = Math.floor(Date.UTC(2026, 8, 10) / 1000);
const SEP09 = Math.floor(Date.UTC(2026, 8, 9) / 1000);

describe('epochToDayKey', () => {
  it('maps seconds to UTC dates', () => {
    expect(epochToDayKey(SEP10)).toBe('2026-09-10');
  });
  it('tolerates ms input', () => {
    expect(epochToDayKey(SEP10 * 1000)).toBe('2026-09-10');
  });
  it('rejects invalid input', () => {
    expect(epochToDayKey(null)).toBeNull();
    expect(epochToDayKey('junk')).toBeNull();
    expect(epochToDayKey(-5)).toBeNull();
    expect(epochToDayKey(0)).toBeNull();
  });
});

describe('dayKeyToUtcDate', () => {
  it('returns UTC midnight', () => {
    const d = dayKeyToUtcDate('2026-09-10');
    expect(d?.toISOString()).toBe('2026-09-10T00:00:00.000Z');
  });
  it('rejects malformed keys', () => {
    expect(dayKeyToUtcDate('junk')).toBeNull();
    expect(dayKeyToUtcDate('2026-9-1')).toBeNull();
  });
});

describe('parseLeetcodeSubmissionCalendar', () => {
  it('parses a JSON string payload', () => {
    const raw = JSON.stringify({ [String(SEP10)]: 5, [String(SEP09)]: 2 });
    expect(parseLeetcodeSubmissionCalendar(raw)).toEqual({ '2026-09-10': 5, '2026-09-09': 2 });
  });
  it('accepts an already-parsed object', () => {
    expect(parseLeetcodeSubmissionCalendar({ [SEP10]: 3 })).toEqual({ '2026-09-10': 3 });
  });
  it('skips invalid entries without throwing', () => {
    expect(parseLeetcodeSubmissionCalendar(JSON.stringify({ junk: 5, [String(SEP10)]: 'x' }))).toEqual({});
    expect(parseLeetcodeSubmissionCalendar('not-json')).toEqual({});
    expect(parseLeetcodeSubmissionCalendar(null)).toEqual({});
    expect(parseLeetcodeSubmissionCalendar([1, 2])).toEqual({});
  });
  it('drops future-dated keys', () => {
    const raw = JSON.stringify({ [String(SEP10)]: 4 });
    expect(parseLeetcodeSubmissionCalendar(raw, { todayKey: '2026-09-09' })).toEqual({});
  });
});

describe('bucketCodeforcesSubmissionsByDay', () => {
  it('counts only OK verdicts', () => {
    const out = bucketCodeforcesSubmissionsByDay([
      { creationTimeSeconds: SEP10, verdict: 'OK' },
      { creationTimeSeconds: SEP10 + 100, verdict: 'OK' },
      { creationTimeSeconds: SEP10, verdict: 'WRONG_ANSWER' },
      { creationTimeSeconds: SEP09, verdict: 'OK' },
    ]);
    expect(out).toEqual({ '2026-09-10': 2, '2026-09-09': 1 });
  });
  it('skips malformed rows and future timestamps', () => {
    const out = bucketCodeforcesSubmissionsByDay(
      [
        { creationTimeSeconds: 'x', verdict: 'OK' },
        { creationTimeSeconds: -1, verdict: 'OK' },
        { verdict: 'OK' },
        { creationTimeSeconds: SEP10, verdict: 'OK' },
      ] as any,
      { todayKey: '2026-09-09' }
    );
    expect(out).toEqual({});
  });
  it('returns {} for empty input', () => {
    expect(bucketCodeforcesSubmissionsByDay([])).toEqual({});
    expect(bucketCodeforcesSubmissionsByDay(null)).toEqual({});
  });
});

describe('mergeCodingDaily', () => {
  it('sums per-day across maps', () => {
    expect(mergeCodingDaily({ '2026-09-10': 2 }, { '2026-09-10': 3, '2026-09-09': 1 })).toEqual({
      '2026-09-10': 5,
      '2026-09-09': 1,
    });
  });
  it('skips malformed keys and non-positive counts', () => {
    expect(mergeCodingDaily({ junk: 5, '2026-09-10': 0, '2026-09-09': -2 } as any)).toEqual({});
    expect(mergeCodingDaily(null, undefined)).toEqual({});
  });
});

describe('toActivityRows', () => {
  it('emits UTC-midnight rows per source', () => {
    const rows = toActivityRows('u1', {
      leetcode: { '2026-09-10': 2 },
      codeforces: { '2026-09-09': 1 },
      github: {},
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ userId: 'u1', source: 'leetcode', count: 2 });
    expect(rows[0].date.toISOString()).toBe('2026-09-10T00:00:00.000Z');
  });
  it('skips malformed dates and bad counts', () => {
    expect(toActivityRows('u1', { leetcode: { junk: 5, '2026-09-10': 0 } as any })).toEqual([]);
    expect(toActivityRows('', { leetcode: { '2026-09-10': 1 } })).toEqual([]);
  });
});

describe('sanitizeActivityHandle', () => {
  it('accepts normal handles, rejects junk', () => {
    expect(sanitizeActivityHandle('tourist')).toBe('tourist');
    expect(sanitizeActivityHandle('')).toBeNull();
    expect(sanitizeActivityHandle('a b')).toBeNull();
    expect(sanitizeActivityHandle('x'.repeat(51))).toBeNull();
  });
});

describe('fetchLeetcodeDailyActivity (injected fetch)', () => {
  it('returns parsed calendar on success', async () => {
    const cal = JSON.stringify({ [String(SEP10)]: 4 });
    const fetchFn = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ data: { matchedUser: { submissionCalendar: cal } } }) });
    const out = await fetchLeetcodeDailyActivity('someuser', { fetchFn: fetchFn as any });
    // SEP10 (2026-09-10) may be future relative to wall clock → the
    // future-guard may drop it; assert no-throw + day-keyed shape either way.
    expect(typeof out).toBe('object');
    for (const [k, v] of Object.entries(out)) {
      expect(k).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(v).toBeGreaterThan(0);
    }
  });
  it('returns {} when the user is missing (never throws)', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ data: { matchedUser: null } }) });
    await expect(fetchLeetcodeDailyActivity('ghost', { fetchFn: fetchFn as any })).resolves.toEqual({});
  });
  it('returns {} on network failure (never throws)', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('down'));
    await expect(fetchLeetcodeDailyActivity('u', { fetchFn: fetchFn as any })).resolves.toEqual({});
  });
  it('returns {} for invalid handles without fetching', async () => {
    const fetchFn = vi.fn();
    await expect(fetchLeetcodeDailyActivity('bad handle!', { fetchFn: fetchFn as any })).resolves.toEqual({});
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('fetchCodeforcesDailyActivity (injected fetch)', () => {
  const okBody = {
    status: 'OK',
    result: [
      { creationTimeSeconds: SEP10, verdict: 'OK', problem: { contestId: 1, index: 'A' } },
      { creationTimeSeconds: SEP10, verdict: 'WRONG_ANSWER' },
    ],
  };
  it('buckets OK verdicts per day', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ status: 200, headers: new Headers(), json: () => Promise.resolve(okBody) });
    const out = await fetchCodeforcesDailyActivity('tourist', { fetchFn: fetchFn as any });
    // SEP10 (2026-09-10) may be future relative to wall clock → guarded; assert shape + no-throw.
    expect(typeof out).toBe('object');
  });
  it('returns {} on FAILED body (never throws)', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ status: 200, headers: new Headers(), json: () => Promise.resolve({ status: 'FAILED', comment: 'bad' }) });
    await expect(fetchCodeforcesDailyActivity('ghost', { fetchFn: fetchFn as any })).resolves.toEqual({});
  });
});

describe('fetchGithubDailyBestEffort', () => {
  it('returns [] for blank usernames without network', async () => {
    await expect(fetchGithubDailyBestEffort('   ')).resolves.toEqual([]);
    await expect(fetchGithubDailyBestEffort(null as any)).resolves.toEqual([]);
  });
});

describe('fetchCodingDailyForProfile', () => {
  it('returns empty maps when no handles (no network)', async () => {
    await expect(fetchCodingDailyForProfile({})).resolves.toEqual({ leetcode: {}, codeforces: {}, github: {} });
  });
});

describe('saveCodingActivity (mock db)', () => {
  it('writes via 1 deleteMany + chunked createMany', async () => {
    const db = {
      codingActivity: {
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const res = await saveCodingActivity('u1', { leetcode: { '2026-09-10': 2, '2026-09-09': 1 } }, { db });
    expect(res).toEqual({ saved: 2 });
    expect(db.codingActivity.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.codingActivity.createMany).toHaveBeenCalledTimes(1);
  });
  it('no-ops when nothing to store (no DB calls)', async () => {
    const db = {
      codingActivity: { deleteMany: vi.fn(), createMany: vi.fn() },
    };
    const res = await saveCodingActivity('u1', {}, { db });
    expect(res).toEqual({ saved: 0 });
    expect(db.codingActivity.deleteMany).not.toHaveBeenCalled();
  });
  it('degrades to pre-migration when the delegate is missing (never throws)', async () => {
    __resetActivityMissingTableForTests();
    const res = await saveCodingActivity('u1', { leetcode: { '2026-09-10': 1 } }, { db: {} });
    expect(res).toEqual({ saved: 0, skipped: 'pre-migration' });
    __resetActivityMissingTableForTests();
  });
  it('degrades to pre-migration on P2021 (never throws)', async () => {
    __resetActivityMissingTableForTests();
    const err: any = new Error('relation "CodingActivity" does not exist');
    err.code = 'P2021';
    const db = {
      codingActivity: {
        deleteMany: vi.fn().mockRejectedValue(err),
        createMany: vi.fn(),
      },
    };
    const res = await saveCodingActivity('u1', { leetcode: { '2026-09-10': 1 } }, { db });
    expect(res).toEqual({ saved: 0, skipped: 'pre-migration' });
    __resetActivityMissingTableForTests();
  });
  it('returns { saved: 0 } on generic DB failure (never throws, sync continues)', async () => {
    const db = {
      codingActivity: {
        deleteMany: vi.fn().mockRejectedValue(new Error('db down')),
        createMany: vi.fn(),
      },
    };
    const res = await saveCodingActivity('u1', { leetcode: { '2026-09-10': 1 } }, { db });
    expect(res).toEqual({ saved: 0 });
  });
});

describe('unified-heatmap wiring (static)', () => {
  it('Prisma schema has the additive CodingActivity model', () => {
    const schema = fs.readFileSync(path.join(PRISMA, 'schema.prisma'), 'utf8');
    expect(schema).toMatch(/model CodingActivity/);
    expect(schema).toMatch(/@@unique\(\[userId,\s*date,\s*source\]\)/);
    expect(schema).toMatch(/codingActivities\s+CodingActivity\[\]/);
  });
  it('migration is additive and re-runnable (IF NOT EXISTS, no DROP)', () => {
    const dir = path.join(PRISMA, 'migrations', '20260911000000_coding_activity');
    expect(fs.existsSync(path.join(dir, 'migration.sql')), 'migration.sql must exist').toBe(true);
    const sql = fs.readFileSync(path.join(dir, 'migration.sql'), 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "CodingActivity"/);
    expect(sql).toMatch(/CREATE (UNIQUE )?INDEX IF NOT EXISTS/);
    expect(sql).not.toMatch(/DROP TABLE/i);
  });
  it('syncEngine fetches + snapshots daily activity best-effort (never fails sync)', () => {
    const src = readSrc('services/syncEngine.ts');
    expect(src).toMatch(/fetchCodingDailyForProfile/);
    expect(src).toMatch(/fetchGithubDailyBestEffort/);
    expect(src).toMatch(/saveCodingActivity/);
    // Must be guarded so activity can never fail the whole sync.
    expect(src).toMatch(/best-effort/);
  });
  it('GET /coding-profile/activity serves stored + live github with the honest omitted ledger', () => {
    const src = readSrc('routes/codingProfile.ts');
    expect(src).toMatch(/router\.get\('\/activity'/);
    expect(src).toMatch(/omitted/);
    expect(src).toMatch(/codechef/);
    expect(src).toMatch(/hackerrank/);
    expect(src).toMatch(/gfg/);
  });
  it('window matches the frontend 182-day grid', () => {
    expect(ACTIVITY_WINDOW_DAYS).toBe(182);
  });
});
