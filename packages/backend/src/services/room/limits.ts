// services/room/limits.ts — room chat limits (SRP extract from routes/rooms.ts).
// WHY: CHAT_MODES/MAX_MESSAGE_LENGTH/REPLY_PREVIEW were route-file globals.
// One home, imported by routes + services. No behavior change.

export const CHAT_MODES = ['EVERYONE', 'ADMINS_ONLY', 'SELECTED'] as const;
export type ChatMode = (typeof CHAT_MODES)[number];

export const MAX_MESSAGE_LENGTH = 2000;

/** Reply previews are capped so long parents never bloat the message list payload. */
export const REPLY_PREVIEW_MAX_LENGTH = 120;
