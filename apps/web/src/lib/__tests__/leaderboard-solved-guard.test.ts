// apps/web/src/lib/__tests__/leaderboard-solved-guard.test.ts — TDD RED for Solved col + /u/:username link.
// WHY: college leaderboard must show Solved (total, not average — backend totalSolved)
// + Name click -> /u/:username (public profile, already exists full page). Fail-open:
// missing totalSolved renders 0, missing username renders plain text (no broken link).
// Style decision (documented): leaderboard name IS an obvious internal link —
// hover:underline + hover:text-primary + cursor-pointer + focus-visible ring for a11y.
// This DIFFERS from contest cards (cursor-only, no underline/color — external URLs,
// whole-card window.open). Internal profile links need visible affordance.
// Default sort is rating-primary; headers toggle (rating/solved/contests/name)
// client-side with rank numbers following current sort (issue #1).
// Run: npx vitest run src/lib/__tests__/leaderboard-solved-guard.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readPage(): string {
  const p = join(process.cwd(), 'src/pages/ContestLeaderboardPage.tsx');
  return readFileSync(p, 'utf8');
}

describe('ContestLeaderboardPage Solved column (total, not average)', () => {
  it('table header has Solved column (sortable button, issue #1)', () => {
    const src = readPage();
    // Sortable header: button with Solved + arrow (was plain >Solved<).
    expect(src).toMatch(/Solved/);
    expect(src).toMatch(/onSort\(['"]solved['"]/);
  });
  it('row renders totalSolved fail-open (no throw on null)', () => {
    const src = readPage();
    // Must read entry.totalSolved with fail-open fallback (?? 0 or || 0 / Number check).
    expect(src).toContain('totalSolved');
    expect(src).toMatch(/totalSolved\s*\?\?\s*0|totalSolved\s*\|\|\s*0|Number\(.*totalSolved/);
  });
  it('CSV export includes solved (additive, keeps rating+bestRating)', () => {
    const src = readPage();
    // Additive-only: solved added alongside existing rating+bestRating (guarded separately).
    expect(src).toMatch(/solved/);
    expect(src).toContain("'bestRating'");
    expect(src).toContain("'rating'");
  });
});

describe('ContestLeaderboardPage name links to /u/:username (public profile)', () => {
  it('uses react-router Link to /u/:username (internal, not window.open)', () => {
    const src = readPage();
    // Must import Link and build /u/${username} (encoded) — internal SPA nav.
    expect(src).toMatch(/import\s*\{[^}]*Link[^}]*\}\s*from\s*['"]react-router-dom['"]/);
    expect(src).toMatch(/\/u\//);
    expect(src).toContain('username');
  });
  it('fail-open: missing username renders plain text (no broken /u/undefined link)', () => {
    const src = readPage();
    // Guard: conditional render on username presence (ternary/?./??/&&) — never links null.
    expect(src).toMatch(/username\s*\?\s*.*Link|username\s*&&|entry\.username\?\./);
  });
  it('link is keyboard + screen-reader accessible (focus ring, cursor-pointer)', () => {
    const src = readPage();
    expect(src.includes('cursor-pointer'), 'name link needs cursor-pointer').toBe(true);
    expect(src.includes('focus-visible:ring'), 'name link needs focus-visible ring for a11y').toBe(true);
  });
  it('name link has visible hover affordance (differs from contest-card cursor-only)', () => {
    const src = readPage();
    // Documented divergence: internal profile links ARE obvious — underline on hover.
    // Contest cards (CodingContestsPage/CalendarPage) forbid hover:underline (cursor-only,
    // external window.open). Leaderboard names navigate internal /u/:username so they
    // keep hover:underline + color. This guard locks the divergence intentionally.
    expect(src.includes('hover:underline'), 'leaderboard name link must keep hover:underline (obvious internal link)').toBe(true);
  });
});
