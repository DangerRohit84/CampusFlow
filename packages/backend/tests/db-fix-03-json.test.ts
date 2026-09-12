/**
 * DB Fix Order 3 — Dual-write String-JSON + Json twins → one canonical Json
 * per fact (V-07→V-12) → P2/P6.
 *
 * Canonical = Json base name (@default("[]"), NOT NULL after migration):
 * - Hackathon / HackathonStaging: themes, targetDepartments, targetYears (3+3)
 * - InternshipStaging / Internship / Form: targetDepartments, targetYears (2+2+2)
 * - CodingContest: solutions (1)
 * Total 13 pairs. String losers dropped, *Json twins renamed → base so API
 * field names are preserved (type String→Json array only).
 * GIN (10) on targeting Json for future containment; solutions has no GIN
 * (read-whole, no containment query — P8). Useless B-tree on serialized
 * String (HackathonStaging targetDepartments) deleted with V-08.
 * Hermetic (schema/migration text + fake-free pure helpers + static src).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SCHEMA = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
const MIGRATION_DIR = path.join(__dirname, '../prisma/migrations/20260920000000_order3_json_twins');
const MIGRATION_SQL_PATH = path.join(MIGRATION_DIR, 'migration.sql');

function modelBlock(model: string): string {
  return SCHEMA.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`, 'm'))?.[0] ?? '';
}

const CANONICAL: Array<{ model: string; field: string }> = [
  { model: 'Hackathon', field: 'themes' },
  { model: 'Hackathon', field: 'targetDepartments' },
  { model: 'Hackathon', field: 'targetYears' },
  { model: 'HackathonStaging', field: 'themes' },
  { model: 'HackathonStaging', field: 'targetDepartments' },
  { model: 'HackathonStaging', field: 'targetYears' },
  { model: 'InternshipStaging', field: 'targetDepartments' },
  { model: 'InternshipStaging', field: 'targetYears' },
  { model: 'Internship', field: 'targetDepartments' },
  { model: 'Internship', field: 'targetYears' },
  { model: 'Form', field: 'targetDepartments' },
  { model: 'Form', field: 'targetYears' },
  { model: 'CodingContest', field: 'solutions' },
];

const TWIN_NAMES = ['themesJson', 'targetDepartmentsJson', 'targetYearsJson', 'solutionsJson'];

describe('order-3: canonical Json base names (V-07→V-12)', () => {
  it('13 facts are Json @default("[]") with no String twin', () => {
    for (const { model, field } of CANONICAL) {
      const block = modelBlock(model);
      expect(block, `${model} block`).toContain(model);
      // Canonical: `<field> Json @default("[]")` (spacing-tolerant).
      expect(block, `${model}.${field} canonical`).toMatch(new RegExp(`${field}\\s+Json\\s+@default\\("\\[\\]"\\)`));
      // No legacy String declaration for the same field.
      expect(block, `${model}.${field} no String`).not.toMatch(new RegExp(`${field}\\s+String`));
    }
  });
  it('no *Json twin columns remain in the 6 models', () => {
    for (const m of ['Hackathon', 'HackathonStaging', 'InternshipStaging', 'Internship', 'Form', 'CodingContest']) {
      const block = modelBlock(m);
      // Strip // comments (history prose may name the dropped twins).
      const code = block.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      for (const twin of TWIN_NAMES) {
        expect(code, `${m} must not contain ${twin}`).not.toContain(twin);
      }
    }
  });
  it('useless B-tree @@index([targetDepartments]) on HackathonStaging is gone (P8)', () => {
    const block = modelBlock('HackathonStaging');
    const code = block.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/@@index\(\[targetDepartments\]\)/);
  });
});

describe('order-3: GIN indexes where queried (P2)', () => {
  const GIN: Array<{ model: string; field: string; map: string }> = [
    { model: 'Hackathon', field: 'targetDepartments', map: 'Hackathon_targetDepartments_gin' },
    { model: 'Hackathon', field: 'targetYears', map: 'Hackathon_targetYears_gin' },
    { model: 'HackathonStaging', field: 'targetDepartments', map: 'HackathonStaging_targetDepartments_gin' },
    { model: 'HackathonStaging', field: 'targetYears', map: 'HackathonStaging_targetYears_gin' },
    { model: 'InternshipStaging', field: 'targetDepartments', map: 'InternshipStaging_targetDepartments_gin' },
    { model: 'InternshipStaging', field: 'targetYears', map: 'InternshipStaging_targetYears_gin' },
    { model: 'Internship', field: 'targetDepartments', map: 'Internship_targetDepartments_gin' },
    { model: 'Internship', field: 'targetYears', map: 'Internship_targetYears_gin' },
    { model: 'Form', field: 'targetDepartments', map: 'Form_targetDepartments_gin' },
    { model: 'Form', field: 'targetYears', map: 'Form_targetYears_gin' },
  ];
  it('10 GIN indexes exist with type Gin + map names', () => {
    for (const { model, field, map } of GIN) {
      const block = modelBlock(model);
      expect(block, map).toContain(map);
      expect(block, `${map} Gin`).toMatch(new RegExp(`@@index\\(\\[${field}\\],\\s*type:\\s*Gin[^)]*map:\\s*"${map}"\\)`));
    }
  });
  it('CodingContest.solutions has NO GIN (read-whole, documented)', () => {
    const block = modelBlock('CodingContest');
    expect(block).not.toMatch(/type:\s*Gin/);
    expect(block).toMatch(/V-12.*No GIN|No GIN.*solutions/s);
  });
});

describe('order-3: migration file contract (created, NOT applied live)', () => {
  it('migration dir + file exist', () => {
    expect(fs.existsSync(MIGRATION_DIR)).toBe(true);
    expect(fs.existsSync(MIGRATION_SQL_PATH)).toBe(true);
  });
  it('header documents order, deploy-applies, big-bang (no rolling)', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toMatch(/Order 3|V-07/i);
    expect(sql).toMatch(/NOT APPLIED LIVE/i);
    expect(sql).toMatch(/prisma migrate deploy/i);
    expect(sql).toMatch(/big-bang|not rolling|concurrently/i);
  });
  it('backfills Json from String where valid (pg_input_is_valid, Json wins)', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toMatch(/UPDATE\s+"Hackathon"\s+SET\s+"themesJson"\s*=\s*"themes"::jsonb/is);
    expect(sql).toMatch(/UPDATE\s+"CodingContest"\s+SET\s+"solutionsJson"\s*=\s*"solutions"::jsonb/is);
    expect(sql).toMatch(/pg_input_is_valid\(.*,\s*'json'\)/i);
    expect(sql).toMatch(/WHERE\s+"themesJson"\s+IS\s+NULL/is);
  });
  it('logs conflicts via RAISE NOTICE + normalizes NULLs to []', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toMatch(/RAISE NOTICE.*Order3 conflict.*invalid JSON/s);
    expect(sql).toMatch(/UPDATE\s+"Hackathon"\s+SET\s+"themesJson"\s*=\s*'\[\]'::jsonb\s+WHERE\s+"themesJson"\s+IS\s+NULL/is);
  });
  it('contracts via guarded DROP String + RENAME Json→base (single-apply)', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toMatch(/DROP COLUMN IF EXISTS "themes"/);
    expect(sql).toMatch(/RENAME COLUMN "themesJson" TO "themes"/);
    expect(sql).toMatch(/information_schema\.columns.*themesJson/s);
  });
  it('sets DEFAULT [] + NOT NULL on canonical + creates GIN + drops useless index', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toMatch(/ALTER TABLE "Hackathon" ALTER COLUMN "themes" SET DEFAULT '\[\]'::jsonb/);
    expect(sql).toMatch(/ALTER TABLE "Hackathon" ALTER COLUMN "themes" SET NOT NULL/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS "Hackathon_targetDepartments_gin" ON "Hackathon" USING GIN/);
    expect(sql).toMatch(/DROP INDEX IF EXISTS "HackathonStaging_targetDepartments_idx"/);
  });
});

describe('order-3: code writes/reads canonical Json only (static)', () => {
  const ROUTES = ['hackathons.ts', 'internships.ts', 'forms.ts', 'contests.ts', 'fetch.ts', 'internalCron.ts'];
  const SERVICES = [
    'services/contestFetcher.ts',
    'services/fetch/save.ts',
    'services/opportunities/stages.ts',
    'services/opportunities/staging.ts',
  ];
  function readSrc(rel: string): string {
    return fs.readFileSync(path.join(__dirname, '../src', rel), 'utf8');
  }
  it('routes/services do not import or call dualWrite* (deprecated shim stays in validators only)', () => {
    for (const f of [...ROUTES.map((r) => `routes/${r}`), ...SERVICES]) {
      const src = readSrc(f);
      expect(src, `${f} no dualWrite import`).not.toMatch(/dualWrite(Departments|Years|Themes|Json)/);
    }
    const validators = readSrc('lib/validators.ts');
    expect(validators).toMatch(/dualWriteJson/); // shim retained (perf-db.test)
    expect(validators).toMatch(/normalizeDepartments|normalizeYears|normalizeThemes|normalizeSolutions/);
  });
  it('no *Json twin code refs in routes/services (comments may mention history)', () => {
    for (const f of [...ROUTES.map((r) => `routes/${r}`), ...SERVICES]) {
      const src = readSrc(f);
      // Code refs have dot/colon (property read / Prisma write); bare history
      // mentions in comments (contestFetcher header) are allowed.
      expect(src, `${f} no .targetDepartmentsJson read`).not.toMatch(/\.targetDepartmentsJson/);
      expect(src, `${f} no targetDepartmentsJson write`).not.toMatch(/targetDepartmentsJson\s*:/);
      expect(src, `${f} no .targetYearsJson read`).not.toMatch(/\.targetYearsJson/);
      expect(src, `${f} no targetYearsJson write`).not.toMatch(/targetYearsJson\s*:/);
      expect(src, `${f} no .themesJson read`).not.toMatch(/\.themesJson/);
      expect(src, `${f} no themesJson write`).not.toMatch(/themesJson\s*:/);
      expect(src, `${f} no .solutionsJson read`).not.toMatch(/\.solutionsJson/);
      expect(src, `${f} no solutionsJson write`).not.toMatch(/solutionsJson\s*:/);
    }
  });
  it('no String-equality queries on canonical twins (Json filters only)', () => {
    for (const f of [...ROUTES.map((r) => `routes/${r}`), ...SERVICES]) {
      const src = readSrc(f);
      expect(src, `${f} no String [] equality`).not.toMatch(/targetDepartments:\s*'\[\]'/);
      expect(src, `${f} no String not-[]`).not.toMatch(/targetDepartments:\s*\{\s*not:\s*'\[\]'/);
    }
  });
  it('staging→published copies carry canonical arrays (no twin spread)', () => {
    const hack = readSrc('routes/hackathons.ts');
    expect(hack).toMatch(/targetDepartments:\s*staging\.targetDepartments/);
    expect(hack).not.toMatch(/staging\.targetDepartmentsJson/);
    const intern = readSrc('routes/internships.ts');
    expect(intern).toMatch(/targetDepartments:\s*\(staging as any\)\.targetDepartments/);
    expect(intern).not.toMatch(/staging as any\)\.targetDepartmentsJson/);
  });
});

describe('order-3: canonical normalizers accept array | JSON-string | null (behavioral)', () => {
  it('normalizeDepartments/Themes/Years/Solutions coerce without throwing', async () => {
    const mod = await import('../src/lib/validators');
    const { normalizeDepartments, normalizeThemes, normalizeYears, normalizeSolutions, parseJsonArraySafe, parseJsonNumberArraySafe } = mod as any;
    expect(normalizeDepartments(['CSE', 'IT'])).toEqual(['CSE', 'IT']);
    expect(normalizeDepartments('["CSE","IT"]')).toEqual(['CSE', 'IT']);
    expect(normalizeDepartments(null)).toEqual([]);
    expect(normalizeDepartments(undefined)).toEqual([]);
    expect(normalizeDepartments('not-json')).toEqual([]);
    expect(normalizeThemes('[]')).toEqual([]);
    expect(normalizeYears([1, 2])).toEqual([1, 2]);
    expect(normalizeYears('[1,2]')).toEqual([1, 2]);
    expect(normalizeYears(null)).toEqual([]);
    expect(normalizeSolutions([{ url: 'https://x' }])).toEqual([{ url: 'https://x' }]);
    expect(normalizeSolutions('[{"url":"https://x"}]')).toEqual([{ url: 'https://x' }]);
    // Readers accept canonical Json arrays directly (no parse needed).
    expect(parseJsonArraySafe(['CSE'])).toEqual(['CSE']);
    expect(parseJsonNumberArraySafe([2])).toEqual([2]);
    expect(parseJsonArraySafe('["CSE"]')).toEqual(['CSE']);
  });
  it('deprecated dualWrite shim still round-trips (perf-db compat)', async () => {
    const { dualWriteJson } = await import('../src/lib/validators');
    const out = dualWriteJson(['CSE']);
    expect(out.stringValue).toBe('["CSE"]');
    expect(out.jsonValue).toEqual(['CSE']);
  });
});
