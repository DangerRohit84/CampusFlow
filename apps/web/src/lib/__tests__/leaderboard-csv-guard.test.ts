// apps/web/src/lib/__tests__/leaderboard-csv-guard.test.ts — TDD RED for M1 CSV dual column.
// WHY (dev-lead CHANGES_REQUESTED M1): CSV is API surface. Data builds BOTH rating + bestRating
// but headers dropped bestRating — downstream sheets/macros expecting bestRating break.
// Additive-only rule: keep bestRating, add rating. This guard locks BOTH cols in headers.
// Run: npx vitest run src/lib/__tests__/leaderboard-csv-guard.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readPage(): string {
  const p = join(process.cwd(), 'src/pages/ContestLeaderboardPage.tsx');
  return readFileSync(p, 'utf8');
}

describe('ContestLeaderboardPage CSV keeps dual rating+bestRating (M1)', () => {
  it('data row builds BOTH rating and bestRating', () => {
    const src = readPage();
    expect(src).toContain('rating: e.rating ?? e.bestRating');
    expect(src).toContain('bestRating: e.bestRating');
  });
  it('CSV headers contain BOTH rating AND bestRating (additive, compat)', () => {
    const src = readPage();
    // Headers array must keep old bestRating col + new rating col.
    expect(src).toContain("'bestRating'");
    expect(src).toContain("'rating'");
    // The exportToCSV headers arg must list both in one array literal.
    expect(src).toMatch(/rating.*bestRating|bestRating.*rating/);
  });
});
