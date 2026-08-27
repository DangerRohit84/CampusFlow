-- CreateEnum
CREATE TYPE "AnnouncementTargetScope" AS ENUM ('ALL_COLLEGES', 'SPECIFIC_COLLEGES', 'MY_COLLEGES');

-- AlterTable: Add targetScope and make collegeId nullable
ALTER TABLE "Announcement" ADD COLUMN "targetScope" "AnnouncementTargetScope" NOT NULL DEFAULT 'MY_COLLEGES';
ALTER TABLE "Announcement" ALTER COLUMN "collegeId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AnnouncementCollege" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "collegeId" TEXT NOT NULL,

    CONSTRAINT "AnnouncementCollege_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementCollege_announcementId_collegeId_key" ON "AnnouncementCollege"("announcementId", "collegeId");

-- CreateIndex
CREATE INDEX "AnnouncementCollege_announcementId_idx" ON "AnnouncementCollege"("announcementId");

-- CreateIndex
CREATE INDEX "AnnouncementCollege_collegeId_idx" ON "AnnouncementCollege"("collegeId");

-- CreateIndex
CREATE INDEX "Announcement_targetScope_createdAt_idx" ON "Announcement"("targetScope", "createdAt");

-- AddForeignKey
ALTER TABLE "AnnouncementCollege" ADD CONSTRAINT "AnnouncementCollege_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementCollege" ADD CONSTRAINT "AnnouncementCollege_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE CASCADE ON UPDATE CASCADE;
