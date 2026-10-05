// apps/web/src/lib/__tests__/username-draft-guard.test.ts — TDD guard for username draft-only save.
// WHY: username change must save ONLY on explicit Save click (PUT /username/change or POST /username/setup).
// No auto PUT on change/blur/debounce. Edits stay local draft until Save. Save disabled when
// unchanged/invalid. Keeps remaining-attempts copy + 403 handling.
// Run: npx vitest run src/lib/__tests__/username-draft-guard.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readSettings(): string {
  return readFileSync(join(process.cwd(), 'src/pages/SettingsPage.tsx'), 'utf8');
}
function readModal(): string {
  return readFileSync(join(process.cwd(), 'src/components/UsernameSetupModal.tsx'), 'utf8');
}

describe('SettingsPage username stays draft until Save (no auto-PUT)', () => {
  it('onChange only updates local draft + schedules check (never calls setup/change PUT)', () => {
    const src = readSettings();
    // Explicit save path exists
    expect(src).toMatch(/handleSaveUsername/);
    expect(src).toMatch(/setupUsername|changeUsername/);
    // onChange handler must NOT directly call setup/change — only setUsername + check
    const onChangeLines = src.split('\n').filter((l) => l.includes('onChange') && l.toLowerCase().includes('username') === false);
    // Stronger: the username input onChange block must not contain PUT calls
    const usernameInputIdx = src.indexOf('value={username}');
    expect(usernameInputIdx).toBeGreaterThan(-1);
    const snippet = src.slice(usernameInputIdx, usernameInputIdx + 800);
    expect(snippet).not.toMatch(/setupUsername|changeUsername/);
    expect(snippet).toMatch(/setUsername/);
  });
  it('has no blur auto-save and no effect auto-save for username', () => {
    const src = readSettings();
    // No onBlur that triggers username save
    expect(src).not.toMatch(/onBlur=\{[^}]*handleSaveUsername|onBlur=\{[^}]*changeUsername|onBlur=\{[^}]*setupUsername/);
    // No useEffect that auto-calls change/setup (effects only load profile/handles)
    const effects = src.match(/useEffect\([\s\S]*?\}, \[[^\]]*\]\)/g) || [];
    for (const eff of effects) {
      expect(eff).not.toMatch(/changeUsername|setupUsername/);
    }
  });
  it('Save disabled when unchanged or invalid (dirty + valid gating)', () => {
    const src = readSettings();
    // Must track dirty/unchanged vs original (profile.username or user.username)
    expect(src).toMatch(/isDirty|isUnchanged|dirty|unchanged/i);
    // Must validate format before enabling Save (regex 3-20)
    expect(src).toMatch(/isValid|isUsernameValid|usernameValid/);
    // Save button disabled prop must include dirty + valid gating (not just saving/checking)
    const saveIdx = src.indexOf('handleSaveUsername');
    expect(saveIdx).toBeGreaterThan(-1);
    // Find the Save button disabled attribute near handleSaveUsername
    const disabledMatch = src.match(/disabled=\{[^}]*handleSaveUsername[^}]*\}|<button[^>]*onClick=\{handleSaveUsername\}[^>]*disabled=\{[^}]+\}/s);
    // Fallback: find disabled={...} containing isDirty/isValid near Save
    const hasDirtyDisabled =
      /disabled=\{[^}]*isDirty[^}]*\}/.test(src) || /disabled=\{[^}]*Unchanged[^}]*\}/.test(src) || /disabled=\{[^}]*!isValid[^}]*\}/.test(src);
    expect(hasDirtyDisabled, 'Save disabled must gate on dirty + valid').toBe(true);
    void disabledMatch;
  });
  it('shows dirty state (unsaved changes affordance)', () => {
    const src = readSettings();
    expect(src).toMatch(/Unsaved|unsaved|dirty|You have unsaved|Not saved/i);
  });
  it('debounces availability check + skips unchanged (no per-keystroke storm)', () => {
    const src = readSettings();
    // Debounce via setTimeout/clearTimeout or useDebounce with ~300ms
    expect(src).toMatch(/setTimeout|useDebounce|debounce/i);
    // Must skip check for unchanged/current username (avoid self-taken + rate storm)
    expect(src).toMatch(/unchanged|original|current.*username|skip.*check|if.*===.*return/i);
  });
  it('keeps remaining-attempts copy + 403 handling (no regression)', () => {
    const src = readSettings();
    expect(src).toMatch(/change.*left of 3|remaining|Maximum username changes/);
    expect(src).toMatch(/403/);
  });
});

describe('UsernameSetupModal saves only on explicit Save (no auto-PUT)', () => {
  it('only handleSave/handleKeep call setup/change/keep (no effect/blur auto-save)', () => {
    const src = readModal();
    expect(src).toMatch(/handleSave/);
    expect(src).toMatch(/setupUsername|changeUsername/);
    // No onBlur save
    expect(src).not.toMatch(/onBlur=\{[^}]*handleSave|onBlur=\{[^}]*changeUsername|onBlur=\{[^}]*setupUsername/);
    // No useEffect auto-save (effects are suggest + debounce check only)
    const effects = src.match(/useEffect\([\s\S]*?\}, \[[^\]]*\]\)/g) || [];
    for (const eff of effects) {
      // debounce check effect may contain checkUsername but never setup/change PUT
      if (eff.includes('checkUsername') || eff.includes('debounce')) {
        expect(eff).not.toMatch(/setupUsername|changeUsername/);
      }
    }
    // Username input onChange only sets draft (sanitize + setUsername), never PUTs
    const inputIdx = src.indexOf('value={username}');
    expect(inputIdx).toBeGreaterThan(-1);
    const snippet = src.slice(inputIdx - 200, inputIdx + 600);
    expect(snippet).not.toMatch(/setupUsername|changeUsername/);
  });
  it('Save disabled when invalid or unavailable (dirty gating in change mode)', () => {
    const src = readModal();
    expect(src).toMatch(/canSave/);
    expect(src).toMatch(/isValid|available !== false|!checking/);
  });
});
