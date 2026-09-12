/**
 * Daily-unavailable regression (live probe 2026-09-11):
 * Root cause was GraphQL schema drift — `paidOnly` on QuestionNode 400s
 * ("Did you mean isPaidOnly?"), cache never warmed, error swallowed the
 * status. Hermetic: fetchFn/now/store/cacheBackend injected, no network.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  CODING_PROBLEMS_DAILY_STALE_TTL_MS,
  CODING_PROBLEMS_DAILY_TTL_MS,
  DAILY_CHALLENGE_QUERY,
  loadDailyProblem,
  normalizeDailyResponse,
} from '../src/services/codingProblems'
import { InMemoryCache } from '../src/lib/cache'
import { createInMemorySourceHealthStore } from '../src/services/fetch/health'

function livePayload() {
  return {
    data: {
      activeDailyCodingChallengeQuestion: {
        date: '2026-09-11',
        link: '/problems/unique-3-digit-even-numbers/',
        question: {
          title: 'Unique 3-Digit Even Numbers',
          titleSlug: 'unique-3-digit-even-numbers',
          difficulty: 'Easy',
          questionFrontendId: '3483',
          isPaidOnly: false,
        },
      },
    },
  }
}

describe('daily schema drift: isPaidOnly', () => {
  it('query selects isPaidOnly (never bare paidOnly on QuestionNode)', () => {
    expect(DAILY_CHALLENGE_QUERY).toContain('isPaidOnly')
    expect(DAILY_CHALLENGE_QUERY).not.toMatch(/[{ ]paidOnly[ }]/)
  })

  it('normalizes live isPaidOnly payloads (false + true)', () => {
    const free = normalizeDailyResponse(livePayload())
    expect(free?.titleSlug).toBe('unique-3-digit-even-numbers')
    expect(free?.paidOnly).toBe(false)
    expect(free?.questionId).toBe('3483')
    const paid = normalizeDailyResponse({
      data: {
        activeDailyCodingChallengeQuestion: {
          date: '2026-09-11',
          question: {
            title: 'X', titleSlug: 'x-y', difficulty: 'Hard',
            questionFrontendId: '9', isPaidOnly: true,
          },
        },
      },
    })
    expect(paid?.paidOnly).toBe(true)
  })

  it('keeps legacy paidOnly working (old mocks / cached rows)', () => {
    const n = normalizeDailyResponse({
      data: {
        activeDailyCodingChallengeQuestion: {
          date: '2026-09-11',
          question: {
            title: 'Two Sum', titleSlug: 'two-sum', difficulty: 'Easy',
            questionFrontendId: '1', paidOnly: true,
          },
        },
      },
    })
    expect(n?.paidOnly).toBe(true)
  })

  it('end-to-end: live-shaped fetch warms cache (the 400-before path)', async () => {
    const backend = new InMemoryCache()
    const store = createInMemorySourceHealthStore()
    let sentBody = ''
    const fetchFn = vi.fn().mockImplementation(async (_url: string, init: any) => {
      sentBody = String(init?.body || '')
      return { ok: true, status: 200, json: async () => livePayload() }
    }) as any
    const r = await loadDailyProblem({ fetchFn, cacheBackend: backend, store, now: () => 1_000_000 })
    expect(r.problem?.titleSlug).toBe('unique-3-digit-even-numbers')
    expect(r.stale).toBe(false)
    expect(sentBody).toContain('isPaidOnly')
  })
})

describe('daily honest errors (no swallowing)', () => {
  it('cold 400 with GraphQL errors surfaces status + hint', async () => {
    const backend = new InMemoryCache()
    const store = createInMemorySourceHealthStore()
    const gqlErr = { errors: [{ message: 'Cannot query field "paidOnly" on type "QuestionNode".' }] }
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => gqlErr }) as any
    const r = await loadDailyProblem({ fetchFn, cacheBackend: backend, store, now: () => 5_000 })
    expect(r.problem).toBeNull()
    expect(r.error).toMatch(/unavailable/i)
    expect(r.error).toContain('400')
    expect(r.error).toMatch(/Cannot query field/)
  })

  it('cold network failure still says unavailable (never fake)', async () => {
    const backend = new InMemoryCache()
    const store = createInMemorySourceHealthStore()
    const fetchFn = vi.fn().mockRejectedValue(new Error('fetch failed')) as any
    const r = await loadDailyProblem({ fetchFn, cacheBackend: backend, store, now: () => 5_000 })
    expect(r.problem).toBeNull()
    expect(r.error).toMatch(/unavailable/i)
  })
})

describe('daily stale retention (yesterday instead of unavailable)', () => {
  it('physical TTL is 7d while freshness stays 20h', () => {
    expect(CODING_PROBLEMS_DAILY_TTL_MS).toBe(20 * 60 * 60 * 1000)
    expect(CODING_PROBLEMS_DAILY_STALE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000)
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
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => livePayload() }) as any
    await loadDailyProblem({ fetchFn, cacheBackend: spyBackend, store, now: () => 100_000 })
    expect(seen.length).toBe(1)
    expect(seen[0].ttl).toBe(CODING_PROBLEMS_DAILY_STALE_TTL_MS)
  })

  it('serves yesterday as stale when the next-day revalidate blips', async () => {
    const backend = new InMemoryCache()
    const store = createInMemorySourceHealthStore()
    const ok = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => livePayload() }) as any
    const t0 = 20_000_000
    await loadDailyProblem({ fetchFn: ok, cacheBackend: backend, store, now: () => t0 })
    const bad = vi.fn().mockRejectedValue(new Error('upstream blip')) as any
    const r = await loadDailyProblem({
      fetchFn: bad, cacheBackend: backend, store,
      now: () => t0 + CODING_PROBLEMS_DAILY_TTL_MS + 60_000,
    })
    expect(r.problem?.titleSlug).toBe('unique-3-digit-even-numbers')
    expect(r.stale).toBe(true)
  })
})
