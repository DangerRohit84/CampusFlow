import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import prisma from '../config/db'
import { authenticate, authorize } from '../middleware/auth'
import { validateExternalUrl } from '../utils/secureUrl'
import { AiRateLimitError, enrichHackathonStaging, enrichInternshipStaging, fetchFromAllSources, fetchFromAllSourcesWithResults, fetchFromPlatform, fetchFromPlatformWithMeta, fetchOtherHackathons, fetchOtherInternships, isEnded, listFetchAllPlatforms, platformTypeMap } from '../services/opportunityAgent'
import { config } from '../config'
import { isAiRateLimitError, toAiIssueMessage } from '../ai/client'
import { parseSearchDate } from '../utils/search'
import { logger } from '../utils/logger'
import { buildFetchStats, fetchStatsStore } from '../repositories/fetchRepository'
import { normalizeFetchLimits, capItemsByLimits } from '../services/fetch/limits'
import { getAutoFetchState, setAutoFetchEnabled } from '../services/fetch/autoFetch'
import { recordSourceRun, selectFailedPlatforms, sourceHealthStore } from '../services/fetch/health'
import { getOrSet } from '../lib/cache'
import { getCachedPlatformSettings, invalidatePlatformSettingsCache } from '../services/fetch/settingsCache'

// PERF (prod burst fix): /fetch/stats counts payload cached 60s shared
// (Redis when healthy, memory otherwise — same seam as super-dashboard).
// Health stays OUTSIDE the cache (1 cheap indexed query, must stay fresh for
// the Retry UX). Card Refresh buttons re-read stats; worst-case staleness 60s.
const FETCH_STATS_CACHE_KEY = 'fetch:stats:counts'
const FETCH_STATS_CACHE_TTL_MS = 60_000

// #4 source health: canonical platform list for health (registry 10 + detached OTHER_*).
function listHealthPlatforms(): string[] {
  return [...listFetchAllPlatforms(), 'OTHER_HACKATHON', 'OTHER_INTERNSHIP']
}

// ─── AI 429 detection helper — returns AI issue message if rate-limited, else null ───
function detectAiRateLimit(error: any): string | null {
  if (!error) return null
  if (error instanceof AiRateLimitError) return error.message
  if (isAiRateLimitError(error)) return toAiIssueMessage(error)
  const msg = String((error as any)?.message || error || '')
  if (msg.includes('__AI_RATE_LIMIT__')) return msg.replace('__AI_RATE_LIMIT__:', '').trim() || 'AI issue: Rate limit reached, try again in 5s. Upgrade at https://console.groq.com/settings/billing'
  return null
}
function isAiIssueReason(reason: any): boolean {
  return reason === 'AI_ISSUE' || reason === 'AI_RATE_LIMIT'
}

const router = Router()

// ─── AI availability — single source of truth to prevent infinite enrich loops ───
const GROQ_PLACEHOLDERS = new Set(['your-groq-api-key-here', 'your_groq_api_key_here', 'placeholder'])
function isGroqKeySet(): boolean {
  const k = (process.env.GROQ_API_KEY || (config as any).groqApiKey || '').trim()
  return !!k && !GROQ_PLACEHOLDERS.has(k) && k.length > 10
}
async function isEnrichmentAIEnabled(): Promise<boolean> {
  if (isGroqKeySet()) return true
  try {
    const { getProvidersForFeature } = await import('../services/ai-manager')
    const providers = await getProvidersForFeature('enrichment')
    if (providers.length > 0) return true
  } catch {}
  return false
}

// All routes require super admin
router.use(authenticate)
router.use(authorize(['SUPER_ADMIN']))

const fetchLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many fetch attempts, please try again later' },
})

// ─── Cleanup: delete rejected/ended items older than 30 days ─────
router.post('/cleanup', async (_req, res) => {
  try {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)

    // HALF2: parallel independent deletes (was 2 sequential awaits)
    const [hackDeleted, intDeleted] = await Promise.all([
      prisma.hackathonStaging.deleteMany({
        where: {
          status: { in: ['REJECTED'] },
          updatedAt: { lt: cutoff },
        },
      }),
      prisma.internshipStaging.deleteMany({
        where: {
          status: { in: ['REJECTED'] },
          updatedAt: { lt: cutoff },
        },
      }),
    ])
    logger.info(`[Cleanup] Deleted ${hackDeleted.count} hackathons, ${intDeleted.count} internships older than 30 days`)
    res.json({ success: true, deleted: { hackathons: hackDeleted.count, internships: intDeleted.count } })
  } catch (error) {
    logger.error({ err: error }, 'Cleanup error:')
    res.status(500).json({ error: 'Failed to cleanup' })
  }
})

// Helper: enrich all pending items (optionally filtered by source)
// Skips ended deadlines, prioritizes near-deadline items first
// Auto-rejects items whose deadline has passed
// FIX: guard for GROQ_API_KEY not set — prevents infinite BATCH 5 loop on same rows when AI disabled
// AI_ISSUE: on Groq 429 TPM 8000, catch and return enriched 0 with reason AI_ISSUE — do NOT throw so fetch still returns saved
async function enrichAllPending(source?: string): Promise<{ hackEnriched: number; intEnriched: number; enriched: number; skipped: number; reason?: string; aiIssue?: boolean; message?: string }> {
  const BATCH_SIZE = 5
  const today = new Date()

  // ─── Early exit when AI disabled — single warning, no loop ───
  const aiEnabled = await isEnrichmentAIEnabled()
  if (!aiEnabled) {
    const hackWhere: any = {
      OR: [{ description: '' }, { targetDepartments: { equals: [] } }],
      AND: [
        { OR: [{ deadline: null }, { deadline: { gte: today } }] }],
    }
    const intWhere: any = {
      OR: [{ description: '' }, { targetDepartments: { equals: [] } }],
      AND: [
        { OR: [{ deadline: null }, { deadline: { gte: today.toISOString().slice(0, 10) } }] }],
    }
    if (source) {
      hackWhere.source = source
      intWhere.source = source
    }
    let hackPending = 0
    let intPending = 0
    try {
      hackPending = await prisma.hackathonStaging.count({ where: hackWhere })
      intPending = await prisma.internshipStaging.count({ where: intWhere })
    } catch {}
    const pendingCount = hackPending + intPending
    logger.warn(`[Enrich] GROQ_API_KEY not set — AI disabled, skipping enrichment${source ? ` for ${source}` : ''} (pending ${pendingCount})`)
    return { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: pendingCount, reason: 'AI_DISABLED' }
  }

  // Wrap all DB mutations in try/catch — never throw to caller (handler will fallback to enriched 0)
  try {
    // Auto-reject ended hackathons (deadline < today)
    try {
      const rejectedHack = await prisma.hackathonStaging.updateMany({
        where: { deadline: { lt: today }, status: { notIn: ['APPROVED', 'REJECTED'] } },
        data: { status: 'REJECTED' },
      })
      if (rejectedHack.count > 0) logger.info(`[Fetch] Auto-rejected ${rejectedHack.count} ended hackathons by deadline`)
    } catch (e: any) {
      logger.warn({ err: e?.message || e }, '[Enrich] Auto-reject hackathons failed (non-fatal):')
    }
    // Auto-reject hackathons with past-year title and null deadline (e.g., Netscout Hackathon 2025 created 2026-09-06)
    try {
      const currentYear = new Date().getFullYear()
      const pastYears = Array.from({ length: 6 }, (_, i) => String(currentYear - 1 - i)) // e.g., 2025,2024...
      // Find candidates with deadline null and title containing past year
      const candidates = await prisma.hackathonStaging.findMany({
        where: { deadline: null, status: { notIn: ['APPROVED', 'REJECTED'] } },
        select: { id: true, title: true },
      })
      const toRejectIds: string[] = []
      for (const c of candidates) {
        const m = c.title.match(/\b(20\d{2})\b/)
        if (m) {
          const y = parseInt(m[1], 10)
          if (!isNaN(y) && y < currentYear) toRejectIds.push(c.id)
          // Explicit Netscout case even if year parsing fails
          if (c.title.toLowerCase().includes('netscout') && c.title.includes('2025')) {
            if (!toRejectIds.includes(c.id)) toRejectIds.push(c.id)
          }
        } else if (c.title.toLowerCase().includes('netscout')) {
          // netscout without year but url implies 2025 — still reject if created in 2026 and deadline null
          toRejectIds.push(c.id)
        }
      }
      if (toRejectIds.length > 0) {
        const upd = await prisma.hackathonStaging.updateMany({
          where: { id: { in: toRejectIds } },
          data: { status: 'REJECTED', deadline: new Date(`${currentYear - 1}-12-31T23:59:59Z`) },
        })
        logger.info(`[Fetch] Auto-rejected ${upd.count} past-year null-deadline hackathons (Netscout + ${pastYears.join(',')})`)
      }
    } catch (e: any) {
      logger.warn({ err: e?.message || e }, '[Enrich] Auto-reject past-year hackathons failed (non-fatal):')
    }

    try {
      const rejectedInt = await prisma.internshipStaging.updateMany({
        where: { deadline: { lt: today.toISOString().slice(0, 10) }, status: { notIn: ['APPROVED', 'REJECTED'] } },
        data: { status: 'REJECTED' },
      })
      if (rejectedInt.count > 0) logger.info(`[Fetch] Auto-rejected ${rejectedInt.count} ended internships`)
    } catch (e: any) {
      logger.warn({ err: e?.message || e }, '[Enrich] Auto-reject internships failed (non-fatal):')
    }
    // Also internship past-year check (similar)
    try {
      const currentYear = new Date().getFullYear()
      const intCandidates = await prisma.internshipStaging.findMany({
        where: { deadline: null, status: { notIn: ['APPROVED', 'REJECTED'] } },
        select: { id: true, title: true },
      })
      const toRejectInt: string[] = []
      for (const c of intCandidates) {
        const m = c.title.match(/\b(20\d{2})\b/)
        if (m) {
          const y = parseInt(m[1], 10)
          if (!isNaN(y) && y < currentYear) toRejectInt.push(c.id)
        }
      }
      if (toRejectInt.length > 0) {
        const upd = await prisma.internshipStaging.updateMany({
          where: { id: { in: toRejectInt } },
          data: { status: 'REJECTED' },
        })
        logger.info(`[Fetch] Auto-rejected ${upd.count} past-year internships`)
      }
    } catch (e: any) {
      logger.warn({ err: e?.message || e }, '[Enrich] Auto-reject past-year internships failed (non-fatal):')
    }

    // Enrich hackathons — closest deadline first, skip ended
    let hackEnriched = 0
    let intEnriched = 0
    const seenHackIds = new Set<string>()
    let hackNoProgressStreak = 0
    while (true) {
      const where: any = {
        OR: [{ description: '' }, { targetDepartments: { equals: [] } }],
        AND: [
          { OR: [{ deadline: null }, { deadline: { gte: today } }] }],
      }
      if (source) where.source = source
      let pending: any[] = []
      try {
        pending = await prisma.hackathonStaging.findMany({
          where,
          orderBy: [{ deadline: 'asc' }, { createdAt: 'desc' }],
          take: BATCH_SIZE,
        })
      } catch (e: any) {
        logger.warn({ err: e?.message || e }, '[Enrich] findMany hackathons failed (non-fatal):', e?.stack)
        break
      }
      if (pending.length === 0) break
      const loopIds = pending.map((p: any) => p.id).join(',')
      if (seenHackIds.has(loopIds)) {
        hackNoProgressStreak++
        if (hackNoProgressStreak >= 1) {
          logger.warn(`[Enrich] Breaking hackathon loop — same ${pending.length} items repeatedly pending (AI not progressing). Skipping remaining.`)
          break
        }
      } else {
        hackNoProgressStreak = 0
      }
      seenHackIds.add(loopIds)
      // Use allSettled to detect AI rate-limit without losing batch — Groq 429 should not mark as enriched
      let hackRateLimited: string | null = null
      let hackBatchFailed = false
      try {
        const results = await Promise.allSettled(pending.map((h: any) => enrichHackathonStaging(h.id)))
        for (const r of results) {
          if (r.status === 'rejected') {
            const err: any = (r as any).reason
            const aiMsg = detectAiRateLimit(err)
            if (aiMsg) { hackRateLimited = aiMsg; hackBatchFailed = true; break }
            hackBatchFailed = true
          }
        }
        // Also handle Promise.allSettled itself throwing (should not), but keep compat
      } catch (e: any) {
        const aiMsg = detectAiRateLimit(e)
        if (aiMsg) hackRateLimited = aiMsg
        else logger.warn({ err: e?.message || e }, '[Enrich] enrichHackathonStaging batch failed (non-fatal):')
        hackBatchFailed = true
      }
      if (hackRateLimited) {
        logger.warn(`[Enrich] AI rate limit detected during hackathon enrich — stopping, returning AI issue. ${hackRateLimited}`)
        return { hackEnriched, intEnriched, enriched: hackEnriched + intEnriched, skipped: pending.length, reason: 'AI_ISSUE', aiIssue: true, message: hackRateLimited }
      }
      // Only count as enriched if batch did not have rate limit and AI progressed (avoid counting failed batches as enriched)
      // For non-AI failures, we still count pending.length as attempted but warn — to avoid infinite loop, break on same ids already handled above
      // To honor spec "enriched 0 due to AI" when rate limited on first batch, we already returned. For partial, count what succeeded before.
      if (!hackBatchFailed) {
        hackEnriched += pending.length
      } else {
        // Non-rate-limit batch failure: still advance but count 0 for this batch to avoid inflating enriched
        logger.warn('[Enrich] hackathon batch had non-AI failure, not counting as enriched, continuing')
      }
      logger.info(`[Fetch] Enriched ${hackEnriched} hackathons so far...`)
    }

    // Enrich internships — closest deadline first, skip ended
    // intEnriched already declared above (hack phase starts at 0, internship phase continues)
    const seenIntIds = new Set<string>()
    let intNoProgressStreak = 0
    while (true) {
      const where: any = {
        OR: [{ description: '' }, { targetDepartments: { equals: [] } }],
        AND: [
          { OR: [{ deadline: null }, { deadline: { gte: today.toISOString().slice(0, 10) } }] }],
      }
      if (source) where.source = source
      let pending: any[] = []
      try {
        pending = await prisma.internshipStaging.findMany({
          where,
          orderBy: [{ deadline: 'asc' }, { createdAt: 'desc' }],
          take: BATCH_SIZE,
        })
      } catch (e: any) {
        logger.warn({ err: e?.message || e }, '[Enrich] findMany internships failed (non-fatal):', e?.stack)
        break
      }
      if (pending.length === 0) break
      const loopIds = pending.map((p: any) => p.id).join(',')
      if (seenIntIds.has(loopIds)) {
        intNoProgressStreak++
        if (intNoProgressStreak >= 1) {
          logger.warn(`[Enrich] Breaking internship loop — same ${pending.length} items repeatedly pending (AI not progressing). Skipping remaining.`)
          break
        }
      } else {
        intNoProgressStreak = 0
      }
      seenIntIds.add(loopIds)
      let intRateLimited: string | null = null
      let intBatchFailed = false
      try {
        const results = await Promise.allSettled(pending.map((i: any) => enrichInternshipStaging(i.id)))
        for (const r of results) {
          if (r.status === 'rejected') {
            const err: any = (r as any).reason
            const aiMsg = detectAiRateLimit(err)
            if (aiMsg) { intRateLimited = aiMsg; intBatchFailed = true; break }
            intBatchFailed = true
          }
        }
      } catch (e: any) {
        const aiMsg = detectAiRateLimit(e)
        if (aiMsg) intRateLimited = aiMsg
        else logger.warn({ err: e?.message || e }, '[Enrich] enrichInternshipStaging batch failed (non-fatal):')
        intBatchFailed = true
      }
      if (intRateLimited) {
        logger.warn(`[Enrich] AI rate limit detected during internship enrich — stopping, returning AI issue. ${intRateLimited}`)
        return { hackEnriched, intEnriched, enriched: hackEnriched + intEnriched, skipped: pending.length, reason: 'AI_ISSUE', aiIssue: true, message: intRateLimited }
      }
      if (!intBatchFailed) {
        intEnriched += pending.length
      } else {
        logger.warn('[Enrich] internship batch had non-AI failure, not counting as enriched, continuing')
      }
      logger.info(`[Fetch] Enriched ${intEnriched} internships so far...`)
    }

    return { hackEnriched, intEnriched, enriched: hackEnriched + intEnriched, skipped: 0 }
  } catch (e: any) {
    const aiMsg = detectAiRateLimit(e)
    if (aiMsg) {
      logger.warn(`[Enrich] enrichAllPending AI rate limit (outer): ${aiMsg}`)
      return { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: 0, reason: 'AI_ISSUE', aiIssue: true, message: aiMsg }
    }
    logger.warn({ err: e?.message || e }, '[Enrich] enrichAllPending unexpected error (non-fatal):', e?.stack)
    return { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: 0 }
  }
}

