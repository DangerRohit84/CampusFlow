-- Repair — Room.departmentId missing column (Order1 fresh-install P3018) → P4.
--
-- Root cause (see .ai/reports/db-wipe-rebuild.md §3b): schema.prisma has
-- `Room.departmentId String? + @@index([departmentId]) + Department? relation
-- (SetNull)`, init migration CREATE TABLE "Room" has NO such column, and NO
-- migration adds it. Prior DEV DB had it via `db push` drift (backup proves
-- CREATE TABLE "Room" included "departmentId" text + "chatMode"). Fresh
-- `migrate reset` therefore fails at 20260918000000_order1_dangling_fks:
-- `P3018 column "departmentId" referenced in FK does not exist` on
-- `Room_departmentId_fkey`.
--
-- Fix policy (history checksum-stable — do NOT edit applied files):
-- new repair migration, additive + idempotent. Steps IN CORRECT ORDER:
-- column → index → orphan parking → FK (same name/policy as Order1 §4).
-- On current DEV (already has column via `db push`) every statement is a
-- no-op (IF NOT EXISTS / DO $$ guards). On a fresh DB this file runs AFTER
-- Order1 (timestamp 20260926 > 20260918) so it does NOT unblock a bare
-- `migrate reset` from zero — fresh installs still need the documented
-- baseline (`db push` + `resolve --applied`, see wipe-rebuild §3c) until
-- history is squashed. This repair guarantees forward convergence (any DB
-- missing the column converges without data loss) and documents the drift.
--
-- DEPLOY STATUS: FILE CREATED, NOT APPLIED LIVE. Deploy applies via
-- `prisma migrate deploy` (uses DIRECT_URL). Do NOT run `prisma migrate dev`
-- against prod. Do NOT re-wipe DEV (already rebuilt — verify only).
--
-- Deploy-safe notes (P4/P5):
-- - Additive only: no table/column drops, no renames. Single nullable TEXT
--   column + B-tree index + SetNull FK (tenant delete must not strand rooms).
-- - Orphan parking BEFORE ADD CONSTRAINT: nullable FK parks orphans to NULL
--   (preserves rows). Census first on large DBs:
--     SELECT COUNT(*) FROM "Room" t LEFT JOIN "Department" d
--       ON d."id" = t."departmentId"
--       WHERE t."departmentId" IS NOT NULL AND d."id" IS NULL;
-- - Transactional DDL (safe at current scale). Past ~1M rows run
--   CREATE INDEX CONCURRENTLY outside a tx, then `resolve --applied`.
-- - Idempotent: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS /
--   DO $$ pg_constraint guards — safe to re-run via `migrate deploy`.
-- - No secrets. No backfills beyond orphan parking to NULL.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0) Census — run before deploy, log results (expect 0 orphans after §2).
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT COUNT(*) FROM "Room" WHERE "departmentId" IS NOT NULL;
-- SELECT COUNT(*) FROM "Room" t LEFT JOIN "Department" d
--   ON d."id" = t."departmentId"
--   WHERE t."departmentId" IS NOT NULL AND d."id" IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Missing column (drift via `db push` — init never created it).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "departmentId" TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Supporting index (Prisma-conventional name so future `migrate diff`
--    stays clean; matches schema @@index([departmentId])).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "Room_departmentId_idx" ON "Room"("departmentId");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Orphan parking (nullable → NULL; preserves rows whose department is gone).
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE "Room" SET "departmentId" = NULL WHERE "departmentId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Department" d WHERE d."id" = "Room"."departmentId");

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) FK (same name/policy as Order1 §4: SetNull — department delete must not
--    strand or block rooms; teacher FK stays Restrict, untouched here).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Room_departmentId_fkey') THEN ALTER TABLE "Room" ADD CONSTRAINT "Room_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
