-- CreateTable
CREATE TABLE "RoomRead" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoomRead_roomId_userId_key" ON "RoomRead"("roomId", "userId");

-- CreateIndex
CREATE INDEX "RoomRead_userId_idx" ON "RoomRead"("userId");

-- CreateIndex
CREATE INDEX "RoomRead_roomId_idx" ON "RoomRead"("roomId");

-- AddForeignKey
ALTER TABLE "RoomRead" ADD CONSTRAINT "RoomRead_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomRead" ADD CONSTRAINT "RoomRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;