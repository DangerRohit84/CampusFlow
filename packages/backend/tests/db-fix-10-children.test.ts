/**
 * DB Fix Order 10 — EAV/blob → 4NF child tables (V-13-full, V-14, V-18, V-17) → P9.
 *
 * - V-13-full: FormField.options blob → FormFieldOption(fieldId,value,label,points,order)
 * - V-14:      FormResponse.answers blob → FormAnswer(responseId,fieldId,value)
 * - V-18:      HackathonRegistration.teamMembers CSV → HackathonTeamMember(registrationId,userId?,name)
 * - V-17:      AssignmentHub.attachments blob → AssignmentAttachment(assignmentId,url,…,order)
 *
 * Contract: expand phase of P5 — child tables + dual-write (write-both),
 * read-new with blob fallback, blobs KEPT (contract/drop is a later order).
 * Hermetic (schema/migration text + pure helpers + static src, no DB).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  parseFieldOptionsInput,
  answerToStoredValue,
  buildFormAnswerRows,
  resolveAnswersMap,
  hasChildAnswers,
  parseTeamMembersInput,
  resolveTeamMembersDisplay,
  parseAttachmentUrls,
  resolveAttachmentUrls,
} from '../src/utils/childTables';

const SCHEMA = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
const MIGRATION_DIR = path.join(__dirname, '../prisma/migrations/20260923000000_order10_child_tables');
const MIGRATION_SQL_PATH = path.join(MIGRATION_DIR, 'migration.sql');

function modelBlock(model: string): string {
  return SCHEMA.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`, 'm'))?.[0] ?? '';
}
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

// ── Schema: 4 child tables ───────────────────────────────────────────────────
describe('order-10: child tables exist with FKs + indexes (V-13/V-14/V-18/V-17)', () => {
  it('FormFieldOption has value/label/points/order + Cascade FK + UNIQUE(fieldId,value)', () => {
    const b = modelBlock('FormFieldOption');
    expect(b).toContain('fieldId');
    expect(b).toMatch(/value\s+String/);
    expect(b).toMatch(/label\s+String/);
    expect(b).toMatch(/points\s+Int/);
    expect(b).toMatch(/order\s+Int/);
    expect(b).toMatch(/onDelete:\s*Cascade/);
    expect(b).toMatch(/@@unique\(\[fieldId,\s*value\]\)/);
    expect(b).toMatch(/@@index\(\[fieldId\]\)/);
    expect(b).toMatch(/@@index\(\[fieldId,\s*order\]\)/);
  });
  it('FormAnswer has responseId/fieldId/value + dual Cascade + UNIQUE(responseId,fieldId)', () => {
    const b = modelBlock('FormAnswer');
    expect(b).toMatch(/responseId\s+String/);
    expect(b).toMatch(/fieldId\s+String/);
    expect(b).toMatch(/value\s+String/);
    expect(b).toMatch(/@@unique\(\[responseId,\s*fieldId\]\)/);
    expect(b).toMatch(/@@index\(\[responseId\]\)/);
    expect(b).toMatch(/@@index\(\[fieldId\]\)/);
    expect(b).toMatch(/@@index\(\[fieldId,\s*value\]\)/);
    expect(b.match(/onDelete:\s*Cascade/g)?.length).toBeGreaterThanOrEqual(2);
  });
  it('HackathonTeamMember has registrationId/userId?/name + Cascade/SetNull split', () => {
    const b = modelBlock('HackathonTeamMember');
    expect(b).toMatch(/registrationId\s+String/);
    expect(b).toMatch(/userId\s+String\?/);
    expect(b).toMatch(/name\s+String/);
    expect(b).toMatch(/onDelete:\s*Cascade/);
    expect(b).toMatch(/onDelete:\s*SetNull/);
    expect(b).toMatch(/@@index\(\[registrationId\]\)/);
    expect(b).toMatch(/@@index\(\[userId\]\)/);
  });
  it('AssignmentAttachment has assignmentId/url/order + Cascade + order index', () => {
    const b = modelBlock('AssignmentAttachment');
    expect(b).toMatch(/assignmentId\s+String/);
    expect(b).toMatch(/url\s+String/);
    expect(b).toMatch(/order\s+Int/);
    expect(b).toMatch(/onDelete:\s*Cascade/);
    expect(b).toMatch(/@@index\(\[assignmentId\]\)/);
    expect(b).toMatch(/@@index\(\[assignmentId,\s*order\]\)/);
  });
  it('back-relations exist on parents + User (Prisma relation completeness)', () => {
    expect(modelBlock('FormField')).toContain('fieldOptions FormFieldOption[]');
    expect(modelBlock('FormField')).toContain('answers FormAnswer[]');
    expect(modelBlock('FormResponse')).toContain('answerRows FormAnswer[]');
    expect(modelBlock('HackathonRegistration')).toContain('teamRows  HackathonTeamMember[]');
    expect(modelBlock('AssignmentHub')).toContain('attachmentRows AssignmentAttachment[]');
    expect(modelBlock('User')).toContain('hackathonTeamMemberships HackathonTeamMember[]');
  });
  it('legacy blobs KEPT during transition (expand phase — no drops in Order 10)', () => {
    expect(modelBlock('FormField')).toMatch(/options\s+String\?/);
    expect(modelBlock('FormResponse')).toMatch(/answers\s+String/);
    expect(modelBlock('HackathonRegistration')).toMatch(/teamMembers\s+String\?/);
    expect(modelBlock('AssignmentHub')).toMatch(/attachments\s+String\?/);
  });
});

// ── Migration file contract ──────────────────────────────────────────────────
describe('order-10: migration is additive-safe + backfills blobs', () => {
  it('dir + file exist', () => {
    expect(fs.existsSync(MIGRATION_DIR)).toBe(true);
    expect(fs.existsSync(MIGRATION_SQL_PATH)).toBe(true);
  });
  it('header documents order, deploy-applies, dual-write, no-drop', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toMatch(/Order 10/i);
    expect(sql).toMatch(/V-13|V-14|V-18|V-17/);
    expect(sql).toMatch(/NOT APPLIED LIVE/i);
    expect(sql).toMatch(/prisma migrate deploy/i);
    expect(sql).toMatch(/dual-write/i);
    expect(sql).toMatch(/do NOT drop/i);
  });
  it('creates 4 tables IF NOT EXISTS (additive only)', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    for (const t of ['"FormFieldOption"', '"FormAnswer"', '"HackathonTeamMember"', '"AssignmentAttachment"']) {
      expect(sql, t).toContain(`CREATE TABLE IF NOT EXISTS ${t}`);
    }
  });
  it('FKs + UNIQUEs use guards + NOT VALID → VALIDATE with Prisma-conventional names', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    for (const c of [
      'FormFieldOption_fieldId_value_key',
      'FormAnswer_responseId_fieldId_key',
      'FormFieldOption_fieldId_fkey',
      'FormAnswer_responseId_fkey',
      'FormAnswer_fieldId_fkey',
      'HackathonTeamMember_registrationId_fkey',
      'HackathonTeamMember_userId_fkey',
      'AssignmentAttachment_assignmentId_fkey',
    ]) {
      expect(sql, c).toContain(c);
    }
    expect(sql).toMatch(/NOT VALID/);
    expect(sql).toMatch(/VALIDATE CONSTRAINT "FormAnswer_responseId_fkey"/);
    expect(sql).toMatch(/ON DELETE CASCADE/);
    expect(sql).toMatch(/ON DELETE SET NULL/);
  });
  it('backfills cover all 4 blobs (jsonb_each/array_elements/CSV + idempotent guards)', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toMatch(/jsonb_array_elements/);
    expect(sql).toMatch(/jsonb_each/);
    expect(sql).toMatch(/string_to_array/);
    expect(sql).toMatch(/ON CONFLICT \("fieldId", "value"\) DO NOTHING/);
    expect(sql).toMatch(/ON CONFLICT \("responseId", "fieldId"\) DO NOTHING/);
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM "HackathonTeamMember"/);
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM "AssignmentAttachment"/);
    expect(sql).toMatch(/pg_input_is_valid/);
  });
  it('no DROP/ALTER on existing columns (blobs survive; contract is later)', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).not.toMatch(/DROP COLUMN/);
    expect(sql).not.toMatch(/ALTER TABLE "(FormField|FormResponse|HackathonRegistration|AssignmentHub)" ALTER COLUMN/);
    expect(sql).not.toMatch(/ALTER TABLE "(FormField|FormResponse|HackathonRegistration|AssignmentHub)" DROP/);
  });
  it('analytics indexes + reconciliation census present', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toContain('FormAnswer_fieldId_value_idx');
    expect(sql).toContain('HackathonTeamMember_userId_idx');
    expect(sql).toMatch(/GROUP BY "value"/);
    expect(sql).toMatch(/string_to_array\("value", ','\)/);
  });
});

// ── Pure helpers ─────────────────────────────────────────────────────────────
describe('order-10: parseFieldOptionsInput (blob → rows)', () => {
  it('string arrays → self-valued rows in order', () => {
    expect(parseFieldOptionsInput(['Red', 'Blue'])).toEqual([
      { value: 'Red', label: 'Red', points: 0, order: 0 },
      { value: 'Blue', label: 'Blue', points: 0, order: 1 },
    ]);
  });
  it('object options → value/label/points (score alias)', () => {
    expect(parseFieldOptionsInput([{ label: 'Yes', value: 'yes', points: 5 }])).toEqual([
      { value: 'yes', label: 'Yes', points: 5, order: 0 },
    ]);
    expect(parseFieldOptionsInput([{ text: 'Maybe', score: 2 }])).toEqual([
      { value: 'Maybe', label: 'Maybe', points: 2, order: 0 },
    ]);
  });
  it('accepts JSON strings; garbage → [] (never throws)', () => {
    expect(parseFieldOptionsInput('["A","B"]')).toHaveLength(2);
    expect(parseFieldOptionsInput('junk')).toEqual([]);
    expect(parseFieldOptionsInput(null)).toEqual([]);
    expect(parseFieldOptionsInput({})).toEqual([]);
  });
  it('dedupes repeat values + clamps points + caps length', () => {
    expect(parseFieldOptionsInput(['A', 'A', 'B'])).toHaveLength(2);
    expect(parseFieldOptionsInput([{ label: 'X', points: 99999 }])[0].points).toBe(10000);
    expect(parseFieldOptionsInput([{ label: 'X', points: NaN }])[0].points).toBe(0);
  });
});

describe('order-10: answer value canonicalization', () => {
  it('scalars trim; arrays join with ", " (blob parity)', () => {
    expect(answerToStoredValue(' hi ')).toBe('hi');
    expect(answerToStoredValue(['A', 'B'])).toBe('A, B');
    expect(answerToStoredValue(42)).toBe('42');
    expect(answerToStoredValue(null)).toBe('');
    expect(answerToStoredValue({ a: 1 })).toBe('{"a":1}');
  });
  it('buildFormAnswerRows maps fieldId → canonical value', () => {
    expect(buildFormAnswerRows({ f1: 'Yes', f2: ['A', 'B'] })).toEqual([
      { fieldId: 'f1', value: 'Yes' },
      { fieldId: 'f2', value: 'A, B' },
    ]);
    expect(buildFormAnswerRows(null as any)).toEqual([]);
    expect(buildFormAnswerRows([] as any)).toEqual([]);
  });
  it('resolveAnswersMap: child rows win; blob fallback; garbage → {}', () => {
    expect(resolveAnswersMap({ answers: '{"f1":"Yes"}', answerRows: [{ fieldId: 'f1', value: 'No' }] })).toEqual({ f1: 'No' });
    expect(resolveAnswersMap({ answers: '{"f1":"Yes"}' })).toEqual({ f1: 'Yes' });
    expect(resolveAnswersMap({ answers: 'junk' })).toEqual({});
    expect(resolveAnswersMap({} as any)).toEqual({});
    expect(hasChildAnswers({ answerRows: [{ fieldId: 'f', value: 'x' }] })).toBe(true);
    expect(hasChildAnswers({} as any)).toBe(false);
  });
});

describe('order-10: team members + attachments', () => {
  it('parseTeamMembersInput: arrays, CSV, JSON-string, single, empty', () => {
    expect(parseTeamMembersInput(['Asha', 'Dev'])).toEqual(['Asha', 'Dev']);
    expect(parseTeamMembersInput('Asha, Dev')).toEqual(['Asha', 'Dev']);
    expect(parseTeamMembersInput('["Asha","Dev"]')).toEqual(['Asha', 'Dev']);
    expect(parseTeamMembersInput('Solo')).toEqual(['Solo']);
    expect(parseTeamMembersInput('')).toEqual([]);
    expect(parseTeamMembersInput(null)).toEqual([]);
    expect(parseTeamMembersInput([{ name: 'Asha' }])).toEqual(['Asha']);
  });
  it('resolveTeamMembersDisplay: child rows win, else blob', () => {
    expect(resolveTeamMembersDisplay({ teamMembers: 'A, B', teamRows: [{ name: 'X' }, { name: 'Y' }] })).toBe('X, Y');
    expect(resolveTeamMembersDisplay({ teamMembers: 'A, B' })).toBe('A, B');
    expect(resolveTeamMembersDisplay({ teamMembers: null } as any)).toBe('');
  });
  it('parseAttachmentUrls: strings + {url} objects, garbage → []', () => {
    expect(parseAttachmentUrls('["https://a","https://b"]')).toEqual(['https://a', 'https://b']);
    expect(parseAttachmentUrls([{ url: 'https://a' }, { url: '' }, 'junk-item'])).toEqual(['https://a', 'junk-item']);
    expect(parseAttachmentUrls('junk')).toEqual([]);
    expect(parseAttachmentUrls(null)).toEqual([]);
  });
  it('resolveAttachmentUrls: child rows win ordered, else blob', () => {
    expect(
      resolveAttachmentUrls({ attachments: '["https://blob"]', attachmentRows: [{ url: 'https://b', order: 1 }, { url: 'https://a', order: 0 }] }),
    ).toEqual(['https://a', 'https://b']);
    expect(resolveAttachmentUrls({ attachments: '["https://blob"]' })).toEqual(['https://blob']);
    expect(resolveAttachmentUrls({} as any)).toEqual([]);
  });
});

// ── Routes: dual-write + read-new/fallback ───────────────────────────────────
describe('order-10: routes dual-write (write-both, non-fatal)', () => {
  it('forms.ts: field options + answers dual-write helpers + submit hooks', () => {
    const src = readSrc('src/routes/forms.ts');
    expect(src).toContain('syncFieldOptionRows');
    expect(src).toContain('syncResponseAnswerRows');
    expect(src).toContain('formFieldOption.deleteMany');
    expect(src).toContain('formFieldOption.createMany');
    expect(src).toContain('formAnswer.deleteMany');
    expect(src).toContain('formAnswer.createMany');
    expect(src).toContain('dual-write non-fatal');
  });
  it('forms.ts: analytics reads SQL GROUP BY first, blob fallback, exposes source', () => {
    const src = readSrc('src/routes/forms.ts');
    expect(src).toContain('formAnswer.groupBy');
    expect(src).toContain('distributions');
    expect(src).toContain('answersSource');
    expect(src).toContain("source: 'child'");
    expect(src).toContain("source: 'blob'");
  });
  it('forms.ts + hackathons.ts: exports prefer child rows with pre-migration retry', () => {
    const forms = readSrc('src/routes/forms.ts');
    expect(forms).toContain('answerRows: true');
    expect(forms).toContain('resolveAnswersMap');
    const hacks = readSrc('src/routes/hackathons.ts');
    expect(hacks).toContain('hackathonTeamMember.createMany');
    expect(hacks).toContain('parseTeamMembersInput');
    expect(hacks).toContain('teamRows: true');
    expect(hacks).toContain('resolveTeamMembersDisplay');
  });
  it('assignmentHub.ts: attachments dual-write on create + re-sync on update', () => {
    const src = readSrc('src/routes/assignmentHub.ts');
    expect(src).toContain('parseAttachmentUrls');
    expect(src).toContain('assignmentAttachment.createMany');
    expect(src).toContain('assignmentAttachment.deleteMany');
    expect(src).toContain('attachments re-sync non-fatal');
  });
});