// GET /api/fetch/stats - Get analysis stats for all platforms
// PERF: was 12 platforms × 4 count() = 48 concurrent round-trips
// (identical-timestamp queueing, maxConcurrent 61 > pool 50). Now 4 batched
// GROUP BY source queries (same where clauses, same numbers) + 60s shared
// counts cache. Shape identical.
router.get('/stats', async (req, res) => {
  try {
    // SSOT: registry owns the 10 fetch platforms; OTHER_* stay detached manual-only.
    const platforms = [...listFetchAllPlatforms(), 'OTHER_HACKATHON', 'OTHER_INTERNSHIP']

    // DIP: batched counts via fetchStatsStore (Prisma groupBy in prod, fake in tests).
    const stats = await getOrSet(FETCH_STATS_CACHE_KEY, FETCH_STATS_CACHE_TTL_MS, async () => {
      const counts = await fetchStatsStore.countStagingBySource()
      return buildFetchStats(platforms, counts)
    })

    const totalFetched = stats.reduce((sum, s) => sum + s.hackathons.fetched + s.internships.fetched, 0)
    const totalEnriched = stats.reduce((sum, s) => sum + s.hackathons.enriched + s.internships.enriched, 0)

    // #4 health: per-source status/latency/success-rate (UNKNOWN when never run
    // or migration pending). Additive — existing clients ignore the field.
    let health: unknown[] = []
    try {
      health = await sourceHealthStore.getAll(platforms)
    } catch (err: any) {
      logger.debug({ err }, '[Fetch] health read failed (non-fatal, stats without health):')
      health = []
    }

    res.json({
      totalFetched,
      totalEnriched,
      totalPending: totalFetched - totalEnriched,
      platforms: stats,
      health,
    })
  } catch (error) {
    logger.error({ err: error }, 'Fetch stats error:')
    res.status(500).json({ error: 'Failed to fetch stats' })
  }
})

// GET /api/fetch/health - Per-source health dashboard (ok/degraded/down).
// Returns one row per platform (registry 10 + OTHER_*), UNKNOWN when never run.
router.get('/health', async (_req, res) => {
  try {
    const health = await sourceHealthStore.getAll(listHealthPlatforms())
    const failed = selectFailedPlatforms(health as any)
    res.json({ health, failed })
  } catch (error) {
    logger.error({ err: error }, 'Fetch health error:')
    res.status(500).json({ error: 'Failed to fetch source health' })
  }
})

// Staging save lives in services/fetch/save.ts (SRP split: dedupe + coerce +
// 2 pre-fetch + 2 createMany, injectable db for tests). Re-exported for compat.
import { saveItems } from '../services/fetch/save';
export { saveItems };

