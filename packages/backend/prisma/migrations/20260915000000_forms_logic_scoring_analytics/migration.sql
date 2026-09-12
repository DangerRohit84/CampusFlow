-- #9 Forms logic-lite: Logic Jump + scoring + drop-off/time analytics (additive only).
-- Idempotent: safe to re-run via `prisma migrate deploy`.
-- Pattern: ADD COLUMN IF NOT EXISTS + CREATE TABLE/INDEX IF NOT EXISTS.
-- No backfill needed (defaults cover old rows: logic/scoreMap "{}", score 0).

-- ---------------------------------------------------------------------------
-- FormField: conditional rules + per-option points (JSON strings, "{}" = none)
-- ---------------------------------------------------------------------------
ALTER TABLE "FormField" ADD COLUMN IF NOT EXISTS "logic" TEXT DEFAULT '{}';
ALTER TABLE "FormField" ADD COLUMN IF NOT EXISTS "scoreMap" TEXT DEFAULT '{}';

-- Normalize pre-existing NULLs (rows created before the default existed).
UPDATE "FormField" SET "logic" = '{}' WHERE "logic" IS NULL;
UPDATE "FormField" SET "scoreMap" = '{}' WHERE "scoreMap" IS NULL;

-- ---------------------------------------------------------------------------
-- FormResponse: server-computed score + time-to-complete
-- ---------------------------------------------------------------------------
ALTER TABLE "FormResponse" ADD COLUMN IF NOT EXISTS "score" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "FormResponse" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMPTZ;
ALTER TABLE "FormResponse" ADD COLUMN IF NOT EXISTS "durationMs" INTEGER;

-- ---------------------------------------------------------------------------
-- FormView: per-question view log for drop-off (views vs answers).
-- fieldId NULL = form opened; fieldId set = question became visible.
-- userId nullable (anonymous pre-auth views are ignored by analytics).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "FormView" (
  "id" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "fieldId" TEXT,
  "userId" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "FormView_pkey" PRIMARY KEY ("id")
);

-- Prisma onDelete:Cascade for formId (drop views when the form is deleted).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FormView_formId_fkey') THEN
    ALTER TABLE "FormView"
      ADD CONSTRAINT "FormView_formId_fkey"
      FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "FormView_formId_idx" ON "FormView"("formId");
CREATE INDEX IF NOT EXISTS "FormView_formId_fieldId_idx" ON "FormView"("formId", "fieldId");
CREATE INDEX IF NOT EXISTS "FormView_formId_createdAt_idx" ON "FormView"("formId", "createdAt");
