-- Order 10 — EAV/blob → 4NF child tables (V-13-full, V-14, V-18, V-17) → P9.
--
-- New tables (all ADDITIVE — no DROP/ALTER on existing columns; every legacy
-- blob stays writable during the dual-write transition):
--  "FormFieldOption"    (V-13-full) one row per selectable option
--  "FormAnswer"         (V-14)      one row per answer (worst analytics blocker)
--  "HackathonTeamMember"(V-18)      one row per team member (CSV → rows)
--  "AssignmentAttachment"(V-17)     one row per hub attachment (mirrors Resource)
--
-- DEPLOY STATUS: FILE CREATED, NOT APPLIED LIVE. Deploy applies via
-- `prisma migrate deploy` (uses DIRECT_URL). App code in this release is
-- additive: it writes BOTH blob + child rows (best-effort try/catch so old
-- DBs without these tables keep working) and reads child rows with blob
-- fallback. Rolling deploys are safe in both directions (old code ignores
-- new tables; new code degrades when tables are absent).
-- Blob removal (contract phase) is a LATER order — do NOT drop blobs here.
--
-- Documented order (P5 expand-backfill-contract, single file):
--  0) Census (commented SELECTs — run before deploy, log counts).
--  1) CREATE TABLE IF NOT EXISTS ×4 (+ PKs inline).
--  2) FKs + UNIQUEs via pg_constraint guards, NOT VALID → VALIDATE (P4).
--  3) Indexes CREATE INDEX IF NOT EXISTS (planner names match Prisma
--     conventions: Model_fields_key / Model_fields_idx, so a future
--     `prisma migrate dev` diff stays clean).
--  4) Backfills from blobs (lossless: NO row-count caps; only string-length
--     caps matching app helpers in src/utils/childTables.ts). Re-runnable:
--     per-parent NOT EXISTS guards + ON CONFLICT DO NOTHING on the two
--     UNIQUEs. Runs in-tx at current scale; past ~1M parent rows, run §4
--     UPDATEs/INSERTs in batches outside this file (LIMIT 1000 pattern) +
--     CREATE INDEX CONCURRENTLY outside a tx, then
--     `prisma migrate resolve --applied`. Prisma `migrate deploy` runs in a
--     transaction so CONCURRENTLY cannot live here.
--  5) Reconciliation census (commented SELECTs — row counts must match §0
--     distinct-key counts after deploy).
--
-- Requires PG16+ for pg_input_is_valid (Neon PG17 OK). gen_random_uuid() is
-- core since PG13. No secrets. Backfills only (no drops; no billing/auth
-- loss). Checkbox answers join tokens with ", " (same as app
-- answerToStoredValue); per-token distribution queries use
-- string_to_array("value", ', ') — see §5.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 0) Census — run before deploy, log results.
-- ─────────────────────────────────────────────────────────────────────────────
-- Distinct option values per field (expect == FormFieldOption rows after §4.1):
-- SELECT COUNT(*) FROM "FormField" WHERE "options" IS NOT NULL AND btrim("options") NOT IN ('', '[]');
-- Answer cells (expect == FormAnswer rows after §4.2, minus orphan-field keys):
-- SELECT COUNT(*) FROM "FormResponse" WHERE "answers" IS NOT NULL AND btrim("answers") NOT IN ('', '{}');
-- Orphan answer keys (joined-out of backfill; non-zero = deleted fields, expected):
-- SELECT COUNT(*) FROM "FormResponse" r CROSS JOIN LATERAL jsonb_each(r."answers"::jsonb) kv
--   LEFT JOIN "FormField" ff ON ff."id" = kv."key" AND ff."formId" = r."formId"
--   WHERE r."answers" IS NOT NULL AND pg_input_is_valid(r."answers", 'json')
--     AND jsonb_typeof(r."answers"::jsonb) = 'object' AND ff."id" IS NULL;
-- Non-empty team blobs (expect >= HackathonTeamMember parents after §4.3):
-- SELECT COUNT(*) FROM "HackathonRegistration" WHERE "teamMembers" IS NOT NULL AND btrim("teamMembers") <> '';
-- Non-empty attachment blobs (expect >= AssignmentAttachment parents after §4.4):
-- SELECT COUNT(*) FROM "AssignmentHub" WHERE "attachments" IS NOT NULL AND btrim("attachments") NOT IN ('', '[]');

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) CREATE TABLEs (IF NOT EXISTS — re-runnable, additive only)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "FormFieldOption" (
  "id" "TEXT" NOT NULL,
  "fieldId" "TEXT" NOT NULL,
  "value" "TEXT" NOT NULL,
  "label" "TEXT" NOT NULL,
  "points" INTEGER NOT NULL DEFAULT 0,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FormFieldOption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FormAnswer" (
  "id" "TEXT" NOT NULL,
  "responseId" "TEXT" NOT NULL,
  "fieldId" "TEXT" NOT NULL,
  "value" "TEXT" NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FormAnswer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "HackathonTeamMember" (
  "id" "TEXT" NOT NULL,
  "registrationId" "TEXT" NOT NULL,
  "userId" "TEXT",
  "name" "TEXT" NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HackathonTeamMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AssignmentAttachment" (
  "id" "TEXT" NOT NULL,
  "assignmentId" "TEXT" NOT NULL,
  "url" "TEXT" NOT NULL,
  "fileName" "TEXT",
  "fileType" "TEXT",
  "fileSize" INTEGER,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssignmentAttachment_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) UNIQUEs + FKs (guards + NOT VALID → VALIDATE, zero-lock add per P4)
-- ─────────────────────────────────────────────────────────────────────────────
-- 2a) Idempotency UNIQUEs (dual-write + backfill keys).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FormFieldOption_fieldId_value_key') THEN
    ALTER TABLE "FormFieldOption" ADD CONSTRAINT "FormFieldOption_fieldId_value_key" UNIQUE ("fieldId", "value") NOT VALID;
  END IF;
