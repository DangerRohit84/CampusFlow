-- Repair — SourceHealth casing (Order4 fresh-install P3018) → P7.
--
-- Root cause (see .ai/reports/db-wipe-rebuild.md §3b): migration
-- 20260910000001_source_health creates `"source_health"` (lowercase, matches
-- `@@map("source_health")` on model SourceHealth), but migration
-- 20260921000000_order4_enums references `"SourceHealth"` (PascalCase quoted,
-- distinct in Postgres) in 6 spots: 1× UPDATE §1 (:133), 1× SELECT §2 (:163),
-- 1× UPDATE §3 (:193), 2× ALTER §5 (:267-268) + census comment (:97). Fresh
-- `migrate reset` has only `source_health`, so Order4 fails with
-- `P3018 relation "SourceHealth" does not exist` (verified via pg_tables).
-- `platform_settings` was audited — its migration already uses lowercase,
-- no mismatch there.
--
-- Fix policy (history checksum-stable — do NOT edit applied files):
-- new repair migration, additive + idempotent, using the CANONICAL lowercase
-- `"source_health"` everywhere. On current DEV (already correct via `db push`
-- as native enum) every statement is a no-op or safe round-trip (::text).
-- On a fresh DB this file runs AFTER Order4 (timestamp 20260926 > 20260921)
-- so it does NOT unblock a bare `migrate reset` from zero — fresh installs
-- still need the documented baseline (`db push` + `resolve --applied`, see
-- wipe-rebuild §3c) until history is squashed. This repair guarantees forward
-- convergence (any DB with either casing converges to canonical lowercase +
-- SourceHealthStatus enum) and documents the 6-spot mismatch.
--
-- DEPLOY STATUS: FILE CREATED, NOT APPLIED LIVE. Deploy applies via
-- `prisma migrate deploy` (uses DIRECT_URL). Do NOT run `prisma migrate dev`
-- against prod. Do NOT re-wipe DEV (already rebuilt — verify only).
--
-- Deploy-safe notes:
-- - Additive only: no drops except Pascal-case drift table (only if it exists
--   from a partial run; canonical data preserved via ON CONFLICT DO NOTHING).
-- - Normalizes unknowns → UNKNOWN + RAISE NOTICE (never fails deploy on ghosts,
--   same safe defaults as Order4 §3). Uses UPPER(TRIM(col::text)) so re-run on
--   already-enum columns still succeeds (::text round-trip, Order12 pattern).
-- - CREATE TYPE + CREATE TABLE + CREATE INDEX use IF NOT EXISTS / DO $$ guards.
--   Manual re-run is safe (already-enum USING cast succeeds via ::text).
-- - Transactional DDL (safe at current scale; table is tiny, one row per
--   platform key). No CONCURRENTLY needed.
-- - No secrets. Backfills only (no deletes except Pascal drift merge).

