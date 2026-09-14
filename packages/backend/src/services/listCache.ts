/**
 * P0-B shared list cache — 5m getOrSet for contests/hackathons/internships.
 *
 * WHY: published lists re-queried DB per RQ refetch (contests 30s in-memory
 * per-replica, hack/intern uncached). At 10k DAU ~40k list reads/day.
 * 30s->5m = 10x fewer misses; Redis-shared via lib/cache getOrSet so N
 * replicas share (memory fallback fail-open). Tenant-segmented keys prevent
 * cross-college leaks; version generation (`:gen`) busts all pages/users
 * for a scope without KEYS scans (TTL is backstop).
 *
 * Rules: additive/backward-compat, fail-open (cache/Redis dead = loader),
 * no secrets (keys contain hashes, never tokens/PII raw).
 */
import crypto from 'crypto'
import { cache } from '../lib/cache'

export const CONTESTS_LIST_TTL_MS = 5 * 60 * 1000
export const HACKATHONS_LIST_TTL_MS = 5 * 60 * 1000
export const INTERNSHIPS_LIST_TTL_MS = 5 * 60 * 1000

// Re-exported for central TTL doc (single source; mirrors existing 60s owners).
export const PLATFORM_SETTINGS_TTL_MS = 60_000
export const STAGING_COUNTS_TTL_MS = 60_000

function hashSearch(raw: unknown): string {
  const t = String(raw ?? '').trim().slice(0, 100)
  if (!t) return 'none'
  try {
    return crypto.createHash('md5').update(t.toLowerCase()).digest('hex').slice(0, 12)
  } catch {
    return 'hasherr'
  }
}

function normToken(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (!s) return 'ALL'
  return s.toUpperCase().slice(0, 32)
}

function normPage(raw: unknown): number {
  const n = parseInt(String(raw ?? '1'), 10)
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : 1
}

function normLimit(raw: unknown): number {
  const n = parseInt(String(raw ?? '20'), 10)
  return Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 20
}

function normGen(raw: unknown): number {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

function normScope(raw: unknown): string {
  const s = String(raw ?? '').trim().slice(0, 80)
  if (!s) return 'global'
  // Allow only safe chars (college ids are cuid/uuid; global fixed).
  return s.replace(/[^a-zA-Z0-9:_-]/g, '') || 'global'
}

function normUser(raw: unknown): string {
  const s = String(raw ?? '').trim().slice(0, 80)
  if (!s) return 'anon'
  return s.replace(/[^a-zA-Z0-9:_-]/g, '') || 'anon'
}

/** Tenant segment: SUPER_ADMIN/global (or override college), else per-college. */
export function listScopeForUser(
  user: { role?: string; collegeId?: string | null } | null | undefined,
  overrideCollegeId?: string | null,
): string {
  try {
    const override = String(overrideCollegeId ?? '').trim()
    if (!user || user.role === 'SUPER_ADMIN') {
      if (override) return `college:${override.slice(0, 80)}`
      return 'global'
    }
    return `college:${user.collegeId ?? 'none'}`
  } catch {
    return 'global'
  }
}

export interface ContestsListKeyParams {
  scope: string
  userId?: string | null
  platform?: unknown
  status?: unknown
  search?: unknown
  page?: unknown
  limit?: unknown
  gen?: unknown
}

export function contestsListKey(p: ContestsListKeyParams): string {
  const scope = normScope(p.scope)
  const user = normUser(p.userId)
  const platform = normToken(p.platform)
  const status = normToken(p.status)
  const search = hashSearch(p.search)
  const page = normPage(p.page)
  const limit = normLimit(p.limit)
  const gen = normGen(p.gen)
  return `contests:list:${scope}:u:${user}:v${gen}:${platform}:${status}:${search}:p${page}:l${limit}`
}

export interface HackathonsListKeyParams {
  scope: string
  userId?: string | null
  search?: unknown
  status?: unknown
  mine?: unknown
  page?: unknown
  limit?: unknown
  gen?: unknown
}

export function hackathonsListKey(p: HackathonsListKeyParams): string {
  const scope = normScope(p.scope)
  const user = normUser(p.userId)
  const search = hashSearch(p.search)
  const status = normToken(p.status)
  const mine = normToken(p.mine)
  const page = normPage(p.page)
  const limit = normLimit(p.limit)
  const gen = normGen(p.gen)
  return `hackathons:list:${scope}:u:${user}:v${gen}:${status}:${mine}:${search}:p${page}:l${limit}`
}

export interface InternshipsListKeyParams {
  scope: string
  userId?: string | null
  search?: unknown
  mine?: unknown
  page?: unknown
  limit?: unknown
  gen?: unknown
}

export function internshipsListKey(p: InternshipsListKeyParams): string {
  const scope = normScope(p.scope)
  const user = normUser(p.userId)
  const search = hashSearch(p.search)
  const mine = normToken(p.mine)
  const page = normPage(p.page)
  const limit = normLimit(p.limit)
  const gen = normGen(p.gen)
  return `internships:list:${scope}:u:${user}:v${gen}:${mine}:${search}:p${page}:l${limit}`
}

// ---------------------------------------------------------------------------
// Version generation (bust without KEYS scan).
// - get*Version reads `*:gen:{scope}` (0 when missing).
// - bust* increments gen (old keys expire via 5m TTL; new reads use v+1).
// - All fail-open (never throws); TTL is correctness backstop.
// ---------------------------------------------------------------------------

function genKey(domain: 'contests' | 'hackathons' | 'internships', scope: string): string {
  return `${domain}:list:gen:${normScope(scope)}`
}

export async function getContestsListVersion(scope: string): Promise<number> {
  try {
    const v = await cache.get<number>(genKey('contests', scope))
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0
  } catch {
    return 0
  }
}

export async function getHackathonsListVersion(scope: string): Promise<number> {
  try {
    const v = await cache.get<number>(genKey('hackathons', scope))
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0
  } catch {
    return 0
  }
}

export async function getInternshipsListVersion(scope: string): Promise<number> {
  try {
    const v = await cache.get<number>(genKey('internships', scope))
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0
  } catch {
    return 0
  }
}

export async function bustContestsList(scope?: string): Promise<void> {
  try {
    const target = scope ? normScope(scope) : 'global'
    try {
      await cache.incr(genKey('contests', target))
    } catch {}
  } catch {}
}

export async function bustHackathonsList(scope?: string): Promise<void> {
  try {
    const target = scope ? normScope(scope) : 'global'
    try {
      await cache.incr(genKey('hackathons', target))
    } catch {}
  } catch {}
}

export async function bustInternshipsList(scope?: string): Promise<void> {
  try {
    const target = scope ? normScope(scope) : 'global'
    try {
      await cache.incr(genKey('internships', target))
    } catch {}
  } catch {}
}

/** Test-only: no-op (versions live in cache; __resetCacheForTests clears). */
export function __resetListCacheForTests(): void {}
