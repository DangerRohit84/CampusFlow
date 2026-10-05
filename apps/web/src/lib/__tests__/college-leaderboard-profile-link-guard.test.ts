// apps/web/src/lib/__tests__/college-leaderboard-profile-link-guard.test.ts — TDD guard for college leaderboard profile links.
// WHY: college leaderboard (CodingProfilePage leaderboard tab) must link names to /u/:username
// (public profile, already exists full page) like ContestLeaderboardPage already does.
// Fail-open: missing username renders plain text (no /u/undefined). Style: cursor-pointer +
// hover:underline + hover:text-primary + focus-visible ring (obvious internal link — differs from
// contest-card cursor-only external window.open). Keeps Solved + rating sort (issue #1).
// Run: npx vitest run src/lib/__tests__/college-leaderboard-profile-link-guard.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readCoding(): string {
  return readFileSync(join(process.cwd(), 'src/pages/CodingProfilePage.tsx'), 'utf8');
}

describe('CodingProfilePage college leaderboard links to /u/:username', () => {
  it('imports react-router Link (internal SPA nav, not window.open)', () => {
    const src = readCoding();
    expect(src).toMatch(/import\s*\{[^}]*Link[^}]*\}\s*from\s*['"]react-router-dom['"]/);
  });
  it('builds /u/:username with encoded username', () => {
    const src = readCoding();
    expect(src).toMatch(/\/u\//);
    expect(src).toMatch(/encodeURIComponent\(.*username/);
  });
  it('fail-open: missing username renders plain span (no broken /u/undefined link)', () => {
    const src = readCoding();
    expect(src).toMatch(/username\s*\?\s*.*Link|username\s*&&|entry\.username\?\./);
    // Must have a fallback span for null username
    expect(src).toContain('<span');
  });
  it('link is keyboard + screen-reader accessible (cursor + hover + focus ring)', () => {
    const src = readCoding();
    expect(src.includes('cursor-pointer'), 'name link needs cursor-pointer').toBe(true);
    expect(src.includes('hover:underline'), 'leaderboard name link must keep hover:underline (obvious internal link)').toBe(true);
    expect(src.includes('focus-visible:ring'), 'name link needs focus-visible ring for a11y').toBe(true);
  });
  it('keeps Solved + rating sort (no regression on issue #1)', () => {
    const src = readCoding();
    expect(src).toContain('sortLeaderboardRows');
    expect(src).toContain('sortedLeaderboard');
    expect(src).toMatch(/Solved/);
    expect(src).toMatch(/onLbSort\(['"]rating['"]/);
    expect(src).toMatch(/onLbSort\(['"]solved['"]/);
  });
});
