-- Threads-lite (#8): message pins (additive, no backfill).
-- Threads reuse the existing replyToId self-FK as the thread parent
-- (quote-replies ARE the thread children; no new parentId column needed).
-- Deploy applies via preDeployCommand (`prisma migrate deploy` with DIRECT_URL);
-- local dev: `npx prisma migrate dev`.

ALTER TABLE "RoomMessage" ADD COLUMN IF NOT EXISTS "isPinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RoomMessage" ADD COLUMN IF NOT EXISTS "pinnedAt" TIMESTAMP(3);
ALTER TABLE "RoomMessage" ADD COLUMN IF NOT EXISTS "pinnedBy" TEXT;

CREATE INDEX IF NOT EXISTS "RoomMessage_roomId_isPinned_idx" ON "RoomMessage"("roomId", "isPinned");
