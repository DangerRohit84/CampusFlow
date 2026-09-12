-- Order 12 FINAL — God-table split phase 2 (V-03-full CTI expand) + enum remainder
-- slice 2 (V-04-rest: ScheduleType/ChatMessageRole/GradeSource) + misc/hygiene
-- (V-23 keep-lite, V-28 keep-lite, 4 redundant-index drops, 2 timestamp adds) → P3/P7/P8/P10.
--
-- DEPLOY STATUS: FILE CREATED, NOT APPLIED LIVE. Deploy applies via
-- `prisma migrate deploy` (uses DIRECT_URL). Do NOT run `prisma migrate dev`
-- against prod. App code in this release is additive for CTI (dual-write User
-- cols + profile rows best-effort so pre-migration DBs keep working; readers
-- profile-first with User fallback, IDENTICAL API shapes) and big-bang for the
-- 3 enum conversions + 2 timestamp adds + 4 index drops (new code does not
-- reference dropped indexes; enum comparisons stay string literals so old+new
-- app code both work at the app layer, like Order 4).
-- No AdminProfile: admins reuse StaffProfile (no admin-only columns today).
-- Twins in User (studentId/empNumber/incomingYear/outgoingYear) are KEPT here;
-- contract drops are a LATER order once §5 reconciliation is green.
-- decidedAt+createdAt twins KEPT (first-vs-last semantics, see schema comment).
-- Open/source-driven text stays String (see schema header + §4 notes).
--
-- Documented order (P5 expand-backfill-contract, single file):
--  0) Census (commented SELECTs — run before deploy, log counts).
--  1) CREATE TYPE ×3 (DO $$ IF NOT EXISTS — idempotent).
--  2) CREATE TABLE IF NOT EXISTS StudentProfile/StaffProfile (uuid PK=userId
--     FK→User Cascade) + UNIQUEs/FKs via pg_constraint guards NOT VALID →
--     VALIDATE (P4) + indexes IF NOT EXISTS (Prisma-conventional names).
--  3) Backfills from User (per-role INSERT … WHERE NOT EXISTS + ON CONFLICT
--     DO NOTHING — re-runnable; every STUDENT gets a StudentProfile row even
--     when all twins are NULL, every non-STUDENT gets a StaffProfile row).
--  4) Enum remainder: normalize unknowns → safe defaults + RAISE NOTICE, then
--     ALTER COLUMN TYPE "Enum" USING UPPER(TRIM(col::text))::"Enum" + SET DEFAULT.
--  5) Timestamp adds (ADD COLUMN IF NOT EXISTS … NOT NULL DEFAULT
--     CURRENT_TIMESTAMP — existing rows backfill to statement time).
--  6) Redundant-index drops (plain DROP — CONCURRENTLY cannot live in
--     `migrate deploy` tx; tables are small, lock cost negligible; scale note).
--  7) Reconciliation census (commented SELECTs — must agree after deploy).
--
-- Deploy-safe notes:
-- - Transactional DDL (safe at current scale). Past ~1M Users, run §3 INSERTs
--   in batches outside this file (LIMIT 1000 pattern) + CREATE INDEX
--   CONCURRENTLY outside a tx, then `prisma migrate resolve --applied`. Prisma
--   `migrate deploy` runs in a transaction so CONCURRENTLY cannot live here.
-- - Idempotent via migrate deploy tracking; CREATE TYPE / CREATE TABLE /
--   CREATE INDEX / ADD COLUMN / DROP INDEX use IF NOT EXISTS / DO $$ guards.
--   Manual re-run is safe (§3 ON CONFLICT DO NOTHING + NOT EXISTS; §4 USING
--   ::text round-trip succeeds on already-enum cols).
-- - Requires PG14+ for string_agg in NOTICE (Neon PG17 OK). gen_random_uuid()
--   is core since PG13. No secrets. Backfills only (index drops are data-safe;
--   no column drops, no deletes, no billing/auth loss).

