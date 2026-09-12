/**
 * Codeforces live browser — plan §2 (official problemset.problems API).
 *
 * Hermetic: no DB/network — fetchFn/now/store/cacheBackend injected.
 * RED first: these imports fail until the service implements CF support.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  CODEFORCES_API_URL,
  CODEFORCES_CACHE_KEY,
  CODEFORCES_LAST_FETCH_KEY,
  CODEFORCES_FETCH_TIMEOUT_MS,
  CODEFORCES_LIST_TTL_MS,
  CODEFORCES_MIN_INTERVAL_MS,
  CODEFORCES_SOURCE,
  buildCodeforcesUrl,
  buildCodeforcesParams,
  normalizeCodeforcesResponse,
  filterAndSortCfProblems,
  loadCodeforcesProblems,
} from '../src/services/codingProblems'
import { InMemoryCache } from '../src/lib/cache'
import { createInMemorySourceHealthStore } from '../src/services/fetch/health'

function cfPayload() {
  return {
    status: 'OK',
    result: {
      problems: [
        { contestId: 1730, index: 'A', name: 'Planar Reflections', rating: 800, tags: ['dp', 'math'] },
        { contestId: 1731, index: 'B', name: 'Kill Demodogs', rating: 1200, tags: ['math', 'greedy'] },
        { contestId: 1732, index: 'C1', name: 'Unrated Mystery', tags: ['brute force'] },
        { contestId: 0, index: '', name: '', rating: 800, tags: [] },
      ],
      problemStatistics: [
        { contestId: 1730, index: 'A', solvedCount: 25000 },
        { contestId: 1731, index: 'B', solvedCount: 12000 },
        { contestId: 1732, index: 'C1', solvedCount: 300 },
      ],
    },
  }
}

describe('codeforces constants (rate-safe contract)', () => {
  it('exposes official API URL + 12h TTL + 2s guard + SourceHealth key', () => {
    expect(CODEFORCES_API_URL).toBe('https://codeforces.com/api/problemset.problems')
    expect(CODEFORCES_LIST_TTL_MS).toBe(12 * 60 * 60 * 1000)
    expect(CODEFORCES_MIN_INTERVAL_MS).toBe(2000)
    expect(CODEFORCES_FETCH_TIMEOUT_MS).toBe(12_000)
    expect(CODEFORCES_SOURCE).toBe('CODEFORCES_PROBLEMS')
    expect(CODEFORCES_CACHE_KEY).toContain('codeforces')
    expect(CODEFORCES_LAST_FETCH_KEY).toContain('codeforces')
  })
})

describe('buildCodeforcesUrl (no-fake links)', () => {
  it('builds https://codeforces.com/problemset/problem/{id}/{index}', () => {
    expect(buildCodeforcesUrl(1730, 'A')).toBe('https://codeforces.com/problemset/problem/1730/A')
    expect(buildCodeforcesUrl(1731, 'C1')).toBe('https://codeforces.com/problemset/problem/1731/C1')
  })

  it('rejects bad contestId/index (never synthesize links)', () => {
    expect(buildCodeforcesUrl(0, 'A')).toBeNull()
    expect(buildCodeforcesUrl(-5, 'A')).toBeNull()
    expect(buildCodeforcesUrl(1730, '')).toBeNull()
    expect(buildCodeforcesUrl(1730, 'a')).toBeNull()
    expect(buildCodeforcesUrl(1730, 'A!')).toBeNull()
    expect(buildCodeforcesUrl(NaN as any, 'A')).toBeNull()
  })
})

describe('normalizeCodeforcesResponse (join + no-fake)', () => {
  it('joins solvedCount and keeps real links', () => {
    const { items, total } = normalizeCodeforcesResponse(cfPayload())
    expect(total).toBe(3)
    expect(items).toHaveLength(3)
    const a = items.find((p) => p.contestId === 1730)!
    expect(a.url).toBe('https://codeforces.com/problemset/problem/1730/A')
    expect(a.solvedCount).toBe(25000)
    expect(a.rating).toBe(800)
    expect(a.tags).toContain('dp')
  })

  it('keeps unrated rows with null rating (never invent)', () => {
    const { items } = normalizeCodeforcesResponse(cfPayload())
    const u = items.find((p) => p.contestId === 1732)!
    expect(u.rating).toBeNull()
    expect(u.solvedCount).toBe(300)
  })

  it('drops rows without contestId/index/name', () => {
    const { items } = normalizeCodeforcesResponse(cfPayload())
    expect(items.every((p) => p.contestId > 0 && p.name)).toBe(true)
  })

  it('returns empty on bad status or shape (never fake)', () => {
    expect(normalizeCodeforcesResponse({ status: 'FAILED' })).toEqual({ items: [], total: 0 })
    expect(normalizeCodeforcesResponse(null)).toEqual({ items: [], total: 0 })
    expect(normalizeCodeforcesResponse({})).toEqual({ items: [], total: 0 })
  })
})

describe('buildCodeforcesParams (sanitize)', () => {
  it('parses tags + rating band + sort + limit', () => {
    const p = buildCodeforcesParams({ tags: 'dp; Math', minRating: '800', maxRating: '1200', sort: 'rating', order: 'asc', limit: '10' })
    expect(p.tags).toEqual(['dp', 'math'])
    expect(p.minRating).toBe(800)
    expect(p.maxRating).toBe(1200)
    expect(p.sort).toBe('rating')
    expect(p.order).toBe('asc')
    expect(p.limit).toBe(10)
  })

  it('rejects bad rating band and clamps limit', () => {
    expect(() => buildCodeforcesParams({ minRating: '9999' })).toThrow()
    expect(() => buildCodeforcesParams({ minRating: '1200', maxRating: '800' })).toThrow()
    expect(buildCodeforcesParams({ limit: '9999' }).limit).toBe(200)
    expect(buildCodeforcesParams({}).limit).toBe(50)
  })

  it('rejects bad sort and too many tags', () => {
    expect(() => buildCodeforcesParams({ sort: 'nope' as any })).toThrow()
    expect(() => buildCodeforcesParams({ tags: 'a;b;c;d;e;f' })).toThrow()
  })
})

describe('filterAndSortCfProblems (pure)', () => {
  it('filters by ALL tags (AND)', () => {
    const { items } = normalizeCodeforcesResponse(cfPayload())
    const out = filterAndSortCfProblems(items, { tags: ['dp', 'math'], minRating: null, maxRating: null, sort: null, order: 'desc', limit: 50, skip: 0 })
    expect(out.total).toBe(1)
    expect(out.items[0].contestId).toBe(1730)
  })

  it('filters by rating band and drops unrated when band active', () => {
    const { items } = normalizeCodeforcesResponse(cfPayload())
    const out = filterAndSortCfProblems(items, { tags: [], minRating: 1000, maxRating: 1300, sort: null, order: 'desc', limit: 50, skip: 0 })
    expect(out.items.map((p) => p.contestId)).toEqual([1731])
  })

  it('sorts by rating and solvedCount with nulls last', () => {
    const { items } = normalizeCodeforcesResponse(cfPayload())
    const byRating = filterAndSortCfProblems(items, { tags: [], minRating: null, maxRating: null, sort: 'rating', order: 'asc', limit: 50, skip: 0 })
    expect(byRating.items.map((p) => p.contestId)).toEqual([1730, 1731, 1732])
    const bySolved = filterAndSortCfProblems(items, { tags: [], minRating: null, maxRating: null, sort: 'solvedCount', order: 'desc', limit: 50, skip: 0 })
    expect(bySolved.items.map((p) => p.contestId)).toEqual([1730, 1731, 1732])
  })

  it('paginates with limit/skip', () => {
    const { items } = normalizeCodeforcesResponse(cfPayload())
    const out = filterAndSortCfProblems(items, { tags: [], minRating: null, maxRating: null, sort: 'solvedCount', order: 'desc', limit: 1, skip: 1 })
    expect(out.total).toBe(3)
    expect(out.items).toHaveLength(1)
    expect(out.items[0].contestId).toBe(1731)
  })
})

describe('loadCodeforcesProblems (12h cache, 2s guard, SourceHealth)', () => {
  function okFetch(json: unknown) {
    return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => json })
  }

  it('fetches upstream on cold cache, caches 12h, records SourceHealth OK', async () => {
    const backend = new InMemoryCache()
    const store = createInMemorySourceHealthStore()
    const fetchFn = okFetch(cfPayload()) as any
    const params = buildCodeforcesParams({})
    const r = await loadCodeforcesProblems(params, { fetchFn, cacheBackend: backend, store, now: () => 1_000_000 })
    expect(r.items.length).toBeGreaterThan(0)
    expect(r.stale).toBe(false)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const h = await store.get('CODEFORCES_PROBLEMS')
    expect(h.totalRuns).toBe(1)
    expect(h.status).toBe('OK')
  })

  it('serves fresh cache without a second upstream call', async () => {
    const backend = new InMemoryCache()
    const store = createInMemorySourceHealthStore()
    const fetchFn = okFetch(cfPayload()) as any
    const params = buildCodeforcesParams({})
    await loadCodeforcesProblems(params, { fetchFn, cacheBackend: backend, store, now: () => 5_000_000 })
    const r2 = await loadCodeforcesProblems(params, { fetchFn, cacheBackend: backend, store, now: () => 5_060_000 })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(r2.stale).toBe(false)
  })

  it('serves STALE cache on upstream failure with stale:true', async () => {
    const backend = new InMemoryCache()
    const store = createInMemorySourceHealthStore()
    await loadCodeforcesProblems(buildCodeforcesParams({}), { fetchFn: okFetch(cfPayload()) as any, cacheBackend: backend, store, now: () => 10_000 })
    const bad = vi.fn().mockRejectedValue(new Error('network down')) as any
    const r = await loadCodeforcesProblems(buildCodeforcesParams({}), { fetchFn: bad, cacheBackend: backend, store, now: () => 10_000 + CODEFORCES_LIST_TTL_MS + 10_000 })
    expect(r.items.length).toBeGreaterThan(0)
    expect(r.stale).toBe(true)
  })

  it('returns honest error when cold cache meets failure (never fake)', async () => {
    const backend = new InMemoryCache()
    const store = createInMemorySourceHealthStore()
    const bad = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => null }) as any
    const r = await loadCodeforcesProblems(buildCodeforcesParams({}), { fetchFn: bad, cacheBackend: backend, store, now: () => 99_000 })
    expect(r.items).toHaveLength(0)
    expect(r.error).toMatch(/unavailable/i)
  })

  it('enforces 1req/2s guard (throttled cold call returns rate-limited)', async () => {
    const backend = new InMemoryCache()
    const store = createInMemorySourceHealthStore()
    // Prime the guard timestamp without a cached catalog: simulate a fetch
    // 500ms ago by pre-setting the last-fetch key, then a cold call must
    // throttle instead of hitting upstream.
    await backend.set(CODEFORCES_LAST_FETCH_KEY, 10_000, CODEFORCES_LIST_TTL_MS)
    const fetchFn = okFetch(cfPayload()) as any
    const r = await loadCodeforcesProblems(buildCodeforcesParams({}), { fetchFn, cacheBackend: backend, store, now: () => 10_500 })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(r.items).toHaveLength(0)
    expect(r.rateLimited).toBe(true)
  })
})
