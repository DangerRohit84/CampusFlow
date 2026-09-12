-- Fix DB missing composite indexes (ranked cause #4)
-- Gap left by 20260909000000_perf_10k_indexes_json: ContestParticipation,
-- CodingProfile handles, CodingContest(platform,url), AssignmentSubmission pair.
-- Idempotent: safe to re-run via `prisma migrate deploy`.
-- Pattern: CREATE INDEX IF NOT EXISTS (additive, no downtime, no table rewrite).
-- Existing @@unique constraints untouched (upsert paths preserved).
-- Write cost: each B-tree adds ~O(log n) on INSERT/UPDATE; justified — reads
-- dominate 100:1 on these hot paths (participation history, leaderboard,
-- contest dedupe, submission roster). Drop lowest-hit first if write pressure
-- appears (see pg_stat_user_indexes).

-- ---------------------------------------------------------------------------
-- ContestParticipation: per-user history + per-contest roster + leaderboard
-- Serves: codingProfile GET /participations (userId+platform ORDER BY
-- participatedAt), GET /contest/:contestId/participants (contestId),
-- GET /leaderboard groupBy(userId) WHERE platform (+ college fallback scan).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "ContestParticipation_userId_platform_participatedAt_idx" ON "ContestParticipation"("userId", "platform", "participatedAt");
CREATE INDEX IF NOT EXISTS "ContestParticipation_contestId_idx" ON "ContestParticipation"("contestId");
CREATE INDEX IF NOT EXISTS "ContestParticipation_platform_idx" ON "ContestParticipation"("platform");
CREATE INDEX IF NOT EXISTS "ContestParticipation_platform_userId_idx" ON "ContestParticipation"("platform", "userId");

-- ---------------------------------------------------------------------------
-- CodingProfile: per-handle lookups for syncAllUsers OR-scan
-- Serves: syncAllUsers findMany OR (leetcodeHandle/codeforcesHandle/
-- codechefHandle/hackerrankHandle/gfgHandle NOT NULL). Best-supported shape is
-- 3 single-column B-trees (composite (a,b,c) cannot serve OR branches;
-- planner BitmapOr across singles). hackerrank/gfg omitted per spec scope.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "CodingProfile_leetcodeHandle_idx" ON "CodingProfile"("leetcodeHandle");
CREATE INDEX IF NOT EXISTS "CodingProfile_codeforcesHandle_idx" ON "CodingProfile"("codeforcesHandle");
CREATE INDEX IF NOT EXISTS "CodingProfile_codechefHandle_idx" ON "CodingProfile"("codechefHandle");

-- ---------------------------------------------------------------------------
-- CodingContest: exact-match dedupe by (platform, url)
-- Serves: contestFetcher.findFirst({ platform, url }) + preload map by
-- platform|url (syncEngine.preloadContestCandidates, contestFetcher.preload).
-- Existing [platform] kept; composite covers equality on both cols.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "CodingContest_platform_url_idx" ON "CodingContest"("platform", "url");

-- ---------------------------------------------------------------------------
-- AssignmentSubmission: roster + per-student pair lookup
-- Serves: findMany/count WHERE assignmentId, WHERE studentId, upsert on
-- (assignmentId, studentId). @@unique kept; explicit composite added per spec
-- for planner stability on findMany/count (unique index already covers the
-- pair — this non-unique twin is intentionally redundant per spec).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "AssignmentSubmission_assignmentId_studentId_idx" ON "AssignmentSubmission"("assignmentId", "studentId");
