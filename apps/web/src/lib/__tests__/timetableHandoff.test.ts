// lib/__tests__/timetableHandoff.test.ts — 42-period handoff regression.
// WHY: backend logged "Direct parse OK, 42" but UI toasted
// "Failed to parse timetable". Root causes: (1) 15s axios timeout aborted
// vision (backend 60s budget) AFTER parse succeeded, (2) brittle
// `result.classes` reader (periods/schedules/bare-array drift → TypeError
// → catch → mislabeled as parse failure). Locks: tolerant reader returns
// 42 for every shape, never throws, and AI calls use fetch (60s) timeout.
import { describe, it, expect, vi } from 'vitest';
import { normalizeTimetableResult } from '../../pages/SchedulePage';

function make42() {
  return Array.from({ length: 42 }, (_, i) => ({
    title: `Class ${i + 1}`,
    course: `C${100 + i}`,
    location: `Room ${i % 10}`,
    teacher: `Prof ${i % 5}`,
    dayOfWeek: i % 7,
    startTime: '09:00',
    endTime: '10:00',
    type: i % 5 === 0 ? 'LAB' : 'CLASS',
  }));
}

describe('normalizeTimetableResult (42-period handoff)', () => {
  it('returns 42 for canonical { classes } shape', () => {
    const out = normalizeTimetableResult({ classes: make42(), message: 'Found 42 classes.' });
    expect(out).toHaveLength(42);
    expect(out[0].title).toBe('Class 1');
  });

  it('returns 42 for drifted keys (periods/schedules/data/bare array)', () => {
    const arr = make42();
    expect(normalizeTimetableResult({ periods: arr })).toHaveLength(42);
    expect(normalizeTimetableResult({ schedules: arr })).toHaveLength(42);
    expect(normalizeTimetableResult({ data: arr })).toHaveLength(42);
    expect(normalizeTimetableResult(arr)).toHaveLength(42);
  });

  it('never throws — null/undefined/string → [] (empty state, not failure toast)', () => {
    expect(normalizeTimetableResult(null)).toEqual([]);
    expect(normalizeTimetableResult(undefined)).toEqual([]);
    expect(normalizeTimetableResult('oops')).toEqual([]);
    expect(normalizeTimetableResult({})).toEqual([]);
    expect(normalizeTimetableResult({ classes: null })).toEqual([]);
    expect(normalizeTimetableResult({ classes: 'nope' })).toEqual([]);
  });

  it('prefers classes over drifted keys when both present (API stable)', () => {
    const classes = make42().slice(0, 42);
    const periods = make42().slice(0, 5);
    const out = normalizeTimetableResult({ classes, periods });
    expect(out).toHaveLength(42);
  });
});

describe('timetableAPI timeouts (vision needs 60s)', () => {
  it('uploadImage/parseText/save use fetch (60s) timeout, not 15s default', async () => {
    const apiMod = await import('../api/resources/planner');
    const clientMod = await import('../api/client');
    expect(clientMod.API_TIMEOUTS.fetch).toBe(60000);

    // Capture per-call config by spying on the shared axios instance.
    const calls: any[] = [];
    const origPost = (clientMod.api as any).post;
    const spy = vi.spyOn(clientMod.api as any, 'post').mockImplementation((...args: any[]) => {
      calls.push(args);
      return Promise.resolve({ data: { classes: [], message: 'x' } });
    });
    try {
      const f = new File(['x'], 'tt.png', { type: 'image/png' });
      await apiMod.timetableAPI.uploadImage(f).catch(() => {});
      await apiMod.timetableAPI.parseText('Monday:\n9:00-10:00 - Math').catch(() => {});
      await apiMod.timetableAPI.save([]).catch(() => {});
    } finally {
      spy.mockRestore();
      // restore not strictly needed; vitest isolates modules per file
      void origPost;
    }
    expect(calls).toHaveLength(3);
    for (const [, , cfg] of calls) {
      expect(cfg?.timeout).toBe(clientMod.API_TIMEOUTS.fetch);
    }
  });
});
