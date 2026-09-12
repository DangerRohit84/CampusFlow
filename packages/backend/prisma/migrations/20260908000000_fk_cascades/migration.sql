-- FK cascades (backend stability P0): InternshipRegistration Cascade + Course.teacher SetNull
-- Idempotent: safe to re-run via `prisma migrate deploy`.

-- 1) InternshipRegistration.internshipId → Cascade (was RESTRICT/NO ACTION → orphans on Internship delete)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InternshipRegistration_internshipId_fkey') THEN
    ALTER TABLE "InternshipRegistration" DROP CONSTRAINT "InternshipRegistration_internshipId_fkey";
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InternshipRegistration_internshipId_fkey') THEN
    ALTER TABLE "InternshipRegistration" ADD CONSTRAINT "InternshipRegistration_internshipId_fkey" FOREIGN KEY ("internshipId") REFERENCES "Internship"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 2) InternshipRegistration.userId → Cascade (parity with HackathonRegistration)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InternshipRegistration_userId_fkey') THEN
    ALTER TABLE "InternshipRegistration" DROP CONSTRAINT "InternshipRegistration_userId_fkey";
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InternshipRegistration_userId_fkey') THEN
    ALTER TABLE "InternshipRegistration" ADD CONSTRAINT "InternshipRegistration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 3) Course.teacherId → SetNull (teacher delete must not orphan-fail nor wipe courses).
-- First allow NULL (required → optional).
ALTER TABLE "Course" ALTER COLUMN "teacherId" DROP NOT NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Course_teacherId_fkey') THEN
    ALTER TABLE "Course" DROP CONSTRAINT "Course_teacherId_fkey";
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Course_teacherId_fkey') THEN
    ALTER TABLE "Course" ADD CONSTRAINT "Course_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
