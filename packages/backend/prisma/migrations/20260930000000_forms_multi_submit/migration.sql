-- Forms unlimited multi-submit + student history (20260930, user-approved).
-- PRODUCTION LIVE — production-safe, additive-first, zero blob loss.
--
-- Approved behavior:
--   Per-form allowMultipleResponses toggle, default OFF (preserves exams single).
--   When ON: unlimited (max=null, no cap) via attemptNo = max+1.
--   Student history in FormDetail (myResponses desc + Submit new + View receipt).
--   Teacher: NO extra timeline — existing table shows ALL attempts (not deduped)
--     + Attempt# + SubmittedAt columns.
--   Stats: totalResponses = rows, distinctUsers separate, pending = eligible - distinctUsers.
--
-- Pattern (P5 expand-backfill-contract, single file, idempotent):
--   0) Census (commented SELECTs — run before deploy, log counts).
--   1) ADD COLUMN IF NOT EXISTS (Form.allowMultipleResponses DEFAULT false,
--      FormResponse.attemptNo DEFAULT 1) — additive, old code ignores new cols.
--   2) Backfill attemptNo=1 grouped (all legacy rows → 1; old UNIQUE guarantees
--      one row per (formId,userId) so no dupes under new UNIQUE).
--   3) CHECK (attemptNo >= 1) NOT VALID → VALIDATE + new UNIQUE
--      (formId,userId,attemptNo) direct via pg_constraint guards
--      (PG UNIQUE has no NOT VALID; plain ADD CONSTRAINT).
--   4) Covering index (formId,userId,submittedAt DESC) IF NOT EXISTS.
--      NOTE: `prisma migrate deploy` runs in a transaction so
--      CREATE INDEX CONCURRENTLY cannot live here. At current scale a regular
--      index is fast (metadata + short ShareLock). Past ~1M FormResponse rows,
--      run CONCURRENTLY manually OUTSIDE a tx BEFORE deploy, then
--      `prisma migrate resolve --applied`:
--        CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
--          "FormResponse_formId_userId_attemptNo_key"
--          ON "FormResponse"("formId","userId","attemptNo");
--        CREATE INDEX CONCURRENTLY IF NOT EXISTS
--          "FormResponse_formId_userId_submittedAt_idx"
--          ON "FormResponse"("formId","userId","submittedAt" DESC);
--   5) DROP old UNIQUE (formId,userId) — REQUIRED to unblock multi-submit
--      (keeping it would 500/P2002 every 2nd attempt). Lock is a brief
--      metadata ACCESS EXCLUSIVE on the constraint; run in LOW-TRAFFIC window.
--      Until this DROP, multi-submit stays blocked (flag OFF behavior preserved)
--      and single-mode keeps working via dual-read fallback.
--   6) Reconciliation census (commented SELECTs — must match after deploy).
--
-- Deploy: `prisma migrate deploy` (DIRECT_URL). Rolling safe BOTH directions:
--   old code ignores new cols (attemptNo defaults to 1 at DB, old UNIQUE path
--   still 403s second submit); new code degrades when cols absent via
--   (prisma as any).allowMultipleResponses? + findUnique-try/findFirst-fallback
--   (see routes/forms.ts). No FormAnswer/blob change (child unchanged).
--
-- Rollback (no data loss):
--   1) Set flag OFF: UPDATE "Form" SET "allowMultipleResponses" = false;
--      → old code works with attemptNo=1 rows (ignores the column).
--   2) Optionally re-add old UNIQUE (fails if multi rows exist — dedupe first):
--        SELECT "formId","userId", COUNT(*) FROM "FormResponse"
--          GROUP BY 1,2 HAVING COUNT(*) > 1;  -- must be 0 rows
--        ALTER TABLE "FormResponse"
--          ADD CONSTRAINT "FormResponse_formId_userId_key" UNIQUE ("formId","userId");
--   3) Keep attemptNo column (harmless, ignored by old code). Dropping it is
--      NOT recommended (would lose attempt sequencing).
--
-- Requires PG16+ for pg_input_is_valid (Neon PG17 OK). No secrets.
-- Backfills only (one DROP CONSTRAINT on the old UNIQUE; no table/column/blob
-- loss; FormAnswer child untouched).

-- ─────────────────────────────────────────────────────────────────────────────
-- 0) Census — run before deploy, log results.
-- ─────────────────────────────────────────────────────────────────────────────
-- Total responses (expect == rows after deploy, attemptNo all >= 1):
-- SELECT COUNT(*) FROM "FormResponse";
-- Distinct (formId,userId) pairs (expect == rows, old UNIQUE guarantees no dupes):
-- SELECT COUNT(*) FROM (SELECT DISTINCT "formId","userId" FROM "FormResponse") s;
-- Duplicate pairs (expect 0 — old UNIQUE enforced; non-zero = race-created dupes, quarantine before §5):
-- SELECT "formId","userId", COUNT(*) FROM "FormResponse" GROUP BY 1,2 HAVING COUNT(*) > 1;
-- Forms count (expect == rows with allowMultipleResponses=false after §1):
-- SELECT COUNT(*) FROM "Form";

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) ADD COLUMNs (IF NOT EXISTS — re-runnable, additive only)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "Form" ADD COLUMN IF NOT EXISTS "allowMultipleResponses" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "FormResponse" ADD COLUMN IF NOT EXISTS "attemptNo" INTEGER NOT NULL DEFAULT 1;

