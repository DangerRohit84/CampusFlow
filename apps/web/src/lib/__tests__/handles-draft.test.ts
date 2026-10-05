// apps/web/src/lib/__tests__/handles-draft.test.ts — TDD RED for handles draft persistence.
// WHY (issue #3): while adding usernames, switching tab wipes entered username.
// Root cause: loadData() unconditionally overwrites handles with server profile,
// triggered by focus/socket refetch (useEntitySync). Fix: localStorage draft
// persists across tab switches + loadData preserves dirty draft (no wipe).
import { describe, it, expect, beforeEach } from 'vitest';
import {
  HANDLES_DRAFT_KEY,
  readHandlesDraft,
  writeHandlesDraft,
  clearHandlesDraft,
  mergeHandlesWithDraft,
} from '../handlesDraft';

function installMemoryStorage() {
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (mem.has(k) ? (mem.get(k) as string) : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => mem.clear(),
  };
}
beforeEach(() => {
  installMemoryStorage();
});

describe('handles draft persistence (no wipe on tab switch)', () => {
  it('writes + reads draft round-trip', () => {
    writeHandlesDraft({ leetcodeHandle: 'tourist', codeforcesHandle: 'cf_user' } as any);
    const back = readHandlesDraft();
    expect(back?.leetcodeHandle).toBe('tourist');
    expect(back?.codeforcesHandle).toBe('cf_user');
  });
  it('returns null when no draft', () => {
    expect(readHandlesDraft()).toBeNull();
  });
  it('fail-open null on corrupted storage', () => {
    localStorage.setItem(HANDLES_DRAFT_KEY, '{not-json');
    expect(readHandlesDraft()).toBeNull();
  });
  it('clear removes draft (after save)', () => {
    writeHandlesDraft({ leetcodeHandle: 'x' } as any);
    clearHandlesDraft();
    expect(readHandlesDraft()).toBeNull();
  });
  it('merge prefers draft values over server (dirty draft survives refetch)', () => {
    const server = {
      leetcodeHandle: 'server_name',
      codeforcesHandle: '',
      codechefHandle: '',
      hackerrankHandle: '',
      gfgHandle: '',
      githubUsername: '',
    } as any;
    const draft = { leetcodeHandle: 'typed_name' } as any;
    const merged = mergeHandlesWithDraft(server, draft);
    // typed value survives server refetch
    expect(merged.leetcodeHandle).toBe('typed_name');
    // empty draft keys fall back to server
    expect(merged.codeforcesHandle).toBe('');
  });
  it('merge with null draft returns server verbatim', () => {
    const server = { leetcodeHandle: 'srv', codeforcesHandle: 'cf' } as any;
    expect(mergeHandlesWithDraft(server, null)).toEqual(server);
  });
});
