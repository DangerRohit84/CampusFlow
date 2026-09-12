/**
 * DB Fix Orders 5-9 combined (medium) — CHECKs + display-copy drops + snapshot
 * contract + temporal types + JSONB/GIN.
 *
 * - Order 5 (V-27/V-03-CHECKs): AssignmentHub scope CHECK + User role-field CHECK → P7
 * - Order 6 (V-01/02/20/21): drop 4 display copies → P1/P6 (joins/projections)
 * - Order 7 (V-29): ContestParticipation snapshot contract (asOf syncedAt) → P1/P6
 * - Order 8 (V-22/32): temporal adds + re-index → P10/P8
 * - Order 9 (V-05/06/19/13-ops): String-JSON → JSONB + GIN → P2/P8
 *
 * Hermetic (schema/migration text + zod/validators + static src, no DB).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SCHEMA = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
const MIGRATION_DIR = path.join(__dirname, '../prisma/migrations/20260922000000_order5_9_checks_copies_temporal_jsonb');
const MIGRATION_SQL_PATH = path.join(MIGRATION_DIR, 'migration.sql');

function modelBlock(model: string): string {
  return SCHEMA.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`, 'm'))?.[0] ?? '';
}
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

// ── Order 5: CHECKs ──────────────────────────────────────────────────────────
describe('order-5: scope + role-field CHECKs (V-27/V-03)', () => {
  it('schema documents chk_assignmenthub_scope + chk_user_role_fields (Order 5 comments)', () => {
    expect(SCHEMA).toContain('chk_assignmenthub_scope');
    expect(SCHEMA).toContain('chk_user_role_fields');
    expect(modelBlock('AssignmentHub')).toContain('Order 5');
  });
  it('migration adds both CHECKs NOT VALID → VALIDATE (zero-lock)', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toContain('chk_assignmenthub_scope');
    expect(sql).toContain('chk_user_role_fields');
    expect(sql).toMatch(/NOT VALID/);
    expect(sql).toMatch(/VALIDATE CONSTRAINT "chk_assignmenthub_scope"/);
    expect(sql).toMatch(/VALIDATE CONSTRAINT "chk_user_role_fields"/);
    expect(sql).toMatch(/scope.*ALL.*DEPARTMENT.*ROOM/s);
  });
  it('validators mirror CHECKs: isValidAssignmentScope + validateUserRoleFields', async () => {
    const v: any = await import('../src/lib/validators');
    expect(v.isValidAssignmentScope('ALL', null, null)).toBe(true);
    expect(v.isValidAssignmentScope('ALL', 'd1', null)).toBe(false);
    expect(v.isValidAssignmentScope('DEPARTMENT', 'd1', null)).toBe(true);
    expect(v.isValidAssignmentScope('DEPARTMENT', null, null)).toBe(false);
    expect(v.isValidAssignmentScope('ROOM', null, 'r1')).toBe(true);
    expect(v.isValidAssignmentScope('ROOM', 'd1', 'r1')).toBe(false);
    expect(v.validateUserRoleFields('STUDENT', { empNumber: 'E1' })).toContain('empNumber');
    expect(v.validateUserRoleFields('TEACHER', { studentId: 'S1' })).toContain('studentId');
    expect(v.validateUserRoleFields('STUDENT', { studentId: 'S1' })).toBeNull();
    expect(v.validateUserRoleFields('TEACHER', {})).toBeNull();
  });
  it('routes enforce CHECKs as 400 (assignmentHub scope + auth role-fields)', () => {
    const hub = readSrc('src/routes/assignmentHub.ts');
    expect(hub).toContain('departmentId required for DEPARTMENT scope');
    expect(hub).toContain('roomId required for ROOM scope');
    expect(hub).toContain('must be empty for ALL scope');
    const auth = readSrc('src/routes/auth.ts');
    expect(auth).toContain('validateUserRoleFields');
    expect(auth).toContain('chk_user_role_fields');
  });
});

// ── Order 6: display-copy drops ──────────────────────────────────────────────
describe('order-6: 4 display copies dropped (V-01/02/20/21)', () => {
  it('schema has no User.collegeName/departmentName, Report.collegeName, Grade.courseName cols', () => {
    const userCode = modelBlock('User').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(userCode).not.toMatch(/collegeName\s+String/);
    expect(userCode).not.toMatch(/departmentName\s+String/);
    const reportCode = modelBlock('Report').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(reportCode).not.toMatch(/collegeName\s+String/);
    const gradeCode = modelBlock('Grade').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(gradeCode).not.toMatch(/courseName\s+String/);
  });
  it('migration drops all 4 (IF EXISTS, one per table)', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toContain('DROP COLUMN IF EXISTS "collegeName"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "departmentName"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "courseName"');
    expect(sql).toMatch(/ALTER TABLE "User" DROP COLUMN/);
    expect(sql).toMatch(/ALTER TABLE "Report" DROP COLUMN/);
    expect(sql).toMatch(/ALTER TABLE "Grade" DROP COLUMN/);
  });
  it('code resolves via joins/projections (no DB-copy writes; API keeps keys as projection)', async () => {
    const auth = readSrc('src/routes/auth.ts');
    expect(auth).not.toMatch(/departmentName:\s*body\.department/);
    expect(auth).not.toMatch(/collegeName:\s*body\.college/);
    const reports = readSrc('src/routes/reports.ts');
    expect(reports).toContain('college: { select: { id: true, name: true');
    const v: any = await import('../src/lib/validators');
    expect(typeof v.projectCollegeName).toBe('function');
    expect(v.projectCollegeName({ name: 'X' })).toBe('X');
    expect(v.projectDepartmentName({ name: 'CSE' })).toBe('CSE');
    expect(v.projectCourseName({ name: 'SC' })).toBe('SC');
    expect(v.projectCollegeName(null)).toBeNull();
  });
  it('Grade readers include course relation (chat/ai/user)', () => {
    expect(readSrc('src/routes/chat.ts')).toContain('include: { course: { select: { name: true } } }');
    expect(readSrc('src/routes/ai.ts')).toContain('include: { course: { select: { name: true } } }');
  });
});

// ── Order 7: snapshot contract ───────────────────────────────────────────────
describe('order-7: leaderboard snapshot contract (V-29)', () => {
  it('schema documents snapshot (asOf syncedAt) + keeps natural key + adds (contestId, syncedAt) idx', () => {
    const b = modelBlock('ContestParticipation');
    expect(b).toContain('SNAPSHOT_AT_SYNC');
    expect(b).toContain('syncedAt');
    expect(b).toMatch(/@@unique\(\[userId,\s*platform,\s*contestName\]\)/);
    expect(b).toMatch(/@@index\(\[contestId,\s*syncedAt\]\)/);
  });
  it('migration has drift census but no DDL for snapshots (additive-safe)', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toMatch(/ContestParticipation.*CodingContest|participation vs CodingContest/s);
    // No DROP/ALTER on ContestParticipation snapshot cols
    expect(sql).not.toMatch(/ALTER TABLE "ContestParticipation" DROP COLUMN/);
    expect(sql).not.toMatch(/ALTER TABLE "ContestParticipation" ALTER COLUMN "contestName"/);
  });
  it('validators.resolveContestDisplay prefers canonical when linked, else snapshot', async () => {
    const v: any = await import('../src/lib/validators');
    expect(v.resolveContestDisplay({ contestId: 'c1', contestName: 'Snap', contestUrl: 'http://snap' }, { title: 'Canon', url: 'http://canon' })).toEqual({ name: 'Canon', url: 'http://canon', asOf: 'canonical' });
    expect(v.resolveContestDisplay({ contestId: null, contestName: 'Snap', contestUrl: null }, null)).toEqual({ name: 'Snap', url: null, asOf: 'snapshot' });
    expect(v.resolveContestDisplay({ contestName: 'Snap' } as any, null).asOf).toBe('snapshot');
  });
  it('code prefers canonical (codingProfile exact-first + publicProfile asOf + contests comment)', () => {
    expect(readSrc('src/routes/codingProfile.ts')).toContain('resolveContestDisplay');
    expect(readSrc('src/routes/publicProfile.ts')).toContain('asOf');
    expect(readSrc('src/routes/contests.ts')).toContain('resolveContestDisplay');
  });
});

// ── Order 8: temporal ────────────────────────────────────────────────────────
describe('order-8: temporal adds + re-index (V-22/32)', () => {
  it('schema has typed cols alongside legacy Strings (additive, Strings kept)', () => {
    expect(modelBlock('Schedule')).toMatch(/startMinutes\s+Int\?/);
    expect(modelBlock('Schedule')).toMatch(/endMinutes\s+Int\?/);
    expect(modelBlock('Schedule')).toMatch(/startTime\s+String/);
    expect(modelBlock('Task')).toMatch(/startAt\s+DateTime\?/);
    expect(modelBlock('Task')).toMatch(/endAt\s+DateTime\?/);
    expect(modelBlock('Task')).toMatch(/startTime\s+String\?/);
    expect(modelBlock('CodingContest')).toMatch(/startAt\s+DateTime\?/);
    expect(modelBlock('CodingContest')).toMatch(/startTime\s+String/);
    expect(modelBlock('Internship')).toMatch(/startAt\s+DateTime\?/);
    expect(modelBlock('InternshipStaging')).toMatch(/startAt\s+DateTime\?/);
    expect(modelBlock('AiUsage')).toMatch(/dayDate\s+DateTime\?/);
    expect(modelBlock('AiUsage')).toMatch(/day\s+String/);
  });
  it('schema has re-indexes on typed cols (typed ordering/range keys)', () => {
    expect(SCHEMA).toContain('[userId, dayOfWeek, startMinutes]');
    expect(modelBlock('Task')).toMatch(/@@index\(\[startAt\]\)/);
    expect(modelBlock('CodingContest')).toMatch(/@@index\(\[status,\s*startAt\]\)/);
    expect(modelBlock('AiUsage')).toMatch(/@@index\(\[dayDate\]\)/);
    expect(modelBlock('AiUsage')).toMatch(/AiUsage_college_feature_dayDate_unique/);
  });
  it('migration adds + backfills + indexes typed cols (Strings kept until Order 12)', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    for (const c of ['"startMinutes"', '"startAt"', '"dayDate"']) expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${c}`);
    expect(sql).toMatch(/pg_input_is_valid\("startTime", 'timestamptz'\)/);
    expect(sql).toMatch(/pg_input_is_valid\("day", 'date'\)/);
    expect(sql).toContain('chk_schedule_minutes');
    expect(sql).toContain('CodingContest_status_startAt_idx');
    expect(sql).toContain('AiUsage_college_feature_dayDate_unique');
  });
  it('validators temporal helpers parse/dual-write correctly', async () => {
    const v: any = await import('../src/lib/validators');
    expect(v.timeToMinutes('09:30')).toBe(570);
    expect(v.timeToMinutes('9:30')).toBe(570);
    expect(v.timeToMinutes('2:30 PM')).toBe(870);
    expect(v.timeToMinutes('junk')).toBeNull();
    expect(v.timeToMinutes(null)).toBeNull();
    expect(v.minutesToTime(570)).toBe('09:30');
    expect(v.minutesToTime(9999)).toBeNull();
    const d = new Date('2026-09-10T00:00:00.000Z');
    expect(v.combineDateAndTime(d, '09:30')?.getHours()).toBe(9);
    expect(v.dayDateFromBucket('2026-09-10')?.toISOString().slice(0, 10)).toBe('2026-09-10');
    expect(v.dayDateFromBucket('junk')).toBeNull();
    expect(v.coerceStartAt('2026-09-10T10:00:00.000Z')).toBeInstanceOf(Date);
    expect(v.coerceStartAt('Immediate')).toBeNull();
  });
  it('code dual-writes typed cols (schedules/tasks/contests/internships/aiMetering)', () => {
    expect(readSrc('src/routes/schedules.ts')).toContain('timeToMinutes');
    expect(readSrc('src/routes/schedules.ts')).toContain('startMinutes');
    expect(readSrc('src/routes/tasks.ts')).toContain('combineDateAndTime');
    expect(readSrc('src/routes/tasks.ts')).toContain('startAt');
    expect(readSrc('src/routes/contests.ts')).toContain('startAt');
    expect(readSrc('src/services/contestFetcher.ts')).toContain('startAt');
    expect(readSrc('src/routes/internships.ts')).toContain('coerceStartAt');
    expect(readSrc('src/services/aiMetering.ts')).toContain('dayDate');
  });
});

// ── Order 9: JSONB ───────────────────────────────────────────────────────────
describe('order-9: String-JSON → JSONB + GIN (V-05/06/19/13-ops)', () => {
  const CASES = [
    { model: 'User', field: 'preferences' },
    { model: 'CodingProfile', field: 'platformStats' },
    { model: 'Notification', field: 'metadata' },
    { model: 'ChatMessage', field: 'metadata' },
    { model: 'UserIntegration', field: 'metadata' },
    { model: 'AuditLog', field: 'metadata' },
    { model: 'AiProvider', field: 'headers' },
    { model: 'FormField', field: 'logic' },
    { model: 'FormField', field: 'scoreMap' },
  ];
  it('9 cols are Json? (no String) with Json defaults where fixed', () => {
    for (const { model, field } of CASES) {
      const block = modelBlock(model);
      expect(block, `${model} block`).toContain(model);
      expect(block, `${model}.${field} → Json`).toMatch(new RegExp(`${field}\\s+Json\\?`));
      const code = block.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      expect(code, `${model}.${field} must not be String`).not.toMatch(new RegExp(`${field}\\s+String\\?`));
    }
    expect(modelBlock('User')).toContain('@default("{}")');
    expect(modelBlock('FormField')).toContain('@default("{}")');
  });
  it('schema has GIN on JSONB (future @>/?; reads stay app-side)', () => {
    for (const m of ['User_preferences_gin', 'CodingProfile_platformStats_gin', 'Notification_metadata_gin', 'ChatMessage_metadata_gin', 'UserIntegration_metadata_gin', 'AuditLog_metadata_gin', 'AiProvider_headers_gin', 'FormField_logic_gin', 'FormField_scoreMap_gin']) {
      expect(SCHEMA, m).toContain(m);
    }
  });
  it('migration quarantines invalid JSON → ALTER USING ::jsonb → GIN → CHECK typeof object', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toMatch(/pg_input_is_valid\("preferences", 'json'\)/);
    expect(sql).toMatch(/ALTER TABLE "User" ALTER COLUMN "preferences" TYPE JSONB USING/);
    expect(sql).toMatch(/ALTER TABLE "FormField" ALTER COLUMN "logic" TYPE JSONB USING/);
    expect(sql).toContain('User_preferences_gin');
    expect(sql).toContain('FormField_logic_gin');
    expect(sql).toContain('chk_user_preferences_object');
    expect(sql).toContain('chk_formfield_logic_object');
    expect(sql).toMatch(/jsonb_typeof\("preferences"\) = 'object'/);
  });
  it('validators Json helpers accept Json|String (rollout + stale replicas)', async () => {
    const v: any = await import('../src/lib/validators');
    expect(v.parseJsonObjectSafe('{"a":1}')).toEqual({ a: 1 });
    expect(v.parseJsonObjectSafe({ a: 1 })).toEqual({ a: 1 });
    expect(v.parseJsonObjectSafe('junk')).toEqual({});
    expect(v.parsePlatformStatsSafe('[{"x":1}]')).toEqual([{ x: 1 }]);
    expect(v.parsePlatformStatsSafe([{ x: 1 }])).toEqual([{ x: 1 }]);
    expect(v.parsePlatformStatsSafe('junk')).toEqual([]);
    expect(v.parseMetadataSafe('{"k":"v"}')).toEqual({ k: 'v' });
    expect(v.parseMetadataSafe(null)).toBeNull();
    expect(v.parseHeadersSafe('{"A":"b"}')).toEqual({ A: 'b' });
    expect(v.parseHeadersSafe({ A: 'b' })).toEqual({ A: 'b' });
  });
  it('code handles Json|String (mute/audit/headers/stats/logic)', () => {
    expect(readSrc('src/services/room/mute.ts')).toMatch(/Json\|String|unknown/);
    expect(readSrc('src/services/auditLog.ts')).toContain('buildAuditMetadataJson');
    expect(readSrc('src/services/ai-manager.ts')).toContain("typeof (provider as any).headers === 'string'");
    expect(readSrc('src/routes/codingProfile.ts')).toContain('Array.isArray');
    expect(readSrc('src/utils/formLogic.ts')).toContain("typeof value === 'object'");
  });
  it('FormField.options stays String (full child table is Order 10, ops-slice only here)', () => {
    expect(modelBlock('FormField')).toMatch(/options\s+String\?/);
  });
});

// ── Migration file contract ──────────────────────────────────────────────────
describe('order-5-9: migration file contract (created, NOT applied live)', () => {
  it('dir + file exist', () => {
    expect(fs.existsSync(MIGRATION_DIR)).toBe(true);
    expect(fs.existsSync(MIGRATION_SQL_PATH)).toBe(true);
  });
  it('header documents orders, deploy-applies, big-bang vs additive, scale notes', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toMatch(/Order 5-9|V-27|V-01|V-29|V-22|V-05/i);
    expect(sql).toMatch(/NOT APPLIED LIVE/i);
    expect(sql).toMatch(/prisma migrate deploy/i);
    expect(sql).toMatch(/CONCURRENTLY/i);
    expect(sql).toMatch(/pg_input_is_valid/i);
  });
  it('census SELECTs for every order (§0) + idempotent guards (IF NOT EXISTS / DO $$)', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toContain('chk_assignmenthub_scope');
    expect(sql).toContain('DROP COLUMN IF EXISTS');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS');
    expect(sql).toMatch(/DO \$\$ BEGIN/);
  });
});
