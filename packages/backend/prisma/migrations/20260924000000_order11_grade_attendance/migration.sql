-- Order 11 — Grade/Attendance payloads + 1–1 hygiene (V-15, V-16, V-31) → P6/P9.
--
-- Record-vs-cache fix (P6) + 4NF child rows (P9) + timestamp/index hygiene (P8):
--  V-15 GradeData.subjects blob duplicating normalized Grade → Grade is the
--       record (new calculator columns subject/subjectCode/source + updatedAt);
--       GradeData keeps scale + blob during dual-write transition.
--  V-16 AttendanceData.subjects blob hiding "below-X%" queries → new
--       AttendanceRecord(studentId, subject, date, status, present, total)
--       (superset of audit "(subject,present,total)" + task "(student,date,
--       status)"); aggregates via SUM(present)/SUM(total) GROUP BY subject.
--  V-31 1–1 hygiene → GradeData gains createdAt/updatedAt; AttendanceData
--       redundant @@index([studentId]) dropped (@unique already indexes);
--       Grade gains updatedAt.
--
-- DEPLOY STATUS: FILE CREATED, NOT APPLIED LIVE. Deploy applies via
-- `prisma migrate deploy` (uses DIRECT_URL). App code in this release is
-- additive: it writes BOTH blob + record rows (best-effort try/catch so old
-- DBs without these tables/columns keep working) and reads record rows with
-- blob fallback. Rolling deploys are safe in both directions (old code ignores
-- new tables/columns; new code degrades when tables/columns are absent).
-- Blob removal (contract phase) is a LATER order — do NOT drop blobs here.
-- The only DROP in this file is the redundant AttendanceData index (no data
-- loss; planner keeps the @unique index).
--
-- Documented order (P5 expand-backfill-contract, single file):
--  0) Census (commented SELECTs — run before deploy, log counts).
--  1) ADD COLUMN IF NOT EXISTS (Grade ×4, GradeData ×2) + CREATE TABLE IF
--     NOT EXISTS AttendanceRecord (additive only).
--  2) FK + UNIQUE via pg_constraint guards, NOT VALID → VALIDATE (P4).
--  3) Indexes CREATE INDEX IF NOT EXISTS (planner names match Prisma
--     conventions: Model_fields_key / Model_fields_idx, so a future
--     `prisma migrate dev` diff stays clean).
--  4) Backfills from blobs (lossless: NO row-count caps; only string-length
--     caps matching app helpers in src/utils/gradeAttendance.ts + gpa/status
--     derivation documented below). Re-runnable: per-student NOT EXISTS
--     guards + ON CONFLICT DO NOTHING on AttendanceRecord UNIQUE. Runs in-tx
--     at current scale; past ~1M parent rows, run §4 INSERTs in batches
--     outside this file (LIMIT 1000 pattern) + CREATE INDEX CONCURRENTLY
--     outside a tx, then `prisma migrate resolve --applied`. Prisma
--     `migrate deploy` runs in a transaction so CONCURRENTLY cannot live here.
--  5) Reconciliation census (commented SELECTs — row counts must match §0
--     distinct-key counts after deploy).
--
-- Requires PG16+ for pg_input_is_valid (Neon PG17 OK). gen_random_uuid() is
-- core since PG13. No secrets. Backfills only (no drops of data columns; no
-- billing/auth loss).
--
-- Grade gpa derivation (mirrors gradeToGpa() in src/utils/gradeAttendance.ts):
--  scale "10" (default): O=10 A+=9 A=8 A-=7 B+=6 B=5 B-=4 C+=3 C=2 C-=1 D=1 P=5 F=0 else 0
--  scale "4": O/A+/A=4 A-=3.7 B+=3.3 B=3 B-=2.7 C+=2.3 C=2 C-=1.7 D=1 P=2 F=0 else 0
-- Attendance status derivation: total=0 → PRESENT; else pct>=requiredPct → PRESENT else ABSENT.
--  Backfill date = CURRENT_DATE (synthetic — per-day history was never recorded;
--  future daily marks carry real dates; SUM(present)/SUM(total) stays correct).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 0) Census — run before deploy, log results.
-- ─────────────────────────────────────────────────────────────────────────────
-- Non-empty grade blobs (expect == CALCULATOR Grade parents after §4.1):
-- SELECT COUNT(*) FROM "GradeData" WHERE "subjects" IS NOT NULL AND btrim("subjects") NOT IN ('', '[]');
-- Distinct calculator subjects in blobs (expect == new CALCULATOR Grade rows after §4.1):
-- SELECT COUNT(*) FROM "GradeData" gd CROSS JOIN LATERAL jsonb_array_elements(gd."subjects"::jsonb) AS t(elem)
--   WHERE gd."subjects" IS NOT NULL AND pg_input_is_valid(gd."subjects", 'json')
--     AND jsonb_typeof(gd."subjects"::jsonb) = 'array';
-- Non-empty attendance blobs (expect == AttendanceRecord parents after §4.2):
-- SELECT COUNT(*) FROM "AttendanceData" WHERE "subjects" IS NOT NULL AND btrim("subjects") NOT IN ('', '[]');
-- Distinct attendance subjects in blobs (expect == AttendanceRecord rows after §4.2):
-- SELECT COUNT(*) FROM "AttendanceData" ad CROSS JOIN LATERAL jsonb_array_elements(ad."subjects"::jsonb) AS t(elem)
--   WHERE ad."subjects" IS NOT NULL AND pg_input_is_valid(ad."subjects", 'json')
--     AND jsonb_typeof(ad."subjects"::jsonb) = 'array';
-- GradeData rows missing timestamps (expect == GradeData count before §1; 0 after):
-- SELECT COUNT(*) FROM "GradeData";
-- Students already having record rows (expect 0 before §4; re-run must not duplicate):
-- SELECT COUNT(DISTINCT "userId") FROM "Grade" WHERE "source" = 'CALCULATOR';
-- SELECT COUNT(DISTINCT "studentId") FROM "AttendanceRecord";

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) ADD COLUMNs + CREATE TABLE (IF NOT EXISTS — re-runnable, additive only)
-- ─────────────────────────────────────────────────────────────────────────────
-- 1a) Enum for record status (guarded — re-runnable).
DO $$ BEGIN
  CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'EXCUSED', 'LATE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 1b) GradeData timestamps (V-31). Existing rows backfill to statement time via DEFAULT.
