-- P1 shared-password import + bulk-password nudge (2026-09-14).
-- Additive only: 2 new columns on "User", IF NOT EXISTS so re-runs are safe.
-- Backfill safe: mustChangePassword defaults false (no lockout for existing rows);
-- passwordNudgeAt defaults NULL (no nudge for existing rows).
-- Runtime code is pre-migration safe: reads/writes use (prisma as any) + try/catch
-- P2022 fallback (see services/adminBulk, routes/auth, services/bulkPassword).
-- Rollback: DROP COLUMN IF EXISTS (no data loss — flags only, passwordHash untouched).
-- NEVER run against prod without backup + migrate status check. Do NOT deploy here.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordNudgeAt" TIMESTAMP(3);
