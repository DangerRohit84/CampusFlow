-- Per-college independent staging decisions (fix: single global status).
-- Additive only: 2 new tables (HackathonStagingDecision, InternshipStagingDecision).
-- Idempotent via IF NOT EXISTS so `prisma migrate deploy` is safe to re-run.
-- Runtime code guards with `(prisma as any).xxxStagingDecision?` + try/catch so
-- pre-migration deploys fall back to legacy global-status behavior instead of
-- 500 (same pattern as SourceHealth / SyncThrottle / AuditLog).
--
-- Design (documented in schema.prisma):
-- - @@unique(title, source) on staging stays GLOBAL (one shared feed row).
-- - Per-college visibility lives here: UNIQUE(stagingId, collegeId),
--   decision APPROVED/REJECTED, decidedBy/decidedAt audit.
-- - Global staging row keeps PENDING/DRAFT/ACTIVE; each college's approve
--   creates its OWN published copy + own APPROVED row; reject records own
--   REJECTED row only. Other colleges unaffected.

CREATE TABLE IF NOT EXISTS "HackathonStagingDecision" (
  "id" TEXT NOT NULL,
  "stagingId" TEXT NOT NULL,
  "collegeId" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "decidedBy" TEXT,
  "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HackathonStagingDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "HackathonStagingDecision_stagingId_collegeId_key" ON "HackathonStagingDecision"("stagingId", "collegeId");
CREATE INDEX IF NOT EXISTS "HackathonStagingDecision_collegeId_idx" ON "HackathonStagingDecision"("collegeId");
CREATE INDEX IF NOT EXISTS "HackathonStagingDecision_stagingId_idx" ON "HackathonStagingDecision"("stagingId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'HackathonStagingDecision_stagingId_fkey'
  ) THEN
    ALTER TABLE "HackathonStagingDecision"
      ADD CONSTRAINT "HackathonStagingDecision_stagingId_fkey"
      FOREIGN KEY ("stagingId") REFERENCES "HackathonStaging"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'HackathonStagingDecision_collegeId_fkey'
  ) THEN
    ALTER TABLE "HackathonStagingDecision"
      ADD CONSTRAINT "HackathonStagingDecision_collegeId_fkey"
      FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "InternshipStagingDecision" (
  "id" TEXT NOT NULL,
  "stagingId" TEXT NOT NULL,
  "collegeId" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "decidedBy" TEXT,
  "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InternshipStagingDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "InternshipStagingDecision_stagingId_collegeId_key" ON "InternshipStagingDecision"("stagingId", "collegeId");
CREATE INDEX IF NOT EXISTS "InternshipStagingDecision_collegeId_idx" ON "InternshipStagingDecision"("collegeId");
CREATE INDEX IF NOT EXISTS "InternshipStagingDecision_stagingId_idx" ON "InternshipStagingDecision"("stagingId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InternshipStagingDecision_stagingId_fkey'
  ) THEN
    ALTER TABLE "InternshipStagingDecision"
      ADD CONSTRAINT "InternshipStagingDecision_stagingId_fkey"
      FOREIGN KEY ("stagingId") REFERENCES "InternshipStaging"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InternshipStagingDecision_collegeId_fkey'
  ) THEN
    ALTER TABLE "InternshipStagingDecision"
      ADD CONSTRAINT "InternshipStagingDecision_collegeId_fkey"
      FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
