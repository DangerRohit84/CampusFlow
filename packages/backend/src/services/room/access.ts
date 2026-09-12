// services/room/access.ts — room authorization helpers (SRP extract from routes/rooms.ts).
// WHY: isCollegeAdminForRoom/computeCanChat/chatDeniedMessage were inline in the
// 2152-line rooms router. Pure helpers, unit-testable, no DB. Behavior identical.

export function isCollegeAdminForRoom(
  user: { role: string; collegeId: string | null },
  teacherCollegeId: string | null,
): boolean {
  if (user.role === 'SUPER_ADMIN') return true;
  return user.role === 'COLLEGE_ADMIN' && !!user.collegeId && user.collegeId === teacherCollegeId;
}

export function computeCanChat(
  chatMode: string,
  isCreator: boolean,
  isAdmin: boolean,
  isAllowed: boolean,
): boolean {
  if (chatMode === 'ADMINS_ONLY') return isCreator || isAdmin;
  if (chatMode === 'SELECTED') return isCreator || isAdmin || isAllowed;
  return true;
}

export function chatDeniedMessage(chatMode: string): string {
  if (chatMode === 'ADMINS_ONLY') return 'Only the room creator and college admins can send messages in this room';
  if (chatMode === 'SELECTED') return 'Only selected members can chat in this room';
  return 'You cannot send messages in this room';
}
