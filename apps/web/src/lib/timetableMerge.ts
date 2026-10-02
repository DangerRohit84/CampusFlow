/**
 * timetableMerge — frontend mirror of packages/backend/src/lib/timetableMerge.ts.
 * WHY mirror (not import): web bundle cannot import backend src; logic kept
 * identical + unit-tested both sides (timetableMerge.test.ts each).
 * String-date friendly: validFrom/validUntil accept YYYY-MM-DD or Date.
 */

export type OverrideKind = 'EDITED' | 'CANCELLED' | 'ADDED_TEMP';

function toDateKey(input: Date | string | unknown): string | null {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return input.toISOString().slice(0, 10);
  }
  const s = String((input as any) ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : s;
}

export function dateKeyToDayOfWeek(dateKey: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  const dow = d.getUTCDay();
  return dow === 0 ? 6 : dow - 1;
}

export function isDateInRange(dateKey: string, validFrom: Date | string, validUntil: Date | string): boolean {
  const from = toDateKey(validFrom);
  const until = toDateKey(validUntil);
  if (!from || !until) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
  return dateKey >= from && dateKey <= until;
}

export function isValidRange(validFrom: unknown, validUntil: unknown): boolean {
  const f = toDateKey(validFrom);
  const u = toDateKey(validUntil);
  if (!f || !u) return false;
  return f <= u;
}

