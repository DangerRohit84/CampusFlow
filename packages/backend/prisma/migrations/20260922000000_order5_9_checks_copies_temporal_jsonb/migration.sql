-- Order 5-9 combined (medium): CHECKs (V-27/V-03) + drop 4 display copies
-- (V-01/02/20/21) + leaderboard snapshot contract (V-29) + temporal types +
-- re-index (V-22/32) + String-JSON to JSONB + GIN (V-05/06/19/13-ops) → P1/P2/P6/P7/P10.
--
-- DEPLOY STATUS: FILE CREATED, NOT APPLIED LIVE. Deploy applies via
-- `prisma migrate deploy` (uses DIRECT_URL). Do NOT run `prisma migrate dev`
-- against prod. App code in this release is big-bang for Order 6 drops +
-- Order 9 JSONB (new code does not reference dropped cols; writers pass Json
-- objects) and additive for Order 8 temporal (dual-write old String + new typed).
-- Never run old+new concurrently for drops/JSONB (see Order 3 big-bang note).
-- For temporal new cols, rolling is safe (old code ignores new cols, new code
-- dual-writes both).
--
-- Documented order (P5 expand-backfill-contract, single file):
--  0) Census (commented SELECTs — run before deploy, log counts, fix data).
--  1) Order 5 CHECKs (NOT VALID → VALIDATE, zero-lock add).
--  2) Order 6 drops (drift census comments → DROP COLUMN IF EXISTS, one per table).
--  3) Order 7 snapshot (drift check comments only — no DDL, additive-safe).
--  4) Order 8 temporal adds (ADD COLUMN IF NOT EXISTS → batched backfill →
--     CHECKs → indexes; String cols KEPT until Order 12 contract).
--  5) Order 9 JSONB (invalid-JSON census → quarantine → ALTER TYPE USING ::jsonb
--     → SET DEFAULT → GIN → CHECK jsonb_typeof).
--
-- Deploy-safe notes:
-- - Transactional DDL (safe at current scale). Past ~1M rows, run §1/§4/§5 UPDATEs
--   in batches outside this file (LIMIT 1000 pattern) + CREATE INDEX CONCURRENTLY
--   outside a tx, then `prisma migrate resolve --applied`. Prisma `migrate deploy`
--   runs in a transaction so CONCURRENTLY cannot live here.
-- - Idempotent via migrate deploy tracking; ADD COLUMN / DROP COLUMN / CREATE INDEX
--   use IF NOT EXISTS; CHECK adds use DO $$ pg_constraint guards.
-- - Requires PG16+ for pg_input_is_valid (Neon PG17 OK).
-- - No secrets. Census/backfills only (drops are display copies with join fallback;
--   no billing/auth loss). Invalid JSON quarantined to NULL/'{}'/'[]' + NOTICE.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0) Census — run before deploy, log results, fix violating rows first.
-- ─────────────────────────────────────────────────────────────────────────────
-- Order 5 scope violations (must be 0 before §1 VALIDATE):
-- SELECT COUNT(*) FROM "AssignmentHub" WHERE NOT (
--   ("scope"='ALL' AND "departmentId" IS NULL AND "roomId" IS NULL) OR
--   ("scope"='DEPARTMENT' AND "departmentId" IS NOT NULL AND "roomId" IS NULL) OR
--   ("scope"='ROOM' AND "roomId" IS NOT NULL AND "departmentId" IS NULL));
-- Order 5 role-field violations (must be 0):
-- SELECT COUNT(*) FROM "User" WHERE NOT (
--   ("role"='STUDENT' AND "empNumber" IS NULL) OR
--   ("role" IN ('TEACHER','COLLEGE_ADMIN','SUPER_ADMIN') AND "studentId" IS NULL));
-- Order 6 drift (informational — rows where copy disagrees with canonical):
-- SELECT COUNT(*) FROM "User" u JOIN "College" c ON c.id=u."collegeId" WHERE u."collegeName" IS DISTINCT FROM c.name;
-- SELECT COUNT(*) FROM "User" u JOIN "Department" d ON d.id=u."departmentId" WHERE u."departmentName" IS DISTINCT FROM d.name;
-- SELECT COUNT(*) FROM "Report" r JOIN "College" c ON c.id=r."collegeId" WHERE r."collegeName" IS DISTINCT FROM c.name;
-- SELECT COUNT(*) FROM "Grade" g JOIN "Course" c ON c.id=g."courseId" WHERE g."courseName" IS DISTINCT FROM c.name;
-- Order 7 drift (participation snapshot vs canonical where contestId set):
-- SELECT COUNT(*) FROM "ContestParticipation" p JOIN "CodingContest" c ON c.id=p."contestId"
--   WHERE p."contestName" IS DISTINCT FROM c.title OR p."contestUrl" IS DISTINCT FROM c.url;
-- Order 8 unparseable temporal (quarantine candidates):
-- SELECT COUNT(*) FROM "CodingContest" WHERE "startTime" IS NOT NULL AND NOT pg_input_is_valid("startTime", 'timestamptz');
-- SELECT COUNT(*) FROM "Internship" WHERE "startDate" IS NOT NULL AND NOT pg_input_is_valid("startDate", 'timestamptz');
-- SELECT COUNT(*) FROM "InternshipStaging" WHERE "startDate" IS NOT NULL AND NOT pg_input_is_valid("startDate", 'timestamptz');
-- SELECT COUNT(*) FROM "AiUsage" WHERE "day" IS NOT NULL AND NOT pg_input_is_valid("day", 'date');
-- Order 9 invalid JSON (quarantine candidates, must be 0 after §5 quarantine):
-- SELECT COUNT(*) FROM "User" WHERE "preferences" IS NOT NULL AND NOT pg_input_is_valid("preferences", 'json');
-- SELECT COUNT(*) FROM "CodingProfile" WHERE "platformStats" IS NOT NULL AND NOT pg_input_is_valid("platformStats", 'json');
-- SELECT COUNT(*) FROM "Notification" WHERE "metadata" IS NOT NULL AND NOT pg_input_is_valid("metadata", 'json');
-- SELECT COUNT(*) FROM "ChatMessage" WHERE "metadata" IS NOT NULL AND NOT pg_input_is_valid("metadata", 'json');
-- SELECT COUNT(*) FROM "UserIntegration" WHERE "metadata" IS NOT NULL AND NOT pg_input_is_valid("metadata", 'json');
-- SELECT COUNT(*) FROM "AuditLog" WHERE "metadata" IS NOT NULL AND NOT pg_input_is_valid("metadata", 'json');
-- SELECT COUNT(*) FROM "AiProvider" WHERE "headers" IS NOT NULL AND NOT pg_input_is_valid("headers", 'json');
-- SELECT COUNT(*) FROM "FormField" WHERE "logic" IS NOT NULL AND NOT pg_input_is_valid("logic", 'json');
-- SELECT COUNT(*) FROM "FormField" WHERE "scoreMap" IS NOT NULL AND NOT pg_input_is_valid("scoreMap", 'json');

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Order 5 — Polymorphic-scope + role-field CHECKs (V-27 + V-03-CHECKs) → P7
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_assignmenthub_scope') THEN
    ALTER TABLE "AssignmentHub" ADD CONSTRAINT "chk_assignmenthub_scope" CHECK (
      ("scope" = 'ALL' AND "departmentId" IS NULL AND "roomId" IS NULL) OR
      ("scope" = 'DEPARTMENT' AND "departmentId" IS NOT NULL AND "roomId" IS NULL) OR
      ("scope" = 'ROOM' AND "roomId" IS NOT NULL AND "departmentId" IS NULL)
    ) NOT VALID;
  END IF;
