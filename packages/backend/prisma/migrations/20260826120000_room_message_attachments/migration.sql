-- AlterTable
ALTER TABLE "Resource" ADD COLUMN     "fileSize" INTEGER,
ADD COLUMN     "sourceMessageId" TEXT;

-- AlterTable
ALTER TABLE "RoomMessage" ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "fileSize" INTEGER,
ADD COLUMN     "fileType" TEXT,
ADD COLUMN     "fileUrl" TEXT;
