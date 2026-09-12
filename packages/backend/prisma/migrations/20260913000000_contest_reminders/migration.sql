-- #6 contest alarms: per-user remind-me rows (additive, no backfill).
-- Deploy applies via preDeployCommand (`prisma migrate deploy` with DIRECT_URL).
-- Live Neon: no manual step — deploy runs this once; local dev: `npx prisma migrate dev`.

CREATE TABLE IF NOT EXISTS "ContestReminder" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "contestId" TEXT NOT NULL,
  "minutesBefore" INTEGER NOT NULL,
  "remindAt" TIMESTAMP(3) NOT NULL,
  "sent" BOOLEAN NOT NULL DEFAULT false,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContestReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ContestReminder_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "CodingContest"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ContestReminder_userId_contestId_minutesBefore_key" ON "ContestReminder"("userId", "contestId", "minutesBefore");
CREATE INDEX IF NOT EXISTS "ContestReminder_userId_idx" ON "ContestReminder"("userId");
CREATE INDEX IF NOT EXISTS "ContestReminder_contestId_idx" ON "ContestReminder"("contestId");
CREATE INDEX IF NOT EXISTS "ContestReminder_sent_remindAt_idx" ON "ContestReminder"("sent", "remindAt");
CREATE INDEX IF NOT EXISTS "ContestReminder_userId_sent_idx" ON "ContestReminder"("userId", "sent");