END $$;
ALTER TABLE "AssignmentHub" VALIDATE CONSTRAINT "chk_assignmenthub_scope";

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_role_fields') THEN
    ALTER TABLE "User" ADD CONSTRAINT "chk_user_role_fields" CHECK (
      ("role" = 'STUDENT' AND "empNumber" IS NULL) OR
      ("role" IN ('TEACHER', 'COLLEGE_ADMIN', 'SUPER_ADMIN') AND "studentId" IS NULL)
    ) NOT VALID;
  END IF;
END $$;
ALTER TABLE "User" VALIDATE CONSTRAINT "chk_user_role_fields";

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Order 6 — Drop 4 transitive display copies (V-01/02/20/21) → P1/P6
-- Readers switched to joins/projections in this release (see report). Views first
-- if read-heavy; one DROP per table here (contract phase of P5).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "User" DROP COLUMN IF EXISTS "collegeName";
ALTER TABLE "User" DROP COLUMN IF EXISTS "departmentName";
ALTER TABLE "Report" DROP COLUMN IF EXISTS "collegeName";
ALTER TABLE "Grade" DROP COLUMN IF EXISTS "courseName";

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Order 7 — ContestParticipation snapshot contract (V-29) → P1/P6
-- No DDL (additive-safe). Columns contestName/contestUrl/rating/rank/score/
-- problemsSolved are SNAPSHOT_AT_SYNC (asOf syncedAt); canonical is CodingContest
-- when contestId set. syncEngine re-resolves contestId + advances syncedAt on every
-- sync; readers prefer canonical via resolveContestDisplay(). Natural key kept.
-- Drift check is §0 SELECT above; no constraint (snapshots legitimately diverge
-- between syncs by design — enforced by refresh contract, not DB).
-- ─────────────────────────────────────────────────────────────────────────────
-- (no DDL)

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Order 8 — Temporal adds + re-index (V-22/32) → P10/P8
-- Adds only; legacy String cols KEPT (dual-write in app). Contract drops in Order 12.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "Schedule" ADD COLUMN IF NOT EXISTS "startMinutes" INTEGER;
ALTER TABLE "Schedule" ADD COLUMN IF NOT EXISTS "endMinutes" INTEGER;
-- Backfill HH:MM → minutes (zero-padded + H:MM + HHMM tolerant; garbage stays NULL + NOTICE).
-- Runs in-tx at current scale; batch outside file past ~1M rows.
UPDATE "Schedule" SET "startMinutes" =
  CASE WHEN "startMinutes" IS NULL AND "startTime" ~ '^\s*\d{1,2}\s*:\s*\d{2}(\s*[AP]M)?\s*$'
    THEN (split_part(regexp_replace("startTime", '\s*([AP]M)\s*$', '', 'i'), ':', 1)::int % 24) * 60
         + split_part(regexp_replace("startTime", '\s*([AP]M)\s*$', '', 'i'), ':', 2)::int
  ELSE "startMinutes" END
