-- #11 bulk CSV (dry-run) + audit log UI + AI metering/cost caps + platform KPIs.
-- Additive only: 3 new tables (AuditLog, AiUsage, AiQuota). Idempotent via
-- IF NOT EXISTS so `prisma migrate deploy` is safe to re-run. Runtime code
-- guards with `(prisma as any).auditLog?` + try/catch so pre-migration
-- deploys return empty/fallback instead of 500 (SourceHealth pattern).

-- AuditLog: minimal admin-mutation trail (user create/delete, approve/reject,
-- college actions, bulk imports, AI quota changes).
CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" TEXT NOT NULL,
  "actorId" TEXT,
  "actorEmail" TEXT,
  "actorRole" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "collegeId" TEXT,
  "metadata" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AuditLog_collegeId_createdAt_idx" ON "AuditLog"("collegeId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_actorId_idx" ON "AuditLog"("actorId");
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AiUsage: per-college per-feature daily counters (requests/tokens/costCents).
CREATE TABLE IF NOT EXISTS "AiUsage" (
  "id" TEXT NOT NULL,
  "collegeId" TEXT NOT NULL,
  "feature" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "requests" INTEGER NOT NULL DEFAULT 0,
  "tokens" INTEGER NOT NULL DEFAULT 0,
  "costCents" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiUsage_collegeId_feature_day_key" ON "AiUsage"("collegeId", "feature", "day");
CREATE INDEX IF NOT EXISTS "AiUsage_collegeId_day_idx" ON "AiUsage"("collegeId", "day");
CREATE INDEX IF NOT EXISTS "AiUsage_day_idx" ON "AiUsage"("day");

-- AiQuota: per-college AI budget caps (SUPER_ADMIN editable).
CREATE TABLE IF NOT EXISTS "AiQuota" (
  "collegeId" TEXT NOT NULL,
  "dailyTokenCap" INTEGER NOT NULL DEFAULT 10000,
  "monthlyTokenCap" INTEGER,
  "totalCostCapCents" INTEGER,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiQuota_pkey" PRIMARY KEY ("collegeId")
);
