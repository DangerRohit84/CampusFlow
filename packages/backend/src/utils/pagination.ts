/**
 * List pagination contract (GET /admin/users, /admin/hackathons, /admin/forms,
 * /notifications, /rooms — dual-mode cursor/page pattern).
 * Pure helpers — no DB, hermetic unit-testable.
 * WHY split out: the same take:50+count logic was inlined in 4+ routes;
 * this locks the contract (limit 1..50 generic, 1..100 users, page >=1,
 * envelope shape) so the AdminPage Users pager UI can rely on
 * {data, pagination:{page,limit,total,pages,nextCursor}}.
 * Mirrors admin.ts inline parsing exactly — do not diverge without updating callers.
 */

/** Users tab page size — default 50, cap 100 (10k scale, dropdown 10/25/50/100). */
export const USERS_PAGE_SIZE = 50

/** Users list cap (Students/Teachers/Admins tabs only, 2026-09-14 user wish). */
export const USERS_PAGE_LIMIT_MAX = 100

/** Generic list cap (same 50 for hackathons/forms/notifications/rooms). */
export const PAGE_LIMIT_MAX = 50
export const DEFAULT_PAGE_LIMIT = 50

export interface ParsedListPagination {
  wantsPaged: boolean
  limit: number
  page: number
  skip: number
  cursorId: string | null
}

/**
 * Parse ?page/?limit/?cursor into the dual-mode contract.
 * - No query → wantsPaged false (caller returns capped array + X-Total-Count).
 * - Any of page/limit/cursor → wantsPaged true (caller returns envelope).
 * - maxLimit defaults to PAGE_LIMIT_MAX (50 generic); users callers pass
 *   USERS_PAGE_LIMIT_MAX (100) for the Students/Teachers/Admins tabs.
 */
export function parseListPagination(
  query: {
    page?: unknown
    limit?: unknown
    cursor?: unknown
  },
  maxLimit: number = PAGE_LIMIT_MAX,
): ParsedListPagination {
  const wantsPaged = query.page != null || query.limit != null || query.cursor != null
  const limitParam = parseInt(String((query.limit as string) || '50'), 10)
  const cap = Number.isFinite(maxLimit) ? Math.min(100, Math.max(1, Math.floor(maxLimit))) : PAGE_LIMIT_MAX
  const limit = Number.isFinite(limitParam) ? Math.min(cap, Math.max(1, limitParam)) : DEFAULT_PAGE_LIMIT
  const page = Math.max(1, parseInt(String((query.page as string) || '1'), 10) || 1)
  const skip = (page - 1) * limit
  const cursorId = query.cursor ? String(query.cursor) : null
  return { wantsPaged, limit, page, skip, cursorId }
}

export interface PagedEnvelope<T = any> {
  data: T[]
  pagination: {
    page: number
    limit: number
    total: number
    pages: number
    nextCursor: string | null
  }
}

/** Build the paged envelope (pages + nextCursor from last row id). */
export function buildPagedEnvelope<T extends { id?: unknown }>(args: {
  rows: T[]
  total: number
  page: number
  limit: number
}): PagedEnvelope<T> {
  const { rows, total, page, limit } = args
  const pages = Math.ceil(total / limit)
  const nextCursor =
    rows.length === limit ? ((rows[rows.length - 1] as any)?.id ?? null) : null
  return { data: rows, pagination: { page, limit, total, pages, nextCursor } }
}

export interface UnwrappedList {
  data: any[]
  total: number
  pages: number
  page: number
  limit: number
}

/**
 * Normalize a list response for the UI (envelope or legacy capped array).
 * WHY: AdminPage previously assumed array-only and dropped pagination.total,
 * which hid the 50-cap. Paged callers always get total+pages; compat arrays
 * fall back to length (single page) so old callers keep working.
 */
export function unwrapListResponse(raw: unknown): UnwrappedList {
  if (Array.isArray(raw)) {
    return { data: raw, total: raw.length, pages: 1, page: 1, limit: raw.length }
  }
  const env = raw as Partial<PagedEnvelope> & { data?: any[]; pagination?: any }
  const data = Array.isArray(env?.data) ? (env.data as any[]) : []
  const pagination = env?.pagination ?? {}
  const total = typeof pagination.total === 'number' ? pagination.total : data.length
  const limit =
    typeof pagination.limit === 'number' && Number.isFinite(pagination.limit)
      ? pagination.limit
      : USERS_PAGE_SIZE
  const page = typeof pagination.page === 'number' && pagination.page >= 1 ? pagination.page : 1
  const pages =
    typeof pagination.pages === 'number' ? pagination.pages : Math.ceil(total / (limit || USERS_PAGE_SIZE))
  return { data, total, pages, page, limit }
}
