/**
 * P1-3: Conditional opportunity fetch (content-hash gate + HTTP validators).
 *
 * WHY: the 12h opportunities cron rescrapes every platform page + re-enriches
 * every staging row even when upstream is byte-identical (400–1200 HTTP/day +
 * ~200 Groq calls/day, ~70% of it repeat work). This module persists
 * per-platform + per-URL fetch state (content hash + ETag/Last-Modified) in
 * the shared `cache` (Redis when configured) so:
 *  - Layer A (HTTP): `conditionalHeadersForUrl` sends If-None-Match /
 *    If-Modified-Since; `recordPageResponse` stores validators + content hash.
 *    A 304 with warm local scrape cache serves 0 bytes; a 304 with a cold
 *    cache falls back to a full fetch (fail-open, never empty).
 *  - Layer B (post-fetch): `hashOpportunities` fingerprints a platform's
 *    normalized items; an unchanged hash skips DB save + enrich (duplicates
 *    by construction). Every 4th run forces full (missed-update guard when a
 *    source mishandles validators — plan P1-3 fallback).
 *  - Layer C (enrich): `shouldSkipEnrichForContent` skips Groq when the
 *    enrich input content hash for a staging row is unchanged (reject→
 *    refetch cycles re-enrich 0 tokens).
 *
 * CONTRACT (additive / backward-compat / fail-open):
 * - Miss / corrupt state / any cache error → FULL fetch + enrich (old
 *   behavior). Skipping is allow-listed (hash match + fresh run counter).
 * - No migration: all state in shared `cache` with bounded TTLs (14d
 *   platform state, 7d page state, 7d enrich hashes, 30d run counter).
 * - Pure helpers (`hashOpportunities`, `contentHash`, `conditionalHeaders`,
 *   `shouldSkip*`) never throw and are unit-tested for field parity +
 *   dedup correctness (order-insensitive hashes, normalized titles/URLs).
 * - No secrets in keys or values (hashes + validator headers only).
 */

import crypto from 'crypto'
import { cache } from '../../lib/cache'

/** Platform fetch state TTL (covers multiple 12h cron cycles). */
export const OPP_FETCH_STATE_TTL_MS = 14 * 24 * 60 * 60 * 1000
/** Per-URL page state TTL (enrich pages change slowly). */
export const OPP_PAGE_STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Enrich content-hash TTL (reject→refetch dedup window). */
export const ENRICH_CONTENT_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Run-counter TTL (bounds the every-4th-full rotation state). */
export const OPP_RUN_COUNTER_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** Every Nth opportunities run forces a full fetch (validator-miss guard). */
export const OPP_FULL_FETCH_EVERY_N_RUNS = 4

export interface PlatformFetchState {
  /** Hash of last normalized item set (see hashOpportunities). */
  hash: string
  /** Epoch ms this state was recorded. */
  at: number
  /** Items seen (observability only). */
  count?: number
}

export interface PageFetchState {
  /** Last-seen validators (sent back as conditional headers). */
  etag?: string | null
  lastModified?: string | null
  /** Hash of last stripped content (change detection). */
  contentHash?: string | null
  /** Epoch ms this state was recorded. */
  at: number
}

function shaHex(input: string): string {
  try {
    return crypto.createHash('sha256').update(String(input)).digest('hex')
  } catch {
    return 'error'
  }
}

/** Tenant-free key: opportunity feed is global (SUPER_ADMIN-owned). Pure. */
export function platformFetchStateKey(platform: string): string {
  const p = String(platform || 'unknown').trim().toUpperCase().slice(0, 60) || 'UNKNOWN'
  return `opp:fetch:${p}`
}

/** Per-URL page state key (URL hashed — never raw URLs/PII in keys). Pure. */
export function pageFetchStateKey(url: string): string {
  return `opp:page:${shaHex(String(url || '')).slice(0, 32)}`
}

