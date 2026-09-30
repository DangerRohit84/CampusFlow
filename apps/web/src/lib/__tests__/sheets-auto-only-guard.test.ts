// apps/web/src/lib/__tests__/sheets-auto-only-guard.test.ts — TDD RED for auto-only swap.
// WHY (production correction): eb6cca9 did the opposite of the request — it
// removed auto and kept manual. Desired is auto-only: SheetsTab restores
// GET /coding-problems/automark + Auto badge + auto progress/status, and
// REMOVES manual Mark/Done buttons + manual progress. Stored manual data +
// backend automark route are KEPT (reversible, no migration) — frontend just
// stops rendering manual. This guard locks auto-only.
// Run: npm run test -w @campusflow/web -- sheets-auto-only-guard
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readSheetsTab(): string {
  // Test runs from apps/web; resolve to src/components/coding/SheetsTab.tsx.
  const p = join(process.cwd(), 'src/components/coding/SheetsTab.tsx');
  return readFileSync(p, 'utf8');
}

function stripComments(src: string): string {
  // Strip line comments (//...) so explanatory KEPT-route notes don't count.
  // Block comments are not used in SheetsTab; line-strip is sufficient.
  return src.replace(/^\s*\/\/.*$/gm, '');
}

describe('SheetsTab auto-only (auto fetch + badge, no manual buttons)', () => {
  it('calls the automark endpoint (code, not comments)', () => {
    const code = stripComments(readSheetsTab());
    expect(code).toContain('getAutomark');
    expect(code).toContain('automarkState');
    expect(code).toContain('automarkMeta');
  });

  it('renders Auto badge / auto progress / auto status (code, not comments)', () => {
    const code = stripComments(readSheetsTab());
    // Distinct auto UI/logic strings must be present.
    expect(code).toMatch(/>Auto</);
    expect(code).toContain('isAutoMark');
    expect(code).toContain('applyAutoMarks');
    expect(code).toContain('mapSolvedToSheetKeys');
    expect(code).toContain('Sparkles');
  });

  it('has no manual Mark/Done toggle buttons (code, not comments)', () => {
    const code = stripComments(readSheetsTab());
    // Manual toggle button labels must be gone (Auto badge stays).
    expect(code).not.toMatch(/>Mark</);
    expect(code).not.toMatch(/>Done</);
    expect(code).not.toContain('toggleSheetMarkV2');
    expect(code).not.toContain('combinedMarked');
    expect(code).not.toContain('CheckCircle2');
  });

  it('progress is auto-only (auto set, not manual)', () => {
    const code = stripComments(readSheetsTab());
    expect(code).toContain('marks.auto');
    expect(code).not.toContain('marks.manual');
    expect(code).not.toContain('new Set(marks.manual)');
  });
});
