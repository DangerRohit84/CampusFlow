// opportunities/registry.ts — OCP Strategy registry for platform fetchers.
// WHY: adding platform #11 required editing opportunityAgent.ts (OCP violation).
// New platform = new file + one `registerPlatform()` line, zero edits
// to orchestrator. AbortSignal threading + withRetry stay explicit at call site.
//
// SSOT (I-1 fix): this module is the SINGLE source for Fetch-All fan-out,
// enrich page routing, and cron limits. `fetch.ts` / `internalCron.ts` /
// `stages.ts` MUST import from here — never maintain local ALL_PLATFORMS /
// TYPE_MAP / if-else page lists (they drifted: UNSTOP_INTERNSHIP vs
// UNSTOP_INTERNSHIPS alias, 4 files to touch per platform).

import type { NormalizedOpportunity } from './types'

export type PlatformFetcher = (limit?: number, opts?: { signal?: AbortSignal }) => Promise<NormalizedOpportunity[]>

export type PlatformKind = 'HACKATHON' | 'INTERNSHIP'

export interface PlatformMeta {
  /** Upper-case key, e.g. 'DEVFOLIO'. */
  key: string
  /** Opportunity kind produced by this platform. */
  type: PlatformKind
  /** Fetch function (AbortSignal-aware). */
  fetcher: PlatformFetcher
  /** Enrich sub-pages to fetch ('' = overview). Single place for stages + scraper routes. */
  enrichPages: string[]
  /** URL matcher for enrich routing (falls back to key match when omitted). */
  match?: (url: string) => boolean
}

const registry = new Map<string, PlatformFetcher>()
const metaRegistry = new Map<string, PlatformMeta>()

function normKey(name: string): string {
  return String(name || '').toUpperCase()
}

export function registerPlatformFetcher(name: string, fn: PlatformFetcher): void {
  registry.set(normKey(name), fn)
}

/** Register a platform with fetch + enrich metadata (preferred for new code). */
export function registerPlatform(meta: PlatformMeta): void {
  const key = normKey(meta.key)
  const stored: PlatformMeta = { ...meta, key }
  metaRegistry.set(key, stored)
  registerPlatformFetcher(key, meta.fetcher)
  // UNSTOP backward-compat alias: UNSTOP_INTERNSHIPS -> same fetcher/meta.
  if (key === 'UNSTOP_INTERNSHIP') {
    registry.set('UNSTOP_INTERNSHIPS', meta.fetcher)
  }
}

export function getPlatformFetcher(name: string): PlatformFetcher | undefined {
  return registry.get(normKey(name))
}

/** Canonical fetch-all keys (excludes OTHER_* detached manual sources + plural alias). */
export function listFetchAllPlatforms(): string[] {
  return [...metaRegistry.keys()].sort()
}

/** @deprecated Use listFetchAllPlatforms() (excludes alias). Kept for compat. */
export function listPlatforms(): string[] {
  return [...registry.keys()].sort()
}

export function getPlatformMeta(name: string): PlatformMeta | undefined {
  const key = normKey(name)
  const direct = metaRegistry.get(key)
  if (direct) return direct
  // Alias fallback: UNSTOP_INTERNSHIPS -> UNSTOP_INTERNSHIP meta.
  if (key === 'UNSTOP_INTERNSHIPS') return metaRegistry.get('UNSTOP_INTERNSHIP')
  return undefined
}

export function getPlatformType(name: string): PlatformKind | undefined {
  return getPlatformMeta(name)?.type
}

/** SSOT map for fetch/cron (platform -> HACKATHON|INTERNSHIP). */
export function platformTypeMap(): Record<string, PlatformKind> {
  const out: Record<string, PlatformKind> = {}
  for (const [k, v] of metaRegistry) out[k] = v.type
  return out
}

function defaultMatchFor(key: string): (url: string) => boolean {
  const k = key.toLowerCase()
  return (url: string) => {
    const u = String(url || '').toLowerCase()
    if (!u) return false
    if (key === 'DEVFOLIO') return u.includes('.devfolio.co')
    if (key === 'DEVPOST') return u.includes('devpost.com')
    if (key === 'MLH') return u.includes('mlh.io')
    if (key === 'UNSTOP' || key === 'UNSTOP_INTERNSHIP') return u.includes('unstop.com')
    if (key === 'HACK2SKILL') return u.includes('hack2skill.com')
    if (key === 'DORAHACKS') return u.includes('dorahacks.io')
    if (key === 'HACKEREARTH') return u.includes('hackerearth.com')
    if (key === 'INTERNSHALA') return u.includes('internshala.com')
    if (key === 'WELLFOUND') return u.includes('wellfound.com')
    return u.includes(k)
  }
}

/**
 * Enrich pages for a staging record (SSOT for stages.ts + scraper routes).
 * Prefers explicit source match, falls back to URL substring match.
 */
export function getEnrichPagesForRecord(source: string, url: string): string[] {
  const fromSource = source ? getPlatformMeta(source) : undefined
  if (fromSource) return fromSource.enrichPages
  const u = String(url || '')
  for (const meta of metaRegistry.values()) {
    const match = meta.match ?? defaultMatchFor(meta.key)
    try {
      if (match(u)) return meta.enrichPages
    } catch { /* ignore matcher throw */ }
  }
  return ['']
}

export function clearPlatformRegistryForTests(): void {
  registry.clear()
  metaRegistry.clear()
}

/** Direct map view for orchestrators that need bulk fan-out (read-only copy). */
export function platformFetcherMap(): Record<string, PlatformFetcher> {
  const out: Record<string, PlatformFetcher> = {}
  for (const [k, v] of registry) out[k] = v
  return out
}