/** Enrich content-hash key per staging row. Pure. */
export function enrichContentKey(stagingId: string): string {
  return `enrich:content:${String(stagingId || 'unknown').slice(0, 120)}`
}

/** Opportunities run-counter key (every-4th-full rotation). Pure. */
export function oppRunCounterKey(): string {
  return 'opp:fetch:runs'
}

/**
 * Fingerprint a platform's normalized items. Pure, never throws.
 * Sorted `title|url|deadline` lines (lowercased, trimmed) so fetch order and
 * casing never flip the hash (dedup correctness: same set in any order →
 * same hash → correct skip; any real addition/removal/edit → new hash).
 */
export function hashOpportunities(
  items: Array<{ title?: unknown; url?: unknown; deadline?: unknown }>,
): string {
  try {
    if (!Array.isArray(items) || items.length === 0) return shaHex('empty-items')
    const lines = items.map((o) =>
      [String(o?.title ?? '').trim().toLowerCase(), String(o?.url ?? '').trim().toLowerCase(), String(o?.deadline ?? '')].join('|'),
    )
    lines.sort()
    return shaHex(lines.join('\n'))
  } catch {
    return 'error'
  }
}

/** Hash of enrich input content (fetched pages + hints). Pure, never throws. */
export function contentHash(content: string): string {
  try {
    return shaHex(String(content ?? ''))
  } catch {
    return 'error'
  }
}

/** Conditional request headers from stored validators. Pure, never throws. */
export function conditionalHeaders(state: PageFetchState | null | undefined): Record<string, string> {
  try {
    const out: Record<string, string> = {}
    if (!state || typeof state !== 'object') return out
    if (typeof state.etag === 'string' && state.etag.trim()) out['If-None-Match'] = state.etag.trim().slice(0, 500)
    if (typeof state.lastModified === 'string' && state.lastModified.trim()) out['If-Modified-Since'] = state.lastModified.trim().slice(0, 200)
    return out
  } catch {
    return {}
  }
}

/** Extract storable validators from a fetch Response's headers. Pure. */
export function validatorsFromHeaders(headers: { get?: (name: string) => string | null } | Record<string, unknown> | null | undefined): {
  etag: string | null
  lastModified: string | null
} {
  try {
    if (!headers) return { etag: null, lastModified: null }
    let etag: string | null = null
    let lastModified: string | null = null
    if (typeof (headers as { get?: unknown }).get === 'function') {
      try {
        etag = (headers as { get: (n: string) => string | null }).get('etag')
      } catch {}
      try {
        lastModified = (headers as { get: (n: string) => string | null }).get('last-modified')
      } catch {}
    } else {
      const rec = headers as Record<string, unknown>
      const pick = (...names: string[]): string | null => {
        for (const n of names) {
          const v = rec[n]
          if (typeof v === 'string' && v.trim()) return v.trim()
        }
        return null
      }
      etag = pick('etag', 'ETag', 'ETAG')
      lastModified = pick('last-modified', 'Last-Modified', 'LAST-MODIFIED')
    }
    const clean = (v: string | null): string | null => {
      if (typeof v !== 'string' || !v.trim()) return null
      return v.trim().slice(0, 500)
    }
    return { etag: clean(etag), lastModified: clean(lastModified) }
  } catch {
    return { etag: null, lastModified: null }
  }
}

/** Read a platform's fetch state. Miss/corrupt/error → null (fallback full). */
export async function getPlatformFetchState(platform: string): Promise<PlatformFetchState | null> {
  try {
    const hit = await cache.get<PlatformFetchState>(platformFetchStateKey(platform))
    if (!hit || typeof hit !== 'object') return null
    if (typeof (hit as PlatformFetchState).hash !== 'string') return null
    if (typeof (hit as PlatformFetchState).at !== 'number') return null
    return hit as PlatformFetchState
  } catch {
    return null
  }
}

