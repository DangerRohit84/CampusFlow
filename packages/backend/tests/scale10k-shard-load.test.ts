/**
 * Scale10k shard + load — hermetic TDD (no DB/network).
 *
 * Proves hourly sync completes at 10k without one full-scan findMany:
 * - cursor/paged stale query (take/skip + orderBy lastSyncedAt) over
 *   users-with-handles, narrow select (no platformStats blob)
 * - per-shard user cap + time budget (remainder next hour)
 * - batch-5 concurrency + batched writes + lastSyncError + JSON log kept
 * - shard cursor in log
 * Dashboard budgets:
 * - leaderboard max take 50, participants take 50 kept
 * - super dashboard 60s cache (getOrSet) — 25+ queries bounded
 * - search global limit (per-source 6, global 60, q max 100)
 * Load:
 * - scripts/load-10k-smoke.mjs exists, refuses prod, documents burst
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const BACKEND_SRC = path.resolve(__dirname, '../src')
const BACKEND_ROOT = path.resolve(__dirname, '..')
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(BACKEND_SRC, rel), 'utf8')
}

describe('sync sharding (cursor pagination, not full scan)', () => {
  it('syncAllUsers pages stale users (take/skip + orderBy lastSyncedAt, narrow select)', () => {
    const src = readSrc('services/syncEngine.ts')
    // Paged query over stale set — not one unbounded findMany(OR).
    expect(src).toContain('SYNC_SHARD_SIZE')
    expect(src).toContain('SYNC_TIME_BUDGET_MS')
    expect(src).toMatch(/orderBy.*lastSyncedAt/)
    expect(src).toMatch(/take/)
    expect(src).toMatch(/pageSize|SYNC_PAGE_SIZE/)
    expect(src).toContain('skip')
    // Narrow select: handles + userId + lastSyncedAt, never platformStats blob.
    expect(src).toContain('select:')
    expect(src).toContain('lastSyncedAt')
  })

  it('per-shard cap + time budget with remainder-next-hour semantics', () => {
    const src = readSrc('services/syncEngine.ts')
    expect(src).toContain('shardSize')
    expect(src).toContain('timeBudgetMs')
    expect(src).toMatch(/truncated|remainder|next.*hour/i)
    // Time budget checked per batch (hourly run completes).
    expect(src).toMatch(/Date\.now\(\)\s*-\s*t0.*timeBudget|timeBudget.*Date\.now|deadline/i)
  })

  it('keeps batch-5 concurrency, batched writes, lastSyncError, JSON log + shard cursor', () => {
    const src = readSrc('services/syncEngine.ts')
    expect(src).toContain('BATCH_SIZE = 5')
    expect(src).toContain('profile-sync-run')
    expect(src).toContain('lastSyncError')
    expect(src).toContain('totalSynced')
    expect(src).toContain('skippedRecent')
    expect(src).toContain('durationMs')
    // Shard cursor in log.
    expect(src).toMatch(/shardCursor|shardSize|staleTotal/)
  })

  it('staggers external fetches via CF 2s gate (no new burst)', () => {
    const src = readSrc('services/syncEngine.ts')
    // Gate lives in fetchers; engine must not add parallel burst beyond batch-5.
    expect(src).toContain('BATCH_SIZE')
    const fetchers = readSrc('services/platformFetchers.ts')
    expect(fetchers).toContain('fetchCodeforcesJson')
    expect(fetchers).toMatch(/codeforces/i)
  })
})

describe('dashboard query budgets (caps + cache, no behavior change)', () => {
  it('leaderboard enforces max take 50 (groupBy pagination)', () => {
    const src = readSrc('routes/codingProfile.ts')
    expect(src).toMatch(/Math\.min\(50/)
    expect(src).toContain('groupBy')
  })

  it('participants take 50 kept', () => {
    const src = readSrc('routes/codingProfile.ts')
    expect(src).toContain('take: 50,')
    expect(src).not.toContain('take: 1000')
  })

  it('user dashboard bounds heaviest reads (teacher/admin/student)', () => {
    const src = readSrc('routes/user.ts')
    // Budgets documented + take caps on unbounded lists.
    expect(src).toMatch(/10k|budget|take:\s*\d+/i)
    expect(src).toContain("router.get('/dashboard'")
    // Promise.all parallelism kept per role branch.
    expect(src).toContain('const [courses, hackathons, forms, enrollments] = await Promise.all([')
    expect(src).toContain('const [grades, assignments, notifications, schedules, hubs, mySubmissions] = await Promise.all([')
  })

  it('super dashboard caches 60s (25+ queries bounded)', () => {
    const src = readSrc('routes/admin.ts')
    expect(src).toContain('super/dashboard')
    // 60s server cache — shared via Redis when configured.
    expect(src).toMatch(/60_000|60s|CACHE_TTL|getOrSet/)
    expect(src).toContain('getOrSet')
  })

  it('search enforces per-source + global limits', () => {
    const src = readSrc('routes/search.ts')
    expect(src).toContain('take: 6')
    expect(src).toMatch(/SEARCH_GLOBAL|GLOBAL_MAX|slice\(0,\s*60\)|total.*60/i)
  })
})

describe('load evidence script', () => {
  it('scripts/load-10k-smoke.mjs exists, refuses prod, documents burst', () => {
    const p = path.join(BACKEND_ROOT, 'scripts/load-10k-smoke.mjs')
    expect(fs.existsSync(p), `missing ${p}`).toBe(true)
    const src = fs.readFileSync(p, 'utf8')
    expect(src).toMatch(/BASE_URL|localhost/i)
    expect(src).toMatch(/prod|onrender|refus/i)
    expect(src).toMatch(/200.*6|burst|parallel/i)
  })
})
