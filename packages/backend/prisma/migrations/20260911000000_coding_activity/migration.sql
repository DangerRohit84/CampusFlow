-- Additive migration: unified-heatmap daily coding activity.
-- Creates CodingActivity{userId,date,source,count} for per-day SOLVES where
-- honestly obtainable (LeetCode submissionCalendar + Codeforces accepted/day +
-- GitHub contributions snapshot). CodeChef/HackerRank/GFG have no daily API
-- and are intentionally NOT represented here (totals stay in platformStats).
-- Deploy: `prisma migrate deploy` applies this. Pre-migration runtime is safe
-- (codingActivity.ts warn-once skips + GET /coding-profile/activity returns
-- live GitHub only). IF NOT EXISTS throughout: re-runnable, no rewrite.

CREATE TABLE IF NOT EXISTS "CodingActivity" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "date" TIMESTAMPTZ NOT NULL,
  "source" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CodingActivity_pkey" PRIMARY KEY ("id")
);

-- Idempotency key for sync createMany(skipDuplicates): one row per user/day/source.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CodingActivity_userId_date_source_key'
  ) THEN
    ALTER TABLE "CodingActivity"
      ADD CONSTRAINT "CodingActivity_userId_date_source_key" UNIQUE ("userId", "date", "source");
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "CodingActivity_userId_date_idx" ON "CodingActivity"("userId", "date");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CodingActivity_userId_fkey'
  ) THEN
    ALTER TABLE "CodingActivity"
      ADD CONSTRAINT "CodingActivity_userId_fkey" FOREIGN KEY ("userId")
      REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