-- ─────────────────────────────────────────────────────────────────────────────
-- 0) Census — run before deploy, log results, fix ghosts manually if large.
-- ─────────────────────────────────────────────────────────────────────────────
-- CTI parents (expect == profile rows after §3):
-- SELECT "role", COUNT(*) FROM "User" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT COUNT(*) FROM "User" WHERE "role" = 'STUDENT';
-- SELECT COUNT(*) FROM "User" WHERE "role" IN ('TEACHER','COLLEGE_ADMIN','SUPER_ADMIN');
-- SELECT COUNT(*) FROM "User" WHERE "studentId" IS NOT NULL;
-- SELECT COUNT(*) FROM "User" WHERE "empNumber" IS NOT NULL;
-- SELECT COUNT(*) FROM "User" WHERE "incomingYear" IS NOT NULL;
-- Profiles already present (expect 0 before §3; re-run must not duplicate):
-- SELECT COUNT(*) FROM "StudentProfile";
-- SELECT COUNT(*) FROM "StaffProfile";
-- Enum remainder ghosts (expect 0 after §4 normalize; non-zero = new ghost):
-- SELECT "type", COUNT(*) FROM "Schedule" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT "role", COUNT(*) FROM "ChatMessage" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT "source", COUNT(*) FROM "Grade" GROUP BY 1 ORDER BY 2 DESC;
-- Timestamp gaps (expect == row counts before §5; 0 missing after):
-- SELECT COUNT(*) FROM "Notification";
-- SELECT COUNT(*) FROM "Course";
-- Redundant indexes present (expect 4 rows before §6; 0 after):
-- SELECT indexname FROM pg_indexes WHERE indexname IN
--   ('User_collegeId_idx','CodingContest_collegeId_idx','Form_collegeId_idx',
--    'AssignmentSubmission_assignmentId_studentId_idx');

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) CREATE TYPE ×3 (guarded — re-runnable).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ScheduleType') THEN CREATE TYPE "ScheduleType" AS ENUM ('CLASS', 'LAB'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ChatMessageRole') THEN CREATE TYPE "ChatMessageRole" AS ENUM ('USER', 'ASSISTANT'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GradeSource') THEN CREATE TYPE "GradeSource" AS ENUM ('MANUAL', 'CALCULATOR'); END IF; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) CTI tables (IF NOT EXISTS) + UNIQUEs/FKs (guards + NOT VALID → VALIDATE) + indexes.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "StudentProfile" (
  "userId" "TEXT" NOT NULL,
  "studentId" "TEXT",
  "incomingYear" INTEGER,
  "outgoingYear" INTEGER,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentProfile_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE IF NOT EXISTS "StaffProfile" (
  "userId" "TEXT" NOT NULL,
  "empNumber" "TEXT",
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StaffProfile_pkey" PRIMARY KEY ("userId")
);

-- 2a) Idempotency UNIQUEs (dual-write + backfill keys; NULLs never conflict in PG).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentProfile_studentId_key') THEN
    ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_studentId_key" UNIQUE ("studentId") NOT VALID;
  END IF;
END $$;
ALTER TABLE "StudentProfile" VALIDATE CONSTRAINT "StudentProfile_studentId_key";

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StaffProfile_empNumber_key') THEN
    ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_empNumber_key" UNIQUE ("empNumber") NOT VALID;
  END IF;
END $$;
ALTER TABLE "StaffProfile" VALIDATE CONSTRAINT "StaffProfile_empNumber_key";

-- 2b) FKs (1–1 delegated type → Cascade; profile dies with User, never orphans).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentProfile_userId_fkey') THEN
    ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE "StudentProfile" VALIDATE CONSTRAINT "StudentProfile_userId_fkey";

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StaffProfile_userId_fkey') THEN
    ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE "StaffProfile" VALIDATE CONSTRAINT "StaffProfile_userId_fkey";

-- 2c) Indexes (IF NOT EXISTS; Prisma-conventional names so a future
-- `prisma migrate dev` diff stays clean; FK cover + roll-number lookups).
CREATE INDEX IF NOT EXISTS "StudentProfile_studentId_idx" ON "StudentProfile"("studentId");
CREATE INDEX IF NOT EXISTS "StudentProfile_incomingYear_idx" ON "StudentProfile"("incomingYear");
CREATE INDEX IF NOT EXISTS "StaffProfile_empNumber_idx" ON "StaffProfile"("empNumber");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Backfills from User (re-runnable; no row-count caps at current scale).
-- Every STUDENT gets a StudentProfile row (even all-NULL twins → 1:1 holds);
-- every non-STUDENT gets a StaffProfile row. Twins copied verbatim (no
-- normalization — chk_user_role_fields already guards the User side; profile
-- side inherits the same invariant by construction: STUDENT profiles never
-- carry empNumber, staff profiles never carry studentId/years).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO "StudentProfile" ("userId", "studentId", "incomingYear", "outgoingYear", "createdAt", "updatedAt")
SELECT u."id", u."studentId", u."incomingYear", u."outgoingYear", NOW(), NOW()
FROM "User" u
WHERE u."role" = 'STUDENT'
  AND NOT EXISTS (SELECT 1 FROM "StudentProfile" sp WHERE sp."userId" = u."id")
