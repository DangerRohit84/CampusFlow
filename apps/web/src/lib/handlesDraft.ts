// apps/web/src/lib/handlesDraft.ts — DEPRECATED in-memory shim (no persistence).
// WHY (fix 2026-10-05): unsaved handles/usernames must NOT survive refresh.
// Desired: controlled inputs with in-memory draft (useState/useRef) that survives
// in-app tab switches (state lifted, no unmount loss) but DISCARDS on refresh
// (mount always loads server original). No web storage for unsaved edits.
// Best practice (React controlled forms): form value lives in React state as single
// source of truth; persistence happens only on explicit Save (PUT). Storage-backed
// drafts are reserved for long onboarding flows where refresh-survival is explicit —
// not for Settings/handles where refresh must discard unsaved edits.
// This module is kept for backward-compat imports only. All helpers are no-ops
// except the pure merge (in-memory use). Do NOT add storage access here.
/** @deprecated Never written — kept for import compat. Do not use for drafts. */
export const HANDLES_DRAFT_KEY = 'cf-handles-draft';

export type HandlesMap = Record<string, string>;

/**
 * @deprecated Always returns null — refresh discards unsaved edits.
 * Mount loads server original; no draft restore.
 */
export function readHandlesDraft(): HandlesMap | null {
  return null;
}

/**
 * @deprecated No-op — unsaved edits stay in-memory only (no persistence).
 */
export function writeHandlesDraft(_h: HandlesMap): void {
  return;
}

/**
 * @deprecated No-op — nothing persisted, nothing to clear.
 */
export function clearHandlesDraft(): void {
  return;
}

/**
 * Merge server handles + in-memory draft. Dirty draft values (non-empty strings)
 * win so a refetch never wipes typed input; empty draft keys fall back to
 * server. Null draft returns server verbatim. Pure (no storage).
 * @deprecated Prefer dirty-guard in page (skip overwrite when dirty); kept pure for tests.
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
