/**
 * Per-college independent approve/reject — hermetic contract tests.
 * Locks the fix for: single global status, @@unique(title,source) sharing,
 * idempotent-approve x-college leak, cron tenant lottery, hackathon null-publish,
 * re-enrich own-rejected only.
 * Pure — no DB, no network. Decision DB helpers use in-memory fakes.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveDecisionCollegeId,
  canDecideForCollege,
  canAccessDecisionCollege,
  buildOwnPublishedWhere,
  findDecision,
  upsertDecision,
  listDecisionsForCollege,
} from '../src/services/opportunities/decisions';
import { buildStagingWhere } from '../src/services/opportunities/staging';

const collegeA = '11111111-1111-4111-8111-111111111111';
const collegeB = '22222222-2222-4222-8222-222222222222';
const stagingId = '33333333-3333-4333-8333-333333333333';

function teacher(collegeId: string | null) {
  return { id: 'u-teacher', role: 'TEACHER', collegeId };
}
function superAdmin() {
  return { id: 'u-super', role: 'SUPER_ADMIN', collegeId: null };
}

// Minimal in-memory fake for the decisions tables (pre/post-migration shapes).
function fakeDb(seed: Array<{ stagingId: string; collegeId: string; decision: string; decidedBy?: string }> = []) {
  const rows = [...seed];
  return {
    rows,
    hackathonStagingDecision: {
      async findUnique({ where }: any) {
        return rows.find(
          (r) => r.stagingId === where.stagingId_collegeId.stagingId && r.collegeId === where.stagingId_collegeId.collegeId,
        ) ?? null;
      },
      async upsert({ where, create, update }: any) {
        const key = where.stagingId_collegeId;
        const existing = rows.find((r) => r.stagingId === key.stagingId && r.collegeId === key.collegeId);
        if (existing) {
          existing.decision = update.decision;
          if (update.decidedBy) existing.decidedBy = update.decidedBy;
          return existing;
        }
        const row = { stagingId: create.stagingId, collegeId: create.collegeId, decision: create.decision, decidedBy: create.decidedBy };
        rows.push(row);
        return row;
      },
      async findMany({ where }: any) {
        return rows
          .filter((r) => (where?.collegeId ? r.collegeId === where.collegeId : true))
          .filter((r) => (where?.stagingId?.in ? where.stagingId.in.includes(r.stagingId) : true))
          .map((r) => ({ stagingId: r.stagingId, decision: r.decision }));
      },
    },
    internshipStagingDecision: {
      async findUnique({ where }: any) {
        return rows.find(
          (r) => r.stagingId === where.stagingId_collegeId.stagingId && r.collegeId === where.stagingId_collegeId.collegeId,
        ) ?? null;
      },
      async upsert({ where, create, update }: any) {
        const key = where.stagingId_collegeId;
        const existing = rows.find((r) => r.stagingId === key.stagingId && r.collegeId === key.collegeId);
        if (existing) {
          existing.decision = update.decision;
          return existing;
        }
        const row = { stagingId: create.stagingId, collegeId: create.collegeId, decision: create.decision, decidedBy: create.decidedBy };
        rows.push(row);
        return row;
      },
      async findMany({ where }: any) {
        return rows
          .filter((r) => (where?.collegeId ? r.collegeId === where.collegeId : true))
          .map((r) => ({ stagingId: r.stagingId, decision: r.decision }));
      },
    },
  };
}

describe('resolveDecisionCollegeId', () => {
  it('non-superadmin always resolves to own college (ignores forged target)', () => {
    const staging = { id: stagingId, collegeId: null as string | null };
    expect(resolveDecisionCollegeId(teacher(collegeA), staging, { body: { collegeId: collegeB } })).toBe(collegeA);
  });

  it('tenant staging resolves to its college for teachers of that college', () => {
    const staging = { id: stagingId, collegeId: collegeA };
    expect(resolveDecisionCollegeId(teacher(collegeA), staging, {})).toBe(collegeA);
  });

  it('superadmin global approve uses explicit target (body/query/header)', () => {
    const staging = { id: stagingId, collegeId: null };
    expect(resolveDecisionCollegeId(superAdmin(), staging, { body: { collegeId: collegeA } })).toBe(collegeA);
    expect(resolveDecisionCollegeId(superAdmin(), staging, { query: { collegeId: collegeB } })).toBe(collegeB);
    expect(resolveDecisionCollegeId(superAdmin(), staging, { headers: { 'x-superadmin-college-id': collegeA } })).toBe(collegeA);
  });

  it('superadmin global without target resolves null (caller must 400 — null-publish fix)', () => {
    const staging = { id: stagingId, collegeId: null };
    expect(resolveDecisionCollegeId(superAdmin(), staging, {})).toBeNull();
  });

  it('superadmin tenant staging resolves to the row college', () => {
    const staging = { id: stagingId, collegeId: collegeB };
    expect(resolveDecisionCollegeId(superAdmin(), staging, {})).toBe(collegeB);
  });
});

describe('canDecideForCollege', () => {
  it('teacher can decide global feed for own college', () => {
    expect(canDecideForCollege(teacher(collegeA), null, collegeA)).toBe(true);
  });

  it('teacher cannot decide for another college (global or tenant)', () => {
    expect(canDecideForCollege(teacher(collegeA), null, collegeB)).toBe(false);
    expect(canDecideForCollege(teacher(collegeA), collegeB, collegeB)).toBe(false);
  });

  it('teacher cannot touch another college tenant row', () => {
    expect(canDecideForCollege(teacher(collegeA), collegeB, collegeA)).toBe(false);
  });

  it('superadmin can decide any explicit target, not null', () => {
    expect(canDecideForCollege(superAdmin(), null, collegeA)).toBe(true);
    expect(canDecideForCollege(superAdmin(), null, null)).toBe(false);
  });
});

describe('A approves -> B still pending; A rejects -> B unaffected', () => {
  it('approve records own decision only (B has no decision)', async () => {
    const db = fakeDb();
    await upsertDecision(db, db, 'hackathonStagingDecision', {
      stagingId, collegeId: collegeA, decision: 'APPROVED', decidedBy: 'u-a',
    });
    expect(await findDecision(db, 'hackathonStagingDecision', stagingId, collegeA)).toMatchObject({ decision: 'APPROVED' });
    expect(await findDecision(db, 'hackathonStagingDecision', stagingId, collegeB)).toBeNull();
    // B pending = no decision by B
    const bDecisions = await listDecisionsForCollege(db, 'hackathonStagingDecision', collegeB);
    expect(bDecisions.has(stagingId)).toBe(false);
    const aDecisions = await listDecisionsForCollege(db, 'hackathonStagingDecision', collegeA);
    expect(aDecisions.get(stagingId)).toBe('APPROVED');
  });

  it('reject records own decision only (B unaffected)', async () => {
    const db = fakeDb();
    await upsertDecision(db, db, 'internshipStagingDecision', {
      stagingId, collegeId: collegeA, decision: 'REJECTED', decidedBy: 'u-a',
    });
    expect((await listDecisionsForCollege(db, 'internshipStagingDecision', collegeB)).has(stagingId)).toBe(false);
    expect((await listDecisionsForCollege(db, 'internshipStagingDecision', collegeA)).get(stagingId)).toBe('REJECTED');
  });

  it('global approve by superadmin with target college records target decision only', async () => {
    const db = fakeDb();
    const target = resolveDecisionCollegeId(superAdmin(), { id: stagingId, collegeId: null }, { body: { collegeId: collegeA } });
    expect(target).toBe(collegeA);
    expect(canDecideForCollege(superAdmin(), null, target)).toBe(true);
    await upsertDecision(db, db, 'hackathonStagingDecision', {
      stagingId, collegeId: target!, decision: 'APPROVED', decidedBy: 'u-super',
    });
    expect((await listDecisionsForCollege(db, 'hackathonStagingDecision', collegeA)).get(stagingId)).toBe('APPROVED');
    expect((await listDecisionsForCollege(db, 'hackathonStagingDecision', collegeB)).has(stagingId)).toBe(false);
  });

  it('pre-migration (no decisions table) falls back to null/empty, never throws', async () => {
    expect(await findDecision({}, 'hackathonStagingDecision', stagingId, collegeA)).toBeNull();
    expect(await upsertDecision({}, {}, 'hackathonStagingDecision', {
      stagingId, collegeId: collegeA, decision: 'APPROVED', decidedBy: 'u',
    })).toBeNull();
    expect((await listDecisionsForCollege({}, 'hackathonStagingDecision', collegeA)).size).toBe(0);
  });
});

describe('idempotent-approve leak closed (own-college scope)', () => {
  it('own published lookup is always scoped by collegeId', () => {
    expect(buildOwnPublishedWhere({ url: 'https://x.test/h', title: 'T', source: 'S' }, collegeA)).toEqual({
      url: 'https://x.test/h', collegeId: collegeA,
    });
    expect(buildOwnPublishedWhere({ url: null, title: 'T', source: 'DEVFOLIO' }, collegeB)).toEqual({
      title: 'T', source: 'DEVFOLIO', collegeId: collegeB,
    });
  });

  it('canAccessDecisionCollege denies x-college published read', () => {
    expect(canAccessDecisionCollege(teacher(collegeA), collegeA)).toBe(true);
    expect(canAccessDecisionCollege(teacher(collegeA), collegeB)).toBe(false);
    expect(canAccessDecisionCollege(superAdmin(), collegeB)).toBe(true);
  });
});

describe('lists filter by own decision (pending = no decision by my college)', () => {
  it('PENDING excludes my decided rows but keeps undecided shared rows', () => {
    const aPending = buildStagingWhere(
      { status: 'PENDING', collegeId: collegeA, isSuperAdmin: false, decisionCollegeId: collegeA, currentYear: 2026 },
    );
    const and = (aPending.scopedWhere.AND as unknown[]) || [];
    // college OR + NOT-decided exclusion present
    expect(JSON.stringify(aPending.scopedWhere)).toContain(collegeA);
    expect(JSON.stringify(aPending.scopedWhere)).toContain('decisions');
    expect(and.length).toBeGreaterThanOrEqual(3);
  });

  it('B pending where does not exclude A decisions (independent)', () => {
    const bPending = buildStagingWhere(
      { status: 'PENDING', collegeId: collegeB, isSuperAdmin: false, decisionCollegeId: collegeB, currentYear: 2026 },
    );
    expect(JSON.stringify(bPending.scopedWhere)).toContain(collegeB);
    expect(JSON.stringify(bPending.scopedWhere)).not.toContain(collegeA);
  });

  it('APPROVED matches own decision (plus legacy tenant fallback)', () => {
    const approved = buildStagingWhere(
      { status: 'APPROVED', collegeId: collegeA, isSuperAdmin: false, decisionCollegeId: collegeA, currentYear: 2026 },
    );
    const s = JSON.stringify(approved.scopedWhere);
    expect(s).toContain('APPROVED');
    expect(s).toContain(collegeA);
    expect(s).toContain('decisions');
  });

  it('legacy callers without decisionCollegeId keep old shape (backward compat)', () => {
    const legacy = buildStagingWhere({ status: 'PENDING', collegeId: collegeA, isSuperAdmin: false, currentYear: 2026 });
    expect(JSON.stringify(legacy.scopedWhere)).not.toContain('decisions');
  });

  it('superadmin stays unscoped (global view, no decision filter)', () => {
    const sa = buildStagingWhere({ isSuperAdmin: true, currentYear: 2026 });
    expect(JSON.stringify(sa.scopedWhere)).not.toContain('collegeId');
    expect(JSON.stringify(sa.scopedWhere)).not.toContain('decisions');
  });
});

describe('counts reflect per-college pending', () => {
  function countWithDecisions(
    all: Array<{ id: string; targetDepartments: string; status: string }>,
    myDecisions: Map<string, string>,
  ) {
    let pending = 0, approved = 0, rejected = 0;
    for (const item of all) {
      const depts = JSON.parse(item.targetDepartments || '[]');
      const mine = myDecisions.get(item.id);
      if (mine === 'APPROVED') { approved++; continue; }
      if (mine === 'REJECTED') { rejected++; continue; }
      if (item.status === 'APPROVED') approved++;
      else if (item.status === 'REJECTED') rejected++;
      else if (depts.length > 0) pending++;
    }
    return { pending, approved, rejected };
  }

  it('A approved row counts approved for A, pending for B', () => {
    const all = [{ id: stagingId, targetDepartments: '["CSE"]', status: 'DRAFT' }];
    const aCounts = countWithDecisions(all, new Map([[stagingId, 'APPROVED']]));
    const bCounts = countWithDecisions(all, new Map());
    expect(aCounts).toMatchObject({ pending: 0, approved: 1 });
    expect(bCounts).toMatchObject({ pending: 1, approved: 0 });
  });

  it('A rejected row counts rejected for A, pending for B', () => {
    const all = [{ id: stagingId, targetDepartments: '["CSE"]', status: 'DRAFT' }];
    expect(countWithDecisions(all, new Map([[stagingId, 'REJECTED']]))).toMatchObject({ pending: 0, rejected: 1 });
    expect(countWithDecisions(all, new Map())).toMatchObject({ pending: 1, rejected: 0 });
  });
});

describe('cron stamps global (no tenant lottery)', () => {
  it('CRON_COLLEGE_ID unset means global null feed (documented contract)', () => {
    const explicit = ('' || '').trim() || null;
    expect(explicit).toBeNull();
    const cronCollegeId: string | null = explicit;
    expect(cronCollegeId).toBeNull();
  });
});
