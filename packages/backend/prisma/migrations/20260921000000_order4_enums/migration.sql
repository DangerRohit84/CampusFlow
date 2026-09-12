-- Order 4 — Enum-as-String slice 1: closed hot domains (V-04 part + V-30 decision) → P7/P8.
--
-- DEPLOY STATUS: FILE CREATED, NOT APPLIED LIVE. Deploy applies via
-- `prisma migrate deploy` (uses DIRECT_URL). Do NOT run `prisma migrate dev`
-- against prod. Prisma enums are strings at runtime so old+new app code both
-- compare `user.role === 'STUDENT'` / `decision === 'APPROVED'` — rolling-safe
-- at the app layer (unlike Order 3 big-bang Json rename). DB layer does
-- transactional ALTER TYPE rewrites (safe at current scale; past ~1M rows split
-- per-domain UPDATEs into batches outside this file, then run this migration).
--
-- Design (25 cols, 18 new enums + reuse SubmissionMode):
-- - UserRole (User.role): STUDENT/TEACHER/COLLEGE_ADMIN/SUPER_ADMIN. Legacy
--   variants mapped: ADMIN→COLLEGE_ADMIN, STAFF→TEACHER, SUPER→SUPER_ADMIN.
-- - StagingDecision (both decision tables): APPROVED/REJECTED only.
--   Pending = absence (no PENDING row, V-30). Unknowns→REJECTED (conservative:
--   hides from pending, needs explicit re-approve; never auto-publishes) + log.
-- - StagingStatus shared (both stagings): DRAFT/PENDING/ACTIVE/APPROVED/REJECTED.
-- - Per-domain: HackathonStatus (DRAFT/PUBLISHED/COMPLETED/CANCELLED),
--   InternshipStatus (ACTIVE/ENDED), ContestStatus (UPCOMING/ONGOING/ENDED),
--   CollegeStatus (PENDING/APPROVED/REJECTED/SUSPENDED),
--   FormStatus (ACTIVE/CLOSED/DRAFT), ReportStatus (OPEN/IN_PROGRESS/RESOLVED/CLOSED),
--   TaskStatus + AssignmentStatus (both PENDING/IN_PROGRESS/COMPLETED/CANCELLED,
--   intentionally separate per-domain to allow divergence),
--   SubmissionStatus (SUBMITTED/LATE/GRADED/RETURNED),
--   RegistrationStatus shared (REGISTERED/SELECTED/REJECTED/COMPLETED/ACCEPTED),
--   SourceHealthStatus (OK/DEGRADED/DOWN/UNKNOWN).
-- - Priority shared (Assignment/Task/Notification/Report): LOW/MEDIUM/HIGH/CRITICAL.
-- - ReportScope (COLLEGE/WEBSITE), ReportIssueType (7), Platform shared
--   (CodingContest/ContestParticipation: CODEFORCES/CODECHEF/LEETCODE/ATCODER/
--   HACKERRANK/GFG/OTHER; GFG added — old allowlist forced OTHER).
-- - AssignmentSubmission.submissionChannel reuses existing SubmissionMode
--   (ONLINE/OFFLINE/HYBRID) — no new type (shared where values match).
-- - Deferred to Order 12 (stay String): Hackathon/Internship.mode,
--   Notification.type, Task.category, FormField.type, Room.chatMode,
--   Resource.fileType/category, PlatformSettings.platform/type,
--   SourceHealth.platform (PK, DEVFOLIO..WELLFOUND domain, not contest Platform),
--   AuditLog.*, AiUsage.*, AiRouting.*, AiProvider.type, UserIntegration.type,
--   Schedule.type, ChatMessage.role, InternshipStaging.role (job title, open text),
--   Internship.role (job title), Grade.grade, etc.
-- - V-30: @@index([collegeId, decision]) on both decision tables for
--   "my APPROVED / my REJECTED" lists; pending uses anti-join NOT decisions
--   some collegeId (staging.ts) + existing (collegeId) + unique(stagingId, collegeId).
--   decidedAt+createdAt twins KEPT (additive-safe; drop one in Order 12).
--
-- Documented order (P5/P7, single file):
--  0) Census (commented SELECTs — run before deploy, log counts, fix ghosts).
--  1) Normalize legacy variants → canonical (UPPER(TRIM()) coercion).
--  2) Conflict NOTICE per column (RAISE NOTICE with unknown counts — deploy
--     logs are the conflict log; unknowns normalize to safe defaults in §3).
--  3) Normalize remaining unknowns → safe defaults (never fail deploy on ghosts).
--  4) CREATE TYPE (DO $$ IF NOT EXISTS — idempotent).
--  5) ALTER COLUMN TYPE "Enum" USING UPPER(TRIM(col::text))::"Enum" + SET DEFAULT.
--  6) CREATE INDEX (collegeId, decision) transactional; CONCURRENTLY note for scale.
--
-- Deploy-safe notes:
-- - Transactional DDL (safe at current scale). Past ~1M rows, run §1/§3 UPDATEs
--   in batches outside this file:
--     UPDATE "User" SET "role"='STUDENT' WHERE "id" IN (SELECT "id" FROM "User"
--       WHERE UPPER(TRIM("role")) NOT IN ('STUDENT','TEACHER','COLLEGE_ADMIN','SUPER_ADMIN','ADMIN','STAFF','SUPER') LIMIT 1000);
--   then repeat until 0, then run this migration.
-- - Prisma `migrate deploy` runs in a transaction so CONCURRENTLY cannot live here.
--   At scale run outside instead and mark resolved:
--     CREATE INDEX CONCURRENTLY "HackathonStagingDecision_collegeId_decision_idx"
--       ON "HackathonStagingDecision"("collegeId", "decision");
-- - Idempotent via migrate deploy tracking; CREATE TYPE + CREATE INDEX use
--   IF NOT EXISTS / DO $$ guards. Manual re-run fails closed at §5
--   (already-enum USING cast still succeeds via ::text round-trip).
-- - No secrets. Backfills only (no deletes, no column drops).
-- - Requires PG14+ for string_agg in NOTICE (Neon PG17 OK).