// POST /api/fetch/all - Fetch from all platforms (BUILD MODE: 10 fetchers — DEVFOLIO, DEVPOST, MLH, UNSTOP (hackathons), HACK2SKILL, DORAHACKS, HACKEREARTH (hackathons), INTERNSHALA, UNSTOP_INTERNSHIP, WELLFOUND (internships))
// NOTE: Other Sources (OTHER_HACKATHON / OTHER_INTERNSHIP) are DELIBERATELY excluded from this bulk path.
// They remain manual-only via POST /fetch/other/hackathons and POST /fetch/other/internships (detached per user request).
// Body: { limits?: Record<string, number> } — 0 = all, 1-50 = max items
// Target-based fetching: passes per-platform limits to fetchers
// F07: bulk DoS guard — 30/h fetchLimiter (same as /other/* + /custom).
router.post('/all', fetchLimiter, async (req, res) => {
  try {
    const limits = req.body.limits || {}
    const admin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' }, select: { id: true, collegeId: true } }) // HALF2: narrow (was full row incl. passwordHash; only id/collegeId used)
    if (!admin) return res.status(400).json({ error: 'No admin user found' })

    logger.info({ err: limits }, '[Fetch] Starting fetch from all platforms...')
    // SSOT: registry owns platform keys + types (1-file adds). No local copy.
    const ALL_PLATFORMS = listFetchAllPlatforms()
    const PLATFORM_TYPE: Record<string, string> = platformTypeMap() as Record<string, string>
    // Tick/target normalization lives in services/fetch/limits.ts (SRP split).
    const normalizedLimits = await normalizeFetchLimits(
      limits as Record<string, unknown>,
      ALL_PLATFORMS,
      PLATFORM_TYPE,
      // PERF: 60s shared cache (was uncached findMany per Fetch All + cron tick).
      () => getCachedPlatformSettings() as Promise<Array<{ platform: string; type: string; enabled?: boolean; fetchLimit?: number }>>,
    )
    // Guard: if every tick off (empty map after DB fallback), return early with 0 (no external calls)
    if (Object.keys(normalizedLimits).length === 0) {
      logger.info('[Fetch] No platforms enabled — returning 0 fetched (all ticks off)')
      return res.json({ success: true, fetched: 0, saved: 0, hackathons: 0, internships: 0, skipped: 0, enriched: 0, message: 'No platforms enabled for Fetch All (all ticks off). Enable at least one.' })
    }
    // #4 health: detailed fan-out gives per-platform ok/latency/count (isolated
    // failures no longer invisible). Health writes never fail the fetch.
    const detailed = await fetchFromAllSourcesWithResults(normalizedLimits)
    const result = detailed.items
    await Promise.all(
      detailed.results.map((r) =>
        recordSourceRun(sourceHealthStore, {
          platform: r.platform,
          ok: r.ok,
          latencyMs: r.latencyMs,
          error: r.error,
          fetchedCount: r.count,
        }),
      ),
    )

    // Safety: ensure per-platform limits respected (fetcher already caps via target loop).
    // Pure helper in services/fetch/limits.ts (unit-tested; first-seen wins, order preserved).
    const limited = capItemsByLimits(result, normalizedLimits)

    const saved = await saveItems(limited, admin.id, admin.collegeId)
    const total = saved.hackathonSaved + saved.internshipSaved
    logger.info(`[Fetch] Saved ${total} items (${saved.hackathonSaved} hackathons, ${saved.internshipSaved} internships), ${saved.skipped} skipped`)

    // Auto-enrich all pending items — never fail the fetch if enrich throws (AI disabled / rate-limit / transient)
    // AI 429: return enriched 0 with reason AI_ISSUE, message "AI issue: Rate limit reached..." — do NOT throw so frontend gets 200 not 500
    let enriched: any = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: 0 }
    let enrichMessage: string | undefined
    let enrichReason: string | undefined
    let enrichAiIssue = false
    try {
      if (!(await isEnrichmentAIEnabled())) {
        logger.warn('[Enrich] GROQ_API_KEY not set — AI disabled, skipping enrichment')
        enrichMessage = 'AI disabled — run with GROQ_API_KEY to enrich'
        enrichReason = 'AI_DISABLED'
      } else {
        logger.info('[Fetch] Auto-enriching all pending items...')
        try {
          enriched = await enrichAllPending()
        } catch (enrichErr: any) {
          const aiMsg = detectAiRateLimit(enrichErr)
          if (aiMsg) {
            logger.warn({ err: aiMsg }, '[Enrich] enrichAllPending AI rate limit (non-fatal):')
            enriched = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: 0, reason: 'AI_ISSUE', aiIssue: true, message: aiMsg }
          } else {
            logger.warn({ err: enrichErr?.message || enrichErr }, '[Enrich] enrichAllPending failed (non-fatal):', enrichErr?.stack)
            enriched = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: 0 }
            enrichMessage = 'Enrich skipped due to error — saved items remain'
          }
        }
        if ((enriched as any).reason === 'AI_DISABLED') {
          logger.warn('[Enrich] GROQ_API_KEY not set — AI disabled, skipping enrichment')
          enrichMessage = 'AI disabled — run with GROQ_API_KEY to enrich'
          enrichReason = 'AI_DISABLED'
          enriched = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: (enriched as any).skipped || 0 }
        } else if ((enriched as any).reason === 'AI_ISSUE' || (enriched as any).aiIssue) {
          enrichMessage = (enriched as any).message || toAiIssueMessage({ message: String((enriched as any).message || '') })
          enrichReason = 'AI_ISSUE'
          enrichAiIssue = true
          logger.warn(`[Enrich] AI issue during enrich: ${enrichMessage} (saved ${total} remains, enriched 0 due to AI)`)
        } else if (!enrichMessage) {
          logger.info(`[Fetch] Auto-enrich done: ${enriched.hackEnriched} hackathons, ${enriched.intEnriched} internships`)
        }
      }
    } catch (enrichOuterErr: any) {
      const aiMsg = detectAiRateLimit(enrichOuterErr)
      if (aiMsg) {
        logger.warn({ err: aiMsg }, '[Enrich] AI check/enrich AI rate limit (non-fatal):')
        enriched = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: 0, reason: 'AI_ISSUE', aiIssue: true, message: aiMsg }
        enrichMessage = aiMsg
        enrichReason = 'AI_ISSUE'
        enrichAiIssue = true
      } else {
        logger.warn({ err: enrichOuterErr?.message || enrichOuterErr }, '[Enrich] AI check/enrich failed (non-fatal):', enrichOuterErr?.stack)
        enriched = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: 0 }
        enrichMessage = 'Enrich skipped due to error — saved items remain'
      }
    }

    // Ensure staging still has DRAFT items even if AI failed — saveItems already succeeded above
    const enrichedCount = enriched.hackEnriched + enriched.intEnriched
    const finalMessage = enrichMessage || (enrichAiIssue ? enriched.message : undefined)
    const finalReason = enrichReason || (enriched as any).reason
    res.json({
      success: true,
      fetched: limited.length,
      saved: total,
      hackathons: saved.hackathonSaved,
      internships: saved.internshipSaved,
      skipped: saved.skipped,
      enriched: enrichedCount,
      // AI 429 surfaces as success:true with aiIssue:true + message — frontend shows warning not "Fetch failed"
      ...(finalMessage ? { message: finalMessage, enrichReason: finalReason || 'AI_DISABLED', ...(enrichAiIssue || isAiIssueReason(finalReason) ? { aiIssue: true } : {}) } : {}),
      ...(enrichAiIssue || (finalReason === 'AI_ISSUE') ? { aiIssue: true } : {}),
    })
  } catch (error: any) {
    const aiMsg = detectAiRateLimit(error)
    if (aiMsg) {
      logger.warn({ err: aiMsg }, '[Fetch] Fetch all AI rate limit — returning AI issue not 500:')
      // Even if fetch threw AI issue, if we have no saved count we still return aiIssue
      return res.json({ success: true, fetched: 0, saved: 0, hackathons: 0, internships: 0, skipped: 0, enriched: 0, aiIssue: true, message: aiMsg, enrichReason: 'AI_ISSUE' })
    }
    logger.error({ err: error }, 'Fetch all error:', error?.stack)
    res.status(500).json({ error: 'Failed to fetch from all platforms' })
  }
})

// POST /api/fetch/other/hackathons - Fetch Other Hackathons (India 2026 via search + Reskilll/Hack2Skill)
// Body: { limit?: number } 0=All(30), 5/10/20/30 capped 30 per Other, deadline isEnded filtered
router.post('/other/hackathons', fetchLimiter, async (req, res) => {
  try {
    const rawLimit = req.body.limit
    const limitNum = rawLimit === undefined || rawLimit === null ? 0 : Number(rawLimit)
    if (isNaN(limitNum) || limitNum < 0 || limitNum > 50) return res.status(400).json({ error: 'Invalid limit (0-50)' })
    const admin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' }, select: { id: true, collegeId: true } }) // HALF2: narrow (was full row incl. passwordHash; only id/collegeId used)
    if (!admin) return res.status(400).json({ error: 'No admin user found' })
    const fetchLimit = limitNum > 0 ? limitNum : undefined
    logger.info(`[Fetch] Fetching OTHER_HACKATHON (limit: ${fetchLimit || '30 default'} capped at 10 pages)...`)
    // validateExternalUrl is used inside fetchOtherHackathons helpers for every external fetch
    // #4 health: time the source fetch so latency/success surface per-source.
    const otherHackT0 = Date.now()
    let result: any[] = []
    try {
      result = await fetchOtherHackathons(fetchLimit)
      await recordSourceRun(sourceHealthStore, {
        platform: 'OTHER_HACKATHON',
        ok: true,
        latencyMs: Date.now() - otherHackT0,
        fetchedCount: result.length,
      })
    } catch (fetchErr: any) {
      const aiMsg = detectAiRateLimit(fetchErr)
      if (aiMsg) throw fetchErr
      await recordSourceRun(sourceHealthStore, {
        platform: 'OTHER_HACKATHON',
        ok: false,
        latencyMs: Date.now() - otherHackT0,
        error: String(fetchErr?.message || fetchErr || 'Fetch failed'),
        fetchedCount: 0,
      })
      throw fetchErr
    }
    const saved = await saveItems(result, admin.id, admin.collegeId)
    const total = saved.hackathonSaved + saved.internshipSaved
    logger.info(`[Fetch] Saved ${total} items from OTHER_HACKATHON`)
    // Enrich never fails the overall fetch — AI 429 returns enriched 0 + AI_ISSUE (not 500)
    let enriched: any = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: 0 }
    let enrichMessage: string | undefined
    let enrichReason: string | undefined
    let enrichAiIssue = false
    try {
      if (!(await isEnrichmentAIEnabled())) {
        logger.warn('[Enrich] GROQ_API_KEY not set — AI disabled, skipping enrichment')
        enrichMessage = 'AI disabled — run with GROQ_API_KEY to enrich'
        enrichReason = 'AI_DISABLED'
      } else {
        try {
          enriched = await enrichAllPending('OTHER_HACKATHON')
        } catch (enrichErr: any) {
          const aiMsg = detectAiRateLimit(enrichErr)
          if (aiMsg) {
            logger.warn({ err: aiMsg }, '[Enrich] enrichAllPending OTHER_HACKATHON AI rate limit (non-fatal):')
            enriched = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: 0, reason: 'AI_ISSUE', aiIssue: true, message: aiMsg }
          } else {
            logger.warn({ err: enrichErr?.message || enrichErr }, '[Enrich] enrichAllPending OTHER_HACKATHON failed (non-fatal):', enrichErr?.stack)
            enriched = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: 0 }
            enrichMessage = 'Enrich skipped due to error — saved items remain'
          }
        }
        if ((enriched as any).reason === 'AI_DISABLED') {
          logger.warn('[Enrich] GROQ_API_KEY not set — AI disabled, skipping enrichment')
          enrichMessage = 'AI disabled — run with GROQ_API_KEY to enrich'
          enrichReason = 'AI_DISABLED'
          enriched = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: (enriched as any).skipped || 0 }
        } else if ((enriched as any).reason === 'AI_ISSUE' || (enriched as any).aiIssue) {
          enrichMessage = (enriched as any).message || toAiIssueMessage({ message: String((enriched as any).message || '') })
          enrichReason = 'AI_ISSUE'
          enrichAiIssue = true
          logger.warn(`[Enrich] AI issue OTHER_HACKATHON: ${enrichMessage} (saved ${total} remains, enriched 0 due to AI)`)
        } else if (!enrichMessage) {
          logger.info(`[Fetch] Auto-enrich OTHER_HACKATHON done: ${enriched.hackEnriched} hackathons, ${enriched.intEnriched} internships`)
        }
      }
    } catch (enrichOuterErr: any) {
      const aiMsg = detectAiRateLimit(enrichOuterErr)
      if (aiMsg) {
        logger.warn({ err: aiMsg }, '[Enrich] AI check/enrich failed for OTHER_HACKATHON AI rate limit (non-fatal):')
        enriched = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: 0, reason: 'AI_ISSUE', aiIssue: true, message: aiMsg }
        enrichMessage = aiMsg
        enrichReason = 'AI_ISSUE'
        enrichAiIssue = true
      } else {
        logger.warn({ err: enrichOuterErr?.message || enrichOuterErr }, '[Enrich] AI check/enrich failed for OTHER_HACKATHON (non-fatal):', enrichOuterErr?.stack)
        enriched = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: 0 }
        enrichMessage = 'Enrich skipped due to error — saved items remain'
      }
    }
    const enrichedCountHack = enriched.hackEnriched + enriched.intEnriched
    const finalMessageHack = enrichMessage || (enrichAiIssue ? enriched.message : undefined)
    const finalReasonHack = enrichReason || (enriched as any).reason
    // Spec: Groq 429 must return 200 with {success:true, fetched, saved, enriched:0, aiIssue:true, message:"AI issue: ..."} not 500
    res.json({
      success: true,
      fetched: result.length,
      saved: total,
      hackathons: saved.hackathonSaved,
      internships: saved.internshipSaved,
      skipped: saved.skipped,
      enriched: enrichedCountHack,
      ...(finalMessageHack ? { message: finalMessageHack, enrichReason: finalReasonHack || 'AI_DISABLED', ...(enrichAiIssue || isAiIssueReason(finalReasonHack) ? { aiIssue: true } : {}) } : {}),
      ...(enrichAiIssue || finalReasonHack === 'AI_ISSUE' ? { aiIssue: true } : {}),
    })
  } catch (error: any) {
    const aiMsg = detectAiRateLimit(error)
    if (aiMsg) {
      logger.warn({ err: aiMsg }, '[Fetch] OTHER_HACKATHON AI rate limit (outer) — returning AI issue not 500:')
      // Even if fetchOtherHackathons threw AI issue, if saved exists we would have returned earlier; this handles fetch-phase AI throw
      return res.json({ success: true, fetched: 0, saved: 0, hackathons: 0, internships: 0, skipped: 0, enriched: 0, aiIssue: true, message: aiMsg, enrichReason: 'AI_ISSUE' })
    }
    logger.error({ err: error }, 'Fetch OTHER_HACKATHON error:', error?.stack)
    res.status(500).json({ error: 'Failed to fetch OTHER_HACKATHON' })
  }
})

