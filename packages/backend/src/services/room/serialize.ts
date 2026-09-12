// services/room/serialize.ts — room message wire shape (SRP extract from routes/rooms.ts).
// WHY: serializeRoomMessage + messageWithReplyInclude + truncateContent were
// inline in the god router. Pure shape (tombstones strip content/attachments
// server-side so deleted payloads never leak). Behavior identical.

import { REPLY_PREVIEW_MAX_LENGTH } from './limits';

export function truncateContent(text: string | null | undefined, max = REPLY_PREVIEW_MAX_LENGTH): string {
  const clean = text ?? '';
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

// Uniform wire shape for room messages across GET list, POST create, forward broadcasts.
// Deleted messages become tombstones: content + attachment fields are stripped server-side
// so deleted payloads never leak through the API.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeRoomMessage(m: any): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: m.id,
    roomId: m.roomId,
    senderId: m.senderId,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt ?? m.createdAt,
    isDeleted: !!m.isDeleted,
    deletedAt: m.deletedAt ?? null,
    isForwarded: !!m.isForwarded,
    // Threads-lite (#8): pins ride the message wire (pinned bar needs no
    // second fetch); replyCount comes from `_count.replies` when selected.
    isPinned: !!m.isPinned,
    pinnedAt: m.pinnedAt ?? null,
    pinnedBy: m.pinnedBy ?? null,
    replyCount:
      typeof m.replyCount === 'number'
        ? m.replyCount
        : typeof m._count?.replies === 'number'
          ? m._count.replies
          : 0,
    replyTo: m.replyTo
      ? {
          id: m.replyTo.id,
          senderName: m.replyTo.sender?.name || 'Member',
          content: m.replyTo.isDeleted ? '' : truncateContent(m.replyTo.content),
          hasAttachment: !m.replyTo.isDeleted && !!m.replyTo.fileUrl,
        }
      : null,
    sender: m.sender,
  };
  if (!base.isDeleted) {
    base.content = m.content;
    base.fileUrl = m.fileUrl;
    base.fileName = m.fileName;
    base.fileType = m.fileType;
    base.fileSize = m.fileSize;
  }

  if (Array.isArray(m.reactions)) {
    const grouped: Record<string, { emoji: string; count: number; userIds: string[] }> = {};
    for (const r of m.reactions) {
      if (!grouped[r.emoji]) grouped[r.emoji] = { emoji: r.emoji, count: 0, userIds: [] };
      grouped[r.emoji].count++;
      grouped[r.emoji].userIds.push(r.userId);
    }
    base.reactions = Object.values(grouped).sort((a, b) => b.count - a.count);
  } else {
    base.reactions = [];
  }

  return base;
}

// Include shape that pairs a message with its reply-parent preview data
export const messageWithReplyInclude = {
  sender: { select: { id: true, name: true, email: true, avatar: true } },
  replyTo: {
    select: {
      id: true,
      content: true,
      fileUrl: true,
      isDeleted: true,
      sender: { select: { name: true } },
    },
  },
  reactions: {
    select: {
      emoji: true,
      userId: true,
    },
  },
  // Threads-lite (#8): one extra count per row (indexed FK) so lists carry
  // reply counts without N+1. Tombstones keep the count (thread still exists).
  _count: {
    select: { replies: true },
  },
} as const;
