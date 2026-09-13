// services/fetch/save.ts — batched staging save (SRP extract from routes/fetch.ts).
// WHY: saveItems (120 lines: dedupe + date coerce + 2 pre-fetch + 2 createMany)
// was inline in the 1589-line fetch router. Pure DB batching, injectable db
// for tests (DIP). Behavior identical (skipDuplicates + in-memory dedupe).

import prisma from '../../config/db';
import { isEnded } from '../opportunityAgent';
import { logger } from '../../utils/logger';
import { normalizeSource } from '../opportunities/dedup';

export interface SaveItemsDb {
  hackathonStaging: {
    findMany(args: unknown): Promise<Array<{ title: string; source: string }>>;
    createMany(args: unknown): Promise<{ count: number }>;
  };
  internshipStaging: {
    findMany(args: unknown): Promise<Array<{ title: string; source: string }>>;
    createMany(args: unknown): Promise<{ count: number }>;
  };
}

export interface SaveItemsResult {
  hackathonSaved: number;
  internshipSaved: number;
  skipped: number;
}

// Helper: save fetched items to DB — 10k scale.
// BEFORE: N+1 (findFirst + create per item → 2N round-trips, ~200ms per 10 items).
// AFTER: 2 pre-fetch queries (existing title|source sets) + 2 createMany
// batches with skipDuplicates (2-4 round-trips total regardless of N).
// skipDuplicates relies on GLOBAL @@unique([title, source]); Order 2 V-24 makes
// `source` NOT NULL DEFAULT 'MANUAL' so the unique is NULL-safe (NULL≠NULL
// trap closed). In-memory + pre-fetch also normalize via normalizeSource()
// so missing/blank → 'MANUAL' collapses pre-migration and post-migration.
// PER-COLLEGE NOTE: dedupe key stays GLOBAL (title+source, no collegeId).
// Cron/fetch stamp collegeId null (shared feed); per-college visibility lives
// in HackathonStagingDecision/InternshipStagingDecision so other colleges can
// still decide the same opp — no per-college staging duplicates needed.
export async function saveItems(items: any[], adminId: string, collegeId: string | null, db: SaveItemsDb = prisma as unknown as SaveItemsDb) {
  let skipped = 0
  const hackRows: any[] = []
  const internRows: any[] = []
  const seen = new Set<string>()

  for (const opp of items) {
    if (!opp.url || !opp.title) { skipped++; continue }
    try {
      if (isEnded(opp.deadline as any, opp.title as any)) {
        logger.info(`[Save] Skipped completed (isEnded) ${opp.title} deadline=${opp.deadline}`)
        skipped++
        continue
      }
    } catch {}
    // Order 2 V-24 NULL-safe: normalize missing/blank source → 'MANUAL' so the
    // GLOBAL @@unique([title, source]) key is stable (NULL vs MANUAL collapse).
    const normSource = normalizeSource((opp as { source?: unknown }).source)
    const dedupeKey = `${opp.type}|${String(opp.title).trim().toLowerCase()}|${normSource}`
    if (seen.has(dedupeKey)) { skipped++; continue }
    seen.add(dedupeKey)

    if (opp.type === 'HACKATHON') {
      let deadlineDt: Date | null = null
      if (opp.deadline) {
        const d = new Date(opp.deadline)
        if (!isNaN(d.getTime())) deadlineDt = d
      }
      let startDt: Date | null = null
      if (opp.startDate) {
        const s = new Date(opp.startDate)
        if (!isNaN(s.getTime())) startDt = s
      }
      // Rich optional fields (fix-fetch-all-parsers): persist into existing columns
      // (no migration). teamSize/eligibility/schedule have DB columns; prizeTiers/
      // perks/venue/judging/stages fold into prizePool/location/highlights/schedule.
      const richPrizePool = (() => {
        const base = (opp.prizePool || '').toString().trim()
        const tiers = Array.isArray(opp.prizeTiers) ? opp.prizeTiers.filter(Boolean) : []
        const perks = Array.isArray(opp.perks) ? opp.perks.filter(Boolean) : []
        let out = base
        if (!out && tiers.length) out = tiers.join(', ')
        else if (tiers.length && !tiers.every((t: string) => out.includes(t))) out = [out, ...tiers.filter((t: string) => !out.includes(t))].join(', ')
        if (perks.length && !/perks?/i.test(out)) out = out ? `${out} | Perks: ${perks.join(', ')}` : `Perks: ${perks.join(', ')}`
        return out || null
      })()
      const richLocation = (opp.venue || opp.location || null) as string | null
      const richSchedule = (() => {
        if (opp.schedule) return opp.schedule
        if (Array.isArray(opp.stages) && opp.stages.length) return JSON.stringify(opp.stages)
        return null
      })()
      const richHighlights = (() => {
        if (opp.judging) return JSON.stringify([String(opp.judging).slice(0, 500)])
        return undefined
      })()
      hackRows.push({
        title: opp.title,
        description: opp.description || null,
        url: opp.url,
        organizer: opp.organizer || null,
        deadline: deadlineDt,
        startDate: startDt,
        duration: opp.duration || null,
        location: richLocation,
        mode: opp.mode || null,
        prizePool: richPrizePool,
        // Order 3: canonical Json array (was JSON-stringified String).
        themes: (Array.isArray(opp.themes) ? opp.themes : []) as any,
        website: opp.website || null,
        discord: opp.discord || null,
        participantsCount: opp.participantsCount || 0,
        inviteOnly: opp.inviteOnly || false,
        ...(opp.teamSize !== undefined && opp.teamSize !== null ? { teamSize: opp.teamSize } : {}),
        ...(opp.eligibility ? { eligibility: typeof opp.eligibility === 'string' ? opp.eligibility : JSON.stringify(opp.eligibility) } : {}),
        ...(richSchedule ? { schedule: richSchedule } : {}),
        ...(richHighlights ? { highlights: richHighlights } : {}),
        status: 'DRAFT',
        source: normSource,
        creatorId: adminId,
        collegeId: collegeId,
      })
    } else {
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
        source: normSource,
        creatorId: adminId,
        collegeId: collegeId,
      })
    }
  }

  // Single pre-fetch per table for existing (title,source) — avoids N findFirst.
  // Order 2 V-24 NULL-safe: both sides normalized (legacy NULL rows read as MANUAL).
  // Pair-match (cross-product fix): title IN × source IN over-fetches phantom
  // pairs; query exact (title, source) OR pairs so the prefetch touches only
  // candidate pairs (≤N, not |titles|×|sources|).
  async function filterExisting(rows: any[], model: 'hackathonStaging' | 'internshipStaging'): Promise<any[]> {
    if (rows.length === 0) return []
    try {
      const pairMap = new Map<string, { title: string; source: string }>()
      for (const r of rows) {
        const title = r.title as string
        const source = normalizeSource((r as { source?: unknown }).source)
        pairMap.set(`${String(title).trim().toLowerCase()}|${source}`, { title, source })
      }
      const pairs = [...pairMap.values()]
      const existing: any[] = await (db as any)[model].findMany({
        where: { OR: pairs.map((p) => ({ title: p.title, source: p.source })) },
        select: { title: true, source: true },
      })
      const existingKeys = new Set(existing.map((e: any) => `${String(e.title).trim().toLowerCase()}|${normalizeSource((e as { source?: unknown }).source)}`))
      return rows.filter((r) => !existingKeys.has(`${String(r.title).trim().toLowerCase()}|${normalizeSource((r as { source?: unknown }).source)}`))
    } catch (e: any) {
      logger.warn({ err: e?.message || e }, `[Save] pre-fetch dedupe failed for ${model}, falling back to full insert:`)
      return rows
    }
  }

  const [hackFiltered, internFiltered] = await Promise.all([
    filterExisting(hackRows, 'hackathonStaging'),
    filterExisting(internRows, 'internshipStaging'),
  ])
  skipped += hackRows.length - hackFiltered.length + (internRows.length - internFiltered.length)

  let hackathonSaved = 0
  let internshipSaved = 0
  try {
    if (hackFiltered.length > 0) {
      const res = await db.hackathonStaging.createMany({ data: hackFiltered, skipDuplicates: true })
      hackathonSaved = res.count
      skipped += hackFiltered.length - res.count
    }
  } catch (e: any) {
    logger.warn({ err: e?.message || e }, '[Save] hackathonStaging.createMany failed:')
    skipped += hackFiltered.length
  }
  try {
    if (internFiltered.length > 0) {
      const res = await db.internshipStaging.createMany({ data: internFiltered, skipDuplicates: true })
      internshipSaved = res.count
      skipped += internFiltered.length - res.count
    }
  } catch (e: any) {
    logger.warn({ err: e?.message || e }, '[Save] internshipStaging.createMany failed:')
    skipped += internFiltered.length
  }

  return { hackathonSaved, internshipSaved, skipped }
}
