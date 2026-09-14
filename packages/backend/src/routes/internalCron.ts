import { Router, Request, Response } from 'express'
import { timingSafeEqual } from 'crypto'
import prisma from '../config/db'
import { fetchAndStoreContests } from '../services/contestFetcher'
import { syncAllUsers } from '../services/syncEngine'
import { runContestRemindersJob } from '../services/contestReminderService'
import { fetchFromAllSources, enrichHackathonStaging, enrichInternshipStaging, listFetchAllPlatforms, platformTypeMap } from '../services/opportunityAgent'
import { logger } from '../utils/logger'
import { normalizeSource } from '../services/opportunities/dedup'
import { isAutoFetchEnabled } from '../services/fetch/autoFetch'

const ENRICH_DELAY_MS = 12000

// In-process overlap guard for the long opportunities job (same-instance
// double-run: embedded setInterval + QStash/cron-job.org POST + manual retry).
// Mirrors profileSyncInFlight in syncEngine.ts (cheap, no DB round-trip).
// HTTP layer is ack-first 202 (see handleJob), so overlapping scheduler
// retries would otherwise pile up 12s-delayed enrichment loops.
let opportunitiesInFlight = false

/** Test-only: reset opportunities in-flight guard. */
export function __resetInternalCronForTests(): void {
  opportunitiesInFlight = false
}

