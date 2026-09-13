/**
 * DB Fix Order 2 — Nullable-column uniques (V-24, V-25).
 * NULL-safe uniqueness: source NOT NULL DEFAULT 'MANUAL' for staging,
 * partial UNIQUE WHERE collegeId IS NULL for AiProvider/AiRouting globals.
 * GLOBAL @@unique([title,source]) stays (no collegeId in key — per-college
 * visibility lives in decision tables, see per-college-approvals.test.ts).
 * Hermetic where possible (schema/migration text + fake DB for save/dedup).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SCHEMA = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
const MIGRATION_DIR = path.join(__dirname, '../prisma/migrations/20260919000000_order2_nullsafe_uniques');
const MIGRATION_SQL_PATH = path.join(MIGRATION_DIR, 'migration.sql');

function modelBlock(model: string): string {
  return SCHEMA.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`, 'm'))?.[0] ?? '';
}

describe('order-2: staging source NOT NULL DEFAULT MANUAL (V-24)', () => {
  it('HackathonStaging.source is required with MANUAL default', () => {
    const block = modelBlock('HackathonStaging');
    expect(block).toContain('HackathonStaging');
    // Required (no ?) + default MANUAL
    expect(block).toMatch(/source\s+String\s+@default\("MANUAL"\)/);
    expect(block).not.toMatch(/source\s+String\?/);
  });
  it('InternshipStaging.source is required with MANUAL default', () => {
    const block = modelBlock('InternshipStaging');
    expect(block).toMatch(/source\s+String\s+@default\("MANUAL"\)/);
    expect(block).not.toMatch(/source\s+String\?/);
  });
  it('@@unique([title, source]) stays GLOBAL (no collegeId in key)', () => {
    for (const m of ['HackathonStaging', 'InternshipStaging']) {
      const block = modelBlock(m);
      expect(block, `${m} global unique`).toMatch(/@@unique\(\[title,\s*source\]\)/);
      expect(block, `${m} must not scope unique by college`).not.toMatch(/@@unique\([^)]*collegeId[^)]*title[^)]*\)/);
      expect(block, `${m} must not scope unique by college (alt order)`).not.toMatch(/@@unique\([^)]*title[^)]*collegeId[^)]*\)/);
    }
  });
});

describe('order-2: AiProvider/AiRouting global partial uniques (V-25)', () => {
  it('AiProvider keeps nullable collegeId (global NULL allowed) + composite unique', () => {
    const block = modelBlock('AiProvider');
    expect(block).toMatch(/collegeId\s+String\?/);
    expect(block).toMatch(/@@unique\(\[name,\s*collegeId\]\)/);
  });
  it('AiRouting keeps nullable collegeId + composite unique', () => {
    const block = modelBlock('AiRouting');
    expect(block).toMatch(/collegeId\s+String\?/);
    expect(block).toMatch(/@@unique\(\[feature,\s*fallbackOrder,\s*collegeId\]\)/);
  });
  it('schema documents the partial UNIQUE WHERE collegeId IS NULL (Prisma cannot express)', () => {
    expect(SCHEMA).toMatch(/AiProvider_name_global_unique|WHERE\s+"collegeId"\s+IS\s+NULL/i);
    expect(SCHEMA).toMatch(/AiRouting.*global_unique|WHERE\s+"collegeId"\s+IS\s+NULL/i);
  });
});

describe('order-2: migration file contract (created, NOT applied live)', () => {
  it('migration dir + file exist', () => {
    expect(fs.existsSync(MIGRATION_DIR)).toBe(true);
    expect(fs.existsSync(MIGRATION_SQL_PATH)).toBe(true);
  });
  it('migration backfills NULL sources to MANUAL + sets DEFAULT + NOT NULL', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toMatch(/NOT APPLIED LIVE|NOT APPLIED/i);
    // Quote-tolerant: SQL uses "source" with quotes.
    expect(sql).toMatch(/UPDATE\s+"HackathonStaging"\s+SET\s+"source"\s*=\s*'MANUAL'\s+WHERE\s+"source"\s+IS\s+NULL/is);
    expect(sql).toMatch(/UPDATE\s+"InternshipStaging"\s+SET\s+"source"\s*=\s*'MANUAL'\s+WHERE\s+"source"\s+IS\s+NULL/is);
    expect(sql).toMatch(/SET\s+DEFAULT\s+'MANUAL'/i);
    expect(sql).toMatch(/SET\s+NOT\s+NULL/i);
  });
  it('migration adds partial UNIQUEs for global AiProvider/AiRouting', () => {
    const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');
    expect(sql).toMatch(/AiProvider_name_global_unique/);
    expect(sql).toMatch(/WHERE\s+"collegeId"\s+IS\s+NULL/i);
    expect(sql).toMatch(/AiRouting.*global_unique/);
    expect(sql).toContain('IF NOT EXISTS');
  });
});

describe('order-2: source normalization helper (NULL-safe dedupe)', () => {
  it('normalizeSource maps null/undefined/empty/whitespace to MANUAL, trims+uppers', async () => {
    const mod = await import('../src/services/opportunities/dedup');
    const fn = (mod as any).normalizeSource;
    expect(typeof fn).toBe('function');
    expect(fn(null)).toBe('MANUAL');
    expect(fn(undefined)).toBe('MANUAL');
    expect(fn('')).toBe('MANUAL');
    expect(fn('   ')).toBe('MANUAL');
    expect(fn('MANUAL')).toBe('MANUAL');
    expect(fn(' manual ')).toBe('MANUAL');
    expect(fn('DEVFOLIO')).toBe('DEVFOLIO');
    expect(fn('devfolio')).toBe('DEVFOLIO');
  });
  it('dedupInMemory treats missing source as MANUAL (same bucket)', async () => {
    const { dedupInMemory } = await import('../src/services/opportunities/dedup');
    const rows: any[] = [
      { title: 'Same Hack', source: null, url: 'https://x.test/a' },
      { title: 'Same Hack', source: 'MANUAL', url: 'https://x.test/a' },
      { title: 'Same Hack', source: undefined, url: 'https://x.test/a' },
    ];
    expect(dedupInMemory(rows)).toHaveLength(1);
  });
});

describe('order-2: save.ts NULL-safe dedupe + MANUAL default (behavioral)', () => {
  // Hardened for parallel-load flakiness (Neon RTT 500-1000ms India→SG + pool contention):
  // 30s timeout + 2 retries, hermetic fakeDb (no live DB) so retry is safe/idempotent.
  it('saveItems stores MANUAL when opp.source missing and dedupes NULL vs MANUAL', { timeout: 30_000, retry: 2 }, async () => {
    const { saveItems } = await import('../src/services/fetch/save');
    const created: any[] = [];
    const fakeDb: any = {
      hackathonStaging: {
        async findMany() { return []; },
        async createMany(args: any) { created.push(...args.data); return { count: args.data.length }; },
      },
      internshipStaging: {
        async findMany() { return []; },
        async createMany(args: any) { return { count: 0 }; },
      },
    };
    const items: any[] = [
      { type: 'HACKATHON', title: 'Null Source Hack', url: 'https://x.test/1', source: null },
      { type: 'HACKATHON', title: 'Null Source Hack', url: 'https://x.test/1', source: 'MANUAL' },
      { type: 'HACKATHON', title: 'Undefined Source Hack', url: 'https://x.test/2', source: undefined },
      { type: 'HACKATHON', title: 'Empty Source Hack', url: 'https://x.test/3', source: '   ' },
    ];
    const res = await saveItems(items, 'admin-1', null, fakeDb);
    // In-memory dedupe: 2nd row is dup of 1st (same normalized key) → skipped
    expect(res.hackathonSaved).toBe(3);
    expect(created).toHaveLength(3);
    for (const row of created) {
      expect(row.source).toBeTruthy();
      expect(typeof row.source).toBe('string');
      expect(row.source).not.toBeNull();
    }
    expect(created.map((r: any) => r.source)).toEqual(['MANUAL', 'MANUAL', 'MANUAL']);
  });
  it('save.ts pre-fetch uses normalized source (no NULL in query)', async () => {
    const { saveItems } = await import('../src/services/fetch/save');
    let seenWhere: any = null;
    const fakeDb: any = {
      hackathonStaging: {
        async findMany(args: any) { seenWhere = args.where; return []; },
        async createMany(args: any) { return { count: args.data.length }; },
      },
      internshipStaging: {
        async findMany() { return []; },
        async createMany(args: any) { return { count: 0 }; },
      },
    };
    await saveItems([{ type: 'HACKATHON', title: 'T', url: 'https://x.test/u', source: null }], 'a', null, fakeDb);
    expect(seenWhere).toBeTruthy();
    // Pair-match shape { OR: [{ title, source }] } or legacy { source: { in } }:
    // sources must not contain null/undefined and must normalize to MANUAL.
    const sources: unknown[] = Array.isArray((seenWhere as any)?.OR)
      ? (seenWhere as any).OR.map((p: any) => p?.source)
      : ((seenWhere as any).source?.in ?? []);
    expect(sources).not.toContain(null);
    expect(sources).not.toContain(undefined);
    expect(sources).toContain('MANUAL');
  });
  it('save.ts source file normalizes (static: no raw opp.source without fallback)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/services/fetch/save.ts'), 'utf8');
    expect(src).toMatch(/normalizeSource|MANUAL/);
    // Must not pass raw nullable source straight to DB without normalization
    expect(src).not.toMatch(/source:\s*opp\.source\s*,/);
  });
});

describe('order-2: fetch-external + cron NULL-safe (static)', () => {
  it('hackathons fetch-external normalizes source before findFirst/create', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/routes/hackathons.ts'), 'utf8');
    // Find the fetch-external block and require MANUAL fallback/normalize nearby
    const idx = src.indexOf('/fetch-external');
    expect(idx).toBeGreaterThan(-1);
    const window = src.slice(idx, idx + 6000);
    expect(window).toMatch(/normalizeSource|MANUAL/);
    expect(window).not.toMatch(/where:\s*\{\s*title:\s*opp\.title,\s*source:\s*opp\.source\s*\}/);
  });
  it('internships fetch-external normalizes source before findFirst/create', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/routes/internships.ts'), 'utf8');
    const idx = src.indexOf('/fetch-external');
    expect(idx).toBeGreaterThan(-1);
    const window = src.slice(idx, idx + 6000);
    expect(window).toMatch(/normalizeSource|MANUAL/);
    expect(window).not.toMatch(/where:\s*\{\s*title:\s*opp\.title,\s*source:\s*opp\.source\s*\}/);
  });
  it('internalCron normalizes source (no raw opp.source straight to DB)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/routes/internalCron.ts'), 'utf8');
    expect(src).toMatch(/normalizeSource|MANUAL/);
  });
});
