-- AlterTable
ALTER TABLE "Internship" ADD COLUMN "source" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "departmentName" TEXT;

-- CreateTable
CREATE TABLE "HackathonStaging" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "creatorId" TEXT NOT NULL,
    "collegeId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT,
    "organizer" TEXT,
    "registrationUrl" TEXT,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "deadline" DATETIME,
    "teamSize" INTEGER,
    "themes" TEXT DEFAULT '[]',
    "location" TEXT,
    "mode" TEXT DEFAULT 'OFFLINE',
    "eligibility" TEXT DEFAULT '{}',
    "prizePool" TEXT,
    "duration" TEXT,
    "schedule" TEXT,
    "bootcamps" TEXT DEFAULT '[]',
    "highlights" TEXT DEFAULT '[]',
    "targetDepartments" TEXT DEFAULT '[]',
    "targetYears" TEXT DEFAULT '[]',
    "eligibilityEnabled" BOOLEAN NOT NULL DEFAULT false,
    "website" TEXT,
    "discord" TEXT,
    "participantsCount" INTEGER NOT NULL DEFAULT 0,
    "inviteOnly" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "source" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HackathonStaging_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "HackathonStaging_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InternshipStaging" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "creatorId" TEXT NOT NULL,
    "collegeId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "stipend" TEXT,
    "duration" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'REMOTE',
    "startDate" TEXT,
    "deadline" TEXT,
    "targetDepartments" TEXT NOT NULL DEFAULT '[]',
    "targetYears" TEXT NOT NULL DEFAULT '[]',
    "eligibilityEnabled" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InternshipStaging_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InternshipStaging_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttendanceRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AttendancePrediction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "totalClasses" INTEGER NOT NULL,
    "presentClasses" INTEGER NOT NULL,
    "classesPerWeek" INTEGER NOT NULL,
    "weeksRemaining" INTEGER NOT NULL,
    "targetPercentage" REAL NOT NULL DEFAULT 75,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttendancePrediction_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platform" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fetchLimit" INTEGER NOT NULL DEFAULT 0,
    "lastFetchAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AiProvider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'openai-compatible',
    "headers" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "collegeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AiRouting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "feature" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "fallbackOrder" INTEGER NOT NULL,
    "collegeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiRouting_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "AiProvider" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Hackathon" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "creatorId" TEXT NOT NULL,
    "collegeId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT,
    "organizer" TEXT,
    "registrationUrl" TEXT,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "deadline" DATETIME,
    "teamSize" INTEGER,
    "themes" TEXT DEFAULT '[]',
    "location" TEXT,
    "mode" TEXT DEFAULT 'OFFLINE',
    "eligibility" TEXT DEFAULT '{}',
    "prizePool" TEXT,
    "duration" TEXT,
    "schedule" TEXT,
    "bootcamps" TEXT DEFAULT '[]',
    "highlights" TEXT DEFAULT '[]',
    "targetDepartments" TEXT DEFAULT '[]',
    "targetYears" TEXT DEFAULT '[]',
    "eligibilityEnabled" BOOLEAN NOT NULL DEFAULT false,
    "website" TEXT,
    "discord" TEXT,
    "participantsCount" INTEGER NOT NULL DEFAULT 0,
    "inviteOnly" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "source" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Hackathon_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Hackathon_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Hackathon" ("bootcamps", "collegeId", "createdAt", "creatorId", "deadline", "description", "duration", "eligibility", "eligibilityEnabled", "endDate", "highlights", "id", "location", "mode", "organizer", "prizePool", "registrationUrl", "schedule", "startDate", "status", "targetDepartments", "targetYears", "teamSize", "themes", "title", "updatedAt", "url") SELECT "bootcamps", "collegeId", "createdAt", "creatorId", "deadline", "description", "duration", "eligibility", "eligibilityEnabled", "endDate", "highlights", "id", "location", "mode", "organizer", "prizePool", "registrationUrl", "schedule", "startDate", "status", "targetDepartments", "targetYears", "teamSize", "themes", "title", "updatedAt", "url" FROM "Hackathon";
DROP TABLE "Hackathon";
ALTER TABLE "new_Hackathon" RENAME TO "Hackathon";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AttendanceRecord_studentId_subject_idx" ON "AttendanceRecord"("studentId", "subject");

-- CreateIndex
CREATE INDEX "AttendanceRecord_studentId_createdAt_idx" ON "AttendanceRecord"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "AttendancePrediction_studentId_idx" ON "AttendancePrediction"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_settings_platform_type_key" ON "platform_settings"("platform", "type");

-- CreateIndex
CREATE UNIQUE INDEX "AiProvider_name_collegeId_key" ON "AiProvider"("name", "collegeId");

-- CreateIndex
CREATE UNIQUE INDEX "AiRouting_feature_fallbackOrder_collegeId_key" ON "AiRouting"("feature", "fallbackOrder", "collegeId");
