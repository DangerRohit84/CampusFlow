// components/room/threads-lite.test.ts — #8 threads-lite client helpers.
// WHY: thread nesting + local mute are the client-side source of truth for
// RoomChatPanel/RoomsPage badge suppression; locked here (pure, no DOM).
// Run: npm run test -w @campusflow/web
import { describe, it, expect } from 'vitest';
import {
  buildThreadChildren,
  buildIdSet,
  isThreadRoot,
  getReplyCount,
  collectDescendantIds,
  threadLatestAt,
} from './threadUtils';
import {
  readMutedLocal,
  writeMutedLocal,
  isRoomMutedLocal,
  setRoomMutedLocal,
  notifyMuteChanged,
  MUTE_STORAGE_KEY,
  type KeyValueStore,
} from './roomMute';

function memStore(seed?: Record<string, string>): KeyValueStore {
  const data = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const msgs = [
  { id: 'p1', createdAt: '2026-09-10T10:00:00.000Z', replyTo: null },
  { id: 'r1', createdAt: '2026-09-10T10:02:00.000Z', replyTo: { id: 'p1' } },
  { id: 'r2', createdAt: '2026-09-10T10:01:00.000Z', replyTo: { id: 'p1' } },
  { id: 'rr1', createdAt: '2026-09-10T10:03:00.000Z', replyTo: { id: 'r1' } },
  { id: 'orphan', createdAt: '2026-09-10T10:04:00.000Z', replyTo: { id: 'ghost' } },
];

describe('buildThreadChildren', () => {
  it('groups by replyTo.id, chronological asc', () => {
    const map = buildThreadChildren(msgs);
    expect(map.get('p1')!.map((m) => m.id)).toEqual(['r2', 'r1']);
    expect(map.get('r1')!.map((m) => m.id)).toEqual(['rr1']);
    expect(map.has('p1') && map.get('p1')!.length).toBe(2);
  });
  it('returns an empty map for no replies', () => {
    expect(buildThreadChildren([{ id: 'a', createdAt: '2026-09-10T10:00:00.000Z' }]).size).toBe(0);
  });
});

describe('isThreadRoot', () => {
  it('roots plain messages; orphans (missing parent) render standalone', () => {
    const ids = buildIdSet(msgs);
    expect(isThreadRoot(msgs[0], ids)).toBe(true);
    expect(isThreadRoot(msgs[1], ids)).toBe(false);
    // parent 'ghost' not in set → root with its quote chip
    expect(isThreadRoot(msgs[4], ids)).toBe(true);
  });
});

describe('getReplyCount', () => {
  it('counts direct children, 0 when none', () => {
    const map = buildThreadChildren(msgs);
    expect(getReplyCount(map, 'p1')).toBe(2);
    expect(getReplyCount(map, 'r1')).toBe(1);
    expect(getReplyCount(map, 'nope')).toBe(0);
  });
});

describe('collectDescendantIds', () => {
  it('collects nested descendants depth-capped', () => {
    const map = buildThreadChildren(msgs);
    expect([...collectDescendantIds(map, 'p1')].sort()).toEqual(['r1', 'r2', 'rr1']);
    expect([...collectDescendantIds(map, 'p1', 1)].sort()).toEqual(['r1', 'r2']);
  });
  it('terminates on reply cycles', () => {
    const cyclic = [
      { id: 'a', createdAt: '2026-09-10T10:00:00.000Z', replyTo: { id: 'b' } },
      { id: 'b', createdAt: '2026-09-10T10:01:00.000Z', replyTo: { id: 'a' } },
    ];
    expect(() => collectDescendantIds(buildThreadChildren(cyclic), 'a')).not.toThrow();
    expect(collectDescendantIds(buildThreadChildren(cyclic), 'a').size).toBe(2);
  });
});

describe('threadLatestAt', () => {
  it('returns the newest instant in the subtree', () => {
    const map = buildThreadChildren(msgs);
    expect(new Date(threadLatestAt(msgs[0], map)).toISOString()).toBe('2026-09-10T10:03:00.000Z');
  });
});

describe('roomMute local store', () => {
  it('starts empty and flips one room', () => {
    const s = memStore();
    expect(readMutedLocal(s).size).toBe(0);
    expect(isRoomMutedLocal('r1', s)).toBe(false);
    setRoomMutedLocal('r1', true, s);
    expect(isRoomMutedLocal('r1', s)).toBe(true);
    setRoomMutedLocal('r1', false, s);
    expect(isRoomMutedLocal('r1', s)).toBe(false);
  });
  it('round-trips through the storage key', () => {
    const s = memStore();
    writeMutedLocal(['a', 'b', 'a'], s);
    expect(readMutedLocal(s)).toEqual(new Set(['a', 'b']));
    expect(JSON.parse(s.getItem(MUTE_STORAGE_KEY)!)).toEqual(['a', 'b']);
  });
  it('degrades on corrupt JSON and null store', () => {
    const s = memStore({ [MUTE_STORAGE_KEY]: 'garbage{' });
    expect(readMutedLocal(s)).toEqual(new Set());
    expect(isRoomMutedLocal('r1', null)).toBe(false);
    expect(() => setRoomMutedLocal('r1', true, null)).not.toThrow();
  });
  it('notifyMuteChanged never throws without a DOM', () => {
    expect(() => notifyMuteChanged('r1', true)).not.toThrow();
  });
});
