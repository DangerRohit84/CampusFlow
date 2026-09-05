// packages/backend/src/services/syncEngine.ts
import prisma from '../config/db'
import { fetchAllPlatforms } from './platformFetchers'
import { fetchAllPlatformStats } from './platformStats'

// Normalize a string for fuzzy matching: lowercase, strip non-alphanumeric, collapse spaces
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
}

// Map platform fetcher codes to CodingContest platform values
const platformMap: Record<string, string> = {
  leetcode: 'LEETCODE',
  codeforces: 'CODEFORCES',
  codechef: 'CODECHEF',
  hackerrank: 'HACKERRANK',
  gfg: 'GFG',
}

// Per-run cache for contest candidates to avoid N+1 findMany and prevent cross-run races.
// Scoped to a single syncUserContests invocation; shared reference passed to preload + findMatching.
type ContestCache = Map<string, Array<{ id: string; title: string; url: string }>>

async function preloadContestCandidates(platforms: string[], cache: ContestCache): Promise<void> {
  const distinct = [...new Set(platforms.map(p => platformMap[p] || p.toUpperCase()))].filter(p => !cache.has(p))
  if (distinct.length === 0) return
  await Promise.all(distinct.map(async (dbPlatform) => {
    try {
      const candidates = await prisma.codingContest.findMany({
        where: { platform: dbPlatform },
        select: { id: true, title: true, url: true },
      })
      cache.set(dbPlatform, candidates)
    } catch (e) {
      console.warn(`preloadContestCandidates failed for ${dbPlatform}:`, (e as any)?.message || e)
      cache.set(dbPlatform, [])
    }
  }))
}