// POST /api/fetch/other/internships - Fetch Other Internships (India+global 2026 via search)
// Body: { limit?: number } 0=All(30), 5/10/20/30
router.post('/other/internships', fetchLimiter, async (req, res) => {
  try {
    const rawLimit = req.body.limit
    const limitNum = rawLimit === undefined || rawLimit === null ? 0 : Number(rawLimit)
    if (isNaN(limitNum) || limitNum < 0 || limitNum > 50) return res.status(400).json({ error: 'Invalid limit (0-50)' })
    const admin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' }, select: { id: true, collegeId: true } }) // HALF2: narrow (was full row incl. passwordHash; only id/collegeId used)
    if (!admin) return res.status(400).json({ error: 'No admin user found' })
    const fetchLimit = limitNum > 0 ? limitNum : undefined
    logger.info(`[Fetch] Fetching OTHER_INTERNSHIP (limit: ${fetchLimit || '30 default'} capped at 10 pages)...`)
    // #4 health: time the source fetch so latency/success surface per-source.
    const otherIntT0 = Date.now()
    let result: any[] = []
    try {
      result = await fetchOtherInternships(fetchLimit)
      await recordSourceRun(sourceHealthStore, {
        platform: 'OTHER_INTERNSHIP',
        ok: true,
        latencyMs: Date.now() - otherIntT0,
        fetchedCount: result.length,
      })
    } catch (fetchErr: any) {
      const aiMsg = detectAiRateLimit(fetchErr)
      if (aiMsg) throw fetchErr
      await recordSourceRun(sourceHealthStore, {
        platform: 'OTHER_INTERNSHIP',
        ok: false,
        latencyMs: Date.now() - otherIntT0,
        error: String(fetchErr?.message || fetchErr || 'Fetch failed'),
        fetchedCount: 0,
      })
      throw fetchErr
    }
    const saved = await saveItems(result, admin.id, admin.collegeId)
    const total = saved.hackathonSaved + saved.internshipSaved
    logger.info(`[Fetch] Saved ${total} items from OTHER_INTERNSHIP`)
    let enriched: any = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: 0 }
    let enrichMessage: string | undefined
    let enrichReason: string | undefined
    let enrichAiIssue = false
    try {
      if (!(await isEnrichmentAIEnabled())) {
        logger.warn('[Enrich] GROQ_API_KEY not set — AI disabled, skipping enrichment')
        enrichMessage = 'AI disabled — run with GROQ_API_KEY to enrich'
        enrichReason = 'AI_DISABLED'
      } else {
        try {
          enriched = await enrichAllPending('OTHER_INTERNSHIP')
        } catch (enrichErr: any) {
          const aiMsg = detectAiRateLimit(enrichErr)
          if (aiMsg) {
            logger.warn({ err: aiMsg }, '[Enrich] enrichAllPending OTHER_INTERNSHIP AI rate limit (non-fatal):')
            enriched = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: 0, reason: 'AI_ISSUE', aiIssue: true, message: aiMsg }
          } else {
            logger.warn({ err: enrichErr?.message || enrichErr }, '[Enrich] enrichAllPending OTHER_INTERNSHIP failed (non-fatal):', enrichErr?.stack)
            enriched = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: 0 }
            enrichMessage = 'Enrich skipped due to error — saved items remain'
          }
        }
        if ((enriched as any).reason === 'AI_DISABLED') {
          logger.warn('[Enrich] GROQ_API_KEY not set — AI disabled, skipping enrichment')
          enrichMessage = 'AI disabled — run with GROQ_API_KEY to enrich'
          enrichReason = 'AI_DISABLED'
          enriched = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: (enriched as any).skipped || 0 }
        } else if ((enriched as any).reason === 'AI_ISSUE' || (enriched as any).aiIssue) {
          enrichMessage = (enriched as any).message || toAiIssueMessage({ message: String((enriched as any).message || '') })
          enrichReason = 'AI_ISSUE'
          enrichAiIssue = true
          logger.warn(`[Enrich] AI issue OTHER_INTERNSHIP: ${enrichMessage} (saved ${total} remains, enriched 0 due to AI)`)
        } else if (!enrichMessage) {
          logger.info(`[Fetch] Auto-enrich OTHER_INTERNSHIP done: ${enriched.hackEnriched} hackathons, ${enriched.intEnriched} internships`)
        }
      }
    } catch (enrichOuterErr: any) {
      const aiMsg = detectAiRateLimit(enrichOuterErr)
      if (aiMsg) {
        logger.warn({ err: aiMsg }, '[Enrich] AI check/enrich failed for OTHER_INTERNSHIP AI rate limit (non-fatal):')
        enriched = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: 0, reason: 'AI_ISSUE', aiIssue: true, message: aiMsg }
        enrichMessage = aiMsg
        enrichReason = 'AI_ISSUE'
        enrichAiIssue = true
      } else {
        logger.warn({ err: enrichOuterErr?.message || enrichOuterErr }, '[Enrich] AI check/enrich failed for OTHER_INTERNSHIP (non-fatal):', enrichOuterErr?.stack)
        enriched = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: 0 }
        enrichMessage = 'Enrich skipped due to error — saved items remain'
      }
    }
    const enrichedCountIntern = enriched.hackEnriched + enriched.intEnriched
    const finalMessageIntern = enrichMessage || (enrichAiIssue ? enriched.message : undefined)
    const finalReasonIntern = enrichReason || (enriched as any).reason
    res.json({
      success: true,
      fetched: result.length,
      saved: total,
      hackathons: saved.hackathonSaved,
      internships: saved.internshipSaved,
      skipped: saved.skipped,
      enriched: enrichedCountIntern,
      ...(finalMessageIntern ? { message: finalMessageIntern, enrichReason: finalReasonIntern || 'AI_DISABLED', ...(enrichAiIssue || isAiIssueReason(finalReasonIntern) ? { aiIssue: true } : {}) } : {}),
      ...(enrichAiIssue || finalReasonIntern === 'AI_ISSUE' ? { aiIssue: true } : {}),
    })
  } catch (error: any) {
    const aiMsg = detectAiRateLimit(error)
    if (aiMsg) {
      logger.warn({ err: aiMsg }, '[Fetch] OTHER_INTERNSHIP AI rate limit (outer) — returning AI issue not 500:')
      return res.json({ success: true, fetched: 0, saved: 0, hackathons: 0, internships: 0, skipped: 0, enriched: 0, aiIssue: true, message: aiMsg, enrichReason: 'AI_ISSUE' })
    }
    logger.error({ err: error }, 'Fetch OTHER_INTERNSHIP error:', error?.stack)
    res.status(500).json({ error: 'Failed to fetch OTHER_INTERNSHIP' })
  }
})

