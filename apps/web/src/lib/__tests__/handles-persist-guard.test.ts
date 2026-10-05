// apps/web/src/lib/__tests__/handles-persist-guard.test.ts — guard for in-memory handles draft.
// WHY (fix 2026-10-05): unsaved handles/usernames must NOT persist in localStorage
// (cf-handles-draft survived refresh — user rejects). Desired: controlled inputs with
// in-memory draft (useState/useRef) that survives in-app tab switches (state lifted,
// no unmount loss, no loadData overwrite when dirty) but DISCARDS on refresh
// (mount always loads server original). No localStorage/sessionStorage for unsaved edits.
// Best practice: React controlled forms keep value in React state (single source of
// truth); persist only on explicit Save PUT. localStorage drafts are for long flows
// where refresh-survival is explicit — not Settings/handles.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readPage(): string {
  return readFileSync(join(process.cwd(), 'src/pages/CodingProfilePage.tsx'), 'utf8');
}
function readHelper(): string {
  return readFileSync(join(process.cwd(), 'src/lib/handlesDraft.ts'), 'utf8');
}
function readSettings(): string {
  return readFileSync(join(process.cwd(), 'src/pages/SettingsPage.tsx'), 'utf8');
}
function readModal(): string {
  return readFileSync(join(process.cwd(), 'src/components/UsernameSetupModal.tsx'), 'utf8');
}

describe('CodingProfilePage handles are in-memory only (refresh discards, tab switch preserves)', () => {
  it('has no localStorage/sessionStorage draft for unsaved handles (no cf-handles-draft)', () => {
    const src = readPage();
    expect(src).not.toContain('cf-handles-draft');
    expect(src).not.toContain('readHandlesDraft');
    expect(src).not.toContain('writeHandlesDraft');
    expect(src).not.toContain('clearHandlesDraft');
    // No direct storage of unsaved handles draft (heatmap/toggles storage is unrelated and allowed)
    expect(src).not.toMatch(/localStorage\s*\.\s*(getItem|setItem).*handles.*draft/i);
    expect(src).not.toMatch(/sessionStorage\s*\.\s*(getItem|setItem)/);
  });
  it('keeps in-memory draft that survives tab switches (lifted state, no key remount)', () => {
    const src = readPage();
    // Controlled inputs with in-memory draft
    expect(src).toMatch(/const\s*\[\s*handles\s*,\s*setHandles\s*\]/);
    expect(src).toContain('updateHandles');
    // Dirty tracking so focus/socket refetch never wipes typed input
    expect(src).toMatch(/handlesDirty|isDirty|hasEdited|dirtyRef|hasUnsaved/i);
  });
  it('loadData guards overwrite when dirty (no wipe on focus/socket refetch) but mount loads server', () => {
    const src = readPage();
    // Must build server handles from profile on mount
    expect(src).toMatch(/serverHandles/);
    expect(src).toMatch(/setHandles\s*\(\s*serverHandles/);
    // Must guard the overwrite with a dirty check (in-memory preservation)
    expect(src).toMatch(/if\s*\(\s*!.*[Dd]irty|if\s*\(\s*!.*hasEdited|dirty.*\?\s*.*:\s*|!handlesDirty/i);
  });
  it('updateHandles is storage-free (setHandles only, no persistence)', () => {
    const src = readPage();
    const idx = src.indexOf('const updateHandles');
    expect(idx).toBeGreaterThan(-1);
    const snippet = src.slice(idx, idx + 600);
    expect(snippet).toMatch(/setHandles/);
    expect(snippet).not.toMatch(/writeHandlesDraft|localStorage|sessionStorage/);
  });
  it('save stays explicit PUT with validation unchanged (dirty gating)', () => {
    const src = readPage();
    expect(src).toContain('codingProfileAPI.update');
    const updateCount = (src.match(/codingProfileAPI\.update/g) || []).length;
    expect(updateCount).toBe(1);
    expect(src).toContain('isValidGithubUsername');
    expect(src).not.toMatch(/onBlur=\{[^}]*handleSave|onBlur=\{[^}]*codingProfileAPI\.update/);
  });
  it('handlesDraft helper is deprecated storage-free (no localStorage/sessionStorage)', () => {
    const src = readHelper();
    expect(src).not.toMatch(/localStorage\s*\.\s*(getItem|setItem|removeItem)/);
    expect(src).not.toMatch(/sessionStorage\s*\.\s*(getItem|setItem|removeItem)/);
    expect(src).toMatch(/deprecated|DEPRECATED|in-memory/i);
  });
});

describe('Settings + UsernameSetupModal username drafts stay in-memory (no storage)', () => {
  it('SettingsPage has no localStorage/sessionStorage draft for username/handles edits', () => {
    const src = readSettings();
    expect(src).not.toContain('cf-handles-draft');
    expect(src).not.toContain('readHandlesDraft');
    expect(src).not.toContain('writeHandlesDraft');
    expect(src).not.toMatch(/localStorage\s*\.\s*(getItem|setItem).*username.*draft/i);
    expect(src).not.toMatch(/sessionStorage\s*\.\s*(getItem|setItem)/);
    // In-memory draft still present (controlled input + dirty gating)
    expect(src).toMatch(/const\s*\[\s*username\s*,\s*setUsername/);
    expect(src).toMatch(/isDirty|isUnchanged/);
  });
  it('UsernameSetupModal stays in-memory (no storage for unsaved username)', () => {
    const src = readModal();
    expect(src).not.toContain('cf-handles-draft');
    expect(src).not.toMatch(/localStorage\s*\.\s*(getItem|setItem)/);
    expect(src).not.toMatch(/sessionStorage\s*\.\s*(getItem|setItem)/);
    expect(src).toMatch(/const\s*\[\s*username\s*,\s*setUsername/);
  });
});