function toMinutes(t: unknown): number | null {
  if (t === null || t === undefined) return null;
  const s = String(t).trim();
  const m = s.match(/^(\d{1,2})\s*:\s*(\d{2})\s*([AP]M)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = (m[3] || '').toUpperCase();
  if (!Number.isFinite(h) || !Number.isFinite(min) || min < 0 || min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    h = ap === 'AM' ? h % 12 : (h % 12) + 12;
  } else if (h < 0 || h > 23) return null;
  const total = h * 60 + min;
  return total >= 0 && total <= 1439 ? total : null;
}

function minutesOf(e: any, fallback: number): number {
  if (typeof e?.startMinutes === 'number' && Number.isFinite(e.startMinutes)) return e.startMinutes;
  const m = toMinutes(e?.startTime);
  return m !== null ? m : fallback;
}

export function mergeTimetableForDate(templates: any[], overrides: any[], dateKey: string): any[] {
  const dow = dateKeyToDayOfWeek(dateKey);
  if (dow === null) return [];
  const out: any[] = [];
  for (const t of templates || []) {
    if (t.dayOfWeek !== dow) continue;
    const match = (overrides || []).find(
      (o: any) =>
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
    const merged: any = { ...t, date: dateKey, _overrideKind: 'EDITED', _overrideId: match.id };
    for (const k of ['title', 'course', 'location', 'teacher', 'type', 'color', 'startTime', 'endTime', 'startMinutes', 'endMinutes', 'dayOfWeek'] as const) {
      const v = (match as any)[k];
      if (v !== undefined && v !== null && v !== '') merged[k] = v;
    }
    out.push(merged);
  }
  for (const o of overrides || []) {
    if ((o as any).kind !== 'ADDED_TEMP') continue;
    if (!isDateInRange(dateKey, (o as any).validFrom, (o as any).validUntil)) continue;
    if ((o as any).dayOfWeek !== undefined && (o as any).dayOfWeek !== null && (o as any).dayOfWeek !== (dow as number)) continue;
    out.push({
      id: (o as any).id,
      title: (o as any).title || 'Temporary class',
      course: (o as any).course || '',
      location: (o as any).location || '',
      teacher: (o as any).teacher || null,
      dayOfWeek: (o as any).dayOfWeek ?? dow,
      startTime: (o as any).startTime || '09:00',
      endTime: (o as any).endTime || '10:00',
      startMinutes: (o as any).startMinutes ?? toMinutes((o as any).startTime) ?? 540,
      endMinutes: (o as any).endMinutes ?? toMinutes((o as any).endTime) ?? 600,
      type: (o as any).type || 'CLASS',
      color: (o as any).color || '#f59e0b',
      date: dateKey,
      _overrideKind: 'TEMP',
      _overrideId: (o as any).id,
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

export function mergeTimetableForRange(templates: any[], overrides: any[], fromKey: string, toKey: string): any[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromKey) || !/^\d{4}-\d{2}-\d{2}$/.test(toKey)) return [];
  if (fromKey > toKey) return [];
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

export function findClashes(entries: any[]): Array<{ type: 'overlap' | 'room'; message: string; entryIds: string[] }> {
  const warnings: Array<{ type: 'overlap' | 'room'; message: string; entryIds: string[] }> = [];
  const list = (entries || [])
    .map((e: any) => ({
      id: e.id,
      s: typeof e.startMinutes === 'number' ? e.startMinutes : toMinutes(e.startTime) ?? -1,
      e: typeof e.endMinutes === 'number' ? e.endMinutes : toMinutes(e.endTime) ?? -1,
      location: String(e.location || '').trim().toLowerCase(),
    }))
    .filter((x) => x.s >= 0 && x.e > x.s);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (!(a.s < b.e && b.s < a.e)) continue;
      warnings.push({ type: 'overlap', message: `Time overlap: ${a.id} ↔ ${b.id}`, entryIds: [a.id, b.id] });
      if (a.location && a.location === b.location) {
        const label = (entries.find((e: any) => e.id === a.id)?.location || a.location) as string;
        warnings.push({ type: 'room', message: `Room clash in ${label}: ${a.id} ↔ ${b.id}`, entryIds: [a.id, b.id] });
      }
    }
  }
  return warnings;
}

/**
 * GCal-aligned Repeats model for manual adding (V1).
 * WHY: Google Calendar Add uses "Does not repeat" dropdown → Daily / Weekly /
 * Monthly / Annually / Custom + Ends Never / On date / After N. Our storage is
 * weekly templates (infinite recurse) + dated TEMP overrides (max 62-day range
 * cap), so V1 scopes to Daily/Weekly only:
 * - Does not repeat = single date (ADDED_TEMP validFrom=validUntil, daily)
 * - Daily = every day in range (ADDED_TEMP dayOfWeek=null)
 * - Weekly = repeats every week on weekday (Schedule template, recurring=true)
 * Monthly omitted V1 (weekly template + 62d cap; no new tables).
 */
export type GCalRepeat = 'does-not-repeat' | 'daily' | 'weekly';

export const GCAL_REPEAT_OPTIONS: Array<{ value: GCalRepeat; label: string; hint: string }> = [
  { value: 'does-not-repeat', label: 'Does not repeat', hint: 'Single date — appears once' },
  { value: 'daily', label: 'Daily', hint: 'Repeats daily in range (max 62 days)' },
  { value: 'weekly', label: 'Weekly', hint: 'Repeats every week on weekday (template)' },
];

export type GCalEditScope = 'every' | 'range';

export const GCAL_EDIT_SCOPE_OPTIONS: Array<{ value: GCalEditScope; label: string; hint: string }> = [
  // GCal mapping: Every week = All events, Only this range = This event /
  // This and following (collapsed to date range below). Values kept stable
  // ('every' | 'range') so override storage is unchanged.
  { value: 'every', label: 'Every week', hint: 'All events' },
  { value: 'range', label: 'Only this range', hint: 'This event / This and following (via dates)' },
];

export function resolveAddRepeatMode(repeat: GCalRepeat): 'single' | 'daily-range' | 'weekly-template' {
  if (repeat === 'daily') return 'daily-range';
  if (repeat === 'weekly') return 'weekly-template';
  return 'single';
}

export function validateOverrideInput(input: any): string | null {
  const kind = String(input?.kind || '').trim().toUpperCase();
  if (!['EDITED', 'CANCELLED', 'ADDED_TEMP'].includes(kind)) return 'kind must be one of EDITED, CANCELLED, ADDED_TEMP';
  const from = toDateKey(input?.validFrom);
  const until = toDateKey(input?.validUntil);
  if (!from || !until) return 'validFrom and validUntil must be valid dates (YYYY-MM-DD)';
  if (from > until) return 'Invalid range: validFrom must be on or before validUntil';
  if (kind === 'EDITED' || kind === 'CANCELLED') {
    if (!input?.baseScheduleId || !String(input.baseScheduleId).trim()) return 'baseScheduleId is required for EDITED/CANCELLED overrides';
  }
  if (kind === 'ADDED_TEMP') {
    if (!String(input?.title || '').trim()) return 'title is required for temporary classes';
  }
  if (kind !== 'CANCELLED') {
    const st = input?.startTime;
    const et = input?.endTime;
    if ((st !== undefined && st !== null && st !== '') || (et !== undefined && et !== null && et !== '')) {
      const sm = toMinutes(st);
      const em = toMinutes(et);
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
