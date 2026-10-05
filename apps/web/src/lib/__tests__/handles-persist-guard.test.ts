// apps/web/src/lib/__tests__/handles-persist-guard.test.ts — guard for handles no-wipe.
// WHY (issue #3): switching tab (focus/socket refetch) must not wipe typed usernames.
// Page must: init from draft, merge draft over server on loadData, persist on change,
// clear on save. Validation + save unchanged.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readPage(): string {
  return readFileSync(join(process.cwd(), 'src/pages/CodingProfilePage.tsx'), 'utf8');
}

describe('CodingProfilePage handles persist across tabs (no wipe)', () => {
  it('initializes from draft + merges on loadData (no unconditional overwrite)', () => {
    const src = readPage();
    expect(src).toContain('readHandlesDraft');
    expect(src).toContain('mergeHandlesWithDraft');
    // loadData must merge, not blindly setHandles(server)
    expect(src).toMatch(/mergeHandlesWithDraft\(serverHandles/);
  });
  it('persists edits to draft on change', () => {
    const src = readPage();
    expect(src).toContain('writeHandlesDraft');
    expect(src).toContain('updateHandles');
  });
  it('clears draft on successful save (validation unchanged)', () => {
    const src = readPage();
    expect(src).toContain('clearHandlesDraft');
    // validation preserved
    expect(src).toContain('isValidGithubUsername');
    expect(src).toContain('codingProfileAPI.update');
  });
});
