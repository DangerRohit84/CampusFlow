/**
 * List-unavailable regression (live probe 2026-09-11):
 * Root cause is GraphQL schema drift — V1 `problemsetQuestionList` was
 * removed (400 `Cannot query field "problemsetQuestionList" on type
 * "Query". Did you mean "problemsetQuestionListV2"?`). Same drift class as
 * the daily `paidOnly` → `isPaidOnly` fix; same pattern: migrate the query
 * to the V2 shape, keep the 24h cache + stale fallback + honest errors, keep
 * the API contract (LiveListResult) stable.
 *
 * V2 facts established by live probe (same headers/timeout as prod code):
 * - root `problemsetQuestionListV2(limit, skip, categorySlug, filters)`
 * - `filters: QuestionFilterInput` requires `filterCombineType: ALL`;
 *   topic via `topicFilter: {topicSlugs, operator: IS}`, difficulty via
 *   `difficultyFilter: {difficulties, operator: IS}`
 * - returns `totalLength` + `questions[]`; difficulty UPPERCASE (EASY…);
 *   node exposes `paidOnly` (NOT `isPaidOnly` — `isPaidOnly` on the V2 node
 *   400s with "Did you mean paidOnly?")
 * - top-level `searchKeyword` is auth-gated (unauthenticated → 200 with
 *   `errors: "Please Register or Sign in"`, `data: null`), so `search` is
 *   never sent upstream — post-filtered in-memory on the fetched page.
 *
 * Hermetic: fetchFn/now/store/cacheBackend injected, no network.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  CODING_PROBLEMS_LIST_STALE_TTL_MS,
  CODING_PROBLEMS_LIST_TTL_MS,
  PROBLEMSET_V2_QUERY,
  buildProblemsetV2Variables,
  buildProblemsetVariables,
  loadLiveProblemList,
  normalizeProblemsetQuestions,
} from '../src/services/codingProblems'
import { InMemoryCache } from '../src/lib/cache'
import { createInMemorySourceHealthStore } from '../src/services/fetch/health'

function v2Payload() {
  return {
    data: {
      problemsetQuestionListV2: {
        totalLength: 2,
        questions: [
          { title: 'Two Sum', titleSlug: 'two-sum', difficulty: 'EASY', topicTags: [{ name: 'Array', slug: 'array' }], paidOnly: false },
          { title: 'Add Two Numbers', titleSlug: 'add-two-numbers', difficulty: 'MEDIUM', topicTags: [{ name: 'Linked List', slug: 'linked-list' }], paidOnly: true },
        ],
      },
    },
  }
}

describe('list schema drift: problemsetQuestionListV2', () => {
  it('query targets V2 with totalLength + QuestionFilterInput (never V1 root)', () => {
    expect(PROBLEMSET_V2_QUERY).toContain('problemsetQuestionListV2')
    expect(PROBLEMSET_V2_QUERY).toContain('totalLength')
    expect(PROBLEMSET_V2_QUERY).toContain('QuestionFilterInput')
    expect(PROBLEMSET_V2_QUERY).not.toMatch(/problemsetQuestionList\(/)
    expect(PROBLEMSET_V2_QUERY).not.toContain('QuestionListFilterInput')
    expect(PROBLEMSET_V2_QUERY).toContain('paidOnly')
    expect(PROBLEMSET_V2_QUERY).not.toContain('isPaidOnly')
  })

  it('builds unauthenticated-safe V2 variables (topic + difficulty, never searchKeyword)', () => {
    const plain = buildProblemsetV2Variables(buildProblemsetVariables({ limit: 10 }))
    expect(plain).toMatchObject({ categorySlug: '', limit: 10, skip: 0 })
    expect(plain.filters).toEqual({ filterCombineType: 'ALL' })

    const topic = buildProblemsetV2Variables(buildProblemsetVariables({ topic: 'array' }))
    expect(topic.filters).toEqual({ filterCombineType: 'ALL', topicFilter: { topicSlugs: ['array'], operator: 'IS' } })

    const diff = buildProblemsetV2Variables(buildProblemsetVariables({ difficulty: 'medium' }))
    expect(diff.filters).toEqual({ filterCombineType: 'ALL', difficultyFilter: { difficulties: ['MEDIUM'], operator: 'IS' } })

    const both = buildProblemsetV2Variables(buildProblemsetVariables({ topic: 'array', difficulty: 'hard', limit: 5, skip: 10 }))
    expect(both).toMatchObject({ limit: 5, skip: 10 })
    expect(both.filters).toEqual({
      filterCombineType: 'ALL',
      topicFilter: { topicSlugs: ['array'], operator: 'IS' },
      difficultyFilter: { difficulties: ['HARD'], operator: 'IS' },
    })

    // search must never leak upstream (auth-gated → data:null wall)
    const withSearch = buildProblemsetV2Variables(buildProblemsetVariables({ search: 'two sum' }))
    expect(JSON.stringify(withSearch)).not.toMatch(/searchkeyword/i)
  })

  it('normalizes live V2 shape (totalLength + UPPERCASE difficulty + paidOnly)', () => {
    const { items, total } = normalizeProblemsetQuestions(v2Payload())
    expect(total).toBe(2)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      titleSlug: 'two-sum',
      difficulty: 'Easy',
      url: 'https://leetcode.com/problems/two-sum/',
      paidOnly: false,
    })
    expect(items[0].topics).toContain('array')
    expect(items[1].paidOnly).toBe(true)
  })

  it('keeps legacy V1 shapes working (old mocks: total/totalNum + questions/data)', () => {
    const v1 = normalizeProblemsetQuestions({
      data: { problemsetQuestionList: { total: 1, questions: [{ title: 'Two Sum', titleSlug: 'two-sum', difficulty: 'Easy', topicTags: [], paidOnly: false }] } },
    })
    expect(v1.total).toBe(1)
    expect(v1.items).toHaveLength(1)
    const v1num = normalizeProblemsetQuestions({
      data: { problemsetQuestionList: { totalNum: 1, data: [{ title: 'Two Sum', titleSlug: 'two-sum', difficulty: 'Easy', topicTags: [] }] } },
    })
    expect(v1num.total).toBe(1)
    expect(v1num.items).toHaveLength(1)
  })

  it('accepts isPaidOnly forward-compat while V2 sends paidOnly', () => {
    const { items } = normalizeProblemsetQuestions({
      data: { problemsetQuestionListV2: { totalLength: 1, questions: [{ title: 'X', titleSlug: 'x-y', difficulty: 'Hard', topicTags: [], isPaidOnly: true }] } },
    })
    expect(items).toHaveLength(1)
    expect(items[0].paidOnly).toBe(true)
  })

  it('still drops slugless / unknown-difficulty rows (no-fake)', () => {
    const { items, total } = normalizeProblemsetQuestions({
      data: {
        problemsetQuestionListV2: {
          totalLength: 3,
          questions: [
            { title: 'Ghost', titleSlug: '', difficulty: 'EASY', topicTags: [] },
            { title: 'Weird', titleSlug: 'weird-x', difficulty: 'Unknown', topicTags: [] },
            { title: 'Two Sum', titleSlug: 'two-sum', difficulty: 'EASY', topicTags: [] },
          ],
        },
      },
    })
    expect(total).toBe(3)
    expect(items).toHaveLength(1)
    expect(items[0].titleSlug).toBe('two-sum')
  })
})

describe('loadLiveProblemList over V2 (cache + search + honest errors)', () => {
  it('end-to-end: sends V2 body, warms cache, serves fresh without refetch', async () => {
    const backend = new InMemoryCache()
    const store = createInMemorySourceHealthStore()
    let sentBody = ''
    const fetchFn = vi.fn().mockImplementation(async (_url: string, init: any) => {
      sentBody = String(init?.body || '')
      return { ok: true, status: 200, json: async () => v2Payload() }
    }) as any
    const vars = buildProblemsetVariables({ limit: 10 })
    const r = await loadLiveProblemList(vars, { fetchFn, cacheBackend: backend, store, now: () => 7_000 })
    expect(r.items).toHaveLength(2)
    expect(r.items[0].url).toBe('https://leetcode.com/problems/two-sum/')
    expect(r.total).toBe(2)
    expect(r.stale).toBe(false)
    expect(sentBody).toContain('problemsetQuestionListV2')
    expect(sentBody).toContain('QuestionFilterInput')
    expect(sentBody).toContain('filterCombineType')
    expect(sentBody).not.toMatch(/problemsetQuestionList\(/)
    const r2 = await loadLiveProblemList(vars, { fetchFn, cacheBackend: backend, store, now: () => 8_000 })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(r2.stale).toBe(false)
    const h = await store.get('LEETCODE_PROBLEMSET')
    expect(h.totalRuns).toBe(1)
    expect(h.status).toBe('OK')
  })

  it('applies search in-memory on the fetched page (never upstream)', async () => {
    const backend = new InMemoryCache()
    const store = createInMemorySourceHealthStore()
    let sentBody = ''
    const fetchFn = vi.fn().mockImplementation(async (_url: string, init: any) => {
      sentBody = String(init?.body || '')
      return { ok: true, status: 200, json: async () => v2Payload() }
    }) as any
    const vars = buildProblemsetVariables({ limit: 10, search: 'two sum' })
    const r = await loadLiveProblemList(vars, { fetchFn, cacheBackend: backend, store, now: () => 7_000 })
    expect(sentBody).not.toMatch(/searchkeyword/i)
    expect(r.items).toHaveLength(1)
    expect(r.items[0].titleSlug).toBe('two-sum')
    expect(r.total).toBe(1)
    expect(r.stale).toBe(false)
  })

  it('cold 400 with GraphQL errors surfaces status + hint (never swallowed)', async () => {
    const backend = new InMemoryCache()
    const store = createInMemorySourceHealthStore()
    const gqlErr = { errors: [{ message: 'Cannot query field "problemsetQuestionList" on type "Query".' }] }
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => gqlErr }) as any
    const r = await loadLiveProblemList(buildProblemsetVariables({ limit: 10 }), { fetchFn, cacheBackend: backend, store, now: () => 7_000 })
    expect(r.items).toHaveLength(0)
    expect(r.error).toMatch(/unavailable/i)
    expect(r.error).toContain('400')
    expect(r.error).toMatch(/Cannot query field/)
  })

  it('200 with errors[] + data:null (auth-wall shape) is an honest error, never a fake empty page', async () => {
    const backend = new InMemoryCache()
    const store = createInMemorySourceHealthStore()
    const wall = { errors: [{ message: 'Please Register or Sign in' }], data: null }
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => wall }) as any
    const r = await loadLiveProblemList(buildProblemsetVariables({ limit: 10 }), { fetchFn, cacheBackend: backend, store, now: () => 7_000 })
    expect(r.items).toHaveLength(0)
    expect(r.error).toMatch(/unavailable/i)
    expect(r.error).toMatch(/Sign in/)
  })
})

describe('list stale retention (previous page instead of unavailable)', () => {
  it('physical TTL is 7d while freshness stays 24h', () => {
    expect(CODING_PROBLEMS_LIST_TTL_MS).toBe(24 * 60 * 60 * 1000)
    expect(CODING_PROBLEMS_LIST_STALE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('stores with stale TTL so the row outlives the freshness window', async () => {
    const backend = new InMemoryCache()
    const store = createInMemorySourceHealthStore()
    const seen: Array<{ key: string; ttl: number | undefined }> = []
    const spyBackend = {
      get: (k: string) => backend.get(k) as any,
      set: async (k: string, v: unknown, ttl?: number) => { seen.push({ key: k, ttl }); return backend.set(k, v, ttl) },
      del: (k: string) => backend.del(k),
      incr: (k: string, t?: number) => backend.incr(k, t),
    } as any
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => v2Payload() }) as any
    await loadLiveProblemList(buildProblemsetVariables({ limit: 10 }), { fetchFn, cacheBackend: spyBackend, store, now: () => 100_000 })
    expect(seen.length).toBe(1)
    expect(seen[0].ttl).toBe(CODING_PROBLEMS_LIST_STALE_TTL_MS)
  })

  it('serves the previous page as stale when revalidate blips past 24h', async () => {
    const backend = new InMemoryCache()
    const store = createInMemorySourceHealthStore()
    const ok = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => v2Payload() }) as any
    const vars = buildProblemsetVariables({ limit: 10 })
    const t0 = 20_000_000
    await loadLiveProblemList(vars, { fetchFn: ok, cacheBackend: backend, store, now: () => t0 })
    const bad = vi.fn().mockRejectedValue(new Error('upstream blip')) as any
    const r = await loadLiveProblemList(vars, {
      fetchFn: bad, cacheBackend: backend, store,
      now: () => t0 + CODING_PROBLEMS_LIST_TTL_MS + 60_000,
    })
    expect(r.items).toHaveLength(2)
    expect(r.stale).toBe(true)
  })
})
