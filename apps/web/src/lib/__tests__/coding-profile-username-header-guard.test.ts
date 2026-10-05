// apps/web/src/lib/__tests__/coding-profile-username-header-guard.test.ts — TDD guard for CodingProfilePage site-username display.
// WHY: header showed only display name, hiding CampusFlow @username + /u/:username self link + Settings edit entry.
// Platform handles (LC/CF/CC/HR/GFG/githubUsername) are per-site handles, distinct from site @username.
// Users couldn't verify public URL (/u/:username) or discover username edit (Settings + SetupModal) from coding profile.
// Fail-open: missing username renders no /u/undefined link. Handles stay draft-only (no autosave).
// Run: npx vitest run src/lib/__tests__/coding-profile-username-header-guard.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readPage(): string {
  return readFileSync(join(process.cwd(), 'src/pages/CodingProfilePage.tsx'), 'utf8');
}

describe('CodingProfilePage header shows site @username with self /u/:username link', () => {
  it('header links @username to encoded /u/:username (internal Link, not external)', () => {
    const src = readPage();
    // Must build self link from authenticated user username, encoded
    expect(src).toMatch(/\/u\/\$\{encodeURIComponent\(\(user as any\)\?\.username/);
    // Must use react-router Link for internal SPA nav (mirrors leaderboard)
    expect(src).toMatch(/<Link[^>]*to=\{\`\/u\//);
  });
  it('fail-open: no /u/undefined when site username missing', () => {
    const src = readPage();
    // Header self-link must be guarded by username presence (ternary with optional paren/newline, or &&)
    expect(src).toMatch(/\(user as any\)\?\.username\s*\?\s*\(?\s*<Link|user\?\.username\s*\?\s*\(?\s*<Link|user\?\.username\s*&&/);
  });
  it('header offers discoverable username edit entry (Settings link)', () => {
    const src = readPage();
    // Must link to Settings where username change lives (SetupModal is modal-only)
    expect(src).toMatch(/to="\/settings"|href="\/settings"|Link[^>]*\/settings/);
  });
});

describe('CodingProfilePage clarifies platform handles vs site username', () => {
  it('Platform Handles section states distinct from CampusFlow @username', () => {
    const src = readPage();
    expect(src).toContain('Platform Handles');
    // Must explicitly contrast per-platform handles with site @username to prevent confusion
    expect(src).toMatch(/distinct from|different from|not your CampusFlow|CampusFlow @username/i);
  });
});

describe('CodingProfilePage handles stay draft-only (no autosave on change/blur)', () => {
  it('handle inputs never call update PUT on change/blur — only explicit Save Handles', () => {
    const src = readPage();
    // Explicit save path exists
    expect(src).toContain('handleSave');
    expect(src).toContain('codingProfileAPI.update');
    // update PUT must appear exactly once (inside handleSave), never in onChange/onBlur/useEffect
    const updateCount = (src.match(/codingProfileAPI\.update/g) || []).length;
    expect(updateCount).toBe(1);
    // No onBlur that saves handles
    expect(src).not.toMatch(/onBlur=\{[^}]*handleSave|onBlur=\{[^}]*codingProfileAPI\.update/);
    // No useEffect autosave for handles (effects are load/cooldown/tabs only)
    const effects = src.match(/useEffect\([\s\S]*?\}, \[[^\]]*\]\)/g) || [];
    for (const eff of effects) {
      expect(eff).not.toMatch(/codingProfileAPI\.update/);
    }
  });
});
