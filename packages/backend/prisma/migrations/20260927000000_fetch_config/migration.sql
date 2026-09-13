-- Fetch master toggle: singleton FetchConfig table (autoFetchEnabled default true).
-- SUPER_ADMIN pauses ALL scheduled auto-fetch via FetchPage without redeploy;
-- manual POST /fetch/* ignores the flag. Deploy applies via `prisma migrate
-- deploy`; until applied, code defaults to ON + warn (see services/fetch/autoFetch.ts).

CREATE TABLE IF NOT EXISTS "fetch_config" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'global',
  "autoFetchEnabled" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "fetch_config" ("id", "autoFetchEnabled", "updatedAt")
VALUES ('global', true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
