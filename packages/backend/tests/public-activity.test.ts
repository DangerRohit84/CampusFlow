/**
 * Public unified-heatmap activity (GET /u/:username/activity) — hermetic tests.
 *
 * Covers: route wiring mirrors GET /coding-profile/activity scoping for the
 * VIEWED user (trailing-window CodingActivity snapshot + live GitHub overlay,
 * same honest omitted ledger + envelope so the frontend merge stays verbatim),
 * privacy (per-day counts only — no email/private cols), rate-limit + noindex
 * headers, ?days= clamping, 404/400 handling, and pre-migration safety.
 * No DB, no network (static source reads + pure shape checks).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../src');
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

describe('public activity route wiring (static)', () => {
  it('GET /:username/activity exists before /:username with the public limiter', () => {
    const src = readSrc('routes/publicProfile.ts');
    expect(src).toMatch(/router\.get\('\/:username\/activity'/);
    const activityIdx = src.indexOf("router.get('/:username/activity'");
    const profileIdx = src.indexOf("router.get('/:username'");
    expect(activityIdx).toBeGreaterThan(-1);
    expect(profileIdx).toBeGreaterThan(-1);
    expect(activityIdx).toBeLessThan(profileIdx);
    expect(src).toMatch(/publicProfileLimiter,\s*async/);
  });
  it('mirrors the private activity scoping (window + stored + live github)', () => {
    const src = readSrc('routes/publicProfile.ts');
    // Same trailing-window param contract as GET /coding-profile/activity.
    expect(src).toMatch(/ACTIVITY_WINDOW_DAYS/);
    expect(src).toMatch(/Math\.min\(365,\s*Math\.max\(30/);
    // Same stored-snapshot read (CodingActivity delegate, date >= since,
    // leetcode/codeforces/github allowlist, positive counts only).
    expect(src).toMatch(/codingActivity/);
    expect(src).toMatch(/date:\s*\{\s*gte:\s*since\s*\}/);
    expect(src).toMatch(/\['leetcode',\s*'codeforces',\s*'github'\]/);
    // Same live-GitHub overlay (validated username, cached calendar,
    // best-effort githubLive flag).
    expect(src).toMatch(/isValidGithubUsername/);
    expect(src).toMatch(/getGithubCalendar\(username,\s*days\)/);
    expect(src).toMatch(/githubLive/);
  });
  it('returns the private-envelope shape (frontend merge stays verbatim)', () => {
    const src = readSrc('routes/publicProfile.ts');
    expect(src).toMatch(/stored,/);
    expect(src).toMatch(/github,/);
    expect(src).toMatch(/windowDays:\s*days/);
    expect(src).toMatch(/omitted:\s*\['codechef',\s*'hackerrank',\s*'gfg'\]/);
    expect(src).toMatch(/omittedReason/);
    expect(src).toMatch(/sources:\s*\{/);
  });
  it('scopes to the VIEWED user (username -> id, then userId queries)', () => {
    const src = readSrc('routes/publicProfile.ts');
    // Narrow user lookup by username first (no full-row read).
    expect(src).toMatch(/user\.findFirst\(\{\s*where:\s*\{\s*username:\s*raw\s*\}/);
    // Activity + profile reads keyed by the viewed id (never req.userId —
    // this route is public, there is no authenticated user).
    const handler = src.slice(src.indexOf("router.get('/:username/activity'"));
    expect(handler).toMatch(/where:\s*\{\s*userId:\s*target\.id/);
    expect(handler).not.toMatch(/req\.userId/);
  });
  it('keeps privacy: per-day counts only (no email/private cols in the handler)', () => {
    const src = readSrc('routes/publicProfile.ts');
    const handler = src.slice(
      src.indexOf("router.get('/:username/activity'"),
      src.indexOf('// GET /api/u/:username  -> public profile'),
    );
    expect(handler).not.toMatch(/email/);
    expect(handler).not.toMatch(/passwordHash/);
    expect(handler).not.toMatch(/platformStats/);
  });
  it('rate-limits + noindex + private cache like the main public profile', () => {
    const src = readSrc('routes/publicProfile.ts');
    const handler = src.slice(src.indexOf("router.get('/:username/activity'"));
    expect(handler).toMatch(/publicProfileLimiter/);
    expect(handler).toMatch(/X-Robots-Tag/);
    expect(handler).toMatch(/noindex/);
    expect(handler).toMatch(/Cache-Control/);
    expect(handler).toMatch(/private,\s*max-age=60/);
  });
  it('validates usernames + 404s unknown users (same contract as /:username)', () => {
    const src = readSrc('routes/publicProfile.ts');
    const handler = src.slice(src.indexOf("router.get('/:username/activity'"));
    expect(handler).toMatch(/Invalid username/);
    expect(handler).toMatch(/status\(400\)/);
    expect(handler).toMatch(/User not found/);
    expect(handler).toMatch(/status\(404\)/);
  });
  it('never 500s pre-migration (stored degrades to [], github still served)', () => {
    const src = readSrc('routes/publicProfile.ts');
    const handler = src.slice(src.indexOf("router.get('/:username/activity'"));
    expect(handler).toMatch(/stored\s*=\s*\[\]/);
    expect(handler).toMatch(/Pre-migration/);
  });
});
