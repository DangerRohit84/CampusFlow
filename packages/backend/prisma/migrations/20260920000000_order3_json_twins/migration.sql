-- Order 3 — Dual-write String-JSON + Json twins → one canonical Json per fact (V-07→V-12) → P2/P6.
--
-- DEPLOY STATUS: FILE CREATED, NOT APPLIED LIVE. Deploy applies via
-- `prisma migrate deploy` (uses DIRECT_URL). Do NOT run `prisma migrate dev`
-- against prod. Code in this release writes/reads ONLY the canonical Json
-- base names (themes, targetDepartments, targetYears, solutions); deploy must
-- apply this migration THEN restart with new code (big-bang, not rolling —
-- old code reading String twins will P2022/miss after DROP, new code reading
-- Json will P2022 before this migration — either order breaks rolling, so do
-- not run old+new code concurrently during deploy).
--
-- Design (per twin pair, canonical = Json base name):
-- - Hackathon (V-07): themes, targetDepartments, targetYears (3 pairs)
-- - HackathonStaging (V-08): themes, targetDepartments, targetYears (3)
-- - InternshipStaging (V-09): targetDepartments, targetYears (2)
-- - Internship (V-10): targetDepartments, targetYears (2)
-- - Form (V-11): targetDepartments, targetYears (2)
-- - CodingContest (V-12): solutions (1)
-- Total 13 pairs. Loser = legacy String column (TEXT holding JSON). Winner =
-- existing *Json twin (JSONB), renamed to the base name so API field names
-- (themes, targetDepartments, targetYears, solutions) are preserved — only the
-- type changes (String JSON → Json array). Frontend must handle both during
-- rollout: `Array.isArray(v) ? v : JSON.parse(v || '[]')` (backend validators
-- `parseJsonArraySafe`/`parseJsonNumberArraySafe` already accept both).
-- Out of scope (stay String, tracked Order 9): Hackathon/Staging eligibility,
-- bootcamps, highlights; User.preferences; CodingProfile.platformStats;
-- metadata blobs; FormField.logic/scoreMap; FormResponse.answers.
--
-- Documented order (P5 expand→backfill→contract, single file):
--  0) Census (commented SELECTs — run before deploy, log counts, resolve dups).
--  1) Backfill Json twins from String where Json IS NULL and String is valid
--     JSON (pg_input_is_valid, PG16+ — Neon is PG17; fails closed on invalid,
--     never overwrites existing Json — Json wins on conflict, logged in §2).
--  2) Conflict NOTICE per column (RAISE NOTICE with invalid counts — deploy
--     logs are the conflict log; invalid rows normalize to [] in §3).
--  3) Normalize remaining NULL Json twins to '[]' (so SET NOT NULL holds).
--  4) Contract: DROP String base + RENAME Json twin → base, guarded by
--     `IF EXISTS (…themesJson)` so re-run via manual SQL skips safely
--     (migrate deploy never re-applies — tracked in _prisma_migrations).
--  5) SET DEFAULT '[]' + SET NOT NULL on all 13 canonical (empty array = open).
--  6) Drop useless B-tree on serialized String (HackathonStaging targetDepartments,
--     P8) + CREATE 10 GIN indexes on canonical targeting Json for future
--     containment (@>, ?, ?|, ?&). No GIN on solutions (read-whole, no
--     containment query — add only with EXPLAIN budget, P8).
--
-- Deploy-safe notes:
-- - Requires PG16+ for pg_input_is_valid (Neon PG17 OK). On older PG, replace
--   §1 predicates with regex pre-filter + per-row DO…EXCEPTION backfill.
-- - Transactional DDL (safe at current scale). Past ~1M rows, split §1/§3
--   UPDATEs into batches outside this file:
--     UPDATE "Hackathon" SET "themesJson" = "themes"::jsonb WHERE "id" IN
--       (SELECT "id" FROM "Hackathon" WHERE "themesJson" IS NULL AND "themes"
--        IS NOT NULL LIMIT 1000); -- repeat until 0, then run this migration.
-- - Prisma schema uses @@index(..., type: Gin, map: "<Table>_<col>_gin") so
--   these CREATE INDEX names match exactly (no drift on next migrate diff).
-- - Idempotent via migrate deploy tracking; manual re-run fails closed at §1
--   (missing *Json after rename) before any DROP — never silently drops canonical.
-- - No secrets. Backfills only (no deletes beyond column drops).

