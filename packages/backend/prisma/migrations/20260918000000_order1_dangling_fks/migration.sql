-- Order 1 — Dangling FKs (V-26 + FK onDelete gaps) → P4.
-- Converts ~15 String FK-lookalikes to real FOREIGN KEYs + declares onDelete
-- on every College-rooted relation (Prisma default NoAction was a footgun).
--
-- DEPLOY STATUS: FILE CREATED, NOT APPLIED LIVE. Deploy applies via
-- `prisma migrate deploy`. Do NOT run `prisma migrate dev` against prod.
--
-- Deploy-safe notes (P4/P5):
-- - Additive only: no table/column drops, no renames. Two nullability relaxations
--   (Assignment.courseId required→optional, RevokedToken.userId required→optional)
--   are backward-compatible (old writers pass strings, new readers accept null).
-- - Orphan handling BEFORE each ADD CONSTRAINT: nullable FKs park orphans to NULL
--   (preserves rows); natural-PK FKs (SyncThrottle, AiQuota) and required billing
--   refs (AiUsage) DELETE only rows whose parent is already gone (already corrupt).
--   Census each table first on large DBs:
--     SELECT '<table>', COUNT(*) FROM "<table>" t LEFT JOIN "<parent>" p
--       ON p."id"=t."<fk>" WHERE t."<fk>" IS NOT NULL AND p."id" IS NULL;
-- - This file uses transactional ADD CONSTRAINT + CREATE INDEX (safe at current
--   scale). Past ~1M rows, run the equivalent OUTSIDE a transaction instead:
--     CREATE INDEX CONCURRENTLY ...; ALTER TABLE ... ADD CONSTRAINT ... NOT VALID;
--     ALTER TABLE ... VALIDATE CONSTRAINT ...; (then prisma migrate resolve --applied)
-- - Prisma schema (schema.prisma) is the source of truth for relation names and
--   onDelete; this SQL mirrors it. Constraint names follow Prisma defaults
--   ("<Table>_<column>_fkey") so future `prisma migrate diff` stays clean.
-- - Idempotent: every statement is IF NOT EXISTS / DO $$ guarded — safe to re-run
--   via `prisma migrate deploy`.
-- - No secrets. No data backfills beyond orphan parking.

-- ═══════════════════════════════════════════════════════════════════
-- 0) Nullability relaxations (must precede FK creation)
-- ═══════════════════════════════════════════════════════════════════
-- Assignment.courseId: required String → optional (SET NULL needs nullability).
ALTER TABLE "Assignment" ALTER COLUMN "courseId" DROP NOT NULL;
-- RevokedToken.userId: required String → optional (FK + NULL for anonymous revocations;
-- old 'unknown' placeholder would violate the FK — parked to NULL in §1).
ALTER TABLE "RevokedToken" ALTER COLUMN "userId" DROP NOT NULL;

-- ═══════════════════════════════════════════════════════════════════
-- 1) Orphan parking (nullable FKs → NULL; corrupt required rows → DELETE)
-- ═══════════════════════════════════════════════════════════════════
UPDATE "Assignment" SET "courseId" = NULL WHERE "courseId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Course" c WHERE c."id" = "Assignment"."courseId");
UPDATE "Task" SET "courseId" = NULL WHERE "courseId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Course" c WHERE c."id" = "Task"."courseId");
UPDATE "AssignmentHub" SET "courseId" = NULL WHERE "courseId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Course" c WHERE c."id" = "AssignmentHub"."courseId");
UPDATE "ContestParticipation" SET "contestId" = NULL WHERE "contestId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "CodingContest" c WHERE c."id" = "ContestParticipation"."contestId");
UPDATE "Resource" SET "sourceMessageId" = NULL WHERE "sourceMessageId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "RoomMessage" m WHERE m."id" = "Resource"."sourceMessageId");
UPDATE "RoomMessage" SET "pinnedBy" = NULL WHERE "pinnedBy" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = "RoomMessage"."pinnedBy");
UPDATE "FormView" SET "fieldId" = NULL WHERE "fieldId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "FormField" f WHERE f."id" = "FormView"."fieldId");
UPDATE "FormView" SET "userId" = NULL WHERE "userId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = "FormView"."userId");
UPDATE "AuditLog" SET "actorId" = NULL WHERE "actorId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = "AuditLog"."actorId");
UPDATE "AuditLog" SET "collegeId" = NULL WHERE "collegeId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "College" c WHERE c."id" = "AuditLog"."collegeId");
UPDATE "AiRouting" SET "collegeId" = NULL WHERE "collegeId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "College" c WHERE c."id" = "AiRouting"."collegeId");
UPDATE "AiProvider" SET "collegeId" = NULL WHERE "collegeId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "College" c WHERE c."id" = "AiProvider"."collegeId");
UPDATE "HackathonStagingDecision" SET "decidedBy" = NULL WHERE "decidedBy" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = "HackathonStagingDecision"."decidedBy");
UPDATE "InternshipStagingDecision" SET "decidedBy" = NULL WHERE "decidedBy" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = "InternshipStagingDecision"."decidedBy");
-- RevokedToken: 'unknown' placeholder + any orphan → NULL (preserves revocation rows).
UPDATE "RevokedToken" SET "userId" = NULL WHERE "userId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = "RevokedToken"."userId");
-- Required/natural-PK refs: orphans are already corrupt — delete only those rows.
DELETE FROM "AiUsage" WHERE NOT EXISTS (SELECT 1 FROM "College" c WHERE c."id" = "AiUsage"."collegeId");
DELETE FROM "AiQuota" WHERE NOT EXISTS (SELECT 1 FROM "College" c WHERE c."id" = "AiQuota"."collegeId");
DELETE FROM "SyncThrottle" WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = "SyncThrottle"."userId");

