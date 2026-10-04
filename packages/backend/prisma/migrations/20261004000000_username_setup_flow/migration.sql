-- Username setup flow (2026-10-04, additive, production-careful).
-- Adds provisional-vs-chosen tracking + max-3 change budget to "User".
-- * IF NOT EXISTS: safe to re-run / rolling deploys (no rewrite, no lockout).
-- * ADD COLUMN ... NOT NULL DEFAULT backfills existing rows to false+0:
--   every pre-existing username (incl. name-derived auto-sets) becomes
--   provisional (usernameSetByUser=false) with a full 3-change budget, so
--   each user gets prompted to set/keep on next login (never locked out).
-- * No index changes (existing User_username_key + User_username_idx cover
--   exact-after-sanitize lookups; stored values are lowercased so exact ==
--   case-insensitive). No backfill UPDATE needed beyond the DEFAULT fill,
--   but the explicit UPDATE below pins the invariant for rows written
--   concurrently with the DDL on older Postgres.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "usernameSetByUser" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "usernameChangeCount" INTEGER NOT NULL DEFAULT 0;

-- Pin invariant for any rows that slipped through with NULL (concurrent
-- writes on PG versions without transactional DDL defaults). No-op otherwise.
UPDATE "User" SET "usernameSetByUser" = false WHERE "usernameSetByUser" IS NULL;
UPDATE "User" SET "usernameChangeCount" = 0 WHERE "usernameChangeCount" IS NULL;