-- ─────────────────────────────────────────────────────────────────────────────
-- 0) Census — run before deploy, log results, fix ghosts manually if large.
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT "role", COUNT(*) FROM "User" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT "status", COUNT(*) FROM "Assignment" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT "status", COUNT(*) FROM "Task" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT "status", COUNT(*) FROM "College" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT "status", COUNT(*) FROM "Hackathon" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT "status", COUNT(*) FROM "HackathonRegistration" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT "status", COUNT(*) FROM "HackathonStaging" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT "status", COUNT(*) FROM "InternshipStaging" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT "decision", COUNT(*) FROM "HackathonStagingDecision" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT "decision", COUNT(*) FROM "InternshipStagingDecision" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT "status", COUNT(*) FROM "Internship" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT "status", COUNT(*) FROM "InternshipRegistration" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT "platform", COUNT(*) FROM "CodingContest" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT "platform", COUNT(*) FROM "ContestParticipation" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT "status", COUNT(*) FROM "CodingContest" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT "status", COUNT(*) FROM "Form" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT "scope", COUNT(*) FROM "Report" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT "issueType", COUNT(*) FROM "Report" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT "priority", COUNT(*) FROM "Report" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT "status", COUNT(*) FROM "Report" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT "status", COUNT(*) FROM "AssignmentSubmission" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT "submissionChannel", COUNT(*) FROM "AssignmentSubmission" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT "priority", COUNT(*) FROM "Notification" GROUP BY 1 ORDER BY 2 DESC;
-- SELECT "status", COUNT(*) FROM "SourceHealth" GROUP BY 1 ORDER BY 2 DESC;
-- -- Ghost check (expect 0 after §1–§3; non-zero means new ghost since census):
-- -- SELECT COUNT(*) FROM "User" WHERE UPPER(TRIM("role")) NOT IN ('STUDENT','TEACHER','COLLEGE_ADMIN','SUPER_ADMIN','ADMIN','STAFF','SUPER');

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Normalize legacy variants → canonical (case/whitespace-tolerant).
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE "User" SET "role" = 'COLLEGE_ADMIN' WHERE UPPER(TRIM("role")) IN ('ADMIN', 'COLLEGEADMIN', 'COLLEGE ADMIN');
UPDATE "User" SET "role" = 'TEACHER' WHERE UPPER(TRIM("role")) IN ('STAFF', 'TEACHERS');
UPDATE "User" SET "role" = 'SUPER_ADMIN' WHERE UPPER(TRIM("role")) IN ('SUPER', 'SUPERADMIN', 'SUPER ADMIN', 'ADMINISTRATOR');
-- Normalize canonical to exact (trims whitespace/case drift, no-op if clean):
UPDATE "User" SET "role" = UPPER(TRIM("role")) WHERE "role" IS NOT NULL AND "role" <> UPPER(TRIM("role"));
UPDATE "Assignment" SET "status" = UPPER(TRIM("status")) WHERE "status" IS NOT NULL;
UPDATE "Assignment" SET "priority" = UPPER(TRIM("priority")) WHERE "priority" IS NOT NULL;
UPDATE "Task" SET "status" = UPPER(TRIM("status")) WHERE "status" IS NOT NULL;
UPDATE "Task" SET "priority" = UPPER(TRIM("priority")) WHERE "priority" IS NOT NULL;
UPDATE "College" SET "status" = UPPER(TRIM("status")) WHERE "status" IS NOT NULL;
UPDATE "Hackathon" SET "status" = UPPER(TRIM("status")) WHERE "status" IS NOT NULL;
UPDATE "HackathonRegistration" SET "status" = UPPER(TRIM("status")) WHERE "status" IS NOT NULL;
UPDATE "HackathonStaging" SET "status" = UPPER(TRIM("status")) WHERE "status" IS NOT NULL;
UPDATE "InternshipStaging" SET "status" = UPPER(TRIM("status")) WHERE "status" IS NOT NULL;
UPDATE "HackathonStagingDecision" SET "decision" = UPPER(TRIM("decision")) WHERE "decision" IS NOT NULL;
UPDATE "InternshipStagingDecision" SET "decision" = UPPER(TRIM("decision")) WHERE "decision" IS NOT NULL;
UPDATE "Internship" SET "status" = UPPER(TRIM("status")) WHERE "status" IS NOT NULL;
UPDATE "InternshipRegistration" SET "status" = UPPER(TRIM("status")) WHERE "status" IS NOT NULL;
UPDATE "CodingContest" SET "status" = UPPER(TRIM("status")) WHERE "status" IS NOT NULL;
UPDATE "CodingContest" SET "platform" = UPPER(TRIM("platform")) WHERE "platform" IS NOT NULL;
UPDATE "ContestParticipation" SET "platform" = UPPER(TRIM("platform")) WHERE "platform" IS NOT NULL;
UPDATE "Form" SET "status" = UPPER(TRIM("status")) WHERE "status" IS NOT NULL;
UPDATE "Report" SET "scope" = UPPER(TRIM("scope")) WHERE "scope" IS NOT NULL;
UPDATE "Report" SET "issueType" = UPPER(TRIM("issueType")) WHERE "issueType" IS NOT NULL;
UPDATE "Report" SET "priority" = UPPER(TRIM("priority")) WHERE "priority" IS NOT NULL;
UPDATE "Report" SET "status" = UPPER(TRIM("status")) WHERE "status" IS NOT NULL;
UPDATE "AssignmentSubmission" SET "status" = UPPER(TRIM("status")) WHERE "status" IS NOT NULL;
UPDATE "AssignmentSubmission" SET "submissionChannel" = UPPER(TRIM("submissionChannel")) WHERE "submissionChannel" IS NOT NULL;
UPDATE "Notification" SET "priority" = UPPER(TRIM("priority")) WHERE "priority" IS NOT NULL;
UPDATE "SourceHealth" SET "status" = UPPER(TRIM("status")) WHERE "status" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Conflict log — unknowns normalizing to safe defaults (deploy log = audit).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "User" WHERE UPPER(TRIM("role")) NOT IN ('STUDENT','TEACHER','COLLEGE_ADMIN','SUPER_ADMIN'); IF c > 0 THEN RAISE NOTICE 'Order4 conflict: User.role % rows unknown, normalizing to STUDENT', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "Assignment" WHERE UPPER(TRIM("status")) NOT IN ('PENDING','IN_PROGRESS','COMPLETED','CANCELLED'); IF c > 0 THEN RAISE NOTICE 'Order4 conflict: Assignment.status % rows unknown, normalizing to PENDING', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "Assignment" WHERE UPPER(TRIM("priority")) NOT IN ('LOW','MEDIUM','HIGH','CRITICAL'); IF c > 0 THEN RAISE NOTICE 'Order4 conflict: Assignment.priority % rows unknown, normalizing to MEDIUM', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "Task" WHERE UPPER(TRIM("status")) NOT IN ('PENDING','IN_PROGRESS','COMPLETED','CANCELLED'); IF c > 0 THEN RAISE NOTICE 'Order4 conflict: Task.status % rows unknown, normalizing to PENDING', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "Task" WHERE UPPER(TRIM("priority")) NOT IN ('LOW','MEDIUM','HIGH','CRITICAL'); IF c > 0 THEN RAISE NOTICE 'Order4 conflict: Task.priority % rows unknown, normalizing to MEDIUM', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "College" WHERE UPPER(TRIM("status")) NOT IN ('PENDING','APPROVED','REJECTED','SUSPENDED'); IF c > 0 THEN RAISE NOTICE 'Order4 conflict: College.status % rows unknown, normalizing to PENDING', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "Hackathon" WHERE UPPER(TRIM("status")) NOT IN ('DRAFT','PUBLISHED','COMPLETED','CANCELLED'); IF c > 0 THEN RAISE NOTICE 'Order4 conflict: Hackathon.status % rows unknown, normalizing to DRAFT', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "HackathonRegistration" WHERE UPPER(TRIM("status")) NOT IN ('REGISTERED','SELECTED','REJECTED','COMPLETED','ACCEPTED'); IF c > 0 THEN RAISE NOTICE 'Order4 conflict: HackathonRegistration.status % rows unknown, normalizing to REGISTERED', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "HackathonStaging" WHERE UPPER(TRIM("status")) NOT IN ('DRAFT','PENDING','ACTIVE','APPROVED','REJECTED'); IF c > 0 THEN RAISE NOTICE 'Order4 conflict: HackathonStaging.status % rows unknown, normalizing to DRAFT', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "InternshipStaging" WHERE UPPER(TRIM("status")) NOT IN ('DRAFT','PENDING','ACTIVE','APPROVED','REJECTED'); IF c > 0 THEN RAISE NOTICE 'Order4 conflict: InternshipStaging.status % rows unknown, normalizing to ACTIVE', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "HackathonStagingDecision" WHERE UPPER(TRIM("decision")) NOT IN ('APPROVED','REJECTED'); IF c > 0 THEN RAISE NOTICE 'Order4 conflict: HackathonStagingDecision.decision % rows unknown, normalizing to REJECTED (conservative, needs re-approve)', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "InternshipStagingDecision" WHERE UPPER(TRIM("decision")) NOT IN ('APPROVED','REJECTED'); IF c > 0 THEN RAISE NOTICE 'Order4 conflict: InternshipStagingDecision.decision % rows unknown, normalizing to REJECTED', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "Internship" WHERE UPPER(TRIM("status")) NOT IN ('ACTIVE','ENDED'); IF c > 0 THEN RAISE NOTICE 'Order4 conflict: Internship.status % rows unknown, normalizing to ACTIVE', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "InternshipRegistration" WHERE UPPER(TRIM("status")) NOT IN ('REGISTERED','SELECTED','REJECTED','COMPLETED','ACCEPTED'); IF c > 0 THEN RAISE NOTICE 'Order4 conflict: InternshipRegistration.status % rows unknown, normalizing to REGISTERED', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "CodingContest" WHERE UPPER(TRIM("status")) NOT IN ('UPCOMING','ONGOING','ENDED'); IF c > 0 THEN RAISE NOTICE 'Order4 conflict: CodingContest.status % rows unknown, normalizing to UPCOMING', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "CodingContest" WHERE UPPER(TRIM("platform")) NOT IN ('CODEFORCES','CODECHEF','LEETCODE','ATCODER','HACKERRANK','GFG','OTHER'); IF c > 0 THEN RAISE NOTICE 'Order4 conflict: CodingContest.platform % rows unknown, normalizing to OTHER', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "ContestParticipation" WHERE UPPER(TRIM("platform")) NOT IN ('CODEFORCES','CODECHEF','LEETCODE','ATCODER','HACKERRANK','GFG','OTHER'); IF c > 0 THEN RAISE NOTICE 'Order4 conflict: ContestParticipation.platform % rows unknown, normalizing to OTHER', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "Form" WHERE UPPER(TRIM("status")) NOT IN ('ACTIVE','CLOSED','DRAFT'); IF c > 0 THEN RAISE NOTICE 'Order4 conflict: Form.status % rows unknown, normalizing to ACTIVE', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "Report" WHERE UPPER(TRIM("scope")) NOT IN ('COLLEGE','WEBSITE'); IF c > 0 THEN RAISE NOTICE 'Order4 conflict: Report.scope % rows unknown, normalizing to WEBSITE', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "Report" WHERE UPPER(TRIM("issueType")) NOT IN ('DESIGN','BUG','CRASH','PERFORMANCE','SECURITY','FEATURE_REQUEST','OTHER'); IF c > 0 THEN RAISE NOTICE 'Order4 conflict: Report.issueType % rows unknown, normalizing to OTHER', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "Report" WHERE UPPER(TRIM("priority")) NOT IN ('LOW','MEDIUM','HIGH','CRITICAL'); IF c > 0 THEN RAISE NOTICE 'Order4 conflict: Report.priority % rows unknown, normalizing to MEDIUM', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "Report" WHERE UPPER(TRIM("status")) NOT IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED'); IF c > 0 THEN RAISE NOTICE 'Order4 conflict: Report.status % rows unknown, normalizing to OPEN', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "AssignmentSubmission" WHERE UPPER(TRIM("status")) NOT IN ('SUBMITTED','LATE','GRADED','RETURNED'); IF c > 0 THEN RAISE NOTICE 'Order4 conflict: AssignmentSubmission.status % rows unknown, normalizing to SUBMITTED', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "AssignmentSubmission" WHERE UPPER(TRIM("submissionChannel")) NOT IN ('ONLINE','OFFLINE','HYBRID'); IF c > 0 THEN RAISE NOTICE 'Order4 conflict: AssignmentSubmission.submissionChannel % rows unknown, normalizing to ONLINE', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "Notification" WHERE UPPER(TRIM("priority")) NOT IN ('LOW','MEDIUM','HIGH','CRITICAL'); IF c > 0 THEN RAISE NOTICE 'Order4 conflict: Notification.priority % rows unknown, normalizing to MEDIUM', c; END IF; END $$;
DO $$ DECLARE c INT; BEGIN SELECT COUNT(*) INTO c FROM "SourceHealth" WHERE UPPER(TRIM("status")) NOT IN ('OK','DEGRADED','DOWN','UNKNOWN'); IF c > 0 THEN RAISE NOTICE 'Order4 conflict: SourceHealth.status % rows unknown, normalizing to UNKNOWN', c; END IF; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Normalize remaining unknowns → safe defaults (so §5 USING cast never fails).
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE "User" SET "role" = 'STUDENT' WHERE UPPER(TRIM("role")) NOT IN ('STUDENT','TEACHER','COLLEGE_ADMIN','SUPER_ADMIN') OR "role" IS NULL;
UPDATE "Assignment" SET "status" = 'PENDING' WHERE UPPER(TRIM("status")) NOT IN ('PENDING','IN_PROGRESS','COMPLETED','CANCELLED') OR "status" IS NULL;
UPDATE "Assignment" SET "priority" = 'MEDIUM' WHERE UPPER(TRIM("priority")) NOT IN ('LOW','MEDIUM','HIGH','CRITICAL') OR "priority" IS NULL;
UPDATE "Task" SET "status" = 'PENDING' WHERE UPPER(TRIM("status")) NOT IN ('PENDING','IN_PROGRESS','COMPLETED','CANCELLED') OR "status" IS NULL;
UPDATE "Task" SET "priority" = 'MEDIUM' WHERE UPPER(TRIM("priority")) NOT IN ('LOW','MEDIUM','HIGH','CRITICAL') OR "priority" IS NULL;
UPDATE "College" SET "status" = 'PENDING' WHERE UPPER(TRIM("status")) NOT IN ('PENDING','APPROVED','REJECTED','SUSPENDED') OR "status" IS NULL;
UPDATE "Hackathon" SET "status" = 'DRAFT' WHERE UPPER(TRIM("status")) NOT IN ('DRAFT','PUBLISHED','COMPLETED','CANCELLED') OR "status" IS NULL;
UPDATE "HackathonRegistration" SET "status" = 'REGISTERED' WHERE UPPER(TRIM("status")) NOT IN ('REGISTERED','SELECTED','REJECTED','COMPLETED','ACCEPTED') OR "status" IS NULL;
UPDATE "HackathonStaging" SET "status" = 'DRAFT' WHERE UPPER(TRIM("status")) NOT IN ('DRAFT','PENDING','ACTIVE','APPROVED','REJECTED') OR "status" IS NULL;
UPDATE "InternshipStaging" SET "status" = 'ACTIVE' WHERE UPPER(TRIM("status")) NOT IN ('DRAFT','PENDING','ACTIVE','APPROVED','REJECTED') OR "status" IS NULL;
UPDATE "HackathonStagingDecision" SET "decision" = 'REJECTED' WHERE UPPER(TRIM("decision")) NOT IN ('APPROVED','REJECTED') OR "decision" IS NULL;
UPDATE "InternshipStagingDecision" SET "decision" = 'REJECTED' WHERE UPPER(TRIM("decision")) NOT IN ('APPROVED','REJECTED') OR "decision" IS NULL;
UPDATE "Internship" SET "status" = 'ACTIVE' WHERE UPPER(TRIM("status")) NOT IN ('ACTIVE','ENDED') OR "status" IS NULL;
UPDATE "InternshipRegistration" SET "status" = 'REGISTERED' WHERE UPPER(TRIM("status")) NOT IN ('REGISTERED','SELECTED','REJECTED','COMPLETED','ACCEPTED') OR "status" IS NULL;
UPDATE "CodingContest" SET "status" = 'UPCOMING' WHERE UPPER(TRIM("status")) NOT IN ('UPCOMING','ONGOING','ENDED') OR "status" IS NULL;
UPDATE "CodingContest" SET "platform" = 'OTHER' WHERE UPPER(TRIM("platform")) NOT IN ('CODEFORCES','CODECHEF','LEETCODE','ATCODER','HACKERRANK','GFG','OTHER') OR "platform" IS NULL;
UPDATE "ContestParticipation" SET "platform" = 'OTHER' WHERE UPPER(TRIM("platform")) NOT IN ('CODEFORCES','CODECHEF','LEETCODE','ATCODER','HACKERRANK','GFG','OTHER') OR "platform" IS NULL;
UPDATE "Form" SET "status" = 'ACTIVE' WHERE UPPER(TRIM("status")) NOT IN ('ACTIVE','CLOSED','DRAFT') OR "status" IS NULL;
UPDATE "Report" SET "scope" = 'WEBSITE' WHERE UPPER(TRIM("scope")) NOT IN ('COLLEGE','WEBSITE') OR "scope" IS NULL;
UPDATE "Report" SET "issueType" = 'OTHER' WHERE UPPER(TRIM("issueType")) NOT IN ('DESIGN','BUG','CRASH','PERFORMANCE','SECURITY','FEATURE_REQUEST','OTHER') OR "issueType" IS NULL;
UPDATE "Report" SET "priority" = 'MEDIUM' WHERE UPPER(TRIM("priority")) NOT IN ('LOW','MEDIUM','HIGH','CRITICAL') OR "priority" IS NULL;
UPDATE "Report" SET "status" = 'OPEN' WHERE UPPER(TRIM("status")) NOT IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED') OR "status" IS NULL;
UPDATE "AssignmentSubmission" SET "status" = 'SUBMITTED' WHERE UPPER(TRIM("status")) NOT IN ('SUBMITTED','LATE','GRADED','RETURNED') OR "status" IS NULL;
UPDATE "AssignmentSubmission" SET "submissionChannel" = 'ONLINE' WHERE UPPER(TRIM("submissionChannel")) NOT IN ('ONLINE','OFFLINE','HYBRID') OR "submissionChannel" IS NULL;
UPDATE "Notification" SET "priority" = 'MEDIUM' WHERE UPPER(TRIM("priority")) NOT IN ('LOW','MEDIUM','HIGH','CRITICAL') OR "priority" IS NULL;
UPDATE "SourceHealth" SET "status" = 'UNKNOWN' WHERE UPPER(TRIM("status")) NOT IN ('OK','DEGRADED','DOWN','UNKNOWN') OR "status" IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) CREATE TYPE (DO $$ IF NOT EXISTS — idempotent, Prisma map names match).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UserRole') THEN CREATE TYPE "UserRole" AS ENUM ('STUDENT', 'TEACHER', 'COLLEGE_ADMIN', 'SUPER_ADMIN'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StagingDecision') THEN CREATE TYPE "StagingDecision" AS ENUM ('APPROVED', 'REJECTED'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StagingStatus') THEN CREATE TYPE "StagingStatus" AS ENUM ('DRAFT', 'PENDING', 'ACTIVE', 'APPROVED', 'REJECTED'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'HackathonStatus') THEN CREATE TYPE "HackathonStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'COMPLETED', 'CANCELLED'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InternshipStatus') THEN CREATE TYPE "InternshipStatus" AS ENUM ('ACTIVE', 'ENDED'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ContestStatus') THEN CREATE TYPE "ContestStatus" AS ENUM ('UPCOMING', 'ONGOING', 'ENDED'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CollegeStatus') THEN CREATE TYPE "CollegeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FormStatus') THEN CREATE TYPE "FormStatus" AS ENUM ('ACTIVE', 'CLOSED', 'DRAFT'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReportStatus') THEN CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReportScope') THEN CREATE TYPE "ReportScope" AS ENUM ('COLLEGE', 'WEBSITE'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReportIssueType') THEN CREATE TYPE "ReportIssueType" AS ENUM ('DESIGN', 'BUG', 'CRASH', 'PERFORMANCE', 'SECURITY', 'FEATURE_REQUEST', 'OTHER'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Priority') THEN CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TaskStatus') THEN CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AssignmentStatus') THEN CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubmissionStatus') THEN CREATE TYPE "SubmissionStatus" AS ENUM ('SUBMITTED', 'LATE', 'GRADED', 'RETURNED'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RegistrationStatus') THEN CREATE TYPE "RegistrationStatus" AS ENUM ('REGISTERED', 'SELECTED', 'REJECTED', 'COMPLETED', 'ACCEPTED'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SourceHealthStatus') THEN CREATE TYPE "SourceHealthStatus" AS ENUM ('OK', 'DEGRADED', 'DOWN', 'UNKNOWN'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Platform') THEN CREATE TYPE "Platform" AS ENUM ('CODEFORCES', 'CODECHEF', 'LEETCODE', 'ATCODER', 'HACKERRANK', 'GFG', 'OTHER'); END IF; END $$;
-- SubmissionMode already exists (ONLINE/OFFLINE/HYBRID) — reused for AssignmentSubmission.submissionChannel, no new type.

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) ALTER COLUMN TYPE "Enum" USING UPPER(TRIM(col::text))::"Enum" + SET DEFAULT.
--    ::text round-trip keeps manual re-run safe (already-enum still casts).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole" USING UPPER(TRIM("role"::text))::"UserRole";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'STUDENT'::"UserRole";
ALTER TABLE "Assignment" ALTER COLUMN "status" TYPE "AssignmentStatus" USING UPPER(TRIM("status"::text))::"AssignmentStatus";
ALTER TABLE "Assignment" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"AssignmentStatus";
ALTER TABLE "Assignment" ALTER COLUMN "priority" TYPE "Priority" USING UPPER(TRIM("priority"::text))::"Priority";
ALTER TABLE "Assignment" ALTER COLUMN "priority" SET DEFAULT 'MEDIUM'::"Priority";
ALTER TABLE "Task" ALTER COLUMN "status" TYPE "TaskStatus" USING UPPER(TRIM("status"::text))::"TaskStatus";
ALTER TABLE "Task" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"TaskStatus";
ALTER TABLE "Task" ALTER COLUMN "priority" TYPE "Priority" USING UPPER(TRIM("priority"::text))::"Priority";
ALTER TABLE "Task" ALTER COLUMN "priority" SET DEFAULT 'MEDIUM'::"Priority";
ALTER TABLE "College" ALTER COLUMN "status" TYPE "CollegeStatus" USING UPPER(TRIM("status"::text))::"CollegeStatus";
ALTER TABLE "College" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"CollegeStatus";
ALTER TABLE "Hackathon" ALTER COLUMN "status" TYPE "HackathonStatus" USING UPPER(TRIM("status"::text))::"HackathonStatus";
ALTER TABLE "Hackathon" ALTER COLUMN "status" SET DEFAULT 'DRAFT'::"HackathonStatus";
ALTER TABLE "HackathonRegistration" ALTER COLUMN "status" TYPE "RegistrationStatus" USING UPPER(TRIM("status"::text))::"RegistrationStatus";
ALTER TABLE "HackathonRegistration" ALTER COLUMN "status" SET DEFAULT 'REGISTERED'::"RegistrationStatus";
ALTER TABLE "HackathonStaging" ALTER COLUMN "status" TYPE "StagingStatus" USING UPPER(TRIM("status"::text))::"StagingStatus";
ALTER TABLE "HackathonStaging" ALTER COLUMN "status" SET DEFAULT 'DRAFT'::"StagingStatus";
ALTER TABLE "InternshipStaging" ALTER COLUMN "status" TYPE "StagingStatus" USING UPPER(TRIM("status"::text))::"StagingStatus";
ALTER TABLE "InternshipStaging" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'::"StagingStatus";
ALTER TABLE "HackathonStagingDecision" ALTER COLUMN "decision" TYPE "StagingDecision" USING UPPER(TRIM("decision"::text))::"StagingDecision";
ALTER TABLE "InternshipStagingDecision" ALTER COLUMN "decision" TYPE "StagingDecision" USING UPPER(TRIM("decision"::text))::"StagingDecision";
ALTER TABLE "Internship" ALTER COLUMN "status" TYPE "InternshipStatus" USING UPPER(TRIM("status"::text))::"InternshipStatus";
ALTER TABLE "Internship" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'::"InternshipStatus";
ALTER TABLE "InternshipRegistration" ALTER COLUMN "status" TYPE "RegistrationStatus" USING UPPER(TRIM("status"::text))::"RegistrationStatus";
ALTER TABLE "InternshipRegistration" ALTER COLUMN "status" SET DEFAULT 'REGISTERED'::"RegistrationStatus";
ALTER TABLE "CodingContest" ALTER COLUMN "status" TYPE "ContestStatus" USING UPPER(TRIM("status"::text))::"ContestStatus";
ALTER TABLE "CodingContest" ALTER COLUMN "status" SET DEFAULT 'UPCOMING'::"ContestStatus";
ALTER TABLE "CodingContest" ALTER COLUMN "platform" TYPE "Platform" USING UPPER(TRIM("platform"::text))::"Platform";
ALTER TABLE "ContestParticipation" ALTER COLUMN "platform" TYPE "Platform" USING UPPER(TRIM("platform"::text))::"Platform";
ALTER TABLE "Form" ALTER COLUMN "status" TYPE "FormStatus" USING UPPER(TRIM("status"::text))::"FormStatus";
ALTER TABLE "Form" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'::"FormStatus";
ALTER TABLE "Report" ALTER COLUMN "scope" TYPE "ReportScope" USING UPPER(TRIM("scope"::text))::"ReportScope";
ALTER TABLE "Report" ALTER COLUMN "scope" SET DEFAULT 'WEBSITE'::"ReportScope";
ALTER TABLE "Report" ALTER COLUMN "issueType" TYPE "ReportIssueType" USING UPPER(TRIM("issueType"::text))::"ReportIssueType";
ALTER TABLE "Report" ALTER COLUMN "priority" TYPE "Priority" USING UPPER(TRIM("priority"::text))::"Priority";
ALTER TABLE "Report" ALTER COLUMN "priority" SET DEFAULT 'MEDIUM'::"Priority";
ALTER TABLE "Report" ALTER COLUMN "status" TYPE "ReportStatus" USING UPPER(TRIM("status"::text))::"ReportStatus";
ALTER TABLE "Report" ALTER COLUMN "status" SET DEFAULT 'OPEN'::"ReportStatus";
ALTER TABLE "AssignmentSubmission" ALTER COLUMN "status" TYPE "SubmissionStatus" USING UPPER(TRIM("status"::text))::"SubmissionStatus";
ALTER TABLE "AssignmentSubmission" ALTER COLUMN "status" SET DEFAULT 'SUBMITTED'::"SubmissionStatus";
ALTER TABLE "AssignmentSubmission" ALTER COLUMN "submissionChannel" TYPE "SubmissionMode" USING UPPER(TRIM("submissionChannel"::text))::"SubmissionMode";
ALTER TABLE "AssignmentSubmission" ALTER COLUMN "submissionChannel" SET DEFAULT 'ONLINE'::"SubmissionMode";
ALTER TABLE "Notification" ALTER COLUMN "priority" TYPE "Priority" USING UPPER(TRIM("priority"::text))::"Priority";
ALTER TABLE "Notification" ALTER COLUMN "priority" SET DEFAULT 'MEDIUM'::"Priority";
ALTER TABLE "SourceHealth" ALTER COLUMN "status" TYPE "SourceHealthStatus" USING UPPER(TRIM("status"::text))::"SourceHealthStatus";
ALTER TABLE "SourceHealth" ALTER COLUMN "status" SET DEFAULT 'UNKNOWN'::"SourceHealthStatus";

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) V-30 pending-list indexes: (collegeId, decision) for my APPROVED/REJECTED.
--    Transactional CREATE INDEX (safe at current scale). Past ~1M rows run
--    outside a transaction instead:
--      CREATE INDEX CONCURRENTLY "HackathonStagingDecision_collegeId_decision_idx"
--        ON "HackathonStagingDecision"("collegeId", "decision");
--    Prisma schema uses @@index([collegeId, decision]) so these names are what
--    `prisma migrate diff` expects (no drift on next migrate).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "HackathonStagingDecision_collegeId_decision_idx" ON "HackathonStagingDecision"("collegeId", "decision");
CREATE INDEX IF NOT EXISTS "InternshipStagingDecision_collegeId_decision_idx" ON "InternshipStagingDecision"("collegeId", "decision");
