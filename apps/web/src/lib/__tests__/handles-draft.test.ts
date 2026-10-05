// apps/web/src/lib/__tests__/handles-draft.test.ts — TDD RED for in-memory handles draft.
// WHY (fix 2026-10-05): unsaved handles/usernames must NOT persist in localStorage.
// Desired: controlled inputs with in-memory draft (useState/useRef) that survives
// in-app tab switches (state lifted, no unmount loss) but DISCARDS on refresh
// (reload loads server original). No localStorage/sessionStorage for unsaved edits.
// Best practice (React controlled forms): form state lives in React state as single
// source of truth; persistence happens only on explicit Save (PUT). localStorage
// drafts are reserved for long onboarding flows where refresh-survival is explicit —
// not for Settings/handles where refresh must discard unsaved edits.
// (see dev.to/react-form-handling + javascript.plainenglish.io/form-state-management:
// "controlled input keeps value in React state; persist only on submit").
// Run: npx vitest run src/lib/__tests__/handles-draft.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  return mem;
}

function readHelper(): string {
  return readFileSync(join(process.cwd(), 'src/lib/handlesDraft.ts'), 'utf8');
}

beforeEach(() => {
  installMemoryStorage();
});

describe('handles draft is in-memory only (no localStorage persistence)', () => {
  it('helper never touches localStorage/sessionStorage for unsaved edits', () => {
    const src = readHelper();
    expect(src).not.toMatch(/localStorage\s*\.\s*(getItem|setItem|removeItem)/);
    expect(src).not.toMatch(/sessionStorage\s*\.\s*(getItem|setItem|removeItem)/);
  });
  it('refresh discards: read returns null even after write (no restore on mount)', () => {
    writeHandlesDraft({ leetcodeHandle: 'tourist' } as any);
    // Deprecated no-op — must NOT restore on refresh/mount.
    expect(readHandlesDraft()).toBeNull();
  });
  it('write does not create cf-handles-draft key (no persistence)', () => {
    writeHandlesDraft({ leetcodeHandle: 'tourist', codeforcesHandle: 'cf_user' } as any);
    expect(localStorage.getItem(HANDLES_DRAFT_KEY)).toBeNull();
    expect(readHandlesDraft()).toBeNull();
  });
  it('clear is deprecated no-op (stays null, no storage)', () => {
    writeHandlesDraft({ leetcodeHandle: 'x' } as any);
    clearHandlesDraft();
    expect(readHandlesDraft()).toBeNull();
    expect(localStorage.getItem(HANDLES_DRAFT_KEY)).toBeNull();
  });
  it('returns null when no draft (refresh loads server original)', () => {
    expect(readHandlesDraft()).toBeNull();
  });
  it('merge (pure, in-memory) prefers draft values over server (tab-switch refetch guard)', () => {
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
    // typed value survives in-memory refetch
    expect(merged.leetcodeHandle).toBe('typed_name');
    // empty draft keys fall back to server
    expect(merged.codeforcesHandle).toBe('');
  });
  it('merge with null draft returns server verbatim (fresh mount)', () => {
    const server = { leetcodeHandle: 'srv', codeforcesHandle: 'cf' } as any;
    expect(mergeHandlesWithDraft(server, null)).toEqual(server);
  });
});