// POST /api/fetch/custom - Paste custom URLs (up to 10) separate from bulk — no union
// Body: { urls: string[], type: 'hackathons' | 'internships' }
router.post('/custom', fetchLimiter, async (req, res) => {
  try {
    const { urls, type } = req.body as { urls?: string[]; type?: string }
    if (!Array.isArray(urls) || urls.length === 0) return res.status(400).json({ error: 'urls array required (1-10)' })
    if (urls.length > 10) return res.status(400).json({ error: 'Up to 10 URLs only' })
    const normalizedType = (type || 'hackathons').toLowerCase()
    if (!['hackathons', 'internships'].includes(normalizedType)) return res.status(400).json({ error: 'type must be hackathons or internships' })
    const admin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' }, select: { id: true, collegeId: true } }) // HALF2: narrow (was full row incl. passwordHash; only id/collegeId used)
    if (!admin) return res.status(400).json({ error: 'No admin user found' })
    const items: any[] = []
    for (const raw of urls) {
      const urlStr = String(raw).trim()
      if (!urlStr) continue
      try { await validateExternalUrl(urlStr) } catch (e: any) { return res.status(400).json({ error: `Invalid URL ${urlStr}: ${e.message}` }) }
      // Fetch 6k stripped content for enrichment-like title extraction, with cache
      let title = ''
      let description = ''
      let strippedForExtra = ''
      let extraDeadline = ''
      let extraPrize = ''
      let extraOrganizer = ''
      try {
        const cacheKey = `custom:${urlStr}`
        let html: string | undefined = undefined
        // try cache
        // Use scrape-like fetch with validate already done.
        // SSRF (F18): redirect:manual + TOCTOU re-validate + 2MB cap + 10s timeout.
        // Default fetch follows redirects to private hosts (169.254.169.254) after
        // validateExternalUrl passed the original URL — manual stops that.
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10000)
        const resp = await fetch(urlStr, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: controller.signal,
          redirect: 'manual' as any,
        } as any)
        clearTimeout(timeout)
        // Manual redirect: do NOT follow automatically. Re-validate Location (TOCTOU)
        // and only allow a single same-public-host hop; otherwise treat as fetchable=false.
        if (resp.status >= 300 && resp.status < 400) {
          const loc = resp.headers.get('location')
          if (loc) {
            try {
              const nextUrl = new URL(loc, urlStr).toString()
              await validateExternalUrl(nextUrl)
              // Single-hop follow with same guards (manual again, 10s, 2MB cap below)
              const c2 = new AbortController()
              const t2 = setTimeout(() => c2.abort(), 10000)
              const r2 = await fetch(nextUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                signal: c2.signal,
                redirect: 'manual' as any,
              } as any)
              clearTimeout(t2)
              if (r2.status >= 300 && r2.status < 400) {
                title = urlStr.split('/').pop()?.replace(/[-_]/g, ' ').slice(0, 80) || 'Custom Opportunity'
              } else if (r2.ok) {
                const len = Number(r2.headers.get('content-length') || '0')
                if (len && len > 2 * 1024 * 1024) {
                  title = urlStr.split('/').pop()?.replace(/[-_]/g, ' ').slice(0, 80) || 'Custom Opportunity'
                } else {
                  const htmlRaw = await r2.text()
                  if (htmlRaw.length > 2 * 1024 * 1024) {
                    title = urlStr.split('/').pop()?.replace(/[-_]/g, ' ').slice(0, 80) || 'Custom Opportunity'
                  } else {
                    // Reuse main parse path by faking resp.ok below
                    ;(resp as any).__redirectBody = htmlRaw
                    ;(resp as any).__redirectOk = true
                  }
                }
              } else {
                title = urlStr.split('/').pop()?.replace(/[-_]/g, ' ').slice(0, 80) || 'Custom Opportunity'
              }
            } catch {
              title = urlStr.split('/').pop()?.replace(/[-_]/g, ' ').slice(0, 80) || 'Custom Opportunity'
            }
          } else {
            title = urlStr.split('/').pop()?.replace(/[-_]/g, ' ').slice(0, 80) || 'Custom Opportunity'
          }
        }
        const redirectedBody = (resp as any).__redirectBody as string | undefined
        const redirectedOk = (resp as any).__redirectOk as boolean | undefined
        if (redirectedOk && redirectedBody !== undefined) {
          const htmlRaw = redirectedBody
          const titleMatch = htmlRaw.match(/<title[^>]*>([^<]+)<\/title>/i)
          title = titleMatch ? titleMatch[1].trim().slice(0, 150) : ''
          const stripped = htmlRaw.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 6000)
          strippedForExtra = stripped
          description = stripped.substring(0, 400) || title
          if (!title) {
            const h1Match = htmlRaw.match(/<h1[^>]*>([^<]+)<\/h1>/i)
            title = h1Match ? h1Match[1].trim().slice(0, 150) : urlStr.split('/').pop()?.replace(/[-_]/g, ' ').slice(0, 80) || 'Custom Opportunity'
          }
        } else if ((resp as any).__redirectBody === undefined && (resp.status < 300 || resp.status >= 400) && resp.ok) {
          const contentLength = Number(resp.headers.get('content-length') || '0')
          if (contentLength && contentLength > 2 * 1024 * 1024) {
            title = urlStr.split('/').pop()?.replace(/[-_]/g, ' ').slice(0, 80) || 'Custom Opportunity'
          } else {
            const htmlRaw = await resp.text()
            if (htmlRaw.length > 2 * 1024 * 1024) {
              title = urlStr.split('/').pop()?.replace(/[-_]/g, ' ').slice(0, 80) || 'Custom Opportunity'
            } else {
              const titleMatch = htmlRaw.match(/<title[^>]*>([^<]+)<\/title>/i)
          title = titleMatch ? titleMatch[1].trim().slice(0, 150) : ''
          const stripped = htmlRaw.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 6000)
          strippedForExtra = stripped
          description = stripped.substring(0, 400) || title
          if (!title) {
            // fallback to h1
            const h1Match = htmlRaw.match(/<h1[^>]*>([^<]+)<\/h1>/i)
            title = h1Match ? h1Match[1].trim().slice(0, 150) : urlStr.split('/').pop()?.replace(/[-_]/g,' ').slice(0,80) || 'Custom Opportunity'
            // also try to refine title from hackathon pattern in stripped
            if (!title || title.length < 5) {
              const hackTitleMatch = stripped.match(/([A-Z][^.!?\n]{10,90}hackathon[^.!?\n]{0,40})/i)
              if (hackTitleMatch) {
                const cand = hackTitleMatch[0].trim().replace(/\s+/g, ' ').slice(0, 120)
                if (cand.length > title.length && cand.length < 150) title = cand
              }
            }
          }
          // Extract deadline and prize for direct URL like hacksummit.aaruush.org
          const deadlineMatch = stripped.match(/(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s*\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i)
          if (deadlineMatch) extraDeadline = parseSearchDate(deadlineMatch[0]) || ''
          const prizeMatch = stripped.match(/(?:prize|reward|cash)\s*[:\-]?\s*₹?\s*[\d,]+(?:\s*(?:lakh|k|crore))?/i)
          if (prizeMatch) extraPrize = prizeMatch[0].trim().slice(0, 80)
          // High organizer deduction for custom URL — ensures hacksummit.aaruush.org not LOW
          const lowerCombined = `${title} ${stripped.slice(0, 1200)} ${urlStr}`.toLowerCase()
          const highKeywords = ['iqoo','the hive','hive','aaruush','hacksummit','sih','smart india','microsoft','google','amazon','flipkart','adobe','juspay','infosys','tcs','uber','walmart','hackerearth','unstop','devfolio','reskilll','hack2skill']
          for (const kw of highKeywords) {
            if (lowerCombined.includes(kw)) {
              extraOrganizer = kw.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
              break
            }
          }
          if (!extraOrganizer && urlStr.toLowerCase().includes('aaruush')) extraOrganizer = 'Aaruush'
          if (!extraOrganizer && urlStr.toLowerCase().includes('hive')) extraOrganizer = 'The Hive'
          if (!extraOrganizer && urlStr.toLowerCase().includes('iqoo')) extraOrganizer = 'iQOO'
            } // end parse htmlRaw (<=2MB)
          } // end contentLength else
        } else if (!(resp as any).__redirectBody && !resp.ok) {
          // Non-OK and no redirect body (e.g., 404/500 or blocked redirect) → fallback title
          title = urlStr.split('/').pop()?.replace(/[-_]/g, ' ').slice(0, 80) || 'Custom Opportunity'
        }
        // Redirect-without-body case (3xx with no followable Location) already set title above.
      } catch {
        title = urlStr.split('/').pop()?.replace(/[-_]/g,' ').slice(0,80) || 'Custom Opportunity'
      }
      if (!title || title.length < 3) title = `Custom ${normalizedType.slice(0, -1)} ${items.length + 1}`
      // Final high organizer check on title+url if not already set
      if (!extraOrganizer) {
        const lc = `${title} ${urlStr}`.toLowerCase()
        if (lc.includes('aaruush') || lc.includes('hacksummit')) extraOrganizer = 'Aaruush'
        else if (lc.includes('hive')) extraOrganizer = 'The Hive'
        else if (lc.includes('iqoo')) extraOrganizer = 'iQOO'
        else if (lc.includes('sih') || lc.includes('smart india')) extraOrganizer = 'Smart India Hackathon'
      }
      if (normalizedType === 'hackathons') {
        const isHighCustom = !!extraOrganizer || ['iqoo','hive','aaruush','hacksummit','sih','smart india','microsoft','google','juspay','flipkart','reskilll','hack2skill'].some(k => `${title} ${urlStr}`.toLowerCase().includes(k)) || urlStr.toLowerCase().includes('hacksummit.aaruush.org') || urlStr.toLowerCase().includes('thehive') || urlStr.toLowerCase().includes('reskilll.com') || urlStr.toLowerCase().includes('hack2skill.com')
        items.push({
          type: 'HACKATHON',
          title,
          description: description || title,
          url: urlStr,
          source: 'OTHER_HACKATHON',
          organizer: extraOrganizer || '',
          deadline: extraDeadline || '',
          startDate: '',
          duration: '',
          location: strippedForExtra && /india/i.test(strippedForExtra) ? 'India' : 'Online',
          mode: 'ONLINE',
          prizePool: extraPrize || '',
          stipend: '',
          company: '',
          role: '',
          themes: [],
          website: '',
          discord: '',
           participantsCount: 0,
          inviteOnly: false,
        } as any)
      } else {
        let company = 'Unknown'
        if (title.includes(' at ')) company = title.split(' at ').pop()?.trim() || 'Unknown'
        items.push({
          type: 'INTERNSHIP',
          title,
          description: description || title,
          url: urlStr,
          source: 'OTHER_INTERNSHIP',
          organizer: company,
          deadline: '',
          startDate: '',
          duration: '',
          location: '',
          mode: 'REMOTE',
          prizePool: '',
          stipend: '',
          company,
          role: title,
          themes: [],
          website: '',
          discord: '',
          participantsCount: 0,
          inviteOnly: false,
        })
      }
    }
    if (items.length === 0) return res.status(400).json({ error: 'No valid URLs' })
    const saved = await saveItems(items, admin.id, admin.collegeId)
    let enriched: any = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: 0 }
    let enrichMessage: string | undefined
    let enrichReason: string | undefined
    let enrichAiIssue = false
    try {
      if (!(await isEnrichmentAIEnabled())) {
        logger.warn('[Enrich] GROQ_API_KEY not set — AI disabled, skipping enrichment')
        enrichMessage = 'AI disabled — run with GROQ_API_KEY to enrich'
        enrichReason = 'AI_DISABLED'
      } else {
        try {
          enriched = await enrichAllPending(normalizedType === 'hackathons' ? 'OTHER_HACKATHON' : 'OTHER_INTERNSHIP')
        } catch (enrichErr: any) {
          const aiMsg = detectAiRateLimit(enrichErr)
          if (aiMsg) {
            logger.warn({ err: aiMsg }, '[Enrich] enrichAllPending custom AI rate limit (non-fatal):')
            enriched = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: 0, reason: 'AI_ISSUE', aiIssue: true, message: aiMsg }
          } else {
            logger.warn({ err: enrichErr?.message || enrichErr }, '[Enrich] enrichAllPending custom failed (non-fatal):', enrichErr?.stack)
            enriched = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: 0 }
            enrichMessage = 'Enrich skipped due to error — saved items remain'
          }
        }
        if ((enriched as any).reason === 'AI_DISABLED') {
          logger.warn('[Enrich] GROQ_API_KEY not set — AI disabled, skipping enrichment')
          enrichMessage = 'AI disabled — run with GROQ_API_KEY to enrich'
          enrichReason = 'AI_DISABLED'
          enriched = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: (enriched as any).skipped || 0 }
        } else if ((enriched as any).reason === 'AI_ISSUE' || (enriched as any).aiIssue) {
          enrichMessage = (enriched as any).message || toAiIssueMessage({ message: String((enriched as any).message || '') })
          enrichReason = 'AI_ISSUE'
          enrichAiIssue = true
          logger.warn(`[Enrich] AI issue custom: ${enrichMessage} (saved ${saved.hackathonSaved + saved.internshipSaved} remains, enriched 0 due to AI)`)
        }
      }
    } catch (enrichOuterErr: any) {
      const aiMsg = detectAiRateLimit(enrichOuterErr)
      if (aiMsg) {
        logger.warn({ err: aiMsg }, '[Enrich] AI check/enrich failed for custom AI rate limit (non-fatal):')
        enriched = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: 0, reason: 'AI_ISSUE', aiIssue: true, message: aiMsg }
        enrichMessage = aiMsg
        enrichReason = 'AI_ISSUE'
        enrichAiIssue = true
      } else {
        logger.warn({ err: enrichOuterErr?.message || enrichOuterErr }, '[Enrich] AI check/enrich failed for custom (non-fatal):', enrichOuterErr?.stack)
        enriched = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: 0 }
        enrichMessage = 'Enrich skipped due to error — saved items remain'
      }
    }
    const finalMessageCustom = enrichMessage || (enrichAiIssue ? enriched.message : undefined)
    const finalReasonCustom = enrichReason || (enriched as any).reason
    res.json({ success: true, fetched: items.length, saved: saved.hackathonSaved + saved.internshipSaved, hackathons: saved.hackathonSaved, internships: saved.internshipSaved, skipped: saved.skipped, enriched: enriched.hackEnriched + enriched.intEnriched, ...(finalMessageCustom ? { message: finalMessageCustom, enrichReason: finalReasonCustom || 'AI_DISABLED', ...(enrichAiIssue || isAiIssueReason(finalReasonCustom) ? { aiIssue: true } : {}) } : {}), ...(enrichAiIssue || finalReasonCustom === 'AI_ISSUE' ? { aiIssue: true } : {}) })
  } catch (error: any) {
    const aiMsg = detectAiRateLimit(error)
    if (aiMsg) {
      logger.warn({ err: aiMsg }, '[Fetch] Fetch custom AI rate limit — returning AI issue not 500:')
      return res.json({ success: true, fetched: 0, saved: 0, hackathons: 0, internships: 0, skipped: 0, enriched: 0, aiIssue: true, message: aiMsg, enrichReason: 'AI_ISSUE' })
    }
    logger.error({ err: error }, 'Fetch custom error:', error?.stack)
    res.status(500).json({ error: 'Failed to fetch custom URLs' })
  }
})

