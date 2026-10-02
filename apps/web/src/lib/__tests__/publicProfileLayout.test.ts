// lib/__tests__/publicProfileLayout.test.ts — visual guard: full-width public profile + heatmap no-overflow.
// WHY: PROD /u/alex_johnson rendered narrow-centered (max-w-6xl) with Activity
// month labels spilling past the card border on mobile (labels div outside the
// grid's overflow-x-auto). Guards lock: full-page container (max-w-7xl +
// responsive padding + 12-col sidebar+main with min-w-0) and heatmap inner
// scroll (shared overflow-x-auto wrapping labels+grid, month labels inside,
// figure contained). Data contract untouched (see publicHeatmap.test.ts).
// Run: npx vitest run src/lib/__tests__/publicProfileLayout.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const PAGE = path.resolve(__dirname, '../../pages/PublicProfilePage.tsx');
const HEAT = path.resolve(__dirname, '../../components/coding/ActivityHeatmap.tsx');
const read = (p: string) => fs.readFileSync(p, 'utf8');

describe('public profile layout: full page width (not narrow centered)', () => {
  it('container uses max-w-7xl full-page width with responsive padding', () => {
    const src = read(PAGE);
    // Full-page width — max-w-7xl (1280px, matches AdminOpportunities/TeacherAssigned pattern).
    expect(src).toMatch(/max-w-7xl/);
    // Responsive horizontal padding (not just px-4).
    expect(src).toMatch(/px-4.*sm:px-6|sm:px-6.*px-4/);
    // Must NOT remain on the old narrow container.
    expect(src).not.toMatch(/<div className="max-w-6xl mx-auto px-4 py-6 space-y-6"/);
  });
  it('keeps 12-col sidebar+main grid that stacks on mobile', () => {
    const src = read(PAGE);
    expect(src).toMatch(/grid grid-cols-12/);
    // Main + sidebar columns.
    expect(src).toMatch(/lg:col-span-8/);
    expect(src).toMatch(/lg:col-span-4/);
    // Grid children need min-w-0 so heatmap/card content can shrink (no flex overflow).
    expect(src).toMatch(/min-w-0/);
  });
});

describe('activity heatmap: month labels never cross border (mobile/desktop)', () => {
  it('wraps month labels + grid in a shared horizontal scroll container', () => {
    const src = read(HEAT);
    // Shared scroll wrapper owns overflow-x-auto (labels + grid scroll together).
    expect(src).toMatch(/overflow-x-auto/);
    // Labels must live INSIDE the scroll region — marker: scroll wrapper appears before month labels.
    const scrollIdx = src.indexOf('overflow-x-auto');
    const monthIdx = src.search(/Month labels/);
    expect(monthIdx).toBeGreaterThan(-1);
    expect(scrollIdx).toBeGreaterThan(-1);
    expect(scrollIdx).toBeLessThan(monthIdx);
  });
  it('month labels are bounded (no absolute overflow past card)', () => {
    const src = read(HEAT);
    // Inner content has explicit pixel width from week count so labels align with grid.
    expect(src).toMatch(/gridWidth|weeks\.length\s*\*\s*\(CELL/);
    // Card itself is contained (no border crossing).
    expect(src).toMatch(/overflow-hidden|max-w-full/);
  });
  it('grid does not scroll independently of month labels', () => {
    const src = read(HEAT);
    // After fix: the <ul> grid itself must NOT own overflow-x-auto alone —
    // the shared wrapper does. Isolated grid scroll desyncs labels.
    // Allow overflow-x-auto only on wrapper divs, not on the grid <ul>.
    const ulOverflow = src.match(/<ul[^>]*overflow-x-auto/);
    expect(ulOverflow).toBeNull();
  });
});