-- ═══════════════════════════════════════════════════════════════════
-- 2) Supporting indexes for every new FK (IF NOT EXISTS; CONCURRENTLY variant
--    documented above for >1M-row tables)
-- ═══════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS "Assignment_courseId_idx" ON "Assignment"("courseId");
CREATE INDEX IF NOT EXISTS "Task_courseId_idx" ON "Task"("courseId");
CREATE INDEX IF NOT EXISTS "AssignmentHub_courseId_idx" ON "AssignmentHub"("courseId");
-- ContestParticipation(contestId) index exists (ContestParticipation_contestId_idx).
CREATE INDEX IF NOT EXISTS "Resource_sourceMessageId_idx" ON "Resource"("sourceMessageId");
CREATE INDEX IF NOT EXISTS "RoomMessage_pinnedBy_idx" ON "RoomMessage"("pinnedBy");
CREATE INDEX IF NOT EXISTS "FormView_fieldId_idx" ON "FormView"("fieldId");
CREATE INDEX IF NOT EXISTS "FormView_userId_idx" ON "FormView"("userId");
-- AuditLog(actorId) exists; AuditLog(collegeId) covered by (collegeId, createdAt) + explicit:
CREATE INDEX IF NOT EXISTS "AuditLog_collegeId_idx" ON "AuditLog"("collegeId");
CREATE INDEX IF NOT EXISTS "AiRouting_collegeId_idx" ON "AiRouting"("collegeId");
-- AiProvider(collegeId), AiUsage(collegeId/day), RevokedToken(userId) indexes exist.
CREATE INDEX IF NOT EXISTS "HackathonStagingDecision_decidedBy_idx" ON "HackathonStagingDecision"("decidedBy");
CREATE INDEX IF NOT EXISTS "InternshipStagingDecision_decidedBy_idx" ON "InternshipStagingDecision"("decidedBy");

