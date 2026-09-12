// services/room/index.ts — barrel for room domain (SRP split).
// New code imports from here; routes/rooms.ts re-exports for compat.
export { CHAT_MODES, MAX_MESSAGE_LENGTH, REPLY_PREVIEW_MAX_LENGTH } from './limits';
export type { ChatMode } from './limits';
export { isCollegeAdminForRoom, computeCanChat, chatDeniedMessage } from './access';
export { serializeRoomMessage, messageWithReplyInclude, truncateContent } from './serialize';
export { groupReplies, countReplies, getThread } from './threads';
export type { ThreadChildRef, ThreadGroups, ThreadView } from './threads';
export { scoreMessage, rankMessages, isSubsequence, levenshteinWithin } from './search';
export { SEARCH_CANDIDATE_CAP, SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT } from './search';
export type { SearchableMessage, RankedHit } from './search';
export { parsePreferences, getMutedRoomIds, setRoomMuted } from './mute';
export { MUTED_ROOMS_KEY, MAX_MUTED_ROOMS } from './mute';