// POST /api/fetch/retry-failed - Re-run only failing sources (DOWN/DEGRADED).
// NOTE: must be registered BEFORE POST /:platform or Express would treat
// "retry-failed" as a platform param. Body: { platforms?: string[], limit?: number }
// (explicit list overrides the failed set; limit 0 = fetcher default).
// F07: same 30/h fetchLimiter as /all + /other/* + /custom.
router.post('/retry-failed', fetchLimiter, async (req, res) => {
  try {
    const admin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' }, select: { id: true, collegeId: true } })
    if (!admin) return res.status(400).json({ error: 'No admin user found' })

    const KNOWN = new Set(listHealthPlatforms())
    let targets: string[]
    const explicit = (req.body as any)?.platforms
    if (Array.isArray(explicit) && explicit.length > 0) {
      if (explicit.length > 20) return res.status(400).json({ error: 'max 20 platforms per retry' })
      targets = [...new Set(explicit.map((p: unknown) => String(p || '').toUpperCase().trim()))].filter((p) => p && KNOWN.has(p))
      if (targets.length === 0) return res.status(400).json({ error: 'No known platforms in request' })
    } else {
      const health = await sourceHealthStore.getAll([...KNOWN])
      targets = selectFailedPlatforms(health as any)
      if (targets.length === 0) {
        return res.json({ success: true, retried: [], saved: 0, fetched: 0, message: 'All sources healthy — nothing to retry' })
      }
    }

    const rawLimit = (req.body as any)?.limit
    const limitNum = rawLimit === undefined || rawLimit === null ? 0 : Number(rawLimit)
    if (isNaN(limitNum) || limitNum < 0 || limitNum > 50) return res.status(400).json({ error: 'Invalid limit (0-50)' })
    const limit = limitNum > 0 ? limitNum : undefined

    logger.info(`[Fetch] Retry-failed: ${targets.join(', ')} (limit: ${limit ?? 'default'})`)
    // Bounded fan-out (p-limit 5, mirrors Fetch All) — one platform failing
    // must not fail the batch.
    const RETRY_CONCURRENCY = 5
    const queue = [...targets]
    const perPlatform: Array<{ platform: string; ok: boolean; fetched: number; error?: string; latencyMs: number }> = []
    const allItems: any[] = []
    async function retryWorker(): Promise<void> {
      while (queue.length > 0) {
        const platform = queue.shift() as string
        const t0 = Date.now()
        try {
          let items: any[]
          if (platform === 'OTHER_HACKATHON') items = await fetchOtherHackathons(limit)
          else if (platform === 'OTHER_INTERNSHIP') items = await fetchOtherInternships(limit)
          else items = (await fetchFromPlatformWithMeta(platform, limit)).items
          const capped = limit && limit > 0 ? items.slice(0, limit) : items
          const latencyMs = Date.now() - t0
          perPlatform.push({ platform, ok: true, fetched: capped.length, latencyMs })
          allItems.push(...capped)
          await recordSourceRun(sourceHealthStore, { platform, ok: true, latencyMs, fetchedCount: capped.length })
        } catch (e: any) {
          const latencyMs = Date.now() - t0
          const msg = String(e?.message || e || 'Fetch failed').slice(0, 500)
          // AI rate-limit is transient, not a source outage — don't mark DOWN.
          if (detectAiRateLimit(e)) {
            logger.warn(`[Fetch] Retry ${platform} hit AI rate limit (not marking source down): ${msg}`)
            perPlatform.push({ platform, ok: false, fetched: 0, error: msg, latencyMs })
          } else {
            perPlatform.push({ platform, ok: false, fetched: 0, error: msg, latencyMs })
            await recordSourceRun(sourceHealthStore, { platform, ok: false, latencyMs, error: msg, fetchedCount: 0 })
          }
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(RETRY_CONCURRENCY, targets.length) }, () => retryWorker()),
    )

    const saved = allItems.length > 0 ? await saveItems(allItems, admin.id, admin.collegeId) : { hackathonSaved: 0, internshipSaved: 0, skipped: 0 }
    const total = saved.hackathonSaved + saved.internshipSaved
    perPlatform.sort((a, b) => a.platform.localeCompare(b.platform))
    logger.info(`[Fetch] Retry-failed done: ${perPlatform.filter((p) => p.ok).length}/${perPlatform.length} ok, saved ${total}`)
    res.json({ success: true, retried: perPlatform, fetched: allItems.length, saved: total, hackathons: saved.hackathonSaved, internships: saved.internshipSaved, skipped: saved.skipped })
  } catch (error: any) {
    const aiMsg = detectAiRateLimit(error)
    if (aiMsg) {
      logger.warn({ err: aiMsg }, '[Fetch] Retry-failed AI rate limit — returning AI issue not 500:')
      return res.json({ success: true, retried: [], fetched: 0, saved: 0, aiIssue: true, message: aiMsg, enrichReason: 'AI_ISSUE' })
    }
    logger.error({ err: error }, 'Retry-failed error:', error?.stack)
    res.status(500).json({ error: 'Failed to retry failed sources' })
  }
})

// POST /api/fetch/:platform - Fetch from specific platform
// Body: { limit?: number } — 0 = all, otherwise max items
// Target-driven: passes limit to fetcher, ensures maxPages cap prevents infinite loop
router.post('/:platform', async (req, res) => {
  try {
    const { platform } = req.params
    // topbottom F10: ghost platform keys rode into the fetcher and threw
    // `Unknown platform` → 500. Fail closed with 400 (registry is the SSOT).
    const knownPlatforms = new Set(listHealthPlatforms().map((p) => String(p).toUpperCase()))
    if (!knownPlatforms.has(String(platform || '').toUpperCase())) {
      res.status(400).json({ error: `Unknown platform: ${platform}` })
      return
    }
    const limit = req.body.limit || 0
    const admin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' }, select: { id: true, collegeId: true } }) // HALF2: narrow (was full row incl. passwordHash; only id/collegeId used)
    if (!admin) return res.status(400).json({ error: 'No admin user found' })

    logger.info(`[Fetch] Fetching from ${platform} (limit: ${limit || 'all'}, target-driven capped at 10 pages)...`)
    // #4 health: timed single-platform fetch; failures recorded even when the
    // handler below returns 500 (unknown platforms are not recorded).
    const platformKey = String(platform || '').toUpperCase()
    const knownSingle = new Set(listHealthPlatforms())
    let result: any[]
    let singleLatency = 0
    try {
      const meta = await fetchFromPlatformWithMeta(platform, limit > 0 ? limit : undefined)
      result = meta.items
      singleLatency = meta.latencyMs
      if (knownSingle.has(platformKey)) {
        await recordSourceRun(sourceHealthStore, { platform: platformKey, ok: true, latencyMs: singleLatency, fetchedCount: result.length })
      }
    } catch (fetchErr: any) {
      const aiMsg = detectAiRateLimit(fetchErr)
      if (knownSingle.has(platformKey) && !aiMsg && !String(fetchErr?.message || '').startsWith('Unknown platform')) {
        await recordSourceRun(sourceHealthStore, {
          platform: platformKey,
          ok: false,
          latencyMs: 0,
          error: String(fetchErr?.message || fetchErr || 'Fetch failed'),
          fetchedCount: 0,
        })
      }
      throw fetchErr
    }

    // Ensure limit respected exactly (fetcher already caps via target loop + dedup + deadline checks)
    const items = limit > 0 ? result.slice(0, limit) : result

    const saved = await saveItems(items, admin.id, admin.collegeId)
    const total = saved.hackathonSaved + saved.internshipSaved
    logger.info(`[Fetch] Saved ${total} items from ${platform}`)

    // Auto-enrich only items from this platform — never fail fetch if enrich throws
    // AI 429: return enriched 0 with aiIssue true — do NOT throw so fetch still returns saved
    let enriched: any = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: 0 }
    let enrichMessage: string | undefined
    let enrichReason: string | undefined
    let enrichAiIssue = false
    try {
      if (!(await isEnrichmentAIEnabled())) {
        logger.warn('[Enrich] GROQ_API_KEY not set — AI disabled, skipping enrichment')
        enrichMessage = 'AI disabled — run with GROQ_API_KEY to enrich'
        enrichReason = 'AI_DISABLED'
      } else {
        try {
          enriched = await enrichAllPending(platform.toUpperCase())
        } catch (enrichErr: any) {
          const aiMsg = detectAiRateLimit(enrichErr)
          if (aiMsg) {
            logger.warn({ err: aiMsg }, `[Enrich] enrichAllPending ${platform} AI rate limit (non-fatal):`)
            enriched = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: 0, reason: 'AI_ISSUE', aiIssue: true, message: aiMsg }
          } else {
            logger.warn({ err: enrichErr?.message || enrichErr }, `[Enrich] enrichAllPending ${platform} failed (non-fatal):`, enrichErr?.stack)
            enriched = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: 0 }
            enrichMessage = 'Enrich skipped due to error — saved items remain'
          }
        }
        if ((enriched as any).reason === 'AI_DISABLED') {
          logger.warn('[Enrich] GROQ_API_KEY not set — AI disabled, skipping enrichment')
          enrichMessage = 'AI disabled — run with GROQ_API_KEY to enrich'
          enrichReason = 'AI_DISABLED'
          enriched = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: (enriched as any).skipped || 0 }
        } else if ((enriched as any).reason === 'AI_ISSUE' || (enriched as any).aiIssue) {
          enrichMessage = (enriched as any).message || toAiIssueMessage({ message: String((enriched as any).message || '') })
          enrichReason = 'AI_ISSUE'
          enrichAiIssue = true
          logger.warn(`[Enrich] AI issue ${platform}: ${enrichMessage} (saved ${total} remains, enriched 0 due to AI)`)
        } else if (!enrichMessage) {
          logger.info(`[Fetch] Auto-enrich done: ${enriched.hackEnriched} hackathons, ${enriched.intEnriched} internships`)
        }
      }
    } catch (enrichOuterErr: any) {
      const aiMsg = detectAiRateLimit(enrichOuterErr)
      if (aiMsg) {
        logger.warn({ err: aiMsg }, `[Enrich] AI check/enrich failed for ${platform} AI rate limit (non-fatal):`)
        enriched = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: 0, reason: 'AI_ISSUE', aiIssue: true, message: aiMsg }
        enrichMessage = aiMsg
        enrichReason = 'AI_ISSUE'
        enrichAiIssue = true
      } else {
        logger.warn({ err: enrichOuterErr?.message || enrichOuterErr }, `[Enrich] AI check/enrich failed for ${platform} (non-fatal):`, enrichOuterErr?.stack)
        enriched = { hackEnriched: 0, intEnriched: 0, enriched: 0, skipped: 0 }
        enrichMessage = 'Enrich skipped due to error — saved items remain'
      }
    }

    const enrichedCountPlatform = enriched.hackEnriched + enriched.intEnriched
    const finalMessagePlatform = enrichMessage || (enrichAiIssue ? enriched.message : undefined)
    const finalReasonPlatform = enrichReason || (enriched as any).reason
    res.json({
      success: true,
      fetched: items.length,
      saved: total,
      hackathons: saved.hackathonSaved,
      internships: saved.internshipSaved,
      skipped: saved.skipped,
      enriched: enrichedCountPlatform,
      ...(finalMessagePlatform ? { message: finalMessagePlatform, enrichReason: finalReasonPlatform || 'AI_DISABLED', ...(enrichAiIssue || isAiIssueReason(finalReasonPlatform) ? { aiIssue: true } : {}) } : {}),
      ...(enrichAiIssue || finalReasonPlatform === 'AI_ISSUE' ? { aiIssue: true } : {}),
    })
  } catch (error: any) {
    const aiMsg = detectAiRateLimit(error)
    if (aiMsg) {
      logger.warn({ err: aiMsg }, `[Fetch] ${req.params.platform} AI rate limit (outer) — returning AI issue not 500:`)
      return res.json({ success: true, fetched: 0, saved: 0, hackathons: 0, internships: 0, skipped: 0, enriched: 0, aiIssue: true, message: aiMsg, enrichReason: 'AI_ISSUE' })
    }
    logger.error({ err: error }, `Fetch ${req.params.platform} error:`, error?.stack)
    res.status(500).json({ error: `Failed to fetch from ${req.params.platform}` })
  }
})