WHERE "startMinutes" IS NULL;
UPDATE "Schedule" SET "endMinutes" =
  CASE WHEN "endMinutes" IS NULL AND "endTime" ~ '^\s*\d{1,2}\s*:\s*\d{2}(\s*[AP]M)?\s*$'
    THEN (split_part(regexp_replace("endTime", '\s*([AP]M)\s*$', '', 'i'), ':', 1)::int % 24) * 60
         + split_part(regexp_replace("endTime", '\s*([AP]M)\s*$', '', 'i'), ':', 2)::int
  ELSE "endMinutes" END
WHERE "endMinutes" IS NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_schedule_minutes') THEN
    ALTER TABLE "Schedule" ADD CONSTRAINT "chk_schedule_minutes" CHECK (
      ("startMinutes" IS NULL OR ("startMinutes" >= 0 AND "startMinutes" <= 1439)) AND
      ("endMinutes" IS NULL OR ("endMinutes" >= 0 AND "endMinutes" <= 1439))
    ) NOT VALID;
  END IF;
END $$;
ALTER TABLE "Schedule" VALIDATE CONSTRAINT "chk_schedule_minutes";
CREATE INDEX IF NOT EXISTS "Schedule_userId_dayOfWeek_startMinutes_idx" ON "Schedule"("userId", "dayOfWeek", "startMinutes");

ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "startAt" TIMESTAMPTZ;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "endAt" TIMESTAMPTZ;
-- Conservative backfill: day bucket where no time detail (app refines with time parse on write).
UPDATE "Task" SET "startAt" = "date" WHERE "startAt" IS NULL AND "date" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "Task_startAt_idx" ON "Task"("startAt");
CREATE INDEX IF NOT EXISTS "Task_userId_startAt_idx" ON "Task"("userId", "startAt");

ALTER TABLE "CodingContest" ADD COLUMN IF NOT EXISTS "startAt" TIMESTAMPTZ;
UPDATE "CodingContest" SET "startAt" = "startTime"::timestamptz
  WHERE "startAt" IS NULL AND "startTime" IS NOT NULL AND pg_input_is_valid("startTime", 'timestamptz');
CREATE INDEX IF NOT EXISTS "CodingContest_startAt_idx" ON "CodingContest"("startAt");
CREATE INDEX IF NOT EXISTS "CodingContest_status_startAt_idx" ON "CodingContest"("status", "startAt");

