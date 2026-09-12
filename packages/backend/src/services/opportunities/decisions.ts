// opportunities/decisions.ts — per-college staging decision helpers (SSOT).
// WHY: staging status was a single global column — A APPROVE hid the row from
// B (and REJECT hid it from everyone). @@unique(title,source) stays GLOBAL on
// purpose (one shared feed row); per-college visibility lives in the new
// HackathonStagingDecision / InternshipStagingDecision tables:
//   UNIQUE(stagingId, collegeId), decision APPROVED/REJECTED, by/at audit.
// Global row keeps PENDING/DRAFT/ACTIVE; each college's approve creates its
// OWN published copy + own APPROVED row; reject records own REJECTED only.
// Lists: pending = no decision by my college. Published lookups are scoped
// to my college (fixes idempotent-approve x-college leak). Cron stamps
// global (collegeId null) — no tenant lottery.
// Pure (no prisma import) so vitest covers it hermetically; DB helpers take
// an injected db and guard `(db as any).xxxDecision?` + try/catch so
// pre-migration deploys fall back to legacy global-status behavior (same
// pattern as SourceHealth / SyncThrottle).
// Order 4: StagingDecisionValue mirrors Prisma StagingDecision enum
// (APPROVED/REJECTED; pending = absence, no PENDING row) + validators
// StagingDecisionEnum (zod SSOT). Comparisons stay string literals
// (`decision === 'APPROVED'`) — Prisma enums are strings at runtime.

import { canAccessCollege, getSuperAdminTargetCollegeId, isSuperAdmin } from '../../utils/roles';

export type StagingDecisionValue = 'APPROVED' | 'REJECTED';

export interface DecisionUser {
  id: string;
  role: string;
  collegeId: string | null | undefined;
}

export interface DecisionStaging {
  id: string;
  collegeId: string | null | undefined;
  status?: string;
  title?: string;
  source?: string | null;
  url?: string | null;
}

/**
 * Resolve which college a decision is FOR.
 * - SUPER_ADMIN: tenant staging → its college; global staging → explicit
 *   target from body/query/header (x-superadmin-college-id), else null
 *   (caller must 400 — fixes hackathon null-publish).
 * - Others: always their own collegeId (ignore forged input).
 */
export function resolveDecisionCollegeId(
  user: DecisionUser,
  staging: DecisionStaging,
  req?: any,
): string | null {
  if (isSuperAdmin(user)) {
    if (staging.collegeId) return staging.collegeId;
    if (req) {
      const fromReq = getSuperAdminTargetCollegeId(req);
      if (fromReq) return fromReq;
    }
    return null;
  }
  return user.collegeId || null;
}

/**
 * Can `user` record a decision for `decisionCollegeId` on a staging row
 * owned by `stagingCollegeId`?
 * - SUPER_ADMIN: always (but caller must still require non-null target).
 * - Others: own college must equal the decision college, and the row must be
 *   global (null) or owned by the same college. Tenant rows from another
 *   college are denied (no x-college writes).
 */
export function canDecideForCollege(
  user: DecisionUser,
  stagingCollegeId: string | null | undefined,
  decisionCollegeId: string | null | undefined,
): boolean {
  if (isSuperAdmin(user)) return !!decisionCollegeId;
  if (!user.collegeId || !decisionCollegeId) return false;
  if (user.collegeId !== decisionCollegeId) return false;
  if (stagingCollegeId && stagingCollegeId !== decisionCollegeId) return false;
  return true;
}

/** Tenant gate for a decision target (leak-closed idempotent path). */
export function canAccessDecisionCollege(
  user: DecisionUser,
  decisionCollegeId: string | null | undefined,
): boolean {
  return canAccessCollege(user as any, decisionCollegeId);
}

/** Prisma `where` fragment: exclude rows my college already decided. */
export function buildDecisionExclusionWhere(
  collegeId: string,
  relation: 'decisions' = 'decisions',
): Record<string, unknown> {
  return { NOT: { [relation]: { some: { collegeId } } } };
}

/** Prisma `where` fragment: only rows my college decided `decision`. */
export function buildDecisionMatchWhere(
  collegeId: string,
  decision: StagingDecisionValue,
  relation: 'decisions' = 'decisions',
): Record<string, unknown> {
  return { [relation]: { some: { collegeId, decision } } };
}

/**
 * Own-college published lookup (fixes idempotent-approve leak).
 * BEFORE: `findFirst({ where: { url } })` returned ANY college's copy —
 * B's approve returned A's published row (x-college PII leak) and flipped
 * the shared staging row to APPROVED. AFTER: always scope to my college.
 */
export function buildOwnPublishedWhere(
  staging: Pick<DecisionStaging, 'title' | 'source' | 'url'>,
  collegeId: string,
): Record<string, unknown> {
  if (staging.url) return { url: staging.url, collegeId };
  return { title: (staging as any).title, source: (staging as any).source ?? undefined, collegeId };
}

// ─── DB helpers (injectable db, pre-migration safe) ───

export type DecisionModel = 'hackathonStagingDecision' | 'internshipStagingDecision';

export interface DecisionRow {
  stagingId: string;
  collegeId: string;
  decision: string;
  decidedBy?: string | null;
}

export function isDecisionTableAvailable(db: any, model: DecisionModel): boolean {
  return !!(db && (db as any)[model]);
}

export async function findDecision(
  db: any,
  model: DecisionModel,
  stagingId: string,
  collegeId: string,
): Promise<DecisionRow | null> {
  try {
    const m = (db as any)?.[model];
    if (!m?.findUnique) return null;
    const row = await m.findUnique({
      where: { stagingId_collegeId: { stagingId, collegeId } },
    });
    return (row as DecisionRow | null) ?? null;
  } catch {
    return null;
  }
}

export async function upsertDecision(
  db: any,
  txOrDb: any,
  model: DecisionModel,
  args: { stagingId: string; collegeId: string; decision: StagingDecisionValue; decidedBy: string },
): Promise<DecisionRow | null> {
  try {
    const m = (txOrDb as any)?.[model] ?? (db as any)?.[model];
    if (!m?.upsert) return null;
    const row = await m.upsert({
      where: { stagingId_collegeId: { stagingId: args.stagingId, collegeId: args.collegeId } },
      create: {
        stagingId: args.stagingId,
        collegeId: args.collegeId,
        decision: args.decision,
        decidedBy: args.decidedBy,
      },
      update: { decision: args.decision, decidedBy: args.decidedBy, decidedAt: new Date() },
    });
    return row as DecisionRow;
  } catch {
    return null;
  }
}

/** Map stagingId → decision for one college (counts + list post-filter). */
export async function listDecisionsForCollege(
  db: any,
  model: DecisionModel,
  collegeId: string,
  stagingIds?: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const m = (db as any)?.[model];
    if (!m?.findMany || !collegeId) return out;
    const rows = (await m.findMany({
      where: stagingIds && stagingIds.length > 0
        ? { collegeId, stagingId: { in: stagingIds } }
        : { collegeId },
      select: { stagingId: true, decision: true },
    })) as Array<{ stagingId: string; decision: string }>;
    for (const r of rows || []) out.set(r.stagingId, r.decision);
  } catch {
    // pre-migration: empty map → legacy global-status behavior
  }
  return out;
}
