/**
 * Timetable merge lib — Approach A (template + dated overrides).
 *
 * Schedule stays the weekly template (dayOfWeek 0-6 Monday=0).
 * ScheduleOverride carries a date range [validFrom, validUntil] (inclusive,
 * date-only) + optional start/end time override + baseScheduleId + kind.
 *
 * Kinds: EDITED (replace fields on matching weekday in range),
 *   CANCELLED (keep struck-through with _cancelled flag + Revert),
 *   ADDED_TEMP (new dated entry, daily or weekday-filtered).
 *
 * Pure + hermetic (no DB) — safe to unit test. Mirrored in
 * apps/web/src/lib/timetableMerge.ts (frontend accepts string dates).
 */
import { timeToMinutes } from './validators';

export type OverrideKind = 'EDITED' | 'CANCELLED' | 'ADDED_TEMP';

export interface TemplateEntry {
  id: string;
  title?: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  startMinutes?: number | null;
  endMinutes?: number | null;
  location?: string | null;
  [k: string]: any;
}

export interface OverrideEntry {
  id: string;
  baseScheduleId?: string | null;
  kind: OverrideKind | string;
  title?: string | null;
  location?: string | null;
  teacher?: string | null;
  course?: string | null;
  type?: string | null;
  color?: string | null;
  dayOfWeek?: number | null;
  validFrom: Date | string;
  validUntil: Date | string;
  startTime?: string | null;
  endTime?: string | null;
  startMinutes?: number | null;
  endMinutes?: number | null;
  [k: string]: any;
}

export interface ClashWarning {
  type: 'overlap' | 'room';
  message: string;
  entryIds: string[];
}

/** YYYY-MM-DD from Date|string (UTC date-only). */
export function toDateKey(input: Date | string): string | null {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return input.toISOString().slice(0, 10);
  }
  const s = String(input || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : s;
}

/** Monday=0..Sunday=6 for a YYYY-MM-DD key (UTC, avoids TZ drift). */
export function dateKeyToDayOfWeek(dateKey: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  const dow = d.getUTCDay(); // Sun=0
  return dow === 0 ? 6 : dow - 1;
}

/** Inclusive date-only range check. Accepts Date|string bounds. */
export function isDateInRange(dateKey: string, validFrom: Date | string, validUntil: Date | string): boolean {
  const from = toDateKey(validFrom);
  const until = toDateKey(validUntil);
  if (!from || !until) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
  return dateKey >= from && dateKey <= until;
}

/** validFrom<=validUntil and both valid dates. */
export function isValidRange(validFrom: unknown, validUntil: unknown): boolean {
  const f = toDateKey(validFrom as any);
  const u = toDateKey(validUntil as any);
  if (!f || !u) return false;
  return f <= u;
}

function minutesOf(entry: { startMinutes?: number | null; startTime?: string | null }, fallback: number): number {
  if (typeof entry.startMinutes === 'number' && Number.isFinite(entry.startMinutes)) return entry.startMinutes;
  const m = timeToMinutes(entry.startTime);
  return m !== null ? m : fallback;
}

function endMinutesOf(entry: { endMinutes?: number | null; endTime?: string | null }, fallback: number): number {
  if (typeof entry.endMinutes === 'number' && Number.isFinite(entry.endMinutes)) return entry.endMinutes;
  const m = timeToMinutes(entry.endTime);
  return m !== null ? m : fallback;
}

/**
 * Merge templates + overrides for a single YYYY-MM-DD date.
 * - Templates whose dayOfWeek matches the date's weekday are included.
 * - EDITED: when date in range AND weekday matches base template, replace
 *   non-null override fields, flag _overrideKind='EDITED' + _overrideId.
 * - CANCELLED: same match → keep entry flagged _overrideKind='CANCELLED',
 *   _cancelled=true (struck-through + Revert in UI).
 * - ADDED_TEMP: when date in range AND (dayOfWeek null or matches date's
 *   weekday) → append as dated entry flagged _overrideKind='TEMP'.
 */
export function mergeTimetableForDate(
  templates: TemplateEntry[],
  overrides: OverrideEntry[],
  dateKey: string
): any[] {
  const dow = dateKeyToDayOfWeek(dateKey);
  if (dow === null) return [];
  const out: any[] = [];

  for (const t of templates || []) {
    if (t.dayOfWeek !== dow) continue;
    // Find matching EDITED/CANCELLED override for this template on this date
    const match = (overrides || []).find(
      (o) =>
        (o.kind === 'EDITED' || o.kind === 'CANCELLED') &&
        o.baseScheduleId === t.id &&
        isDateInRange(dateKey, o.validFrom, o.validUntil)
    );
    if (!match) {
      out.push({ ...t, date: dateKey });
      continue;
    }
    if (match.kind === 'CANCELLED') {
      out.push({ ...t, date: dateKey, _overrideKind: 'CANCELLED', _overrideId: match.id, _cancelled: true });
      continue;
    }
    // EDITED: override non-null fields
    const merged: any = { ...t, date: dateKey, _overrideKind: 'EDITED', _overrideId: match.id };
    for (const k of ['title', 'course', 'location', 'teacher', 'type', 'color', 'startTime', 'endTime', 'startMinutes', 'endMinutes', 'dayOfWeek'] as const) {
      const v = (match as any)[k];
      if (v !== undefined && v !== null && v !== '') merged[k] = v;
    }
    out.push(merged);
  }

  for (const o of overrides || []) {
    if (o.kind !== 'ADDED_TEMP') continue;
    if (!isDateInRange(dateKey, o.validFrom, o.validUntil)) continue;
    if (o.dayOfWeek !== undefined && o.dayOfWeek !== null && o.dayOfWeek !== (dow as number)) continue;
    out.push({
      id: o.id,
      title: o.title || 'Temporary class',
      course: (o as any).course || '',
      location: o.location || '',
      teacher: (o as any).teacher || null,
      dayOfWeek: o.dayOfWeek ?? dow,
      startTime: o.startTime || '09:00',
      endTime: o.endTime || '10:00',
      startMinutes: o.startMinutes ?? timeToMinutes(o.startTime) ?? 540,
      endMinutes: o.endMinutes ?? timeToMinutes(o.endTime) ?? 600,
      type: (o as any).type || 'CLASS',
      color: (o as any).color || '#f59e0b',
      date: dateKey,
      _overrideKind: 'TEMP',
      _overrideId: o.id,
      _temp: true,
    });
  }

  out.sort((a, b) => {
    const am = minutesOf(a, 0);
    const bm = minutesOf(b, 0);
    if (am !== bm) return am - bm;
    return String(a.startTime || '').localeCompare(String(b.startTime || ''));
  });
  return out;
}

