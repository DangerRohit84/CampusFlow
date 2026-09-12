// lib/repository.ts — DIP: repository interfaces + Prisma + in-memory fakes.
// WHY: every route/service did `import prisma` directly (no seam for tests).
// New code depends on these interfaces, injected via lib/container.ts.
// Existing `import prisma` call sites keep working; migrate incrementally.

export interface OpportunityDedupStore {
  findExistingByTitles(titles: string[], source: string): Promise<Set<string>>
}

export interface ContestStore {
  findMany(args: unknown): Promise<Array<{ id: string; title: string; url: string }>>
  count(args?: unknown): Promise<number>
}

export interface NotificationStore {
  createManyAndReturn(args: unknown): Promise<Array<{ id: string; userId: string }>>
  createMany(args: unknown): Promise<{ count: number }>
}

export interface UserLookup {
  findUnique(args: unknown): Promise<{ id: string } | null>
}

/** Prisma-backed notification store (pass prisma.notification). */
export function prismaNotificationStore(model: {
  createManyAndReturn(args: unknown): Promise<Array<{ id: string; userId: string }>>;
  createMany(args: unknown): Promise<{ count: number }>;
}): NotificationStore {
  return {
    createManyAndReturn: (args) => model.createManyAndReturn(args),
    createMany: (args) => model.createMany(args),
  };
}

/** In-memory notification fake for unit tests (no DB). */
export function inMemoryNotificationStore(): NotificationStore & {
  rows: Array<{ id: string; userId: string }>;
} {
  const rows: Array<{ id: string; userId: string }> = [];
  let seq = 0;
  return {
    rows,
    async createManyAndReturn(args: unknown): Promise<Array<{ id: string; userId: string }>> {
      const data = (args as { data: Array<{ userId: string }> }).data ?? [];
      const created = data.map((d) => ({ id: `n${++seq}`, userId: d.userId }));
      rows.push(...created);
      return created;
    },
    async createMany(args: unknown): Promise<{ count: number }> {
      const data = (args as { data: Array<{ userId: string }> }).data ?? [];
      const created = data.map((d) => ({ id: `n${++seq}`, userId: d.userId }));
      rows.push(...created);
      return { count: created.length };
    },
  };
}

/** Prisma-backed dedup store (pass e.g. prisma.hackathonStaging). */
export function prismaOpportunityDedupStore(model: {
  findMany(args: unknown): Promise<Array<{ title: string }>>
}): OpportunityDedupStore {
  return {
    async findExistingByTitles(titles: string[], source: string): Promise<Set<string>> {
      // Order 2 V-24: NULL-safe — blank source maps to MANUAL (matches DB NOT NULL).
      const norm = String(source ?? '').trim() ? String(source).trim().toUpperCase() : 'MANUAL'
      const rows = await model.findMany({ where: { title: { in: titles }, source: norm } } as never)
      return new Set(rows.map((r) => String(r.title || '').trim()))
    },
  }
}

/** In-memory fake for unit tests (no DB). */
export function inMemoryDedupStore(existing: Array<{ title: string }> = []): OpportunityDedupStore {
  const set = new Set(existing.map((r) => String(r.title || '').trim()))
  return {
    async findExistingByTitles(titles: string[]): Promise<Set<string>> {
      return new Set(titles.filter((t) => set.has(String(t || '').trim())))
    },
  }
}