-- ═══════════════════════════════════════════════════════════════════
-- 3) New FKs for dangling String columns
--    onDelete policy: Cascade = owned child rows (throttle, revocation, quota,
--    contest reminder-style); SetNull = nullable-optional refs (courses, pins,
--    views, audit actor, routing, decidedBy); Restrict = billing history + required
--    creators (AiUsage, Internship.college, Hackathon/Form/etc creator).
-- ═══════════════════════════════════════════════════════════════════
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Assignment_courseId_fkey') THEN ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Task_courseId_fkey') THEN ALTER TABLE "Task" ADD CONSTRAINT "Task_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssignmentHub_courseId_fkey') THEN ALTER TABLE "AssignmentHub" ADD CONSTRAINT "AssignmentHub_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ContestParticipation_contestId_fkey') THEN ALTER TABLE "ContestParticipation" ADD CONSTRAINT "ContestParticipation_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "CodingContest"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Resource_sourceMessageId_fkey') THEN ALTER TABLE "Resource" ADD CONSTRAINT "Resource_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "RoomMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RoomMessage_pinnedBy_fkey') THEN ALTER TABLE "RoomMessage" ADD CONSTRAINT "RoomMessage_pinnedBy_fkey" FOREIGN KEY ("pinnedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FormView_fieldId_fkey') THEN ALTER TABLE "FormView" ADD CONSTRAINT "FormView_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "FormField"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FormView_userId_fkey') THEN ALTER TABLE "FormView" ADD CONSTRAINT "FormView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AuditLog_actorId_fkey') THEN ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AuditLog_collegeId_fkey') THEN ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiUsage_collegeId_fkey') THEN ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiRouting_collegeId_fkey') THEN ALTER TABLE "AiRouting" ADD CONSTRAINT "AiRouting_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiProvider_collegeId_fkey') THEN ALTER TABLE "AiProvider" ADD CONSTRAINT "AiProvider_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiQuota_collegeId_fkey') THEN ALTER TABLE "AiQuota" ADD CONSTRAINT "AiQuota_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RevokedToken_userId_fkey') THEN ALTER TABLE "RevokedToken" ADD CONSTRAINT "RevokedToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SyncThrottle_userId_fkey') THEN ALTER TABLE "SyncThrottle" ADD CONSTRAINT "SyncThrottle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HackathonStagingDecision_decidedBy_fkey') THEN ALTER TABLE "HackathonStagingDecision" ADD CONSTRAINT "HackathonStagingDecision_decidedBy_fkey" FOREIGN KEY ("decidedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InternshipStagingDecision_decidedBy_fkey') THEN ALTER TABLE "InternshipStagingDecision" ADD CONSTRAINT "InternshipStagingDecision_decidedBy_fkey" FOREIGN KEY ("decidedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 4) Explicit onDelete for existing College-rooted (and adjacent) relations
--    that Prisma left as NoAction. Each block: DROP old (if any) → ADD with policy.
--    Policy recap: nullable college/department/room/course → SetNull (tenant delete
--    must not strand or block); required creators → Restrict (never cascade-delete
--    shared content when a user is removed); required Internship.college → Restrict
--    (billing-adjacent tenant root); AiRouting.provider → Cascade (owned routing).
-- ═══════════════════════════════════════════════════════════════════
-- User.college → SetNull
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_collegeId_fkey') THEN ALTER TABLE "User" DROP CONSTRAINT "User_collegeId_fkey"; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_collegeId_fkey') THEN ALTER TABLE "User" ADD CONSTRAINT "User_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
-- User.department → SetNull
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_departmentId_fkey') THEN ALTER TABLE "User" DROP CONSTRAINT "User_departmentId_fkey"; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_departmentId_fkey') THEN ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
-- Course.college → SetNull (teacher already SetNull via 20260908000000_fk_cascades)
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Course_collegeId_fkey') THEN ALTER TABLE "Course" DROP CONSTRAINT "Course_collegeId_fkey"; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Course_collegeId_fkey') THEN ALTER TABLE "Course" ADD CONSTRAINT "Course_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
-- Grade.course → SetNull (transcript rows survive course delete)
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Grade_courseId_fkey') THEN ALTER TABLE "Grade" DROP CONSTRAINT "Grade_courseId_fkey"; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Grade_courseId_fkey') THEN ALTER TABLE "Grade" ADD CONSTRAINT "Grade_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
-- Hackathon.creator → Restrict / Hackathon.college → SetNull
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Hackathon_creatorId_fkey') THEN ALTER TABLE "Hackathon" DROP CONSTRAINT "Hackathon_creatorId_fkey"; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Hackathon_creatorId_fkey') THEN ALTER TABLE "Hackathon" ADD CONSTRAINT "Hackathon_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Hackathon_collegeId_fkey') THEN ALTER TABLE "Hackathon" DROP CONSTRAINT "Hackathon_collegeId_fkey"; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Hackathon_collegeId_fkey') THEN ALTER TABLE "Hackathon" ADD CONSTRAINT "Hackathon_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
-- HackathonStaging.creator → Restrict / college → SetNull
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HackathonStaging_creatorId_fkey') THEN ALTER TABLE "HackathonStaging" DROP CONSTRAINT "HackathonStaging_creatorId_fkey"; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HackathonStaging_creatorId_fkey') THEN ALTER TABLE "HackathonStaging" ADD CONSTRAINT "HackathonStaging_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HackathonStaging_collegeId_fkey') THEN ALTER TABLE "HackathonStaging" DROP CONSTRAINT "HackathonStaging_collegeId_fkey"; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HackathonStaging_collegeId_fkey') THEN ALTER TABLE "HackathonStaging" ADD CONSTRAINT "HackathonStaging_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
-- InternshipStaging.creator → Restrict / college → SetNull
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InternshipStaging_creatorId_fkey') THEN ALTER TABLE "InternshipStaging" DROP CONSTRAINT "InternshipStaging_creatorId_fkey"; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InternshipStaging_creatorId_fkey') THEN ALTER TABLE "InternshipStaging" ADD CONSTRAINT "InternshipStaging_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InternshipStaging_collegeId_fkey') THEN ALTER TABLE "InternshipStaging" DROP CONSTRAINT "InternshipStaging_collegeId_fkey"; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InternshipStaging_collegeId_fkey') THEN ALTER TABLE "InternshipStaging" ADD CONSTRAINT "InternshipStaging_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
-- Form.creator → Restrict / college → SetNull
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Form_creatorId_fkey') THEN ALTER TABLE "Form" DROP CONSTRAINT "Form_creatorId_fkey"; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Form_creatorId_fkey') THEN ALTER TABLE "Form" ADD CONSTRAINT "Form_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Form_collegeId_fkey') THEN ALTER TABLE "Form" DROP CONSTRAINT "Form_collegeId_fkey"; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Form_collegeId_fkey') THEN ALTER TABLE "Form" ADD CONSTRAINT "Form_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
-- Announcement.creator → Restrict / college → SetNull
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Announcement_creatorId_fkey') THEN ALTER TABLE "Announcement" DROP CONSTRAINT "Announcement_creatorId_fkey"; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Announcement_creatorId_fkey') THEN ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Announcement_collegeId_fkey') THEN ALTER TABLE "Announcement" DROP CONSTRAINT "Announcement_collegeId_fkey"; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Announcement_collegeId_fkey') THEN ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
-- AssignmentHub.creator → Restrict / college+department+room → SetNull
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssignmentHub_creatorId_fkey') THEN ALTER TABLE "AssignmentHub" DROP CONSTRAINT "AssignmentHub_creatorId_fkey"; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssignmentHub_creatorId_fkey') THEN ALTER TABLE "AssignmentHub" ADD CONSTRAINT "AssignmentHub_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssignmentHub_collegeId_fkey') THEN ALTER TABLE "AssignmentHub" DROP CONSTRAINT "AssignmentHub_collegeId_fkey"; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssignmentHub_collegeId_fkey') THEN ALTER TABLE "AssignmentHub" ADD CONSTRAINT "AssignmentHub_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssignmentHub_departmentId_fkey') THEN ALTER TABLE "AssignmentHub" DROP CONSTRAINT "AssignmentHub_departmentId_fkey"; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssignmentHub_departmentId_fkey') THEN ALTER TABLE "AssignmentHub" ADD CONSTRAINT "AssignmentHub_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssignmentHub_roomId_fkey') THEN ALTER TABLE "AssignmentHub" DROP CONSTRAINT "AssignmentHub_roomId_fkey"; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssignmentHub_roomId_fkey') THEN ALTER TABLE "AssignmentHub" ADD CONSTRAINT "AssignmentHub_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
-- Room.teacher → Restrict / department → SetNull
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Room_teacherId_fkey') THEN ALTER TABLE "Room" DROP CONSTRAINT "Room_teacherId_fkey"; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Room_teacherId_fkey') THEN ALTER TABLE "Room" ADD CONSTRAINT "Room_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Room_departmentId_fkey') THEN ALTER TABLE "Room" DROP CONSTRAINT "Room_departmentId_fkey"; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Room_departmentId_fkey') THEN ALTER TABLE "Room" ADD CONSTRAINT "Room_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
-- Resource.uploader → Restrict (shared files must not vanish with a user)
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Resource_uploadedBy_fkey') THEN ALTER TABLE "Resource" DROP CONSTRAINT "Resource_uploadedBy_fkey"; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Resource_uploadedBy_fkey') THEN ALTER TABLE "Resource" ADD CONSTRAINT "Resource_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
-- CodingContest.creator → SetNull / college → SetNull
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CodingContest_creatorId_fkey') THEN ALTER TABLE "CodingContest" DROP CONSTRAINT "CodingContest_creatorId_fkey"; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CodingContest_creatorId_fkey') THEN ALTER TABLE "CodingContest" ADD CONSTRAINT "CodingContest_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CodingContest_collegeId_fkey') THEN ALTER TABLE "CodingContest" DROP CONSTRAINT "CodingContest_collegeId_fkey"; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CodingContest_collegeId_fkey') THEN ALTER TABLE "CodingContest" ADD CONSTRAINT "CodingContest_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
-- Internship.creator → Restrict / college (required) → Restrict
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Internship_creatorId_fkey') THEN ALTER TABLE "Internship" DROP CONSTRAINT "Internship_creatorId_fkey"; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Internship_creatorId_fkey') THEN ALTER TABLE "Internship" ADD CONSTRAINT "Internship_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Internship_collegeId_fkey') THEN ALTER TABLE "Internship" DROP CONSTRAINT "Internship_collegeId_fkey"; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Internship_collegeId_fkey') THEN ALTER TABLE "Internship" ADD CONSTRAINT "Internship_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
-- AiRouting.provider → Cascade (owned routing rows)
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiRouting_providerId_fkey') THEN ALTER TABLE "AiRouting" DROP CONSTRAINT "AiRouting_providerId_fkey"; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiRouting_providerId_fkey') THEN ALTER TABLE "AiRouting" ADD CONSTRAINT "AiRouting_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "AiProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;

-- AuditLog.entityId stays polymorphic by design (no FK): entityType+entityId can
-- reference HACKATHON/INTERNSHIP/FORM/USER/etc. Enforced at the app layer via
-- AuditActions + buildAuditMetadata; see services/auditLog.ts.
