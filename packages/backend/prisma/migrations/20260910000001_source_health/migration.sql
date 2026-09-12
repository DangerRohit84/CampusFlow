-- #4 per-source health dashboard: lightweight SourceHealth table.
-- One row per UPPER-CASE platform key (DEVFOLIO..WELLFOUND + OTHER_*).
-- Deploy applies via `prisma migrate deploy`; until applied, code falls back
-- to in-memory + UNKNOWN (non-fatal, see services/fetch/health.ts).

CREATE TABLE IF NOT EXISTS "source_health" (
  "platform" TEXT NOT NULL PRIMARY KEY,
  "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "lastRunAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastLatencyMs" INTEGER,
  "lastError" TEXT,
  "totalRuns" INTEGER NOT NULL DEFAULT 0,
  "successRuns" INTEGER NOT NULL DEFAULT 0,
  "successRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "consecutiveFails" INTEGER NOT NULL DEFAULT 0,
  "fetchedCount" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
