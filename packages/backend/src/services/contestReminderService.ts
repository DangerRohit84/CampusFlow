// services/contestReminderService.ts — contest alarms/reminders (#6).
// WHY: POST /contests/:id/remind needs validation + remindAt math + GCal URL
// + college scoping in ONE testable place (routes stay thin, cron reuses it).
// Pure fns (no DB/socket) so vitest covers CRUD validation, GCal builder and
// scoping without Neon. DB/socket only enter via runContestRemindersJob deps.

export const ALLOWED_REMINDER_MINUTES = [15, 60, 1440] as const;
export type AllowedReminderMinutes = (typeof ALLOWED_REMINDER_MINUTES)[number];

export interface ContestLike {
  id: string;
  title: string;
  platform?: string | null;
  url?: string | null;
  startTime: string | Date;
  duration?: number | null;
  collegeId?: string | null;
  creatorId?: string | null;
}

export interface UserScopeLike {
  id: string;
  role: string;
  collegeId?: string | null;
}

export interface ReminderLike {
  id: string;
  userId: string;
  contestId: string;
  minutesBefore: number;
  remindAt: string | Date;
  sent: boolean;
}

export function isAllowedMinutes(v: unknown): v is AllowedReminderMinutes {
  return (
    typeof v === 'number' &&
    Number.isInteger(v) &&
    (ALLOWED_REMINDER_MINUTES as readonly number[]).includes(v)
  );
}

/** Strict parser for the POST body — returns minutes or null when invalid. */
export function parseMinutesBefore(v: unknown): AllowedReminderMinutes | null {
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isInteger(n) && isAllowedMinutes(n)) return n;
    return null;
  }
  if (isAllowedMinutes(v)) return v;
  return null;
}

