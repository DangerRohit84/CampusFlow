// lib/__tests__/timetableMerge.test.ts — frontend mirror of backend merge logic.
// TDD RED: must FAIL until src/lib/timetableMerge.ts exists.
import { describe, it, expect } from 'vitest';
import {
  mergeTimetableForDate,
  mergeTimetableForRange,
  findClashes,
  validateOverrideInput,
  isDateInRange,
  isValidRange,
  GCAL_REPEAT_OPTIONS,
  GCAL_EDIT_SCOPE_OPTIONS,
  resolveAddRepeatMode,
} from '../timetableMerge';

const templateMon = {
  id: 's-mon',
  title: 'Data Structures',
  dayOfWeek: 0,
  startTime: '09:00',
  endTime: '10:00',
  startMinutes: 540,
  endMinutes: 600,
  location: 'Room 301',
};

describe('timetableMerge (frontend)', () => {
  it('merges EDITED override only on matching weekday in range', () => {
    const edited: any = {
      id: 'o1',
      baseScheduleId: 's-mon',
      kind: 'EDITED',
      title: 'DS Hall B',
      location: 'Hall B',
      startTime: '10:00',
      endTime: '11:00',
      startMinutes: 600,
      endMinutes: 660,
      validFrom: '2026-10-05',
      validUntil: '2026-10-05',
    };
    const mon = mergeTimetableForDate([templateMon] as any, [edited], '2026-10-05');
    expect(mon).toHaveLength(1);
    expect((mon[0] as any)._overrideKind).toBe('EDITED');
    expect(mon[0].location).toBe('Hall B');

    const tue = mergeTimetableForDate([templateMon] as any, [edited], '2026-10-06');
    expect(tue).toHaveLength(0);
  });

  it('CANCELLED stays struck-through with Revert flag; other weeks unaffected', () => {
    const cancelled: any = {
      id: 'o-c',
      baseScheduleId: 's-mon',
      kind: 'CANCELLED',
      validFrom: '2026-10-05',
      validUntil: '2026-10-05',
    };
    const merged = mergeTimetableForRange([templateMon] as any, [cancelled], '2026-10-05', '2026-10-12');
    const oct5 = merged.filter((e: any) => e.date === '2026-10-05');
    expect(oct5).toHaveLength(1);
    expect((oct5[0] as any)._cancelled).toBe(true);
    const oct12 = merged.filter((e: any) => e.date === '2026-10-12');
    expect(oct12).toHaveLength(1);
    expect((oct12[0] as any)._cancelled).toBeFalsy();
  });

  it('ADDED_TEMP daily range Oct 6-11 does not leak outside', () => {
    const temp: any = {
      id: 'o-t',
      kind: 'ADDED_TEMP',
      title: 'Fest Rehearsal',
      location: 'Hall A',
      dayOfWeek: null,
      startTime: '14:00',
      endTime: '15:30',
      startMinutes: 840,
      endMinutes: 930,
      validFrom: '2026-10-06',
      validUntil: '2026-10-11',
    };
    expect(mergeTimetableForDate([] as any, [temp], '2026-10-08')).toHaveLength(1);
    expect(mergeTimetableForDate([] as any, [temp], '2026-10-05')).toHaveLength(0);
    expect(mergeTimetableForDate([] as any, [temp], '2026-10-12')).toHaveLength(0);
  });

  it('isDateInRange inclusive + isValidRange guards', () => {
    expect(isDateInRange('2026-10-06', '2026-10-06', '2026-10-11')).toBe(true);
    expect(isDateInRange('2026-10-11', '2026-10-06', '2026-10-11')).toBe(true);
    expect(isDateInRange('2026-10-12', '2026-10-06', '2026-10-11')).toBe(false);
    expect(isValidRange('2026-10-06', '2026-10-11')).toBe(true);
    expect(isValidRange('2026-10-12', '2026-10-11')).toBe(false);
  });

  it('findClashes flags overlap + room soft clash', () => {
    const entries: any = [
      { id: 'a', title: 'A', startMinutes: 540, endMinutes: 600, startTime: '09:00', endTime: '10:00', location: 'Room 301' },
      { id: 'b', title: 'B', startMinutes: 570, endMinutes: 630, startTime: '09:30', endTime: '10:30', location: 'Room 301' },
    ];
    const w = findClashes(entries);
    expect(w.some((x: any) => x.type === 'overlap')).toBe(true);
    expect(w.some((x: any) => x.type === 'room')).toBe(true);
  });

  it('validateOverrideInput start<end + range + ownership fields', () => {
    expect(validateOverrideInput({ kind: 'ADDED_TEMP', title: 'X', validFrom: '2026-10-06', validUntil: '2026-10-11', startTime: '11:00', endTime: '10:00' } as any)).toMatch(/start/i);
    expect(validateOverrideInput({ kind: 'EDITED', validFrom: '2026-10-06', validUntil: '2026-10-11', startTime: '09:00', endTime: '10:00' } as any)).toMatch(/baseScheduleId/i);
    expect(validateOverrideInput({ kind: 'ADDED_TEMP', title: 'Fest', validFrom: '2026-10-06', validUntil: '2026-10-11', startTime: '09:00', endTime: '10:00' } as any)).toBeNull();
  });
});

describe('GCal repeat mental model (Does not repeat / Daily / Weekly)', () => {
  it('exposes GCal Repeats dropdown options (Monthly omitted V1: weekly template + 62d cap)', () => {
    const values = (GCAL_REPEAT_OPTIONS as any[]).map((o) => o.value);
    expect(values).toEqual(['does-not-repeat', 'daily', 'weekly']);
    const labels = (GCAL_REPEAT_OPTIONS as any[]).map((o) => o.label);
    expect(labels).toEqual(['Does not repeat', 'Daily', 'Weekly']);
  });

  it('resolveAddRepeatMode maps Repeats to storage (single-date TEMP vs daily TEMP vs weekly template)', () => {
    expect(resolveAddRepeatMode('does-not-repeat')).toBe('single');
    expect(resolveAddRepeatMode('daily')).toBe('daily-range');
    expect(resolveAddRepeatMode('weekly')).toBe('weekly-template');
  });

  it('exposes GCal edit scope (Every week = All events, Only this range = This / This and following)', () => {
    const values = (GCAL_EDIT_SCOPE_OPTIONS as any[]).map((o) => o.value);
    expect(values).toEqual(['every', 'range']);
    const labels = (GCAL_EDIT_SCOPE_OPTIONS as any[]).map((o) => o.label);
    expect(labels).toEqual(['Every week', 'Only this range']);
  });
});
