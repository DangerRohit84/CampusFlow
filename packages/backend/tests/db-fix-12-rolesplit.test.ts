/**
 * DB Fix Order 12 FINAL — God-table split phase 2 (V-03-full CTI expand) + enum
 * remainder slice 2 (V-04-rest: ScheduleType/ChatMessageRole/GradeSource) +
 * hygiene (V-23/V-28 keep-lite, 4 redundant-index drops, 2 timestamp adds) → P3/P7/P8/P10.
 *
 * Hermetic (schema/migration text + pure helpers + static src). No DB.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SCHEMA = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
const MIGRATION_DIR = path.join(__dirname, '../prisma/migrations/20260925000000_order12_rolesplit');
const MIGRATION_SQL_PATH = path.join(MIGRATION_DIR, 'migration.sql');

function modelBlock(model: string): string {
  return SCHEMA.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`, 'm'))?.[0] ?? '';
}

function enumBlock(name: string): string {
  return SCHEMA.match(new RegExp(`enum ${name} \\{[\\s\\S]*?\\n\\}`, 'm'))?.[0] ?? '';
}

describe('order-12: CTI models exist (StudentProfile/StaffProfile 1-1, no AdminProfile)', () => {
  it('StudentProfile has userId PK→FK Cascade + studentId UNIQUE + years + timestamps', () => {
    const b = modelBlock('StudentProfile');
    expect(b, 'StudentProfile exists').toContain('StudentProfile');
    expect(b).toMatch(/userId\s+String\s+@id/);
    expect(b).toMatch(/studentId\s+String\?\s+@unique/);
    expect(b).toMatch(/incomingYear\s+Int\?/);
    expect(b).toMatch(/outgoingYear\s+Int\?/);
    expect(b).toMatch(/createdAt\s+DateTime/);
    expect(b).toMatch(/updatedAt\s+DateTime/);
    expect(b).toMatch(/user\s+User\s+@relation\(fields:\s*\[userId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/);
    expect(b).toMatch(/@@index\(\[studentId\]\)/);
    expect(b).toMatch(/@@map\("StudentProfile"\)/);
  });
  it('StaffProfile has userId PK→FK Cascade + empNumber UNIQUE + timestamps', () => {
    const b = modelBlock('StaffProfile');
    expect(b, 'StaffProfile exists').toContain('StaffProfile');
    expect(b).toMatch(/userId\s+String\s+@id/);
    expect(b).toMatch(/empNumber\s+String\?\s+@unique/);
    expect(b).toMatch(/createdAt\s+DateTime/);
    expect(b).toMatch(/updatedAt\s+DateTime/);
    expect(b).toMatch(/user\s+User\s+@relation\(fields:\s*\[userId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/);
    expect(b).toMatch(/@@index\(\[empNumber\]\)/);
    expect(b).toMatch(/@@map\("StaffProfile"\)/);
  });
  it('no AdminProfile (admins reuse StaffProfile — documented, zero admin-only cols)', () => {
    expect(SCHEMA).not.toMatch(/model AdminProfile\s*\{/);
    expect(SCHEMA).toMatch(/No AdminProfile/);
  });
  it('User keeps twins (transition, NOT dropped) + adds profile relations', () => {
    const b = modelBlock('User');
    expect(b).toMatch(/studentId\s+String\?\s+@unique/);
    expect(b).toMatch(/empNumber\s+String\?\s+@unique/);
    expect(b).toMatch(/incomingYear\s+Int\?/);
    expect(b).toMatch(/outgoingYear\s+Int\?/);
    expect(b).toMatch(/studentProfile\s+StudentProfile\?/);
    expect(b).toMatch(/staffProfile\s+StaffProfile\?/);
    expect(b).toMatch(/TRANSITION TWINS|dual-write/i);
  });
  it('new profile PKs use no cuid (uuid pick-one for new tables; cuid stays on old tables only)', () => {
    const s = modelBlock('StudentProfile');
    const t = modelBlock('StaffProfile');
    expect(s).not.toMatch(/@default\(cuid\(\)\)/);
    expect(t).not.toMatch(/@default\(cuid\(\)\)/);
  });
});

describe('order-12: enum remainder slice 2 (closed 3, open stays String)', () => {
  it('ScheduleType/ChatMessageRole/GradeSource enums have exact values', () => {
    expect(enumBlock('ScheduleType')).toMatch(/CLASS.*LAB/s);
    expect(enumBlock('ChatMessageRole')).toMatch(/USER.*ASSISTANT/s);
    expect(enumBlock('GradeSource')).toMatch(/MANUAL.*CALCULATOR/s);
  });
  it('3 fields use the new enums (no String)', () => {
    expect(modelBlock('Schedule')).toMatch(/type\s+ScheduleType\b/);
    expect(modelBlock('Schedule').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')).not.toMatch(/type\s+String\b/);
    expect(modelBlock('ChatMessage')).toMatch(/role\s+ChatMessageRole\b/);
    expect(modelBlock('Grade')).toMatch(/source\s+GradeSource\b/);
  });
  it('open/source-driven text stays String (slice boundary, documented)', () => {
    expect(modelBlock('Hackathon')).toMatch(/mode\s+String/);
    expect(modelBlock('Internship')).toMatch(/mode\s+String/);
    expect(modelBlock('Notification')).toMatch(/type\s+String/);
    expect(modelBlock('Room')).toMatch(/chatMode\s+String/);
    expect(modelBlock('Task')).toMatch(/category\s+String/);
    expect(modelBlock('FormField')).toMatch(/type\s+String/);
    expect(modelBlock('Grade')).toMatch(/grade\s+String/);
  });
});

describe('order-12: hygiene tail (indexes + timestamps + keep-lite docs)', () => {
  it('4 redundant indexes dropped (data-safe, covering index kept)', () => {
    const u = modelBlock('User');
    expect(u).toMatch(/@@index\(\[collegeId,\s*role\]\)/);
    expect(u.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')).not.toMatch(/@@index\(\[collegeId\]\)\s*\n/);
    const cc = modelBlock('CodingContest');
    expect(cc).toMatch(/@@index\(\[collegeId,\s*status,\s*createdAt\]\)/);
    const ccCode = cc.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    // No bare @@index([collegeId]) line remains (composite [collegeId, status] kept).
    expect(ccCode).not.toMatch(/@@index\(\[collegeId\]\)/);
    const f = modelBlock('Form');
    expect(f).toMatch(/@@index\(\[collegeId,\s*status,\s*createdAt\]\)/);
    expect(f.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')).not.toMatch(/@@index\(\[collegeId\]\)/);
    const as = modelBlock('AssignmentSubmission');
    expect(as).toMatch(/@@unique\(\[assignmentId,\s*studentId\]\)/);
    expect(as.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')).not.toMatch(/@@index\(\[assignmentId,\s*studentId\]\)/);
  });
  it('Notification + Course gain updatedAt (mutable hygiene)', () => {
    expect(modelBlock('Notification')).toMatch(/updatedAt\s+DateTime/);
    expect(modelBlock('Course')).toMatch(/updatedAt\s+DateTime/);
  });
  it('V-23 recurrence + V-28 pins + decidedAt + delete-policy documented keep-lite', () => {
    expect(SCHEMA).toMatch(/V-23 keep-lite|RRULE-lite/i);
    expect(SCHEMA).toMatch(/V-28 keep-lite|MessagePin/i);
    expect(SCHEMA).toMatch(/decidedAt.*createdAt.*KEPT|first.*last/i);
    expect(SCHEMA).toMatch(/hard-delete \+ cascade|soft-delete/i);
  });
});

describe('order-12: migration file contract (created, NOT applied live)', () => {
  it('migration dir + file exist', () => {
    expect(fs.existsSync(MIGRATION_DIR)).toBe(true);
    expect(fs.existsSync(MIGRATION_SQL_PATH)).toBe(true);
  });
  it('header documents order, deploy-applies, additive-safe, no AdminProfile, twins kept', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toMatch(/Order 12|V-03-full/i);
    expect(sql).toMatch(/NOT APPLIED LIVE/i);
    expect(sql).toMatch(/prisma migrate deploy/i);
    expect(sql).toMatch(/No AdminProfile/i);
    expect(sql).toMatch(/KEPT|twin/i);
  });
  it('creates 3 enum types guarded + 2 CTI tables IF NOT EXISTS', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    for (const t of ['ScheduleType', 'ChatMessageRole', 'GradeSource']) {
      expect(sql, t).toMatch(new RegExp(`CREATE TYPE.*${t}`));
    }
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "StudentProfile"/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "StaffProfile"/);
    expect(sql).toMatch(/DO \$\$ BEGIN/);
  });
  it('FKs/UNIQUEs via guards NOT VALID → VALIDATE + Prisma-conventional index names', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toMatch(/StudentProfile_userId_fkey/);
    expect(sql).toMatch(/StaffProfile_userId_fkey/);
    expect(sql).toMatch(/NOT VALID/);
    expect(sql).toMatch(/VALIDATE CONSTRAINT/);
    expect(sql).toMatch(/StudentProfile_studentId_idx/);
    expect(sql).toMatch(/StaffProfile_empNumber_idx/);
  });
  it('backfills per-role with NOT EXISTS + ON CONFLICT DO NOTHING (re-runnable, 1:1 even all-NULL)', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toMatch(/WHERE u\."role" = 'STUDENT'/);
    expect(sql).toMatch(/WHERE u\."role" IN \('TEACHER', 'COLLEGE_ADMIN', 'SUPER_ADMIN'\)/);
    expect(sql).toMatch(/NOT EXISTS/);
    expect(sql).toMatch(/ON CONFLICT \("userId"\) DO NOTHING/);
  });
  it('enum normalize → safe defaults + NOTICE + ALTER USING upper-trim', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toMatch(/RAISE NOTICE.*Order12.*unknown/s);
    expect(sql).toMatch(/ALTER TABLE "Schedule" ALTER COLUMN "type" TYPE "ScheduleType" USING/);
    expect(sql).toMatch(/ALTER TABLE "ChatMessage" ALTER COLUMN "role" TYPE "ChatMessageRole" USING/);
    expect(sql).toMatch(/ALTER TABLE "Grade" ALTER COLUMN "source" TYPE "GradeSource" USING/);
    expect(sql).toMatch(/UPPER.*TRIM/s);
  });
  it('timestamp adds + 4 index drops (plain DROP + CONCURRENTLY scale note)', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toMatch(/ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "updatedAt"/);
    expect(sql).toMatch(/ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "updatedAt"/);
    for (const idx of ['User_collegeId_idx', 'CodingContest_collegeId_idx', 'Form_collegeId_idx', 'AssignmentSubmission_assignmentId_studentId_idx']) {
      expect(sql, idx).toContain(`DROP INDEX IF EXISTS "${idx}"`);
    }
    expect(sql).toMatch(/CONCURRENTLY/i);
  });
  it('reconciliation census covers coverage + divergence + orphans + ghosts', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toMatch(/NOT EXISTS.*StudentProfile/s);
    expect(sql).toMatch(/IS DISTINCT FROM/);
    expect(sql).toMatch(/LEFT JOIN "User"/);
  });
});

describe('order-12: userProfiles pure helpers (never throw, profile-first fallback)', () => {
  it('role guards split student vs staff (unknown → neither)', async () => {
    const up = await import('../src/utils/userProfiles');
    expect(up.isStudentRole('STUDENT')).toBe(true);
    expect(up.isStudentRole('TEACHER')).toBe(false);
    expect(up.isStaffRole('TEACHER')).toBe(true);
    expect(up.isStaffRole('COLLEGE_ADMIN')).toBe(true);
    expect(up.isStaffRole('SUPER_ADMIN')).toBe(true);
    expect(up.isStaffRole('STUDENT')).toBe(false);
    expect(up.isStaffRole('GHOST')).toBe(false);
  });
  it('buildStudentProfileData derives outgoingYear +4 + clamps garbage', async () => {
    const up = await import('../src/utils/userProfiles');
    expect(up.buildStudentProfileData({ studentId: ' S1 ', incomingYear: 2023 })).toEqual({
      studentId: 'S1', incomingYear: 2023, outgoingYear: 2027,
    });
    expect(up.buildStudentProfileData({ studentId: '', incomingYear: 'nope' })).toEqual({
      studentId: null, incomingYear: null, outgoingYear: null,
    });
    expect(up.hasStudentProfileData({ studentId: null, incomingYear: null, outgoingYear: null })).toBe(false);
    expect(up.hasStudentProfileData({ studentId: 'S1', incomingYear: null, outgoingYear: null })).toBe(true);
  });
  it('buildStaffProfileData clamps + has-check', async () => {
    const up = await import('../src/utils/userProfiles');
    expect(up.buildStaffProfileData({ empNumber: ' E9 ' })).toEqual({ empNumber: 'E9' });
    expect(up.buildStaffProfileData({ empNumber: '' })).toEqual({ empNumber: null });
    expect(up.hasStaffProfileData({ empNumber: null })).toBe(false);
  });
  it('resolveStudentFields prefers profile, falls back to User twins', async () => {
    const up = await import('../src/utils/userProfiles');
    const user = { studentId: 'U1', incomingYear: 2022, outgoingYear: 2026 };
    // Profile wins when present.
    expect(up.resolveStudentFields(user, { studentProfile: { studentId: 'P1', incomingYear: 2023, outgoingYear: 2027 } })).toEqual({
      studentId: 'P1', incomingYear: 2023, outgoingYear: 2027,
    });
    // Fallback when profile absent (pre-migration).
    expect(up.resolveStudentFields(user, null)).toEqual({ studentId: 'U1', incomingYear: 2022, outgoingYear: 2026 });
    expect(up.resolveStudentFields(null, null)).toEqual({ studentId: null, incomingYear: null, outgoingYear: null });
  });
  it('resolveStaffEmpNumber + resolveIncomingYear + currentStudyYear', async () => {
    const up = await import('../src/utils/userProfiles');
    expect(up.resolveStaffEmpNumber({ empNumber: 'U9' }, { staffProfile: { empNumber: 'P9' } })).toBe('P9');
    expect(up.resolveStaffEmpNumber({ empNumber: 'U9' }, null)).toBe('U9');
    expect(up.resolveStaffEmpNumber(null, null)).toBeNull();
    expect(up.resolveIncomingYear({ incomingYear: 2022 }, { studentProfile: { incomingYear: 2023 } })).toBe(2023);
    expect(up.resolveIncomingYear({ incomingYear: 2022 }, null)).toBe(2022);
    expect(up.currentStudyYear(2023, 2024)).toBe(2);
    expect(up.currentStudyYear(null)).toBeNull();
  });
  it('dualWriteProfiles is pre-migration safe (missing tables → skipped, never throws)', async () => {
    const up = await import('../src/utils/userProfiles');
    const noTables: any = {};
    await expect(up.dualWriteProfiles(noTables, { userId: 'u1', role: 'STUDENT', studentId: 'S1' })).resolves.toEqual({ written: 'none', skipped: true });
    // Mock tables: student upsert called, staff not.
    let studentCalled: any = null; let staffCalled: any = null;
    const mock: any = {
      studentProfile: { upsert: async (a: any) => { studentCalled = a; return a; } },
      staffProfile: { upsert: async (a: any) => { staffCalled = a; return a; } },
    };
    await expect(up.dualWriteProfiles(mock, { userId: 'u1', role: 'STUDENT', studentId: 'S1', incomingYear: 2023 })).resolves.toEqual({ written: 'student', skipped: false });
    expect(studentCalled.where).toEqual({ userId: 'u1' });
    expect(studentCalled.create.studentId).toBe('S1');
    expect(staffCalled).toBeNull();
    await expect(up.dualWriteProfiles(mock, { userId: 'u2', role: 'TEACHER', empNumber: 'E2' })).resolves.toEqual({ written: 'staff', skipped: false });
  });
  it('getUserWithProfiles degrades to User twins when tables absent', async () => {
    const up = await import('../src/utils/userProfiles');
    const db: any = { user: { findUnique: async () => ({ id: 'u1', role: 'STUDENT', studentId: 'S1', incomingYear: 2023, outgoingYear: 2027 }) } };
    const out = await up.getUserWithProfiles(db, 'u1');
    expect(out?.user?.id).toBe('u1');
    expect(out?.studentProfile).toBeNull();
    const dbMissing: any = { user: { findUnique: async () => null } };
    await expect(up.getUserWithProfiles(dbMissing, 'nope')).resolves.toBeNull();
  });
});

describe('order-12: validators SSOT (new enums + recurrence grammar)', () => {
  it('zod enums parse valid + reject ghost (match Prisma)', async () => {
    const v = await import('../src/lib/validators');
    expect((v as any).ScheduleTypeEnum.parse('CLASS')).toBe('CLASS');
    expect((v as any).ScheduleTypeEnum.parse('LAB')).toBe('LAB');
    expect(() => (v as any).ScheduleTypeEnum.parse('LECTURE' as any)).toThrow();
    expect((v as any).ChatMessageRoleEnum.parse('USER')).toBe('USER');
    expect((v as any).ChatMessageRoleEnum.parse('ASSISTANT')).toBe('ASSISTANT');
    expect(() => (v as any).ChatMessageRoleEnum.parse('system' as any)).toThrow();
    expect((v as any).GradeSourceEnum.parse('MANUAL')).toBe('MANUAL');
    expect((v as any).GradeSourceEnum.parse('CALCULATOR')).toBe('CALCULATOR');
    expect(() => (v as any).GradeSourceEnum.parse('AUTO' as any)).toThrow();
  });
  it('recurrence grammar accepts NULL/empty/RRULE-lite, rejects garbage', async () => {
    const v = await import('../src/lib/validators');
    expect((v as any).isValidRecurrence(null)).toBe(true);
    expect((v as any).isValidRecurrence('')).toBe(true);
    expect((v as any).isValidRecurrence('WEEKLY')).toBe(true);
    expect((v as any).isValidRecurrence('weekly;interval=2;count=10')).toBe(true);
    expect((v as any).isValidRecurrence('every friday')).toBe(false);
    expect((v as any).normalizeRecurrence('weekly')).toBe('WEEKLY');
    expect((v as any).normalizeRecurrence(null)).toBeNull();
  });
});

describe('order-12: writers dual-write + readers profile-first (static, contracts identical)', () => {
  it('auth register dual-writes profiles (both create paths covered)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/routes/auth.ts'), 'utf8');
    expect(src).toMatch(/dualWriteProfiles/);
    expect(src).toMatch(/Order 12 CTI dual-write/);
  });
  it('auth login + me resolve profile-first with User fallback (same keys)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/routes/auth.ts'), 'utf8');
    expect(src).toMatch(/resolveStudentFields/);
    expect(src).toMatch(/resolveStaffEmpNumber/);
    // Response keys unchanged (contract identical).
    expect(src).toMatch(/incomingYear:/);
    expect(src).toMatch(/studentId:/);
    expect(src).toMatch(/empNumber:/);
  });
  it('admin teacher/student creators dual-write profiles', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/routes/admin.ts'), 'utf8');
    const hits = src.match(/dualWriteProfiles/g) || [];
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });
  it('adminBulk mirrors twins into profile createMany (best-effort, skipDuplicates)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/services/adminBulk.ts'), 'utf8');
    expect(src).toMatch(/staffProfile\?\.createMany/);
    expect(src).toMatch(/studentProfile\?\.createMany/);
    expect(src).toMatch(/skipDuplicates: true/);
  });
  it('schedules coerce type to CLASS/LAB (DB enum never 500s on AI free text)', () => {
    const sched = fs.readFileSync(path.join(__dirname, '../src/routes/schedules.ts'), 'utf8');
    expect(sched).toMatch(/LAB.*CLASS|CLASS.*LAB/s);
    const tt = fs.readFileSync(path.join(__dirname, '../src/routes/timetable.ts'), 'utf8');
    expect(tt).toMatch(/Order 12: ScheduleType enum/);
  });
});
