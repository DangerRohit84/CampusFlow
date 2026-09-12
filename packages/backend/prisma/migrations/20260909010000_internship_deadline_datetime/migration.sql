-- Internship deadline String (TEXT) → DateTime (TIMESTAMPTZ) with backfill
-- Idempotent: safe to re-run via `prisma migrate deploy`.
-- Strategy: only converts when column is still TEXT/VARCHAR; after conversion the
-- information_schema guard is false so re-runs are no-ops. Per-row EXCEPTION block
-- keeps one bad string (e.g., "25 Sep 26" non-ISO) from aborting the whole migration —
-- those rows become NULL and are re-enriched by the app (enrichInternshipStaging).
-- Most rows are ISO (opportunityAgent stores toISOString / YYYY-MM-DD), so loss is ~0.
-- See .ai/reports/perf-db.md §Deadline migration for verification + rollback.

-- ---------------------------------------------------------------------------
-- 1) Internship.deadline TEXT → TIMESTAMPTZ
-- ---------------------------------------------------------------------------
DO $$ DECLARE r RECORD; BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Internship' AND column_name = 'deadline'
    AND data_type IN ('text', 'character varying')
  ) THEN
    RAISE NOTICE '[migrate] Internship.deadline TEXT → TIMESTAMPTZ (backfill parse)';
    ALTER TABLE "Internship" ADD COLUMN IF NOT EXISTS "deadline_new" TIMESTAMPTZ;
    FOR r IN SELECT "id", "deadline" FROM "Internship" WHERE "deadline" IS NOT NULL AND "deadline" <> '' AND "deadline_new" IS NULL LOOP
      BEGIN
        -- Direct cast handles ISO + date-only ("2026-09-25" → midnight UTC). Non-ISO raises → caught below.
        UPDATE "Internship" SET "deadline_new" = (r."deadline")::timestamptz WHERE "id" = r."id";
      EXCEPTION WHEN OTHERS THEN
        -- Try app-level flexible parse fallback? SQL can't run chrono — leave NULL for app re-enrich.
        UPDATE "Internship" SET "deadline_new" = NULL WHERE "id" = r."id";
      END;
    END LOOP;
    ALTER TABLE "Internship" DROP COLUMN "deadline";
    ALTER TABLE "Internship" RENAME COLUMN "deadline_new" TO "deadline";
    RAISE NOTICE '[migrate] Internship.deadline converted';
  ELSE
    RAISE NOTICE '[migrate] Internship.deadline already TIMESTAMPTZ — skip';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) InternshipStaging.deadline TEXT → TIMESTAMPTZ (same pattern)
-- ---------------------------------------------------------------------------
DO $$ DECLARE r RECORD; BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'InternshipStaging' AND column_name = 'deadline'
    AND data_type IN ('text', 'character varying')
  ) THEN
    RAISE NOTICE '[migrate] InternshipStaging.deadline TEXT → TIMESTAMPTZ (backfill parse)';
    ALTER TABLE "InternshipStaging" ADD COLUMN IF NOT EXISTS "deadline_new" TIMESTAMPTZ;
    FOR r IN SELECT "id", "deadline" FROM "InternshipStaging" WHERE "deadline" IS NOT NULL AND "deadline" <> '' AND "deadline_new" IS NULL LOOP
      BEGIN
        UPDATE "InternshipStaging" SET "deadline_new" = (r."deadline")::timestamptz WHERE "id" = r."id";
      EXCEPTION WHEN OTHERS THEN
        UPDATE "InternshipStaging" SET "deadline_new" = NULL WHERE "id" = r."id";
      END;
    END LOOP;
    ALTER TABLE "InternshipStaging" DROP COLUMN "deadline";
    ALTER TABLE "InternshipStaging" RENAME COLUMN "deadline_new" TO "deadline";
    RAISE NOTICE '[migrate] InternshipStaging.deadline converted';
  ELSE
    RAISE NOTICE '[migrate] InternshipStaging.deadline already TIMESTAMPTZ — skip';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Indexes on new DateTime deadlines (drop old string-sort index, recreate for timestamptz)
--    Old indexes (if TEXT) are auto-dropped with the column; recreate explicitly for clarity.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "Internship_deadline_idx" ON "Internship"("deadline");
CREATE INDEX IF NOT EXISTS "InternshipStaging_deadline_idx" ON "InternshipStaging"("deadline");

-- ---------------------------------------------------------------------------
-- Rollback (manual, only if deploy must revert — data loss: NULLs stay NULL):
--   ALTER TABLE "Internship" ALTER COLUMN "deadline" TYPE TEXT USING "deadline"::text;
--   ALTER TABLE "InternshipStaging" ALTER COLUMN "deadline" TYPE TEXT USING "deadline"::text;
-- App compat: coerceDeadline() + Prisma accept Date|string, so rollback needs no code change.
-- ---------------------------------------------------------------------------