function toDate(v: string | Date): Date | null {
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * remindAt = contestStart - minutesBefore. Throws on invalid startTime so
 * routes can map to 400/404 (never persist a NaN date).
 */
export function computeRemindAt(
  startTime: string | Date,
  minutesBefore: AllowedReminderMinutes,
): Date {
  const start = toDate(startTime);
  if (!start) throw new Error('Invalid contest startTime');
  return new Date(start.getTime() - minutesBefore * 60_000);
}

/**
 * College scoping mirror of GET /contests list (contests.ts).
 * SUPER_ADMIN sees everything; everyone else sees global (collegeId null),
 * own-college, or own-created rows. Unknown roles default to the student rule.
 */
export function canUserSeeContest(user: UserScopeLike, contest: ContestLike): boolean {
  if (!user || !contest) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  if (contest.collegeId == null) return true;
  if (user.collegeId && contest.collegeId === user.collegeId) return true;
  if (contest.creatorId && contest.creatorId === user.id) return true;
  return false;
}

/** GCal date stamp: 20260912T153000Z (UTC, no dashes/colons/millis). */
export function toGCalStamp(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/**
 * Zero-backend "Add to Google Calendar" template URL (no OAuth).
 * dates = start/end in UTC; end = start + (duration ?? 180m) matching the
 * contests list fallback (computeStatus/getContestStatus use 180).
 * details carries platform + source URL so the event is self-contained.
 */
export function buildGoogleCalendarUrl(contest: ContestLike): string {
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

export function formatReminderLead(minutesBefore: number): string {
  if (minutesBefore >= 1440) return `${Math.round(minutesBefore / 1440)} day(s)`;
  if (minutesBefore >= 60) return `${Math.round(minutesBefore / 60)} hour(s)`;
  return `${minutesBefore} minute(s)`;
}

export function buildReminderNotification(
  contest: ContestLike,
  minutesBefore: number,
): { title: string; message: string; type: string; priority: string; source: string } {
  const lead = formatReminderLead(minutesBefore);
  return {
    title: `Contest in ${lead}: ${contest.title}`,
    message: `${contest.platform || 'Contest'} — "${contest.title}" starts in ${lead}. ${contest.url || ''}`.trim(),
    type: 'CONTEST_REMINDER',
    priority: 'HIGH',
    source: `contest:${contest.id}`,
  };
}

/** Due when unsent and remindAt <= now (inclusive — cron fires on the tick). */
export function isReminderDue(r: Pick<ReminderLike, 'remindAt' | 'sent'>, now: Date = new Date()): boolean {
  if (r.sent) return false;
  const at = toDate(r.remindAt);
  if (!at) return false;
  return at.getTime() <= now.getTime();
}

export function filterDueReminders<T extends Pick<ReminderLike, 'remindAt' | 'sent'>>(
  reminders: T[],
  now: Date = new Date(),
): T[] {
  return reminders.filter((r) => isReminderDue(r, now));
}

/**
 * Validate a POST /contests/:id/remind request without touching the DB.
 * Returns { remindAt } on success or { error, status } for the route to send.
 */
export function validateReminderRequest(
  minutesBeforeRaw: unknown,
  contest: ContestLike | null,
  now: Date = new Date(),
): { remindAt: Date; minutesBefore: AllowedReminderMinutes } | { error: string; status: number } {
  const minutesBefore = parseMinutesBefore(minutesBeforeRaw);
  if (!minutesBefore) {
    return { error: 'minutesBefore must be one of 15, 60, 1440', status: 400 };
  }
  if (!contest) return { error: 'Contest not found', status: 404 };
  let remindAt: Date;
  try {
    remindAt = computeRemindAt(contest.startTime, minutesBefore);
  } catch {
    return { error: 'Contest has an invalid startTime', status: 400 };
  }
  if (remindAt.getTime() <= now.getTime()) {
    return { error: 'Reminder time already passed — contest starts too soon for this lead time', status: 400 };
  }
  return { remindAt, minutesBefore };
}

// ---- Due-job runner (cron + tests share this; Prisma/socket injected) ----

export interface ReminderJobRow extends ReminderLike {
  contest: ContestLike;
}

export interface ReminderJobDeps {
  now?: Date;
  batchLimit?: number;
  listDue?: (now: Date, limit: number) => Promise<ReminderJobRow[]>;
  markSent?: (id: string, at: Date) => Promise<void>;
  notify?: (userId: string, n: { title: string; message: string; type: string; priority: string; source: string }) => Promise<unknown>;
}

export async function runContestRemindersJob(deps: ReminderJobDeps = {}): Promise<{
  checked: number;
  notified: number;
  failed: number;
}> {
  const now = deps.now ?? new Date();
  const limit = Math.min(Math.max(deps.batchLimit ?? 200, 1), 500);
  // Lazy-require the real wiring only when the caller did not inject fakes
  // (keeps unit tests hermetic — no prisma/socket import cost).
  let listDue = deps.listDue;
  let markSent = deps.markSent;
  let notify = deps.notify;
  if (!listDue || !markSent || !notify) {
    const [{ default: prisma }, { notifyUsers }] = await Promise.all([
      import('../config/db'),
      import('./notificationService'),
    ]);
    const { logger } = await import('../utils/logger');
    listDue =
      listDue ??
      (async (at: Date, take: number) => {
        const rows = await prisma.contestReminder.findMany({
          where: { sent: false, remindAt: { lte: at } },
          include: { contest: true },
          orderBy: { remindAt: 'asc' },
          take,
        });
        return rows as unknown as ReminderJobRow[];
      });
    markSent =
      markSent ??
      (async (id: string, at: Date) => {
        await prisma.contestReminder.update({ where: { id }, data: { sent: true, sentAt: at } });
      });
    notify =
      notify ??
      (async (userId: string, n) => {
        try {
          await notifyUsers([userId], n);
        } catch (err) {
          logger.debug({ err, userId }, '[contest-reminders] notify failed (marked sent anyway to avoid poison loop)');
        }
      });
  }
  const due = await listDue!(now, limit);
  let notified = 0;
  let failed = 0;
  for (const row of due) {
    try {
      if (!row.contest) {
        // Orphan (contest deleted but FK missed) — mark sent to avoid re-scan.
        await markSent!(row.id, now);
        continue;
      }
      const n = buildReminderNotification(row.contest, row.minutesBefore);
      await notify!(row.userId, n);
      await markSent!(row.id, now);
      notified++;
    } catch {
      failed++;
    }
  }
  return { checked: due.length, notified, failed };
}