END $$;
ALTER TABLE "FormFieldOption" VALIDATE CONSTRAINT "FormFieldOption_fieldId_value_key";

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FormAnswer_responseId_fieldId_key') THEN
    ALTER TABLE "FormAnswer" ADD CONSTRAINT "FormAnswer_responseId_fieldId_key" UNIQUE ("responseId", "fieldId") NOT VALID;
  END IF;
END $$;
ALTER TABLE "FormAnswer" VALIDATE CONSTRAINT "FormAnswer_responseId_fieldId_key";

-- 2b) FKs (owned rows → Cascade; user link → SetNull, audit-safe).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FormFieldOption_fieldId_fkey') THEN
    ALTER TABLE "FormFieldOption" ADD CONSTRAINT "FormFieldOption_fieldId_fkey"
      FOREIGN KEY ("fieldId") REFERENCES "FormField"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE "FormFieldOption" VALIDATE CONSTRAINT "FormFieldOption_fieldId_fkey";

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FormAnswer_responseId_fkey') THEN
    ALTER TABLE "FormAnswer" ADD CONSTRAINT "FormAnswer_responseId_fkey"
      FOREIGN KEY ("responseId") REFERENCES "FormResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE "FormAnswer" VALIDATE CONSTRAINT "FormAnswer_responseId_fkey";

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FormAnswer_fieldId_fkey') THEN
    ALTER TABLE "FormAnswer" ADD CONSTRAINT "FormAnswer_fieldId_fkey"
      FOREIGN KEY ("fieldId") REFERENCES "FormField"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE "FormAnswer" VALIDATE CONSTRAINT "FormAnswer_fieldId_fkey";

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HackathonTeamMember_registrationId_fkey') THEN
    ALTER TABLE "HackathonTeamMember" ADD CONSTRAINT "HackathonTeamMember_registrationId_fkey"
      FOREIGN KEY ("registrationId") REFERENCES "HackathonRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE "HackathonTeamMember" VALIDATE CONSTRAINT "HackathonTeamMember_registrationId_fkey";

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HackathonTeamMember_userId_fkey') THEN
    ALTER TABLE "HackathonTeamMember" ADD CONSTRAINT "HackathonTeamMember_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE "HackathonTeamMember" VALIDATE CONSTRAINT "HackathonTeamMember_userId_fkey";

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssignmentAttachment_assignmentId_fkey') THEN
    ALTER TABLE "AssignmentAttachment" ADD CONSTRAINT "AssignmentAttachment_assignmentId_fkey"
      FOREIGN KEY ("assignmentId") REFERENCES "AssignmentHub"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE "AssignmentAttachment" VALIDATE CONSTRAINT "AssignmentAttachment_assignmentId_fkey";

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Indexes (IF NOT EXISTS; FK cover + analytics paths)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "FormFieldOption_fieldId_idx" ON "FormFieldOption"("fieldId");
CREATE INDEX IF NOT EXISTS "FormFieldOption_fieldId_order_idx" ON "FormFieldOption"("fieldId", "order");
CREATE INDEX IF NOT EXISTS "FormAnswer_responseId_idx" ON "FormAnswer"("responseId");
CREATE INDEX IF NOT EXISTS "FormAnswer_fieldId_idx" ON "FormAnswer"("fieldId");
-- "Distribution of Q3": WHERE "fieldId" = $1 GROUP BY "value".
CREATE INDEX IF NOT EXISTS "FormAnswer_fieldId_value_idx" ON "FormAnswer"("fieldId", "value");
CREATE INDEX IF NOT EXISTS "HackathonTeamMember_registrationId_idx" ON "HackathonTeamMember"("registrationId");
-- "All teams containing user X".
CREATE INDEX IF NOT EXISTS "HackathonTeamMember_userId_idx" ON "HackathonTeamMember"("userId");
CREATE INDEX IF NOT EXISTS "AssignmentAttachment_assignmentId_idx" ON "AssignmentAttachment"("assignmentId");
CREATE INDEX IF NOT EXISTS "AssignmentAttachment_assignmentId_order_idx" ON "AssignmentAttachment"("assignmentId", "order");

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Backfills from blobs (lossless, re-runnable; invalid JSON skipped)
-- ─────────────────────────────────────────────────────────────────────────────
-- 4.1) FormField.options (string[] | {label,value,text,points,score}[]) → rows.
-- Dedupes per (fieldId, value) via ON CONFLICT (keeps first ordinality).
INSERT INTO "FormFieldOption" ("id", "fieldId", "value", "label", "points", "order", "createdAt")
SELECT gen_random_uuid(), src."fieldId", src."value", src."label", src."points", src."ord", NOW()
FROM (
  SELECT f."id" AS "fieldId",
    CASE WHEN jsonb_typeof(elem) = 'string' THEN left(elem #>> '{}', 200)
         ELSE left(NULLIF(COALESCE(elem->>'value', elem->>'label', elem->>'text', ''), ''), 200) END AS "value",
    CASE WHEN jsonb_typeof(elem) = 'string' THEN left(elem #>> '{}', 200)
         ELSE left(NULLIF(COALESCE(elem->>'label', elem->>'value', elem->>'text', ''), ''), 200) END AS "label",
    CASE WHEN jsonb_typeof(elem) = 'object'
           AND COALESCE(elem->>'points', elem->>'score', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
         THEN LEAST(10000, GREATEST(-10000, FLOOR((COALESCE(elem->>'points', elem->>'score'))::numeric)::int))
         ELSE 0 END AS "points",
    (ord - 1) AS "ord"
  FROM "FormField" f
  CROSS JOIN LATERAL jsonb_array_elements(f."options"::jsonb) WITH ORDINALITY AS t(elem, ord)
  WHERE f."options" IS NOT NULL
    AND pg_input_is_valid(f."options", 'json')
    AND jsonb_typeof(f."options"::jsonb) = 'array'
    AND NOT EXISTS (SELECT 1 FROM "FormFieldOption" o WHERE o."fieldId" = f."id")
) AS src
WHERE src."value" IS NOT NULL AND src."value" <> ''
  AND src."label" IS NOT NULL AND src."label" <> ''
ON CONFLICT ("fieldId", "value") DO NOTHING;

-- 4.2) FormResponse.answers (JSON object fieldId → value) → rows.
-- INNER JOIN FormField keeps only live same-form keys (orphan keys from
-- deleted fields are skipped — see §0 orphan census). Checkbox arrays join
-- with ", " (same as app answerToStoredValue).
INSERT INTO "FormAnswer" ("id", "responseId", "fieldId", "value", "createdAt")
SELECT gen_random_uuid(), r."id", kv."key",
  left(CASE WHEN jsonb_typeof(kv."value") = 'string' THEN kv."value" #>> '{}'
            WHEN jsonb_typeof(kv."value") IN ('number', 'boolean') THEN kv."value"::text
            WHEN jsonb_typeof(kv."value") = 'array'
              THEN COALESCE((SELECT string_agg(
                      CASE WHEN jsonb_typeof(e) = 'string' THEN e #>> '{}' ELSE e::text END,
                      ', ' ORDER BY u."ord")
                    FROM jsonb_array_elements(kv."value") WITH ORDINALITY AS u(e, "ord")), '')
            ELSE kv."value"::text END, 5000),
  NOW()
FROM "FormResponse" r
CROSS JOIN LATERAL jsonb_each(r."answers"::jsonb) AS kv("key", "value")
JOIN "FormField" ff ON ff."id" = kv."key" AND ff."formId" = r."formId"
WHERE r."answers" IS NOT NULL
  AND pg_input_is_valid(r."answers", 'json')
  AND jsonb_typeof(r."answers"::jsonb) = 'object'
ON CONFLICT ("responseId", "fieldId") DO NOTHING;

-- 4.3a) HackathonRegistration.teamMembers JSON-array blobs → rows.
INSERT INTO "HackathonTeamMember" ("id", "registrationId", "userId", "name", "createdAt")
SELECT gen_random_uuid(), src."registrationId", NULL, src."name", NOW()
FROM (
  SELECT g."id" AS "registrationId",
    left(NULLIF(CASE WHEN jsonb_typeof(elem) = 'string' THEN elem #>> '{}'
                ELSE COALESCE(elem->>'name', elem->>'value', elem->>'text', elem->>'email', '') END, ''), 200) AS "name"
  FROM "HackathonRegistration" g
  CROSS JOIN LATERAL jsonb_array_elements(g."teamMembers"::jsonb) AS t(elem)
  WHERE g."teamMembers" IS NOT NULL AND btrim(g."teamMembers") <> ''
    AND pg_input_is_valid(g."teamMembers", 'json')
    AND jsonb_typeof(g."teamMembers"::jsonb) = 'array'
    AND NOT EXISTS (SELECT 1 FROM "HackathonTeamMember" m WHERE m."registrationId" = g."id")
) AS src
WHERE src."name" IS NOT NULL AND src."name" <> '';

-- 4.3b) teamMembers CSV / single-name strings → rows (non-JSON blobs only).
INSERT INTO "HackathonTeamMember" ("id", "registrationId", "userId", "name", "createdAt")
SELECT gen_random_uuid(), g."id", NULL, left(btrim(part), 200), NOW()
FROM "HackathonRegistration" g
CROSS JOIN LATERAL unnest(string_to_array(g."teamMembers", ',')) AS u(part)
WHERE g."teamMembers" IS NOT NULL AND btrim(g."teamMembers") <> ''
  AND NOT pg_input_is_valid(g."teamMembers", 'json')
  AND btrim(part) <> ''
  AND NOT EXISTS (SELECT 1 FROM "HackathonTeamMember" m WHERE m."registrationId" = g."id");

