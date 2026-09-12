// components/room/roomMute.ts — threads-lite (#8) per-channel mute store.
// WHY: mute must work offline-first (localStorage) AND survive logout/device
// switch (backend pref in User.preferences via roomAPI). Every socket/badge
// handler in scope checks isRoomMutedLocal() before toasting or incrementing.
// Storage is injectable so vitest runs in node (no DOM localStorage).

export const MUTE_STORAGE_KEY = 'campusflow:muted-rooms';
export const MUTE_CHANGED_EVENT = 'room:mute-changed';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): KeyValueStore | null {
  try {
    const s = (globalThis as unknown as { localStorage?: KeyValueStore }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === 'string' && !!x);
  } catch {
    return [];
  }
}

/** Muted room ids from localStorage (empty set when unavailable/corrupt). */
export function readMutedLocal(store: KeyValueStore | null = defaultStore()): Set<string> {
  try {
    return new Set(parseList(store?.getItem(MUTE_STORAGE_KEY) ?? null));
  } catch {
    return new Set();
  }
}

/** Overwrite the local muted set (used to reconcile with the backend pref). */
export function writeMutedLocal(ids: Iterable<string>, store: KeyValueStore | null = defaultStore()): void {
  try {
    store?.setItem(MUTE_STORAGE_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    /* private-mode quota — mute still holds for this session via callers */
  }
}

export function isRoomMutedLocal(roomId: string, store: KeyValueStore | null = defaultStore()): boolean {
  return readMutedLocal(store).has(roomId);
}

/** Flip one room's local mute; returns the next set (persisted). */
export function setRoomMutedLocal(
  roomId: string,
  muted: boolean,
  store: KeyValueStore | null = defaultStore(),
): Set<string> {
  const next = readMutedLocal(store);
  if (muted) next.add(roomId);
  else next.delete(roomId);
  writeMutedLocal(next, store);
  return next;
}

/** Broadcast so every mounted rooms surface (panel/pages/badges) syncs instantly. */
export function notifyMuteChanged(roomId: string, muted: boolean): void {
  try {
    window.dispatchEvent(new CustomEvent(MUTE_CHANGED_EVENT, { detail: { roomId, muted } }));
  } catch {
    /* non-DOM (tests) — callers already hold the value */
  }
}
