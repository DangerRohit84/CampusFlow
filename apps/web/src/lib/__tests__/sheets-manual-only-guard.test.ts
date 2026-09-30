// apps/web/src/lib/__tests__/sheets-manual-only-guard.test.ts — TDD RED for sheet cleanup.
// WHY (production safety): Problems > Sheets tab must NOT auto-fetch solves.
// Manual checkmarks stay (device-only); auto-marks (GET /coding-problems/automark,
// "Auto" badge, auto progress, auto status) are hidden. Backend route + stored
// auto data are KEPT (no migration, no delete) — frontend simply stops calling
// and stops rendering auto. This guard locks the removal.
// Run: npm run test -w @campusflow/web -- sheets-manual-only-guard
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readSheetsTab(): string {
  // Test runs from apps/web; resolve to src/components/coding/SheetsTab.tsx.
  const p = join(process.cwd(), 'src/components/coding/SheetsTab.tsx');
  return readFileSync(p, 'utf8');
}

describe('SheetsTab manual-only (no auto-fetch UI/logic)', () => {
  it('does not call the automark endpoint (code, not comments)', () => {
    const src = readSheetsTab();
    // Function call / state wiring must be gone. Explanatory comments may
    // still mention the KEPT backend route (no delete) — strip comments first.
    const code = src.replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('getAutomark');
    expect(code).not.toContain('loadAutomarkForHandles');
    expect(code).not.toContain('automarkState');
    expect(code).not.toContain('automarkMeta');
    expect(code).not.toContain('automarkFresh');
  });
  it('renders no Auto badge / auto progress / auto status (code, not comments)', () => {
    const src = readSheetsTab();
    const code = src.replace(/^\s*\/\/.*$/gm, '');
    // Distinct auto UI/logic strings must be gone (manual Mark/Done stays).
    expect(code).not.toMatch(/>Auto</);
    expect(code).not.toContain('isAutoMark');
    expect(code).not.toContain('applyAutoMarks');
    expect(code).not.toContain('mapSolvedToSheetKeys');
    expect(code).not.toContain('combinedMarked');
    expect(code).not.toContain('Sparkles');
  });
  it('keeps manual marks (device-only checkmarks stay)', () => {
    const src = readSheetsTab();
    expect(src).toContain('loadSheetMarksV2');
    expect(src).toContain('toggleSheetMarkV2');
    expect(src).toMatch(/Mark/);
  });
});
