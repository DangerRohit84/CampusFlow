// opportunities/dedup.ts — dedup/fuzzy SSOT (C-3 DRY fix).
// WHY: same 15-line `findMany({where:{title:{in:titles},source}})` block was
// repeated per platform (6×). One helper + one title-key normalizer.

import { normalizeTitleKey } from './text'
import type { NormalizedOpportunity } from './types'

/**
 * NULL-safe source normalizer (Order 2 V-24).
 * WHY: HackathonStaging/InternshipStaging.source is NOT NULL DEFAULT 'MANUAL'
 * and @@unique([title, source]) is GLOBAL. Postgres NULL≠NULL meant unlimited
 * (title, NULL) duplicates; every writer must map missing/blank → 'MANUAL'
 * (trimmed, upper-cased to match the closed UPPER-CASE domain:
 * DEVFOLIO..WELLFOUND + OTHER_* + MANUAL) so in-memory, pre-fetch, and DB
 * dedupe share one key. Pure — hermetic vitest, no DB.
 */
export function normalizeSource(src: unknown): string {
  const t = String(src ?? '').trim();
  if (!t) return 'MANUAL';
  return t.toUpperCase();
}

export interface DedupStore {
  findExistingByTitles(titles: string[], source: string): Promise<Set<string>>
}

export function buildTitleSet(opps: NormalizedOpportunity[]): string[] {
  return [...new Set(opps.map((o) => String(o.title || '').trim()).filter(Boolean))]
}

export async function filterNewByTitleSource(
  opps: NormalizedOpportunity[],
  source: string,
  store: DedupStore,
): Promise<NormalizedOpportunity[]> {
  const titles = buildTitleSet(opps)
  if (titles.length === 0) return opps
  const existing = await store.findExistingByTitles(titles, source)
  if (existing.size === 0) return opps
  return opps.filter((o) => !existing.has(String(o.title || '').trim()))
}

/** In-memory fuzzy dedup (no DB): drop exact + normalized-title duplicates. */
export function dedupInMemory(opps: NormalizedOpportunity[]): NormalizedOpportunity[] {
  const seen = new Set<string>()
  const out: NormalizedOpportunity[] = []
  for (const o of opps) {
    const key = `${normalizeSource((o as { source?: unknown }).source).toLowerCase()}::${normalizeTitleKey(o.title)}::${String(o.url || '').toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(o)
  }
  return out
}

/** Prisma-backed store factory (pass prisma.hackathonStaging or equivalent). */
export function prismaDedupStore(model: {
  findMany(args: unknown): Promise<Array<{ title: string }>>
}): DedupStore {
  return {
    async findExistingByTitles(titles: string[], source: string): Promise<Set<string>> {
      const norm = normalizeSource(source)
      const rows = await model.findMany({ where: { title: { in: titles }, source: norm } } as never)
      return new Set(rows.map((r) => String((r as { title: string }).title || '').trim()))
    },
  }
}
