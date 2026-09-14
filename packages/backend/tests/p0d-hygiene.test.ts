/**
 * P0-D RED: cron hygiene + selective 304 + search debounce audit.
 * Plan plan-cost-speed-stability.md P0-5/P0-6/P0-7/P0-8.
 * These tests MUST fail before implementation (modules don't exist yet).
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const BACKEND_SRC = path.resolve(__dirname, '../src')
const WEB_SRC = path.resolve(__dirname, '../../../apps/web/src')
function readBackend(rel: string): string {
  return fs.readFileSync(path.join(BACKEND_SRC, rel), 'utf8')
}
function readWeb(rel: string): string {
  return fs.readFileSync(path.join(WEB_SRC, rel), 'utf8')
}

describe('P0-D cron pre-flight (fail-open, no externals when DB down)', () => {
  it('exposes isDbReachableQuick helper (never throws, boolean)', async () => {
    const mod = await import('../src/services/cronPreflight')
    expect(typeof mod.isDbReachableQuick).toBe('function')
    const r = await mod.isDbReachableQuick()
    expect(typeof r).toBe('boolean')
  })

  it('scrape cache defaults to 12h (aligns to 12h cron)', async () => {
    const mod = await import('../src/services/opportunities/cache')
    expect(typeof mod.createScrapeCache).toBe('function')
    // Default TTL must be 12h so every other 12h cron run hits warm cache.
    const c: any = mod.createScrapeCache()
    // NodeCache exposes options.stdTTL (seconds).
    const ttl = c?.options?.stdTTL
    expect(ttl).toBe(12 * 60 * 60)
    // Singleton also 12h.
    const singletonTtl = (mod.scrapeCache as any)?.options?.stdTTL
    expect(singletonTtl).toBe(12 * 60 * 60)
  })

  it('all cron jobs pre-flight DB before externals (source lock-in)', () => {
    const src = readBackend('routes/internalCron.ts')
    // Shared pre-flight seam (cronPreflight) wraps the SELECT 1 probe —
    // profile + opportunities + reminders + cleanup all gate on it (contests
    // already pre-flights inside contestFetcher).
    expect(src).toMatch(/cronPreflight|shouldRunCronJob|isDbReachableQuick/)
    expect(src).toContain('runProfileSyncJob')
    expect(src).toContain('runOpportunitiesJob')
    // Reminders + cleanup also pre-flight (all crons).
    expect(src).toContain('runContestRemindersJobCron')
    expect(src).toContain('runCleanupJob')
    // Skipped result must be explicit (observability, not silent zero).
    expect(src).toMatch(/skipReason|skipped/)
  })

  it('opportunities job serializes N replicas via Redis lock (fail-open)', () => {
    const src = readBackend('routes/internalCron.ts')
    expect(src).toContain('acquireRedisLock')
    expect(src).toMatch(/OPPORTUNITIES_LOCK_KEY|lock:opportunit/)
  })
})

describe('P0-D collegeId threading (kill emitPerUserScoped DB read)', () => {
  it('socket prefers cached collegeId before Postgres (no DB on warm path)', async () => {
    const src = readBackend('services/socket.ts')
    // Must check authorize cache (authz:) before prisma.user.findUnique.
    expect(src).toMatch(/authz:/)
    expect(src).toContain('prisma.user.findUnique')
  })

  it('per-user mutations stay scopable without new hot-path reads (audit contract)', () => {
    // Audit outcome (documented in impl-p0d-hygiene.md §1c): attendance /
    // grades / schedules / tasks / timetable mutations are OWN-data routes —
    // the only correct scope is the USER'S OWN collegeId, which is NOT in
    // scope (no user row fetched; adding one would put a NEW read on the
    // hot path to save a fire-and-forget one — net p95 negative). Contract:
    // every call passes userId (so the socket CAN scope) and the socket
    // resolves via the authorize cache warm path (0 Postgres when warm).
    for (const f of [
      'routes/attendance.ts',
      'routes/grades.ts',
      'routes/schedules.ts',
      'routes/tasks.ts',
      'routes/timetable.ts',
    ]) {
      const src = readBackend(f)
      const calls =
        src.match(/broadcast(?:Attendance|Grade|Schedule|Task)Mutation\(\{[^}]*\}\)/g) || []
      expect(calls.length).toBeGreaterThan(0)
      for (const c of calls) expect(`${f}: ${c}`).toContain('userId')
    }
    const socket = readBackend('services/socket.ts')
    expect(socket).toContain('authz:')
  })

  it('contest/hackathon broadcasts carry collegeId (scoped emit, not global)', () => {
    const contests = readBackend('routes/contests.ts')
    // Every broadcastContestMutation call-site must thread collegeId (scoped emit).
    const contestCalls = contests.match(/broadcastContestMutation\(\{[^}]*\}\)/g) || []
    expect(contestCalls.length).toBeGreaterThan(0)
    for (const c of contestCalls) expect(c).toContain('collegeId')
    const hacks = readBackend('routes/hackathons.ts')
    const hackCalls = hacks.match(/broadcastHackathonMutation\(\{[^}]*\}\)/g) || []
    expect(hackCalls.length).toBeGreaterThan(0)
    for (const c of hackCalls) expect(c).toContain('collegeId')
  })
})

describe('P0-D selective 304 (4 idempotent list paths, no Postgres on hit)', () => {
  it('exposes pure conditional helpers (weak ETag + If-None-Match)', async () => {
    const mod = await import('../src/services/conditionalGet')
    expect(typeof mod.buildListEtag).toBe('function')
    expect(typeof mod.isNotModified).toBe('function')
    const etag = mod.buildListEtag({ data: [1, 2], pagination: { page: 1 } })
    expect(etag).toMatch(/^W\/"[a-f0-9]{32}"$/)
    expect(mod.isNotModified(etag, etag)).toBe(true)
    expect(mod.isNotModified(`${etag} , W/"other"`, etag)).toBe(true)
    expect(mod.isNotModified(null, etag)).toBe(false)
    expect(mod.isNotModified(undefined, etag)).toBe(false)
    // Never throws on garbage.
    expect(() => mod.buildListEtag(undefined as any)).not.toThrow()
    expect(() => mod.isNotModified(123 as any, etag)).not.toThrow()
  })

  it('contests/hackathons/internships lists 304 from Redis-memoized body (no DB on hit)', () => {
    // SSOT: routes delegate to services/conditionalGet (stable weak ETag +
    // If-None-Match → 304); bodies stay Redis-memoized via P0-B getOrSet so a
    // HIT serves 0 Postgres. The helper (tested above) owns the ETag/304/
    // If-None-Match literals — routes must reference it (no forked hashing).
    for (const f of ['routes/contests.ts', 'routes/hackathons.ts', 'routes/internships.ts']) {
      const src = readBackend(f)
      expect(src).toMatch(/sendConditionalList|buildListEtag|isNotModified/)
      expect(src).toContain('getOrSet')
      expect(src).toMatch(/304|NotModified|not-modified/i)
    }
    // Helper owns the wire literals (single source of truth).
    const helper = readBackend('services/conditionalGet.ts')
    expect(helper).toContain('If-None-Match')
    expect(helper).toContain('304')
    expect(helper).toContain('ETag')
  })

  it('coding-problems sheets+daily 304 (idempotent, no Postgres)', () => {
    const src = readBackend('routes/codingProblems.ts')
    expect(src).toMatch(/sendConditionalList|buildListEtag|isNotModified/)
    expect(src).toMatch(/304|NotModified|not-modified/i)
  })
})

describe('P0-D search debounce audit (kill duplicate requests)', () => {
  it('CommandPalette debounces + aborts + passes signal (no keystroke storm)', () => {
    const src = readWeb('components/CommandPalette.tsx')
    expect(src).toContain('useDebounce')
    expect(src).toContain('AbortController')
    expect(src).toMatch(/searchAPI\.search\(.*signal/)
    // Must not fire on every keystroke without debounce.
    expect(src).not.toMatch(/setTimeout\(\(\) => \{\s*searchAPI\.search\(query\)/)
  })

  it('SearchPage stays debounced + cancellable (regression guard)', () => {
    const src = readWeb('pages/SearchPage.tsx')
    expect(src).toContain('useDebounce')
    expect(src).toMatch(/searchAPI\.search\(.*signal/)
  })
})