-- ─────────────────────────────────────────────────────────────────────────────
-- 0) Census — run before deploy, log results, quarantine unparseable rows.
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT 'Hackathon.themes' AS col, COUNT(*) FROM "Hackathon" WHERE "themes" IS NOT NULL AND btrim("themes") <> '' AND NOT pg_input_is_valid("themes", 'json');
-- SELECT 'Hackathon.targetDepartments', COUNT(*) FROM "Hackathon" WHERE "targetDepartments" IS NOT NULL AND btrim("targetDepartments") <> '' AND NOT pg_input_is_valid("targetDepartments", 'json');
-- SELECT 'Hackathon.targetYears', COUNT(*) FROM "Hackathon" WHERE "targetYears" IS NOT NULL AND btrim("targetYears") <> '' AND NOT pg_input_is_valid("targetYears", 'json');
-- SELECT 'HackathonStaging.themes', COUNT(*) FROM "HackathonStaging" WHERE "themes" IS NOT NULL AND btrim("themes") <> '' AND NOT pg_input_is_valid("themes", 'json');
-- SELECT 'HackathonStaging.targetDepartments', COUNT(*) FROM "HackathonStaging" WHERE "targetDepartments" IS NOT NULL AND btrim("targetDepartments") <> '' AND NOT pg_input_is_valid("targetDepartments", 'json');
-- SELECT 'HackathonStaging.targetYears', COUNT(*) FROM "HackathonStaging" WHERE "targetYears" IS NOT NULL AND btrim("targetYears") <> '' AND NOT pg_input_is_valid("targetYears", 'json');
-- SELECT 'InternshipStaging.targetDepartments', COUNT(*) FROM "InternshipStaging" WHERE "targetDepartments" IS NOT NULL AND btrim("targetDepartments") <> '' AND NOT pg_input_is_valid("targetDepartments", 'json');
-- SELECT 'InternshipStaging.targetYears', COUNT(*) FROM "InternshipStaging" WHERE "targetYears" IS NOT NULL AND btrim("targetYears") <> '' AND NOT pg_input_is_valid("targetYears", 'json');
-- SELECT 'Internship.targetDepartments', COUNT(*) FROM "Internship" WHERE "targetDepartments" IS NOT NULL AND btrim("targetDepartments") <> '' AND NOT pg_input_is_valid("targetDepartments", 'json');
-- SELECT 'Internship.targetYears', COUNT(*) FROM "Internship" WHERE "targetYears" IS NOT NULL AND btrim("targetYears") <> '' AND NOT pg_input_is_valid("targetYears", 'json');
-- SELECT 'Form.targetDepartments', COUNT(*) FROM "Form" WHERE "targetDepartments" IS NOT NULL AND btrim("targetDepartments") <> '' AND NOT pg_input_is_valid("targetDepartments", 'json');
-- SELECT 'Form.targetYears', COUNT(*) FROM "Form" WHERE "targetYears" IS NOT NULL AND btrim("targetYears") <> '' AND NOT pg_input_is_valid("targetYears", 'json');
-- SELECT 'CodingContest.solutions', COUNT(*) FROM "CodingContest" WHERE "solutions" IS NOT NULL AND btrim("solutions") <> '' AND NOT pg_input_is_valid("solutions", 'json');
-- -- Verify-zero-diff after §1 (expect 0 for each):
-- -- SELECT COUNT(*) FROM "Hackathon" WHERE "themesJson" IS DISTINCT FROM "themes"::jsonb AND "themes" IS NOT NULL AND pg_input_is_valid("themes", 'json');
-- -- (Repeat per pair; Json wins — diff means String had valid JSON Json lacked, now backfilled.)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Backfill Json twins from String where valid (Json wins on conflict).
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE "Hackathon" SET "themesJson" = "themes"::jsonb WHERE "themesJson" IS NULL AND "themes" IS NOT NULL AND btrim("themes") <> '' AND pg_input_is_valid("themes", 'json');
UPDATE "Hackathon" SET "targetDepartmentsJson" = "targetDepartments"::jsonb WHERE "targetDepartmentsJson" IS NULL AND "targetDepartments" IS NOT NULL AND btrim("targetDepartments") <> '' AND pg_input_is_valid("targetDepartments", 'json');
UPDATE "Hackathon" SET "targetYearsJson" = "targetYears"::jsonb WHERE "targetYearsJson" IS NULL AND "targetYears" IS NOT NULL AND btrim("targetYears") <> '' AND pg_input_is_valid("targetYears", 'json');