/** Test-only: observe opportunities in-flight guard. */
export function __isOpportunitiesJobInFlightForTests(): boolean {
  return opportunitiesInFlight
}

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function requireCronSecret(req: Request, res: Response, next: () => void) {
  const secret = process.env.CRON_SECRET
  // Fail closed ALWAYS: without a secret these endpoints trigger external API
  // scraping, bulk DB writes, and deleteMany jobs - never serve them unauthenticated.
  // Local devs must set CRON_SECRET in .env to use these endpoints.
  if (!secret) {
    res.status(503).json({ error: 'Cron secret not configured' })
    return
  }
  const provided = req.get('x-cron-secret')
  if (!provided || !secretsMatch(provided, secret)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  next()
}

export async function runContestsJob(opts?: {
  /** Injectable gate for hermetic tests (defaults to the DB+env master toggle). */
  isEnabled?: () => Promise<boolean>;
}): Promise<{ fetched: number; updated: number }> {
  // Master toggle: scheduled auto-fetch skips when SUPER_ADMIN paused it
  // (FetchPage) or AUTO_FETCH_ENABLED=false. Manual POST /fetch/* + contest
  // routes never consult this flag — explicit user action always allowed.
  const enabled = await (opts?.isEnabled ? opts.isEnabled() : isAutoFetchEnabled());
  if (!enabled) {
    logger.info('[Cron] Auto-fetch disabled (master toggle OFF) — skipping contest fetch (manual fetch still allowed)');
    return { fetched: 0, updated: 0 };
  }
  logger.info('[Cron] Running contest fetch...')
  return fetchAndStoreContests()
}

export async function runProfileSyncJob(): Promise<{ totalUsers: number; totalSynced: number; skippedRecent?: number; toSync?: number; failures?: number; durationMs?: number; skipped?: boolean; skipReason?: string }> {
  logger.info('[CRON] Starting contest participation sync...')
  const startedAt = new Date().toISOString()
  const result = await syncAllUsers()
  // Per-run JSON line (mirrors syncEngine profile-sync-run; kept here so
  // Render-cron HTTP logs also carry structured totals even if engine log is filtered).
  logger.info(
    JSON.stringify({
      event: 'profile-sync-job',
      startedAt,
      finishedAt: new Date().toISOString(),
      totalUsers: (result as any).totalUsers ?? 0,
      toSync: (result as any).toSync ?? 0,
      skippedRecent: (result as any).skippedRecent ?? 0,
      totalSynced: (result as any).totalSynced ?? 0,
      failures: (result as any).failures ?? 0,
      durationMs: (result as any).durationMs ?? 0,
      ...((result as any).skipped ? { skipped: true as const, skipReason: (result as any).skipReason } : {}),
    })
  )
  logger.info(`[CRON] Synced ${result.totalSynced} records from ${result.totalUsers} users`)
  return result as any
}

export interface OpportunitiesJobResult {
  hackathonsFetched: number
  hackathonsSkipped: number
  internshipsFetched: number
  internshipsSkipped: number
  hackathonsEnriched: number
  internshipsEnriched: number
}

export async function runOpportunitiesJob(opts?: {
  /** Injectable gate for hermetic tests (defaults to the DB+env master toggle). */
  isEnabled?: () => Promise<boolean>;
}): Promise<OpportunitiesJobResult> {
  // Same-process overlap guard (cheap, no DB round-trip). Set synchronously
  // before the first await so concurrent schedulers serialize: second run
  // returns all-zero immediately instead of piling up 12s-delayed loops.
  if (opportunitiesInFlight) {
    logger.info('[Cron] opportunities job already running — skipping overlapping run');
    return { hackathonsFetched: 0, hackathonsSkipped: 0, internshipsFetched: 0, internshipsSkipped: 0, hackathonsEnriched: 0, internshipsEnriched: 0 };
  }
  opportunitiesInFlight = true
  try {
  // Master toggle FIRST (before any DB/admin lookup): scheduled auto-fetch
  // skips when SUPER_ADMIN paused it (FetchPage) or AUTO_FETCH_ENABLED=false.
  // Manual POST /fetch/all + /:platform + /other/* never consult this flag.
  const enabled = await (opts?.isEnabled ? opts.isEnabled() : isAutoFetchEnabled());
  if (!enabled) {
    logger.info('[Cron] Auto-fetch disabled (master toggle OFF) — skipping opportunity fetch (manual fetch still allowed)');
    return { hackathonsFetched: 0, hackathonsSkipped: 0, internshipsFetched: 0, internshipsSkipped: 0, hackathonsEnriched: 0, internshipsEnriched: 0 };
  }
  // BUILD MODE (operational mode build): Cron now respects PlatformSettings tick/target saved via Fetch All.
  // OTHER_HACKATHON / OTHER_INTERNSHIP remain detached manual-only (POST /fetch/other/*).
  // Cron reads platform_settings (platform, type, enabled, fetchLimit): enabled=false → skip, fetchLimit → target (0=All, else 1-50), default 10.
  // Frontend Fetch All persists tick+target via PUT /fetch/:platform/limit {limit,type,enabled} and PUT /fetch/settings (bulk).
  logger.info('[Cron] Fetching opportunities from external sources (respecting PlatformSettings tick/target)...')

  // SUPER_ADMIN-only feed (fix: tenant lottery). BEFORE: findFirst SUPER_ADMIN
  // or COLLEGE_ADMIN in arbitrary order stamped admin.collegeId! onto every
  // row — whichever college's admin happened to sort first owned the global
  // feed (lottery). AFTER: prefer a SUPER_ADMIN owner and stamp collegeId
  // null (global shared feed). Per-college visibility lives in the decisions
  // tables; @@unique(title,source) stays global so every college can still
  // decide the same opp independently. Explicit CRON_COLLEGE_ID remains for
  // single-tenant debug (documents the only non-global path).
  const explicitCronCollege = (process.env.CRON_COLLEGE_ID || '').trim() || null
  const admin = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN' },
    select: { id: true, collegeId: true },
  })
  if (!admin) {
    logger.info('[Cron] No super admin user found, skipping opportunity fetch')
    return { hackathonsFetched: 0, hackathonsSkipped: 0, internshipsFetched: 0, internshipsSkipped: 0, hackathonsEnriched: 0, internshipsEnriched: 0 }
  }
  const cronCollegeId: string | null = explicitCronCollege

  // Build limits from PlatformSettings — tick (enabled) + target (fetchLimit) — so cron respects Fetch All selection
  // SSOT: registry owns platform keys + types (1-file adds). No local copy.
  const ALL_PLATFORMS = listFetchAllPlatforms()
  const PLATFORM_TYPE: Record<string, string> = platformTypeMap() as Record<string, string>
  let limits: Record<string, number | undefined> = {}
  let disabledSkipped: string[] = []
  try {
    const dbSettings = await prisma.platformSettings.findMany()
    if (dbSettings.length > 0) {
      for (const p of ALL_PLATFORMS) {
        const type = PLATFORM_TYPE[p]
        const s = (dbSettings as any[]).find((x: any) => x.platform === p && x.type === type)
        if (s && (s as any).enabled === false) {
          disabledSkipped.push(p)
          continue
        }
        const raw = s ? (s as any).fetchLimit : 10
        limits[p] = raw === 0 ? undefined : raw
      }
      if (Object.keys(limits).length === 0) {
        logger.info(`[Cron] All platforms disabled via PlatformSettings (skipped: ${disabledSkipped.join(', ')}) — skipping fetch`)
        return { hackathonsFetched: 0, hackathonsSkipped: 0, internshipsFetched: 0, internshipsSkipped: 0, hackathonsEnriched: 0, internshipsEnriched: 0 }
      }
      logger.info(`[Cron] PlatformSettings limits: ${Object.entries(limits).map(([k, v]) => `${k}:${v === undefined ? 'All' : v}`).join(', ')}${disabledSkipped.length ? ` (skipped disabled: ${disabledSkipped.join(', ')})` : ''}`)
    } else {
      for (const p of ALL_PLATFORMS) limits[p] = 10
      logger.info('[Cron] No PlatformSettings found — defaulting to 10 each for all 10 platforms')
    }
  } catch (e: any) {
    logger.warn({ err: e?.message || e }, '[Cron] PlatformSettings read failed, defaulting to 10 each:')
    limits = {}
    for (const p of ALL_PLATFORMS) limits[p] = 10
  }

  const allOpps = await fetchFromAllSources(limits)
  let hackathonFetched = 0, hackathonSkipped = 0
  let internshipFetched = 0, internshipSkipped = 0
  const hackathonIdsToEnrich: string[] = []
  const internshipIdsToEnrich: string[] = []

  // Batched staging save (DB write N+1 fix, ranked cause #2).
  // BEFORE: per-opp findFirst + create (2N round-trips; N=30 → 60 queries).
  // AFTER: 2 prefetch queries (existing title|source sets) + 2 createMany
  // batches with skipDuplicates (+ 2 post-fetch ID lookups for enrichment)
  // = 6 round-trips total regardless of N. Pattern mirrors save.ts
  // filterExisting + createMany (SRP/DIP exemplar). In-memory dedupe +
  // date coercion identical to save.ts; enrichment IDs resolved via post-fetch
  // findMany (createMany returns count only).
  const hackathons = allOpps.filter(o => o.type === 'HACKATHON')
  const internships = allOpps.filter(o => o.type === 'INTERNSHIP')

  function coerceDateOrNull(v: unknown): Date | null {
    if (!v) return null
    const d = v instanceof Date ? v : new Date(v as any)
    return isNaN(d.getTime()) ? null : d
  }

  // --- Hackathons: in-memory dedupe + row building ---
  // Order 2 V-24 NULL-safe: normalizeSource (missing/blank → 'MANUAL').
  const hackSeen = new Set<string>()
  const hackRows: any[] = []
  for (const opp of hackathons) {
    if (!opp.url || !opp.title) { hackathonSkipped++; continue }
    const hackSource = normalizeSource((opp as { source?: unknown }).source)
    const dedupeKey = `HACKATHON|${String(opp.title).trim().toLowerCase()}|${hackSource}`
    if (hackSeen.has(dedupeKey)) { hackathonSkipped++; continue }
    hackSeen.add(dedupeKey)
    hackRows.push({
      title: opp.title,
      description: opp.description || null,
      url: opp.url,
      organizer: opp.organizer || null,
      deadline: coerceDateOrNull(opp.deadline),
      startDate: coerceDateOrNull(opp.startDate),
      duration: opp.duration || null,
      location: opp.location || null,
      mode: opp.mode || null,
      prizePool: opp.prizePool || null,
      // Order 3: canonical Json array (was JSON-stringified String).
      themes: (Array.isArray(opp.themes) ? opp.themes : []) as any,
      website: opp.website || null,
      discord: opp.discord || null,
      participantsCount: opp.participantsCount || 0,
      inviteOnly: opp.inviteOnly || false,
      status: 'DRAFT',
      source: hackSource,
      creatorId: admin.id,
      collegeId: cronCollegeId,
    })
  }

  // --- Internships: in-memory dedupe + row building ---
  const internSeen = new Set<string>()
  const internRows: any[] = []
  for (const opp of internships) {
    if (!opp.url || !opp.title) { internshipSkipped++; continue }
    const internSource = normalizeSource((opp as { source?: unknown }).source)
    const dedupeKey = `INTERNSHIP|${String(opp.title).trim().toLowerCase()}|${internSource}`
    if (internSeen.has(dedupeKey)) { internshipSkipped++; continue }
    internSeen.add(dedupeKey)
    internRows.push({
      title: opp.title,
      description: opp.description || 'No description available',
      company: opp.company || opp.organizer || 'Unknown',
      role: opp.role || opp.title,
      url: opp.url,
      stipend: opp.stipend || null,
      duration: opp.duration || null,
      mode: opp.mode || 'REMOTE',
      deadline: opp.deadline || null,
      startDate: opp.startDate || null,
      status: 'ACTIVE',
      source: internSource,
      creatorId: admin.id,
      collegeId: cronCollegeId,
    })
  }

  async function filterExistingStaging(rows: any[], model: 'hackathonStaging' | 'internshipStaging'): Promise<any[]> {
    if (rows.length === 0) return []
    try {
      // Pair-match dedupe (cross-product fix): title IN × source IN over-fetches
      // (e.g. titles [A,B] × sources [S1,S2] fetches (A,S2) that never existed
      // as a pair). Query exact (title, source) pairs via OR so the prefetch
      // touches only candidate pairs; JS Set still decides exact membership.
      const pairMap = new Map<string, { title: string; source: string }>()
      for (const r of rows) {
        const title = r.title as string
        const source = normalizeSource((r as { source?: unknown }).source)
        pairMap.set(`${String(title).trim().toLowerCase()}|${source}`, { title, source })
      }
      const pairs = [...pairMap.values()]
      const existing: any[] = await (prisma as any)[model].findMany({
        where: { OR: pairs.map((p) => ({ title: p.title, source: p.source })) },
        select: { title: true, source: true },
      })
      const existingKeys = new Set(existing.map((e: any) => `${String(e.title).trim().toLowerCase()}|${normalizeSource((e as { source?: unknown }).source)}`))
      return rows.filter((r) => !existingKeys.has(`${String(r.title).trim().toLowerCase()}|${normalizeSource((r as { source?: unknown }).source)}`))
    } catch (e: any) {
      logger.warn({ err: e?.message || e }, `[Cron] pre-fetch dedupe failed for ${model}, falling back to full insert:`)
      return rows
    }
  }

  const [hackFiltered, internFiltered] = await Promise.all([
    filterExistingStaging(hackRows, 'hackathonStaging'),
    filterExistingStaging(internRows, 'internshipStaging'),
  ])
  hackathonSkipped += hackRows.length - hackFiltered.length
  internshipSkipped += internRows.length - internFiltered.length

  try {
    if (hackFiltered.length > 0) {
      const res = await prisma.hackathonStaging.createMany({ data: hackFiltered, skipDuplicates: true })
      hackathonFetched = res.count
      hackathonSkipped += hackFiltered.length - res.count
      try {
        // Pair-match post-fetch (same cross-product fix as prefetch): resolve
        // enrichment IDs via exact (title, source) OR pairs, then keep only
        // wanted pairs in JS (createMany returns count only).
        const hackPairs = [...new Map(hackFiltered.map((r) => [`${String(r.title).trim().toLowerCase()}|${normalizeSource((r as { source?: unknown }).source)}`, { title: r.title as string, source: normalizeSource((r as { source?: unknown }).source) }])).values()]
        const createdRows: any[] = await prisma.hackathonStaging.findMany({
          where: { OR: hackPairs.map((p) => ({ title: p.title, source: p.source })) },
          select: { id: true, title: true, source: true },
        })
        const wanted = new Set(hackFiltered.map((r) => `${String(r.title).trim().toLowerCase()}|${normalizeSource((r as { source?: unknown }).source)}`))
        for (const row of createdRows) {
          if (wanted.has(`${String(row.title).trim().toLowerCase()}|${normalizeSource((row as { source?: unknown }).source)}`)) hackathonIdsToEnrich.push(row.id)
        }
      } catch (e: any) {
        logger.warn({ err: e?.message || e }, '[Cron] hackathon post-fetch IDs failed (enrichment skipped):')
      }
    }
  } catch (e: any) {
    logger.warn({ err: e?.message || e }, '[Cron] hackathonStaging.createMany failed:')
    hackathonSkipped += hackFiltered.length
  }
  try {
    if (internFiltered.length > 0) {
      const res = await prisma.internshipStaging.createMany({ data: internFiltered, skipDuplicates: true })
      internshipFetched = res.count
      internshipSkipped += internFiltered.length - res.count
      try {
        const internPairs = [...new Map(internFiltered.map((r) => [`${String(r.title).trim().toLowerCase()}|${normalizeSource((r as { source?: unknown }).source)}`, { title: r.title as string, source: normalizeSource((r as { source?: unknown }).source) }])).values()]
        const createdRows: any[] = await prisma.internshipStaging.findMany({
          where: { OR: internPairs.map((p) => ({ title: p.title, source: p.source })) },
          select: { id: true, title: true, source: true },
        })
        const wanted = new Set(internFiltered.map((r) => `${String(r.title).trim().toLowerCase()}|${normalizeSource((r as { source?: unknown }).source)}`))
        for (const row of createdRows) {
          if (wanted.has(`${String(row.title).trim().toLowerCase()}|${normalizeSource((row as { source?: unknown }).source)}`)) internshipIdsToEnrich.push(row.id)
        }
      } catch (e: any) {
        logger.warn({ err: e?.message || e }, '[Cron] internship post-fetch IDs failed (enrichment skipped):')
      }
    }
  } catch (e: any) {
    logger.warn({ err: e?.message || e }, '[Cron] internshipStaging.createMany failed:')
    internshipSkipped += internFiltered.length
  }

  logger.info(`[Cron] Opportunities: ${hackathonFetched} hackathons + ${internshipFetched} internships fetched, ${hackathonSkipped + internshipSkipped} skipped`)

  // Enrich sequentially with delay between each to avoid rate limits
  async function enrichSequentially(ids: string[], enrichFn: (id: string) => Promise<void>, label: string) {
    let enriched = 0
    for (let i = 0; i < ids.length; i++) {
      logger.info(`[Cron] Enriching ${label} ${i + 1}/${ids.length}`)
      try {
        await enrichFn(ids[i])
        enriched++
      } catch { /* individual enrichment failures are ignored */ }
      if (i < ids.length - 1) {
        await new Promise(r => setTimeout(r, ENRICH_DELAY_MS))
      }
    }
    return enriched
  }

  const hackathonsEnriched = await enrichSequentially(hackathonIdsToEnrich, enrichHackathonStaging, 'hackathons')
  const internshipsEnriched = await enrichSequentially(internshipIdsToEnrich, enrichInternshipStaging, 'internships')

  return {
    hackathonsFetched: hackathonFetched,
    hackathonsSkipped: hackathonSkipped,
    internshipsFetched: internshipFetched,
    internshipsSkipped: internshipSkipped,
    hackathonsEnriched,
    internshipsEnriched,
  }
  } finally {
    opportunitiesInFlight = false
  }
}

