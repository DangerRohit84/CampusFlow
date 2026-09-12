/**
 * DB Fix Order 11 — Grade/Attendance payloads + 1–1 hygiene (V-15, V-16, V-31) → P6/P9.
 *
 * - V-15: GradeData.subjects blob duplicating normalized Grade → Grade is the
 *   record (subject/subjectCode/source + updatedAt); GradeData keeps blob during dual-write.
 * - V-16: AttendanceData.subjects blob hiding below-X% queries → new
 *   AttendanceRecord(studentId, subject, date, status, present, total); aggregates
 *   via SUM(present)/SUM(total) GROUP BY subject.
 * - V-31: GradeData gains timestamps; AttendanceData redundant @@index dropped;
 *   Grade gains updatedAt.
 *
 * Contract: expand phase of P5 — record tables/columns + dual-write (write-both),
 * read-new with blob fallback, blobs KEPT (contract/drop is a later order).
 * Hermetic (schema/migration text + pure helpers + static src, no DB).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  parseGradeSubjectsInput,
  gradeToGpa,
  buildGradeRows,
  resolveGradeSubjects,
  hasGradeRows,
  parseAttendanceSubjectsInput,
  attendancePct,
  isBelowThreshold,
  deriveAttendanceStatus,
  buildAttendanceRecordRows,
  resolveAttendanceSubjects,
  hasAttendanceRecords,
  GRADE_CALCULATOR_SOURCE,
  GRADE_CALCULATOR_SEMESTER,
} from '../src/utils/gradeAttendance';

const SCHEMA = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
const MIGRATION_DIR = path.join(__dirname, '../prisma/migrations/20260924000000_order11_grade_attendance');
const MIGRATION_SQL_PATH = path.join(MIGRATION_DIR, 'migration.sql');

function modelBlock(model: string): string {
  return SCHEMA.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`, 'm'))?.[0] ?? '';
}
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

// ── Schema: Grade is the record ────────────────────────────────────────────
describe('order-11: Grade record columns + hygiene (V-15/V-31)', () => {
  it('Grade has subject/subjectCode/source/updatedAt + calculator/source indexes', () => {
    const b = modelBlock('Grade');
    expect(b).toMatch(/subject\s+String\?/);
    expect(b).toMatch(/subjectCode\s+String\?/);
    // Order 12 (V-04-rest slice 2): source String → GradeSource enum
    // (MANUAL/CALCULATOR). Accept either during rollout; Order-12 test locks enum.
    expect(b).toMatch(/source\s+(String|GradeSource)/);
    expect(b).toMatch(/updatedAt\s+DateTime\s+@updatedAt/);
    expect(b).toMatch(/@@index\(\[userId,\s*source\]\)/);
    expect(b).toMatch(/@@index\(\[userId,\s*subject\]\)/);
    expect(b).toMatch(/onDelete:\s*Cascade/);
  });
  it('GradeData keeps blob (expand phase) + gains timestamps (V-31)', () => {
    const b = modelBlock('GradeData');
    expect(b).toMatch(/subjects\s+String/);
    expect(b).toMatch(/scale\s+String/);
    expect(b).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)/);
    expect(b).toMatch(/updatedAt\s+DateTime\s+@updatedAt/);
    expect(b).toMatch(/onDelete:\s*Cascade/);
  });
  it('Grade keeps institutional indexes + user relation', () => {
    const b = modelBlock('Grade');
    expect(b).toMatch(/@@index\(\[userId\]\)/);
    expect(b).toMatch(/@@index\(\[userId,\s*semester\]\)/);
  });
});

// ── Schema: AttendanceRecord + V-31 index drop ─────────────────────────────
describe('order-11: AttendanceRecord rows + AttendanceData hygiene (V-16/V-31)', () => {
  it('AttendanceStatus enum has PRESENT/ABSENT/EXCUSED/LATE', () => {
    expect(SCHEMA).toMatch(/enum AttendanceStatus\s*\{[\s\S]*?PRESENT[\s\S]*?ABSENT[\s\S]*?EXCUSED[\s\S]*?LATE[\s\S]*?\}/);
  });
  it('AttendanceRecord has student+date+status AND subject+present+total + Cascade + UNIQUE + indexes', () => {
    const b = modelBlock('AttendanceRecord');
    expect(b).toMatch(/studentId\s+String/);
    expect(b).toMatch(/subject\s+String/);
    expect(b).toMatch(/date\s+DateTime/);
    expect(b).toMatch(/status\s+AttendanceStatus/);
    expect(b).toMatch(/present\s+Int/);
    expect(b).toMatch(/total\s+Int/);
    expect(b).toMatch(/onDelete:\s*Cascade/);
    expect(b).toMatch(/@@unique\(\[studentId,\s*subject\]\)/);
    expect(b).toMatch(/@@index\(\[studentId\]\)/);
    expect(b).toMatch(/@@index\(\[studentId,\s*subject\]\)/);
    expect(b).toMatch(/@@index\(\[studentId,\s*date\]\)/);
  });
  it('AttendanceData keeps blob + requiredPct + timestamps (expand phase — no drops)', () => {
    const b = modelBlock('AttendanceData');
    expect(b).toMatch(/subjects\s+String/);
    expect(b).toMatch(/requiredPct\s+Int/);
    expect(b).toMatch(/createdAt\s+DateTime/);
    expect(b).toMatch(/updatedAt\s+DateTime/);
  });
  it('AttendanceData redundant @@index([studentId]) DROPPED (@unique already indexes)', () => {
    const b = modelBlock('AttendanceData');
    const code = b.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/@@index\(\[studentId\]\)/);
  });
  it('back-relations exist (User.attendanceRecords + Grade.user)', () => {
    expect(modelBlock('User')).toContain('attendanceRecords');
    expect(modelBlock('User')).toContain('AttendanceRecord');
    expect(modelBlock('User')).toContain('gradeData');
    expect(modelBlock('User')).toContain('attendanceData');
  });
});

// ── Migration file contract ────────────────────────────────────────────────
describe('order-11: migration is additive-safe + backfills blobs', () => {
  it('dir + file exist', () => {
    expect(fs.existsSync(MIGRATION_DIR)).toBe(true);
    expect(fs.existsSync(MIGRATION_SQL_PATH)).toBe(true);
  });
  it('header documents order, violations, deploy-applies, dual-write, no-drop', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toMatch(/Order 11/i);
    expect(sql).toMatch(/V-15|V-16|V-31/);
    expect(sql).toMatch(/NOT APPLIED LIVE/i);
    expect(sql).toMatch(/prisma migrate deploy/i);
    expect(sql).toMatch(/dual-write/i);
    expect(sql).toMatch(/do NOT drop/i);
  });
  it('adds columns + creates AttendanceRecord IF NOT EXISTS (additive only)', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "AttendanceRecord"');
    for (const c of ['"subject"', '"subjectCode"', '"source"', '"updatedAt"', '"createdAt"']) {
      expect(sql, c).toContain(`ADD COLUMN IF NOT EXISTS ${c}`);
    }
    expect(sql).toMatch(/CREATE TYPE "AttendanceStatus"/);
  });
  it('FK + UNIQUE use guards + NOT VALID → VALIDATE with Prisma-conventional names', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    for (const c of ['AttendanceRecord_studentId_subject_key', 'AttendanceRecord_studentId_fkey']) {
      expect(sql, c).toContain(c);
    }
    expect(sql).toMatch(/NOT VALID/);
    expect(sql).toMatch(/VALIDATE CONSTRAINT "AttendanceRecord_studentId_fkey"/);
    expect(sql).toMatch(/ON DELETE CASCADE/);
  });
  it('backfills cover both blobs (jsonb_array_elements + idempotent guards)', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toMatch(/jsonb_array_elements/);
    expect(sql).toMatch(/pg_input_is_valid/);
    expect(sql).toMatch(/ON CONFLICT \("studentId", "subject"\) DO NOTHING/);
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM "Grade"/);
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM "AttendanceRecord"/);
    expect(sql).toMatch(/'CALCULATOR'/);
  });
  it('no DROP COLUMN on blobs (they survive; contract is later) + only redundant index dropped', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).not.toMatch(/ALTER TABLE "(GradeData|AttendanceData)" DROP COLUMN/);
    expect(sql).not.toMatch(/DROP COLUMN IF EXISTS "subjects"/);
    expect(sql).toContain('DROP INDEX IF EXISTS "AttendanceData_studentId_idx"');
  });
  it('analytics indexes + reconciliation census present (below-X% GROUP BY)', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toContain('AttendanceRecord_studentId_subject_idx');
    expect(sql).toContain('Grade_userId_source_idx');
    expect(sql).toMatch(/GROUP BY "studentId", "subject"/);
    expect(sql).toMatch(/SUM\("present"\)/);
  });
});

// ── Pure helpers: grades ───────────────────────────────────────────────────
describe('order-11: parseGradeSubjectsInput + gradeToGpa (blob → rows)', () => {
  it('normalizes {name,code,credits,grade} arrays; garbage → [] (never throws)', () => {
    expect(parseGradeSubjectsInput([{ name: 'Maths', code: 'MA101', credits: 4, grade: 'A' }])).toEqual([
      { name: 'Maths', code: 'MA101', credits: 4, grade: 'A' },
    ]);
    expect(parseGradeSubjectsInput('[{"name":"P","credits":3,"grade":"B"}]')).toHaveLength(1);
    expect(parseGradeSubjectsInput('junk')).toEqual([]);
    expect(parseGradeSubjectsInput(null)).toEqual([]);
    expect(parseGradeSubjectsInput({})).toEqual([]);
  });
  it('skips empty names + clamps credits + caps count', () => {
    expect(parseGradeSubjectsInput([{ name: '', grade: 'A' }, { name: 'X', grade: 'A' }])).toHaveLength(1);
    expect(parseGradeSubjectsInput([{ name: 'X', credits: 999, grade: 'A' }])[0].credits).toBe(10);
    expect(parseGradeSubjectsInput(new Array(100).fill({ name: 'X', grade: 'A' })).length).toBeLessThanOrEqual(50);
  });
  it('gradeToGpa matches migration CASE (10-scale + 4-scale)', () => {
    expect(gradeToGpa('O', '10')).toBe(10.0);
    expect(gradeToGpa('A+', '10')).toBe(9.0);
    expect(gradeToGpa('F', '10')).toBe(0.0);
    expect(gradeToGpa('junk', '10')).toBe(0.0);
    expect(gradeToGpa('A', '4')).toBe(4.0);
    expect(gradeToGpa('B', '4')).toBe(3.0);
    expect(gradeToGpa('F', '4')).toBe(0.0);
  });
  it('buildGradeRows stamps CALCULATOR source + semester 0 + gpa', () => {
    const rows = buildGradeRows([{ name: 'Maths', code: 'MA101', credits: 4, grade: 'A' }], '10');
    expect(rows[0]).toMatchObject({ subject: 'Maths', subjectCode: 'MA101', credits: 4, grade: 'A', gpa: 8.0 });
    expect(rows[0].source).toBe(GRADE_CALCULATOR_SOURCE);
    expect(rows[0].semester).toBe(GRADE_CALCULATOR_SEMESTER);
    expect(buildGradeRows(null as any)).toEqual([]);
  });
  it('resolveGradeSubjects: record rows win; blob fallback; garbage → []', () => {
    expect(
      resolveGradeSubjects({ subjects: '[{"name":"Blob","grade":"B"}]', gradeRows: [{ subject: 'Rec', credits: 3, grade: 'A' }] }),
    ).toEqual([{ name: 'Rec', code: '', credits: 3, grade: 'A' }]);
    expect(resolveGradeSubjects({ subjects: '[{"name":"Blob","grade":"B"}]' })).toEqual([
      { name: 'Blob', code: '', credits: 3, grade: 'B' },
    ]);
    expect(resolveGradeSubjects({ subjects: 'junk' })).toEqual([]);
    expect(hasGradeRows({ gradeRows: [{ subject: 'X' }] })).toBe(true);
    expect(hasGradeRows({} as any)).toBe(false);
  });
});

// ── Pure helpers: attendance ───────────────────────────────────────────────
describe('order-11: attendance parse + pct + status (blob → rows)', () => {
  it('normalizes {name,held,attended}; garbage → [] (never throws)', () => {
    expect(parseAttendanceSubjectsInput([{ name: 'Maths', held: 40, attended: 35 }])).toEqual([
      { name: 'Maths', held: 40, attended: 35 },
    ]);
    expect(parseAttendanceSubjectsInput('[{"name":"P","held":10,"attended":9}]')).toHaveLength(1);
    expect(parseAttendanceSubjectsInput('junk')).toEqual([]);
    expect(parseAttendanceSubjectsInput(null)).toEqual([]);
  });
  it('attendancePct rounds to 2dp; total=0 → 100 (never low)', () => {
    expect(attendancePct(35, 40)).toBe(87.5);
    expect(attendancePct(0, 0)).toBe(100);
    expect(isBelowThreshold(35, 40, 75)).toBe(false);
    expect(isBelowThreshold(20, 40, 75)).toBe(true);
    expect(isBelowThreshold(0, 0, 75)).toBe(false);
  });
  it('deriveAttendanceStatus matches migration (total=0 PRESENT; else vs threshold)', () => {
    expect(deriveAttendanceStatus(35, 40, 75)).toBe('PRESENT');
    expect(deriveAttendanceStatus(20, 40, 75)).toBe('ABSENT');
    expect(deriveAttendanceStatus(0, 0, 75)).toBe('PRESENT');
  });
  it('buildAttendanceRecordRows derives status per threshold', () => {
    const rows = buildAttendanceRecordRows([{ name: 'Maths', held: 40, attended: 20 }], 75);
    expect(rows[0]).toMatchObject({ subject: 'Maths', present: 20, total: 40, status: 'ABSENT' });
    expect(buildAttendanceRecordRows(null as any)).toEqual([]);
  });
  it('resolveAttendanceSubjects: record rows win; blob fallback; garbage → []', () => {
    expect(
      resolveAttendanceSubjects({ subjects: '[{"name":"Blob","held":10,"attended":10}]', recordRows: [{ subject: 'Rec', present: 5, total: 10 }] }),
    ).toEqual([{ name: 'Rec', held: 10, attended: 5 }]);
    expect(resolveAttendanceSubjects({ subjects: '[{"name":"Blob","held":10,"attended":9}]' })).toEqual([
      { name: 'Blob', held: 10, attended: 9 },
    ]);
    expect(resolveAttendanceSubjects({ subjects: 'junk' })).toEqual([]);
    expect(hasAttendanceRecords({ recordRows: [{ subject: 'X' }] })).toBe(true);
    expect(hasAttendanceRecords({} as any)).toBe(false);
  });
});

// ── Routes: dual-write + read-new/fallback ─────────────────────────────────
describe('order-11: routes dual-write (write-both, non-fatal)', () => {
  it('grades.ts: record read-first + blob fallback + dual-write + scoped clear', () => {
    const src = readSrc('src/routes/grades.ts');
    expect(src).toContain('grade.findMany');
    expect(src).toContain('GRADE_CALCULATOR_SOURCE');
    expect(src).toContain('resolveGradeSubjects');
    expect(src).toContain("source: 'record'");
    expect(src).toContain("source: 'blob'");
    expect(src).toContain('grade.deleteMany');
    expect(src).toContain('grade.createMany');
    expect(src).toContain('dual-write non-fatal');
    expect(src).toContain("where: { studentId: req.userId!");
  });
  it('attendance.ts: record read-first + summary below-X% + dual-write', () => {
    const src = readSrc('src/routes/attendance.ts');
    expect(src).toContain('attendanceRecord.findMany');
    expect(src).toContain('resolveAttendanceSubjects');
    expect(src).toContain("source: 'record'");
    expect(src).toContain("source: 'blob'");
    expect(src).toContain('attendanceRecord.deleteMany');
    expect(src).toContain('attendanceRecord.createMany');
    expect(src).toContain('dual-write non-fatal');
    expect(src).toContain('below');
    expect(src).toContain('where: { studentId: userId }');
  });
  it('grades + attendance keep single private SWR header (cache-all contract)', () => {
    const grades = readSrc('src/routes/grades.ts');
    const att = readSrc('src/routes/attendance.ts');
    expect((grades.match(/Cache-Control', 'private/g) || []).length).toBe(1);
    expect((att.match(/Cache-Control', 'private/g) || []).length).toBe(1);
    expect(grades).toContain("'private, max-age=30, stale-while-revalidate=60'");
    expect(att).toContain("'private, max-age=30, stale-while-revalidate=60'");
  });
});