UPDATE "HackathonStaging" SET "themesJson" = "themes"::jsonb WHERE "themesJson" IS NULL AND "themes" IS NOT NULL AND btrim("themes") <> '' AND pg_input_is_valid("themes", 'json');
UPDATE "HackathonStaging" SET "targetDepartmentsJson" = "targetDepartments"::jsonb WHERE "targetDepartmentsJson" IS NULL AND "targetDepartments" IS NOT NULL AND btrim("targetDepartments") <> '' AND pg_input_is_valid("targetDepartments", 'json');
UPDATE "HackathonStaging" SET "targetYearsJson" = "targetYears"::jsonb WHERE "targetYearsJson" IS NULL AND "targetYears" IS NOT NULL AND btrim("targetYears") <> '' AND pg_input_is_valid("targetYears", 'json');

UPDATE "InternshipStaging" SET "targetDepartmentsJson" = "targetDepartments"::jsonb WHERE "targetDepartmentsJson" IS NULL AND "targetDepartments" IS NOT NULL AND btrim("targetDepartments") <> '' AND pg_input_is_valid("targetDepartments", 'json');
UPDATE "InternshipStaging" SET "targetYearsJson" = "targetYears"::jsonb WHERE "targetYearsJson" IS NULL AND "targetYears" IS NOT NULL AND btrim("targetYears") <> '' AND pg_input_is_valid("targetYears", 'json');

UPDATE "Internship" SET "targetDepartmentsJson" = "targetDepartments"::jsonb WHERE "targetDepartmentsJson" IS NULL AND "targetDepartments" IS NOT NULL AND btrim("targetDepartments") <> '' AND pg_input_is_valid("targetDepartments", 'json');
UPDATE "Internship" SET "targetYearsJson" = "targetYears"::jsonb WHERE "targetYearsJson" IS NULL AND "targetYears" IS NOT NULL AND btrim("targetYears") <> '' AND pg_input_is_valid("targetYears", 'json');

UPDATE "Form" SET "targetDepartmentsJson" = "targetDepartments"::jsonb WHERE "targetDepartmentsJson" IS NULL AND "targetDepartments" IS NOT NULL AND btrim("targetDepartments") <> '' AND pg_input_is_valid("targetDepartments", 'json');
UPDATE "Form" SET "targetYearsJson" = "targetYears"::jsonb WHERE "targetYearsJson" IS NULL AND "targetYears" IS NOT NULL AND btrim("targetYears") <> '' AND pg_input_is_valid("targetYears", 'json');

