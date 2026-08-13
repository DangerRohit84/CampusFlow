// packages/backend/src/services/syncEngine.ts
import prisma from '../config/db'
import { fetchAllPlatforms } from './platformFetchers'

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

// Match a participation to a CodingContest by platform + title or URL
async function findMatchingContest(platform: string, contestName: string, contestUrl: string | null): Promise<string | null> {
  const dbPlatform = platformMap[platform] || platform.toUpperCase()
  const normalized = normalize(contestName)

  const candidates = await prisma.codingContest.findMany({
    where: { platform: dbPlatform },
    select: { id: true, title: true, url: true },
  })

  for (const c of candidates) {
    // 1. Exact title match
    if (normalize(c.title) === normalized) return c.id
    // 2. Title contains match
    if (normalize(c.title).includes(normalized) || normalized.includes(normalize(c.title))) return c.id
    // 3. URL match (most reliable for platforms like CodeChef/Codeforces)
    if (contestUrl && c.url) {
      const normUrl = (u: string) => u.replace(/\/+$/, '').toLowerCase()
      if (normUrl(contestUrl) === normUrl(c.url)) return c.id
    }
  }

  return null
}

export async function syncUserContests(userId: string): Promise<{ synced: number; platforms: string[] }> {
  const profile = await prisma.codingProfile.findUnique({ where: { userId } })
  if (!profile) return { synced: 0, platforms: [] }

  const results = await fetchAllPlatforms(profile)
  let synced = 0
  const platforms = new Set<string>()

  for (const r of results) {
    platforms.add(r.platform)
    try {
      // Try to find matching CodingContest for this participation
      const contestId = await findMatchingContest(r.platform, r.contestName, r.contestUrl)

      await prisma.contestParticipation.upsert({
        where: {
          userId_platform_contestName: {
            userId,
            platform: r.platform,
            contestName: r.contestName,
          },
        },
        update: {
          rank: r.rank,
          score: r.score,
          rating: r.rating,
          ratingChange: r.ratingChange,
          contestUrl: r.contestUrl,
          participatedAt: r.participatedAt,
          contestId,
          syncedAt: new Date(),
        },
        create: {
          userId,
          platform: r.platform,
          contestName: r.contestName,
          contestUrl: r.contestUrl,
          rank: r.rank,
          score: r.score,
          rating: r.rating,
          ratingChange: r.ratingChange,
          participatedAt: r.participatedAt,
          contestId,
        },
      })
      synced++
    } catch (err) {
      console.error(`Sync error for ${r.platform}/${r.contestName}:`, err)
    }
  }

  await prisma.codingProfile.update({
    where: { userId },
    data: { lastSyncedAt: new Date() },
  })

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

  let totalSynced = 0
  for (const profile of profiles) {
    // Skip if synced within last hour
    if (profile.lastSyncedAt) {
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000)
      if (profile.lastSyncedAt > hourAgo) continue
    }
    const result = await syncUserContests(profile.userId)
    totalSynced += result.synced
  }

  return { totalUsers: profiles.length, totalSynced }
}
