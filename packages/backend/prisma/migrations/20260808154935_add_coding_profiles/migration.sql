-- AlterTable
ALTER TABLE "HackathonRegistration" ADD COLUMN "review" TEXT;
ALTER TABLE "HackathonRegistration" ADD COLUMN "winPosition" TEXT;

-- CreateTable
CREATE TABLE "CodingProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "leetcodeHandle" TEXT,
    "codeforcesHandle" TEXT,
    "codechefHandle" TEXT,
    "hackerrankHandle" TEXT,
    "gfgHandle" TEXT,
    "lastSyncedAt" DATETIME,
    CONSTRAINT "CodingProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContestParticipation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "contestId" TEXT,
    "platform" TEXT NOT NULL,
    "contestName" TEXT NOT NULL,
    "contestUrl" TEXT,
    "rank" INTEGER,
    "score" INTEGER,
    "rating" INTEGER,
    "ratingChange" INTEGER,
    "problemsSolved" INTEGER,
    "totalProblems" INTEGER,
    "participatedAt" DATETIME,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContestParticipation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Internship" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "creatorId" TEXT NOT NULL,
    "collegeId" TEXT NOT NULL,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Internship_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Internship_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InternshipRegistration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "internshipId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REGISTERED',
    "reportedAt" DATETIME,
    CONSTRAINT "InternshipRegistration_internshipId_fkey" FOREIGN KEY ("internshipId") REFERENCES "Internship" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InternshipRegistration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CodingContest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "duration" INTEGER,
    "contestType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UPCOMING',
    "solutions" TEXT NOT NULL DEFAULT '[]',
    "isAutoFetched" BOOLEAN NOT NULL DEFAULT false,
    "creatorId" TEXT,
    "collegeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CodingContest_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CodingContest_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RoomMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "isCR" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoomMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoomMember_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_RoomMember" ("id", "joinedAt", "roomId", "studentId") SELECT "id", "joinedAt", "roomId", "studentId" FROM "RoomMember";
DROP TABLE "RoomMember";
ALTER TABLE "new_RoomMember" RENAME TO "RoomMember";
CREATE INDEX "RoomMember_roomId_idx" ON "RoomMember"("roomId");
CREATE INDEX "RoomMember_studentId_idx" ON "RoomMember"("studentId");
CREATE UNIQUE INDEX "RoomMember_roomId_studentId_key" ON "RoomMember"("roomId", "studentId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "CodingProfile_userId_key" ON "CodingProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ContestParticipation_userId_platform_contestName_key" ON "ContestParticipation"("userId", "platform", "contestName");

-- CreateIndex
CREATE UNIQUE INDEX "InternshipRegistration_internshipId_userId_key" ON "InternshipRegistration"("internshipId", "userId");