UPDATE "CodingContest" SET "solutionsJson" = "solutions"::jsonb WHERE "solutionsJson" IS NULL AND "solutions" IS NOT NULL AND btrim("solutions") <> '' AND pg_input_is_valid("solutions", 'json');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Conflict log — invalid String JSON normalizing to [] (deploy log = audit).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "Hackathon" WHERE "themesJson" IS NULL AND "themes" IS NOT NULL AND btrim("themes") <> '' AND NOT pg_input_is_valid("themes", 'json'); IF c > 0 THEN RAISE NOTICE 'Order3 conflict: Hackathon.themes % rows invalid JSON, normalizing to []', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "Hackathon" WHERE "targetDepartmentsJson" IS NULL AND "targetDepartments" IS NOT NULL AND btrim("targetDepartments") <> '' AND NOT pg_input_is_valid("targetDepartments", 'json'); IF c > 0 THEN RAISE NOTICE 'Order3 conflict: Hackathon.targetDepartments % rows invalid JSON, normalizing to []', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "Hackathon" WHERE "targetYearsJson" IS NULL AND "targetYears" IS NOT NULL AND btrim("targetYears") <> '' AND NOT pg_input_is_valid("targetYears", 'json'); IF c > 0 THEN RAISE NOTICE 'Order3 conflict: Hackathon.targetYears % rows invalid JSON, normalizing to []', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "HackathonStaging" WHERE "themesJson" IS NULL AND "themes" IS NOT NULL AND btrim("themes") <> '' AND NOT pg_input_is_valid("themes", 'json'); IF c > 0 THEN RAISE NOTICE 'Order3 conflict: HackathonStaging.themes % rows invalid JSON, normalizing to []', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "HackathonStaging" WHERE "targetDepartmentsJson" IS NULL AND "targetDepartments" IS NOT NULL AND btrim("targetDepartments") <> '' AND NOT pg_input_is_valid("targetDepartments", 'json'); IF c > 0 THEN RAISE NOTICE 'Order3 conflict: HackathonStaging.targetDepartments % rows invalid JSON, normalizing to []', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "HackathonStaging" WHERE "targetYearsJson" IS NULL AND "targetYears" IS NOT NULL AND btrim("targetYears") <> '' AND NOT pg_input_is_valid("targetYears", 'json'); IF c > 0 THEN RAISE NOTICE 'Order3 conflict: HackathonStaging.targetYears % rows invalid JSON, normalizing to []', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "InternshipStaging" WHERE "targetDepartmentsJson" IS NULL AND "targetDepartments" IS NOT NULL AND btrim("targetDepartments") <> '' AND NOT pg_input_is_valid("targetDepartments", 'json'); IF c > 0 THEN RAISE NOTICE 'Order3 conflict: InternshipStaging.targetDepartments % rows invalid JSON, normalizing to []', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "InternshipStaging" WHERE "targetYearsJson" IS NULL AND "targetYears" IS NOT NULL AND btrim("targetYears") <> '' AND NOT pg_input_is_valid("targetYears", 'json'); IF c > 0 THEN RAISE NOTICE 'Order3 conflict: InternshipStaging.targetYears % rows invalid JSON, normalizing to []', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "Internship" WHERE "targetDepartmentsJson" IS NULL AND "targetDepartments" IS NOT NULL AND btrim("targetDepartments") <> '' AND NOT pg_input_is_valid("targetDepartments", 'json'); IF c > 0 THEN RAISE NOTICE 'Order3 conflict: Internship.targetDepartments % rows invalid JSON, normalizing to []', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "Internship" WHERE "targetYearsJson" IS NULL AND "targetYears" IS NOT NULL AND btrim("targetYears") <> '' AND NOT pg_input_is_valid("targetYears", 'json'); IF c > 0 THEN RAISE NOTICE 'Order3 conflict: Internship.targetYears % rows invalid JSON, normalizing to []', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "Form" WHERE "targetDepartmentsJson" IS NULL AND "targetDepartments" IS NOT NULL AND btrim("targetDepartments") <> '' AND NOT pg_input_is_valid("targetDepartments", 'json'); IF c > 0 THEN RAISE NOTICE 'Order3 conflict: Form.targetDepartments % rows invalid JSON, normalizing to []', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "Form" WHERE "targetYearsJson" IS NULL AND "targetYears" IS NOT NULL AND btrim("targetYears") <> '' AND NOT pg_input_is_valid("targetYears", 'json'); IF c > 0 THEN RAISE NOTICE 'Order3 conflict: Form.targetYears % rows invalid JSON, normalizing to []', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "CodingContest" WHERE "solutionsJson" IS NULL AND "solutions" IS NOT NULL AND btrim("solutions") <> '' AND NOT pg_input_is_valid("solutions", 'json'); IF c > 0 THEN RAISE NOTICE 'Order3 conflict: CodingContest.solutions % rows invalid JSON, normalizing to []', c; END IF; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Normalize remaining NULL Json twins to [] (empty = open/no targeting).
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE "Hackathon" SET "themesJson" = '[]'::jsonb WHERE "themesJson" IS NULL;
UPDATE "Hackathon" SET "targetDepartmentsJson" = '[]'::jsonb WHERE "targetDepartmentsJson" IS NULL;
UPDATE "Hackathon" SET "targetYearsJson" = '[]'::jsonb WHERE "targetYearsJson" IS NULL;
UPDATE "HackathonStaging" SET "themesJson" = '[]'::jsonb WHERE "themesJson" IS NULL;
UPDATE "HackathonStaging" SET "targetDepartmentsJson" = '[]'::jsonb WHERE "targetDepartmentsJson" IS NULL;
UPDATE "HackathonStaging" SET "targetYearsJson" = '[]'::jsonb WHERE "targetYearsJson" IS NULL;
UPDATE "InternshipStaging" SET "targetDepartmentsJson" = '[]'::jsonb WHERE "targetDepartmentsJson" IS NULL;
UPDATE "InternshipStaging" SET "targetYearsJson" = '[]'::jsonb WHERE "targetYearsJson" IS NULL;
UPDATE "Internship" SET "targetDepartmentsJson" = '[]'::jsonb WHERE "targetDepartmentsJson" IS NULL;
UPDATE "Internship" SET "targetYearsJson" = '[]'::jsonb WHERE "targetYearsJson" IS NULL;
UPDATE "Form" SET "targetDepartmentsJson" = '[]'::jsonb WHERE "targetDepartmentsJson" IS NULL;
UPDATE "Form" SET "targetYearsJson" = '[]'::jsonb WHERE "targetYearsJson" IS NULL;
UPDATE "CodingContest" SET "solutionsJson" = '[]'::jsonb WHERE "solutionsJson" IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Contract: DROP String loser + RENAME Json twin → base (guarded, single-apply).
--    Guard `IF EXISTS (…Json)` skips safely if manually re-run post-rename
--    (migrate deploy never re-applies — tracked). Plain backfills above fail
--    closed first on re-run, so these guards are defense-in-depth.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Hackathon' AND column_name = 'themesJson') THEN ALTER TABLE "Hackathon" DROP COLUMN IF EXISTS "themes"; ALTER TABLE "Hackathon" RENAME COLUMN "themesJson" TO "themes"; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Hackathon' AND column_name = 'targetDepartmentsJson') THEN ALTER TABLE "Hackathon" DROP COLUMN IF EXISTS "targetDepartments"; ALTER TABLE "Hackathon" RENAME COLUMN "targetDepartmentsJson" TO "targetDepartments"; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Hackathon' AND column_name = 'targetYearsJson') THEN ALTER TABLE "Hackathon" DROP COLUMN IF EXISTS "targetYears"; ALTER TABLE "Hackathon" RENAME COLUMN "targetYearsJson" TO "targetYears"; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'HackathonStaging' AND column_name = 'themesJson') THEN ALTER TABLE "HackathonStaging" DROP COLUMN IF EXISTS "themes"; ALTER TABLE "HackathonStaging" RENAME COLUMN "themesJson" TO "themes"; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'HackathonStaging' AND column_name = 'targetDepartmentsJson') THEN ALTER TABLE "HackathonStaging" DROP COLUMN IF EXISTS "targetDepartments"; ALTER TABLE "HackathonStaging" RENAME COLUMN "targetDepartmentsJson" TO "targetDepartments"; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'HackathonStaging' AND column_name = 'targetYearsJson') THEN ALTER TABLE "HackathonStaging" DROP COLUMN IF EXISTS "targetYears"; ALTER TABLE "HackathonStaging" RENAME COLUMN "targetYearsJson" TO "targetYears"; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'InternshipStaging' AND column_name = 'targetDepartmentsJson') THEN ALTER TABLE "InternshipStaging" DROP COLUMN IF EXISTS "targetDepartments"; ALTER TABLE "InternshipStaging" RENAME COLUMN "targetDepartmentsJson" TO "targetDepartments"; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'InternshipStaging' AND column_name = 'targetYearsJson') THEN ALTER TABLE "InternshipStaging" DROP COLUMN IF EXISTS "targetYears"; ALTER TABLE "InternshipStaging" RENAME COLUMN "targetYearsJson" TO "targetYears"; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Internship' AND column_name = 'targetDepartmentsJson') THEN ALTER TABLE "Internship" DROP COLUMN IF EXISTS "targetDepartments"; ALTER TABLE "Internship" RENAME COLUMN "targetDepartmentsJson" TO "targetDepartments"; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Internship' AND column_name = 'targetYearsJson') THEN ALTER TABLE "Internship" DROP COLUMN IF EXISTS "targetYears"; ALTER TABLE "Internship" RENAME COLUMN "targetYearsJson" TO "targetYears"; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Form' AND column_name = 'targetDepartmentsJson') THEN ALTER TABLE "Form" DROP COLUMN IF EXISTS "targetDepartments"; ALTER TABLE "Form" RENAME COLUMN "targetDepartmentsJson" TO "targetDepartments"; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Form' AND column_name = 'targetYearsJson') THEN ALTER TABLE "Form" DROP COLUMN IF EXISTS "targetYears"; ALTER TABLE "Form" RENAME COLUMN "targetYearsJson" TO "targetYears"; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'CodingContest' AND column_name = 'solutionsJson') THEN ALTER TABLE "CodingContest" DROP COLUMN IF EXISTS "solutions"; ALTER TABLE "CodingContest" RENAME COLUMN "solutionsJson" TO "solutions"; END IF; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Defaults + NOT NULL on canonical (empty array = open; matches Prisma
--    `Json @default("[]")`). UPDATE first so SET NOT NULL holds even if §3
--    raced with concurrent writes (deploy window has no writers — big-bang).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "Hackathon" ALTER COLUMN "themes" SET DEFAULT '[]'::jsonb;
UPDATE "Hackathon" SET "themes" = '[]'::jsonb WHERE "themes" IS NULL;
ALTER TABLE "Hackathon" ALTER COLUMN "themes" SET NOT NULL;
ALTER TABLE "Hackathon" ALTER COLUMN "targetDepartments" SET DEFAULT '[]'::jsonb;
UPDATE "Hackathon" SET "targetDepartments" = '[]'::jsonb WHERE "targetDepartments" IS NULL;
ALTER TABLE "Hackathon" ALTER COLUMN "targetDepartments" SET NOT NULL;
ALTER TABLE "Hackathon" ALTER COLUMN "targetYears" SET DEFAULT '[]'::jsonb;
UPDATE "Hackathon" SET "targetYears" = '[]'::jsonb WHERE "targetYears" IS NULL;
ALTER TABLE "Hackathon" ALTER COLUMN "targetYears" SET NOT NULL;