ON CONFLICT ("userId") DO NOTHING;

INSERT INTO "StaffProfile" ("userId", "empNumber", "createdAt", "updatedAt")
SELECT u."id", u."empNumber", NOW(), NOW()
FROM "User" u
WHERE u."role" IN ('TEACHER', 'COLLEGE_ADMIN', 'SUPER_ADMIN')
  AND NOT EXISTS (SELECT 1 FROM "StaffProfile" sp WHERE sp."userId" = u."id")
ON CONFLICT ("userId") DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Enum remainder slice 2 (closed 3 domains; open text stays String by design).
-- Normalize unknowns → safe defaults first (never fail deploy on ghosts) +
-- RAISE NOTICE (deploy log = conflict log), then ALTER USING.
-- Safe defaults: Schedule CLASS (list default), ChatMessage USER (question
-- turn; system prompts are never persisted), Grade MANUAL (institutional safe:
-- calculator replace-all is scoped to CALCULATOR so unknown→MANUAL rows are
-- never deleted by calculator sync).
-- Deferred (stay String, documented in schema header): Hackathon/Internship.mode
-- (per-source divergence), Notification.type (open), Task.category (open),
-- FormField.type (open), Room.chatMode (slice-boundary test lock), Resource.*
-- (getFileType incl. doc/xls/image), PlatformSettings.*, AuditLog.*,
-- AiUsage/AiRouting.feature, AiProvider.type, UserIntegration.type, Grade.grade.
-- ─────────────────────────────────────────────────────────────────────────────
-- 4a) Normalize case/whitespace drift (no-op if clean).
UPDATE "Schedule" SET "type" = UPPER(TRIM("type"::text)) WHERE "type" IS NOT NULL;
UPDATE "ChatMessage" SET "role" = UPPER(TRIM("role"::text)) WHERE "role" IS NOT NULL;
UPDATE "Grade" SET "source" = UPPER(TRIM("source"::text)) WHERE "source" IS NOT NULL;

-- 4b) Conflict log — unknowns normalizing to safe defaults.
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "Schedule" WHERE UPPER(TRIM("type"::text)) NOT IN ('CLASS','LAB'); IF c > 0 THEN RAISE NOTICE 'Order12 conflict: Schedule.type % rows unknown, normalizing to CLASS', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "ChatMessage" WHERE UPPER(TRIM("role"::text)) NOT IN ('USER','ASSISTANT'); IF c > 0 THEN RAISE NOTICE 'Order12 conflict: ChatMessage.role % rows unknown, normalizing to USER', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "Grade" WHERE UPPER(TRIM("source"::text)) NOT IN ('MANUAL','CALCULATOR'); IF c > 0 THEN RAISE NOTICE 'Order12 conflict: Grade.source % rows unknown, normalizing to MANUAL', c; END IF; END $$;

-- 4c) Normalize remaining unknowns → safe defaults (so §4d USING cast never fails).
UPDATE "Schedule" SET "type" = 'CLASS' WHERE UPPER(TRIM("type"::text)) NOT IN ('CLASS','LAB') OR "type" IS NULL;
UPDATE "ChatMessage" SET "role" = 'USER' WHERE UPPER(TRIM("role"::text)) NOT IN ('USER','ASSISTANT') OR "role" IS NULL;
UPDATE "Grade" SET "source" = 'MANUAL' WHERE UPPER(TRIM("source"::text)) NOT IN ('MANUAL','CALCULATOR') OR "source" IS NULL;

