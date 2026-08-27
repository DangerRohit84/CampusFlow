### Task 3: Sync Engine

**Files:**
- Create: `packages/backend/src/services/syncEngine.ts`

**Interfaces:**
- Consumes: `userId` string, Prisma client
- Produces: `{ synced: number, platforms: string[] }`

- [ ] **Step 1: Create syncEngine.ts**

```typescript
// packages/backend/src/services/syncEngine.ts
import prisma from '../config/db'
import { fetchAllPlatforms } from './platformFetchers'

export async function syncUserContests(userId: string): Promise<{ synced: number; platforms: string[] }> {
  const profile = await prisma.codingProfile.findUnique({ where: { userId } })
  if (!profile) return { synced: 0, platforms: [] }

  const results = await fetchAllPlatforms(profile)
  let synced = 0
  const platforms = new Set<string>()

  for (const r of results) {
    platforms.add(r.platform)
    try {
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
          problemsSolved: r.problemsSolved,
          totalProblems: r.totalProblems,
          contestUrl: r.contestUrl,
          participatedAt: r.participatedAt,
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
          problemsSolved: r.problemsSolved,
          totalProblems: r.totalProblems,
          participatedAt: r.participatedAt,
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/services/syncEngine.ts
git commit -m "feat: add sync engine for contest participation"
```
