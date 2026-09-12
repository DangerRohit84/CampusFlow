/**
 * Track 4 — hermetic tests for the staging pagination contract (C-6 lock-in).
 * Locks: parse clamps, status mapping, college scoping, past-year exclusion,
 * offset/cursor find-args, envelope math. Pure — no DB. currentYear is injected
 * (2026) so the suite never time-bombs on New Year.
 */
import { describe, it, expect } from 'vitest';
import {
  parseStagingParams,
  buildStagingWhere,
  buildStagingFindArgs,
  buildStagingPage,
  STAGING_MAX_LIMIT,
} from '../src/services/opportunities/staging';

const Y = 2026;
const row = (id: string) => ({ id });

describe('parseStagingParams', () => {
  it('defaults page=1 limit=20, derives skip', () => {
    expect(parseStagingParams({})).toEqual({ page: 1, limit: 20, skip: 0, cursor: null });
  });

  it('clamps limit to 1..100 and page to >= 1', () => {
    expect(parseStagingParams({ page: '-3', limit: '500' })).toMatchObject({ page: 1, limit: 100 });
    expect(parseStagingParams({ page: '2', limit: '0' })).toMatchObject({ page: 2, limit: 20 });
    expect(parseStagingParams({ page: 'abc', limit: 'xyz' })).toMatchObject({ page: 1, limit: 20 });
  });

  it('computes skip and keeps cursor', () => {
    expect(parseStagingParams({ page: '3', limit: '10', cursor: 'abc' })).toEqual({
      page: 3,
      limit: 10,
      skip: 20,
      cursor: 'abc',
    });
  });

  it('exposes MAX 100', () => {
    expect(STAGING_MAX_LIMIT).toBe(100);
  });
});

describe('buildStagingWhere', () => {
  it('PENDING maps to DRAFT/PENDING (+ACTIVE opt-in for internships)', () => {
    const hack = buildStagingWhere({ status: 'PENDING', isSuperAdmin: true, currentYear: Y });
    expect(hack.baseWhere.status).toEqual({ in: ['DRAFT', 'PENDING'] });
    const intern = buildStagingWhere(
      { status: 'PENDING', isSuperAdmin: true, currentYear: Y },
      { pendingStatuses: ['DRAFT', 'PENDING', 'ACTIVE'] },
    );
    expect(intern.baseWhere.status).toEqual({ in: ['DRAFT', 'PENDING', 'ACTIVE'] });
  });

  it('APPROVED/REJECTED pass through; unknown status ignored', () => {
    expect(
      buildStagingWhere({ status: 'APPROVED', isSuperAdmin: true, currentYear: Y }).baseWhere.status,
    ).toBe('APPROVED');
    expect(
      buildStagingWhere({ status: 'BOGUS', isSuperAdmin: true, currentYear: Y }).baseWhere,
    ).not.toHaveProperty('status');
  });

  it('requires enriched rows when reviewing pending/unfiltered', () => {
    const unfiltered = buildStagingWhere({ isSuperAdmin: true, currentYear: Y });
    // Order 3: targetDepartments is canonical Json — Prisma Json filter
    // `not: []` (was String `{ not: '[]' }`).
    expect(unfiltered.baseWhere.targetDepartments).toEqual({ not: [] });
    const approved = buildStagingWhere({ status: 'APPROVED', isSuperAdmin: true, currentYear: Y });
    expect(approved.baseWhere).not.toHaveProperty('targetDepartments');
  });

  it('excludes past-year titles DB-side but keeps current year', () => {
    const { baseWhere } = buildStagingWhere({ isSuperAdmin: true, currentYear: Y });
    const not = baseWhere.NOT as { OR: Array<{ title: { contains: string } }> };
    const years = not.OR.map((c) => c.title.contains);
    expect(years).toContain('2025');
    expect(years).toContain('2020');
    expect(years).not.toContain('2026');
    expect(years).toHaveLength(6);
  });

  it('super-admin stays unscoped; others get own-college + global OR', () => {
    const sa = buildStagingWhere({ isSuperAdmin: true, currentYear: Y });
    expect(JSON.stringify(sa.scopedWhere)).not.toContain('collegeId');
    const ca = buildStagingWhere({ collegeId: 'c1', isSuperAdmin: false, currentYear: Y });
    expect(ca.scopedWhere).toHaveProperty('AND');
    const and = (ca.scopedWhere.AND as unknown[])[1] as {
      OR: Array<Record<string, string | null>>;
    };
    expect(and.OR).toContainEqual({ collegeId: 'c1' });
    expect(and.OR).toContainEqual({ collegeId: null });
  });
});

describe('buildStagingFindArgs', () => {
  const where = { status: 'PENDING' };

  it('offset mode uses skip/take exactly (no 2x over-fetch)', () => {
    expect(buildStagingFindArgs({ scopedWhere: where, page: 2, limit: 20, skip: 20, cursor: null })).toMatchObject({
      where,
      skip: 20,
      take: 20,
    });
  });

  it('cursor mode uses keyset take limit+1 skip 1', () => {
    const args = buildStagingFindArgs({ scopedWhere: where, page: 1, limit: 20, skip: 0, cursor: 'c9' });
    expect(args).toMatchObject({ take: 21, cursor: { id: 'c9' }, skip: 1 });
  });
});

describe('buildStagingPage — page-2 skips/dups contract', () => {
  it('offset mode: hasMore from page*limit < total', () => {
    // 5 past + 5 future semantics: total counts the SAME where as the page.
    const p1 = buildStagingPage({ rows: [row('a'), row('b')], filtered: [row('a'), row('b')], total: 10, page: 1, limit: 2, cursor: null });
    expect(p1).toMatchObject({ hasMore: true, nextCursor: null });
    expect(p1.pageRows.map((r) => r.id)).toEqual(['a', 'b']);
    const p5 = buildStagingPage({ rows: [row('i'), row('j')], filtered: [row('i'), row('j')], total: 10, page: 5, limit: 2, cursor: null });
    expect(p5.hasMore).toBe(false);
  });

  it('cursor mode: over-fetch sliced, nextCursor from last kept row', () => {
    const rows = [row('a'), row('b'), row('c')];
    const full = buildStagingPage({ rows, filtered: rows, total: 9, page: 1, limit: 2, cursor: 'prev' });
    expect(full.hasMore).toBe(true);
    expect(full.pageRows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(full.nextCursor).toBe('b');
    const last = buildStagingPage({ rows: [row('h'), row('i')], filtered: [row('h'), row('i')], total: 9, page: 4, limit: 2, cursor: 'g' });
    expect(last.hasMore).toBe(false);
    expect(last.nextCursor).toBe('i');
  });

  it('cursor mode: safety-net drops do not inflate the page', () => {
    // RAW rows drove hasMore (3 > 2) but only 1 survived the filter.
    const kept = buildStagingPage({ rows: [row('a'), row('b'), row('c')], filtered: [row('a')], total: 9, page: 1, limit: 2, cursor: 'prev' });
    expect(kept.hasMore).toBe(true);
    expect(kept.pageRows.map((r) => r.id)).toEqual(['a']);
    expect(kept.nextCursor).toBe('a');
  });
});