-- 4.3c) teamMembers valid-JSON scalars/objects (edge: '"John"' or '{"name":"John"}') → one row.
INSERT INTO "HackathonTeamMember" ("id", "registrationId", "userId", "name", "createdAt")
SELECT gen_random_uuid(), g."id", NULL,
  left(NULLIF(CASE WHEN jsonb_typeof(g."teamMembers"::jsonb) = 'string' THEN g."teamMembers"::jsonb #>> '{}'
              WHEN jsonb_typeof(g."teamMembers"::jsonb) = 'object'
                THEN COALESCE((g."teamMembers"::jsonb)->>'name', (g."teamMembers"::jsonb)->>'value', '')
              ELSE '' END, ''), 200),
  NOW()
FROM "HackathonRegistration" g
WHERE g."teamMembers" IS NOT NULL AND btrim(g."teamMembers") <> ''
  AND pg_input_is_valid(g."teamMembers", 'json')
  AND jsonb_typeof(g."teamMembers"::jsonb) IN ('string', 'object')
  AND NOT EXISTS (SELECT 1 FROM "HackathonTeamMember" m WHERE m."registrationId" = g."id")
  AND NULLIF(CASE WHEN jsonb_typeof(g."teamMembers"::jsonb) = 'string' THEN g."teamMembers"::jsonb #>> '{}'
             ELSE COALESCE((g."teamMembers"::jsonb)->>'name', (g."teamMembers"::jsonb)->>'value', '') END, '') IS NOT NULL;