ALTER TABLE "HackathonStaging" ALTER COLUMN "themes" SET DEFAULT '[]'::jsonb;
UPDATE "HackathonStaging" SET "themes" = '[]'::jsonb WHERE "themes" IS NULL;
ALTER TABLE "HackathonStaging" ALTER COLUMN "themes" SET NOT NULL;
ALTER TABLE "HackathonStaging" ALTER COLUMN "targetDepartments" SET DEFAULT '[]'::jsonb;
UPDATE "HackathonStaging" SET "targetDepartments" = '[]'::jsonb WHERE "targetDepartments" IS NULL;
ALTER TABLE "HackathonStaging" ALTER COLUMN "targetDepartments" SET NOT NULL;
ALTER TABLE "HackathonStaging" ALTER COLUMN "targetYears" SET DEFAULT '[]'::jsonb;
UPDATE "HackathonStaging" SET "targetYears" = '[]'::jsonb WHERE "targetYears" IS NULL;
ALTER TABLE "HackathonStaging" ALTER COLUMN "targetYears" SET NOT NULL;

ALTER TABLE "InternshipStaging" ALTER COLUMN "targetDepartments" SET DEFAULT '[]'::jsonb;
UPDATE "InternshipStaging" SET "targetDepartments" = '[]'::jsonb WHERE "targetDepartments" IS NULL;
ALTER TABLE "InternshipStaging" ALTER COLUMN "targetDepartments" SET NOT NULL;
ALTER TABLE "InternshipStaging" ALTER COLUMN "targetYears" SET DEFAULT '[]'::jsonb;
UPDATE "InternshipStaging" SET "targetYears" = '[]'::jsonb WHERE "targetYears" IS NULL;
ALTER TABLE "InternshipStaging" ALTER COLUMN "targetYears" SET NOT NULL;

