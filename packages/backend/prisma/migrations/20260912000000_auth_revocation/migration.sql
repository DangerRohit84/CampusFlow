-- Auth revocation persistence (P0 hardening).
-- Creates RevokedToken + LoginAttempt tables declared in schema.prisma but
-- never shipped in a migration (live DB 2026-09-09 threw
-- "table public.RevokedToken does not exist" on login/socket revoke paths).
-- Idempotent: safe to re-run via `prisma migrate deploy` (IF NOT EXISTS).
-- Pattern follows 20260910000000_sync_upgrades / 20260911000000_fix_db_indexes.

-- RevokedToken: jti revocation list (logout / password-change / refresh rotate).
CREATE TABLE IF NOT EXISTS "RevokedToken" (
  "id" TEXT NOT NULL,
  "jti" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RevokedToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RevokedToken_jti_key" ON "RevokedToken"("jti");
CREATE INDEX IF NOT EXISTS "RevokedToken_userId_idx" ON "RevokedToken"("userId");
CREATE INDEX IF NOT EXISTS "RevokedToken_expiresAt_idx" ON "RevokedToken"("expiresAt");

-- LoginAttempt: per-email login audit (lockout forensics, future rate-limit source).
CREATE TABLE IF NOT EXISTS "LoginAttempt" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "ip" TEXT,
  "success" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LoginAttempt_email_createdAt_idx" ON "LoginAttempt"("email", "createdAt");