ALTER TABLE "Internship" ADD COLUMN IF NOT EXISTS "startAt" TIMESTAMPTZ;
UPDATE "Internship" SET "startAt" = "startDate"::timestamptz
  WHERE "startAt" IS NULL AND "startDate" IS NOT NULL AND pg_input_is_valid("startDate", 'timestamptz');
CREATE INDEX IF NOT EXISTS "Internship_startAt_idx" ON "Internship"("startAt");
CREATE INDEX IF NOT EXISTS "Internship_status_startAt_idx" ON "Internship"("status", "startAt");

ALTER TABLE "InternshipStaging" ADD COLUMN IF NOT EXISTS "startAt" TIMESTAMPTZ;
UPDATE "InternshipStaging" SET "startAt" = "startDate"::timestamptz
  WHERE "startAt" IS NULL AND "startDate" IS NOT NULL AND pg_input_is_valid("startDate", 'timestamptz');
CREATE INDEX IF NOT EXISTS "InternshipStaging_startAt_idx" ON "InternshipStaging"("startAt");
CREATE INDEX IF NOT EXISTS "InternshipStaging_status_startAt_idx" ON "InternshipStaging"("status", "startAt");

ALTER TABLE "AiUsage" ADD COLUMN IF NOT EXISTS "dayDate" DATE;
UPDATE "AiUsage" SET "dayDate" = "day"::date
  WHERE "dayDate" IS NULL AND "day" IS NOT NULL AND pg_input_is_valid("day", 'date');
CREATE INDEX IF NOT EXISTS "AiUsage_dayDate_idx" ON "AiUsage"("dayDate");
CREATE INDEX IF NOT EXISTS "AiUsage_collegeId_dayDate_idx" ON "AiUsage"("collegeId", "dayDate");
-- New typed unique alongside legacy String unique (contract swaps reads then drops old).
CREATE UNIQUE INDEX IF NOT EXISTS "AiUsage_college_feature_dayDate_unique"
  ON "AiUsage"("collegeId", "feature", "dayDate");

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Order 9 — String-JSON → JSONB + GIN (V-05/06/19/13-ops) → P2/P8
-- Quarantine invalid JSON first (never fail deploy on ghosts), then ALTER USING.
-- ─────────────────────────────────────────────────────────────────────────────
-- Quarantine (invalid → NULL/'{}'/'[]' + NOTICE via §0 counts):
UPDATE "User" SET "preferences" = '{}' WHERE "preferences" IS NOT NULL AND NOT pg_input_is_valid("preferences", 'json');
UPDATE "CodingProfile" SET "platformStats" = '[]' WHERE "platformStats" IS NOT NULL AND NOT pg_input_is_valid("platformStats", 'json');
UPDATE "Notification" SET "metadata" = NULL WHERE "metadata" IS NOT NULL AND NOT pg_input_is_valid("metadata", 'json');
UPDATE "ChatMessage" SET "metadata" = NULL WHERE "metadata" IS NOT NULL AND NOT pg_input_is_valid("metadata", 'json');
UPDATE "UserIntegration" SET "metadata" = NULL WHERE "metadata" IS NOT NULL AND NOT pg_input_is_valid("metadata", 'json');
UPDATE "AuditLog" SET "metadata" = NULL WHERE "metadata" IS NOT NULL AND NOT pg_input_is_valid("metadata", 'json');
UPDATE "AiProvider" SET "headers" = '{}' WHERE "headers" IS NOT NULL AND NOT pg_input_is_valid("headers", 'json');
UPDATE "FormField" SET "logic" = '{}' WHERE "logic" IS NOT NULL AND NOT pg_input_is_valid("logic", 'json');
UPDATE "FormField" SET "scoreMap" = '{}' WHERE "scoreMap" IS NOT NULL AND NOT pg_input_is_valid("scoreMap", 'json');

-- Normalize NULLs to typed defaults (keeps Prisma Json @default contract):
UPDATE "User" SET "preferences" = '{}' WHERE "preferences" IS NULL;
UPDATE "FormField" SET "logic" = '{}' WHERE "logic" IS NULL;
UPDATE "FormField" SET "scoreMap" = '{}' WHERE "scoreMap" IS NULL;
UPDATE "AiProvider" SET "headers" = '{}' WHERE "headers" IS NULL;

