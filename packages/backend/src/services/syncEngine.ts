// packages/backend/src/services/syncEngine.ts
import prisma from '../config/db'
import { Platform } from '@prisma/client'
import { toApiPlatform, tryToPlatformEnum } from '../lib/platform'
import { fetchAllPlatforms } from './platformFetchers'
import { fetchAllPlatformStats } from './platformStats'
import {
  fetchCodingDailyForProfile,
  fetchGithubDailyBestEffort,
  saveCodingActivity,
  ACTIVITY_WINDOW_DAYS,
} from './codingActivity'
import { tryAcquireProfileSyncLock } from './syncLock'
import { logger } from '../utils/logger'
import {
  getSyncWatermark,
  setSyncWatermark,
  handlesFingerprint,
  hasValidStats,
  statsPayloadHash,
  shouldSkipProfileSync,
} from './syncWatermark'

// Normalize a string for fuzzy matching: lowercase, strip non-alphanumeric, collapse spaces
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
}

// Platform enum boundary (Order 4): fetchers emit lowercase ("codechef") but
// ContestParticipation.platform / CodingContest.platform are native PG enums
// (UPPERCASE). ALL normalization goes through tryToPlatformEnum() (single
// choke point, validated against the REAL Prisma enum). Never cast strings
// with `as any` — runtime rejects unknown enum values.
type ContestCache = Map<string, Array<{ id: string; title: string; url: string }>>

async function preloadContestCandidates(platforms: string[], cache: ContestCache): Promise<void> {
  const normalized: Platform[] = []
  for (const p of platforms) {
    const e = tryToPlatformEnum(p)
    if (!e) {
      logger.warn(`[sync] skipping unknown platform "${String(p)}" in preload (not a Platform enum member)`)
      continue
    }
    if (!cache.has(e) && !normalized.includes(e)) normalized.push(e)
  }
  const distinct = normalized.filter(p => !cache.has(p))
  if (distinct.length === 0) return
  await Promise.all(distinct.map(async (dbPlatform) => {
    try {
      const candidates = await prisma.codingContest.findMany({
        where: { platform: dbPlatform },
        select: { id: true, title: true, url: true },
      })
      cache.set(dbPlatform, candidates)
    } catch (e) {
      logger.warn(`preloadContestCandidates failed for ${dbPlatform}:`, (e as any)?.message || e)
      cache.set(dbPlatform, [])
    }
  }))
}

// Match a participation to a CodingContest by platform + title or URL
async function findMatchingContest(platform: string, contestName: string, contestUrl: string | null, cache: ContestCache): Promise<string | null> {
  const dbPlatform = tryToPlatformEnum(platform)
  if (!dbPlatform) {
    logger.warn(`[sync] skipping unknown platform "${String(platform)}" in findMatchingContest`)
    return null
  }
  const normalized = normalize(contestName)

  let candidates = cache.get(dbPlatform)
  if (!candidates) {
    try {
      candidates = await prisma.codingContest.findMany({
        where: { platform: dbPlatform },
        select: { id: true, title: true, url: true },
      })
      cache.set(dbPlatform, candidates)
    } catch {
      return null
    }
  }

  // Prioritize exact URL match first (most reliable), then exact title, then fuzzy
  if (contestUrl) {
    const normUrl = (u: string) => u.replace(/\/+$/, '').toLowerCase()
    const cu = normUrl(contestUrl)
    for (const c of candidates) if (c.url && normUrl(c.url) === cu) return c.id
  }
  for (const c of candidates) {
    if (normalize(c.title) === normalized) return c.id
  }
  for (const c of candidates) {
    const ct = normalize(c.title)
    if (ct.includes(normalized) || normalized.includes(ct)) return c.id
  }

  return null
}

// Helper: run tasks with bounded concurrency via batched Promise.allSettled
async function batchedAllSettled<T>(tasks: Array<() => Promise<T>>, batchSize: number): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = []
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize).map(fn => fn())
    const settled = await Promise.allSettled(batch)
    results.push(...settled)
  }
  return results
}

// --- Defensive: pre-migration / stale-client tolerance ----------------------
// Production incident: migration 20260910000000_sync_upgrades had not been
// applied to the live DB, so every `lastSyncError` write threw
// PrismaClientValidationError ("Unknown argument `lastSyncError`") and even
// the error-recording fallback crashed the same way — fetch worked but stats
// never saved. These helpers make a missing column/table NEVER break stats
// saving again: try the full write, and on missing-column/table error retry
// stripped (stats + timestamp still save; error detail is warn-once logged).
let warnedMissingSyncColumn = false

function warnOnceMissingSyncColumn(err: unknown): void {
  if (warnedMissingSyncColumn) return
  warnedMissingSyncColumn = true
  logger.warn(
    { err: (err as any)?.message || err },
    '[sync] CodingProfile.lastSyncError / SyncThrottle unavailable (migration 20260910000000_sync_upgrades not applied or stale client?) — saving stats without error field'
  )
}

