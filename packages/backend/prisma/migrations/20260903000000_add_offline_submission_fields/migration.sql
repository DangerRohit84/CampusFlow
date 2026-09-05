-- AlterTable Add offline marking support
ALTER TABLE "AssignmentSubmission" ADD COLUMN IF NOT EXISTS "submissionChannel" TEXT DEFAULT 'ONLINE';
ALTER TABLE "AssignmentSubmission" ADD COLUMN IF NOT EXISTS "offlineNote" TEXT;
ALTER TABLE "AssignmentSubmission" ADD COLUMN IF NOT EXISTS "offlineVerifiedBy" TEXT;
ALTER TABLE "AssignmentSubmission" ADD COLUMN IF NOT EXISTS "offlineVerifiedAt" TIMESTAMP(3);
-- CreateIndex
CREATE INDEX IF NOT EXISTS "AssignmentSubmission_submissionChannel_idx" ON "AssignmentSubmission"("submissionChannel");
-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssignmentSubmission_offlineVerifiedBy_fkey') THEN
    ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_offlineVerifiedBy_fkey" FOREIGN KEY ("offlineVerifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
