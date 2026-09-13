// services/aiMetering.ts — #11 per-college AI metering + cost caps.
// WHY: aiQuota middleware kept counters in process-local Maps (lost on
// restart, invisible to SuperAdmin, no cost view, no per-college caps).
// This module is the persistent layer: AiUsage daily rows + AiQuota caps.
// Every DB touch is guarded (`(db as any).aiUsage?` + try/catch) so
// pre-migration deploys fall back to in-memory defaults instead of 500.
// Pricing is a flat estimate (documented, deterministic for tests) — not a
// provider bill. No secrets: only collegeId/feature/tokens/costs are stored.

import prisma from '../config/db'
import { logger } from '../utils/logger'

export const DEFAULT_DAILY_TOKEN_CAP = 10_000
/** Flat estimate: 2 cents per 1k tokens (~$0.00002/token, Groq-class). */
export const COST_CENTS_PER_1K_TOKENS = 2
export const MAX_DAILY_TOKEN_CAP = 10_000_000
export const MAX_COST_CAP_CENTS = 100_000_000

export function dayBucket(d = new Date()): string {
  return d.toISOString().slice(0, 10)
}

export function dayDateFromBucket(bucket: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bucket)) return null
  const d = new Date(`${bucket}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

export function monthPrefix(d = new Date()): string {
  return d.toISOString().slice(0, 7)
}

export function estimateCostCents(tokens: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0
  return Math.max(1, Math.ceil((tokens / 1000) * COST_CENTS_PER_1K_TOKENS))
}

export interface CollegeQuota {
  collegeId: string
  dailyTokenCap: number
  monthlyTokenCap: number | null
  totalCostCapCents: number | null
  enabled: boolean
}

type DbLike = {
  aiQuota?: { findUnique?: (a: unknown) => Promise<CollegeQuota | null>; upsert?: (a: unknown) => Promise<CollegeQuota> }
  aiUsage?: {
    findMany?: (a: unknown) => Promise<Array<{ collegeId: string; feature: string; day: string; requests: number; tokens: number; costCents: number }>>
    aggregate?: (a: unknown) => Promise<{ _sum?: { tokens?: number | null; costCents?: number | null } }>
    upsert?: (a: unknown) => Promise<unknown>
  }
}

function asDb(db: unknown): DbLike {
  return (db ?? prisma) as unknown as DbLike
}

/** Quota for a college — defaults when the table/row is absent. */
export async function getCollegeQuota(collegeId: string, db: unknown = prisma): Promise<CollegeQuota> {
  const fallback: CollegeQuota = {
    collegeId,
    dailyTokenCap: DEFAULT_DAILY_TOKEN_CAP,
    monthlyTokenCap: null,
    totalCostCapCents: null,
    enabled: true,
  }
  try {
    const find = asDb(db)?.aiQuota?.findUnique
    if (typeof find !== 'function') return fallback
    const row = await find.call(asDb(db).aiQuota, { where: { collegeId } })
    if (!row) return fallback
    return {
      collegeId,
      dailyTokenCap: Number.isFinite(row.dailyTokenCap) ? row.dailyTokenCap : DEFAULT_DAILY_TOKEN_CAP,
      monthlyTokenCap: row.monthlyTokenCap ?? null,
      totalCostCapCents: row.totalCostCapCents ?? null,
      enabled: row.enabled !== false,
    }
  } catch (err) {
    logger.debug({ err: (err as Error)?.message || err }, '[aiMetering] getCollegeQuota fallback (non-fatal)')
    return fallback
  }
}

export interface QuotaInput {
  dailyTokenCap?: number
  monthlyTokenCap?: number | null
  totalCostCapCents?: number | null
  enabled?: boolean
}

/** Validate + upsert caps (SUPER_ADMIN only at the route layer). */
export async function setCollegeQuota(
  collegeId: string,
  input: QuotaInput,
  db: unknown = prisma,
): Promise<{ ok: boolean; quota?: CollegeQuota; error?: string }> {
  const daily = input.dailyTokenCap
  if (daily !== undefined && (!Number.isInteger(daily) || daily < 0 || daily > MAX_DAILY_TOKEN_CAP)) {
    return { ok: false, error: `dailyTokenCap must be an integer 0..${MAX_DAILY_TOKEN_CAP}` }
  }
  const monthly = input.monthlyTokenCap
  if (monthly !== undefined && monthly !== null && (!Number.isInteger(monthly) || monthly < 0 || monthly > MAX_DAILY_TOKEN_CAP * 31)) {
    return { ok: false, error: 'monthlyTokenCap must be a non-negative integer or null' }
  }
  const cost = input.totalCostCapCents
  if (cost !== undefined && cost !== null && (!Number.isInteger(cost) || cost < 0 || cost > MAX_COST_CAP_CENTS)) {
    return { ok: false, error: 'totalCostCapCents must be a non-negative integer or null' }
  }
  try {
    const upsert = asDb(db)?.aiQuota?.upsert
    if (typeof upsert !== 'function') return { ok: false, error: 'AI quota table not available (migration pending)' }
    const row = (await upsert.call(asDb(db).aiQuota, {
      where: { collegeId },
      create: {
        collegeId,
        dailyTokenCap: daily ?? DEFAULT_DAILY_TOKEN_CAP,
        monthlyTokenCap: monthly ?? null,
        totalCostCapCents: cost ?? null,
        enabled: input.enabled ?? true,
      },
      update: {
        ...(daily !== undefined ? { dailyTokenCap: daily } : {}),
        ...(monthly !== undefined ? { monthlyTokenCap: monthly } : {}),
        ...(cost !== undefined ? { totalCostCapCents: cost } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      },
    })) as unknown as CollegeQuota
    return { ok: true, quota: row }
  } catch (err) {
    logger.debug({ err: (err as Error)?.message || err }, '[aiMetering] setCollegeQuota failed')
    return { ok: false, error: 'Failed to save quota' }
  }
}

export interface CapCheck {
  allowed: boolean
  reason?: string
  quota: CollegeQuota
  dayTokens: number
  monthTokens: number
  totalCostCents: number
}

/**
 * Authoritative cap check (called by aiQuota middleware after the in-memory
 * fast path). Sums today's tokens + this month's tokens + lifetime cost from
 * AiUsage; empty (0) when the table is absent so pre-migration never blocks.
 */
export async function checkCollegeCap(
  collegeId: string,
  reqTokens: number,
  db: unknown = prisma,
  now = new Date(),
): Promise<CapCheck> {
  const quota = await getCollegeQuota(collegeId, db)
  const empty: CapCheck = { allowed: true, quota, dayTokens: 0, monthTokens: 0, totalCostCents: 0 }
  if (quota.enabled === false) {
    return { ...empty, allowed: false, reason: 'AI is disabled for this college. Contact your administrator.' }
  }
  try {
    const usage = asDb(db)?.aiUsage
    const day = dayBucket(now)
    const month = monthPrefix(now)
    const monthStart = `${month}-01`
    // Aggregate path (prod): DB-side sums, no JS over unbounded rows.
    // AiUsage has @@index([collegeId, day]) so day/month aggregates are
    // index-range scans; lifetime cost is a single indexed sum (no row fetch).
    if (typeof usage?.aggregate === 'function') {
      const agg = usage.aggregate.bind(usage)
      const [dayRow, monthRow, totalRow] = await Promise.all([
        agg({ where: { collegeId, day }, _sum: { tokens: true } }),
        agg({ where: { collegeId, day: { gte: monthStart, lte: day } }, _sum: { tokens: true } }),
        agg({ where: { collegeId }, _sum: { costCents: true } }),
      ])
      const dayTokens = dayRow?._sum?.tokens ?? 0
      const monthTokens = monthRow?._sum?.tokens ?? 0
      const totalCost = totalRow?._sum?.costCents ?? 0
      if (dayTokens + reqTokens > quota.dailyTokenCap) {
        return {
          allowed: false,
          quota,
          dayTokens,
          monthTokens,
          totalCostCents: totalCost,
          reason: `College AI token budget exhausted for today (${quota.dailyTokenCap.toLocaleString()} tokens/day). Try again tomorrow.`,
        }
      }
      if (quota.monthlyTokenCap != null && monthTokens + reqTokens > quota.monthlyTokenCap) {
        return {
          allowed: false,
          quota,
          dayTokens,
          monthTokens,
          totalCostCents: totalCost,
          reason: `College AI monthly budget exhausted (${quota.monthlyTokenCap.toLocaleString()} tokens/month).`,
        }
      }
      const reqCost = estimateCostCents(reqTokens)
      if (quota.totalCostCapCents != null && totalCost + reqCost > quota.totalCostCapCents) {
        return {
          allowed: false,
          quota,
          dayTokens,
          monthTokens,
          totalCostCents: totalCost,
          reason: 'College AI cost cap reached. Contact your administrator to raise the budget.',
        }
      }
      return { allowed: true, quota, dayTokens, monthTokens, totalCostCents: totalCost }
    }
    // Fallback path (hermetic tests / pre-aggregate clients): date-filtered
    // narrow select (current month only, bounded ≈31d×features rows), never a
    // lifetime full-scan. Lifetime cost is approximated by the month sum here;
    // authoritative lifetime enforcement needs the aggregate path above.
    const find = usage?.findMany
    if (typeof find !== 'function') return empty
    const rows = await find.call(usage, {
      where: { collegeId, day: { gte: monthStart, lte: day } },
      select: { day: true, tokens: true, costCents: true },
    })
    let dayTokens = 0
    let monthTokens = 0
    let totalCost = 0
    for (const r of rows) {
      totalCost += r.costCents || 0
      if (r.day === day) dayTokens += r.tokens || 0
      if (typeof r.day === 'string' && r.day.startsWith(month)) monthTokens += r.tokens || 0
    }
    if (dayTokens + reqTokens > quota.dailyTokenCap) {
      return {
        allowed: false,
        quota,
        dayTokens,
        monthTokens,
        totalCostCents: totalCost,
        reason: `College AI token budget exhausted for today (${quota.dailyTokenCap.toLocaleString()} tokens/day). Try again tomorrow.`,
      }
    }
    if (quota.monthlyTokenCap != null && monthTokens + reqTokens > quota.monthlyTokenCap) {
      return {
        allowed: false,
        quota,
        dayTokens,
        monthTokens,
        totalCostCents: totalCost,
        reason: `College AI monthly budget exhausted (${quota.monthlyTokenCap.toLocaleString()} tokens/month).`,
      }
    }
    const reqCost = estimateCostCents(reqTokens)
    if (quota.totalCostCapCents != null && totalCost + reqCost > quota.totalCostCapCents) {
      return {
        allowed: false,
        quota,
        dayTokens,
        monthTokens,
        totalCostCents: totalCost,
        reason: 'College AI cost cap reached. Contact your administrator to raise the budget.',
      }
    }
    return { allowed: true, quota, dayTokens, monthTokens, totalCostCents: totalCost }
  } catch (err) {
    logger.debug({ err: (err as Error)?.message || err }, '[aiMetering] checkCollegeCap fallback-allow (non-fatal)')
    return empty
  }
}

/** Best-effort usage write (fire-and-forget from middleware — never throws). */
export async function recordAiUsage(
  input: { collegeId: string; feature: string; tokens: number },
  db: unknown = prisma,
  now = new Date(),
): Promise<void> {
  try {
    const upsert = asDb(db)?.aiUsage?.upsert
    if (typeof upsert !== 'function') return
    const day = dayBucket(now)
    const dayDate = dayDateFromBucket(day)
    const tokens = Math.max(0, Math.floor(input.tokens || 0))
    const cost = estimateCostCents(tokens)
    await upsert.call(asDb(db).aiUsage, {
      where: { collegeId_feature_day: { collegeId: input.collegeId, feature: input.feature, day } },
      // Order 8 dual-write: String day + DATE dayDate (typed range key).
      create: { collegeId: input.collegeId, feature: input.feature, day, ...(dayDate ? { dayDate } : {}), requests: 1, tokens, costCents: cost },
      update: { requests: { increment: 1 }, tokens: { increment: tokens }, costCents: { increment: cost } },
    })
  } catch (err) {
    logger.debug({ err: (err as Error)?.message || err }, '[aiMetering] record failed (non-fatal)')
  }
}

export interface UsageSummaryRow {
  collegeId: string
  feature: string
  day: string
  requests: number
  tokens: number
  costCents: number
}

/** Guarded usage query for AiManager UI + platform KPIs ( [] pre-migration ). */
export async function getUsageSummary(
  params: { collegeId?: string | null; from?: string | null; to?: string | null; feature?: string | null } = {},
  db: unknown = prisma,
): Promise<UsageSummaryRow[]> {
  try {
    const find = asDb(db)?.aiUsage?.findMany
    if (typeof find !== 'function') return []
    const where: Record<string, unknown> = {}
    if (params.collegeId) where.collegeId = params.collegeId
    if (params.feature) where.feature = params.feature
    if (params.from || params.to) {
      const range: Record<string, string> = {}
      if (params.from) range.gte = params.from
      if (params.to) range.lte = params.to
      where.day = range
    }
    const rows = await find.call(asDb(db).aiUsage, { where, orderBy: { day: 'desc' }, take: 500 })
    return rows as UsageSummaryRow[]
  } catch (err) {
    logger.debug({ err: (err as Error)?.message || err }, '[aiMetering] summary failed (non-fatal)')
    return []
  }
}