export async function runContestRemindersJobCron(): Promise<{ checked: number; notified: number; failed: number }> {
  logger.info('[Cron] Running contest-reminder fan-out...')
  const result = await runContestRemindersJob()
  logger.info(`[Cron] Contest reminders: checked=${result.checked} notified=${result.notified} failed=${result.failed}`)
  return result
}

export async function runCleanupJob(): Promise<{ hackathonsDeleted: number; internshipsDeleted: number; registrationsExpired: number; notificationsDeleted: number; roomNotificationsDeleted: number }> {
  logger.info('[Cron] Cleaning up old rejected items...')
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)

  const hackDeleted = await prisma.hackathonStaging.deleteMany({
    where: { status: 'REJECTED', updatedAt: { lt: cutoff } },
  })
  const intDeleted = await prisma.internshipStaging.deleteMany({
    where: { status: 'REJECTED', updatedAt: { lt: cutoff } },
  })
  logger.info(`[Cron] Cleanup: deleted ${hackDeleted.count} hackathons, ${intDeleted.count} internships older than 30 days`)

  // Auto-expire (moved from GET /hackathons/:id — GETs must never write):
  // revert SELECTED registrations to REGISTERED after 3 days of no update.
  const threeDaysAgo = new Date()
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
  const expired = await prisma.hackathonRegistration.updateMany({
    where: { status: 'SELECTED', updatedAt: { lt: threeDaysAgo } },
    data: { status: 'REGISTERED', currentRound: 0 },
  })
  if (expired.count > 0) {
    logger.info(`[Cron] Expired ${expired.count} stale SELECTED registrations → REGISTERED`)
  }

  // 90-day TTL for notifications (both legacy + room tables) — prevents unbounded growth.
  const ttlCutoff = new Date()
  ttlCutoff.setDate(ttlCutoff.getDate() - 90)
  const notifDeleted = await prisma.notification.deleteMany({
    where: { createdAt: { lt: ttlCutoff } },
  })
  const roomNotifDeleted = await prisma.roomNotification.deleteMany({
    where: { createdAt: { lt: ttlCutoff } },
  })
  if (notifDeleted.count + roomNotifDeleted.count > 0) {
    logger.info(`[Cron] TTL: deleted ${notifDeleted.count} notifications + ${roomNotifDeleted.count} room-notifications older than 90d`)
  }

  return {
    hackathonsDeleted: hackDeleted.count,
    internshipsDeleted: intDeleted.count,
    registrationsExpired: expired.count,
    notificationsDeleted: notifDeleted.count,
    roomNotificationsDeleted: roomNotifDeleted.count,
  }
}