/** Test-only: reset warn-once flag. */
export function __resetSyncMissingColumnForTests(): void {
  warnedMissingSyncColumn = false
}

/** True when the DB/client predates the sync_upgrades migration. */
export function isMissingSyncColumnError(err: any): boolean {
  if (!err) return false
  // P2022: column does not exist. P2021: table/view does not exist.
  if (err.code === 'P2021' || err.code === 'P2022') return true
  const msg = String(err?.message || err)
  return /unknown argument.*lastsyncerror|lastsyncerror.*(unknown|does not exist)|relation "?syncthrottle"? does not exist|syncthrottle.*(unknown|does not exist)/i.test(msg)
}

/**
 * Save the final sync result. Tries the full write (stats + timestamp +
 * lastSyncError); if the DB/client predates the sync_upgrades migration,
 * retries WITHOUT lastSyncError so stats + lastSyncedAt still save.
 * Non-migration errors rethrow (caller logs + records them as before).
 */
async function saveSyncResult(
  userId: string,
  data: { platformStats: unknown; lastSyncedAt?: Date; lastSyncError: string | null }
): Promise<void> {
  const { platformStats, lastSyncedAt, lastSyncError } = data
  const full: any = { platformStats, lastSyncError }
  if (lastSyncedAt) full.lastSyncedAt = lastSyncedAt
  try {
    await (prisma as any).codingProfile.update({ where: { userId }, data: full })
    return
  } catch (err) {
    if (!isMissingSyncColumnError(err)) throw err
    warnOnceMissingSyncColumn(err)
    const stripped: any = { platformStats }
    if (lastSyncedAt) stripped.lastSyncedAt = lastSyncedAt
    await (prisma as any).codingProfile.update({ where: { userId }, data: stripped })
  }
}

/**
 * Best-effort error recording: never throws. Pre-migration (or stale client)
 * degrades to warn-once; other failures keep an error log for visibility.
 */
async function recordSyncErrorBestEffort(userId: string, message: unknown): Promise<void> {
  try {
    await (prisma as any).codingProfile.update({
      where: { userId },
      data: { lastSyncError: String(message ?? 'sync failed').slice(0, 500) },
    })
  } catch (err) {
    if (isMissingSyncColumnError(err)) warnOnceMissingSyncColumn(err)
    else logger.error({ err }, 'Saving lastSyncError failed')
  }
}