// Match a participation to a CodingContest by platform + title or URL
async function findMatchingContest(platform: string, contestName: string, contestUrl: string | null, cache: ContestCache): Promise<string | null> {
  const dbPlatform = platformMap[platform] || platform.toUpperCase()
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

export async function syncUserContests(userId: string): Promise<{ synced: number; platforms: string[] }> {
  const profile = await prisma.codingProfile.findUnique({ where: { userId } })
  if (!profile) return { synced: 0, platforms: [] }
  // Per-run cache isolates concurrent syncs for different users
  const contestCandidateCache: ContestCache = new Map()

  // === SPEED: kick off both network-bound fetches in parallel ===
  // Contest history and platform stats are independent (both only need handles).
  // Previously stats were fetched *after* all upserts (sequential 8s + 8s = 16s worst).
  // Now they overlap — total ~ max(8s, upsert) ≈ 8s, saving ~8s per sync.
  const contestsPromise = fetchAllPlatforms(profile)
  const statsPromise = fetchAllPlatformStats(profile).catch((e) => {
    console.error('Platform stats fetch error (early):', e)
    return [] as any[]
  })

  const results = await contestsPromise
  // Dedupe by sanitized platform+contestName to avoid upsert churn and handle trimmed duplicates
  const seenKeys = new Set<string>()
  const deduped: typeof results = []
  const platforms = new Set<string>()
  for (const r of results) {
    const sanitizedName = String(r.contestName || '').trim().slice(0, 300) || 'Unnamed Contest'
    const dedupeKey = `${r.platform}|${sanitizedName.toLowerCase()}`
    if (seenKeys.has(dedupeKey)) continue
    seenKeys.add(dedupeKey)
    // store sanitized name for later to avoid recomputing
    ;(r as any).__sanitizedName = sanitizedName
    deduped.push(r)
    platforms.add(r.platform)
  }

  // Preload contest candidates for all distinct platforms in parallel (reduces sequential N+1)
  if (deduped.length > 0) {
    await preloadContestCandidates([...platforms], contestCandidateCache)
  }

  // === SPEED: bounded-concurrency upserts ===
  // Each upsert is independent; one failure must not abort others.
  // Previously unbounded Promise.allSettled for N contests could burst DB.
  // Now batched with concurrency 10 — same parallelism for typical N<20, but bounded for large N (100+).
  const UPSERT_BATCH = 10
  const tasks = deduped.map((r) => async () => {
    try {
      const sanitizedName = (r as any).__sanitizedName as string || String(r.contestName || '').trim().slice(0, 300) || 'Unnamed Contest'
      const sanitizedUrl = r.contestUrl ? String(r.contestUrl).trim().slice(0, 500) : null
      const hasValidRank = Number.isInteger(r.rank) && (r.rank as number) > 0 && (r.rank as number) < 1_000_000 ? r.rank : null
      const hasValidRating = typeof r.rating === 'number' && Number.isFinite(r.rating) && r.rating >= 0 && r.rating < 10000 ? Math.round(r.rating) : null
      // Normalize score to valid Int — invalid values must be nulled, not passed through to Prisma
      const hasValidScore = typeof r.score === 'number' && Number.isFinite(r.score) && r.score >= 0 && r.score < 1_000_000 ? Math.round(r.score) : null
      const contestId = await findMatchingContest(r.platform, sanitizedName, sanitizedUrl, contestCandidateCache)

      await prisma.contestParticipation.upsert({
        where: {
          userId_platform_contestName: {
            userId,
            platform: r.platform,
            contestName: sanitizedName,
          },
        },
        update: {
          rank: hasValidRank,
          score: hasValidScore,
          rating: hasValidRating,
          ratingChange: r.ratingChange,
          contestUrl: sanitizedUrl,
          participatedAt: r.participatedAt,
          contestId,
          syncedAt: new Date(),
        },
        create: {
          userId,
          platform: r.platform,
          contestName: sanitizedName,
          contestUrl: sanitizedUrl,
          rank: hasValidRank,
          score: hasValidScore,
          rating: hasValidRating,
          ratingChange: r.ratingChange,
          participatedAt: r.participatedAt,
          contestId,
        },
      })
      return true
    } catch (err) {
      console.error(`Sync error for ${r.platform}/${r.contestName}:`, err)
      return false
    }
  })

  // Run upserts and stats fetch in parallel where possible — statsPromise already in-flight
  // We await upserts first then stats, but they overlap because stats started earlier.
  const upsertSettled = tasks.length === 0 ? [] : await batchedAllSettled(tasks, UPSERT_BATCH)
  const synced = upsertSettled.filter(r => r.status === 'fulfilled' && r.value === true).length

  // Await stats that have been fetching in parallel since the start (likely already resolved)
  let stats: any[] = []
  try {
    stats = await statsPromise
  } catch (err) {
    console.error('Platform stats sync error (await):', err)
    stats = []
  }

  // Single write for stats + lastSyncedAt — previously required awaiting stats fetch before writing,
  // now just awaits already-resolved promise.
  try {
    if (stats && stats.length >= 0) {
      await prisma.codingProfile.update({
        where: { userId },
        data: {
          platformStats: JSON.stringify(stats),
          lastSyncedAt: new Date(),
        },
      })
    }
  } catch (err) {
    console.error('Saving stats/lastSynced failed:', err)
    try {
      await prisma.codingProfile.update({
        where: { userId },
        data: { lastSyncedAt: new Date() },
      })
    } catch {}
  }

  return { synced, platforms: Array.from(platforms) }
}

export async function syncAllUsers(): Promise<{ totalUsers: number; totalSynced: number }> {
  const profiles = await prisma.codingProfile.findMany({
    where: {
      OR: [
        { leetcodeHandle: { not: null } },
        { codeforcesHandle: { not: null } },
        { codechefHandle: { not: null } },
        { hackerrankHandle: { not: null } },
        { gfgHandle: { not: null } },
      ],
    },
  })

  // === SPEED: concurrent batch processing ===
  // Previously: sequential loop with 200ms throttle per user (blocking, ~ N * (8-16s + 0.2s)).
  // For 50 users that's ~400-800s. Now: batches of 5 concurrent (Promise.allSettled per batch),
  // no artificial sleep — throughput ~5x, ~80-160s for 50 users. Per-handle coalescing cache
  // in platformFetchers/Stats further de-dupes repeated handles within a batch window.
  const BATCH_SIZE = 5
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000)

  // Pre-filter recently synced to avoid work — keeps skippedRecent accurate
  const toSync: typeof profiles = []
  let skippedRecent = 0
  for (const p of profiles) {
    if (p.lastSyncedAt && p.lastSyncedAt > hourAgo) skippedRecent++
    else toSync.push(p)
  }

  let totalSynced = 0
  for (let i = 0; i < toSync.length; i += BATCH_SIZE) {
    const batch = toSync.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(batch.map((profile) => syncUserContests(profile.userId)))
    for (const r of results) {
      if (r.status === 'fulfilled') totalSynced += r.value.synced
      else console.error('syncAllUsers batch item failed:', (r as PromiseRejectedResult).reason)
    }
    // No 200ms throttle — external APIs are protected by fetch timeout (5s) + per-handle cache (60s TTL)
    // + DB bounded concurrency. If strict rate-limit needed, add tiny yield to avoid tight loop starvation:
    // await new Promise(res => setImmediate(res)) — but not a fixed 200ms sleep.
  }

  return { totalUsers: profiles.length, totalSynced, skippedRecent } as any
}
