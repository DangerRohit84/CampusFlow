/**
 * Threads-lite (#8) — nested threads + pins + ranked search + per-channel mute.
 *
 * Hermetic: pure helper behavior + static source/migration assertions (no DB).
 * - threads.ts: replyToId IS the thread parent (no parentId migration).
 * - search.ts: exact > prefix > fuzzy ranking.
 * - mute.ts: muted ids in User.preferences JSON (no new table).
 * - serialize: pins + replyCount ride the message wire.
 * - routes/rooms.ts: pin/threads/search/mute endpoints + mute-aware unread.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { groupReplies, countReplies, getThread } from '../src/services/room/threads'
import {
  rankMessages,
  scoreMessage,
  isSubsequence,
  levenshteinWithin,
  SEARCH_MAX_LIMIT,
} from '../src/services/room/search'
import {
  parsePreferences,
  getMutedRoomIds,
  setRoomMuted,
  MUTED_ROOMS_KEY,
  MAX_MUTED_ROOMS,
} from '../src/services/room/mute'
import { serializeRoomMessage } from '../src/services/room/serialize'

const BACKEND_ROOT = path.resolve(__dirname, '..')
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(BACKEND_ROOT, rel), 'utf8')
}

// ---- threads.ts ----

describe('threads: replyToId grouping (no parentId column)', () => {
  const msgs = [
    { id: 'p1', replyToId: null, createdAt: '2026-09-10T10:00:00Z' },
    { id: 'r2', replyToId: 'p1', createdAt: '2026-09-10T10:05:00Z' },
    { id: 'r1', replyToId: 'p1', createdAt: '2026-09-10T10:02:00Z' },
    { id: 'p2', replyToId: null, createdAt: '2026-09-10T11:00:00Z' },
  ]

  it('groups direct children by parent, chronological asc', () => {
    const { childrenByParentId, replyCounts } = groupReplies(msgs)
    expect([...childrenByParentId.keys()]).toEqual(['p1'])
    expect(childrenByParentId.get('p1')!.map((m) => m.id)).toEqual(['r1', 'r2'])
    expect(replyCounts.get('p1')).toBe(2)
    expect(replyCounts.has('p2')).toBe(false)
  })

  it('countReplies counts direct children only', () => {
    expect(countReplies(msgs, 'p1')).toBe(2)
    expect(countReplies(msgs, 'p2')).toBe(0)
    expect(countReplies(msgs, 'missing')).toBe(0)
    expect(countReplies([], 'p1')).toBe(0)
  })

  it('getThread returns parent + asc replies, null for unknown parent', () => {
    const t = getThread(msgs, 'p1')
    expect(t!.parent.id).toBe('p1')
    expect(t!.replies.map((m) => m.id)).toEqual(['r1', 'r2'])
    expect(getThread(msgs, 'p2')!.replies).toEqual([])
    expect(getThread(msgs, 'nope')).toBeNull()
  })
})

// ---- search.ts ----

describe('search: subsequence + levenshtein primitives', () => {
  it('isSubsequence matches in-order chars', () => {
    expect(isSubsequence('hllo', 'hello')).toBe(true)
    expect(isSubsequence('', 'hello')).toBe(true)
    expect(isSubsequence('olleh', 'hello')).toBe(false)
  })

  it('levenshteinWithin bounds typos', () => {
    expect(levenshteinWithin('homework', 'homewrok', 2)).toBe(true)
    expect(levenshteinWithin('homework', 'completely-different', 2)).toBe(false)
    expect(levenshteinWithin('a', 'abcdefghij', 2)).toBe(false)
  })
})

describe('search: exact > prefix > fuzzy ranking', () => {
  const at = (min: string) => `2026-09-10T10:${min}:00Z`
  const candidates = [
    { id: 'fuzzy', content: 'the asign list is ready', fileName: null, createdAt: at('00') },
    { id: 'prefix', content: 'assignments are posted in the portal', fileName: null, createdAt: at('01') },
    { id: 'exact', content: 'please read the assign notes', fileName: null, createdAt: at('02') },
  ]

  it('orders exact first, then prefix, then fuzzy', () => {
    const hits = rankMessages(candidates, 'assign')
    expect(hits.map((h) => h.message.id)).toEqual(['exact', 'prefix', 'fuzzy'])
    expect(hits.map((h) => h.kind)).toEqual(['exact', 'prefix', 'fuzzy'])
    expect(hits[0].score).toBeGreaterThan(hits[1].score)
    expect(hits[1].score).toBeGreaterThan(hits[2].score)
  })

  it('whole-content equality outranks contains', () => {
    const rows = [
      { id: 'contains', content: 'xx notes yy', fileName: null, createdAt: at('00') },
      { id: 'equal', content: 'notes', fileName: null, createdAt: at('01') },
    ]
    expect(rankMessages(rows, 'notes')[0].message.id).toBe('equal')
  })

  it('matches fileName for attachment-only messages', () => {
    const rows = [{ id: 'file', content: '', fileName: 'Lecture-5-Notes.pdf', createdAt: at('00') }]
    const hits = rankMessages(rows, 'notes')
    expect(hits).toHaveLength(1)
    expect(hits[0].kind).toBe('exact')
  })

  it('is case-insensitive and typo-tolerant', () => {
    const rows = [{ id: 't', content: 'Homework solutions', fileName: null, createdAt: at('00') }]
    expect(rankMessages(rows, 'HOMEWORK')).toHaveLength(1)
    expect(rankMessages(rows, 'homewrok')[0].kind).toBe('fuzzy')
  })

  it('excludes deleted messages and empty queries', () => {
    const rows = [{ id: 'd', content: 'notes here', fileName: null, isDeleted: true, createdAt: at('00') }]
    expect(rankMessages(rows, 'notes')).toEqual([])
    expect(rankMessages(candidates, '   ')).toEqual([])
  })

  it('caps at SEARCH_MAX_LIMIT (50)', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      id: `m${i}`,
      content: `notes number ${i}`,
      fileName: null,
      createdAt: at('00'),
    }))
    expect(rankMessages(many, 'notes', 999)).toHaveLength(SEARCH_MAX_LIMIT)
  })

  it('newer wins on score ties', () => {
    const rows = [
      { id: 'old', content: 'notes', fileName: null, createdAt: at('00') },
      { id: 'new', content: 'notes', fileName: null, createdAt: at('05') },
    ]
    expect(rankMessages(rows, 'notes')[0].message.id).toBe('new')
  })

  it('scoreMessage returns null for blank content and blank query', () => {
    expect(scoreMessage({ content: '', fileName: null }, 'notes')).toBeNull()
    expect(scoreMessage({ content: 'notes', fileName: null }, '  ')).toBeNull()
  })
})

// ---- mute.ts ----

describe('mute: preferences-JSON prefs (no new table)', () => {
  it('round-trips mute/unmute, most-recent first', () => {
    let prefs = '{}'
    prefs = setRoomMuted(prefs, 'r1', true)
    prefs = setRoomMuted(prefs, 'r2', true)
    expect(getMutedRoomIds(prefs)).toEqual(['r2', 'r1'])
    prefs = setRoomMuted(prefs, 'r1', false)
    expect(getMutedRoomIds(prefs)).toEqual(['r2'])
  })

  it('preserves unrelated keys (e.g. groqApiKey)', () => {
    const prefs = setRoomMuted(JSON.stringify({ groqApiKey: 'sk-x' }), 'r1', true)
    const parsed = parsePreferences(prefs)
    expect(parsed.groqApiKey).toBe('sk-x')
    expect(parsed[MUTED_ROOMS_KEY]).toEqual(['r1'])
  })

  it('degrades to [] on missing/corrupt/non-array prefs', () => {
    expect(getMutedRoomIds(null)).toEqual([])
    expect(getMutedRoomIds('not-json')).toEqual([])
    expect(getMutedRoomIds(JSON.stringify({ [MUTED_ROOMS_KEY]: 'r1' }))).toEqual([])
    expect(parsePreferences('[1,2]')).toEqual({})
  })

  it('dedupes and caps at MAX_MUTED_ROOMS', () => {
    let prefs = JSON.stringify({ [MUTED_ROOMS_KEY]: ['r1', 'r1', 42, null] })
    expect(getMutedRoomIds(prefs)).toEqual(['r1'])
    for (let i = 0; i < MAX_MUTED_ROOMS + 10; i++) prefs = setRoomMuted(prefs, `r${i}`, true)
    expect(getMutedRoomIds(prefs)).toHaveLength(MAX_MUTED_ROOMS)
  })
})

// ---- serialize pins + replyCount ----

describe('serialize: pins + replyCount ride the wire', () => {
  const base: any = {
    id: 'm1',
    roomId: 'r1',
    senderId: 'u1',
    content: 'hello',
    fileUrl: null,
    fileName: null,
    fileType: null,
    fileSize: null,
    createdAt: new Date('2026-09-10T10:00:00Z'),
    updatedAt: new Date('2026-09-10T10:00:00Z'),
    isDeleted: false,
    deletedAt: null,
    isForwarded: false,
    replyTo: null,
    sender: { id: 'u1', name: 'Asha' },
    reactions: [],
  }

  it('defaults isPinned=false and replyCount=0 without _count', () => {
    const out = serializeRoomMessage(base) as any
    expect(out.isPinned).toBe(false)
    expect(out.pinnedAt).toBeNull()
    expect(out.pinnedBy).toBeNull()
    expect(out.replyCount).toBe(0)
  })

  it('carries pin fields and _count.replies', () => {
    const out = serializeRoomMessage({
      ...base,
      isPinned: true,
      pinnedAt: new Date('2026-09-10T11:00:00Z'),
      pinnedBy: 'teacher1',
      _count: { replies: 4 },
    }) as any
    expect(out.isPinned).toBe(true)
    expect(out.pinnedBy).toBe('teacher1')
    expect(out.replyCount).toBe(4)
  })

  it('tombstones strip content but keep pin/reply metadata', () => {
    const out = serializeRoomMessage({ ...base, isDeleted: true, isPinned: true, _count: { replies: 2 } }) as any
    expect(out.content).toBeUndefined()
    expect(out.isPinned).toBe(true)
    expect(out.replyCount).toBe(2)
  })
})

// ---- source/migration contract ----

describe('threads-lite route + migration contract', () => {
  it('rooms router exposes pin/threads/search/mute endpoints', () => {
    const src = readSrc('src/routes/rooms.ts')
    expect(src).toContain('messages/:messageId/pin')
    expect(src).toContain("router.post('/:id/messages/:messageId/pin'")
    expect(src).toContain("router.delete('/:id/messages/:messageId/pin'")
    expect(src).toContain("router.get('/:id/pins'")
    expect(src).toContain("router.get('/:id/threads'")
    expect(src).toContain("router.get('/:id/messages/:messageId/thread'")
    expect(src).toContain("router.get('/:id/messages/search'")
    expect(src).toContain("router.get('/muted'")
    expect(src).toContain("router.put('/:id/mute'")
    expect(src).toContain('canPinInRoom')
    expect(src).toContain('Only teachers and CRs can pin')
    expect(src).toContain('MAX_PINNED_PER_ROOM')
    expect(src).toContain('emitRoomMessagePin')
  })

  it('unread counts are mute-aware (muted rooms report 0)', () => {
    const src = readSrc('src/routes/rooms.ts')
    expect(src).toContain('applyMuteToUnreadCounts')
    expect(src).toContain('getMutedRoomIds(prefsRow?.preferences)')
  })

  it('socket service fans out pin events on one channel', () => {
    const src = readSrc('src/services/socket.ts')
    expect(src).toContain('emitRoomMessagePin')
    expect(src).toContain("'room:message:pin'")
  })

  it('schema carries additive pin columns + index (no parentId — replyToId is the parent)', () => {
    const schema = readSrc('prisma/schema.prisma')
    expect(schema).toContain('isPinned')
    expect(schema).toContain('pinnedAt')
    expect(schema).toContain('pinnedBy')
    expect(schema).toContain('@@index([roomId, isPinned])')
    // No parentId COLUMN — replyToId is the thread parent (comments may mention it).
    expect(schema).not.toMatch(/^\s*parentId\s/m)
  })

  it('pins migration is additive (IF NOT EXISTS, indexed)', () => {
    const dir = path.join(BACKEND_ROOT, 'prisma/migrations/20260914000000_room_message_pins')
    expect(fs.existsSync(path.join(dir, 'migration.sql'))).toBe(true)
    const sql = fs.readFileSync(path.join(dir, 'migration.sql'), 'utf8')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "isPinned"')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "pinnedAt"')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "pinnedBy"')
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "RoomMessage_roomId_isPinned_idx"')
  })
})
