/**
 * Studio SUPER_ADMIN-only — frontend lockdown (TDD RED).
 * Locks: route guards + hidden nav for non-super, direct URL → 403.
 * Hermetic: pure isSuperAdminRoute + static source wiring (no DOM/network).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { isSuperAdminRoute, resolvePostLoginDest } from '../authRedirect';

function readWeb(rel: string): string {
  return fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
}

describe('isSuperAdminRoute includes studio routes', () => {
  it('treats /resume-studio as super-only', () => {
    expect(isSuperAdminRoute('/resume-studio')).toBe(true);
  });
  it('treats /portfolio-studio as super-only (incl. query)', () => {
    expect(isSuperAdminRoute('/portfolio-studio')).toBe(true);
    expect(isSuperAdminRoute('/portfolio-studio?import=1')).toBe(true);
  });
  it('stale studio redirect bounces non-super to landing', () => {
    expect(resolvePostLoginDest('/resume-studio', 'STUDENT')).toBe('/dashboard');
    expect(resolvePostLoginDest('/portfolio-studio', 'TEACHER')).toBe('/dashboard');
    expect(resolvePostLoginDest('/resume-studio', 'COLLEGE_ADMIN')).toBe('/dashboard');
    expect(resolvePostLoginDest('/resume-studio', 'SUPER_ADMIN')).toBe('/resume-studio');
  });
});

describe('App.tsx guards studio routes with SuperAdminGuard', () => {
  it('wraps resume-studio in SuperAdminGuard (direct URL blocked)', () => {
    const src = readWeb('App.tsx');
    expect(src).toMatch(/SuperAdminGuard/);
    // Both studio paths must be inside a SuperAdminGuard element — not bare LazyRoute.
    expect(src).toMatch(/<SuperAdminGuard>[\s\S]*?path="resume-studio"/);
    expect(src).toMatch(/<SuperAdminGuard>[\s\S]*?path="portfolio-studio"/);
  });
  it('never leaves bare studio routes (no unguarded LazyRoute)', () => {
    const src = readWeb('App.tsx');
    // Fail if a studio Route renders LazyRoute without SuperAdminGuard wrapper.
    expect(src).not.toMatch(
      /<Route\s+path="(resume-studio|portfolio-studio)"\s+element=\{<LazyRoute/
    );
  });
});

describe('Layout nav hidden for non-super', () => {
  it('STUDENT/TEACHER/COLLEGE_ADMIN sections contain no studio links', () => {
    const src = readWeb('components/layout/Layout.tsx');
    // Slice each role block and assert no studio paths inside non-super blocks.
    // Robust: split by role key, check until next role key.
    const roles = ['STUDENT', 'TEACHER', 'COLLEGE_ADMIN'] as const;
    for (const role of roles) {
      const start = src.indexOf(`${role}: [`);
      expect(start, `${role} block must exist`).toBeGreaterThanOrEqual(0);
      // Find next role block start after this one.
      const nextIdx = Math.min(
        ...['STUDENT', 'TEACHER', 'COLLEGE_ADMIN', 'SUPER_ADMIN']
          .filter((r) => r !== role)
          .map((r) => {
            const i = src.indexOf(`${r}: [`, start + 1);
            return i === -1 ? Number.MAX_SAFE_INTEGER : i;
          })
      );
      const block = src.slice(start, nextIdx === Number.MAX_SAFE_INTEGER ? start + 8000 : nextIdx);
      expect(block, `${role} nav must not link resume-studio`).not.toContain('/resume-studio');
      expect(block, `${role} nav must not link portfolio-studio`).not.toContain('/portfolio-studio');
    }
  });
  it('SUPER_ADMIN nav exposes studio links', () => {
    const src = readWeb('components/layout/Layout.tsx');
    const start = src.indexOf('SUPER_ADMIN: [');
    expect(start).toBeGreaterThanOrEqual(0);
    const block = src.slice(start, start + 8000);
    expect(block).toContain('/resume-studio');
    expect(block).toContain('/portfolio-studio');
  });
});

describe('CommandPalette hides studio for non-super', () => {
  it('filters studio entries by role (source must gate)', () => {
    const src = readWeb('components/CommandPalette.tsx');
    // Must read role and exclude studio for non-super — not a static unconditional list.
    expect(src).toMatch(/useAuthStore|role/i);
    expect(src).toMatch(/SUPER_ADMIN/);
    expect(src).toMatch(/resume-studio|portfolio-studio/);
    // Guard shape: conditional filter/exclude based on role.
    expect(src).toMatch(/role\s*!==?\s*['"]SUPER_ADMIN['"]|isSuper|filter.*role|role.*filter/i);
  });
});
