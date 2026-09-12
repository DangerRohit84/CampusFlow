// components/room/threadUtils.ts — threads-lite (#8) pure client helpers.
// WHY: replyToId IS the thread parent (same contract as the backend
// services/room/threads). Roots render in the main flow; children render
// nested under their parent when its thread is expanded. Pure + tested:
// run `npm run test -w @campusflow/web`.

export interface Threadable {
  id: string;
  createdAt: string;
  replyTo?: { id: string } | null;
}

/** parentId -> direct children (chronological asc). Includes pending (temp ids). */
export function buildThreadChildren<T extends Threadable>(messages: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const m of messages) {
    const pid = m.replyTo?.id;
    if (!pid) continue;
    const list = map.get(pid);
    if (list) list.push(m);
    else map.set(pid, [m]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }
  return map;
}

/** All message ids (parents + children) for root detection. */
export function buildIdSet<T extends Threadable>(messages: T[]): Set<string> {
  return new Set(messages.map((m) => m.id));
}

/** A message is a root when it has no replyTo or its parent is not in the set
 * (parent hidden scope=me / outside the window → render standalone with its quote chip). */
export function isThreadRoot<T extends Threadable>(msg: T, ids: Set<string>): boolean {
  return !msg.replyTo || !ids.has(msg.replyTo.id);
}

/** Direct child count for a parent (0 when none). */
export function getReplyCount(children: Map<string, unknown[]>, parentId: string): number {
  return children.get(parentId)?.length ?? 0;
}

/** All descendant ids of a parent (depth-capped to avoid runaway recursion). */
export function collectDescendantIds(
  children: Map<string, Threadable[]>,
  parentId: string,
  maxDepth = 3,
): Set<string> {
  const out = new Set<string>();
  const walk = (pid: string, depth: number) => {
    if (depth > maxDepth) return;
    for (const c of children.get(pid) ?? []) {
      if (out.has(c.id)) continue;
      out.add(c.id);
      walk(c.id, depth + 1);
    }
  };
  walk(parentId, 1);
  return out;
}

/** Latest activity (own time vs newest descendant) — for " Threads (n)" badges. */
export function threadLatestAt<T extends Threadable>(
  parent: T,
  children: Map<string, T[]>,
): number {
  let latest = new Date(parent.createdAt).getTime();
  const stack = [...(children.get(parent.id) ?? [])];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur.id)) continue;
    seen.add(cur.id);
    const t = new Date(cur.createdAt).getTime();
    if (t > latest) latest = t;
    stack.push(...(children.get(cur.id) ?? []));
  }
  return latest;
}
