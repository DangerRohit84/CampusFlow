-- 10k perf: missing indexes + Json twins (dual-write window)
-- Idempotent: safe to re-run via `prisma migrate deploy`.
-- Pattern: CREATE INDEX IF NOT EXISTS + ADD COLUMN IF NOT EXISTS (JSONB).
-- Keeps legacy String columns for 1 release; new Json columns are nullable twins.
-- Dual-write in app (src/lib/validators.ts); backfill lazily on read + batch job later.
-- See .ai/reports/perf-db.md §Json migration for drop plan.

-- ---------------------------------------------------------------------------
-- User: admin pagination by createdAt
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "User_collegeId_createdAt_idx" ON "User"("collegeId", "createdAt");
CREATE INDEX IF NOT EXISTS "User_createdAt_idx" ON "User"("createdAt");

-- ---------------------------------------------------------------------------
-- Notification: per-user inbox (most-polled table at 10k)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "Notification_userId_idx" ON "Notification"("userId");
CREATE INDEX IF NOT EXISTS "Notification_userId_read_idx" ON "Notification"("userId", "read");
CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- ---------------------------------------------------------------------------
-- Legacy Assignment (deprecated but still read)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "Assignment_userId_idx" ON "Assignment"("userId");
CREATE INDEX IF NOT EXISTS "Assignment_userId_status_idx" ON "Assignment"("userId", "status");

-- ---------------------------------------------------------------------------
-- Grade / Task / Chat (dashboard hot paths)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "Grade_userId_idx" ON "Grade"("userId");
CREATE INDEX IF NOT EXISTS "Grade_userId_semester_idx" ON "Grade"("userId", "semester");

CREATE INDEX IF NOT EXISTS "Task_userId_idx" ON "Task"("userId");
CREATE INDEX IF NOT EXISTS "Task_userId_status_idx" ON "Task"("userId", "status");
CREATE INDEX IF NOT EXISTS "Task_userId_date_idx" ON "Task"("userId", "date");

CREATE INDEX IF NOT EXISTS "ChatSession_userId_idx" ON "ChatSession"("userId");
CREATE INDEX IF NOT EXISTS "ChatSession_userId_updatedAt_idx" ON "ChatSession"("userId", "updatedAt");
CREATE INDEX IF NOT EXISTS "ChatMessage_sessionId_idx" ON "ChatMessage"("sessionId");
CREATE INDEX IF NOT EXISTS "ChatMessage_sessionId_createdAt_idx" ON "ChatMessage"("sessionId", "createdAt");

CREATE INDEX IF NOT EXISTS "UserIntegration_userId_idx" ON "UserIntegration"("userId");

-- ---------------------------------------------------------------------------
-- College / Course / Enrollment
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "College_status_idx" ON "College"("status");

CREATE INDEX IF NOT EXISTS "Course_collegeId_idx" ON "Course"("collegeId");
CREATE INDEX IF NOT EXISTS "Course_teacherId_idx" ON "Course"("teacherId");
CREATE INDEX IF NOT EXISTS "Course_collegeId_semester_idx" ON "Course"("collegeId", "semester");

CREATE INDEX IF NOT EXISTS "Enrollment_studentId_idx" ON "Enrollment"("studentId");
CREATE INDEX IF NOT EXISTS "Enrollment_courseId_idx" ON "Enrollment"("courseId");

-- ---------------------------------------------------------------------------
-- Hackathon / Internship registrations + rounds
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "HackathonRegistration_hackathonId_idx" ON "HackathonRegistration"("hackathonId");
CREATE INDEX IF NOT EXISTS "HackathonRegistration_userId_idx" ON "HackathonRegistration"("userId");
CREATE INDEX IF NOT EXISTS "HackathonRound_hackathonId_idx" ON "HackathonRound"("hackathonId");

CREATE INDEX IF NOT EXISTS "InternshipRegistration_internshipId_idx" ON "InternshipRegistration"("internshipId");
CREATE INDEX IF NOT EXISTS "InternshipRegistration_userId_idx" ON "InternshipRegistration"("userId");

