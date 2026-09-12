-- Order 2 — Nullable-column uniques (V-24, V-25) → P4.
-- Fixes Postgres NULL≠NULL trap where @@unique([title, source]) and
-- @@unique([name, collegeId]) / @@unique([feature, fallbackOrder, collegeId])
-- allowed unlimited duplicate "global" (NULL) rows.
--
-- DEPLOY STATUS: FILE CREATED, NOT APPLIED LIVE. Deploy applies via
-- `prisma migrate deploy`. Do NOT run `prisma migrate dev` against prod.
--
-- Design (per-college decision design preserved):
-- - HackathonStaging/InternshipStaging @@unique([title, source]) stays GLOBAL
--   (no collegeId in key) so every college can decide the same opp independently.
--   Per-college visibility lives in HackathonStagingDecision /
--   InternshipStagingDecision (UNIQUE(stagingId, collegeId)). Cron stamps
--   collegeId NULL (global shared feed). This migration only makes `source`
--   NOT NULL DEFAULT 'MANUAL' so the global unique actually dedupes.
-- - AiProvider.collegeId / AiRouting.collegeId stay nullable (NULL = global).
--   The composite @@unique covers tenant rows; partial UNIQUE WHERE
--   "collegeId" IS NULL closes the global hole (Prisma cannot express partial
--   indexes, so they live here + are documented in schema.prisma comments).
--
-- Deploy-safe notes (P4/P5):
-- - Additive only: no table/column drops, no renames, no type rewrites.
-- - Backfill BEFORE SET NOT NULL: UPDATE NULL/blank → 'MANUAL' first.
--   On large tables run the UPDATE in batches outside this file:
--     UPDATE "HackathonStaging" SET "source"='MANUAL'
--       WHERE "id" IN (SELECT "id" FROM "HackathonStaging"
--         WHERE "source" IS NULL OR btrim("source")='' LIMIT 1000);
--   then repeat until 0 rows, then run this migration.
-- - Census before deploy:
--     SELECT COUNT(*) FROM "HackathonStaging" WHERE "source" IS NULL OR btrim("source")='';
--     SELECT COUNT(*) FROM "InternshipStaging" WHERE "source" IS NULL OR btrim("source")='';
--     SELECT "title", COUNT(*) FROM "HackathonStaging" WHERE "source" IS NULL GROUP BY "title" HAVING COUNT(*)>1;
--     SELECT "name", COUNT(*) FROM "AiProvider" WHERE "collegeId" IS NULL GROUP BY "name" HAVING COUNT(*)>1;
--   Resolve duplicates first (keep newest, delete rest) or the UNIQUE/partial
--   indexes will fail on deploy (intended — fails closed, no silent collapse).
-- - This file uses transactional ADD CONSTRAINT + CREATE INDEX (safe at current
--   scale). Past ~1M rows, run the equivalent OUTSIDE a transaction instead:
--     CREATE UNIQUE INDEX CONCURRENTLY ...; ALTER TABLE ... ADD CONSTRAINT ... NOT VALID;
--     ALTER TABLE ... VALIDATE CONSTRAINT ...; (then prisma migrate resolve --applied)
--   Prisma `migrate deploy` runs in a transaction so CONCURRENTLY cannot live here.
-- - Idempotent: every statement is IF NOT EXISTS / DO $$ guarded — safe to re-run
--   via `prisma migrate deploy`.
-- - No secrets. No destructive deletes (only NULL→'MANUAL' backfill).

-- ═══════════════════════════════════════════════════════════════════
-- 0) Backfill NULL/blank staging sources → 'MANUAL' (must precede NOT NULL)
-- ═══════════════════════════════════════════════════════════════════
UPDATE "HackathonStaging" SET "source" = 'MANUAL' WHERE "source" IS NULL OR btrim("source") = '';
UPDATE "InternshipStaging" SET "source" = 'MANUAL' WHERE "source" IS NULL OR btrim("source") = '';

-- ═══════════════════════════════════════════════════════════════════
-- 1) Defaults (Prisma @default("MANUAL") — new writes never NULL)
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE "HackathonStaging" ALTER COLUMN "source" SET DEFAULT 'MANUAL';
ALTER TABLE "InternshipStaging" ALTER COLUMN "source" SET DEFAULT 'MANUAL';

-- ═══════════════════════════════════════════════════════════════════
-- 2) NOT NULL via validated CHECK (PG12+ O(1) SET NOT NULL after CHECK)
--    Fix-list P5 step: CHECK NOT VALID → VALIDATE → SET NOT NULL.
-- ═══════════════════════════════════════════════════════════════════
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HackathonStaging_source_not_null_chk') THEN ALTER TABLE "HackathonStaging" ADD CONSTRAINT "HackathonStaging_source_not_null_chk" CHECK ("source" IS NOT NULL AND btrim("source") <> '') NOT VALID; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InternshipStaging_source_not_null_chk') THEN ALTER TABLE "InternshipStaging" ADD CONSTRAINT "InternshipStaging_source_not_null_chk" CHECK ("source" IS NOT NULL AND btrim("source") <> '') NOT VALID; END IF; END $$;
ALTER TABLE "HackathonStaging" VALIDATE CONSTRAINT "HackathonStaging_source_not_null_chk";
ALTER TABLE "InternshipStaging" VALIDATE CONSTRAINT "InternshipStaging_source_not_null_chk";
ALTER TABLE "HackathonStaging" ALTER COLUMN "source" SET NOT NULL;
ALTER TABLE "InternshipStaging" ALTER COLUMN "source" SET NOT NULL;

-- ═══════════════════════════════════════════════════════════════════
-- 3) Partial UNIQUEs for global (NULL-college) provider/routing rows (V-25)
--    Composite @@unique covers tenant rows; these cover globals where
--    NULL!=NULL would otherwise allow duplicates. IF NOT EXISTS = idempotent.
-- ═══════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS "AiProvider_name_global_unique" ON "AiProvider"("name") WHERE "collegeId" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "AiRouting_feature_order_global_unique" ON "AiRouting"("feature", "fallbackOrder") WHERE "collegeId" IS NULL;

-- Note: @@unique([title, source]) on staging needs no extra index — making
-- `source` NOT NULL is sufficient (B-tree unique now sees every value).
-- No collegeId added to the key by design (global feed + decision tables).
