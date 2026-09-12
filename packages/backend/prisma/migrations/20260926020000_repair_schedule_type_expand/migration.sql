-- Repair — ScheduleType expand CLASS/LAB → CLASS/LAB/SEMINAR/OTHER (seed fix) → P7.
--
-- Root cause (see .ai/reports/db-wipe-rebuild.md §4): Order12 made
-- `Schedule.type` a native enum `CLASS/LAB` (migration
-- 20260925000000_order12_rolesplit §4 + schema.prisma enum ScheduleType),
-- but `prisma/seed.ts:227-242` uses 4 real values: CLASS (9 rows), LAB (3),
-- SEMINAR (1× `Placement Prep` PL001 Seminar Hall), OTHER (1× `Club Meeting`
-- CLUB Activity Room). First 6 CLASS/LAB rows succeed → 6 schedules, then
-- `PrismaClientValidationError Invalid prisma.schedule.create() type Expected
-- ScheduleType (got SEMINAR)` aborts seed; later steps (assignments,
-- notifications, hackathons, internships, forms, AI providers) never run.
-- App code audit (backend src only): `validators.ts:102` ScheduleTypeEnum,
-- `routes/schedules.ts:20-23` coerce unknowns→CLASS, `routes/timetable.ts:77`
-- local parser LAB-vs-CLASS + `:302` coerce AI free text→CLASS/LAB. No other
-- Schedule values exist in backend src (Notification.type EXAM/ASSIGNMENT/etc
-- is open String, unrelated). SEMINAR + OTHER are real (seed demo timetable),
-- so the fix is enum EXPANSION (not seed rewrite) via migration + validator.
--
-- Fix policy (history checksum-stable — do NOT edit Order12):
-- new repair migration, additive + idempotent. Appends SEMINAR + OTHER to the
-- existing PG enum (no rewrite, no backfill — existing CLASS/LAB rows stay;
-- Order12 already normalized ghosts→CLASS, this repair does NOT rewrite them).
-- Schema + zod + route coercions updated in the same change so
-- `prisma validate + tsc + vitest` stay green and `db:seed` can proceed past
-- 6 schedules. Validators remain SSOT (must match schema exactly).
--
-- DEPLOY STATUS: FILE CREATED, NOT APPLIED LIVE. Deploy applies via
-- `prisma migrate deploy` (uses DIRECT_URL). Do NOT run `prisma migrate dev`
-- against prod. Do NOT re-wipe DEV (already rebuilt — verify only).
--
-- Deploy-safe notes (PG12+):
-- - `ALTER TYPE ... ADD VALUE IF NOT EXISTS` CAN run inside the `migrate
--   deploy` transaction (PG12+ relaxed the old prohibition), but the new value
--   cannot be USED until after commit — this file only ADDS values, never
--   INSERTs SEMINAR/OTHER in the same tx, so it is safe. Seed runs AFTER
--   deploy (separate tx) and will see the new values.
-- - Additive only: no column drops, no renames, no backfills. Existing
--   CLASS/LAB rows untouched. New values sort at the end (no BEFORE/AFTER).
-- - Idempotent: CREATE TYPE guarded (for DBs missing Order12) + ADD VALUE
--   IF NOT EXISTS (re-runnable, emits NOTICE not error on repeat).
-- - Scale: enum add is O(1) catalog write (no table rewrite,unlike Order4/12
--   USING casts). Safe at any row count.
-- - No secrets.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0) Census — run before deploy, log results (expect CLASS/LAB only before,
--    +SEMINAR/OTHER after seed).
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT "type", COUNT(*) FROM "Schedule" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_enum.enumtypid = pg_type.oid WHERE pg_type.typname = 'ScheduleType' ORDER BY enumsortorder;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Ensure type exists (guarded — for DBs missing Order12; normally a no-op
--    with all 4 values so a bare repair still converges).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ScheduleType') THEN CREATE TYPE "ScheduleType" AS ENUM ('CLASS', 'LAB', 'SEMINAR', 'OTHER'); END IF; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Append real schedule types (idempotent; usable after commit).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TYPE "ScheduleType" ADD VALUE IF NOT EXISTS 'SEMINAR';
ALTER TYPE "ScheduleType" ADD VALUE IF NOT EXISTS 'OTHER';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Reconciliation census — run after deploy + seed (all four must appear
--    after a full seed; CLASS remains the default for AI unknowns).
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT "type", COUNT(*) FROM "Schedule" GROUP BY 1 ORDER BY 2 DESC;
-- -- expect (full seed): CLASS 9, LAB 3, SEMINAR 1, OTHER 1 (15 total; partial
-- -- seed before this repair: CLASS/LAB only, 6 rows).
