// lib/gcal.ts — zero-backend "Add to Google Calendar" builder (#6).
// WHY: per-contest GCal export must work with no OAuth and no backend call,
// so both CodingContestsPage cards and CalendarPage detail rows share this
// ONE template-URL builder (no duplicated date math drifting apart).
// Format: https://calendar.google.com/calendar/render?action=TEMPLATE&...

export interface GCalContest {
  title: string;
  platform?: string | null;
  url?: string | null;
  startTime: string | Date;
  duration?: number | null;
}

function toDate(v: string | Date): Date | null {
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export function toGCalStamp(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/** End = start + (duration ?? 180m); 180 matches backend computeStatus fallback. */
export function buildGoogleCalendarUrl(contest: GCalContest): string {
  const start = toDate(contest.startTime);
  if (!start) throw new Error('Invalid contest startTime');
  const durMin =
    typeof contest.duration === 'number' && Number.isFinite(contest.duration) && contest.duration > 0
      ? Math.min(Math.floor(contest.duration), 60 * 24 * 14)
      : 180;
  const end = new Date(start.getTime() + durMin * 60_000);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: contest.title || 'Coding contest',
    dates: `${toGCalStamp(start)}/${toGCalStamp(end)}`,
    details: `${(contest.platform || 'Contest').toUpperCase()} contest — ${contest.title || ''}${
      contest.url ? `\n${contest.url}` : ''
    }`.slice(0, 1000),
  });
  if (contest.url && /^https?:\/\//i.test(contest.url)) params.set('location', contest.url.slice(0, 500));
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
