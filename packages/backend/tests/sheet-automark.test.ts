/**
 * Sheets auto-mark — CF full-history + LC recent-20 solved feeds.
 *
 * Hermetic: pure join mapping is fully hermetic; loaders use injected
 * fetchFn/cacheBackend/now (no network, no DB, no gate waits — gate is
 * bypassed via fetchFn injection that asserts the URL, since the 2s gate
 * itself is locked in codeforcesGate tests).
 * Run: npm run test -w @campusflow/backend
 */
import { describe, it, expect, vi } from 'vitest'
import {
  AUTOMARK_CF_COUNT,
  AUTOMARK_CF_TTL_MS,
  AUTOMARK_LC_LIMIT,
  AUTOMARK_LC_TTL_MS,
  extractCfSolvedKeys,
  extractLcRecentSolved,
  loadAutomarkForHandles,
  loadCfSolvedKeys,
  loadLcRecentSolved,
  parseLcTimestampMs,
  sanitizeAutomarkHandle,
} from '../src/services/sheetAutomark'
import type { CacheBackend } from '../src/lib/cache'

function memCache(): CacheBackend & { store: Map<string, { v: unknown; exp: number }> } {
  const store = new Map<string, { v: unknown; exp: number }>()
  return {
    store,
    async get<T>(k: string) {
      const e = store.get(k)
      if (!e) return null
      if (Date.now() > e.exp) { store.delete(k); return null }
      return e.v as T
    },
    async set(k: string, v: unknown, ttlMs?: number) {
      store.set(k, { v, exp: Date.now() + (ttlMs ?? 60_000) })
    },
    async del(k: string) { store.delete(k) },
    async incr(k: string) { return 1 },
  }
}

describe('sanitizeAutomarkHandle', () => {
  it('accepts CF/LC handle shapes, rejects garbage (never fetch)', () => {
    expect(sanitizeAutomarkHandle('tourist')).toBe('tourist')
    expect(sanitizeAutomarkHandle('  lee215 ')).toBe('lee215')
    expect(sanitizeAutomarkHandle('')).toBeNull()
    expect(sanitizeAutomarkHandle(null)).toBeNull()
    expect(sanitizeAutomarkHandle('a'.repeat(51))).toBeNull()
    expect(sanitizeAutomarkHandle('evil handle')).toBeNull()
    expect(sanitizeAutomarkHandle('<script>')).toBeNull()
  })
})

describe('extractCfSolvedKeys (contestId-index join)', () => {
  it('maps OK verdicts to contestId-index keys (probe §1 shape)', () => {
    const rows = [
      { verdict: 'OK', problem: { contestId: 484, index: 'E' } },
      { verdict: 'WRONG_ANSWER', problem: { contestId: 484, index: 'E' } },
      { verdict: 'OK', problem: { contestId: 4, index: 'A' } },
      { verdict: 'OK', problem: { contestId: 4, index: 'A' } }, // dupe
    ]
    expect(extractCfSolvedKeys(rows)).toEqual(['4-A', '484-E'])
  })

  it('drops non-OK, malformed, gym-ish and judging rows (never invents)', () => {
    const rows = [
      { verdict: 'OK', problem: { contestId: 4, index: 'A' } },
      { verdict: 'TIME_LIMIT_EXCEEDED', problem: { contestId: 5, index: 'A' } },
      { verdict: 'OK', problem: { contestId: -1, index: 'A' } },
      { verdict: 'OK', problem: { contestId: 6, index: 'a' } }, // lowercase
      { verdict: 'OK', problem: { contestId: 7, index: 'AA' } }, // too long
      { verdict: 'OK', problem: null },
      { problem: { contestId: 8, index: 'A' } }, // judging (no verdict)
      { verdict: 'OK' },
    ]
    expect(extractCfSolvedKeys(rows)).toEqual(['4-A'])
  })

  it('returns [] on null/empty (never throws)', () => {
    expect(extractCfSolvedKeys(null)).toEqual([])
    expect(extractCfSolvedKeys([])).toEqual([])
  })
})