export async function syncUserContests(
  userId: string,
  opts?: { profile?: any; useWatermark?: boolean },
): Promise<{ synced: number; platforms: string[] }> {
  // Throttle-collapse: reuse preloaded profile when caller already fetched it
  // (POST /sync + syncAllUsers) to avoid a 2nd findUnique per sync.
  // BEFORE: route findUnique + throttle findUnique + engine findUnique = 3 reads.
  // AFTER: route/syncAll pass profile → engine skips fetch (2 reads).
  const profile = opts && 'profile' in opts && opts.profile !== undefined
    ? opts.profile
    : await prisma.codingProfile.findUnique({ where: { userId } })
  if (!profile) return { synced: 0, platforms: [] }
  // P1-2 watermark incremental (cron path ONLY — manual POST /sync always
  // runs full on explicit user demand so "Sync now" freshness is on demand;
  // syncAllUsers passes useWatermark:true for the scheduled 60k/day volume).
  // HIT (same handles + prior valid + <6h) skips ALL externals below and
  // returns the no-profile-identical shape (existing toEqual contracts hold).
  // MISS/corrupt/error → full sync (old behavior, fail-open).
  const useWatermark = !!(opts && (opts as { useWatermark?: boolean }).useWatermark === true)
  if (useWatermark) {
    try {
      const wm = await getSyncWatermark(userId)
      if (shouldSkipProfileSync(profile, wm, Date.now())) {
        logger.info(`[sync] watermark HIT for ${userId} — skipping externals (handles unchanged, valid <6h)`)
        return { synced: 0, platforms: [] }
      }
    } catch {}
  }
  // Per-run cache isolates concurrent syncs for different users
  const contestCandidateCache: ContestCache = new Map()

  try {
  // === SPEED: kick off both network-bound fetches in parallel ===
  // Contest history and platform stats are independent (both only need handles).
  // Previously stats were fetched *after* all upserts (sequential 8s + 8s = 16s worst).
  // Now they overlap — total ~ max(8s, upsert) ≈ 8s, saving ~8s per sync.
  const contestsPromise = fetchAllPlatforms(profile)
  const statsPromise = fetchAllPlatformStats(profile).catch((e) => {
    logger.error('Platform stats fetch error (early):', e)
    return [] as any[]
  })
  // Unified heatmap: per-day coding activity (LC submissionCalendar + CF
  // accepted/day) starts in-flight alongside contests+stats so its network
  // overlaps the batched DB writes below. Best-effort: any failure yields {}
  // and never fails the sync (see codingActivity.ts source assessment).
  const codingDailyPromise: Promise<Record<string, Record<string, number>>> =
    fetchCodingDailyForProfile(profile).catch(() => ({ leetcode: {}, codeforces: {}, github: {} }))
  // GitHub contributions (public page, no token, 10min cache) — best-effort,
  // cached, never fails sync. Fetched live here so the heatmap has fresh git
  // days even before the next sync; ALSO snapshotted to CodingActivity below.
  const githubDailyPromise: Promise<Array<{ date: string; count: number }>> =
    (profile as any)?.githubUsername
      ? fetchGithubDailyBestEffort((profile as any).githubUsername, ACTIVITY_WINDOW_DAYS).catch(() => [])
      : Promise.resolve([])

  const results = await contestsPromise
  // Dedupe by NORMALIZED (enum) platform+contestName to avoid upsert churn.
  // Fetchers emit lowercase ("codechef") — normalize at the boundary so the
  // dedupe key, preload, findMany/createMany/update all share UPPERCASE enum
  // values. Unknown platforms are skipped (warn) — one bad fetcher never
  // aborts the whole sync. `platforms` return stays lowercase (API stable).
  const seenKeys = new Set<string>()
  const deduped: typeof results = []
  const platforms = new Set<string>()
  for (const r of results) {
    const enumPlatform = tryToPlatformEnum((r as any).platform)
    if (!enumPlatform) {
      logger.warn(`[sync] skipping unknown platform "${String((r as any).platform)}" for contest "${String((r as any).contestName || '').slice(0, 80)}"`)
      continue
    }
    const sanitizedName = String(r.contestName || '').trim().slice(0, 300) || 'Unnamed Contest'
    const dedupeKey = `${enumPlatform}|${sanitizedName.toLowerCase()}`
    if (seenKeys.has(dedupeKey)) continue
    seenKeys.add(dedupeKey)
    // store sanitized name + normalized enum for later to avoid recomputing
    ;(r as any).__sanitizedName = sanitizedName
    ;(r as any).__enumPlatform = enumPlatform
    deduped.push(r)
    platforms.add(toApiPlatform(enumPlatform))
  }

  // Preload contest candidates for all distinct platforms in parallel (reduces sequential N+1)
  if (deduped.length > 0) {
    const enumPlatforms = [...new Set(deduped.map((r) => (r as any).__enumPlatform as Platform))]
    await preloadContestCandidates(enumPlatforms, contestCandidateCache)
  }

  // === SPEED: batched persistence (DB write N+1 fix, ranked cause #2) ===
  // BEFORE: N per-row upserts (N round-trips; N=30 → 30 writes + preload + profile + save ≈ 33).
  // AFTER: 1 findMany existing + 1 createMany new + M updates (M = changed only,
  // typically 0-2) + 1 saveSyncResult = 4-5 round-trips. Unchanged rows skip
  // writes entirely (no syncedAt churn) but still count as synced to preserve
  // totalFailure semantics. One failure never aborts others (parity with
  // per-row try/catch). contestId resolution stays in-memory via preload cache.
  const UPDATE_BATCH = 10
  type PreparedParticipation = {
    platform: Platform
    contestName: string
    contestUrl: string | null
    rank: number | null
    score: number | null
    rating: number | null
    ratingChange: any
    participatedAt: any
    contestId: string | null
  }
  const prepared: PreparedParticipation[] = []
  for (const r of deduped) {
    const enumPlatform = (r as any).__enumPlatform as Platform
    const sanitizedName = (r as any).__sanitizedName as string || String(r.contestName || '').trim().slice(0, 300) || 'Unnamed Contest'
    const sanitizedUrl = r.contestUrl ? String(r.contestUrl).trim().slice(0, 500) : null
    const hasValidRank = Number.isInteger(r.rank) && (r.rank as number) > 0 && (r.rank as number) < 1_000_000 ? r.rank : null
    const hasValidRating = typeof r.rating === 'number' && Number.isFinite(r.rating) && r.rating >= 0 && r.rating < 10000 ? Math.round(r.rating) : null
    // Normalize score to valid Int — invalid values must be nulled, not passed through to Prisma
    const hasValidScore = typeof r.score === 'number' && Number.isFinite(r.score) && r.score >= 0 && r.score < 1_000_000 ? Math.round(r.score) : null
    const contestId = await findMatchingContest(enumPlatform, sanitizedName, sanitizedUrl, contestCandidateCache)
    prepared.push({
      platform: enumPlatform,
      contestName: sanitizedName,
      contestUrl: sanitizedUrl,
      rank: hasValidRank,
      score: hasValidScore,
      rating: hasValidRating,
      ratingChange: r.ratingChange,
      participatedAt: r.participatedAt,
      contestId,
    })
  }

  function sameParticipatedAt(a: any, b: any): boolean {
    if (a == null && b == null) return true
    if (a == null || b == null) return false
    const ta = a instanceof Date ? a.getTime() : new Date(a).getTime()
    const tb = b instanceof Date ? b.getTime() : new Date(b).getTime()
    if (Number.isNaN(ta) && Number.isNaN(tb)) return true
    return ta === tb
  }

  let synced = 0
  const totalWork = prepared.length
  if (totalWork > 0) {
    // Single prefetch for existing rows (title|source pattern like save.ts).
    // Both sides are UPPERCASE enums now (prepared normalized above, DB is
    // enum) so keys match — previously lowercase-vs-UPPERCASE never matched.
    const existingByKey = new Map<string, any>()
    try {
      const platformsIn: Platform[] = [...new Set(prepared.map((p) => p.platform))]
      const namesIn = [...new Set(prepared.map((p) => p.contestName))]
      const existing = await prisma.contestParticipation.findMany({
        where: { userId, platform: { in: platformsIn }, contestName: { in: namesIn } },
        select: {
          platform: true,
          contestName: true,
          rank: true,
          score: true,
          rating: true,
          ratingChange: true,
          contestUrl: true,
          participatedAt: true,
          contestId: true,
        },
      })
      for (const e of existing) existingByKey.set(`${e.platform}|${e.contestName}`, e)
    } catch (err) {
      logger.warn({ err: (err as any)?.message || err }, '[sync] existing-participations prefetch failed, treating all as new')
    }

    const toCreate: Array<PreparedParticipation & { userId: string }> = []
    const toUpdate: PreparedParticipation[] = []
    let unchangedCount = 0
    for (const p of prepared) {
      const ex = existingByKey.get(`${p.platform}|${p.contestName}`)
      if (!ex) {
        toCreate.push({ userId, ...p })
        continue
      }
      const same =
        (ex.rank ?? null) === (p.rank ?? null) &&
        (ex.score ?? null) === (p.score ?? null) &&
        (ex.rating ?? null) === (p.rating ?? null) &&
        (ex.ratingChange ?? null) === (p.ratingChange ?? null) &&
        (ex.contestUrl ?? null) === (p.contestUrl ?? null) &&
        (ex.contestId ?? null) === (p.contestId ?? null) &&
        sameParticipatedAt(ex.participatedAt, p.participatedAt)
      if (same) unchangedCount++
      else toUpdate.push(p)
    }

    let createdOk = 0
    if (toCreate.length > 0) {
      try {
        // Order 4: platform is the native Platform enum (normalized above) —
        // no cast. Prisma validates at runtime; unknown values were skipped
        // during dedupe so this only throws on real DB errors.
        await prisma.contestParticipation.createMany({ data: toCreate, skipDuplicates: true })
        // createMany count excludes skipDuplicates races; count attempted as
        // synced (rows exist either way) to preserve per-row upsert semantics.
        createdOk = toCreate.length
      } catch (err) {
        logger.error({ err }, `Sync createMany failed for ${toCreate.length} new participations`)
        createdOk = 0
      }
    }

    let updatedOk = 0
    if (toUpdate.length > 0) {
      const updateTasks = toUpdate.map((p) => async () => {
        try {
          await prisma.contestParticipation.update({
            where: {
              userId_platform_contestName: {
                userId,
                platform: p.platform,
                contestName: p.contestName,
              },
            },
            data: {
              rank: p.rank,
              score: p.score,
              rating: p.rating,
              ratingChange: p.ratingChange,
              contestUrl: p.contestUrl,
              participatedAt: p.participatedAt,
              contestId: p.contestId,
              syncedAt: new Date(),
            },
          })
          return true
        } catch (err) {
          logger.error({ err }, `Sync error for ${p.platform}/${p.contestName}`)
          return false
        }
      })
      const settled = await batchedAllSettled(updateTasks, UPDATE_BATCH)
      updatedOk = settled.filter((r) => r.status === 'fulfilled' && r.value === true).length
    }

    synced = createdOk + updatedOk + unchangedCount
  }

  // Run stats fetch in parallel where possible — statsPromise already in-flight.
  // Batched writes above overlapped with stats network fetch (both started early).

  // Unified heatmap snapshot (best-effort, never fails sync): await the
  // in-flight coding-daily + github-daily fetches, merge github days into the
  // 'github' source, and batched-write the trailing window. Any throw or a
  // pre-migration DB degrades to a warn-once skip (saveCodingActivity never
  // throws). CodeChef/HackerRank/GFG have no daily API — honestly omitted.
  try {
    const [codingBySource, githubDays] = await Promise.all([codingDailyPromise, githubDailyPromise])
    const bySource: Record<string, Record<string, number>> = {
      leetcode: codingBySource?.leetcode ?? {},
      codeforces: codingBySource?.codeforces ?? {},
      github: {},
    }
    if (Array.isArray(githubDays)) {
      for (const d of githubDays) {
        if (!d || !/^\d{4}-\d{2}-\d{2}$/.test((d as any).date)) continue
        const n = Math.floor(Number((d as any).count))
        if (!Number.isFinite(n) || n <= 0) continue
        bySource.github[(d as any).date] = n
      }
    }
    if (
      Object.keys(bySource.leetcode).length > 0 ||
      Object.keys(bySource.codeforces).length > 0 ||
      Object.keys(bySource.github).length > 0
    ) {
      await saveCodingActivity(userId, bySource as any)
    }
  } catch (err) {
    logger.warn({ err: (err as any)?.message || err }, '[sync] daily-activity snapshot skipped (best-effort)')
  }

  // Await stats that have been fetching in parallel since the start (likely already resolved)
  let stats: any[] = []
  try {
    stats = await statsPromise
  } catch (err) {
    logger.error({ err }, 'Platform stats sync error (await)')
    stats = []
  }

  // Single write for stats + lastSyncedAt — previously required awaiting stats fetch before writing,
  // now just awaits already-resolved promise.
  // Upgrade 3: lastSyncError set on fail, cleared on success. Do NOT advance
  // lastSyncedAt on TOTAL failure (all upserts failed despite having work) —
  // advancing masked failures as fresh (sync-comparison §3 failure-visibility LAG).
  // Empty-but-successful (no contests found, nothing to upsert) still advances
  // to prevent polling loops (preserves prior intent).
  const totalFailure = totalWork > 0 && synced === 0
  const truncateError = (m: unknown): string => String(m ?? 'sync failed').slice(0, 500)
  try {
    if (stats && stats.length >= 0) {
      if (totalFailure) {
        await saveSyncResult(userId, {
          platformStats: stats as any,
          lastSyncError: truncateError(`All ${totalWork} upserts failed`),
        })
      } else {
        await saveSyncResult(userId, {
          platformStats: stats as any,
          lastSyncedAt: new Date(),
          lastSyncError: null,
        })
        // P1-2: seed the watermark on the cron path only (useWatermark).
        // Manual syncs stay watermark-free so scheduled/on-demand lifecycles
        // never surprise each other. valid:false watermarks never skip
        // (invalid stats need retry, not skip — fail-closed to full).
        if (useWatermark) {
          try {
            await setSyncWatermark(userId, {
              handlesHash: handlesFingerprint(profile),
              valid: hasValidStats(stats as Array<{ valid?: boolean }>),
              statsHash: statsPayloadHash(stats),
              at: Date.now(),
            })
          } catch {}
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'Saving stats/lastSynced failed')
    // Masking fix: do NOT advance lastSyncedAt when the save itself failed.
    // Record the error so UI can show "updated Xh ago / retry".
    // saveSyncResult already retried without lastSyncError pre-migration, so
    // a throw here is a REAL failure (not a missing column) — still record it
    // best-effort (never throws, degrades to warn-once pre-migration).
    await recordSyncErrorBestEffort(userId, (err as any)?.message || err)
  }

  return { synced, platforms: Array.from(platforms) }
  } catch (err) {
    // Unexpected failure before the final write (e.g. preload/DB outage).
    // Record lastSyncError, do NOT advance lastSyncedAt, do NOT throw (cron
    // batch must continue with other users; manual sync logs + socket skips).
    logger.error({ err }, `syncUserContests total failure for ${userId}`)
    await recordSyncErrorBestEffort(userId, (err as any)?.message || err)
    return { synced: 0, platforms: [] }
  }
}

// In-process overlap guard (same-instance double-run: embedded setInterval +
// Render-cron POST + teacher sync-all). Cross-instance is covered best-effort
// by the advisory lock below (see syncLock.ts limits).
let profileSyncInFlight = false

/** Test-only: reset in-flight guard. */
export function __resetSyncEngineForTests(): void {
  profileSyncInFlight = false
}

export interface SyncAllUsersResult {
  totalUsers: number
  totalSynced: number
  skippedRecent: number
  /** Users actually attempted (total - skipped). */
  toSync: number
  /** Batch items that rejected (did not resolve). */
  failures: number
  durationMs: number
  skipped?: boolean
  skipReason?: string
  /** Shard bookkeeping (10k scale): cap + budget + cursor for next-hour remainder. */
  shardSize?: number
  staleTotal?: number
  processed?: number
  truncated?: boolean
  shardCursor?: string | null
  pagesFetched?: number
  timeBudgetMs?: number
}

// --- 10k sync sharding (hourly cron must complete) ---------------------------
// BEFORE: one unbounded findMany(OR handles) full scan (10k rows incl.
// platformStats blob) + in-memory 1h filter + batch-5 until done. At 10k that
// never finishes in an hour (CF 2s gate × 3 calls/user = 6s/user serialized
// → 16h for 10k all-CF; avg 3-8s/user → 2250-6000/hour throughput).
// AFTER: cursor-paged stale query (take/skip + orderBy lastSyncedAt ASC,
// userId ASC) with narrow select (no blob), per-shard user cap + time budget.
// Remainder stays stale (lastSyncedAt not advanced) so next hourly run picks
// it first (oldest-first rotation). Batch-5 + batched writes + lastSyncError
// + JSON log unchanged; shard cursor added to log for observability.
//
// MATH (documented in .ai/reports/scale10k-shard-load.md):
// - Demand steady-state: 10k users × 1 sync/hour max (1h skip) = 10k/hour
//   required for full freshness = 2.78 users/s.
// - Throughput batch-5: avg ~4s/user (fetch overlap + CF gate + DB) → 5/4s
//   = 1.25 users/s ≈ 4500/hour. Worst 8s/user → 0.625/s ≈ 2250/hour.
// - CF gate worst: 3 gated calls/user × 2s = 6s/user serialized → 0.167/s
//   ≈ 600 CF-users/hour if ALL have CF (16.6h for 10k all-CF).
// - Shard 500: avg 500/1.25 ≈ 400s (7min), worst 500/0.625 = 800s (13min),
//   all-CF worst 500×6s = 3000s (50min) ≈ time budget. Fits hourly.
// - Rotation at 10k: 10k/500 = 20 runs ≈ 20h full cycle worst-case all-stale;
//   steady-state (users spread across hours) ≈ 1-5h staleness. Shard 500 is
//   the hourly-completes default; raise via SYNC_SHARD_SIZE only with
//   SYNC_TIME_BUDGET_MS raised + CF gate globalized (Redis) — see report §2.
// Env overrides (no behavior change when unset — defaults below):
// - SYNC_SHARD_SIZE (default 500): max users attempted per run.
// - SYNC_PAGE_SIZE (default 200): DB page (bounded rows per round-trip).
// - SYNC_TIME_BUDGET_MS (default 45min): stop starting new batches after this.
// - SYNC_INTER_BATCH_DELAY_MS (default 0): stagger between batches for LC tails.
export const SYNC_SHARD_SIZE = 500
export const SYNC_PAGE_SIZE = 200
export const SYNC_TIME_BUDGET_MS = 45 * 60 * 1000
export const SYNC_INTER_BATCH_DELAY_MS = 0

function resolveShardSize(explicit?: number): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) {
    return Math.min(5000, Math.floor(explicit))
  }
  const env = parseInt(process.env.SYNC_SHARD_SIZE || '', 10)
  if (Number.isFinite(env) && env > 0) return Math.min(5000, Math.floor(env))
  return SYNC_SHARD_SIZE
}

