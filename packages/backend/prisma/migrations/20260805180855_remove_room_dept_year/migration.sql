/*
  Warnings:

  - You are about to drop the `_FormToRoom` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `departmentId` on the `Room` table. All the data in the column will be lost.
  - You are about to drop the column `targetYears` on the `Room` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "_FormToRoom_B_index";

-- DropIndex
DROP INDEX "_FormToRoom_AB_unique";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "_FormToRoom";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "FormRoom" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "formId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FormRoom_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FormRoom_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Room" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "joinCode" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Room_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Room" ("createdAt", "description", "id", "joinCode", "name", "teacherId", "updatedAt") SELECT "createdAt", "description", "id", "joinCode", "name", "teacherId", "updatedAt" FROM "Room";
DROP TABLE "Room";
ALTER TABLE "new_Room" RENAME TO "Room";
CREATE UNIQUE INDEX "Room_joinCode_key" ON "Room"("joinCode");
CREATE INDEX "Room_teacherId_idx" ON "Room"("teacherId");
CREATE INDEX "Room_joinCode_idx" ON "Room"("joinCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "FormRoom_formId_idx" ON "FormRoom"("formId");

-- CreateIndex
CREATE INDEX "FormRoom_roomId_idx" ON "FormRoom"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "FormRoom_formId_roomId_key" ON "FormRoom"("formId", "roomId");
