/**
 * Order 12 (V-03-full → P3 CTI expand phase) — StudentProfile/StaffProfile helpers.
 *
 * Class-table inheritance for role-conditional User columns:
 * - STUDENT → StudentProfile(userId PK→FK Cascade, studentId UNIQUE, incomingYear, outgoingYear)
 * - TEACHER/COLLEGE_ADMIN/SUPER_ADMIN → StaffProfile(userId PK→FK Cascade, empNumber UNIQUE)
 * - No AdminProfile: admins share StaffProfile shape today (zero admin-only
 *   columns; a third empty table would add join cost for zero facts).
 *
 * Transition contract (P5 expand → backfill → contract):
 * - Twins in User KEPT (studentId/empNumber/incomingYear/outgoingYear). Writers
 *   fill BOTH User cols + profile rows (profile writes best-effort try/catch so
 *   pre-migration DBs without the tables keep working — same pattern as Order 10
 *   childTables + Order 11 gradeAttendance).
 * - Readers resolve profile-first with User fallback (IDENTICAL API shapes —
 *   no contract break; frontend untouched). Contract drops (SET NOT NULL on
 *   profiles + DROP old cols) are a LATER order once migration §7 census is green.
 *
 * All helpers are pure + never throw (garbage → null/empty), fully unit-testable.
 * Caps mirror the migration (studentId/empNumber ≤100 chars, years 1990..now+6).
 */

export const STUDENT_ROLES = ['STUDENT'] as const;
export const STAFF_ROLES = ['TEACHER', 'COLLEGE_ADMIN', 'SUPER_ADMIN'] as const;

export type StudentRole = (typeof STUDENT_ROLES)[number];
export type StaffRole = (typeof STAFF_ROLES)[number];

/** STUDENT → student profile; everything else with a staff role → staff profile. */
export function isStudentRole(role: unknown): boolean {
  return role === 'STUDENT';
}

/** TEACHER/COLLEGE_ADMIN/SUPER_ADMIN → staff profile. */
export function isStaffRole(role: unknown): boolean {
  return role === 'TEACHER' || role === 'COLLEGE_ADMIN' || role === 'SUPER_ADMIN';
}