ALTER TABLE "GradeData" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "GradeData" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 1b) Grade calculator + hygiene columns (V-15/V-31). Existing institutional rows
-- get source='MANUAL' (correct — they are transcript rows, never calculator).
ALTER TABLE "Grade" ADD COLUMN IF NOT EXISTS "subject" TEXT;
ALTER TABLE "Grade" ADD COLUMN IF NOT EXISTS "subjectCode" TEXT;
ALTER TABLE "Grade" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "Grade" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS "AttendanceRecord" (
  "id" "TEXT" NOT NULL,
  "studentId" "TEXT" NOT NULL,
  "subject" "TEXT" NOT NULL,
  "date" DATE NOT NULL DEFAULT CURRENT_DATE,
  "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
  "present" INTEGER NOT NULL DEFAULT 0,
  "total" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) UNIQUEs + FKs (guards + NOT VALID → VALIDATE, zero-lock add per P4)
-- ─────────────────────────────────────────────────────────────────────────────
-- 2a) Idempotency UNIQUE (dual-write + backfill key: one aggregate row per student/subject).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AttendanceRecord_studentId_subject_key') THEN
    ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_studentId_subject_key" UNIQUE ("studentId", "subject") NOT VALID;
  END IF;
END $$;
ALTER TABLE "AttendanceRecord" VALIDATE CONSTRAINT "AttendanceRecord_studentId_subject_key";

-- 2b) FKs (owned rows → Cascade).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AttendanceRecord_studentId_fkey') THEN
    ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_studentId_fkey"
      FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE "AttendanceRecord" VALIDATE CONSTRAINT "AttendanceRecord_studentId_fkey";

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Indexes (IF NOT EXISTS; FK cover + calculator + below-X% analytics paths)
-- ─────────────────────────────────────────────────────────────────────────────
-- Grade calculator scope + subject lookups (replace-all sync + row-vs-blob reconciliation).
CREATE INDEX IF NOT EXISTS "Grade_userId_source_idx" ON "Grade"("userId", "source");
CREATE INDEX IF NOT EXISTS "Grade_userId_subject_idx" ON "Grade"("userId", "subject");
-- AttendanceRecord: FK cover + per-subject aggregates + per-date event path.
CREATE INDEX IF NOT EXISTS "AttendanceRecord_studentId_idx" ON "AttendanceRecord"("studentId");
CREATE INDEX IF NOT EXISTS "AttendanceRecord_studentId_subject_idx" ON "AttendanceRecord"("studentId", "subject");
CREATE INDEX IF NOT EXISTS "AttendanceRecord_studentId_date_idx" ON "AttendanceRecord"("studentId", "date");
-- "Students below X% in subject Y": WHERE "subject"=$1 GROUP BY "studentId" HAVING SUM(present)*100.0/SUM(total) < $2.
CREATE INDEX IF NOT EXISTS "AttendanceRecord_subject_idx" ON "AttendanceRecord"("subject");

