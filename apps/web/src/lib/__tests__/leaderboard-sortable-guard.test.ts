// apps/web/src/lib/__tests__/leaderboard-sortable-guard.test.ts — TDD guard for sortable headers.
// WHY (issue #1): positions by rating(avg) desc by default; click toggles asc/desc
// with arrow indicator; rank numbers follow current sort (client-side over filtered slice).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readContestPage(): string {
  return readFileSync(join(process.cwd(), 'src/pages/ContestLeaderboardPage.tsx'), 'utf8');
}
function readCodingPage(): string {
  return readFileSync(join(process.cwd(), 'src/pages/CodingProfilePage.tsx'), 'utf8');
}

describe('ContestLeaderboardPage sortable headers (rating-primary)', () => {
  it('defaults to rating desc', () => {
    const src = readContestPage();
    expect(src).toMatch(/useState<LeaderboardSortKey>\(['"]rating['"]/);
    expect(src).toMatch(/useState<SortDir>\(['"]desc['"]/);
  });
  it('headers toggle via onSort with arrow indicator', () => {
    const src = readContestPage();
    for (const k of ['rating', 'solved', 'contests', 'name']) {
      expect(src).toContain(`onSort('${k}')`);
    }
    expect(src).toMatch(/▼|▲|arrow/);
  });
  it('rank follows current sort (paged from sorted, not filtered)', () => {
    const src = readContestPage();
    expect(src).toContain('sortLeaderboardRows');
    expect(src).toContain('sorted.slice(');
    expect(src).not.toMatch(/pagedLeaderboard\s*=\s*filtered\.slice/);
  });
});

describe('CodingProfilePage leaderboard tab sortable (same contract)', () => {
  it('has toggle + Solved column + sorted slice', () => {
    const src = readCodingPage();
    expect(src).toContain('sortLeaderboardRows');
    expect(src).toContain('sortedLeaderboard');
    expect(src).toMatch(/Solved/);
    expect(src).toMatch(/onLbSort\(['"]rating['"]/);
  });
});
