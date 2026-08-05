/*
  Warnings:

  - You are about to drop the column `department` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `semester` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `year` on the `User` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "collegeId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Department_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_College" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "logo" TEXT,
    "adminEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_College" ("address", "code", "createdAt", "id", "logo", "name", "updatedAt") SELECT "address", "code", "createdAt", "id", "logo", "name", "updatedAt" FROM "College";
DROP TABLE "College";
ALTER TABLE "new_College" RENAME TO "College";
CREATE UNIQUE INDEX "College_name_key" ON "College"("name");
CREATE UNIQUE INDEX "College_code_key" ON "College"("code");
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
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Hackathon_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Hackathon_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Hackathon" ("collegeId", "createdAt", "creatorId", "deadline", "description", "endDate", "id", "organizer", "registrationUrl", "startDate", "status", "teamSize", "themes", "title", "updatedAt", "url") SELECT "collegeId", "createdAt", "creatorId", "deadline", "description", "endDate", "id", "organizer", "registrationUrl", "startDate", "status", "teamSize", "themes", "title", "updatedAt", "url" FROM "Hackathon";
DROP TABLE "Hackathon";
ALTER TABLE "new_Hackathon" RENAME TO "Hackathon";
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'STUDENT',
    "collegeId" TEXT,
    "collegeName" TEXT,
    "studentId" TEXT,
    "empNumber" TEXT,
    "departmentId" TEXT,
    "incomingYear" INTEGER,
    "outgoingYear" INTEGER,
    "avatar" TEXT,
    "preferences" TEXT DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("avatar", "collegeId", "createdAt", "email", "id", "name", "passwordHash", "preferences", "role", "studentId", "updatedAt") SELECT "avatar", "collegeId", "createdAt", "email", "id", "name", "passwordHash", "preferences", "role", "studentId", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_studentId_key" ON "User"("studentId");
CREATE UNIQUE INDEX "User_empNumber_key" ON "User"("empNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Department_collegeId_name_key" ON "Department"("collegeId", "name");
