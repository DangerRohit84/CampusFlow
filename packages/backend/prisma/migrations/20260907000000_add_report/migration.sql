-- CreateTable Report (fixes P2021 The table `public.Report` does not exist)
-- Idempotent: uses IF NOT EXISTS so `prisma migrate deploy` succeeds even if `db push` already created the table.
CREATE TABLE IF NOT EXISTS "Report" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "collegeId" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'WEBSITE',
    "issueType" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "attachmentUrl" TEXT,
    "collegeName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (IF NOT EXISTS for idempotency)
CREATE INDEX IF NOT EXISTS "Report_collegeId_status_idx" ON "Report"("collegeId", "status");
CREATE INDEX IF NOT EXISTS "Report_userId_idx" ON "Report"("userId");
CREATE INDEX IF NOT EXISTS "Report_scope_idx" ON "Report"("scope");
CREATE INDEX IF NOT EXISTS "Report_status_idx" ON "Report"("status");
CREATE INDEX IF NOT EXISTS "Report_createdAt_idx" ON "Report"("createdAt");
CREATE INDEX IF NOT EXISTS "Report_issueType_idx" ON "Report"("issueType");
CREATE INDEX IF NOT EXISTS "Report_priority_idx" ON "Report"("priority");

-- AddForeignKey (only if not exists, matches db push output)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Report_userId_fkey') THEN
    ALTER TABLE "Report" ADD CONSTRAINT "Report_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Report_collegeId_fkey') THEN
    ALTER TABLE "Report" ADD CONSTRAINT "Report_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
