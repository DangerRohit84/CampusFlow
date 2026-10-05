// apps/web/src/lib/handlesDraft.ts — CodingProfile handles draft persistence (pure + storage).
// WHY (issue #3): while adding usernames, switching tab (browser focus refetch
// via useEntitySync + socket refetch) wiped entered usernames. Root cause:
// loadData() unconditionally overwrote `handles` with server profile.
// Fix: localStorage draft persists across tab switches; loadData merges server
// + draft (dirty draft wins, no wipe). Cleared on successful save. Validation
// + save unchanged.
export const HANDLES_DRAFT_KEY = 'cf-handles-draft';

export type HandlesMap = Record<string, string>;

/** Read draft from localStorage. Null when absent/corrupted. Pure-ish (fail-open). */
export function readHandlesDraft(): HandlesMap | null {
  try {
    const raw = localStorage.getItem(HANDLES_DRAFT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
    const out: HandlesMap = {};
    for (const [k, v] of Object.entries(p)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

/** Persist draft (best-effort, private-mode safe). */
export function writeHandlesDraft(h: HandlesMap): void {
  try {
    localStorage.setItem(HANDLES_DRAFT_KEY, JSON.stringify(h ?? {}));
  } catch {
    /* private-mode — draft still works in-memory for this mount */
  }
}

/** Clear draft (after successful save). */
export function clearHandlesDraft(): void {
  try {
    localStorage.removeItem(HANDLES_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Merge server handles + local draft. Dirty draft values (non-empty strings)
 * win so a refetch never wipes typed input; empty draft keys fall back to
 * server. Null draft returns server verbatim. Pure.
 */
export function mergeHandlesWithDraft(server: HandlesMap, draft: HandlesMap | null | undefined): HandlesMap {
  if (!draft || typeof draft !== 'object') return { ...server };
  const out: HandlesMap = { ...server };
  for (const [k, v] of Object.entries(draft)) {
    if (typeof v === 'string' && v !== '') {
      out[k] = v;
    } else if (!(k in out) && typeof v === 'string') {
      out[k] = v;
    }
    // empty-string draft never overwrites a non-empty server value (no wipe
    // via blank), but preserves the key when server lacks it.
  }
  return out;
}
