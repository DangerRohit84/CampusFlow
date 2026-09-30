// apps/web/src/lib/__tests__/sheets-combined-guard.test.ts — TDD RED for combined manual+auto restore.
// WHY (user approved "ok"): revert auto-only 4bb8509 logic for SheetsTab, restore
// combined manual+auto (d834814 logic). Progress = combinedMarked(marks) (manual+auto),
// manual Mark/Done toggle via toggleSheetMarkV2 + loadSheetMarksV2 restored, Auto badge +
// getAutomark fetch kept (both work). Stored manual+auto kept, backend untouched, no migration.
// Leaderboard average files untouched.
// Run: npm run test -w @campusflow/web -- sheets-combined-guard
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readSheetsTab(): string {
  const p = join(process.cwd(), 'src/components/coding/SheetsTab.tsx');
  return readFileSync(p, 'utf8');
}

function stripComments(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, '');
}

describe('SheetsTab combined (manual + auto)', () => {
  it('calls the automark endpoint for auto marks (code, not comments)', () => {
    const code = stripComments(readSheetsTab());
    expect(code).toContain('getAutomark');
    expect(code).toContain('automarkState');
    expect(code).toContain('automarkMeta');
    expect(code).toContain('applyAutoMarks');
    expect(code).toContain('mapSolvedToSheetKeys');
  });

  it('renders Auto badge for auto solves (code, not comments)', () => {
    const code = stripComments(readSheetsTab());
    // Auto badge: Sparkles + isAutoMark wiring + 'Auto' label (whitespace-tolerant).
    expect(code).toMatch(/>\s*Auto\s*</);
    expect(code).toContain('isAutoMark');
    expect(code).toContain('Sparkles');
  });

  it('restores manual Mark/Done toggle (manual tick shows Done even when auto empty)', () => {
    const code = stripComments(readSheetsTab());
    // Manual toggle wiring must be present.
    expect(code).toContain('toggleSheetMarkV2');
    expect(code).toContain('loadSheetMarksV2');
    expect(code).toContain('CheckCircle2');
    expect(code).toContain('onToggle');
    // Manual button labels must be present (Done for manual tick, Mark for unticked,
    // Auto for auto tick) — string literals in the toggle button.
    expect(code).toContain(`'Done'`);
    expect(code).toContain(`'Mark'`);
    expect(code).toContain(`'Auto'`);
  });

  it('progress is combined manual+auto (not auto-only, not manual-only)', () => {
    const code = stripComments(readSheetsTab());
    expect(code).toContain('combinedMarked');
    // Must count combined set, not a single-source set.
    expect(code).not.toContain('new Set(marks.auto)');
    expect(code).not.toContain('new Set(marks.manual)');
  });
});
