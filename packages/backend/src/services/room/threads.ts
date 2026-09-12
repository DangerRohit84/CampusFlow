// services/room/threads.ts — threads-lite (#8) pure helpers (no DB).
// WHY: threads reuse the existing replyToId self-FK as the thread parent
// (quote-replies ARE thread children — no parentId migration needed).
// These pure group/count/select helpers shape the /threads + /thread
// endpoints and are unit-testable without a DB. Behavior: single-level
// nesting (replies-to-replies attach to their direct parent id; the UI
// renders depth-capped trees from the same map).

export interface ThreadChildRef {
  id: string;
  replyToId: string | null;
  createdAt: Date | string;
}

export interface ThreadGroups<T = ThreadChildRef> {
  /** parentId -> direct children (chronological asc) */
  childrenByParentId: Map<string, T[]>;
  /** parentId -> direct child count */
  replyCounts: Map<string, number>;
}

/** Group direct children by their replyToId parent (skips roots). */
export function groupReplies<T extends ThreadChildRef>(messages: T[]): ThreadGroups<T> {
  const childrenByParentId = new Map<string, T[]>();
  for (const m of messages) {
    if (!m.replyToId) continue;
    const list = childrenByParentId.get(m.replyToId);
    if (list) list.push(m);
    else childrenByParentId.set(m.replyToId, [m]);
  }
  // Chronological within each thread (stable render + latest-preview).
  for (const list of childrenByParentId.values()) {
    list.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }
  const replyCounts = new Map<string, number>();
  for (const [parentId, list] of childrenByParentId) replyCounts.set(parentId, list.length);
  return { childrenByParentId, replyCounts };
}

/** Direct child count for one parent (0 when none). */
export function countReplies(messages: ThreadChildRef[], parentId: string): number {
  let n = 0;
  for (const m of messages) if (m.replyToId === parentId) n++;
  return n;
}

export interface ThreadView<T> {
  parent: T;
  replies: T[];
}

/** Select one thread: parent by id + its direct children (chronological). */
export function getThread<T extends ThreadChildRef>(
  messages: T[],
  parentId: string,
): ThreadView<T> | null {
  const parent = messages.find((m) => m.id === parentId) ?? null;
  if (!parent) return null;
  const { childrenByParentId } = groupReplies(messages);
  return { parent, replies: childrenByParentId.get(parentId) ?? [] };
}
