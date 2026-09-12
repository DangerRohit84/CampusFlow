/**
 * Regression: Codeforces partial-fetch (danger_rohit84 live repro).
 *
 * Symptoms (1 platform linked):
 * - Contest History showed 35 rows, avg rank #13639 (user.rating OK).
 * - Stats EMPTY: 0 solves, — rating, 0/1 "with live data", banner
 *   "Handles saved — sync" despite fresh sync (cooldown + "Updated just now").
 * - Streak 0/0 + empty heatmap despite history (participatedAt null).
 *
 * Root causes (file:line):
 * - platformFetchers.ts:102 participatedAt:null dropped ratingUpdateTimeSeconds.
 * - CodingProfilePage.tsx:417 JSON.parse(Json array) threw → statsMap {}.
 * - platformStats.ts:192 only 404 (CF uses 400 FAILED) + unguarded sub.problem.
 *
 * Hermetic: codeforcesGate mocked, no network/DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetchJson = vi.fn()

vi.mock('../src/services/codeforcesGate', () => ({
  fetchCodeforcesJson: (...args: any[]) => mockFetchJson(...args),
  CODEFORCES_MIN_GAP_MS: 2000,
  CODEFORCES_MAX_RETRIES: 1,
  CODEFORCES_RETRY_JITTER_MS: 1000,
  CODEFORCES_RETRY_AFTER_CAP_MS: 10_000,
  acquireCodeforcesSlot: async () => {},
  isRateLimitedStatus: (s: number) => s === 429 || s === 503,
  isCallLimitExceededMessage: () => false,
  parseRetryAfterMs: () => null,
  parseRetryAfterFromComment: () => null,
  getCodeforcesRetryDelayMs: () => 0,
}))

import { fetchCodeforces } from '../src/services/platformFetchers'
import {
  fetchAllPlatformStats,
  __clearStatsCacheForTests,
  CF_STATS_TIMEOUT_MS,
} from '../src/services/platformStats'
import { FETCH_TIMEOUT_MS as FETCHERS_TIMEOUT_MS } from '../src/services/platformFetchers'

function ratingEntry(over: any = {}) {
  return {
    contestId: 1000,
    contestName: 'Codeforces Round #1000',
    rank: 13639,
    oldRating: 1100,
    newRating: 1200,
    ratingUpdateTimeSeconds: 1700000000,
    ...over,
  }
}

function infoOk(over: any = {}) {
  return {
    data: {
      status: 'OK',
      result: [
        { handle: 'danger_rohit84', rating: 1200, maxRating: 1350, rank: 'pupil', maxRank: 'specialist', ...over },
      ],
    },
    status: 200,
    headers: undefined,
    attempts: 1,
    retried: false,
    stillRateLimited: false,
  }
}

function statusOk(result: any[]) {
  return {
    data: { status: 'OK', result },
    status: 200,
    headers: undefined,
    attempts: 1,
    retried: false,
    stillRateLimited: false,
  }
}

function failed400(comment: string) {
  return {
    data: { status: 'FAILED', comment },
    status: 400,
    headers: undefined,
    attempts: 1,
    retried: false,
    stillRateLimited: false,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  __clearStatsCacheForTests()
})

describe('CF contest dates feed streak/heatmap (platformFetchers)', () => {
  it('maps ratingUpdateTimeSeconds → participatedAt Date', async () => {
    mockFetchJson.mockImplementation(async (url: string) => {
      if (url.includes('user.rating')) {
        return {
          data: { status: 'OK', result: [ratingEntry({ ratingUpdateTimeSeconds: 1700000000 }), ratingEntry({ contestId: 1001, contestName: 'Round #1001', ratingUpdateTimeSeconds: 1700600000 })] },
          status: 200,
          attempts: 1,
          retried: false,
          stillRateLimited: false,
        }
      }
      throw new Error('unexpected ' + url)
    })
    const rows = await fetchCodeforces('cf_dates_user')
    expect(rows).toHaveLength(2)
    expect(rows[0].participatedAt).toBeInstanceOf(Date)
    expect((rows[0].participatedAt as Date).getTime()).toBe(1700000000 * 1000)
    expect((rows[1].participatedAt as Date).getTime()).toBe(1700600000 * 1000)
  })

  it('nulls participatedAt when timestamp missing/invalid (contract preserved)', async () => {
    mockFetchJson.mockResolvedValue({
      data: { status: 'OK', result: [ratingEntry({ ratingUpdateTimeSeconds: undefined })] },
      status: 200,
      attempts: 1,
      retried: false,
      stillRateLimited: false,
    })
    const rows = await fetchCodeforces('cf_nodate_user')
    expect(rows).toHaveLength(1)
    expect(rows[0].participatedAt).toBeNull()
  })
})

describe('CF stats valid flag + problemsSolved (platformStats mock shape)', () => {
  it('populates rating + solved count when info+status OK (stats-shape)', async () => {
    mockFetchJson.mockImplementation(async (url: string) => {
      if (url.includes('user.info')) return infoOk()
      if (url.includes('user.status'))
        return statusOk([
          { verdict: 'OK', problem: { contestId: 1, index: 'A' }, contestId: 1 },
          { verdict: 'OK', problem: { contestId: 1, index: 'A' }, contestId: 1 }, // dup → 1 unique
          { verdict: 'OK', problem: { contestId: 2, index: 'B' }, contestId: 2 },
          { verdict: 'WRONG_ANSWER', problem: { contestId: 3, index: 'C' }, contestId: 3 },
        ])
      throw new Error('unexpected ' + url)
    })
    const stats = await fetchAllPlatformStats({ codeforcesHandle: 'cf_valid_user' })
    expect(stats).toHaveLength(1)
    expect(stats[0].valid).toBe(true)
    expect(stats[0].rating).toBe(1200)
    expect(stats[0].maxRating).toBe(1350)
    expect(stats[0].problemsSolved).toBe(2)
    expect(stats[0].contestCount).toBe(2)
  })

  it('skips malformed status rows but keeps valid stat (one bad row must not wipe count)', async () => {
    mockFetchJson.mockImplementation(async (url: string) => {
      if (url.includes('user.info')) return infoOk()
      if (url.includes('user.status'))
        return statusOk([
          { verdict: 'OK', problem: { contestId: 1, index: 'A' }, contestId: 1 },
          { verdict: 'OK' } as any, // missing problem → skipped
          { verdict: 'OK', problem: null } as any,
          { verdict: 'OK', problem: { contestId: 2, index: 'B' }, contestId: 2 },
        ])
      throw new Error('unexpected ' + url)
    })
    const stats = await fetchAllPlatformStats({ codeforcesHandle: 'cf_malformed_user' })
    expect(stats[0].valid).toBe(true)
    expect(stats[0].problemsSolved).toBe(2)
  })

  it('danger_rohit84 live shape: 400 FAILED on info → valid false (honest 0/1)', async () => {
    mockFetchJson.mockImplementation(async (url: string) => {
      if (url.includes('user.info')) return failed400('handles: User with handle danger_rohit84 not found')
      if (url.includes('user.status')) return failed400('handle: User with handle danger_rohit84 not found')
      throw new Error('unexpected ' + url)
    })
    const stats = await fetchAllPlatformStats({ codeforcesHandle: 'danger_rohit84' })
    expect(stats).toHaveLength(1)
    expect(stats[0].valid).toBe(false)
  })

  it('partial: info OK but status 400 → valid true with rating (status best-effort)', async () => {
    mockFetchJson.mockImplementation(async (url: string) => {
      if (url.includes('user.info')) return infoOk({ rating: 1400 })
      if (url.includes('user.status')) return failed400('handle: User with handle x not found')
      throw new Error('unexpected ' + url)
    })
    const stats = await fetchAllPlatformStats({ codeforcesHandle: 'cf_partial_user' })
    expect(stats[0].valid).toBe(true)
    expect(stats[0].rating).toBe(1400)
    // solved unknown → undefined (frontend renders 0/— honestly, valid stays true)
    expect(stats[0].problemsSolved).toBeUndefined()
  })
})

describe('CF stats rating fallback when user.info fails (LIVE 35-contests/0-1 fix)', () => {
  function ratingOk(newRatings: number[]) {
    return {
      data: {
        status: 'OK',
        result: newRatings.map((newRating, i) => ({
          contestId: 2000 + i,
          contestName: `Round #${2000 + i}`,
          rank: 1000 + i,
          oldRating: 1000,
          newRating,
          ratingUpdateTimeSeconds: 1700000000 + i * 100000,
        })),
      },
      status: 200,
      headers: undefined,
      attempts: 1,
      retried: false,
      stillRateLimited: false,
    }
  }

  function timeoutNil() {
    // fetchCodeforcesJson swallows network/timeout throws → data null, status 0.
    return {
      data: null,
      status: 0,
      headers: undefined,
      attempts: 1,
      retried: false,
      stillRateLimited: false,
    }
  }

  function rateLimited() {
    return {
      data: { status: 'FAILED', comment: 'Call limit exceeded, retry after 2 sec' },
      status: 429,
      headers: undefined,
      attempts: 2,
      retried: true,
      stillRateLimited: true,
    }
  }

  it('info 400 + rating OK → valid true with rating/maxRating/contestCount/solves', async () => {
    mockFetchJson.mockImplementation(async (url: string) => {
      if (url.includes('user.info')) return failed400('handles: User with handle x not found')
      if (url.includes('user.rating')) return ratingOk([1100, 1300, 1200])
      if (url.includes('user.status'))
        return statusOk([
          { verdict: 'OK', problem: { contestId: 1, index: 'A' }, contestId: 1 },
          { verdict: 'OK', problem: { contestId: 2, index: 'B' }, contestId: 2 },
        ])
      throw new Error('unexpected ' + url)
    })
    const stats = await fetchAllPlatformStats({ codeforcesHandle: 'cf_fallback_user' })
    expect(stats).toHaveLength(1)
    expect(stats[0].valid).toBe(true)
    expect(stats[0].rating).toBe(1200) // last newRating
    expect(stats[0].maxRating).toBe(1300) // peak
    expect(stats[0].contestCount).toBe(3) // rating history length (matches History)
    expect(stats[0].problemsSolved).toBe(2)
  })

  it('info 400 + rating OK + status 400 → valid true, solves undefined (status best-effort)', async () => {
    mockFetchJson.mockImplementation(async (url: string) => {
      if (url.includes('user.info')) return failed400('handles: User with handle x not found')
      if (url.includes('user.rating')) return ratingOk([1100, 1250])
      if (url.includes('user.status')) return failed400('handle: User with handle x not found')
      throw new Error('unexpected ' + url)
    })
    const stats = await fetchAllPlatformStats({ codeforcesHandle: 'cf_fallback_nostatus' })
    expect(stats[0].valid).toBe(true)
    expect(stats[0].rating).toBe(1250)
    expect(stats[0].maxRating).toBe(1250)
    expect(stats[0].contestCount).toBe(2)
    expect(stats[0].problemsSolved).toBeUndefined()
  })

  it('info timeout (status 0) + rating OK → valid true (India-tail fallback)', async () => {
    mockFetchJson.mockImplementation(async (url: string) => {
      if (url.includes('user.info')) return timeoutNil()
      if (url.includes('user.rating')) return ratingOk([900, 1000])
      if (url.includes('user.status')) return statusOk([{ verdict: 'OK', problem: { contestId: 9, index: 'A' }, contestId: 9 }])
      throw new Error('unexpected ' + url)
    })
    const stats = await fetchAllPlatformStats({ codeforcesHandle: 'cf_fallback_timeout' })
    expect(stats[0].valid).toBe(true)
    expect(stats[0].rating).toBe(1000)
    expect(stats[0].maxRating).toBe(1000)
    expect(stats[0].problemsSolved).toBe(1)
  })

  it('info still rate-limited + rating OK → valid true', async () => {
    mockFetchJson.mockImplementation(async (url: string) => {
      if (url.includes('user.info')) return rateLimited()
      if (url.includes('user.rating')) return ratingOk([1500])
      if (url.includes('user.status')) return statusOk([])
      throw new Error('unexpected ' + url)
    })
    const stats = await fetchAllPlatformStats({ codeforcesHandle: 'cf_fallback_ratelimit' })
    expect(stats[0].valid).toBe(true)
    expect(stats[0].rating).toBe(1500)
    expect(stats[0].maxRating).toBe(1500)
    expect(stats[0].contestCount).toBe(1)
  })

  it('info 400 + rating 400 → valid false (honest invalid, e.g. deleted handle)', async () => {
    mockFetchJson.mockImplementation(async (url: string) => {
      if (url.includes('user.info')) return failed400('handles: User with handle ghost123 not found')
      if (url.includes('user.rating')) return failed400('handle: User ghost123 not found')
      if (url.includes('user.status')) return failed400('handle: User with handle ghost123 not found')
      throw new Error('unexpected ' + url)
    })
    const stats = await fetchAllPlatformStats({ codeforcesHandle: 'ghost123' })
    expect(stats).toHaveLength(1)
    expect(stats[0].valid).toBe(false)
  })

  it('info 400 + rating OK empty → valid true, 0 contests (new account, not invalid)', async () => {
    mockFetchJson.mockImplementation(async (url: string) => {
      if (url.includes('user.info')) return failed400('handles: User with handle fresh456 not found')
      if (url.includes('user.rating')) return ratingOk([])
      if (url.includes('user.status')) return statusOk([])
      throw new Error('unexpected ' + url)
    })
    const stats = await fetchAllPlatformStats({ codeforcesHandle: 'fresh456' })
    expect(stats[0].valid).toBe(true)
    expect(stats[0].rating).toBeNull()
    expect(stats[0].contestCount).toBe(0)
  })

  it('CF stats timeout matches contest-fetcher budget (no 5s abort mismatch)', () => {
    // LIVE root cause: stats used 5s while fetchers used 10s — healthy
    // user.info from India aborted while user.rating succeeded.
    expect(CF_STATS_TIMEOUT_MS).toBe(10_000)
    expect(FETCHERS_TIMEOUT_MS).toBe(10_000)
    expect(CF_STATS_TIMEOUT_MS).toBe(FETCHERS_TIMEOUT_MS)
  })
})