// POST /api/fetch/hackathons/enrich - Enrich pending hackathons
// Query: ?source=devfolio&limit=5 (both optional)
// Skips ended deadlines, prioritizes near-deadline first
// FIX: guard for AI disabled — single warning, no infinite loop
router.post('/hackathons/enrich', async (req, res) => {
  try {
    const { source, limit: limitStr } = req.query
    const limit = limitStr ? parseInt(String(limitStr)) : 0
    const label = source ? `from ${source}` : 'all'
    const today = new Date()
    logger.info(`[Fetch] Enriching pending hackathons (${label}${limit ? `, limit ${limit}` : ''}) — deadline filtered...`)

    if (!(await isEnrichmentAIEnabled())) {
      logger.warn('[Enrich] GROQ_API_KEY not set — AI disabled, skipping enrichment')
      res.json({ success: true, enriched: 0, rejected: 0, skipped: 0, reason: 'AI_DISABLED', message: 'AI disabled — run with GROQ_API_KEY to enrich' })
      return
    }
    
    // Auto-reject ended — wrap to avoid 500 turning success into "Enrich failed" in frontend
    let rejectedCount = 0
    try {
      const rejected = await prisma.hackathonStaging.updateMany({
        where: { deadline: { lt: today }, status: { notIn: ['APPROVED', 'REJECTED'] } },
        data: { status: 'REJECTED' },
      })
      rejectedCount = rejected.count
      if (rejected.count > 0) logger.info(`[Fetch] Auto-rejected ${rejected.count} ended hackathons`)
    } catch (e: any) {
      logger.warn({ err: e?.message || e }, '[Enrich] Auto-reject hackathons failed (non-fatal):')
    }
    
    let enriched = 0
    const BATCH_SIZE = 5
    const seenIds = new Set<string>()
    let noProgressStreak = 0
    while (true) {
      const where: any = {
        OR: [{ description: '' }, { targetDepartments: { equals: [] } }],
        AND: [
          { OR: [{ deadline: null }, { deadline: { gte: today } }] }],
      }
      if (source) where.source = String(source).toUpperCase()
      const take = limit > 0 ? Math.min(BATCH_SIZE, limit - enriched) : BATCH_SIZE
      if (take <= 0) break
      let pending: any[] = []
      try {
        pending = await prisma.hackathonStaging.findMany({
          where,
          orderBy: [{ deadline: 'asc' }, { createdAt: 'desc' }],
          take,
        })
      } catch (e: any) {
        logger.warn({ err: e?.message || e }, '[Enrich] findMany hackathons enrich failed (non-fatal):', e?.stack)
        break
      }
      if (pending.length === 0) break
      const loopIds = pending.map((p: any) => p.id).join(',')
      if (seenIds.has(loopIds)) {
        noProgressStreak++
        if (noProgressStreak >= 1) {
          logger.warn(`[Enrich] Breaking hackathon enrich loop — same ${pending.length} items repeatedly pending (AI not progressing).`)
          break
        }
      } else {
        noProgressStreak = 0
      }
      seenIds.add(loopIds)
      // Detect AI 429 via allSettled — do not count as enriched, forward AI issue to frontend (not Fetch failed)
      let batchRateLimited: string | null = null
      let batchFailed = false
      try {
        const results = await Promise.allSettled(pending.map((h: any) => enrichHackathonStaging(h.id)))
        for (const r of results) {
          if (r.status === 'rejected') {
            const err: any = (r as any).reason
            const aiMsg = detectAiRateLimit(err)
            if (aiMsg) { batchRateLimited = aiMsg; batchFailed = true; break }
            batchFailed = true
          }
        }
      } catch (e: any) {
        const aiMsg = detectAiRateLimit(e)
        if (aiMsg) batchRateLimited = aiMsg
        else logger.warn({ err: e?.message || e }, '[Enrich] enrichHackathonStaging batch failed (non-fatal):')
        batchFailed = true
      }
      if (batchRateLimited) {
        logger.warn(`[Enrich] AI rate limit detected during hackathon enrich — returning AI issue. ${batchRateLimited}`)
        return res.json({ success: true, enriched, rejected: rejectedCount, skipped: pending.length, reason: 'AI_ISSUE', aiIssue: true, message: batchRateLimited })
      }
      if (!batchFailed) {
        enriched += pending.length
      } else {
        logger.warn('[Enrich] hackathon batch had non-AI failure, not counting as enriched, continuing')
      }
    }
    
    res.json({ success: true, enriched, rejected: rejectedCount, message: `Enriched ${enriched}, rejected ${rejectedCount} ended` })
  } catch (error: any) {
    const aiMsg = detectAiRateLimit(error)
    if (aiMsg) {
      logger.warn({ err: aiMsg }, '[Enrich] Enrich hackathons AI rate limit — returning AI issue not generic:')
      return res.json({ success: true, enriched: 0, rejected: 0, skipped: 0, reason: 'AI_ISSUE', aiIssue: true, message: aiMsg })
    }
    logger.error({ err: error }, 'Enrich hackathons error:', error?.stack)
    // Return success with 0 enriched instead of 500 to avoid frontend "Enrich failed" when backend actually enriched (high vs medium is not an error)
    res.json({ success: true, enriched: 0, rejected: 0, message: 'Enrich completed with warnings' })
  }
})

// POST /api/fetch/internships/enrich - Enrich pending internships
// Query: ?source=devfolio&limit=5 (both optional)
// Skips ended deadlines, prioritizes near-deadline first
// FIX: guard for AI disabled — single warning, no infinite loop
router.post('/internships/enrich', async (req, res) => {
  try {
    const { source, limit: limitStr } = req.query
    const limit = limitStr ? parseInt(String(limitStr)) : 0
    const label = source ? `from ${source}` : 'all'
    const today = new Date()
    logger.info(`[Fetch] Enriching pending internships (${label}${limit ? `, limit ${limit}` : ''}) — deadline filtered...`)

    if (!(await isEnrichmentAIEnabled())) {
      logger.warn('[Enrich] GROQ_API_KEY not set — AI disabled, skipping enrichment')
      res.json({ success: true, enriched: 0, rejected: 0, skipped: 0, reason: 'AI_DISABLED', message: 'AI disabled — run with GROQ_API_KEY to enrich' })
      return
    }
    
    // Auto-reject ended — wrap to avoid 500
    let rejectedCount = 0
    try {
      const rejected = await prisma.internshipStaging.updateMany({
        where: { deadline: { lt: today.toISOString().slice(0, 10) }, status: { notIn: ['APPROVED', 'REJECTED'] } },
        data: { status: 'REJECTED' },
      })
      rejectedCount = rejected.count
      if (rejected.count > 0) logger.info(`[Fetch] Auto-rejected ${rejected.count} ended internships`)
    } catch (e: any) {
      logger.warn({ err: e?.message || e }, '[Enrich] Auto-reject internships failed (non-fatal):')
    }
    
    let enriched = 0
    const BATCH_SIZE = 5
    const seenIds = new Set<string>()
    let noProgressStreak = 0
    while (true) {
      const where: any = {
        OR: [{ description: '' }, { targetDepartments: { equals: [] } }],
        AND: [
          { OR: [{ deadline: null }, { deadline: { gte: today.toISOString().slice(0, 10) } }] }],
      }
      if (source) where.source = String(source).toUpperCase()
      const take = limit > 0 ? Math.min(BATCH_SIZE, limit - enriched) : BATCH_SIZE
      if (take <= 0) break
      let pending: any[] = []
      try {
        pending = await prisma.internshipStaging.findMany({
          where,
          orderBy: [{ deadline: 'asc' }, { createdAt: 'desc' }],
          take,
        })
      } catch (e: any) {
        logger.warn({ err: e?.message || e }, '[Enrich] findMany internships enrich failed (non-fatal):', e?.stack)
        break
      }
      if (pending.length === 0) break
      const loopIds = pending.map((p: any) => p.id).join(',')
      if (seenIds.has(loopIds)) {
        noProgressStreak++
        if (noProgressStreak >= 1) {
          logger.warn(`[Enrich] Breaking internship enrich loop — same ${pending.length} items repeatedly pending (AI not progressing).`)
          break
        }
      } else {
        noProgressStreak = 0
      }
      seenIds.add(loopIds)
      // Detect AI 429 via allSettled — do not count as enriched, forward AI issue to frontend
      let batchRateLimitedInt: string | null = null
      let batchFailedInt = false
      try {
        const results = await Promise.allSettled(pending.map((i: any) => enrichInternshipStaging(i.id)))
        for (const r of results) {
          if (r.status === 'rejected') {
            const err: any = (r as any).reason
            const aiMsg = detectAiRateLimit(err)
            if (aiMsg) { batchRateLimitedInt = aiMsg; batchFailedInt = true; break }
            batchFailedInt = true
          }
        }
      } catch (e: any) {
        const aiMsg = detectAiRateLimit(e)
        if (aiMsg) batchRateLimitedInt = aiMsg
        else logger.warn({ err: e?.message || e }, '[Enrich] enrichInternshipStaging batch failed (non-fatal):')
        batchFailedInt = true
      }
      if (batchRateLimitedInt) {
        logger.warn(`[Enrich] AI rate limit detected during internship enrich — returning AI issue. ${batchRateLimitedInt}`)
        return res.json({ success: true, enriched, rejected: rejectedCount, skipped: pending.length, reason: 'AI_ISSUE', aiIssue: true, message: batchRateLimitedInt })
      }
      if (!batchFailedInt) {
        enriched += pending.length
      } else {
        logger.warn('[Enrich] internship batch had non-AI failure, not counting as enriched, continuing')
      }
    }
     
    res.json({ success: true, enriched, rejected: rejectedCount, message: `Enriched ${enriched}, rejected ${rejectedCount} ended` })
  } catch (error: any) {
    const aiMsg = detectAiRateLimit(error)
    if (aiMsg) {
      logger.warn({ err: aiMsg }, '[Enrich] Enrich internships AI rate limit — returning AI issue not generic:')
      return res.json({ success: true, enriched: 0, rejected: 0, skipped: 0, reason: 'AI_ISSUE', aiIssue: true, message: aiMsg })
    }
    logger.error({ err: error }, 'Enrich internships error:', error?.stack)
    res.json({ success: true, enriched: 0, rejected: 0, message: 'Enrich completed with warnings' })
  }
})