describe('extractLcRecentSolved (recent-20, Accepted only)', () => {
  it('maps Accepted rows to slugs, latest solve wins, newest-first', () => {
    const rows = [
      { titleSlug: 'two-sum', statusDisplay: 'Accepted', timestamp: '1788668124' },
      { titleSlug: 'two-sum', statusDisplay: 'Accepted', timestamp: '1788669000' },
      { titleSlug: '3sum', statusDisplay: 'Wrong Answer', timestamp: '1788668000' },
      { titleSlug: '3sum', statusDisplay: 'Accepted', timestamp: '1788000000' },
    ]
    const out = extractLcRecentSolved(rows)
    expect(out.map((e) => e.slug)).toEqual(['two-sum', '3sum'])
    expect(out[0].solvedAtMs).toBe(1788669000 * 1000)
  })

  it('drops non-Accepted, bad slugs and bad timestamps (never invents)', () => {
    const rows = [
      { titleSlug: 'two-sum', statusDisplay: 'Compile Error', timestamp: '1788668124' },
      { titleSlug: 'Bad Slug!', statusDisplay: 'Accepted', timestamp: '1788668124' },
      { titleSlug: 'two-sum', statusDisplay: 'Accepted', timestamp: 'garbage' },
      { titleSlug: 'two-sum', statusDisplay: 'accepted', timestamp: '1788668124' }, // casing
    ]
    expect(extractLcRecentSolved(rows)).toEqual([])
  })

  it('parseLcTimestampMs coerces string seconds (probe §2) + ms', () => {
    expect(parseLcTimestampMs('1788668124')).toBe(1788668124 * 1000)
    expect(parseLcTimestampMs(1788668124)).toBe(1788668124 * 1000)
    expect(parseLcTimestampMs(1788668124000)).toBe(1788668124000)
    expect(parseLcTimestampMs('garbage')).toBeNull()
    expect(parseLcTimestampMs(null)).toBeNull()
    expect(parseLcTimestampMs(-5)).toBeNull()
  })
})