ALTER TABLE "Internship" ALTER COLUMN "targetDepartments" SET DEFAULT '[]'::jsonb;
UPDATE "Internship" SET "targetDepartments" = '[]'::jsonb WHERE "targetDepartments" IS NULL;
ALTER TABLE "Internship" ALTER COLUMN "targetDepartments" SET NOT NULL;
ALTER TABLE "Internship" ALTER COLUMN "targetYears" SET DEFAULT '[]'::jsonb;
UPDATE "Internship" SET "targetYears" = '[]'::jsonb WHERE "targetYears" IS NULL;
ALTER TABLE "Internship" ALTER COLUMN "targetYears" SET NOT NULL;

ALTER TABLE "Form" ALTER COLUMN "targetDepartments" SET DEFAULT '[]'::jsonb;
UPDATE "Form" SET "targetDepartments" = '[]'::jsonb WHERE "targetDepartments" IS NULL;
ALTER TABLE "Form" ALTER COLUMN "targetDepartments" SET NOT NULL;
ALTER TABLE "Form" ALTER COLUMN "targetYears" SET DEFAULT '[]'::jsonb;
UPDATE "Form" SET "targetYears" = '[]'::jsonb WHERE "targetYears" IS NULL;
ALTER TABLE "Form" ALTER COLUMN "targetYears" SET NOT NULL;

