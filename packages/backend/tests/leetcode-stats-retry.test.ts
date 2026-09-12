/**
 * LeetCode stats robustness — 12s timeout + one retry on timeout/abort only.
 *
 * Symptom (live log): AbortSignal timeout (5s FETCH_TIMEOUT) at
 * _leetcodeStats from India network. Sync continues (per-platform
 * isolation) but platform shows valid:false / stale.
 *
 * Hermetic: no DB/network — fetchFn/sleep/random injected via deps.
 */
import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  _leetcodeStats,
  isLeetcodeRetryableError,
  getLeetcodeRetryDelayMs,
  LEETCODE_STATS_TIMEOUT_MS,
  LEETCODE_STATS_MAX_RETRIES,
  LEETCODE_STATS_RETRY_BASE_MS,
  LEETCODE_STATS_RETRY_JITTER_MS,
} from '../src/services/platformStats'

function timeoutError(): Error {
  const e = new Error('The operation was aborted due to timeout') as any
  e.name = 'TimeoutError'
  return e
}

function abortError(): Error {
  const e = new Error('The operation was aborted') as any
  e.name = 'AbortError'
  return e
}

function successResponse() {
  return {
    json: async () => ({
      data: {
        allQuestionsCount: [{ difficulty: 'All', count: 3000 }],
        matchedUser: {
          username: 'testuser',
          profile: { ranking: 12345, reputation: 100 },
          submitStatsGlobal: {
            acSubmissionNum: [
              { difficulty: 'Easy', count: 100 },
              { difficulty: 'Medium', count: 50 },
              { difficulty: 'Hard', count: 10 },
            ],
          },
        },
      },
    }),
  }
}

describe('leetcode stats timeout config', () => {
  it('uses ~12s timeout with exactly one retry', () => {
    expect(LEETCODE_STATS_TIMEOUT_MS).toBe(12_000)
    expect(LEETCODE_STATS_MAX_RETRIES).toBe(1)
  })

  it('retry delay is small jittered backoff', () => {
    expect(getLeetcodeRetryDelayMs(() => 0)).toBe(LEETCODE_STATS_RETRY_BASE_MS)
    expect(getLeetcodeRetryDelayMs(() => 0.5)).toBe(
      LEETCODE_STATS_RETRY_BASE_MS + Math.floor(0.5 * LEETCODE_STATS_RETRY_JITTER_MS)
    )
    const d = getLeetcodeRetryDelayMs(() => 0.999)
    expect(d).toBeGreaterThanOrEqual(LEETCODE_STATS_RETRY_BASE_MS)
    expect(d).toBeLessThan(LEETCODE_STATS_RETRY_BASE_MS + LEETCODE_STATS_RETRY_JITTER_MS + 1)
  })

  it('only timeout/abort is retryable (not 404/validation)', () => {
    expect(isLeetcodeRetryableError(timeoutError())).toBe(true)
    expect(isLeetcodeRetryableError(abortError())).toBe(true)
    expect(isLeetcodeRetryableError(new Error('Not Found'))).toBe(false)
    expect(isLeetcodeRetryableError(new Error('validation failed'))).toBe(false)
    expect(isLeetcodeRetryableError({ status: 404 })).toBe(false)
  })

  it('source uses fresh AbortSignal per attempt (no signal reuse)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../src/services/platformStats.ts'),
      'utf8'
    )
    expect(src).toContain('AbortSignal.timeout(LEETCODE_STATS_TIMEOUT_MS)')
    // Other platforms stay on the tight 5s budget.
    expect(src).toContain('FETCH_TIMEOUT_MS = 5000')
  })

  it('leetcode timeout is warn-level (no error-spam)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../src/services/platformStats.ts'),
      'utf8'
    )
    const lcIdx = src.indexOf('export async function _leetcodeStats')
    const lcSlice = src.slice(lcIdx, lcIdx + 5000)
    expect(lcSlice).not.toContain('logger.error')
    expect(lcSlice).toMatch(/logger\.warn/)
  })
})

describe('leetcode stats retry-on-timeout', () => {
  it('retries once on timeout then succeeds (mock abort once then success)', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce(successResponse())
    const sleeps: number[] = []
    const stat = await _leetcodeStats('testuser', {
      fetchFn: fetchFn as any,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      random: () => 0,
    })
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(sleeps).toEqual([LEETCODE_STATS_RETRY_BASE_MS])
    expect(stat.valid).toBe(true)
    expect(stat.problemsSolved).toBe(160)
    expect(stat.easySolved).toBe(100)
  })

  it('does not retry on 404/validation (matchedUser null)', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      json: async () => ({ data: { matchedUser: null, allQuestionsCount: [] } }),
    })
    const sleep = vi.fn(async (_ms: number) => {})
    const stat = await _leetcodeStats('nosuchuser123', {
      fetchFn: fetchFn as any,
      sleep: sleep as any,
      random: () => 0,
    })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
    expect(stat.valid).toBe(false)
  })

  it('does not retry on non-timeout error', async () => {
    const fetchFn = vi.fn().mockRejectedValueOnce(new Error('boom validation'))
    const sleep = vi.fn(async (_ms: number) => {})
    const stat = await _leetcodeStats('testuser', {
      fetchFn: fetchFn as any,
      sleep: sleep as any,
      random: () => 0,
    })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
    expect(stat.valid).toBe(false)
  })

  it('persistent timeout after retry returns invalid (never throws — isolation)', async () => {
    const fetchFn = vi.fn().mockRejectedValue(timeoutError())
    const sleeps: number[] = []
    const stat = await _leetcodeStats('testuser', {
      fetchFn: fetchFn as any,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      random: () => 0,
    })
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(sleeps).toHaveLength(1)
    expect(stat.valid).toBe(false)
  })
})
