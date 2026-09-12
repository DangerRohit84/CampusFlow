/**
 * Coding problems MVP — curated pool integrity, link shape, normalization
 * no-fake guards, cache TTLs, param clamping, stale fallback.
 *
 * Hermetic: no DB/network — fetchFn/now/store/cacheBackend injected.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  CURATED_PROBLEMS,
  CODING_PROBLEMS_DAILY_TTL_MS,
  CODING_PROBLEMS_LIST_TTL_MS,
  CODING_PROBLEMS_FETCH_TIMEOUT_MS,
  buildProblemUrl,
  isValidSlug,
  normalizeDifficulty,
  normalizeDailyResponse,
  normalizeProblemsetQuestions,
  buildProblemsetVariables,
  filterCuratedProblems,
  curatedTopics,
  listCacheKey,
  loadDailyProblem,
  loadLiveProblemList,
  type CuratedProblem,
} from '../src/services/codingProblems'
import { InMemoryCache } from '../src/lib/cache'
import { createInMemorySourceHealthStore } from '../src/services/fetch/health'

function dailyPayload(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      activeDailyCodingChallengeQuestion: {
        date: '2026-09-11',
        link: '/problems/two-sum/',
        question: {
          title: 'Two Sum',
          titleSlug: 'two-sum',
          difficulty: 'Easy',
          questionFrontendId: '1',
          paidOnly: false,
          ...overrides,
        },
      },
    },
  }
}

describe('curated pool integrity (~30 hand-verified slugs)', () => {
  it('has ~30 rows with unique valid slugs + titles + topics', () => {
    expect(CURATED_PROBLEMS.length).toBeGreaterThanOrEqual(28)
    expect(CURATED_PROBLEMS.length).toBeLessThanOrEqual(36)
    const slugs = new Set<string>()
    for (const p of CURATED_PROBLEMS as ReadonlyArray<CuratedProblem>) {
      expect(p.title.trim().length).toBeGreaterThan(0)
      expect(isValidSlug(p.titleSlug)).toBe(true)
      expect(slugs.has(p.titleSlug)).toBe(false)
      slugs.add(p.titleSlug)
      expect(['Easy', 'Medium', 'Hard']).toContain(p.difficulty)
      expect(Array.isArray(p.topics) && p.topics.length).toBeGreaterThan(0)
    }
  })

  it('spans all three difficulties (rec heuristic needs one pick per band)', () => {
    const bands = new Set(CURATED_PROBLEMS.map((p) => p.difficulty))
    expect(bands).toEqual(new Set(['Easy', 'Medium', 'Hard']))
  })

  it('every row builds a real titleSlug link (no fake URLs)', () => {
    for (const p of CURATED_PROBLEMS) {
      expect(buildProblemUrl(p.titleSlug)).toBe(`https://leetcode.com/problems/${p.titleSlug}/`)
    }
  })
})

describe('link shape + slug guard', () => {
  it('builds https://leetcode.com/problems/<slug>/ links only', () => {
    expect(buildProblemUrl('two-sum')).toBe('https://leetcode.com/problems/two-sum/')
    expect(buildProblemUrl('3sum')).toBe('https://leetcode.com/problems/3sum/')
  })

  it('rejects non-slug input (never synthesize links)', () => {
    expect(buildProblemUrl('')).toBeNull()
    expect(buildProblemUrl('Two Sum')).toBeNull()
    expect(buildProblemUrl('two_sum')).toBeNull()
    expect(buildProblemUrl('https://evil.com/x')).toBeNull()
    expect(buildProblemUrl('../escape')).toBeNull()
  })
})

describe('normalizeDailyResponse (no-fake)', () => {
  it('maps the daily payload with link + difficulty + date', () => {
    const n = normalizeDailyResponse(dailyPayload())
    expect(n).not.toBeNull()
    expect(n!.titleSlug).toBe('two-sum')
    expect(n!.url).toBe('https://leetcode.com/problems/two-sum/')
    expect(n!.difficulty).toBe('Easy')
    expect(n!.date).toBe('2026-09-11')
    expect(n!.questionId).toBe('1')
    expect(n!.paidOnly).toBe(false)
  })

  it('drops rows without a valid titleSlug (never synthesize)', () => {
    expect(normalizeDailyResponse(dailyPayload({ titleSlug: '' }))).toBeNull()
    expect(normalizeDailyResponse(dailyPayload({ titleSlug: undefined }))).toBeNull()
    expect(normalizeDailyResponse(dailyPayload({ titleSlug: 'Not A Slug!' }))).toBeNull()
    expect(normalizeDailyResponse({ data: { activeDailyCodingChallengeQuestion: null } })).toBeNull()
    expect(normalizeDailyResponse({})).toBeNull()
  })

  it('badges paidOnly without hiding the row', () => {
    const n = normalizeDailyResponse(dailyPayload({ paidOnly: true }))
    expect(n!.paidOnly).toBe(true)
    expect(n!.url).toBe('https://leetcode.com/problems/two-sum/')
  })
})

describe('normalizeProblemsetQuestions (no-fake)', () => {
  const live = {
    data: {
      problemsetQuestionList: {
        total: 2,
        questions: [
          { title: 'Two Sum', titleSlug: 'two-sum', difficulty: 'Easy', topicTags: [{ name: 'Array', slug: 'array' }], paidOnly: false },
          { title: 'Ghost', titleSlug: '', difficulty: 'Easy', topicTags: [], paidOnly: false },
        ],
      },
    },
  }

  it('drops slugless rows, keeps real links + topics + paidOnly', () => {
    const { items, total } = normalizeProblemsetQuestions(live)
    expect(total).toBe(2)
    expect(items).toHaveLength(1)
    expect(items[0].titleSlug).toBe('two-sum')
    expect(items[0].url).toBe('https://leetcode.com/problems/two-sum/')
    expect(items[0].topics).toContain('array')
    expect(items[0].paidOnly).toBe(false)
  })

  it('drops rows with unknown difficulty (never invent badges)', () => {
    const { items } = normalizeProblemsetQuestions({
      data: { problemsetQuestionList: { total: 1, questions: [{ title: 'X', titleSlug: 'x-y', difficulty: 'Unknown', topicTags: [] }] } },
    })
    expect(items).toHaveLength(0)
  })

  it('accepts totalNum-shaped payloads (upstream names the count totalNum)', () => {
    const { total } = normalizeProblemsetQuestions({
      data: { problemsetQuestionList: { total: 0, questions: [] } },
    })
    expect(total).toBe(0)
  })
})

describe('difficulty + params', () => {
  it('normalizes difficulty case-insensitively', () => {
    expect(normalizeDifficulty('easy')).toBe('Easy')
    expect(normalizeDifficulty('MEDIUM')).toBe('Medium')
    expect(normalizeDifficulty(' Hard ')).toBe('Hard')
    expect(normalizeDifficulty('unknown')).toBeNull()
    expect(normalizeDifficulty(null)).toBeNull()
  })

  it('clamps limit/skip and maps difficulty to gql enum', () => {
    expect(buildProblemsetVariables({ limit: '500', skip: '-5', difficulty: 'hard' })).toMatchObject({ limit: 100, skip: 0, gqlDifficulty: 'HARD', difficulty: 'Hard' })
    expect(buildProblemsetVariables({})).toMatchObject({ limit: 30, skip: 0, gqlDifficulty: null })
    expect(buildProblemsetVariables({ topic: 'Array ' })).toMatchObject({ topic: 'array' })
    expect(buildProblemsetVariables({ topic: 'bad topic!' })).toMatchObject({ topic: null })
  })
})

describe('cache TTLs (rate-safe contract)', () => {
  it('daily caches 20h, list caches 24h, 12s upstream timeout', () => {
    expect(CODING_PROBLEMS_DAILY_TTL_MS).toBe(20 * 60 * 60 * 1000)
    expect(CODING_PROBLEMS_LIST_TTL_MS).toBe(24 * 60 * 60 * 1000)
    expect(CODING_PROBLEMS_FETCH_TIMEOUT_MS).toBe(12_000)
  })

  it('list cache keys differ per param tuple', () => {
    const a = listCacheKey({ limit: 30, skip: 0, topic: null, difficulty: null, search: null })
    const b = listCacheKey({ limit: 30, skip: 0, topic: 'array', difficulty: null, search: null })
    expect(a).not.toBe(b)
    expect(a).toContain('coding-problems:list:live:')
  })
})

describe('filterCuratedProblems + curatedTopics', () => {
  it('filters by difficulty/topic/search without upstream', () => {
    expect(filterCuratedProblems(CURATED_PROBLEMS, { difficulty: 'Easy' }).every((p) => p.difficulty === 'Easy')).toBe(true)
    const arr = filterCuratedProblems(CURATED_PROBLEMS, { topic: 'array' })
    expect(arr.length).toBeGreaterThan(0)
    expect(arr.every((p) => p.topics.includes('array'))).toBe(true)
    expect(filterCuratedProblems(CURATED_PROBLEMS, { search: 'two sum' }).map((p) => p.titleSlug)).toContain('two-sum')
    expect(filterCuratedProblems(CURATED_PROBLEMS, { search: 'zzz-no-match' })).toHaveLength(0)
  })

  it('exposes sorted unique topics for the filter dropdown', () => {
    const topics = curatedTopics()
    expect(topics).toContain('array')
    expect(topics).toEqual([...topics].sort())
  })
})

describe('loadDailyProblem (stale-served, SourceHealth)', () => {
  function okFetch(json: unknown) {
    return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => json })
  }

  it('fetches upstream on cold cache, caches 20h, records SourceHealth OK', async () => {
    const backend = new InMemoryCache()
    const store = createInMemorySourceHealthStore()
    const fetchFn = okFetch(dailyPayload()) as any
    const r = await loadDailyProblem({ fetchFn, cacheBackend: backend, store, now: () => 1_000_000 })
    expect(r.problem?.titleSlug).toBe('two-sum')
    expect(r.stale).toBe(false)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const h = await store.get('LEETCODE_DAILY')
    expect(h.totalRuns).toBe(1)
    expect(h.status).toBe('OK')
  })

  it('serves fresh cache without a second upstream call (≤2 calls/page)', async () => {
    const backend = new InMemoryCache()
    const store = createInMemorySourceHealthStore()
    const fetchFn = okFetch(dailyPayload()) as any
    const now = { t: 5_000_000 }
    await loadDailyProblem({ fetchFn, cacheBackend: backend, store, now: () => now.t })
    now.t += 60_000 // 1 min later — still fresh
    const r2 = await loadDailyProblem({ fetchFn, cacheBackend: backend, store, now: () => now.t })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(r2.stale).toBe(false)
  })

  it('serves STALE cache on upstream failure with stale:true badge', async () => {
    const backend = new InMemoryCache()
    const store = createInMemorySourceHealthStore()
    await loadDailyProblem({ fetchFn: okFetch(dailyPayload()) as any, cacheBackend: backend, store, now: () => 10_000 })
    const bad = vi.fn().mockRejectedValue(new Error('network down')) as any
    const r = await loadDailyProblem({ fetchFn: bad, cacheBackend: backend, store, now: () => 10_000 + CODING_PROBLEMS_DAILY_TTL_MS + 1 })
    expect(r.problem?.titleSlug).toBe('two-sum')
    expect(r.stale).toBe(true)
    const h = await store.get('LEETCODE_DAILY')
    expect(h.consecutiveFails).toBe(1)
  })

  it('returns null + honest error when cold cache meets failure (never fake)', async () => {
    const backend = new InMemoryCache()
    const store = createInMemorySourceHealthStore()
    const bad = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => null }) as any
    const r = await loadDailyProblem({ fetchFn: bad, cacheBackend: backend, store, now: () => 99_000 })
    expect(r.problem).toBeNull()
    expect(r.error).toMatch(/unavailable/i)
  })
})

describe('loadLiveProblemList (param cache, stale fallback)', () => {
  const liveJson = {
    data: {
      problemsetQuestionList: {
        totalNum: 1,
        data: [{ title: 'Two Sum', titleSlug: 'two-sum', difficulty: 'Easy', topicTags: [{ slug: 'array', name: 'Array' }], paidOnly: false }],
      },
    },
  }

  it('fetches one upstream call and caches per params', async () => {
    const backend = new InMemoryCache()
    const store = createInMemorySourceHealthStore()
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => liveJson }) as any
    const vars = buildProblemsetVariables({ limit: 10, topic: 'array' })
    const r = await loadLiveProblemList(vars, { fetchFn, cacheBackend: backend, store, now: () => 7_000 })
    expect(r.items).toHaveLength(1)
    expect(r.items[0].url).toBe('https://leetcode.com/problems/two-sum/')
    const r2 = await loadLiveProblemList(vars, { fetchFn, cacheBackend: backend, store, now: () => 8_000 })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(r2.stale).toBe(false)
  })

  it('honest empty error when cold cache meets failure', async () => {
    const backend = new InMemoryCache()
    const store = createInMemorySourceHealthStore()
    const bad = vi.fn().mockRejectedValue(new Error('down')) as any
    const vars = buildProblemsetVariables({ limit: 10 })
    const r = await loadLiveProblemList(vars, { fetchFn: bad, cacheBackend: backend, store, now: () => 7_000 })
    expect(r.items).toHaveLength(0)
    expect(r.error).toMatch(/unavailable/i)
  })
})
