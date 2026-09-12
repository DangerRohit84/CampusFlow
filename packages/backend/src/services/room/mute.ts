// services/room/mute.ts — threads-lite (#8) per-channel mute prefs (pure, no DB).
// Order 9 (V-05): User.preferences is now Json (JSONB). Helpers accept Json|String
// (rollout + stale replicas + hermetic tests using JSON strings); setRoomMuted
// keeps string return for test compat — callers parse to object for DB writes
// (see routes/rooms.ts). Readers never throw ({} / [] on corrupt).
// WHY: no new table/migration — muted room ids live in the existing
// User.preferences JSON under the `mutedRooms` key (string[] of room ids),
// merged with whatever else the client stored there (e.g. groqApiKey).
// Corrupt JSON degrades to {} (never throws); the list is capped so the
// column cannot grow unboundedly.

export const MUTED_ROOMS_KEY = 'mutedRooms';
export const MAX_MUTED_ROOMS = 200;

/** Parse preferences Json|String safely ({} on missing/corrupt). */
export function parsePreferences(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return {};
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
}

/** Muted room ids from preferences Json|String (deduped, order-stable). */
export function getMutedRoomIds(raw: unknown): string[] {
  const prefs = parsePreferences(raw);
  const list = prefs[MUTED_ROOMS_KEY];
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  for (const v of list) {
    if (typeof v === 'string' && v) seen.add(v);
    if (seen.size >= MAX_MUTED_ROOMS) break;
  }
  return [...seen];
}

/**
 * New preferences JSON with roomId muted/unmuted (other keys preserved).
 * Unmuting removes the id; muting prepends it (most-recent first).
 */
export function setRoomMuted(
  raw: unknown,
  roomId: string,
  muted: boolean,
): string {
  const prefs = parsePreferences(raw);
  const current = getMutedRoomIds(raw);
  let next: string[];
  if (muted) {
    next = [roomId, ...current.filter((id) => id !== roomId)].slice(0, MAX_MUTED_ROOMS);
  } else {
    next = current.filter((id) => id !== roomId);
  }
  return JSON.stringify({ ...prefs, [MUTED_ROOMS_KEY]: next });
}