describe('loadCfSolvedKeys (gate + 10min cache + honest empty)', () => {
  it('fetches user.status once, caches 10min (2nd call = no fetch)', async () => {
    const c = memCache()
    let calls = 0
    const fetchFn = (async (_url: string) => {
      calls++
      expect(String(_url)).toContain('user.status?handle=tourist')
      expect(String(_url)).toContain(`count=${AUTOMARK_CF_COUNT}`)
      return {
        ok: true, status: 200, headers: new Headers(),
        json: async () => ({ status: 'OK', result: [{ verdict: 'OK', problem: { contestId: 4, index: 'A' } }] }),
      }
    }) as unknown as typeof fetch
    // Bypass the 2s gate for hermetic tests: inject a fetchFn that goes
    // through fetchCodeforcesJson's acquire() — that still waits 2s on first
    // call? No: gate starts in the past (-2s) so the first acquire is free.
    // Reset between tests via fresh module state is unnecessary (first call).
    const r1 = await loadCfSolvedKeys('tourist', { fetchFn, cacheBackend: c, now: () => 1_000_000 })
    expect(r1.solvedKeys).toEqual(['4-A'])
    expect(r1.stale).toBe(false)
    const r2 = await loadCfSolvedKeys('tourist', { fetchFn, cacheBackend: c, now: () => 1_000_000 + AUTOMARK_CF_TTL_MS - 1000 })
    expect(r2.solvedKeys).toEqual(['4-A'])
    expect(calls).toBe(1)
  })

  it('unknown handle (400 FAILED) yields empty solved, not a throw', async () => {
    const c = memCache()
    const fetchFn = (async () => ({
      ok: false, status: 400, headers: new Headers(),
      json: async () => ({ status: 'FAILED', comment: 'handle: User with handle ghost_xyz_404 not found' }),
    })) as unknown as typeof fetch
    // fetchCodeforcesJson treats non-OK HTTP as {ok:false} → our loader maps
    // 400 → empty. Note: fetchFn above returns ok:false so cfFetch returns
    // {ok:false} → loader throws → caught → but 400 path needs status 400 via
    // fetchCodeforcesJson result.status. Our stub returns status 400 through
    // the gated fetch (fetchCodeforcesJson passes status through).
    const r = await loadCfSolvedKeys('ghost_xyz_404', { fetchFn, cacheBackend: c, now: () => 2_000_000 })
    expect(r.solvedKeys).toEqual([])
    expect(r.handle).toBe('ghost_xyz_404')
  })

  it('upstream failure serves stale cache (stale:true), else honest empty', async () => {
    const c = memCache()
    await c.set('coding-problems:automark:cf:tourist:v1', { solvedKeys: ['4-A'], cachedAt: new Date(3_000_000).toISOString() }, AUTOMARK_CF_TTL_MS)
    const fail = (async () => { throw new Error('boom') }) as unknown as typeof fetch
    const stale = await loadCfSolvedKeys('tourist', { fetchFn: fail, cacheBackend: c, now: () => 3_000_000 + AUTOMARK_CF_TTL_MS + 1000 })
    expect(stale.solvedKeys).toEqual(['4-A'])
    expect(stale.stale).toBe(true)
    const empty = await loadCfSolvedKeys('nobody-cached', { fetchFn: fail, cacheBackend: memCache(), now: () => 4_000_000 })
    expect(empty.solvedKeys).toEqual([])
    expect(empty.error).toMatch(/unavailable/)
  })

  it('rejects bad handles without fetching', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch
    const r = await loadCfSolvedKeys('evil handle', { fetchFn, cacheBackend: memCache() })
    expect(r.handle).toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('loadLcRecentSolved (recent-20, 10min cache, ambiguous [] honest)', () => {
  it('posts recentSubmissionList(limit 20) with Referer+UA, caches 10min', async () => {
    const c = memCache()
    let calls = 0
    let seenBody = ''
    const fetchFn = (async (_url: string, init: any) => {
      calls++
      seenBody = String(init?.body || '')
      return {
        ok: true, status: 200,
        json: async () => ({ data: { recentSubmissionList: [{ title: 'Two Sum', titleSlug: 'two-sum', timestamp: '1788668124', statusDisplay: 'Accepted', lang: 'java' }] } }),
      }
    }) as unknown as typeof fetch
    const r1 = await loadLcRecentSolved('lee215', { fetchFn, cacheBackend: c, now: () => 5_000_000 })
    expect(r1.solved.map((e) => e.slug)).toEqual(['two-sum'])
    expect(r1.note).toMatch(/Recent 20/)
    expect(seenBody).toContain('recentSubmissionList')
    expect(seenBody).toContain('"limit":20')
    expect(AUTOMARK_LC_LIMIT).toBe(20)
    const r2 = await loadLcRecentSolved('lee215', { fetchFn, cacheBackend: c, now: () => 5_000_000 + AUTOMARK_LC_TTL_MS - 1000 })
    expect(calls).toBe(1)
    expect(r2.solved.map((e) => e.slug)).toEqual(['two-sum'])
  })

  it('empty list is "no recent data" (not unsolved), null user same', async () => {
    const ok = (payload: unknown) => (async () => ({ ok: true, status: 200, json: async () => payload })) as unknown as typeof fetch
    const r1 = await loadLcRecentSolved('torvalds', { fetchFn: ok({ data: { recentSubmissionList: [] } }), cacheBackend: memCache(), now: () => 6_000_000 })
    expect(r1.solved).toEqual([])
    expect(r1.error).toBeUndefined()
    const r2 = await loadLcRecentSolved('ghost', { fetchFn: ok({ data: { matchedUser: null } }), cacheBackend: memCache(), now: () => 6_000_001 })
    expect(r2.solved).toEqual([])
  })

  it('bot-403 serves stale, else honest error (never throws)', async () => {
    const c = memCache()
    await c.set('coding-problems:automark:lc:lee215:v1', { solved: [{ slug: 'two-sum', solvedAtMs: 1 }], cachedAt: new Date(7_000_000).toISOString() }, AUTOMARK_LC_TTL_MS)
    const denied = (async () => ({ ok: false, status: 403, json: async () => null })) as unknown as typeof fetch
    const stale = await loadLcRecentSolved('lee215', { fetchFn: denied, cacheBackend: c, now: () => 7_000_000 + AUTOMARK_LC_TTL_MS + 1000 })
    expect(stale.solved).toEqual([{ slug: 'two-sum', solvedAtMs: 1 }])
    expect(stale.stale).toBe(true)
    const empty = await loadLcRecentSolved('fresh', { fetchFn: denied, cacheBackend: memCache(), now: () => 8_000_000 })
    expect(empty.solved).toEqual([])
    expect(empty.error).toMatch(/unavailable/)
  })
})

describe('loadAutomarkForHandles (parallel, best-effort, never throws)', () => {
  it('missing handles yield empty without fetching', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch
    const snap = await loadAutomarkForHandles({}, { fetchFn, cacheBackend: memCache() })
    expect(snap.cf.solvedKeys).toEqual([])
    expect(snap.lc.solved).toEqual([])
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('one platform failing never fails the other', async () => {
    const c = memCache()
    const fetchFn = (async (url: string) => {
      if (String(url).includes('codeforces')) throw new Error('cf down')
      return { ok: true, status: 200, json: async () => ({ data: { recentSubmissionList: [] } }) }
    }) as unknown as typeof fetch
    const snap = await loadAutomarkForHandles({ cfHandle: 'tourist', lcHandle: 'lee215' }, { fetchFn, cacheBackend: c, now: () => 9_000_000 })
    expect(snap.cf.solvedKeys).toEqual([])
    expect(snap.lc.solved).toEqual([])
  })
})