// GET /api/fetch/:platform/hackathons - Get hackathons from platform
router.get('/:platform/hackathons', async (req, res) => {
  try {
    const { platform } = req.params
    const items = await prisma.hackathonStaging.findMany({
      where: { source: platform.toUpperCase() },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    res.json({ items, count: items.length })
  } catch (error) {
    logger.error({ err: error }, `Get ${req.params.platform} hackathons error:`)
    res.status(500).json({ error: 'Failed to fetch items' })
  }
})

// GET /api/fetch/:platform/internships - Get internships from platform
router.get('/:platform/internships', async (req, res) => {
  try {
    const { platform } = req.params
    const items = await prisma.internshipStaging.findMany({
      where: { source: platform.toUpperCase() },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    res.json({ items, count: items.length })
  } catch (error) {
    logger.error({ err: error }, `Get ${req.params.platform} internships error:`)
    res.status(500).json({ error: 'Failed to fetch items' })
  }
})

// PUT /api/fetch/:platform/limit - Update platform fetch limit + enabled (Fetch All tick/target persisted via PlatformSettings, respected by cron)
router.put('/:platform/limit', async (req, res) => {
  try {
    const { platform } = req.params
    const { limit, type, enabled } = req.body as { limit?: number; type?: string; enabled?: boolean }
    
    if (!type) {
      res.status(400).json({ error: 'type is required (HACKATHON or INTERNSHIP)' })
      return
    }
    if (limit === undefined && enabled === undefined) {
      res.status(400).json({ error: 'limit or enabled is required' })
      return
    }
    const normalizedType = String(type).toUpperCase()
    if (!['HACKATHON', 'INTERNSHIP'].includes(normalizedType)) {
      res.status(400).json({ error: 'type must be HACKATHON or INTERNSHIP' })
      return
    }
    if (limit !== undefined) {
      const n = Number(limit)
      if (!Number.isInteger(n) || n < 0 || n > 50) {
        res.status(400).json({ error: 'limit must be integer 0-50 (0 = All)' })
        return
      }
    }
    if (enabled !== undefined && typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be boolean' })
      return
    }

    const updateData: Record<string, unknown> = {}
    const createData: Record<string, unknown> = { platform: platform.toUpperCase(), type: normalizedType }
    if (limit !== undefined) {
      updateData.fetchLimit = Number(limit)
      createData.fetchLimit = Number(limit)
    }
    if (enabled !== undefined) {
      updateData.enabled = enabled
      createData.enabled = enabled
    }

    const settings = await prisma.platformSettings.upsert({
      where: {
        platform_type: { platform: platform.toUpperCase(), type: normalizedType }
      },
      update: updateData,
      create: createData as any,
    })
    // PERF: explicit write → drop the 60s settings cache (TTL is the backstop).
    await invalidatePlatformSettingsCache()

    res.json({ success: true, settings })
  } catch (error) {
    logger.error({ err: error }, 'Update limit error:')
    res.status(500).json({ error: 'Failed to update limit' })
  }
})

// PUT /api/fetch/settings - Bulk save Fetch All enabled/target (operational mode build: tick + target saved to DB, cron respects it)
router.put('/settings', async (req, res) => {
  try {
    const { settings } = req.body as { settings?: Array<{ platform: string; type: string; fetchLimit?: number; enabled?: boolean }> }
    if (!Array.isArray(settings) || settings.length === 0) {
      res.status(400).json({ error: 'settings array required' })
      return
    }
    if (settings.length > 20) {
      res.status(400).json({ error: 'max 20 settings per request' })
      return
    }
    // HALF2: parallel upserts (was N+1 sequential awaits in loop; max 20, order preserved via index)
    const pendingUpserts: Array<{ index: number; platform: string; type: string; data: Record<string, unknown> }> = []
    settings.forEach((s, index) => {
      const platform = String(s.platform || '').toUpperCase().trim()
      const type = String(s.type || '').toUpperCase().trim()
      if (!platform || !['HACKATHON', 'INTERNSHIP'].includes(type)) return
      const data: Record<string, unknown> = {}
      if (s.fetchLimit !== undefined) {
        const n = Number(s.fetchLimit)
        if (!Number.isInteger(n) || n < 0 || n > 50) return
        data.fetchLimit = n
      }
      if (s.enabled !== undefined) data.enabled = !!s.enabled
      if (Object.keys(data).length === 0) return
      pendingUpserts.push({ index, platform, type, data })
    })
    const settled = await Promise.all(
      pendingUpserts.map((u) =>
        prisma.platformSettings.upsert({
          where: { platform_type: { platform: u.platform, type: u.type } },
          update: u.data,
          create: { platform: u.platform, type: u.type, ...u.data } as any,
        })
      )
    )
    const results: unknown[] = settled
    // PERF: explicit write → drop the 60s settings cache (TTL is the backstop).
    await invalidatePlatformSettingsCache()
    res.json({ success: true, settings: results })
  } catch (error) {
    logger.error({ err: error }, 'Bulk update settings error:')
    res.status(500).json({ error: 'Failed to bulk update settings' })
  }
})

// GET /api/fetch/settings/all - Get all platform settings
// PERF: 60s shared cache — 10 PlatformCards mount-fetch this per FetchPage visit.
router.get('/settings/all', async (req, res) => {
  try {
    const settings = await getCachedPlatformSettings()
    res.json({ settings })
  } catch (error) {
    logger.error({ err: error }, 'Get settings error:')
    res.status(500).json({ error: 'Failed to get settings' })
  }
})

// ─── Unified fetch config (master auto-fetch toggle + per-platform targets) ───
// SUPER_ADMIN only (router-level authorize). Single round-trip for FetchPage:
// master switch (DB-backed, no redeploy) + per-platform {enabled, fetchLimit}.
// Manual POST /fetch/* endpoints intentionally IGNORE autoFetchEnabled —
// explicit user action is always allowed; only cron consults the flag.
export interface FetchConfigPlatform {
  platform: string
  type: string
  enabled: boolean
  fetchLimit: number
}

async function readFetchConfigPlatforms(): Promise<FetchConfigPlatform[]> {
  // SSOT: registry owns platform keys + types (1-file adds). DB rows overlay.
  const ALL_PLATFORMS = listFetchAllPlatforms()
  const PLATFORM_TYPE: Record<string, string> = platformTypeMap() as Record<string, string>
  // PERF: 60s shared cache (was uncached findMany per GET /config + PUT /config read-back).
  let dbSettings: Array<{ platform: string; type: string; enabled?: boolean; fetchLimit?: number }> = []
  try {
    dbSettings = await getCachedPlatformSettings() as Array<{ platform: string; type: string; enabled?: boolean; fetchLimit?: number }>
  } catch (e: unknown) {
    logger.warn({ err: (e as Error)?.message || e }, '[Fetch] config platform read failed, using defaults:')
  }
  return ALL_PLATFORMS.map((p) => {
    const type = PLATFORM_TYPE[p]
    const s = dbSettings.find((x) => x.platform === p && x.type === type)
    return {
      platform: p,
      type,
      enabled: s?.enabled !== false,
      fetchLimit: typeof s?.fetchLimit === 'number' ? s.fetchLimit : 10,
    }
  })
}

// GET /api/fetch/config - Master toggle state + per-platform targets.
router.get('/config', async (_req, res) => {
  try {
    const [state, platforms] = await Promise.all([getAutoFetchState(), readFetchConfigPlatforms()])
    res.json({ ...state, platforms })
  } catch (error) {
    logger.error({ err: error }, 'Get fetch config error:')
    res.status(500).json({ error: 'Failed to get fetch config' })
  }
})

// PUT /api/fetch/config - Save master toggle and/or per-platform targets.
// Body: { autoFetchEnabled?: boolean, platforms?: Array<{ platform, type, enabled?, fetchLimit? }> }
// NOTE: when AUTO_FETCH_ENABLED env is explicitly set it keeps overriding cron
// at runtime (ops kill-switch); the DB value is still persisted for when env is unset.
router.put('/config', async (req, res) => {
  try {
    const { autoFetchEnabled, platforms } = req.body as {
      autoFetchEnabled?: unknown
      platforms?: unknown
    }
    if (autoFetchEnabled === undefined && platforms === undefined) {
      res.status(400).json({ error: 'autoFetchEnabled or platforms is required' })
      return
    }
    if (autoFetchEnabled !== undefined && typeof autoFetchEnabled !== 'boolean') {
      res.status(400).json({ error: 'autoFetchEnabled must be boolean' })
      return
    }

    let platformRows: FetchConfigPlatform[] | undefined
    if (platforms !== undefined) {
      if (!Array.isArray(platforms) || platforms.length === 0) {
        res.status(400).json({ error: 'platforms must be a non-empty array' })
        return
      }
      if (platforms.length > 20) {
        res.status(400).json({ error: 'max 20 platforms per request' })
        return
      }
      const KNOWN = new Set(listHealthPlatforms().map((p) => String(p).toUpperCase()))
      const seen = new Set<string>()
      const validated: Array<{ platform: string; type: string; data: Record<string, unknown> }> = []
      for (const entry of platforms) {
        const e = entry as Record<string, unknown>
        const platform = String(e?.platform || '').toUpperCase().trim()
        const type = String(e?.type || '').toUpperCase().trim()
        if (!platform || !KNOWN.has(platform)) {
          res.status(400).json({ error: `Unknown platform: ${String((e as Record<string, unknown>)?.platform || '')}` })
          return
        }
        if (!['HACKATHON', 'INTERNSHIP'].includes(type)) {
          res.status(400).json({ error: `type must be HACKATHON or INTERNSHIP (${platform})` })
          return
        }
        const data: Record<string, unknown> = {}
        if (e?.enabled !== undefined) {
          if (typeof e.enabled !== 'boolean') {
            res.status(400).json({ error: `enabled must be boolean (${platform})` })
            return
          }
          data.enabled = e.enabled
        }
        if (e?.fetchLimit !== undefined) {
          const n = Number(e.fetchLimit)
          if (!Number.isInteger(n) || n < 0 || n > 50) {
            res.status(400).json({ error: `fetchLimit must be integer 0-50 (0 = All) (${platform})` })
            return
          }
          data.fetchLimit = n
        }
        if (Object.keys(data).length === 0) {
          res.status(400).json({ error: `enabled or fetchLimit is required (${platform})` })
          return
        }
        const dupKey = `${platform}|${type}`
        if (seen.has(dupKey)) {
          res.status(400).json({ error: `duplicate platform entry: ${platform} ${type}` })
          return
        }
        seen.add(dupKey)
        validated.push({ platform, type, data })
      }
      await Promise.all(
        validated.map((v) =>
          prisma.platformSettings.upsert({
            where: { platform_type: { platform: v.platform, type: v.type } },
            update: v.data,
            create: { platform: v.platform, type: v.type, ...v.data } as any,
          }),
        ),
      )
      // PERF: explicit write → drop the 60s settings cache BEFORE the read-back
      // so the response (and the next GET /config) reflects the save.
      await invalidatePlatformSettingsCache()
      platformRows = await readFetchConfigPlatforms()
    }

    let state = await getAutoFetchState()
    if (autoFetchEnabled !== undefined) {
      try {
        await setAutoFetchEnabled(autoFetchEnabled)
      } catch (e: unknown) {
        logger.error({ err: e }, 'Set auto-fetch flag error:')
        res.status(500).json({ error: 'Failed to save auto-fetch toggle (migration pending?)' })
        return
      }
      state = await getAutoFetchState()
    }
    res.json({ ...state, platforms: platformRows ?? (await readFetchConfigPlatforms()) })
  } catch (error) {
    logger.error({ err: error }, 'Update fetch config error:')
    res.status(500).json({ error: 'Failed to update fetch config' })
  }
})

export default router