const router = Router()
router.use(requireCronSecret)

type JobRunner = () => Promise<object>

// Ack-first for free schedulers (QStash / cron-job.org free tiers time out
 // on long jobs: 12s-delayed enrichment + external fetches run minutes).
 // Auth/secret checks stay synchronous in requireCronSecret middleware
 // (401/503 unchanged) — this wrapper only detaches the long runner:
 // respond 202 {ok,job,startedAt,status:'started'} immediately, then
 // setImmediate-run the job with logger completion/error. Manual
 // POST /fetch/* routes are untouched (separate router, still await results).
export const handleJob = (job: string, runner: JobRunner) => async (_req: Request, res: Response) => {
  const startedAt = new Date().toISOString()
  res.status(202).json({ ok: true, job, startedAt, status: 'started' })
  setImmediate(() => {
    Promise.resolve()
      .then(() => runner())
      .then((result) => {
        logger.info({ job, startedAt, ...(result as object) }, `[Cron] ${job} job completed (detached)`)
      })
      .catch((err) => {
        // Full error stays in server logs; generic only (raw can embed Prisma/DB internals).
        logger.error({ err }, `[Cron] ${job} job failed:`)
      })
  })
}

router.post('/contests', handleJob('contests', runContestsJob))
router.post('/contest-reminders', handleJob('contest-reminders', runContestRemindersJobCron))
router.post('/profile-sync', handleJob('profile-sync', runProfileSyncJob))
router.post('/opportunities', handleJob('opportunities', runOpportunitiesJob))
router.post('/cleanup', handleJob('cleanup', runCleanupJob))

export default router