-- 4d) ALTER COLUMN TYPE "Enum" USING UPPER(TRIM(col::text))::"Enum" + SET DEFAULT.
-- ::text round-trip keeps manual re-run safe (already-enum still casts).
ALTER TABLE "Schedule" ALTER COLUMN "type" TYPE "ScheduleType" USING UPPER(TRIM("type"::text))::"ScheduleType";
ALTER TABLE "Schedule" ALTER COLUMN "type" SET DEFAULT 'CLASS'::"ScheduleType";
ALTER TABLE "ChatMessage" ALTER COLUMN "role" TYPE "ChatMessageRole" USING UPPER(TRIM("role"::text))::"ChatMessageRole";
ALTER TABLE "Grade" ALTER COLUMN "source" TYPE "GradeSource" USING UPPER(TRIM("source"::text))::"GradeSource";
ALTER TABLE "Grade" ALTER COLUMN "source" SET DEFAULT 'MANUAL'::"GradeSource";

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Timestamp adds (P10 tail: mutable entities gain updatedAt; immutable logs
-- keep created-only by design — MessageHide/AuditLog/LoginAttempt untouched).
-- Existing rows backfill to statement time via NOT NULL DEFAULT.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Redundant-index drops (P8 tail: data-safe, planner keeps covering index).
-- NOTE: plain DROP (not CONCURRENTLY) — Prisma `migrate deploy` runs in a
-- transaction and CONCURRENTLY cannot live here. Tables are small for these
-- indexes; lock cost negligible. Past ~1M rows, run each
-- `DROP INDEX CONCURRENTLY IF EXISTS "<name>";` outside a tx, then
-- `prisma migrate resolve --applied`.
-- - User_collegeId_idx: leftmost-covered by User_collegeId_role_idx.
-- - CodingContest_collegeId_idx: covered by (collegeId,status,createdAt)+(collegeId,status).
-- - Form_collegeId_idx: covered by (collegeId,status,createdAt)+(collegeId,status).
-- - AssignmentSubmission_assignmentId_studentId_idx: duplicates UNIQUE
--   (assignmentId,studentId) (unique already indexes the pair).
-- ─────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS "User_collegeId_idx";
DROP INDEX IF EXISTS "CodingContest_collegeId_idx";
DROP INDEX IF EXISTS "Form_collegeId_idx";
DROP INDEX IF EXISTS "AssignmentSubmission_assignmentId_studentId_idx";

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) Reconciliation census — run after deploy; every pair must agree.
-- ─────────────────────────────────────────────────────────────────────────────
-- CTI coverage (all three must be 0):
-- SELECT COUNT(*) FROM "User" u WHERE u."role" = 'STUDENT'
--   AND NOT EXISTS (SELECT 1 FROM "StudentProfile" sp WHERE sp."userId" = u."id");
-- SELECT COUNT(*) FROM "User" u WHERE u."role" IN ('TEACHER','COLLEGE_ADMIN','SUPER_ADMIN')
--   AND NOT EXISTS (SELECT 1 FROM "StaffProfile" sp WHERE sp."userId" = u."id");
-- Twin divergence (profile vs User col — expect 0; non-zero = dual-write gap):
-- SELECT COUNT(*) FROM "User" u JOIN "StudentProfile" sp ON sp."userId" = u."id"
--   WHERE sp."studentId" IS DISTINCT FROM u."studentId"
--      OR sp."incomingYear" IS DISTINCT FROM u."incomingYear"
--      OR sp."outgoingYear" IS DISTINCT FROM u."outgoingYear";
-- SELECT COUNT(*) FROM "User" u JOIN "StaffProfile" sp ON sp."userId" = u."id"
--   WHERE sp."empNumber" IS DISTINCT FROM u."empNumber";
-- Orphan profiles (expect 0 — FK Cascade + backfill only from live Users):
-- SELECT COUNT(*) FROM "StudentProfile" sp LEFT JOIN "User" u ON u."id" = sp."userId" WHERE u."id" IS NULL;
-- SELECT COUNT(*) FROM "StaffProfile" sp LEFT JOIN "User" u ON u."id" = sp."userId" WHERE u."id" IS NULL;
-- Enum ghosts after §4 (expect 0 distinct beyond closed sets):
-- SELECT "type", COUNT(*) FROM "Schedule" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT "role", COUNT(*) FROM "ChatMessage" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT "source", COUNT(*) FROM "Grade" GROUP BY 1 ORDER BY 2 DESC;
-- Redundant indexes gone (expect 0 rows):
-- SELECT indexname FROM pg_indexes WHERE indexname IN
--   ('User_collegeId_idx','CodingContest_collegeId_idx','Form_collegeId_idx',
--    'AssignmentSubmission_assignmentId_studentId_idx');
-- Timestamps present (expect 0 missing):
-- SELECT COUNT(*) FROM "Notification" WHERE "updatedAt" IS NULL;
-- SELECT COUNT(*) FROM "Course" WHERE "updatedAt" IS NULL;
