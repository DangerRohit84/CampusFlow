-- Timetable editable Period Grid — ScheduleOverride (Approach A, 20261002, user-approved).
-- PRODUCTION careful: additive-only, no destructive DDL, existing Schedule uploads preserved.
--
-- Approved behavior:
--   Schedule stays the weekly template (dayOfWeek 0-6 Monday=0).
--   ScheduleOverride carries temporary range+time edits:
--     EDITED/CANCELLED (baseScheduleId required, applies when date in
--     [validFrom, validUntil] AND weekday matches base dayOfWeek),
--     ADDED_TEMP (standalone, daily when dayOfWeek null, e.g. Oct 6-11 14:00-15:30).
--   GET /timetable no date → templates (preserve current).
--   GET /timetable?date= / ?from=&to= → merged (templates - CANCELLED flag + EDITED/ADDED).
--   POST /timetable/save clearExisting → deletes Schedule only; overrides survive
--     unless clearOverrides=true.
--   Owner-only: userId scoping on every query.
--
-- Pattern: CREATE TYPE + CREATE TABLE IF NOT EXISTS + indexes + FKs (all IF NOT EXISTS
-- guarded where PG supports it). Old code ignores the new table; new code degrades to
-- templates-only when the table/client is pre-migration (try/catch P2021 fallback
-- in routes/timetable.ts + routes/schedules.ts).
--
-- Deploy: `prisma migrate deploy` (DIRECT_URL). Rolling safe BOTH directions.
-- Verify: SELECT count(*) FROM "Schedule"; must match before/after (no row touch).
-- Rollback: see rollback.sql in this folder (DROP TABLE + DROP TYPE).

-- 0) Census (run before deploy, log counts — must match after):
-- SELECT count(*) FROM "Schedule";
-- SELECT count(*) FROM pg_type WHERE typname = 'ScheduleOverrideKind';

-- 1) Enum (additive, no rewrite of existing types):
DO $$ BEGIN
  CREATE TYPE "ScheduleOverrideKind" AS ENUM ('EDITED', 'CANCELLED', 'ADDED_TEMP');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2) Table (additive, no Schedule touch):
CREATE TABLE IF NOT EXISTS "ScheduleOverride" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "baseScheduleId" TEXT,
  "kind" "ScheduleOverrideKind" NOT NULL,
  "title" TEXT,
  "course" TEXT,
  "location" TEXT,
  "teacher" TEXT,
  "type" "ScheduleType",
  "color" TEXT,
  "dayOfWeek" INTEGER,
  "validFrom" TIMESTAMP(3) NOT NULL,
  "validUntil" TIMESTAMP(3) NOT NULL,
  "startTime" TEXT,
  "endTime" TEXT,
  "startMinutes" INTEGER,
  "endMinutes" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScheduleOverride_pkey" PRIMARY KEY ("id")
);

-- 3) FKs (additive, SetNull/Cascade mirror schema.prisma):
DO $$ BEGIN
  ALTER TABLE "ScheduleOverride" ADD CONSTRAINT "ScheduleOverride_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ScheduleOverride" ADD CONSTRAINT "ScheduleOverride_baseScheduleId_fkey"
    FOREIGN KEY ("baseScheduleId") REFERENCES "Schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 4) Range sanity CHECK (additive, NOT VALID → VALIDATE to avoid full scan lock):
DO $$ BEGIN
  ALTER TABLE "ScheduleOverride" ADD CONSTRAINT "ScheduleOverride_range_ck"
    CHECK ("validFrom" <= "validUntil") NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE "ScheduleOverride" VALIDATE CONSTRAINT "ScheduleOverride_range_ck";

-- 5) Minutes CHECKs (same 0-1439 contract as Schedule, additive):
DO $$ BEGIN
  ALTER TABLE "ScheduleOverride" ADD CONSTRAINT "ScheduleOverride_startMinutes_ck"
    CHECK ("startMinutes" IS NULL OR ("startMinutes" >= 0 AND "startMinutes" <= 1439)) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE "ScheduleOverride" VALIDATE CONSTRAINT "ScheduleOverride_startMinutes_ck";

DO $$ BEGIN
  ALTER TABLE "ScheduleOverride" ADD CONSTRAINT "ScheduleOverride_endMinutes_ck"
    CHECK ("endMinutes" IS NULL OR ("endMinutes" >= 0 AND "endMinutes" <= 1439)) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE "ScheduleOverride" VALIDATE CONSTRAINT "ScheduleOverride_endMinutes_ck";

-- 6) Indexes (regular, NOT CONCURRENTLY — migrate deploy runs in a tx):
CREATE INDEX IF NOT EXISTS "ScheduleOverride_userId_idx" ON "ScheduleOverride"("userId");
CREATE INDEX IF NOT EXISTS "ScheduleOverride_userId_validFrom_idx" ON "ScheduleOverride"("userId", "validFrom");
CREATE INDEX IF NOT EXISTS "ScheduleOverride_userId_validUntil_idx" ON "ScheduleOverride"("userId", "validUntil");
CREATE INDEX IF NOT EXISTS "ScheduleOverride_baseScheduleId_idx" ON "ScheduleOverride"("baseScheduleId");

-- 7) Reconciliation census (run after deploy):
-- SELECT count(*) FROM "Schedule";
-- SELECT count(*) FROM "ScheduleOverride";
