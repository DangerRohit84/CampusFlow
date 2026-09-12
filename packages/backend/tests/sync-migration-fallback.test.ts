/**
 * Prod incident regression: migration 20260910000000_sync_upgrades was never
 * applied to the live DB, so every `lastSyncError` write threw
 * PrismaClientValidationError ("Unknown argument `lastSyncError`") at
 * syncEngine.ts:214/:229 — fetch worked but stats NEVER saved, and even the
 * error-recording fallback crashed the same way.
 *
 * Contract under test:
 * - saveSyncResult() tries the full write, then retries WITHOUT lastSyncError
 *   on pre-migration errors (P2021/P2022/Unknown-argument) so stats +
 *   lastSyncedAt still save. Real errors still throw.
 * - recordSyncErrorBestEffort() (both fallbacks) NEVER throws — pre-migration
 *   it degrades to warn-once.
 * - Total failure still does NOT advance lastSyncedAt (masking fix preserved).
 *
 * Hermetic: DB + fetchers mocked, no network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockUpdate = vi.fn()
const mockFindUnique = vi.fn()
const mockContestFindMany = vi.fn()
const mockUpsert = vi.fn()
const mockPartFindMany = vi.fn()
const mockPartCreateMany = vi.fn()
const mockPartUpdate = vi.fn()
const mockFetchAll = vi.fn()
const mockFetchStats = vi.fn()

vi.mock('../src/config/db', () => ({
  __esModule: true,
  default: {
    get codingProfile() {
      return { findUnique: mockFindUnique, update: mockUpdate }
    },
    get codingContest() {
      return { findMany: mockContestFindMany }
    },
    get contestParticipation() {
      return {
        upsert: mockUpsert,
        findMany: mockPartFindMany,
        createMany: mockPartCreateMany,
        update: mockPartUpdate,
      }
    },
  },
}))

vi.mock('../src/services/platformFetchers', () => ({
  fetchAllPlatforms: (...args: any[]) => mockFetchAll(...args),
}))

vi.mock('../src/services/platformStats', () => ({
  fetchAllPlatformStats: (...args: any[]) => mockFetchStats(...args),
}))

import {
  syncUserContests,
  isMissingSyncColumnError,
  __resetSyncMissingColumnForTests,
} from '../src/services/syncEngine'

function missingColumnError(): any {
  const e: any = new Error(
    'Unknown argument `lastSyncError`. Available options are marked with ?.'
  )
  e.name = 'PrismaClientValidationError'
  return e
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetSyncMissingColumnForTests()
  mockFindUnique.mockResolvedValue({ userId: 'u1' })
  mockContestFindMany.mockResolvedValue([])
  mockUpsert.mockResolvedValue({})
  mockPartFindMany.mockResolvedValue([])
  mockPartCreateMany.mockResolvedValue({ count: 0 })
  mockPartUpdate.mockResolvedValue({})
  mockFetchAll.mockResolvedValue([])
  mockFetchStats.mockResolvedValue([])
})

describe('isMissingSyncColumnError detector', () => {
  it('flags pre-migration errors (P2021/P2022/Unknown-argument/relation-missing)', () => {
    expect(isMissingSyncColumnError({ code: 'P2022', message: 'x' })).toBe(true)
    expect(isMissingSyncColumnError({ code: 'P2021', message: 'x' })).toBe(true)
    expect(isMissingSyncColumnError(missingColumnError())).toBe(true)
    expect(
      isMissingSyncColumnError(new Error('relation "SyncThrottle" does not exist'))
    ).toBe(true)
  })

  it('ignores real errors (P2025/not-found/generic/null)', () => {
    expect(isMissingSyncColumnError({ code: 'P2025', message: 'not found' })).toBe(false)
    expect(isMissingSyncColumnError(new Error('boom'))).toBe(false)
    expect(isMissingSyncColumnError(null)).toBe(false)
    expect(isMissingSyncColumnError(undefined)).toBe(false)
  })
})

describe('saveSyncResult pre-migration fallback', () => {
  it('success path: retries WITHOUT lastSyncError, still saves stats + lastSyncedAt', async () => {
    mockUpdate
      .mockRejectedValueOnce(missingColumnError())
      .mockImplementationOnce(async (args: any) => {
        expect(args.where).toEqual({ userId: 'u1' })
        expect(args.data).not.toHaveProperty('lastSyncError')
        expect(args.data.platformStats).toEqual([]) // Order 9: Json array (was String '[]')
        expect(args.data.lastSyncedAt).toBeInstanceOf(Date)
        return {}
      })
    const res = await syncUserContests('u1')
    expect(res).toEqual({ synced: 0, platforms: [] })
    expect(mockUpdate).toHaveBeenCalledTimes(2)
    // First attempt was the FULL write (proves we still try the column first).
    expect(mockUpdate.mock.calls[0][0].data).toHaveProperty('lastSyncError', null)
  })

  it('total failure: records error WITHOUT lastSyncError and does NOT advance lastSyncedAt', async () => {
    mockFetchAll.mockResolvedValue([
      {
        platform: 'leetcode',
        contestName: 'Weekly Contest 1',
        contestUrl: null,
        rank: 5,
        score: 3,
        rating: 1500,
        ratingChange: 10,
        participatedAt: new Date(),
      },
    ])
    // Batched path: prefetch empty (all new) + createMany fails → total failure.
    // Legacy upsert mock kept for backward-compat (no longer called).
    mockUpsert.mockRejectedValue(new Error('db down'))
    mockPartFindMany.mockResolvedValue([])
    mockPartCreateMany.mockRejectedValue(new Error('db down'))
    mockUpdate
      .mockRejectedValueOnce(missingColumnError())
      .mockImplementationOnce(async (args: any) => {
        expect(args.data).not.toHaveProperty('lastSyncError')
        expect(args.data).not.toHaveProperty('lastSyncedAt')
        expect(args.data.platformStats).toEqual([]) // Order 9: Json array (was String '[]')
        return {}
      })
    const res = await syncUserContests('u1')
    expect(res.synced).toBe(0)
    expect(mockUpdate).toHaveBeenCalledTimes(2)
  })

  it('real (non-migration) save errors still surface via error-recording, never throw', async () => {
    const realErr = Object.assign(new Error('connection reset'), { code: 'P1001' })
    expect(isMissingSyncColumnError(realErr)).toBe(false)
    mockUpdate
      .mockRejectedValueOnce(realErr)
      .mockImplementationOnce(async () => ({}))
    await expect(syncUserContests('u1')).resolves.toEqual({ synced: 0, platforms: [] })
    expect(mockUpdate).toHaveBeenCalledTimes(2)
    // Error-recording retry carries the message (not masked).
    expect(String(mockUpdate.mock.calls[1][0].data.lastSyncError)).toContain('connection reset')
  })

  it('error-recording fallback never throws even when IT hits a missing column', async () => {
    // Full write fails (real error) AND the error-recording write ALSO fails
    // (pre-migration column) → sync must still resolve, not reject.
    mockUpdate
      .mockRejectedValueOnce(Object.assign(new Error('db down'), { code: 'P1001' }))
      .mockRejectedValueOnce(missingColumnError())
    await expect(syncUserContests('u1')).resolves.toEqual({ synced: 0, platforms: [] })
    expect(mockUpdate).toHaveBeenCalledTimes(2)
  })
})