-- ─────────────────────────────────────────────────────────────────────────────
-- 0) Census — run before deploy, log results (expect 0 ghosts after §2).
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('source_health', 'SourceHealth');
-- SELECT "status", COUNT(*) FROM "source_health" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT COUNT(*) FROM "source_health" WHERE UPPER(TRIM("status"::text)) NOT IN ('OK','DEGRADED','DOWN','UNKNOWN');

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Ensure canonical table exists (same DDL as 20260910000001, IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "source_health" (
  "platform" TEXT NOT NULL PRIMARY KEY,
  "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "lastRunAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastLatencyMs" INTEGER,
  "lastError" TEXT,
  "totalRuns" INTEGER NOT NULL DEFAULT 0,
  "successRuns" INTEGER NOT NULL DEFAULT 0,
  "successRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "consecutiveFails" INTEGER NOT NULL DEFAULT 0,
  "fetchedCount" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Merge Pascal-case drift (only if a partial run created "SourceHealth").
--    Canonical wins on conflict (preserves live health counters).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'SourceHealth') THEN
    -- Target may be TEXT (fresh) or ENUM (DEV already converted): branch on udt_name.
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'source_health' AND udt_name = 'SourceHealthStatus') THEN
      -- ENUM target: cast with UNKNOWN fallback (so ghosts never fail deploy).
      INSERT INTO "source_health" ("platform", "status", "lastRunAt", "lastSuccessAt", "lastLatencyMs", "lastError", "totalRuns", "successRuns", "successRate", "consecutiveFails", "fetchedCount", "updatedAt")
      SELECT "platform",
        CASE WHEN UPPER(TRIM("status"::text)) IN ('OK','DEGRADED','DOWN','UNKNOWN')
          THEN UPPER(TRIM("status"::text))::"SourceHealthStatus"
          ELSE 'UNKNOWN'::"SourceHealthStatus" END,
        "lastRunAt", "lastSuccessAt", "lastLatencyMs", "lastError", "totalRuns", "successRuns", "successRate", "consecutiveFails", "fetchedCount", "updatedAt"
      FROM "SourceHealth"
      ON CONFLICT ("platform") DO NOTHING;
    ELSE
      INSERT INTO "source_health" ("platform", "status", "lastRunAt", "lastSuccessAt", "lastLatencyMs", "lastError", "totalRuns", "successRuns", "successRate", "consecutiveFails", "fetchedCount", "updatedAt")
      SELECT "platform", "status", "lastRunAt", "lastSuccessAt", "lastLatencyMs", "lastError", "totalRuns", "successRuns", "successRate", "consecutiveFails", "fetchedCount", "updatedAt"
      FROM "SourceHealth"
      ON CONFLICT ("platform") DO NOTHING;
    END IF;
    DROP TABLE "SourceHealth";
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Normalize case/whitespace drift (no-op if clean; ::text keeps it safe on
--    already-enum columns). Branches on column type so the same file works on
--    TEXT (fresh) and ENUM (DEV already converted via Order4).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'source_health' AND column_name = 'status' AND udt_name = 'SourceHealthStatus') THEN
    -- ENUM target (current DEV): cast back to enum (data clean, enum constraint ensures valid).
    UPDATE "source_health" SET "status" = UPPER(TRIM("status"::text))::"SourceHealthStatus" WHERE "status" IS NOT NULL;
  ELSE
    -- TEXT target (fresh DB): plain text assignment.
    UPDATE "source_health" SET "status" = UPPER(TRIM("status"::text)) WHERE "status" IS NOT NULL;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Conflict log — unknowns normalizing to UNKNOWN (deploy log = audit).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "source_health" WHERE UPPER(TRIM("status"::text)) NOT IN ('OK','DEGRADED','DOWN','UNKNOWN'); IF c > 0 THEN RAISE NOTICE 'Repair source_health: % rows unknown, normalizing to UNKNOWN', c; END IF; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Normalize remaining unknowns → safe default (so §7 USING cast never fails).
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE "source_health" SET "status" = 'UNKNOWN' WHERE UPPER(TRIM("status"::text)) NOT IN ('OK','DEGRADED','DOWN','UNKNOWN') OR "status" IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) CREATE TYPE (guarded — re-runnable; same values as Order4 §4).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SourceHealthStatus') THEN CREATE TYPE "SourceHealthStatus" AS ENUM ('OK', 'DEGRADED', 'DOWN', 'UNKNOWN'); END IF; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) ALTER COLUMN TYPE "SourceHealthStatus" USING UPPER(TRIM(col::text)).
--    ::text round-trip keeps manual re-run safe (already-enum still casts).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "source_health" ALTER COLUMN "status" TYPE "SourceHealthStatus" USING UPPER(TRIM("status"::text))::"SourceHealthStatus";
ALTER TABLE "source_health" ALTER COLUMN "status" SET DEFAULT 'UNKNOWN'::"SourceHealthStatus";
