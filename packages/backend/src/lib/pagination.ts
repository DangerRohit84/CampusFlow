/**
 * CampusFlow pagination utils — 10k scale.
 *
 * Offset (`page`/`limit`) for admin lists + cursor helpers for hot feeds
 * (notifications, room messages). Generic `paged()` keeps every list route
 * on the same envelope so the frontend + CDN logic stays uniform.
 *
 * Offset cost: O(N) OFFSET scan — fine for admin pages <10k rows.
 * For real-time / infinite-scroll at 10k+, prefer cursor (O(1) index seek,
 * stable under inserts — Stripe/GitHub pattern).
 */

export interface ParsedPagination {
  page: number
  limit: number
  skip: number
}

export const PAGINATION_DEFAULT_LIMIT = 20
export const PAGINATION_MAX_LIMIT = 50

type PaginationInput = {
  page?: string | number | null
  limit?: string | number | null
}

/** Clamp `?page=&limit=` to safe bounds. Always returns page>=1, 1<=limit<=50. */
export function parsePagination(input: PaginationInput = {}): ParsedPagination {
  const rawPage = typeof input.page === 'string' ? parseInt(input.page, 10) : (input.page ?? 1)
  const rawLimit = typeof input.limit === 'string' ? parseInt(input.limit, 10) : (input.limit ?? PAGINATION_DEFAULT_LIMIT)
  const page = Number.isFinite(rawPage as number) && (rawPage as number) >= 1 ? Math.floor(rawPage as number) : 1
  const limitUnclamped = Number.isFinite(rawLimit as number) && (rawLimit as number) >= 1 ? Math.floor(rawLimit as number) : PAGINATION_DEFAULT_LIMIT
  const limit = Math.min(PAGINATION_MAX_LIMIT, Math.max(1, limitUnclamped))
  return { page, limit, skip: (page - 1) * limit }
}

export interface PagedEnvelope<T> {
  data: T[]
  pagination: {
    page: number
    limit: number
    total: number
    pages: number
  }
}

/**
 * Generic offset helper — keeps list routes DRY.
 *
 * @example
 * const result = await paged((skip, take) => Promise.all([
 *   prisma.hackathon.findMany({ where, skip, take, orderBy }),
 *   prisma.hackathon.count({ where }),
 * ]).then(([rows, total]) => ({ rows, total })), { page, limit })
 */
export async function paged<T>(
  fetch: (skip: number, take: number) => Promise<{ rows: T[]; total: number }>,
  opts: { page: number; limit: number }
): Promise<PagedEnvelope<T>> {
  const page = Math.max(1, Math.floor(opts.page) || 1)
  const limit = Math.min(PAGINATION_MAX_LIMIT, Math.max(1, Math.floor(opts.limit) || PAGINATION_DEFAULT_LIMIT))
  const skip = (page - 1) * limit
  const { rows, total } = await fetch(skip, limit)
  return {
    data: rows,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  }
}

/** Opaque cursor: base64url(JSON). Keep payload tiny (id + sort key only). */
export function encodeCursor(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload)
  return Buffer.from(json, 'utf8').toString('base64url')
}

/** Decode cursor or null on any tampering (never throw on user input). */
export function decodeCursor(cursor: string | null | undefined): Record<string, any> | null {
  if (!cursor || typeof cursor !== 'string') return null
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8')
    const parsed = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, any>
  } catch {
    return null
  }
}

/**
 * Build a Prisma cursor clause from an opaque cursor.
 * Assumes the model has a unique `id` field (true for all CampusFlow models).
 * Caller spreads into findMany: `prisma.x.findMany({ where, orderBy, take, ...buildCursorWhere(cursor) })`.
 */
export function buildCursorWhere(cursor: string | null | undefined): Record<string, unknown> {
  const decoded = decodeCursor(cursor)
  if (!decoded || typeof decoded.id !== 'string' || !decoded.id) return {}
  return { cursor: { id: decoded.id }, skip: 1 }
}

/**
 * Keyset helper for (createdAt, id) ordered feeds — O(1) index seek, no OFFSET.
 * Use when frontend sends `?cursor=` + `?limit=` for infinite scroll.
 * Returns `{ take, cursorClause }` ready for Prisma.
 */
export function keysetTake(cursor: string | null | undefined, limit: number): {
  take: number
  cursorClause: Record<string, unknown>
} {
  const take = Math.min(PAGINATION_MAX_LIMIT, Math.max(1, Math.floor(limit) || PAGINATION_DEFAULT_LIMIT))
  return { take, cursorClause: buildCursorWhere(cursor) }
}