-- 3b) V-31 redundant index drop (data-safe: @unique index remains).
-- NOTE: plain DROP (not CONCURRENTLY) — Prisma `migrate deploy` runs in a
-- transaction and CONCURRENTLY cannot live here. Table is tiny (one row per
-- student); lock cost negligible. Past ~1M rows, run
-- `DROP INDEX CONCURRENTLY IF EXISTS "AttendanceData_studentId_idx";` outside
-- a tx, then `prisma migrate resolve --applied`.
DROP INDEX IF EXISTS "AttendanceData_studentId_idx";

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Backfills from blobs (lossless, re-runnable; invalid JSON skipped)
-- ─────────────────────────────────────────────────────────────────────────────
-- 4.1) GradeData.subjects [{name, code, credits, grade}] → Grade rows
-- (source=CALCULATOR, semester=0 bucket, courseId NULL). Per-student NOT EXISTS
-- guard (no UNIQUE on Grade for calculator rows — replace-all sync in app uses
-- deleteMany+createMany scoped to source=CALCULATOR, so backfill must not
-- duplicate on re-run). Invalid JSON / empty names skipped (see §0 census).
INSERT INTO "Grade" ("id", "userId", "courseId", "subject", "subjectCode", "source", "semester", "credits", "grade", "gpa", "createdAt", "updatedAt")
SELECT gen_random_uuid(), src."studentId", NULL, src."subject", src."subjectCode", 'CALCULATOR', 0, src."credits", src."grade", src."gpa", NOW(), NOW()
FROM (
  SELECT gd."studentId" AS "studentId",
    left(NULLIF(btrim(COALESCE(elem->>'name', '')), ''), 200) AS "subject",
    left(NULLIF(btrim(COALESCE(elem->>'code', '')), ''), 50) AS "subjectCode",
    LEAST(10, GREATEST(0,
      CASE WHEN (elem->>'credits') ~ '^-?[0-9]+(\.[0-9]+)?$'
        THEN FLOOR((elem->>'credits')::numeric)::int ELSE 3 END)) AS "credits",
    left(NULLIF(btrim(COALESCE(elem->>'grade', '')), ''), 10) AS "grade_raw",
    COALESCE(NULLIF(btrim(COALESCE(elem->>'grade', '')), ''), 'F') AS "grade",
    CASE
      WHEN COALESCE(gd."scale", '10') = '4' THEN
        CASE UPPER(btrim(COALESCE(elem->>'grade', 'F')))
          WHEN 'O' THEN 4.0 WHEN 'A+' THEN 4.0 WHEN 'A' THEN 4.0 WHEN 'A-' THEN 3.7
          WHEN 'B+' THEN 3.3 WHEN 'B' THEN 3.0 WHEN 'B-' THEN 2.7
          WHEN 'C+' THEN 2.3 WHEN 'C' THEN 2.0 WHEN 'C-' THEN 1.7
          WHEN 'D' THEN 1.0 WHEN 'P' THEN 2.0 WHEN 'F' THEN 0.0 ELSE 0.0 END
      ELSE
        CASE UPPER(btrim(COALESCE(elem->>'grade', 'F')))
          WHEN 'O' THEN 10.0 WHEN 'A+' THEN 9.0 WHEN 'A' THEN 8.0 WHEN 'A-' THEN 7.0
          WHEN 'B+' THEN 6.0 WHEN 'B' THEN 5.0 WHEN 'B-' THEN 4.0
          WHEN 'C+' THEN 3.0 WHEN 'C' THEN 2.0 WHEN 'C-' THEN 1.0
          WHEN 'D' THEN 1.0 WHEN 'P' THEN 5.0 WHEN 'F' THEN 0.0 ELSE 0.0 END
    END AS "gpa"
  FROM "GradeData" gd
  CROSS JOIN LATERAL jsonb_array_elements(gd."subjects"::jsonb) AS t(elem)
  WHERE gd."subjects" IS NOT NULL AND btrim(gd."subjects") NOT IN ('', '[]')
    AND pg_input_is_valid(gd."subjects", 'json')
    AND jsonb_typeof(gd."subjects"::jsonb) = 'array'
    AND NOT EXISTS (SELECT 1 FROM "Grade" g WHERE g."userId" = gd."studentId" AND g."source" = 'CALCULATOR')
) AS src
WHERE src."subject" IS NOT NULL AND src."subject" <> '';

