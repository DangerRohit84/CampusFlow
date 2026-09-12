/**
 * DB Fix Order 1 — dangling FKs (V-26 + FK onDelete gaps).
 * Static contracts: schema.prisma carries real @relations + onDelete + @@index
 * for every former String FK-lookalike; migration file exists (NOT applied live).
 * Hermetic (no DB): reads schema.prisma + migration.sql as text.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SCHEMA = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
const MIGRATION_DIR = path.join(__dirname, '../prisma/migrations/20260918000000_order1_dangling_fks');
const MIGRATION_SQL = fs.readFileSync(path.join(MIGRATION_DIR, 'migration.sql'), 'utf8');

function expectRelation(model: string, field: string, target: string, onDelete: string) {
  // Find the model block, then the relation line for `field`.
  const modelRe = new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`, 'm');
  const block = SCHEMA.match(modelRe)?.[0] ?? '';
  expect(block, `model ${model} exists`).toContain(`model ${model}`);
  // Relation field line must reference the target + onDelete.
  // Named relations carry ("Name", fields: ...) — allow the optional prefix.
  const lineRe = new RegExp(`^\\s*${field}\\b.*@relation\\((?:"[^"]+",\\s*)?fields:\\s*\\[\\w+\\].*references:\\s*\\[id\\].*onDelete:\\s*${onDelete}`, 'm');
  expect(block, `${model}.${field} → ${target} onDelete:${onDelete}`).toMatch(lineRe);
}

describe('order-1: dangling course/contest/message/view FKs', () => {
  it('Assignment.courseId → Course SetNull + index', () => {
    expectRelation('Assignment', 'course', 'Course', 'SetNull');
    expect(SCHEMA).toMatch(/model Assignment[\s\S]*?@@index\(\[courseId\]\)/);
  });
  it('Task.courseId → Course SetNull + index', () => {
    expectRelation('Task', 'course', 'Course', 'SetNull');
    expect(SCHEMA).toMatch(/model Task[\s\S]*?@@index\(\[courseId\]\)/);
  });
  it('AssignmentHub.courseId → Course SetNull + index', () => {
    expectRelation('AssignmentHub', 'course', 'Course', 'SetNull');
    expect(SCHEMA).toMatch(/model AssignmentHub[\s\S]*?@@index\(\[courseId\]\)/);
  });
  it('ContestParticipation.contestId → CodingContest SetNull', () => {
    expectRelation('ContestParticipation', 'contest', 'CodingContest', 'SetNull');
  });
  it('Resource.sourceMessageId → RoomMessage SetNull + index', () => {
    expectRelation('Resource', 'sourceMessage', 'RoomMessage', 'SetNull');
    expect(SCHEMA).toMatch(/model Resource[\s\S]*?@@index\(\[sourceMessageId\]\)/);
  });
  it('RoomMessage.pinnedBy → User SetNull + index (named relations)', () => {
    expect(SCHEMA).toContain('RoomMessagePinnedBy');
    expect(SCHEMA).toContain('RoomMessageSender');
    expectRelation('RoomMessage', 'pinnedByUser', 'User', 'SetNull');
    expect(SCHEMA).toMatch(/model RoomMessage[\s\S]*?@@index\(\[pinnedBy\]\)/);
  });
  it('FormView.fieldId/userId → FormField/User SetNull + indexes', () => {
    expectRelation('FormView', 'field', 'FormField', 'SetNull');
    expectRelation('FormView', 'viewer', 'User', 'SetNull');
    expect(SCHEMA).toMatch(/model FormView[\s\S]*?@@index\(\[fieldId\]\)/);
    expect(SCHEMA).toMatch(/model FormView[\s\S]*?@@index\(\[userId\]\)/);
  });
});

describe('order-1: decision/audit/billing/auth FKs', () => {
  it('StagingDecision.decidedBy → User SetNull + index (both tables)', () => {
    expect(SCHEMA).toContain('HackathonDecisionBy');
    expect(SCHEMA).toContain('InternshipDecisionBy');
    expectRelation('HackathonStagingDecision', 'decider', 'User', 'SetNull');
    expectRelation('InternshipStagingDecision', 'decider', 'User', 'SetNull');
    expect(SCHEMA).toMatch(/model HackathonStagingDecision[\s\S]*?@@index\(\[decidedBy\]\)/);
    expect(SCHEMA).toMatch(/model InternshipStagingDecision[\s\S]*?@@index\(\[decidedBy\]\)/);
  });
  it('AuditLog.actorId/collegeId → User/College SetNull', () => {
    expectRelation('AuditLog', 'actor', 'User', 'SetNull');
    expectRelation('AuditLog', 'college', 'College', 'SetNull');
  });
  it('AiUsage.collegeId → College Restrict (billing history preserved)', () => {
    expectRelation('AiUsage', 'college', 'College', 'Restrict');
  });
  it('AiRouting/AiProvider.collegeId → College SetNull (+ AiRouting index)', () => {
    expectRelation('AiRouting', 'college', 'College', 'SetNull');
    expectRelation('AiProvider', 'college', 'College', 'SetNull');
    expect(SCHEMA).toMatch(/model AiRouting[\s\S]*?@@index\(\[collegeId\]\)/);
  });
  it('AiQuota.collegeId → College Cascade (owned 1-1 budget)', () => {
    expectRelation('AiQuota', 'college', 'College', 'Cascade');
  });
  it('RevokedToken.userId nullable → User Cascade', () => {
    expect(SCHEMA).toMatch(/model RevokedToken[\s\S]*?userId\s+String\?/);
    expectRelation('RevokedToken', 'user', 'User', 'Cascade');
  });
  it('SyncThrottle.userId PK → User Cascade', () => {
    expectRelation('SyncThrottle', 'user', 'User', 'Cascade');
  });
  it('AuditLog.entityId stays polymorphic (no FK by design)', () => {
    const block = SCHEMA.match(/model AuditLog \{[\s\S]*?\n\}/m)?.[0] ?? '';
    expect(block).toContain('entityId');
    expect(block).not.toMatch(/entity\s+\w+\s+@relation/);
  });
});

describe('order-1: explicit onDelete on College-rooted relations', () => {
  it('User.college/department SetNull', () => {
    expect(SCHEMA).toMatch(/model User[\s\S]*?college\s+College\?\s+@relation\(fields:\s*\[collegeId\][\s\S]*?onDelete:\s*SetNull/);
    expect(SCHEMA).toMatch(/model User[\s\S]*?department\s+Department\?\s+@relation\(fields:\s*\[departmentId\][\s\S]*?onDelete:\s*SetNull/);
  });
  it('Course.college SetNull; Grade.course SetNull', () => {
    expect(SCHEMA).toMatch(/model Course[\s\S]*?college\s+College\?\s+@relation\(fields:\s*\[collegeId\][\s\S]*?onDelete:\s*SetNull/);
    expect(SCHEMA).toMatch(/model Grade[\s\S]*?course\s+Course\?\s+@relation\(fields:\s*\[courseId\][\s\S]*?onDelete:\s*SetNull/);
  });
  it('creators Restrict; nullable colleges SetNull; Internship.college Restrict', () => {
    for (const m of ['Hackathon', 'HackathonStaging', 'InternshipStaging', 'Form', 'Announcement', 'AssignmentHub', 'Internship']) {
      const block = SCHEMA.match(new RegExp(`model ${m} \\{[\\s\\S]*?\\n\\}`, 'm'))?.[0] ?? '';
      expect(block, `${m} creator onDelete`).toMatch(/creator\s+User.*onDelete:\s*(Restrict|SetNull)/);
    }
    expect(SCHEMA).toMatch(/model Internship[\s\S]*?college\s+College\s+@relation\(fields:\s*\[collegeId\][\s\S]*?onDelete:\s*Restrict/);
    expect(SCHEMA).toMatch(/model Room[\s\S]*?teacher\s+User\s+@relation\(fields:\s*\[teacherId\][\s\S]*?onDelete:\s*Restrict/);
    expect(SCHEMA).toMatch(/model Resource[\s\S]*?uploader\s+User\s+@relation\(fields:\s*\[uploadedBy\][\s\S]*?onDelete:\s*Restrict/);
  });
});

describe('order-1: migration file contract (created, NOT applied live)', () => {
  it('migration dir + file exist', () => {
    expect(fs.existsSync(MIGRATION_DIR)).toBe(true);
    expect(fs.existsSync(path.join(MIGRATION_DIR, 'migration.sql'))).toBe(true);
  });
  it('migration declares NOT-APPLIED status + orphan parking', () => {
    expect(MIGRATION_SQL).toMatch(/NOT APPLIED LIVE|NOT APPLIED/i);
    expect(MIGRATION_SQL).toMatch(/Orphan parking|orphan/i);
    expect(MIGRATION_SQL).toMatch(/Assignment.*courseId.*NULL/i);
    expect(MIGRATION_SQL).toMatch(/RevokedToken.*userId.*NULL/i);
  });
  it('migration adds the new FKs + indexes idempotently', () => {
    for (const c of [
      'Assignment_courseId_fkey',
      'Task_courseId_fkey',
      'AssignmentHub_courseId_fkey',
      'ContestParticipation_contestId_fkey',
      'Resource_sourceMessageId_fkey',
      'RoomMessage_pinnedBy_fkey',
      'FormView_fieldId_fkey',
      'FormView_userId_fkey',
      'AuditLog_actorId_fkey',
      'AuditLog_collegeId_fkey',
      'AiUsage_collegeId_fkey',
      'AiRouting_collegeId_fkey',
      'AiProvider_collegeId_fkey',
      'AiQuota_collegeId_fkey',
      'RevokedToken_userId_fkey',
      'SyncThrottle_userId_fkey',
      'HackathonStagingDecision_decidedBy_fkey',
      'InternshipStagingDecision_decidedBy_fkey',
    ]) {
      expect(MIGRATION_SQL, c).toContain(c);
    }
    expect(MIGRATION_SQL).toContain('IF NOT EXISTS');
  });
  it('auth hardening no longer writes the unknown placeholder', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/utils/authHardening.ts'), 'utf8');
    expect(src).not.toMatch(/userId:\s*['"]unknown['"]/);
  });
});
