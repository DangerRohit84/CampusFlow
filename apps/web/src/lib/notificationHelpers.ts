// lib/notificationHelpers.ts — pure optimistic transforms (topbottom F2).
// WHY: NotificationsPage applied optimistic read/delete with NO rollback —
// failure left UI permanently wrong with no toast. Pure helpers make
// apply/revert testable in node vitest; page wraps them in try/catch.
export type NotifLike = { id: string; isRead?: boolean; [k: string]: unknown }

export function applyMarkRead(list: NotifLike[], id: string): NotifLike[] {
  return list.map((n) => (n.id === id ? { ...n, isRead: true } : n))
}

export function applyMarkAllRead(list: NotifLike[]): NotifLike[] {
  return list.map((n) => ({ ...n, isRead: true }))
}

export function applyDelete(list: NotifLike[], id: string): NotifLike[] {
  return list.filter((n) => n.id !== id)
}