-- ---------------------------------------------------------------------------
-- Forms
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "FormField_formId_idx" ON "FormField"("formId");
CREATE INDEX IF NOT EXISTS "FormField_formId_order_idx" ON "FormField"("formId", "order");
CREATE INDEX IF NOT EXISTS "FormResponse_formId_idx" ON "FormResponse"("formId");
CREATE INDEX IF NOT EXISTS "FormResponse_userId_idx" ON "FormResponse"("userId");

-- ---------------------------------------------------------------------------
-- Schedule / Announcement / Rooms
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "Schedule_userId_dayOfWeek_idx" ON "Schedule"("userId", "dayOfWeek");

CREATE INDEX IF NOT EXISTS "Announcement_creatorId_idx" ON "Announcement"("creatorId");

CREATE INDEX IF NOT EXISTS "RoomMessage_roomId_isDeleted_idx" ON "RoomMessage"("roomId", "isDeleted");
CREATE INDEX IF NOT EXISTS "Resource_roomId_createdAt_idx" ON "Resource"("roomId", "createdAt");
CREATE INDEX IF NOT EXISTS "RoomNotification_studentId_isRead_idx" ON "RoomNotification"("studentId", "isRead");
CREATE INDEX IF NOT EXISTS "RoomNotification_roomId_createdAt_idx" ON "RoomNotification"("roomId", "createdAt");

-- ---------------------------------------------------------------------------
-- AI routing
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "AiProvider_collegeId_idx" ON "AiProvider"("collegeId");
CREATE INDEX IF NOT EXISTS "AiRouting_providerId_idx" ON "AiRouting"("providerId");
CREATE INDEX IF NOT EXISTS "AiRouting_feature_idx" ON "AiRouting"("feature");

-- ---------------------------------------------------------------------------
-- Json twins (additive only — legacy String columns untouched for 1 release)
-- Prisma Json <-> Postgres JSONB. Nullable, no default (dual-write fills going forward).
-- ---------------------------------------------------------------------------
ALTER TABLE "Hackathon" ADD COLUMN IF NOT EXISTS "targetDepartmentsJson" JSONB;
ALTER TABLE "Hackathon" ADD COLUMN IF NOT EXISTS "targetYearsJson" JSONB;
ALTER TABLE "Hackathon" ADD COLUMN IF NOT EXISTS "themesJson" JSONB;

ALTER TABLE "HackathonStaging" ADD COLUMN IF NOT EXISTS "targetDepartmentsJson" JSONB;
ALTER TABLE "HackathonStaging" ADD COLUMN IF NOT EXISTS "targetYearsJson" JSONB;
ALTER TABLE "HackathonStaging" ADD COLUMN IF NOT EXISTS "themesJson" JSONB;

ALTER TABLE "Internship" ADD COLUMN IF NOT EXISTS "targetDepartmentsJson" JSONB;
ALTER TABLE "Internship" ADD COLUMN IF NOT EXISTS "targetYearsJson" JSONB;

ALTER TABLE "InternshipStaging" ADD COLUMN IF NOT EXISTS "targetDepartmentsJson" JSONB;
ALTER TABLE "InternshipStaging" ADD COLUMN IF NOT EXISTS "targetYearsJson" JSONB;

ALTER TABLE "Form" ADD COLUMN IF NOT EXISTS "targetDepartmentsJson" JSONB;
ALTER TABLE "Form" ADD COLUMN IF NOT EXISTS "targetYearsJson" JSONB;

ALTER TABLE "CodingContest" ADD COLUMN IF NOT EXISTS "solutionsJson" JSONB;

-- ---------------------------------------------------------------------------
-- Optional one-time backfill: populate Json twins from legacy Strings where valid JSON.
-- Safe: only fills NULL twins, never overwrites; invalid JSON stays NULL (app falls back to String).
-- Commented cost note: O(n) one-time scan, run during low traffic for 10k rows (~seconds).
-- Uncomment to backfill inline, or run as batch job (see perf-db.md).
-- ---------------------------------------------------------------------------
-- UPDATE "Hackathon" SET "targetDepartmentsJson" = "targetDepartments"::jsonb
--   WHERE "targetDepartmentsJson" IS NULL AND "targetDepartments" IS NOT NULL AND "targetDepartments" <> ''
--   AND pg_input_is_valid("targetDepartments", 'json');
-- (Repeat per table/column as needed — kept commented to keep deploy fast; app readDualJson() covers mixed rows.)