-- 4.4) AssignmentHub.attachments (JSON array of URL strings | {url} objects) → rows.
INSERT INTO "AssignmentAttachment" ("id", "assignmentId", "url", "fileName", "fileType", "fileSize", "order", "createdAt")
SELECT gen_random_uuid(), src."assignmentId", src."url", NULL, NULL, NULL, src."ord", NOW()
FROM (
  SELECT h."id" AS "assignmentId",
    left(NULLIF(CASE WHEN jsonb_typeof(elem) = 'string' THEN elem #>> '{}'
                ELSE COALESCE(elem->>'url', '') END, ''), 2000) AS "url",
    (ord - 1) AS "ord"
  FROM "AssignmentHub" h
  CROSS JOIN LATERAL jsonb_array_elements(h."attachments"::jsonb) WITH ORDINALITY AS t(elem, ord)
  WHERE h."attachments" IS NOT NULL AND btrim(h."attachments") <> ''
    AND pg_input_is_valid(h."attachments", 'json')
    AND jsonb_typeof(h."attachments"::jsonb) = 'array'
    AND NOT EXISTS (SELECT 1 FROM "AssignmentAttachment" a WHERE a."assignmentId" = h."id")
) AS src
WHERE src."url" IS NOT NULL AND src."url" <> '';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Reconciliation census — run after deploy; every pair must agree.
-- ─────────────────────────────────────────────────────────────────────────────
-- Options: distinct (fieldId, value) in blobs vs child rows:
-- SELECT (SELECT COUNT(*) FROM "FormFieldOption") AS child_opts;
-- (compare vs §0 option-parent count × avg options; exact blob-side distinct
--  count needs the same CASE normalization — use per-field spot checks:)
-- SELECT f."id", (SELECT COUNT(*) FROM "FormFieldOption" o WHERE o."fieldId" = f."id") AS child_n
--   FROM "FormField" f WHERE f."options" IS NOT NULL AND btrim(f."options") NOT IN ('', '[]') LIMIT 20;
-- Answers: child rows vs live-key blob cells (orphan keys excluded by design):
-- SELECT (SELECT COUNT(*) FROM "FormAnswer") AS child_answers;
-- Per-option distribution (now SQL-queryable — the point of V-14):
-- SELECT "value" AS option, COUNT(*) AS n FROM "FormAnswer"
--   WHERE "fieldId" = '<FIELD_ID>' GROUP BY "value" ORDER BY n DESC;
-- Checkbox token distribution (multi-select — tokenize the joined string):
-- SELECT btrim(tok) AS token, COUNT(*) AS n FROM "FormAnswer",
--   LATERAL unnest(string_to_array("value", ',')) AS t(tok)
--   WHERE "fieldId" = '<CHECKBOX_FIELD_ID>' GROUP BY btrim(tok) ORDER BY n DESC;
-- Team parents covered (registrations with blob but zero rows = quarantined):
-- SELECT COUNT(*) FROM "HackathonRegistration" g
--   WHERE g."teamMembers" IS NOT NULL AND btrim(g."teamMembers") <> ''
--     AND NOT EXISTS (SELECT 1 FROM "HackathonTeamMember" m WHERE m."registrationId" = g."id");
-- Attachment parents covered:
-- SELECT COUNT(*) FROM "AssignmentHub" h
--   WHERE h."attachments" IS NOT NULL AND btrim(h."attachments") NOT IN ('', '[]')
--     AND NOT EXISTS (SELECT 1 FROM "AssignmentAttachment" a WHERE a."assignmentId" = h."id");
