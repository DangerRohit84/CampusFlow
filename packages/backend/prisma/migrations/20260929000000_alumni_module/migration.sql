-- Alumni module (additive 20260929, PROD-SAFE).
-- New tables only: AlumniProfile (1-1 per User) + MentorshipRequest (ledger).
-- No ALTER/DROP/ENUM rewrite on existing tables. Status stays TEXT (open
-- domain, zod SSOT) — native enum is a LATER order if needed.
-- Deploy: release-time `prisma migrate deploy` with DIRECT_URL (Render
-- preDeployCommand). Pre-migration runtime stays green via
-- (prisma as any).alumniProfile? guards (SourceHealth pattern).
-- Local dev: `npx prisma migrate dev` (creates tables) — NEVER run
-- `migrate deploy` against prod Neon manually; Render release does it.

CREATE TABLE IF NOT EXISTS "AlumniProfile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL UNIQUE,
  "collegeId" TEXT,
  "graduationYear" INTEGER,
  "degree" VARCHAR(120),
  "department" VARCHAR(120),
  "company" VARCHAR(200),
  "roleTitle" VARCHAR(200),
  "location" VARCHAR(200),
  "bio" TEXT,
  "skills" JSONB NOT NULL DEFAULT '[]',
  "linkedinUrl" VARCHAR(500),
  "githubUrl" VARCHAR(500),
  "portfolioUrl" VARCHAR(500),
  "contactEmail" VARCHAR(320),
  "contactPhone" VARCHAR(40),
  "isVerified" BOOLEAN NOT NULL DEFAULT false,
  "verifiedBy" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "isAvailableForMentorship" BOOLEAN NOT NULL DEFAULT true,
  "totalRequests" INTEGER NOT NULL DEFAULT 0,
  "acceptedRequests" INTEGER NOT NULL DEFAULT 0,
  "respondedRequests" INTEGER NOT NULL DEFAULT 0,
  "avgResponseHours" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AlumniProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AlumniProfile_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "AlumniProfile_collegeId_isVerified_idx" ON "AlumniProfile"("collegeId", "isVerified");
CREATE INDEX IF NOT EXISTS "AlumniProfile_collegeId_isAvailableForMentorship_idx" ON "AlumniProfile"("collegeId", "isAvailableForMentorship");
CREATE INDEX IF NOT EXISTS "AlumniProfile_collegeId_graduationYear_idx" ON "AlumniProfile"("collegeId", "graduationYear");
CREATE INDEX IF NOT EXISTS "AlumniProfile_userId_idx" ON "AlumniProfile"("userId");
CREATE INDEX IF NOT EXISTS "AlumniProfile_collegeId_updatedAt_idx" ON "AlumniProfile"("collegeId", "updatedAt");

CREATE TABLE IF NOT EXISTS "MentorshipRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "requesterId" TEXT NOT NULL,
  "alumniUserId" TEXT NOT NULL,
  "alumniProfileId" TEXT,
  "collegeId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "message" TEXT,
  "topic" VARCHAR(200),
  "slaDueAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "respondedAt" TIMESTAMP(3),
  "chatSessionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MentorshipRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MentorshipRequest_alumniUserId_fkey" FOREIGN KEY ("alumniUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MentorshipRequest_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "MentorshipRequest_collegeId_status_idx" ON "MentorshipRequest"("collegeId", "status");
CREATE INDEX IF NOT EXISTS "MentorshipRequest_alumniUserId_status_idx" ON "MentorshipRequest"("alumniUserId", "status");
CREATE INDEX IF NOT EXISTS "MentorshipRequest_requesterId_createdAt_idx" ON "MentorshipRequest"("requesterId", "createdAt");
CREATE INDEX IF NOT EXISTS "MentorshipRequest_status_slaDueAt_idx" ON "MentorshipRequest"("status", "slaDueAt");
CREATE INDEX IF NOT EXISTS "MentorshipRequest_status_expiresAt_idx" ON "MentorshipRequest"("status", "expiresAt");
CREATE INDEX IF NOT EXISTS "MentorshipRequest_alumniProfileId_idx" ON "MentorshipRequest"("alumniProfileId");