function resolvePageSize(explicit?: number): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) {
    return Math.min(500, Math.max(1, Math.floor(explicit)))
  }
  const env = parseInt(process.env.SYNC_PAGE_SIZE || '', 10)
  if (Number.isFinite(env) && env > 0) return Math.min(500, Math.max(1, Math.floor(env)))
  return SYNC_PAGE_SIZE
}

function resolveTimeBudgetMs(explicit?: number): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit)
  }
  const env = parseInt(process.env.SYNC_TIME_BUDGET_MS || '', 10)
  if (Number.isFinite(env) && env > 0) return Math.floor(env)
  return SYNC_TIME_BUDGET_MS
}

function resolveInterBatchDelayMs(explicit?: number): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit >= 0) {
    return Math.floor(explicit)
  }
  const env = parseInt(process.env.SYNC_INTER_BATCH_DELAY_MS || '', 10)
  if (Number.isFinite(env) && env >= 0) return Math.floor(env)
  return SYNC_INTER_BATCH_DELAY_MS
}

/** Handles OR-branch shared by counts + pages (single-column indexes BitmapOr). */
function handlesOrBranch(): any[] {
  return [
    { leetcodeHandle: { not: null } },
    { codeforcesHandle: { not: null } },
    { codechefHandle: { not: null } },
    { hackerrankHandle: { not: null } },
    { gfgHandle: { not: null } },
  ]
}

