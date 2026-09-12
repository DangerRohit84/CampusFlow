// opportunities/staging.ts — staging-list query contract SSOT (Track 4 C-6 lock-in).
// WHY: hackathons.ts fixed fake pagination (limit*2 + in-memory slice + full-table
// total) with DB-side offset/cursor + count-on-same-where, but internships.ts kept
// drifting (no limit clamp, no past-year exclusion, no cursor). One pure builder
// used by BOTH routes locks the contract: status mapping, college scoping,
// past-year exclusion, limit clamp, offset/cursor args, envelope math.
// Pure (no prisma import) so vitest covers it hermetically — seed 5 past +
// 5 future semantics via the where-shape assertions, no DB needed.

export const STAGING_DEFAULT_LIMIT = 20;
export const STAGING_MAX_LIMIT = 100;

export interface StagingParams {
  page?: unknown;
  limit?: unknown;
  cursor?: unknown;
}

export interface ParsedStagingParams {
  page: number;
  limit: number;
  skip: number;
  cursor: string | null;
}

/** Parse ?page/?limit/?cursor with clamps (page >= 1, 1 <= limit <= 100). */
export function parseStagingParams(query: StagingParams): ParsedStagingParams {
  const rawPage = parseInt(String(query.page ?? '1'), 10);
  const rawLimit = parseInt(String(query.limit ?? String(STAGING_DEFAULT_LIMIT)), 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
  const limit =
    Number.isFinite(rawLimit) && rawLimit >= 1
      ? Math.min(STAGING_MAX_LIMIT, rawLimit)
      : STAGING_DEFAULT_LIMIT;
  const cursor = query.cursor ? String(query.cursor) : null;
  return { page, limit, skip: (page - 1) * limit, cursor };
}

export interface StagingScope {
  /** Raw ?status= value (PENDING/APPROVED/REJECTED or undefined). */
  status?: string;
  /** Viewer's college (null for super-admin global or college-less). */
  collegeId?: string | null;
  isSuperAdmin: boolean;
  /** Injected for tests (default: current year). */
  currentYear?: number;
  /**
   * Per-college decision filter (additive, default off so existing callers
   * keep legacy global-status behavior pre-migration).
   * When set + non-super-admin:
   * - PENDING/unfiltered → exclude rows this college already decided
   *   (pending = no decision by my college).
   * - APPROVED/REJECTED → only rows this college decided that way, plus
   *   legacy tenant rows already flipped globally (no decision row yet).
   */
  decisionCollegeId?: string | null;
}

export interface StagingWhereOptions {
  /** Statuses that count as "pending review" (hackathons: DRAFT/PENDING; internships: +ACTIVE). */
  pendingStatuses?: string[];
  /** Only list enriched rows (targetDepartments != '[]') when reviewing pending/unfiltered. */
  requireEnrichedForReview?: boolean;
  /** Exclude past-year titles DB-side (C-6, no migration). */
  excludePastYear?: boolean;
}

function pastYearNotFragment(currentYear: number): Record<string, unknown> | null {
  const ors: Array<Record<string, unknown>> = [];
  for (let y = currentYear - 6; y < currentYear; y++) ors.push({ title: { contains: String(y) } });
  return ors.length > 0 ? { NOT: { OR: ors } } : null;
}

/**
 * Build { baseWhere, scopedWhere } for a staging list/count query.
 * - No deadline filter by design: admin must see recently-expired pending
 *   (e.g. Cognition 2026-08-22); expiry is a visual badge, not a filter.
 * - Past-year titles (2020..Y-1) are excluded DB-side so stale null-deadline
 *   rows (e.g. Netscout 2025) never enter page or count; same-year expired
 *   rows stay visible. In-memory isStagingEnded() remains a safety net only.
 * - Non-super-admins see own college + global (collegeId null); super-admins
 *   keep the unscoped where.
 * - Per-college decisions (additive): when scope.decisionCollegeId is set and
 *   viewer is not super-admin, PENDING/unfiltered excludes rows decided by my
 *   college (NOT decisions some collegeId); APPROVED/REJECTED matches own
 *   decision OR legacy tenant rows already flipped globally (pre-migration).
 *   Pre-migration (no decisions table) routes catch the Prisma P2021/unknown-
 *   relation error and retry without the decision fragment (see routes).
 */
export function buildStagingWhere(
  scope: StagingScope,
  opts: StagingWhereOptions = {},
): { baseWhere: Record<string, unknown>; scopedWhere: Record<string, unknown> } {
  const {
    pendingStatuses = ['DRAFT', 'PENDING'],
    requireEnrichedForReview = true,
    excludePastYear = true,
  } = opts;
  const baseWhere: Record<string, unknown> = {};
  // Order 4: staging decision filter is APPROVED/REJECTED/PENDING over native
  // enums. Normalize case-insensitively at the boundary; ghosts are ignored
  // (no filter) so '?status=pending' never 500s and never mis-filters.
  const rawStatus = typeof scope.status === 'string' ? scope.status.trim().toUpperCase() : scope.status;
  const status = rawStatus && ['PENDING', 'APPROVED', 'REJECTED'].includes(rawStatus) ? rawStatus : undefined;
  if (status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
    if (status === 'PENDING') {
      baseWhere.status = { in: pendingStatuses };
    } else {
      baseWhere.status = status;
    }
  }
  if (requireEnrichedForReview && (status === 'PENDING' || !status)) {
    // Order 3: targetDepartments is canonical Json (array). Prisma Json filter:
    // `not: []` = NOT equals [] (non-empty). Old String code used { not: '[]' }.
    baseWhere.targetDepartments = { not: [] };
  }
  if (excludePastYear) {
    const excl = pastYearNotFragment(scope.currentYear ?? new Date().getFullYear());
    if (excl) Object.assign(baseWhere, excl);
  }
  let scopedWhere: Record<string, unknown> = baseWhere;
  if (!scope.isSuperAdmin) {
    const collegeOr = { OR: [{ collegeId: scope.collegeId ?? null }, { collegeId: null }] };
    const decisionCollegeId = scope.decisionCollegeId ?? null;
    if (decisionCollegeId && (status === 'APPROVED' || status === 'REJECTED')) {
      // Own decision OR legacy tenant row already flipped globally (no decision row).
      const decisionMatch = { decisions: { some: { collegeId: decisionCollegeId, decision: status } } };
      const legacyMatch =
        status === 'APPROVED'
          ? { AND: [{ status: 'APPROVED' }, { collegeId: scope.collegeId ?? null }] }
          : { AND: [{ status: 'REJECTED' }, { collegeId: scope.collegeId ?? null }] };
      const decidedOrLegacy = { OR: [decisionMatch, legacyMatch] };
      const parts: unknown[] = [collegeOr, decidedOrLegacy];
      // Keep past-year + enriched guards from baseWhere without duplicating status.
      const { status: _drop, ...restBase } = baseWhere as Record<string, unknown>;
      if (Object.keys(restBase).length > 0) parts.unshift(restBase);
      scopedWhere = { AND: parts };
    } else if (decisionCollegeId) {
      const exclusion = { NOT: { decisions: { some: { collegeId: decisionCollegeId } } } };
      scopedWhere =
        Object.keys(baseWhere).length > 0
          ? { AND: [baseWhere, collegeOr, exclusion] }
          : { AND: [collegeOr, exclusion] };
    } else {
      scopedWhere =
        Object.keys(baseWhere).length > 0 ? { AND: [baseWhere, collegeOr] } : collegeOr;
    }
  }
  return { baseWhere, scopedWhere };
}

export interface StagingFindArgs {
  where: Record<string, unknown>;
  orderBy: unknown;
  skip?: number;
  take: number;
  cursor?: { id: string };
}

/** Build findMany args: keyset (cursor) or offset mode. Cursor takes limit+1 for hasMore. */
export function buildStagingFindArgs(args: {
  scopedWhere: Record<string, unknown>;
  page: number;
  limit: number;
  skip: number;
  cursor: string | null;
}): StagingFindArgs {
  const orderBy = [{ deadline: 'asc' }, { createdAt: 'desc' }] as unknown;
  if (args.cursor) {
    return {
      where: args.scopedWhere,
      orderBy,
      take: args.limit + 1,
      cursor: { id: args.cursor },
      skip: 1,
    };
  }
  return { where: args.scopedWhere, orderBy, skip: args.skip, take: args.limit };
}

export interface StagingPage<T = { id: string }> {
  pageRows: T[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
}

/**
 * Slice cursor over-fetch (limit+1 -> limit) and compute hasMore/nextCursor.
 * `rows` is the RAW page (drives hasMore in cursor mode); `filtered` is the
 * post-safety-net list actually returned. Offset mode: hasMore from
 * page*limit < total. Pure — unit-test the envelope.
 */
export function buildStagingPage<T extends { id?: unknown }>(args: {
  rows: T[];
  filtered: T[];
  total: number;
  page: number;
  limit: number;
  cursor: string | null;
}): StagingPage<T> {
  const { rows, filtered, total, page, limit, cursor } = args;
  if (cursor) {
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? filtered.slice(0, limit) : filtered;
    const last = pageRows[pageRows.length - 1] as T | undefined;
    const nextCursor = pageRows.length > 0 ? String(last?.id ?? '') || null : null;
    return { pageRows, total, hasMore, nextCursor };
  }
  return { pageRows: filtered, total, hasMore: page * limit < total, nextCursor: null };
}
