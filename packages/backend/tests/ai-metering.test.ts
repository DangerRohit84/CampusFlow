/**
 * #11 AI metering: cost estimate + quota defaults + cap enforcement.
 * Hermetic (no DB): fake stores assert persistent caps block over-cap with a
 * clear message, and absent tables fall back to allow/defaults (never throw).
 */
import { describe, it, expect, vi } from 'vitest'
import {
  estimateCostCents,
  dayBucket,
  getCollegeQuota,
  setCollegeQuota,
  checkCollegeCap,
  recordAiUsage,
  getUsageSummary,
  DEFAULT_DAILY_TOKEN_CAP,
} from '../src/services/aiMetering'

describe('estimateCostCents', () => {
  it('estimateCostCents_zero_for_empty', () => {
    expect(estimateCostCents(0)).toBe(0)
    expect(estimateCostCents(-5)).toBe(0)
  })
  it('estimateCostCents_2c_per_1k_rounded_up', () => {
    expect(estimateCostCents(1000)).toBe(2)
    expect(estimateCostCents(1)).toBe(1)
    expect(estimateCostCents(1500)).toBe(3)
  })
})

describe('getCollegeQuota', () => {
  it('getCollegeQuota_absent_table_returns_defaults', async () => {
    await expect(getCollegeQuota('c1', {} as any)).resolves.toMatchObject({
      collegeId: 'c1',
      dailyTokenCap: DEFAULT_DAILY_TOKEN_CAP,
      enabled: true,
    })
  })
  it('getCollegeQuota_returns_row_when_present', async () => {
    const db = { aiQuota: { findUnique: vi.fn(async () => ({ collegeId: 'c1', dailyTokenCap: 500, monthlyTokenCap: null, totalCostCapCents: null, enabled: true })) } } as any
    await expect(getCollegeQuota('c1', db)).resolves.toMatchObject({ dailyTokenCap: 500 })
  })
})

describe('setCollegeQuota', () => {
  it('setCollegeQuota_rejects_negative_daily', async () => {
    const res = await setCollegeQuota('c1', { dailyTokenCap: -1 }, {} as any)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/dailyTokenCap/)
  })
  it('setCollegeQuota_absent_table_reports_migration', async () => {
    const res = await setCollegeQuota('c1', { dailyTokenCap: 100 }, {} as any)
    expect(res.ok).toBe(false)
  })
  it('setCollegeQuota_upserts_valid_caps', async () => {
    const upsert = vi.fn(async () => ({ collegeId: 'c1', dailyTokenCap: 100, monthlyTokenCap: null, totalCostCapCents: null, enabled: true }))
    const res = await setCollegeQuota('c1', { dailyTokenCap: 100 }, { aiQuota: { upsert } } as any)
    expect(res.ok).toBe(true)
    expect(upsert).toHaveBeenCalledOnce()
  })
})

describe('checkCollegeCap', () => {
  const day = dayBucket(new Date())
  it('checkCollegeCap_allows_when_under_cap', async () => {
    const db = {
      aiQuota: { findUnique: vi.fn(async () => ({ collegeId: 'c1', dailyTokenCap: 10000, monthlyTokenCap: null, totalCostCapCents: null, enabled: true })) },
      aiUsage: { findMany: vi.fn(async () => [{ collegeId: 'c1', feature: 'chat', day, requests: 1, tokens: 100, costCents: 1 }]) },
    } as any
    const res = await checkCollegeCap('c1', 50, db)
    expect(res.allowed).toBe(true)
    expect(res.dayTokens).toBe(100)
  })
  it('checkCollegeCap_blocks_over_daily_with_message', async () => {
    const db = {
      aiQuota: { findUnique: vi.fn(async () => ({ collegeId: 'c1', dailyTokenCap: 100, monthlyTokenCap: null, totalCostCapCents: null, enabled: true })) },
      aiUsage: { findMany: vi.fn(async () => [{ collegeId: 'c1', feature: 'chat', day, requests: 5, tokens: 90, costCents: 1 }]) },
    } as any
    const res = await checkCollegeCap('c1', 50, db)
    expect(res.allowed).toBe(false)
    expect(res.reason).toMatch(/budget exhausted/i)
  })
  it('checkCollegeCap_disabled_college_blocked', async () => {
    const db = {
      aiQuota: { findUnique: vi.fn(async () => ({ collegeId: 'c1', dailyTokenCap: 10000, monthlyTokenCap: null, totalCostCapCents: null, enabled: false })) },
      aiUsage: { findMany: vi.fn(async () => []) },
    } as any
    const res = await checkCollegeCap('c1', 1, db)
    expect(res.allowed).toBe(false)
    expect(res.reason).toMatch(/disabled/)
  })
  it('checkCollegeCap_absent_tables_allow (pre-migration safe)', async () => {
    const res = await checkCollegeCap('c1', 999_999, {} as any)
    expect(res.allowed).toBe(true)
  })
})

describe('recordAiUsage / getUsageSummary', () => {
  it('recordAiUsage_never_throws_when_absent', async () => {
    await expect(recordAiUsage({ collegeId: 'c1', feature: 'chat', tokens: 10 }, {} as any)).resolves.toBeUndefined()
  })
  it('recordAiUsage_upserts_day_bucket', async () => {
    const upsert = vi.fn(async () => ({}))
    await recordAiUsage({ collegeId: 'c1', feature: 'chat', tokens: 100 }, { aiUsage: { upsert } } as any)
    expect(upsert).toHaveBeenCalledOnce()
    expect(upsert.mock.calls[0][0].where).toMatchObject({ collegeId_feature_day: { collegeId: 'c1', feature: 'chat', day: dayBucket(new Date()) } })
  })
  it('getUsageSummary_empty_when_absent', async () => {
    await expect(getUsageSummary({}, {} as any)).resolves.toEqual([])
  })
})