function clampStr(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function clampYear(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? Math.trunc(v) : parseInt(String(v).trim(), 10);
  if (!Number.isFinite(n)) return null;
  const nowY = new Date().getFullYear();
  if (n < 1990 || n > nowY + 6) return null;
  return n;
}

export interface StudentProfileData {
  studentId: string | null;
  incomingYear: number | null;
  outgoingYear: number | null;
}

export interface StaffProfileData {
  empNumber: string | null;
}

/** Build StudentProfile row data from register/admin/bulk input (never throws). */
export function buildStudentProfileData(input: {
  studentId?: unknown;
  incomingYear?: unknown;
  outgoingYear?: unknown;
}): StudentProfileData {
  const incoming = clampYear((input as any)?.incomingYear);
  let outgoing = clampYear((input as any)?.outgoingYear);
  // Derive +4 cohort convention (auth.ts/register + admin.ts) when only incoming given.
  if (outgoing === null && incoming !== null) outgoing = incoming + 4;
  return {
    studentId: clampStr((input as any)?.studentId, 100),
    incomingYear: incoming,
    outgoingYear: outgoing,
  };
}

/** Build StaffProfile row data from register/admin/bulk input (never throws). */
export function buildStaffProfileData(input: { empNumber?: unknown }): StaffProfileData {
  return { empNumber: clampStr((input as any)?.empNumber, 100) };
}

/** True when a student profile row carries any fact (else skip empty upsert). */
export function hasStudentProfileData(d: StudentProfileData | null | undefined): boolean {
  if (!d) return false;
  return d.studentId !== null || d.incomingYear !== null || d.outgoingYear !== null;
}

/** True when a staff profile row carries any fact. */
export function hasStaffProfileData(d: StaffProfileData | null | undefined): boolean {
  if (!d) return false;
  return d.empNumber !== null;
}

export interface UserTwinRow {
  studentId?: string | null;
  empNumber?: string | null;
  incomingYear?: number | null;
  outgoingYear?: number | null;
}

export interface ProfileRows {
  studentProfile?: { studentId?: string | null; incomingYear?: number | null; outgoingYear?: number | null } | null;
  staffProfile?: { empNumber?: string | null } | null;
}

/**
 * Resolve student-facing fields profile-first with User-twin fallback.
 * Returns IDENTICAL shape to the old User-only read (nulls when absent both sides).
 */
export function resolveStudentFields(
  user: UserTwinRow | null | undefined,
  profiles: ProfileRows | null | undefined,
): { studentId: string | null; incomingYear: number | null; outgoingYear: number | null } {
  const p = (profiles as any)?.studentProfile ?? null;
  const u = (user as any) ?? {};
  const pick = (pv: unknown, uv: unknown): any => {
    if (pv !== null && pv !== undefined && String(pv).trim?.() !== '') return pv;
    if (typeof pv === 'number' && Number.isFinite(pv)) return pv;
    return uv ?? null;
  };
  return {
    studentId: pick((p as any)?.studentId, u.studentId) ?? null,
    incomingYear: pick((p as any)?.incomingYear, u.incomingYear) ?? null,
    outgoingYear: pick((p as any)?.outgoingYear, u.outgoingYear) ?? null,
  };
}

/** Resolve staff empNumber profile-first with User-twin fallback. */
export function resolveStaffEmpNumber(
  user: UserTwinRow | null | undefined,
  profiles: ProfileRows | null | undefined,
): string | null {
  const p = (profiles as any)?.staffProfile ?? null;
  const pv = (p as any)?.empNumber;
  if (pv !== null && pv !== undefined && String(pv).trim() !== '') return String(pv);
  const uv = (user as any)?.empNumber;
  return uv !== null && uv !== undefined && String(uv).trim() !== '' ? String(uv) : null;
}

/**
 * Resolve incomingYear for targetYears eligibility (forms/hackathons/internships
 * `currentYear = now - incomingYear + 1` math). Profile-first, User fallback.
 */
export function resolveIncomingYear(
  user: { incomingYear?: number | null } | null | undefined,
  profiles: ProfileRows | null | undefined,
): number | null {
  const pv = (profiles as any)?.studentProfile?.incomingYear;
  if (typeof pv === 'number' && Number.isFinite(pv)) return pv;
  const uv = (user as any)?.incomingYear;
  return typeof uv === 'number' && Number.isFinite(uv) ? uv : null;
}

/** Current study year (1..4) from incomingYear, else null (eligibility helper). */
export function currentStudyYear(incomingYear: number | null | undefined, nowY?: number): number | null {
  if (typeof incomingYear !== 'number' || !Number.isFinite(incomingYear)) return null;
  const y = typeof nowY === 'number' ? nowY : new Date().getFullYear();
  return Math.min(y - Math.trunc(incomingYear) + 1, 4);
}

/**
 * Best-effort profile dual-write (pre-migration safe). Never throws: missing
 * tables (P2022/Unknown argument) resolve to { skipped: true }.
 * Call AFTER the User row exists (needs userId); pass role to pick the table.
 */
export async function dualWriteProfiles(
  db: any,
  args: { userId: string; role: string; studentId?: unknown; empNumber?: unknown; incomingYear?: unknown; outgoingYear?: unknown },
): Promise<{ written: 'student' | 'staff' | 'none'; skipped: boolean }> {
  const { userId, role } = args as any;
  if (!userId) return { written: 'none', skipped: true };
  try {
    if (isStudentRole(role)) {
      const data = buildStudentProfileData(args as any);
      const m = (db as any)?.studentProfile;
      if (!m?.upsert) return { written: 'none', skipped: true };
      // Always upsert 1:1 row (even all-NULL → 1:1 holds for reconciliation).
      await m.upsert({
        where: { userId },
        create: { userId, studentId: data.studentId, incomingYear: data.incomingYear, outgoingYear: data.outgoingYear },
        update: { studentId: data.studentId, incomingYear: data.incomingYear, outgoingYear: data.outgoingYear },
      });
      return { written: 'student', skipped: false };
    }
    if (isStaffRole(role)) {
      const data = buildStaffProfileData(args as any);
      const m = (db as any)?.staffProfile;
      if (!m?.upsert) return { written: 'none', skipped: true };
      await m.upsert({
        where: { userId },
        create: { userId, empNumber: data.empNumber },
        update: { empNumber: data.empNumber },
      });
      return { written: 'staff', skipped: false };
    }
    return { written: 'none', skipped: true };
  } catch {
    return { written: 'none', skipped: true };
  }
}

/**
 * Fetch a user with profiles for merged reads (profile-first, User fallback).
 * Returns null when the user is missing; profiles degrade to nulls when the
 * tables predate migration (never throws).
 */
export async function getUserWithProfiles(
  db: any,
  userId: string,
  select?: Record<string, boolean>,
): Promise<{ user: any; studentProfile: any | null; staffProfile: any | null } | null> {
  try {
    const baseSelect = select ?? { id: true, role: true, studentId: true, empNumber: true, incomingYear: true, outgoingYear: true };
    const user = await (db as any)?.user?.findUnique?.({ where: { id: userId }, select: baseSelect });
    if (!user) return null;
    let studentProfile: any = null;
    let staffProfile: any = null;
    try {
      if (isStudentRole((user as any).role)) {
        studentProfile = await (db as any)?.studentProfile?.findUnique?.({ where: { userId } }).catch(() => null);
      } else if (isStaffRole((user as any).role)) {
        staffProfile = await (db as any)?.staffProfile?.findUnique?.({ where: { userId } }).catch(() => null);
      }
    } catch {
      // pre-migration: profiles stay null → User-twin fallback in resolvers
    }
    return { user, studentProfile: studentProfile ?? null, staffProfile: staffProfile ?? null };
  } catch {
    return null;
  }
}