ALTER TABLE "CodingContest" ALTER COLUMN "solutions" SET DEFAULT '[]'::jsonb;
UPDATE "CodingContest" SET "solutions" = '[]'::jsonb WHERE "solutions" IS NULL;
ALTER TABLE "CodingContest" ALTER COLUMN "solutions" SET NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Indexes: drop useless B-tree on serialized String (P8, may already be gone
--    with the column — IF EXISTS) + 10 GIN on canonical targeting Json.
--    Prisma map names match schema exactly (no drift on next migrate diff).
-- ─────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS "HackathonStaging_targetDepartments_idx";
CREATE INDEX IF NOT EXISTS "Hackathon_targetDepartments_gin" ON "Hackathon" USING GIN ("targetDepartments");
CREATE INDEX IF NOT EXISTS "Hackathon_targetYears_gin" ON "Hackathon" USING GIN ("targetYears");
CREATE INDEX IF NOT EXISTS "HackathonStaging_targetDepartments_gin" ON "HackathonStaging" USING GIN ("targetDepartments");
CREATE INDEX IF NOT EXISTS "HackathonStaging_targetYears_gin" ON "HackathonStaging" USING GIN ("targetYears");
CREATE INDEX IF NOT EXISTS "InternshipStaging_targetDepartments_gin" ON "InternshipStaging" USING GIN ("targetDepartments");
CREATE INDEX IF NOT EXISTS "InternshipStaging_targetYears_gin" ON "InternshipStaging" USING GIN ("targetYears");
CREATE INDEX IF NOT EXISTS "Internship_targetDepartments_gin" ON "Internship" USING GIN ("targetDepartments");
CREATE INDEX IF NOT EXISTS "Internship_targetYears_gin" ON "Internship" USING GIN ("targetYears");
CREATE INDEX IF NOT EXISTS "Form_targetDepartments_gin" ON "Form" USING GIN ("targetDepartments");
CREATE INDEX IF NOT EXISTS "Form_targetYears_gin" ON "Form" USING GIN ("targetYears");