-- Normalize pre-existing NULLs (rows created before the default existed, e.g. manual INSERTs).
UPDATE "Form" SET "allowMultipleResponses" = false WHERE "allowMultipleResponses" IS NULL;
UPDATE "FormResponse" SET "attemptNo" = 1 WHERE "attemptNo" IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Backfill attemptNo=1 grouped (idempotent; legacy rows → 1).
-- Old @@unique([formId,userId]) guarantees one row per pair, so setting all to 1
-- cannot violate the new @@unique([formId,userId,attemptNo]).
-- ─────────────────────────────────────────────────────────────────────────────
-- Already covered by DEFAULT 1 + NULL sweep above. Extra grouped guard for
-- hypothetical NULL/0 rows from out-of-band writes:
UPDATE "FormResponse" SET "attemptNo" = 1 WHERE "attemptNo" IS NULL OR "attemptNo" < 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) CHECK (NOT VALID → VALIDATE) + new UNIQUE (direct; PG UNIQUE has no NOT VALID)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FormResponse_attemptNo_check') THEN
    ALTER TABLE "FormResponse" ADD CONSTRAINT "FormResponse_attemptNo_check" CHECK ("attemptNo" >= 1) NOT VALID;
  END IF;
END $$;
ALTER TABLE "FormResponse" VALIDATE CONSTRAINT "FormResponse_attemptNo_check";

-- NOTE (20260930 fix, P3018): Postgres UNIQUE does NOT support NOT VALID /
-- VALIDATE CONSTRAINT (only CHECK + FK do). Previous revision used
-- UNIQUE ... NOT VALID → VALIDATE which fails the whole migration
-- (rolled back, 5 rows 0 dupes). Fixed to plain ADD CONSTRAINT UNIQUE.
-- Safe at this scale (5 rows, 0 dupes per pre-deploy census); backfill in §2
-- already forces attemptNo >= 1 so the build scans clean.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FormResponse_formId_userId_attemptNo_key') THEN
    ALTER TABLE "FormResponse" ADD CONSTRAINT "FormResponse_formId_userId_attemptNo_key" UNIQUE ("formId", "userId", "attemptNo");
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Covering index for history + teacher table (IF NOT EXISTS).
-- my-history: WHERE "formId"=$1 AND "userId"=$2 ORDER BY "submittedAt" DESC.
-- teacher table: WHERE "formId"=$1 ORDER BY "submittedAt" DESC.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "FormResponse_formId_userId_submittedAt_idx" ON "FormResponse"("formId", "userId", "submittedAt" DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) DROP old UNIQUE (formId,userId) — REQUIRED for multi-submit.
-- Run in LOW-TRAFFIC window (brief metadata lock). Keeping it would keep
-- 403ing/P2002 every 2nd attempt even when allowMultipleResponses=true.
-- Idempotent: guarded by pg_constraint existence check.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FormResponse_formId_userId_key') THEN
    ALTER TABLE "FormResponse" DROP CONSTRAINT "FormResponse_formId_userId_key";
  END IF;
END $$;
-- Backing-index cleanup: UNIQUE constraint drops its index, but a prior
-- failed/partial run can leave "FormResponse_formId_userId_key" as a bare
-- UNIQUE INDEX (no pg_constraint row). DROP INDEX clears that path so
-- re-runs stay idempotent and the old (formId,userId) gate is truly gone.
DROP INDEX IF EXISTS "FormResponse_formId_userId_key";

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Reconciliation census — run after deploy; every pair must agree.
-- ─────────────────────────────────────────────────────────────────────────────
-- attemptNo populated (expect 0):
-- SELECT COUNT(*) FROM "FormResponse" WHERE "attemptNo" IS NULL OR "attemptNo" < 1;
-- New UNIQUE present (expect 1 row):
-- SELECT conname FROM pg_constraint WHERE conname = 'FormResponse_formId_userId_attemptNo_key';
-- Old UNIQUE gone (expect 0 rows):
-- SELECT conname FROM pg_constraint WHERE conname = 'FormResponse_formId_userId_key';
-- Covering index present (expect 1 row):
-- SELECT indexname FROM pg_indexes WHERE indexname = 'FormResponse_formId_userId_submittedAt_idx';
-- Per-user attempt sequencing spot-check (attemptNo 1..N contiguous per pair):
-- SELECT "formId","userId", MIN("attemptNo") AS min_n, MAX("attemptNo") AS max_n, COUNT(*) AS rows
--   FROM "FormResponse" GROUP BY 1,2 HAVING COUNT(*) > 1 LIMIT 20;
-- Forms flag default OFF (expect 0 true before any teacher toggles):
-- SELECT COUNT(*) FROM "Form" WHERE "allowMultipleResponses" = true;