-- Type swaps (JSONB):
ALTER TABLE "User" ALTER COLUMN "preferences" TYPE JSONB USING "preferences"::jsonb;
ALTER TABLE "User" ALTER COLUMN "preferences" SET DEFAULT '{}';
ALTER TABLE "CodingProfile" ALTER COLUMN "platformStats" TYPE JSONB USING "platformStats"::jsonb;
ALTER TABLE "Notification" ALTER COLUMN "metadata" TYPE JSONB USING "metadata"::jsonb;
ALTER TABLE "ChatMessage" ALTER COLUMN "metadata" TYPE JSONB USING "metadata"::jsonb;
ALTER TABLE "UserIntegration" ALTER COLUMN "metadata" TYPE JSONB USING "metadata"::jsonb;
ALTER TABLE "AuditLog" ALTER COLUMN "metadata" TYPE JSONB USING "metadata"::jsonb;
ALTER TABLE "AiProvider" ALTER COLUMN "headers" TYPE JSONB USING "headers"::jsonb;
ALTER TABLE "AiProvider" ALTER COLUMN "headers" SET DEFAULT '{}';
ALTER TABLE "FormField" ALTER COLUMN "logic" TYPE JSONB USING "logic"::jsonb;
ALTER TABLE "FormField" ALTER COLUMN "logic" SET DEFAULT '{}';
ALTER TABLE "FormField" ALTER COLUMN "scoreMap" TYPE JSONB USING "scoreMap"::jsonb;
ALTER TABLE "FormField" ALTER COLUMN "scoreMap" SET DEFAULT '{}';

-- GIN (jsonb_ops default; future @>/? queries; current reads stay app-side by design):
CREATE INDEX IF NOT EXISTS "User_preferences_gin" ON "User" USING GIN ("preferences");
CREATE INDEX IF NOT EXISTS "CodingProfile_platformStats_gin" ON "CodingProfile" USING GIN ("platformStats");
CREATE INDEX IF NOT EXISTS "Notification_metadata_gin" ON "Notification" USING GIN ("metadata");
CREATE INDEX IF NOT EXISTS "ChatMessage_metadata_gin" ON "ChatMessage" USING GIN ("metadata");
CREATE INDEX IF NOT EXISTS "UserIntegration_metadata_gin" ON "UserIntegration" USING GIN ("metadata");
CREATE INDEX IF NOT EXISTS "AuditLog_metadata_gin" ON "AuditLog" USING GIN ("metadata");
CREATE INDEX IF NOT EXISTS "AiProvider_headers_gin" ON "AiProvider" USING GIN ("headers");
CREATE INDEX IF NOT EXISTS "FormField_logic_gin" ON "FormField" USING GIN ("logic");
CREATE INDEX IF NOT EXISTS "FormField_scoreMap_gin" ON "FormField" USING GIN ("scoreMap");

-- Shape CHECKs (fixed objects only; NULL passes):
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_preferences_object') THEN
    ALTER TABLE "User" ADD CONSTRAINT "chk_user_preferences_object" CHECK ("preferences" IS NULL OR jsonb_typeof("preferences") = 'object') NOT VALID;
  END IF;
END $$;
ALTER TABLE "User" VALIDATE CONSTRAINT "chk_user_preferences_object";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_aiprovider_headers_object') THEN
    ALTER TABLE "AiProvider" ADD CONSTRAINT "chk_aiprovider_headers_object" CHECK ("headers" IS NULL OR jsonb_typeof("headers") = 'object') NOT VALID;
  END IF;
END $$;
ALTER TABLE "AiProvider" VALIDATE CONSTRAINT "chk_aiprovider_headers_object";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_formfield_logic_object') THEN
    ALTER TABLE "FormField" ADD CONSTRAINT "chk_formfield_logic_object" CHECK ("logic" IS NULL OR jsonb_typeof("logic") = 'object') NOT VALID;
  END IF;
END $$;
ALTER TABLE "FormField" VALIDATE CONSTRAINT "chk_formfield_logic_object";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_formfield_scoremap_object') THEN
    ALTER TABLE "FormField" ADD CONSTRAINT "chk_formfield_scoremap_object" CHECK ("scoreMap" IS NULL OR jsonb_typeof("scoreMap") = 'object') NOT VALID;
  END IF;
END $$;
ALTER TABLE "FormField" VALIDATE CONSTRAINT "chk_formfield_scoremap_object";