/** Write a platform's fetch state (best-effort, never throws). */
export async function setPlatformFetchState(platform: string, state: PlatformFetchState): Promise<void> {
  try {
    if (!platform || !state) return
    await cache.set(platformFetchStateKey(platform), state, OPP_FETCH_STATE_TTL_MS)
  } catch {}
}

/** Read a page's fetch state. Miss/corrupt/error → null (fallback full). */
export async function getPageFetchState(url: string): Promise<PageFetchState | null> {
  try {
    if (!url) return null
    const hit = await cache.get<PageFetchState>(pageFetchStateKey(url))
    if (!hit || typeof hit !== 'object') return null
    if (typeof (hit as PageFetchState).at !== 'number') return null
    return hit as PageFetchState
  } catch {
    return null
  }
}

/** Write a page's fetch state (best-effort, never throws). */
export async function setPageFetchState(url: string, state: PageFetchState): Promise<void> {
  try {
    if (!url || !state) return
    await cache.set(pageFetchStateKey(url), state, OPP_PAGE_STATE_TTL_MS)
  } catch {}
}

/**
 * Decide whether a platform's DB save + enrich can be skipped post-fetch.
 * Pure. Skip ONLY on hash match (same normalized set). The every-4th-full
 * rotation is enforced by the caller via `forceFull` (see nextOppRunIndex).
 * Miss / corrupt / hash mismatch / `forceFull` → false (full save+enrich).
 */
export function shouldSkipPlatformSave(newHash: string, state: PlatformFetchState | null | undefined, forceFull: boolean): boolean {
  try {
    if (forceFull) return false
    if (!newHash || newHash === 'error') return false
    if (!state || typeof state !== 'object') return false
    if (typeof state.hash !== 'string' || !state.hash) return false
    return state.hash === newHash
  } catch {
    return false
  }
}

/**
 * Increment the opportunities run counter and report whether THIS run must
 * be full (every 4th). Fail-open: counter errors → run index 0 → full.
 * Pure modulo decision is `isFullFetchRun`; the counter itself needs `cache`.
 */
export function isFullFetchRun(runIndex: number): boolean {
  try {
    if (!Number.isFinite(runIndex) || runIndex < 0) return true
    return Math.floor(runIndex) % OPP_FULL_FETCH_EVERY_N_RUNS === OPP_FULL_FETCH_EVERY_N_RUNS - 1
  } catch {
    return true
  }
}

/** Next run index (starts at 1). Never throws (fail-open 0 → full run). */
export async function nextOppRunIndex(): Promise<number> {
  try {
    const n = await cache.incr(oppRunCounterKey(), OPP_RUN_COUNTER_TTL_MS)
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

/** Read a staging row's last enrich content hash. Miss/error → null (enrich). */
export async function getEnrichContentHash(stagingId: string): Promise<string | null> {
  try {
    if (!stagingId) return null
    const hit = await cache.get<string>(enrichContentKey(stagingId))
    return typeof hit === 'string' && hit ? hit : null
  } catch {
    return null
  }
}

/** Write a staging row's enrich content hash (best-effort, never throws). */
export async function setEnrichContentHash(stagingId: string, hash: string): Promise<void> {
  try {
    if (!stagingId || !hash) return
    await cache.set(enrichContentKey(stagingId), hash, ENRICH_CONTENT_TTL_MS)
  } catch {}
}

/**
 * Decide whether Groq enrich can be skipped for a staging row.
 * Pure. Skip ONLY when the freshly computed content hash matches the stored
 * one (same pages + same hints → same enrichment). Miss / mismatch / error
 * shape → false (enrich normally). Deterministic page-deadline updates still
 * run in the caller (this gate covers only the Groq call).
 */
export function shouldSkipEnrichForContent(newHash: string, storedHash: string | null | undefined): boolean {
  try {
    if (!newHash || newHash === 'error') return false
    if (typeof storedHash !== 'string' || !storedHash) return false
    return storedHash === newHash
  } catch {
    return false
  }
}
