-- Email case-insensitive backfill + lower() unique guard (LEGACY Demo@gmail.com fix).
-- Root cause: `User.email @unique` is a case-sensitive B-tree in Postgres, so
-- pre-SSOT mixed-case rows (`Demo@gmail.com`) are distinct keys from
-- `demo@gmail.com`. Normalized `findUnique where email=lowercased` missed them
-- → login 401 + duplicate accounts. Runtime is already bridged via
-- findUserByEmailInsensitive (findFirst mode:insensitive, SSOT normalizeEmail);
-- this migration makes the DATA match the new contract.
--
-- DEPLOY STATUS: FILE CREATED, NOT APPLIED LIVE. Deploy applies via
-- `prisma migrate deploy`. Do NOT run `prisma migrate dev` against prod.
-- Do NOT run against prod without backup + `prisma migrate status` check.
-- NEVER deploy here (task constraint: additive file only, no prod migrate).
--
-- Design (additive only, backward compat):
-- - No table/column drops, no renames, no type rewrites (no citext — avoids
--   extension + rewrite; lower() index is sufficient + Prisma cannot express
--   functional indexes so it lives here DB-only, like order2 partial uniques).
-- - Backfill BEFORE index: lowercase+trim all emails, quarantine collisions.
-- - Prisma schema.prisma UNCHANGED (`email @unique` stays exact B-tree);
--   the lower() UNIQUE is an extra DB-level guard. Runtime uses
--   mode:insensitive so BOTH guards agree post-backfill.
-- - Idempotent: every DDL is IF NOT EXISTS / DO $$ guarded — safe to re-run
--   via `prisma migrate deploy`.
-- - No secrets. No row deletes (only case-fold + suffixed quarantine).
--
-- Census BEFORE deploy (run on a replica / psql, read-only):
--   -- how many mixed-case / padded rows?
--   SELECT COUNT(*) FROM "User" WHERE "email" <> lower(btrim("email"));
--   SELECT COUNT(*) FROM "College" WHERE "adminEmail" IS NOT NULL AND "adminEmail" <> lower(btrim("adminEmail"));
--   -- collisions that would violate the lower() UNIQUE (must be 0 after §1 quarantine, >0 before)?
--   SELECT lower(btrim("email")) AS norm, COUNT(*), string_agg("id"::text, ', ') AS ids
--     FROM "User" GROUP BY 1 HAVING COUNT(*) > 1 ORDER BY 2 DESC;
--   -- preview which row survives per collision (oldest createdAt, tie smallest id):
--   SELECT lower(btrim("email")) AS norm, "id", "email", "createdAt",
--          ROW_NUMBER() OVER (PARTITION BY lower(btrim("email")) ORDER BY "createdAt" ASC, "id" ASC) AS rn
--     FROM "User" WHERE lower(btrim("email")) IN (
--       SELECT lower(btrim("email")) FROM "User" GROUP BY 1 HAVING COUNT(*) > 1)
--     ORDER BY norm, rn;
--   On large tables run the §2 UPDATE in batches outside this file:
--     UPDATE "User" SET "email" = lower(btrim("email"))
--       WHERE "id" IN (SELECT "id" FROM "User"
--         WHERE "email" <> lower(btrim("email")) LIMIT 1000);
--   then repeat until 0 rows, then run this migration.
--
-- Transactional note: this file runs in a transaction via `migrate deploy`
-- (safe at current scale). Past ~1M rows, run the equivalent OUTSIDE a
-- transaction instead: CREATE UNIQUE INDEX CONCURRENTLY ... (then
-- `prisma migrate resolve --applied 20260928000000_email_case_insensitive`).
-- Prisma `migrate deploy` cannot run CONCURRENTLY inside a transaction.
--
-- Rollback (additive, no data loss — passwordHash untouched):
--   DROP INDEX IF EXISTS "User_email_lower_unique";
--   DROP INDEX IF EXISTS "College_adminEmail_lower_idx";
--   -- Backfill is one-way (case-fold is cosmetic; original case NOT restored).
--   -- Duplicate quarantine renames (`+dup-<shortid>@`) are NOT auto-reverted —
--   -- review RAISE NOTICE logs + re-merge manually from backup. To fully revert
--   -- data, restore the pre-migration backup (point-in-time recovery).
--   -- Runtime stays safe without this migration (insensitive reads bridge
--   -- legacy rows), so rollback is index-drop only.

-- ═══════════════════════════════════════════════════════════════════
-- 1) Quarantine lower() collisions (non-destructive dedupe, must precede backfill+index)
--    Keeps oldest createdAt (tie: smallest id) on the canonical address;
--    renames losers to `local+dup-<shortid>@domain` (lowercase, unique,
--    traceable to the original id). Never deletes. RAISE NOTICE logs every row
--    for manual review (owner confirms which account keeps the address).
-- ═══════════════════════════════════════════════════════════════════
DO $$
DECLARE
  r RECORD;
  n INT := 0;
BEGIN
  FOR r IN
    SELECT "id", "email", lower(btrim("email")) AS norm,
           ROW_NUMBER() OVER (PARTITION BY lower(btrim("email")) ORDER BY "createdAt" ASC, "id" ASC) AS rn
      FROM "User"
  LOOP
    IF r.rn > 1 THEN
      UPDATE "User"
         SET "email" = regexp_replace(r.norm, '@', '+dup-' || substr(replace(r.id::text, '-', ''), 1, 8) || '@')
       WHERE "id" = r.id;
      n := n + 1;
      RAISE NOTICE 'email-case backfill: quarantined duplicate id=% email=% -> suffixed (manual review)', r.id, r.email;
    END IF;
  END LOOP;
  IF n > 0 THEN
    RAISE NOTICE 'email-case backfill: % duplicate(s) quarantined (see above)', n;
  ELSE
    RAISE NOTICE 'email-case backfill: no lower() collisions found';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 2) Backfill case-fold (trim + lowercase). Collisions already quarantined
--    in §1, so this cannot violate the §3 UNIQUE (fails closed otherwise).
-- ═══════════════════════════════════════════════════════════════════
UPDATE "User" SET "email" = lower(btrim("email")) WHERE "email" <> lower(btrim("email"));

UPDATE "College" SET "adminEmail" = lower(btrim("adminEmail"))
 WHERE "adminEmail" IS NOT NULL AND "adminEmail" <> lower(btrim("adminEmail"));

-- ═══════════════════════════════════════════════════════════════════
-- 3) Case-insensitive uniqueness + lookup guards (DB-only, Prisma-expressible
--    @unique on User.email stays as-is). IF NOT EXISTS = idempotent.
-- ═══════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_lower_unique" ON "User"(lower("email"));

CREATE INDEX IF NOT EXISTS "College_adminEmail_lower_idx" ON "College"(lower("adminEmail"));