/** Stale filter: has handles AND (never synced OR synced >1h ago). */
function buildStaleWhere(hourAgo: Date): any {
  return {
    AND: [
      { OR: handlesOrBranch() },
      { OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: hourAgo } }] },
    ],
  }
}

/** Narrow select for shard pages (never fetch platformStats blob per row). */
const SHARD_SELECT = {
  userId: true,
  leetcodeHandle: true,
  codeforcesHandle: true,
  codechefHandle: true,
  hackerrankHandle: true,
  gfgHandle: true,
  githubUsername: true,
  lastSyncedAt: true,
} as const

async function safeCount(db: any, where: any): Promise<number | null> {
  try {
    if (!db?.codingProfile?.count) return null
    const n = await db.codingProfile.count({ where })
    return typeof n === 'number' ? n : null
  } catch {
    return null
  }
}

function emitProfileSyncRunLog(args: {
  startedAt: Date
  totalUsers: number
  toSync: number
  skippedRecent: number
  totalSynced: number
  failures: number
  durationMs: number
  skipped?: boolean
  skipReason?: string
  shardSize?: number
  staleTotal?: number
  processed?: number
  truncated?: boolean
  shardCursor?: string | null
  pagesFetched?: number
  timeBudgetMs?: number
}): void {
  const finishedAt = new Date()
  // One JSON line per cron run — greppable in Render/Neon logs without metrics infra.
  logger.info(
    JSON.stringify({
      event: 'profile-sync-run',
      startedAt: args.startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: args.durationMs,
      totalUsers: args.totalUsers,
      toSync: args.toSync,
      skippedRecent: args.skippedRecent,
      totalSynced: args.totalSynced,
      failures: args.failures,
      shardSize: args.shardSize ?? null,
      staleTotal: args.staleTotal ?? null,
      processed: args.processed ?? args.toSync,
      truncated: args.truncated ?? false,
      shardCursor: args.shardCursor ?? null,
      pagesFetched: args.pagesFetched ?? null,
      timeBudgetMs: args.timeBudgetMs ?? null,
      ...(args.skipped ? { skipped: true as const, skipReason: args.skipReason || 'unknown' } : {}),
    })
  )
}