/** Flat dated list for [fromKey, toKey] inclusive, sorted by date then time. */
export function mergeTimetableForRange(
  templates: TemplateEntry[],
  overrides: OverrideEntry[],
  fromKey: string,
  toKey: string
): any[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromKey) || !/^\d{4}-\d{2}-\d{2}$/.test(toKey)) return [];
  if (fromKey > toKey) return [];
  // Guard unbounded ranges (prod safety: max 62 days per request)
  const start = new Date(`${fromKey}T00:00:00.000Z`).getTime();
  const end = new Date(`${toKey}T00:00:00.000Z`).getTime();
  const days = Math.round((end - start) / 86400000);
  if (days < 0 || days > 62) return [];
  const out: any[] = [];
  for (let t = start; t <= end; t += 86400000) {
    const key = new Date(t).toISOString().slice(0, 10);
    out.push(...mergeTimetableForDate(templates, overrides, key));
  }
  return out;
}

/** Soft clash warnings: time overlap (any) + same-room overlap. Non-blocking. */
export function findClashes(entries: Array<{ id: string; startMinutes?: number | null; endMinutes?: number | null; startTime?: string; endTime?: string; location?: string | null }>): ClashWarning[] {
  const warnings: ClashWarning[] = [];
  const list = (entries || []).map((e) => ({
    id: e.id,
    s: typeof e.startMinutes === 'number' ? e.startMinutes : timeToMinutes(e.startTime) ?? -1,
    e: typeof e.endMinutes === 'number' ? e.endMinutes : timeToMinutes(e.endTime) ?? -1,
    location: String(e.location || '').trim().toLowerCase(),
  })).filter((x) => x.s >= 0 && x.e > x.s);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const overlap = a.s < b.e && b.s < a.e;
      if (!overlap) continue;
      warnings.push({
        type: 'overlap',
        message: `Time overlap: ${a.id} ↔ ${b.id}`,
        entryIds: [a.id, b.id],
      });
      if (a.location && a.location === b.location) {
        warnings.push({
          type: 'room',
          message: `Room clash in ${entries.find((e) => e.id === a.id)?.location || a.location}: ${a.id} ↔ ${b.id}`,
          entryIds: [a.id, b.id],
        });
      }
    }
  }
  return warnings;
}

/** Validate override create/update input. Returns error string or null. */
export function validateOverrideInput(input: any): string | null {
  const kind = String(input?.kind || '').trim().toUpperCase();
  if (!['EDITED', 'CANCELLED', 'ADDED_TEMP'].includes(kind)) {
    return 'kind must be one of EDITED, CANCELLED, ADDED_TEMP';
  }
  const from = toDateKey(input?.validFrom);
  const until = toDateKey(input?.validUntil);
  if (!from || !until) return 'validFrom and validUntil must be valid dates (YYYY-MM-DD)';
  if (from > until) return 'Invalid range: validFrom must be on or before validUntil';

  if (kind === 'EDITED' || kind === 'CANCELLED') {
    if (!input?.baseScheduleId || !String(input.baseScheduleId).trim()) {
      return 'baseScheduleId is required for EDITED/CANCELLED overrides';
    }
  }
  if (kind === 'ADDED_TEMP') {
    if (!String(input?.title || '').trim()) return 'title is required for temporary classes';
  }
  // Time validation: CANCELLED needs no times; others need start<end when given
  if (kind !== 'CANCELLED') {
    const st = input?.startTime;
    const et = input?.endTime;
    if ((st !== undefined && st !== null && st !== '') || (et !== undefined && et !== null && et !== '')) {
      const sm = timeToMinutes(st);
      const em = timeToMinutes(et);
      if (sm === null || em === null) return 'startTime and endTime must be valid HH:MM';
      if (sm >= em) return 'startTime must be before endTime';
    }
  }
  const dow = input?.dayOfWeek;
  if (dow !== undefined && dow !== null && !(Number.isInteger(dow) && dow >= 0 && dow <= 6)) {
    return 'dayOfWeek must be an integer 0-6 (Monday=0) or null for daily';
  }
  return null;
}
