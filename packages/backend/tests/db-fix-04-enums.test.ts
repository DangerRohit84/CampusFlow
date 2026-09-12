/**
 * DB Fix Order 4 — Enum-as-String slice 1: closed hot domains (V-04 part + V-30 decision) → P7/P8.
 *
 * Hot slice (25 cols):
 * - User.role → UserRole
 * - 14 status cols → per-domain enums (StagingStatus shared for both stagings,
 *   HackathonStatus, InternshipStatus, ContestStatus, CollegeStatus, FormStatus,
 *   ReportStatus, TaskStatus, AssignmentStatus, SubmissionStatus,
 *   RegistrationStatus shared for both registrations, SourceHealthStatus)
 * - 2 decision cols → StagingDecision (APPROVED/REJECTED) + @@index([collegeId, decision])
 * - Report.scope/issueType → ReportScope/ReportIssueType (status already, priority via shared Priority)
 * - 4 priority cols (Assignment/Task/Notification/Report) → shared Priority
 * - 2 platform cols (CodingContest/ContestParticipation) → shared Platform
 * - AssignmentSubmission.submissionChannel → reuse existing SubmissionMode (ONLINE/OFFLINE/HYBRID)
 *
 * Mode (Hackathon/Internship.mode), Notification.type, Task.category, FormField.type,
 * Room.chatMode, Resource.*, PlatformSettings.*, AuditLog.*, AiUsage.*, AiProvider.type
 * stay String — Order 12 remainder (V-04-rest).
 *
 * Hermetic (schema/migration text + zod validators + pure decision helpers + static src).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SCHEMA = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
const MIGRATION_DIR = path.join(__dirname, '../prisma/migrations/20260921000000_order4_enums');
const MIGRATION_SQL_PATH = path.join(MIGRATION_DIR, 'migration.sql');

function modelBlock(model: string): string {
  return SCHEMA.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`, 'm'))?.[0] ?? '';
}

function enumBlock(name: string): string {
  return SCHEMA.match(new RegExp(`enum ${name} \\{[\\s\\S]*?\\n\\}`, 'm'))?.[0] ?? '';
}

describe('order-4: Prisma enums exist (shared where values match, per-domain where not)', () => {
  it('UserRole has 4 roles', () => {
    const b = enumBlock('UserRole');
    expect(b, 'UserRole exists').toContain('UserRole');
    for (const v of ['STUDENT', 'TEACHER', 'COLLEGE_ADMIN', 'SUPER_ADMIN']) expect(b).toContain(v);
  });
  it('StagingDecision is APPROVED/REJECTED only (pending = absence, V-30)', () => {
    const b = enumBlock('StagingDecision');
    expect(b).toContain('APPROVED');
    expect(b).toContain('REJECTED');
    expect(b).not.toMatch(/\bPENDING\b/);
  });
  it('StagingStatus shared for both stagings (DRAFT/PENDING/ACTIVE/APPROVED/REJECTED)', () => {
    const b = enumBlock('StagingStatus');
    for (const v of ['DRAFT', 'PENDING', 'ACTIVE', 'APPROVED', 'REJECTED']) expect(b).toContain(v);
  });
  it('per-domain status enums match validators SSOT', () => {
    expect(enumBlock('HackathonStatus')).toMatch(/DRAFT.*PUBLISHED.*COMPLETED.*CANCELLED/s);
    expect(enumBlock('InternshipStatus')).toMatch(/ACTIVE.*ENDED/s);
    expect(enumBlock('ContestStatus')).toMatch(/UPCOMING.*ONGOING.*ENDED/s);
    expect(enumBlock('CollegeStatus')).toMatch(/PENDING.*APPROVED.*REJECTED.*SUSPENDED/s);
    expect(enumBlock('FormStatus')).toMatch(/ACTIVE.*CLOSED.*DRAFT/s);
    expect(enumBlock('ReportStatus')).toMatch(/OPEN.*IN_PROGRESS.*RESOLVED.*CLOSED/s);
    expect(enumBlock('TaskStatus')).toMatch(/PENDING.*IN_PROGRESS.*COMPLETED.*CANCELLED/s);
    expect(enumBlock('AssignmentStatus')).toMatch(/PENDING.*IN_PROGRESS.*COMPLETED.*CANCELLED/s);
    expect(enumBlock('SubmissionStatus')).toMatch(/SUBMITTED.*LATE.*GRADED.*RETURNED/s);
    expect(enumBlock('SourceHealthStatus')).toMatch(/OK.*DEGRADED.*DOWN.*UNKNOWN/s);
  });
  it('RegistrationStatus shared (REGISTERED/SELECTED/REJECTED/COMPLETED/ACCEPTED)', () => {
    const b = enumBlock('RegistrationStatus');
    for (const v of ['REGISTERED', 'SELECTED', 'REJECTED', 'COMPLETED', 'ACCEPTED']) expect(b).toContain(v);
  });
  it('Priority shared (LOW/MEDIUM/HIGH/CRITICAL) + ReportScope/IssueType + Platform shared', () => {
    const p = enumBlock('Priority');
    for (const v of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) expect(p).toContain(v);
    expect(enumBlock('ReportScope')).toMatch(/COLLEGE.*WEBSITE/s);
    expect(enumBlock('ReportIssueType')).toMatch(/DESIGN.*BUG.*CRASH.*PERFORMANCE.*SECURITY.*FEATURE_REQUEST.*OTHER/s);
    const plat = enumBlock('Platform');
    for (const v of ['CODEFORCES', 'CODECHEF', 'LEETCODE', 'ATCODER', 'HACKERRANK', 'OTHER']) expect(plat).toContain(v);
  });
});

describe('order-4: hot-slice fields use enums (no String)', () => {
  const CASES: Array<{ model: string; field: string; type: string }> = [
    { model: 'User', field: 'role', type: 'UserRole' },
    { model: 'Assignment', field: 'status', type: 'AssignmentStatus' },
    { model: 'Assignment', field: 'priority', type: 'Priority' },
    { model: 'Task', field: 'status', type: 'TaskStatus' },
    { model: 'Task', field: 'priority', type: 'Priority' },
    { model: 'College', field: 'status', type: 'CollegeStatus' },
    { model: 'Hackathon', field: 'status', type: 'HackathonStatus' },
    { model: 'HackathonRegistration', field: 'status', type: 'RegistrationStatus' },
    { model: 'HackathonStaging', field: 'status', type: 'StagingStatus' },
    { model: 'InternshipStaging', field: 'status', type: 'StagingStatus' },
    { model: 'HackathonStagingDecision', field: 'decision', type: 'StagingDecision' },
    { model: 'InternshipStagingDecision', field: 'decision', type: 'StagingDecision' },
    { model: 'Internship', field: 'status', type: 'InternshipStatus' },
    { model: 'InternshipRegistration', field: 'status', type: 'RegistrationStatus' },
    { model: 'CodingContest', field: 'status', type: 'ContestStatus' },
    { model: 'CodingContest', field: 'platform', type: 'Platform' },
    { model: 'ContestParticipation', field: 'platform', type: 'Platform' },
    { model: 'Form', field: 'status', type: 'FormStatus' },
    { model: 'Report', field: 'status', type: 'ReportStatus' },
    { model: 'Report', field: 'scope', type: 'ReportScope' },
    { model: 'Report', field: 'issueType', type: 'ReportIssueType' },
    { model: 'Report', field: 'priority', type: 'Priority' },
    { model: 'AssignmentSubmission', field: 'status', type: 'SubmissionStatus' },
    { model: 'AssignmentSubmission', field: 'submissionChannel', type: 'SubmissionMode' },
    { model: 'Notification', field: 'priority', type: 'Priority' },
    { model: 'SourceHealth', field: 'status', type: 'SourceHealthStatus' },
  ];
  it('25 hot-slice cols are enum-typed with correct defaults (no String)', () => {
    for (const { model, field, type } of CASES) {
      const block = modelBlock(model);
      expect(block, `${model} block`).toContain(model);
      expect(block, `${model}.${field} → ${type}`).toMatch(new RegExp(`${field}\\s+${type}\\b`));
      const code = block.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      expect(code, `${model}.${field} must not be String`).not.toMatch(new RegExp(`${field}\\s+String\\b`));
    }
  });
  it('deferred V-04-rest stays String (Order 12, not this slice)', () => {
    // Mode + open-text stays String — proves slice boundary.
    expect(modelBlock('Hackathon')).toMatch(/mode\s+String/);
    expect(modelBlock('Internship')).toMatch(/mode\s+String/);
    expect(modelBlock('Notification')).toMatch(/type\s+String/);
    expect(modelBlock('Room')).toMatch(/chatMode\s+String/);
  });
});

describe('order-4: V-30 pending-list index (collegeId, decision)', () => {
  it('both decision tables have @@index([collegeId, decision]) + keep unique + decidedBy index', () => {
    for (const m of ['HackathonStagingDecision', 'InternshipStagingDecision']) {
      const block = modelBlock(m);
      expect(block, `${m} composite`).toMatch(/@@index\(\[collegeId,\s*decision\]\)/);
      expect(block, `${m} unique`).toMatch(/@@unique\(\[stagingId,\s*collegeId\]\)/);
      expect(block, `${m} decidedBy idx`).toMatch(/@@index\(\[decidedBy\]\)/);
    }
  });
  it('decidedAt+createdAt twins kept (additive-safe; drop deferred to Order 12)', () => {
    for (const m of ['HackathonStagingDecision', 'InternshipStagingDecision']) {
      const block = modelBlock(m);
      expect(block).toMatch(/decidedAt\s+DateTime/);
      expect(block).toMatch(/createdAt\s+DateTime/);
    }
  });
});

describe('order-4: migration file contract (created, NOT applied live)', () => {
  it('migration dir + file exist', () => {
    expect(fs.existsSync(MIGRATION_DIR)).toBe(true);
    expect(fs.existsSync(MIGRATION_SQL_PATH)).toBe(true);
  });
  it('header documents order, deploy-applies, additive-safe (no rolling break)', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toMatch(/Order 4|V-04|V-30/i);
    expect(sql).toMatch(/NOT APPLIED LIVE/i);
    expect(sql).toMatch(/prisma migrate deploy/i);
  });
  it('creates 18 enum types (IF NOT EXISTS, idempotent)', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    for (const t of ['"UserRole"', '"StagingDecision"', '"StagingStatus"', '"HackathonStatus"', '"Platform"']) {
      expect(sql, `CREATE TYPE ${t}`).toMatch(new RegExp(`CREATE TYPE.*${t.replace(/"/g, '"')}`));
    }
    expect(sql).toMatch(/DO \$\$ BEGIN.*CREATE TYPE/s);
  });
  it('normalizes legacy role variants + logs unknowns via RAISE NOTICE (no silent ghost)', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toMatch(/ADMIN.*COLLEGE_ADMIN|COLLEGE_ADMIN.*ADMIN/s);
    expect(sql).toMatch(/RAISE NOTICE.*Order4.*unknown/s);
  });
  it('alters hot-slice cols via USING + upper-trim coercion (fails closed on unknowns after normalize)', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toMatch(/ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole" USING/s);
    expect(sql).toMatch(/ALTER TABLE "HackathonStagingDecision" ALTER COLUMN "decision" TYPE "StagingDecision" USING/s);
    expect(sql).toMatch(/UPPER.*TRIM|upper.*trim|btrim/s);
  });
  it('creates (collegeId, decision) indexes (transactional; CONCURRENTLY note for scale)', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS "HackathonStagingDecision_collegeId_decision_idx"/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS "InternshipStagingDecision_collegeId_decision_idx"/);
    expect(sql).toMatch(/CONCURRENTLY/i);
  });
});

describe('order-4: validators SSOT matches Prisma enums (zod today → enum tomorrow done)', () => {
  it('role/status/decision/priority/scope/issueType/platform zod enums parse valid + reject ghost', async () => {
    const v = await import('../src/lib/validators');
    expect(v.RoleEnum.parse('STUDENT')).toBe('STUDENT');
    expect(() => v.RoleEnum.parse('APROVED' as any)).toThrow();
    expect(v.HackathonStatusEnum.parse('PUBLISHED')).toBe('PUBLISHED');
    expect(v.CollegeStatusEnum.parse('SUSPENDED')).toBe('SUSPENDED');
    expect(v.ReportStatusEnum.parse('IN_PROGRESS')).toBe('IN_PROGRESS');
    expect(v.TaskStatusEnum.parse('CANCELLED')).toBe('CANCELLED');
    expect((v as any).AssignmentStatusEnum.parse('PENDING')).toBe('PENDING');
    expect((v as any).SubmissionStatusEnum.parse('GRADED')).toBe('GRADED');
    expect((v as any).RegistrationStatusEnum.parse('REGISTERED')).toBe('REGISTERED');
    expect((v as any).StagingDecisionEnum.parse('APPROVED')).toBe('APPROVED');
    expect(() => (v as any).StagingDecisionEnum.parse('PENDING' as any)).toThrow();
    expect((v as any).ReportScopeEnum.parse('COLLEGE')).toBe('COLLEGE');
    expect((v as any).ReportIssueTypeEnum.parse('BUG')).toBe('BUG');
    expect((v as any).PriorityEnum.parse('CRITICAL')).toBe('CRITICAL');
    expect((v as any).PlatformEnum.parse('LEETCODE')).toBe('LEETCODE');
    expect((v as any).SourceHealthStatusEnum.parse('DEGRADED')).toBe('DEGRADED');
  });
  it('decision helpers accept enum values (APPROVED/REJECTED) + build where fragments', async () => {
    const d = await import('../src/services/opportunities/decisions');
    const w = d.buildDecisionMatchWhere('c1', 'APPROVED' as any);
    expect(JSON.stringify(w)).toContain('APPROVED');
    expect(JSON.stringify(d.buildDecisionExclusionWhere('c1'))).toContain('c1');
  });
});