-- 4.2) AttendanceData.subjects [{name, held, attended}] → AttendanceRecord rows
-- (one per subject; date=CURRENT_DATE synthetic; status derived vs requiredPct).
-- ON CONFLICT (studentId, subject) DO NOTHING + per-student NOT EXISTS = idempotent.
INSERT INTO "AttendanceRecord" ("id", "studentId", "subject", "date", "status", "present", "total", "createdAt", "updatedAt")
SELECT gen_random_uuid(), src."studentId", src."subject", CURRENT_DATE, src."status", src."present", src."total", NOW(), NOW()
FROM (
  SELECT ad."studentId" AS "studentId",
    left(NULLIF(btrim(COALESCE(elem->>'name', '')), ''), 200) AS "subject",
    LEAST(10000, GREATEST(0,
      CASE WHEN (elem->>'attended') ~ '^-?[0-9]+(\.[0-9]+)?$'
        THEN FLOOR((elem->>'attended')::numeric)::int ELSE 0 END)) AS "present",
    LEAST(10000, GREATEST(0,
      CASE WHEN (elem->>'held') ~ '^-?[0-9]+(\.[0-9]+)?$'
        THEN FLOOR((elem->>'held')::numeric)::int ELSE 0 END)) AS "total",
    CASE
      WHEN LEAST(10000, GREATEST(0,
        CASE WHEN (elem->>'held') ~ '^-?[0-9]+(\.[0-9]+)?$'
          THEN FLOOR((elem->>'held')::numeric)::int ELSE 0 END)) = 0 THEN 'PRESENT'::"AttendanceStatus"
      WHEN (LEAST(10000, GREATEST(0,
        CASE WHEN (elem->>'attended') ~ '^-?[0-9]+(\.[0-9]+)?$'
          THEN FLOOR((elem->>'attended')::numeric)::int ELSE 0 END))::float /
        NULLIF(LEAST(10000, GREATEST(0,
        CASE WHEN (elem->>'held') ~ '^-?[0-9]+(\.[0-9]+)?$'
          THEN FLOOR((elem->>'held')::numeric)::int ELSE 0 END)), 0)::float * 100.0)
        >= COALESCE(ad."requiredPct", 75) THEN 'PRESENT'::"AttendanceStatus"
      ELSE 'ABSENT'::"AttendanceStatus"
    END AS "status"
  FROM "AttendanceData" ad
  CROSS JOIN LATERAL jsonb_array_elements(ad."subjects"::jsonb) AS t(elem)
  WHERE ad."subjects" IS NOT NULL AND btrim(ad."subjects") NOT IN ('', '[]')
    AND pg_input_is_valid(ad."subjects", 'json')
    AND jsonb_typeof(ad."subjects"::jsonb) = 'array'
    AND NOT EXISTS (SELECT 1 FROM "AttendanceRecord" r WHERE r."studentId" = ad."studentId")
) AS src
WHERE src."subject" IS NOT NULL AND src."subject" <> ''
ON CONFLICT ("studentId", "subject") DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Reconciliation census — run after deploy; every pair must agree.
-- ─────────────────────────────────────────────────────────────────────────────
-- Grade calculator parents covered (blob non-empty but zero CALCULATOR rows = quarantined):
-- SELECT COUNT(*) FROM "GradeData" gd
--   WHERE gd."subjects" IS NOT NULL AND btrim(gd."subjects") NOT IN ('', '[]')
--     AND NOT EXISTS (SELECT 1 FROM "Grade" g WHERE g."userId" = gd."studentId" AND g."source" = 'CALCULATOR');
-- Grade row count vs blob subject count (spot-check per student):
-- SELECT gd."studentId",
--   (SELECT COUNT(*) FROM "Grade" g WHERE g."userId" = gd."studentId" AND g."source" = 'CALCULATOR') AS record_n
--   FROM "GradeData" gd WHERE gd."subjects" IS NOT NULL AND btrim(gd."subjects") NOT IN ('', '[]') LIMIT 20;
-- Below-75% now SQL-queryable (the point of V-16) — per-student pct per subject:
-- SELECT "studentId", "subject", SUM("present") AS present, SUM("total") AS total,
--   CASE WHEN SUM("total") = 0 THEN 100.0 ELSE SUM("present")::float / SUM("total") * 100.0 END AS pct
--   FROM "AttendanceRecord" GROUP BY "studentId", "subject" ORDER BY pct ASC LIMIT 20;
-- Students below threshold in ANY subject (join threshold from AttendanceData):
-- SELECT r."studentId", r."subject",
--   SUM(r."present")::float / NULLIF(SUM(r."total"), 0) * 100.0 AS pct, ad."requiredPct"
--   FROM "AttendanceRecord" r JOIN "AttendanceData" ad ON ad."studentId" = r."studentId"
--   GROUP BY r."studentId", r."subject", ad."requiredPct"
--   HAVING SUM(r."total") > 0 AND SUM(r."present")::float / SUM(r."total") * 100.0 < ad."requiredPct";
-- Attendance parents covered:
-- SELECT COUNT(*) FROM "AttendanceData" ad
--   WHERE ad."subjects" IS NOT NULL AND btrim(ad."subjects") NOT IN ('', '[]')
--     AND NOT EXISTS (SELECT 1 FROM "AttendanceRecord" r WHERE r."studentId" = ad."studentId");
-- Redundant index gone (expect 0 rows):
-- SELECT indexname FROM pg_indexes WHERE tablename = 'AttendanceData' AND indexname = 'AttendanceData_studentId_idx';
