// opportunities/expiry.ts — deadline-expiry SSOT (deadline bug fix).
// WHY: fetch pipeline filtered isEnded at INGEST only; existing PUBLISHED/ACTIVE
// rows whose deadline later passed were never transitioned (no sweep), and
// frontend HackathonsPage mapped past-deadline to "ongoing" (never "completed").
// ContestFetcher already sweeps CodingContest via groupContestStatuses — this
// mirrors that pattern for Hackathon (PUBLISHED→COMPLETED) + Internship
// (ACTIVE→ENDED). Date-only YYYY-MM-DD treated as 23:59 IST end-of-day
// (same as stagesDeadline.toIstDeadline) so deadline day stays visible.

import { toIstDeadline } from './stagesDeadline';

export function isExpiredByDeadline(
  deadline: Date | string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!deadline) return false;
  try {
    if (deadline instanceof Date) {
      if (Number.isNaN(deadline.getTime())) return false;
      return deadline.getTime() < nowMs;
    }
    const s = String(deadline).trim();
    if (!s) return false;
    // Date-only → end-of-day IST (registrations close end of day, not midnight UTC).
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = toIstDeadline(s);
      if (!d || Number.isNaN(d.getTime())) return false;
      return d.getTime() < nowMs;
    }
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return false;
    return d.getTime() < nowMs;
  } catch {
    return false;
  }
}

function toDateOrNull(v: unknown): Date | null {
  if (!v) return null;
  try {
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
    const s = String(v).trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return toIstDeadline(s);
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export type HackathonDisplayStatus = 'upcoming' | 'ongoing' | 'completed';

/**
 * Client/server-shared display status. Past deadline (or past endDate) →
 * completed. Mirrors the fixed HackathonsPage.getHackathonStatus.
 */
export function getHackathonDisplayStatus(
  row: { status?: string | null; startDate?: unknown; endDate?: unknown; deadline?: unknown },
  nowMs: number = Date.now(),
): HackathonDisplayStatus {
  const now = new Date(nowMs);
  const st = String(row?.status ?? '').toUpperCase();
  if (st === 'COMPLETED' || st === 'CANCELLED' || st === 'ENDED') return 'completed';
  const endDate = toDateOrNull((row as any)?.endDate);
  const startDate = toDateOrNull((row as any)?.startDate);
  const deadline = (row as any)?.deadline as Date | string | null | undefined;
  if (endDate && now > endDate) return 'completed';
  if (isExpiredByDeadline(deadline, nowMs)) return 'completed';
  if (startDate && endDate) {
    if (now < startDate) return 'upcoming';
    return 'ongoing';
  }
  if (startDate) {
    if (now < startDate) return 'upcoming';
    return 'ongoing';
  }
  if (deadline && toDateOrNull(deadline)) {
    return now < (toDateOrNull(deadline) as Date) ? 'upcoming' : 'completed';
  }
  return 'upcoming';
}

export type InternshipDisplayStatus = 'upcoming' | 'active' | 'ended';

/** Past deadline → ended (mirrors fixed InternshipsPage + InternshipDetailPage). */
export function getInternshipDisplayStatus(
  row: { status?: string | null; startDate?: unknown; deadline?: unknown },
  nowMs: number = Date.now(),
): InternshipDisplayStatus {
  const st = String(row?.status ?? '').toUpperCase();
  if (st === 'ENDED' || st === 'INACTIVE' || st === 'CLOSED') return 'ended';
  const deadline = (row as any)?.deadline as Date | string | null | undefined;
  if (isExpiredByDeadline(deadline, nowMs)) return 'ended';
  const startDate = toDateOrNull((row as any)?.startDate);
  if (startDate) {
    const now = new Date(nowMs);
    if (now < startDate) return 'upcoming';
    return 'active';
  }
  return deadline ? 'upcoming' : 'upcoming';
}

export interface ExpiryDb {
  hackathon: { updateMany(args: unknown): Promise<{ count: number }> };
  internship: { updateMany(args: unknown): Promise<{ count: number }> };
}

/**
 * Time-driven sweep (mirrors contestFetcher group-then-updateMany, ≤2 writes).
 * PUBLISHED hackathons with deadline < now → COMPLETED;
 * ACTIVE internships with deadline < now → ENDED.
 * Never throws (fail-open, cron-safe). Staging untouched by design
 * (admin must review recently-expired pending — visual badge only).
 */
export async function sweepExpiredOpportunities(
  db: ExpiryDb,
  now: Date = new Date(),
): Promise<{ hackathons: number; internships: number }> {
  let hackathons = 0;
  let internships = 0;
  try {
    const res = await db.hackathon.updateMany({
      where: { status: 'PUBLISHED', deadline: { lt: now } },
      data: { status: 'COMPLETED' },
    });
    hackathons = typeof (res as any)?.count === 'number' ? (res as any).count : 0;
  } catch {
    hackathons = 0;
  }
  try {
    const res = await db.internship.updateMany({
      where: { status: 'ACTIVE', deadline: { lt: now } },
      data: { status: 'ENDED' },
    });
    internships = typeof (res as any)?.count === 'number' ? (res as any).count : 0;
  } catch {
    internships = 0;
  }
  return { hackathons, internships };
}
