-- CreateEnum
CREATE TYPE "AnnouncementTarget" AS ENUM ('ALL_DEPARTMENTS', 'SPECIFIC_DEPARTMENTS');

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT NOT NULL,
    "target" "AnnouncementTarget" NOT NULL DEFAULT 'ALL_DEPARTMENTS',
    "creatorId" TEXT NOT NULL,
    "collegeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementDepartment" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,

    CONSTRAINT "AnnouncementDepartment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Announcement_collegeId_createdAt_idx" ON "Announcement"("collegeId", "createdAt");

-- CreateIndex
CREATE INDEX "AnnouncementDepartment_announcementId_idx" ON "AnnouncementDepartment"("announcementId");

-- CreateIndex
CREATE INDEX "AnnouncementDepartment_departmentId_idx" ON "AnnouncementDepartment"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementDepartment_announcementId_departmentId_key" ON "AnnouncementDepartment"("announcementId", "departmentId");

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementDepartment" ADD CONSTRAINT "AnnouncementDepartment_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementDepartment" ADD CONSTRAINT "AnnouncementDepartment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;
