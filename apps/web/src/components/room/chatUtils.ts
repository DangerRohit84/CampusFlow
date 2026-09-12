// components/room/chatUtils.ts — pure chat helpers (SRP extract from RoomChatPanel.tsx).
// WHY: RoomChatPanel (1370 lines) mixed socket/data/memo/render in one component.
// These pure helpers (time/size/URL/grouping/day labels/reply preview) are
// independently testable. Panel keeps hooks/render but delegates logic here.
// Behavior identical; no markup/H1/contrast changes.

export const FILE_API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

/** 50MB — mirrors the backend upload limit. */
export const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** Mirrors the resource-upload endpoint's blocked extensions (server re-validates). */
export const BLOCKED_EXTENSIONS = ['.html', '.htm', '.xhtml', '.svg', '.xml', '.js', '.mjs', '.css'];

/** Accepted mimetypes (picker hint only). */
export const ACCEPT_ATTR = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/gif',
  'text/plain',
  'application/zip',
  'application/x-rar-compressed',
].join(',');

/** Group consecutive messages from the same sender within this window. */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** Windowed list (Instagram/Discord pattern) — render latest 50 + infinite scroll. */
export const MESSAGE_WINDOW = 50;

/** Quick reactions row. */
export const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡', '🎉', '🔥'];

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

export function readOnlyNotice(chatMode: string): string {
  if (chatMode === 'ADMINS_ONLY') {
    return 'Only the room creator and college admins can send messages in this room.';
  }
  return 'Only selected members can chat in this room.';
}

// Absolute-URL guard: cloud storage returns absolute URLs, local uploads are root-relative
export function resolveFileUrl(url: string): string {
  return url.startsWith('http') ? url : `${FILE_API_BASE}/${url}`;
}

export function formatFileSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function replyPreviewText(reply: Pick<{ content: string; hasAttachment: boolean }, 'content' | 'hasAttachment'>): string {
  if (reply.content) return reply.content;
  if (reply.hasAttachment) return 'Attachment';
  return 'Message';
}

export function startOfDayMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function dayKey(iso: string): number {
  return startOfDayMs(new Date(iso));
}

export function dayLabel(iso: string): string {
  const diffDays = Math.round((startOfDayMs(new Date()) - startOfDayMs(new Date(iso))) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export interface ChatRenderMessage {
  id: string;
  senderId: string;
  createdAt: string;
}

export interface RenderItem {
  msg: ChatRenderMessage;
  showDivider: boolean;
  dividerLabel?: string;
  startsGroup: boolean;
  endsGroup: boolean;
}

/** Precomputed render hints: day dividers + consecutive-sender grouping (within 5 min). */
export function buildRenderItems<T extends ChatRenderMessage>(messages: T[]): Array<RenderItem & { msg: T }> {
  return messages.map((msg, i) => {
    const prev = i > 0 ? messages[i - 1] : null;
    const next = i < messages.length - 1 ? messages[i + 1] : null;
    const time = new Date(msg.createdAt).getTime();
    const prevTime = prev ? new Date(prev.createdAt).getTime() : 0;
    const nextTime = next ? new Date(next.createdAt).getTime() : 0;
    const newDay = !prev || dayKey(prev.createdAt) !== dayKey(msg.createdAt);
    const startsGroup = newDay || !prev || prev.senderId !== msg.senderId || time - prevTime > GROUP_WINDOW_MS;
    const endsGroup = !next ||
      next.senderId !== msg.senderId ||
      dayKey(next.createdAt) !== dayKey(msg.createdAt) ||
      nextTime - time > GROUP_WINDOW_MS;
    return {
      msg,
      showDivider: newDay,
      dividerLabel: dayLabel(msg.createdAt),
      startsGroup,
      endsGroup,
    };
  });
}
