/**
 * Sync upgrades 1 + 3 — hermetic tests (no DB/network).
 *
 * Upgrade 1 (CF 2s gate + 1 jittered retry):
 * - gate spacing: min 2s between CF call starts, concurrent callers serialize
 * - retry once: 429/Retry-After → exactly one retry after honored delay
 * - gives up after 1: persistent 429 → exactly 2 attempts, stillRateLimited
 *
 * Upgrade 3 (cron safety):
 * - advisory lock skip: syncAllUsers returns skipped when lock held
 * - throttle: DB authoritative, fallback memory, clear on handle change
 * - lastSyncError: set on total failure, cleared on success (static asserts)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

import {
  CODEFORCES_MIN_GAP_MS,
  CODEFORCES_MAX_RETRIES,
  acquireCodeforcesSlot,
  fetchCodeforcesJson,
  getCodeforcesRetryDelayMs,
  isRateLimitedStatus,
  parseRetryAfterMs,
  __resetCodeforcesGateForTests,
} from '../src/services/codeforcesGate'
import { tryAcquireProfileSyncLock, PROFILE_SYNC_LOCK_KEY } from '../src/services/syncLock'
import {
  checkAndClaimSyncThrottle,
  clearSyncThrottleStore,
  __resetSyncThrottleStoreForTests,
} from '../src/services/syncThrottleStore'

const BACKEND_SRC = path.resolve(__dirname, '../src')
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(BACKEND_SRC, rel), 'utf8')
}

function mockJsonResponse(status: number, body: any, headers: Record<string, string> = {}): any {
  return {
    status,
    headers: {
      get: (k: string) => {
        const lk = k.toLowerCase()
        for (const [hk, hv] of Object.entries(headers)) {
          if (hk.toLowerCase() === lk) return hv
        }
        return null
      },
    },
    json: async () => body,
  }
}

describe('upgrade 1 — CF gate constants', () => {
  it('enforces 2s gap with max 1 retry (spec)', () => {
    expect(CODEFORCES_MIN_GAP_MS).toBe(2000)
    expect(CODEFORCES_MAX_RETRIES).toBe(1)
  })

  it('detects 429/503 only (404/200 are not rate-limited)', () => {
    expect(isRateLimitedStatus(429)).toBe(true)
    expect(isRateLimitedStatus(503)).toBe(true)
    expect(isRateLimitedStatus(200)).toBe(false)
    expect(isRateLimitedStatus(404)).toBe(false)
    expect(isRateLimitedStatus(500)).toBe(false)
  })

  it('parses Retry-After seconds', () => {
    expect(parseRetryAfterMs({ 'retry-after': '2' })).toBe(2000)
    expect(parseRetryAfterMs({ 'retry-after': '0' })).toBe(0)
    expect(parseRetryAfterMs({})).toBeNull()
    expect(parseRetryAfterMs(null)).toBeNull()
    expect(parseRetryAfterMs({ 'retry-after': 'not-a-date-or-number!!' })).toBeNull()
  })

  it('retry delay = base + 0..999ms jitter (deterministic with injected rand)', () => {
    expect(getCodeforcesRetryDelayMs(2000, () => 0)).toBe(2000)
    expect(getCodeforcesRetryDelayMs(2000, () => 0.5)).toBe(2500)
    expect(getCodeforcesRetryDelayMs(null, () => 0)).toBe(2000)
  })
})

describe('upgrade 1 — gate spacing', () => {
  beforeEach(() => __resetCodeforcesGateForTests())

  it('second acquire waits out the 2s gap (injected clock, no real 2s wait)', async () => {
    const sleeps: number[] = []
    const sleep = async (ms: number) => {
      sleeps.push(ms)
    }
    // First slot at t=1000 → no wait (gate starts at 0).
    await acquireCodeforcesSlot({ now: () => 1000, sleep })
    expect(sleeps).toEqual([])
    // Second slot at t=1500 → 500ms elapsed, must wait 1500ms.
    await acquireCodeforcesSlot({ now: () => 1500, sleep })
    expect(sleeps).toEqual([1500])
    // Third at t=5000 → gap satisfied, no wait.
    await acquireCodeforcesSlot({ now: () => 5000, sleep })
    expect(sleeps).toEqual([1500])
  })

  it('concurrent acquirers serialize (second still waits full gap)', async () => {
    const sleeps: number[] = []
    const sleep = async (ms: number) => {
      sleeps.push(ms)
    }
    const nowVal = 10_000
    await Promise.all([
      acquireCodeforcesSlot({ now: () => nowVal, sleep }),
      acquireCodeforcesSlot({ now: () => nowVal, sleep }),
    ])
    // First: no wait; second: same clock → full 2000ms wait.
    expect(sleeps).toEqual([CODEFORCES_MIN_GAP_MS])
  })
})

describe('upgrade 1 — retry once then give up', () => {
  beforeEach(() => __resetCodeforcesGateForTests())

  it('retries once after Retry-After + jitter, then succeeds', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(429, null, { 'retry-after': '1' }))
      .mockResolvedValueOnce(mockJsonResponse(200, { status: 'OK', result: [] }))
    const sleeps: number[] = []
    const res = await fetchCodeforcesJson<{ status: string }>(
      'https://codeforces.com/api/user.rating?handle=x',
      { timeoutMs: 1000 },
      {
        fetchFn: fetchFn as any,
        sleep: async (ms) => {
          sleeps.push(ms)
        },
        random: () => 0,
        acquire: async () => {},
      }
    )
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(sleeps).toEqual([1000])
    expect(res.attempts).toBe(2)
    expect(res.retried).toBe(true)
    expect(res.stillRateLimited).toBe(false)
    expect(res.data).toEqual({ status: 'OK', result: [] })
  })

  it('gives up after exactly 1 retry on persistent 429', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(mockJsonResponse(429, null, { 'retry-after': '1' }))
    const sleeps: number[] = []
    const res = await fetchCodeforcesJson(
      'https://codeforces.com/api/user.rating?handle=x',
      { timeoutMs: 1000 },
      {
        fetchFn: fetchFn as any,
        sleep: async (ms) => {
          sleeps.push(ms)
        },
        random: () => 0,
        acquire: async () => {},
      }
    )
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(sleeps).toEqual([1000])
    expect(res.attempts).toBe(2)
    expect(res.retried).toBe(true)
    expect(res.stillRateLimited).toBe(true)
  })

  it('retries once on 200 + FAILED Call-limit body, then gives up if still limited', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse(200, { status: 'FAILED', comment: 'Call limit exceeded, retry after 2 sec' })
      )
      .mockResolvedValueOnce(
        mockJsonResponse(200, { status: 'FAILED', comment: 'Call limit exceeded' })
      )
    const sleeps: number[] = []
    const res = await fetchCodeforcesJson(
      'https://codeforces.com/api/user.rating?handle=x',
      { timeoutMs: 1000 },
      {
        fetchFn: fetchFn as any,
        sleep: async (ms) => {
          sleeps.push(ms)
        },
        random: () => 0,
        acquire: async () => {},
      }
    )
    expect(fetchFn).toHaveBeenCalledTimes(2)
    // Comment hint "retry after 2 sec" → 2000ms base + 0 jitter.
    expect(sleeps).toEqual([2000])
    expect(res.stillRateLimited).toBe(true)
  })

  it('does not retry on 404 / non-limit FAILED (invalid handle fast path)', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(mockJsonResponse(404, null))
    const res = await fetchCodeforcesJson('https://codeforces.com/api/x', { timeoutMs: 1000 }, {
      fetchFn: fetchFn as any,
      sleep: async () => {},
      random: () => 0,
      acquire: async () => {},
    })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(res.retried).toBe(false)
    expect(res.stillRateLimited).toBe(false)
  })
})

describe('upgrade 1 — wiring: only CF paths use the gate', () => {
  it('platformFetchers CF path goes through fetchCodeforcesJson', () => {
    const src = readSrc('services/platformFetchers.ts')
    expect(src).toContain('fetchCodeforcesJson')
    // LeetCode/CodeChef/HackerRank/GFG must NOT be gated (no slowdown).
    const lcIdx = src.indexOf('_fetchLeetCode')
    const lcSlice = src.slice(lcIdx, lcIdx + 1500)
    expect(lcSlice).not.toContain('acquireCodeforcesSlot')
    expect(lcSlice).not.toContain('fetchCodeforcesJson')
  })

  it('platformStats CF path goes through fetchCodeforcesJson', () => {
    const src = readSrc('services/platformStats.ts')
    expect(src).toContain('fetchCodeforcesJson')
  })
})

describe('upgrade 3 — advisory lock', () => {
  it('uses a stable advisory-lock key', () => {
    expect(PROFILE_SYNC_LOCK_KEY).toBe(7279001)
    const src = readSrc('services/syncLock.ts')
    expect(src).toContain('pg_try_advisory_lock')
    expect(src).toContain('pg_advisory_unlock')
  })

  it('returns not-acquired when pg reports lock held (skip run)', async () => {
    const client = { $queryRaw: async () => [{ acquired: false }] }
    const h = await tryAcquireProfileSyncLock(client as any)
    expect(h.acquired).toBe(false)
  })

  it('acquires + releases when pg reports free', async () => {
    const calls: string[] = []
    const client = {
      $queryRaw: async (..._a: any[]) => {
        calls.push('q')
        if (calls.length === 1) return [{ acquired: true }]
        return [{ released: true }]
      },
    }
    const h = await tryAcquireProfileSyncLock(client as any)
    expect(h.acquired).toBe(true)
    await h.release()
    expect(calls.length).toBe(2)
  })

  it('fails open when DB throws (never blocks sync)', async () => {
    const client = {
      $queryRaw: async () => {
        throw new Error('no pg here')
      },
    }
    const h = await tryAcquireProfileSyncLock(client as any)
    expect(h.acquired).toBe(true)
  })

  it('syncAllUsers checks the advisory lock (static)', () => {
    const src = readSrc('services/syncEngine.ts')
    expect(src).toContain('tryAcquireProfileSyncLock')
  })
})

describe('upgrade 3 — persisted throttle', () => {
  beforeEach(() => __resetSyncThrottleStoreForTests())

  it('DB is authoritative: second claim within 60s rejected with retryAfterSec', async () => {
    let row: any = null
    const fakeDb = {
      syncThrottle: {
        findUnique: async () => row,
        upsert: async (args: any) => {
          row = { lastRequestedAt: args.create.lastRequestedAt }
          return row
        },
        deleteMany: async () => {
          row = null
          return { count: 1 }
        },
      },
    }
    const first = await checkAndClaimSyncThrottle('u1', { nowMs: 1000, prismaClient: fakeDb })
    expect(first.allowed).toBe(true)
    const second = await checkAndClaimSyncThrottle('u1', { nowMs: 2000, prismaClient: fakeDb })
    expect(second.allowed).toBe(false)
    expect(second.retryAfterSec).toBeGreaterThan(0)
  })

  it('falls back to memory when table missing (documented limit)', async () => {
    const noTableDb = {}
    const first = await checkAndClaimSyncThrottle('u2', { nowMs: 1000, prismaClient: noTableDb })
    expect(first.allowed).toBe(true)
    const second = await checkAndClaimSyncThrottle('u2', { nowMs: 2000, prismaClient: noTableDb })
    expect(second.allowed).toBe(false)
  })

  it('clear allows immediate re-claim (handle-change flow)', async () => {
    const noTableDb = {}
    await checkAndClaimSyncThrottle('u3', { nowMs: 1000, prismaClient: noTableDb })
    await clearSyncThrottleStore('u3', noTableDb)
    const again = await checkAndClaimSyncThrottle('u3', { nowMs: 2000, prismaClient: noTableDb })
    expect(again.allowed).toBe(true)
  })

  it('POST /sync still has 60s throttle + retryAfterSec + Retry-After + handle-change clear', () => {
    const src = readSrc('routes/codingProfile.ts')
    expect(src).toMatch(/SYNC_THROTTLE_MS\s*=\s*60\s*\*\s*1000|SYNC_THROTTLE_MS\s*=\s*60000/)
    expect(src).toContain('retryAfterSec')
    expect(src).toContain('Retry-After')
    expect(src).toMatch(/status\(429\)/)
    expect(src).toMatch(/syncThrottle\.delete\s*\(\s*req\.userId/)
    // DB-backed claim must be wired (not memory-only).
    expect(src).toContain('checkAndClaimSyncThrottle')
    expect(src).toContain('clearSyncThrottleStore')
  })
})

describe('upgrade 3 — per-run JSON log + lastSyncError (static)', () => {
  it('syncAllUsers emits one JSON run line with totals/skips/errors', () => {
    const src = readSrc('services/syncEngine.ts')
    expect(src).toContain('profile-sync-run')
    expect(src).toContain('totalSynced')
    expect(src).toContain('skippedRecent')
    expect(src).toContain('durationMs')
  })

  it('CodingProfile carries lastSyncError (schema + engine sets/clears)', () => {
    const schema = fs.readFileSync(path.resolve(__dirname, '../prisma/schema.prisma'), 'utf8')
    expect(schema).toContain('lastSyncError')
    const engine = readSrc('services/syncEngine.ts')
    expect(engine).toContain('lastSyncError')
  })

  it('total failure does NOT advance lastSyncedAt (masking fix)', () => {
    const src = readSrc('services/syncEngine.ts')
    // Engine must branch on total failure before writing lastSyncedAt.
    expect(src).toMatch(/totalFailure|synced\s*===\s*0/)
    expect(src).toContain('lastSyncedAt')
  })
})