export async function syncAllUsers(opts?: {
  prismaClient?: any
  lockClient?: any
  shardSize?: number
  pageSize?: number
  timeBudgetMs?: number
  interBatchDelayMs?: number
  nowMs?: number
}): Promise<{ totalUsers: number; totalSynced: number }> {
  const startedAt = new Date()
  const t0 = Date.now()
  const nowMs = opts?.nowMs ?? Date.now()
  const db: any = opts?.prismaClient ?? prisma
  const shardSize = resolveShardSize(opts?.shardSize)
  const pageSize = resolvePageSize(opts?.pageSize)
  const timeBudgetMs = resolveTimeBudgetMs(opts?.timeBudgetMs)
  const interBatchDelayMs = resolveInterBatchDelayMs(opts?.interBatchDelayMs)

  // Same-process overlap guard (cheap, no DB round-trip).
  if (profileSyncInFlight) {
    emitProfileSyncRunLog({
      startedAt,
      totalUsers: 0,
      toSync: 0,
      skippedRecent: 0,
      totalSynced: 0,
      failures: 0,
      durationMs: Date.now() - t0,
      skipped: true,
      skipReason: 'in-flight',
      shardSize,
      staleTotal: 0,
      processed: 0,
      truncated: false,
      shardCursor: null,
      pagesFetched: 0,
      timeBudgetMs,
    })
    return { totalUsers: 0, totalSynced: 0, skippedRecent: 0, toSync: 0, failures: 0, durationMs: Date.now() - t0, skipped: true, skipReason: 'in-flight' } as any
  }

  // Cross-instance best-effort advisory lock (fails open when pg unavailable).
  const lock = await tryAcquireProfileSyncLock(opts?.lockClient)
  if (!lock.acquired) {
    emitProfileSyncRunLog({
      startedAt,
      totalUsers: 0,
      toSync: 0,
      skippedRecent: 0,
      totalSynced: 0,
      failures: 0,
      durationMs: Date.now() - t0,
      skipped: true,
      skipReason: 'advisory-lock-held',
      shardSize,
      staleTotal: 0,
      processed: 0,
      truncated: false,
      shardCursor: null,
      pagesFetched: 0,
      timeBudgetMs,
    })
    return { totalUsers: 0, totalSynced: 0, skippedRecent: 0, toSync: 0, failures: 0, durationMs: Date.now() - t0, skipped: true, skipReason: 'advisory-lock-held' } as any
  }

  profileSyncInFlight = true
  try {
  // --- Shard counts (2 cheap COUNTs, no blob fetch) ---
  const hourAgo = new Date(nowMs - 60 * 60 * 1000)
  const handlesWhere = { OR: handlesOrBranch() }
  const staleWhere = buildStaleWhere(hourAgo)
  const [totalUsersOrNull, staleTotalOrNull] = await Promise.all([
    safeCount(db, handlesWhere),
    safeCount(db, staleWhere),
  ])

  // === SPEED: concurrent batch processing over cursor-paged stale shard ===
  // Previously: one unbounded findMany(OR) full scan (10k rows + blob) then
  // batch-5 until done (never completes hourly at 10k).
  // Now: oldest-first pages (take/skip + orderBy lastSyncedAt ASC, userId ASC),
  // narrow select (no platformStats), stop at shardSize OR timeBudgetMs.
  // Remainder stays stale → next hourly run picks it first (rotation).
  // Stagger: CF 2s gate (codeforcesGate.ts) serializes CF calls across batch-5;
  // LeetCode 12s timeout + 1 retry + 60s coalescing cache absorbs tails;
  // optional SYNC_INTER_BATCH_DELAY_MS yields between batches for LC burst
  // smoothing. Batched writes + lastSyncError live inside syncUserContests.
  const BATCH_SIZE = 5

  const toSync: any[] = []
  let pagesFetched = 0
  let shardCursor: string | null = null
  // Page until shardSize or empty (each page bounded take/pageSize).
  for (let skip = 0; skip < shardSize; skip += pageSize) {
    const take = Math.min(pageSize, shardSize - skip)
    let page: any[] = []
    try {
      page = await db.codingProfile.findMany({
        where: staleWhere,
        orderBy: [{ lastSyncedAt: 'asc' }, { userId: 'asc' }],
        select: SHARD_SELECT,
        take,
        skip,
      })
    } catch (e) {
      logger.warn({ err: (e as any)?.message || e }, '[sync] shard page fetch failed, stopping pagination')
      break
    }
    pagesFetched++
    if (!page || page.length === 0) break
    // Defensive in-memory stale guard (mocks that ignore where still skip fresh).
    for (const p of page) {
      if ((p as any).lastSyncedAt && new Date((p as any).lastSyncedAt).getTime() > hourAgo.getTime()) continue
      toSync.push(p)
      shardCursor = (p as any).userId ?? shardCursor
      if (toSync.length >= shardSize) break
    }
    if (page.length < take) break
    if (toSync.length >= shardSize) break
  }

  const staleTotal = staleTotalOrNull ?? toSync.length
  const totalUsers = totalUsersOrNull ?? (staleTotalOrNull != null ? staleTotalOrNull + 0 : toSync.length)
  // skippedRecent = fresh (total - stale) when counts available; else 0.
  const skippedRecent = totalUsersOrNull != null && staleTotalOrNull != null
    ? Math.max(0, totalUsersOrNull - staleTotalOrNull)
    : 0

  let totalSynced = 0
  let failures = 0
  let processed = 0
  let truncated = false
  for (let i = 0; i < toSync.length; i += BATCH_SIZE) {
    // Time budget: stop starting new batches once hourly budget is spent so
    // this run completes; remainder (unprocessed stale) rotates next hour.
    if (Date.now() - t0 > timeBudgetMs) {
      truncated = true
      break
    }
    const batch = toSync.slice(i, i + BATCH_SIZE)
    // Throttle-collapse: pass preloaded profile so syncUserContests skips its
    // own findUnique (saves N reads per cron run; batch-5 fan-out unchanged).
    // P1-2: cron path opts into watermark incremental (steady users with
    // unchanged handles + valid stats <6h skip externals; manual syncs omit
    // the flag and always run full on explicit user demand).
    const results = await Promise.allSettled(batch.map((profile: any) => syncUserContests(profile.userId, { profile, useWatermark: true })))
    for (const r of results) {
      if (r.status === 'fulfilled') totalSynced += r.value.synced
      else {
        failures++
        logger.error('syncAllUsers batch item failed:', (r as PromiseRejectedResult).reason)
      }
    }
    processed += batch.length
    // No 200ms throttle — external APIs are protected by fetch timeout (5s/12s LC)
    // + per-handle cache (60s TTL) + CF 2s gate (codeforcesGate.ts) + DB bounded
    // concurrency. Optional stagger for LC tails:
    if (interBatchDelayMs > 0 && i + BATCH_SIZE < toSync.length) {
      await new Promise((r) => setTimeout(r, interBatchDelayMs))
    } else {
      // Tiny yield to avoid tight-loop starvation (no fixed sleep).
      await new Promise((res) => setImmediate(res))
    }
  }
  if (processed < toSync.length) truncated = true

  const durationMs = Date.now() - t0
  emitProfileSyncRunLog({
    startedAt,
    totalUsers,
    toSync: toSync.length,
    skippedRecent,
    totalSynced,
    failures,
    durationMs,
    shardSize,
    staleTotal,
    processed,
    truncated,
    shardCursor,
    pagesFetched,
    timeBudgetMs,
  })

  return { totalUsers, totalSynced, skippedRecent, toSync: toSync.length, failures, durationMs, shardSize, staleTotal, processed, truncated, shardCursor, pagesFetched, timeBudgetMs } as any
  } finally {
    profileSyncInFlight = false
    try {
      await lock.release()
    } catch {}
  }
}
