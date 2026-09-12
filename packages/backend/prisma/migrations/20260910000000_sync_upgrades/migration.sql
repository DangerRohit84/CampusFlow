-- Sync upgrades 1+3 (no over-engineering, DB-only, zero new deps)
-- 1) CF gate needs no schema (process-local gate in codeforcesGate.ts).
-- 3a) Advisory cron lock needs no table (pg_try_advisory_lock in syncLock.ts).
-- 3b) Persisted throttle: new SyncThrottle table (multi-instance 60s button guard).
-- 3c) Per-user failure surface: CodingProfile.lastSyncError (set on fail, cleared
--     on success; engine no longer advances lastSyncedAt on total failure).

-- Per-user last sync error (nullable TEXT, no backfill needed)
ALTER TABLE "CodingProfile" ADD COLUMN IF NOT EXISTS "lastSyncError" TEXT;

-- DB-backed sync throttle (userId PK, last claim timestamp)
CREATE TABLE IF NOT EXISTS "SyncThrottle" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "lastRequestedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
