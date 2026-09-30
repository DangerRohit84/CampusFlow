// services/contestBroadcastService.ts — contest broadcast Light+Both (Approach A).
// WHY: global per-contest fan-out (pre_60m/pre_15m/started/post_30m, NO 24h)
// must live in ONE pure testable place; routes stay thin, cron reuses it.
// Pure fns (no DB/socket) so vitest covers window math, prefs, scoping,
// copy without Neon. DB/socket only enter via runContestBroadcastsJob deps.
// PROD-SAFE: kill-switch CONTEST_BROADCAST_ENABLED (default OFF), fail-open,
// poison guard, max 100 phases/tick, Notification.source dedup (NO migration),
// User.preferences JSON (mutedContests + broadcastsOff, room-mute pattern).

export type BroadcastPhase = 'pre_60m' | 'pre_15m' | 'started' | 'post_30m';

export const MAX_BROADCAST_PHASES_PER_TICK = 100;
export const BROADCAST_USER_PAGE_SIZE = 500; // matches NOTIFY_CHUNK_SIZE
export const MAX_MUTED_CONTESTS = 200;

export const MUTED_CONTESTS_KEY = 'mutedContests';
export const BROADCASTS_OFF_KEY = 'broadcastsOff';

export interface BroadcastContestLike {
  id: string;
  title: string;
  platform?: string | null;
  url?: string | null;
  startTime: string | Date;
  duration?: number | null;
  collegeId?: string | null;
}

export interface BroadcastUserLike {
  id: string;
  collegeId?: string | null;
  role?: string;
  preferences?: unknown;
}

// Tolerances (cron 5m prod / 1m dev): fireAt <= now <= fireAt + tolerance.
// pre_60m/pre_15m/post_30m: 10m (covers 1 missed 5m tick). started: 5m (spec).
const TOL_PRE_MS = 10 * 60_000;
const TOL_STARTED_MS = 5 * 60_000;
const TOL_POST_MS = 10 * 60_000;

function toDate(v: string | Date): Date | null {
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** Kill-switch: ONLY 'true' enables. Default OFF (no spam until rollout). */
export function isBroadcastEnabled(env: NodeJS.ProcessEnv | Record<string, unknown> = process.env): boolean {
  const v = (env as Record<string, unknown>)?.CONTEST_BROADCAST_ENABLED;
  return v === 'true' || v === true;
}

/**
 * Phases due at `now` for one contest (Light: NO 24h).
 * - pre_60m: [start-60m, start-60m+10m)
 * - pre_15m: [start-15m, start-15m+10m)
 * - started: [start, start+5m]
 * - post_30m: [start+30m, start+30m+10m)
 * Invalid startTime → [] (poison guard, never throws).
 */
export function getDueBroadcastPhases(
  contest: BroadcastContestLike,
  now: Date = new Date(),
): BroadcastPhase[] {
  const start = toDate(contest.startTime);
  if (!start) return [];
  const t = start.getTime();
  const n = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(n)) return [];
  const out: BroadcastPhase[] = [];
  const fire60 = t - 60 * 60_000;
  const fire15 = t - 15 * 60_000;
  const firePost = t + 30 * 60_000;
  if (n >= fire60 && n <= fire60 + TOL_PRE_MS) out.push('pre_60m');
  if (n >= fire15 && n <= fire15 + TOL_PRE_MS) out.push('pre_15m');
  if (n >= t && n <= t + TOL_STARTED_MS) out.push('started');
  if (n >= firePost && n <= firePost + TOL_POST_MS) out.push('post_30m');
  return out;
}

/** Parse User.preferences Json|String safely (default ON = {} → not opted out). */
export function parseContestPrefs(raw: unknown): { mutedContests: string[]; broadcastsOff: boolean } {
  let prefs: Record<string, unknown> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    prefs = raw as Record<string, unknown>;
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      const v: unknown = JSON.parse(raw);
      if (v && typeof v === 'object' && !Array.isArray(v)) prefs = v as Record<string, unknown>;
    } catch {
      prefs = {};
    }
  }
  const list = (prefs as Record<string, unknown>)[MUTED_CONTESTS_KEY];
  const seen = new Set<string>();
  if (Array.isArray(list)) {
    for (const v of list) {
      if (typeof v === 'string' && v) seen.add(v);
      if (seen.size >= MAX_MUTED_CONTESTS) break;
    }
  }
  return {
    mutedContests: [...seen],
    broadcastsOff: (prefs as Record<string, unknown>)[BROADCASTS_OFF_KEY] === true,
  };
}

/** Opt-out Both: global OFF or per-contest OFF (default ON). Never throws. */
export function isBroadcastOptedOut(raw: unknown, contestId: string): boolean {
  try {
    const p = parseContestPrefs(raw);
    if (p.broadcastsOff) return true;
    return p.mutedContests.includes(contestId);
  } catch {
    return false;
  }
}

function prefsObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...(raw as Record<string, unknown>) };
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const v: unknown = JSON.parse(raw);
      if (v && typeof v === 'object' && !Array.isArray(v)) return { ...(v as Record<string, unknown>) };
    } catch { /* fall through */ }
  }
  return {};
}

/** New preferences JSON with contestId muted/unmuted (other keys preserved). */
export function setContestMuted(raw: unknown, contestId: string, muted: boolean): string {
  const prefs = prefsObject(raw);
  const current = parseContestPrefs(raw).mutedContests;
  const next = muted
    ? [contestId, ...current.filter((id) => id !== contestId)].slice(0, MAX_MUTED_CONTESTS)
    : current.filter((id) => id !== contestId);
  return JSON.stringify({ ...prefs, [MUTED_CONTESTS_KEY]: next });
}

/** New preferences JSON with global broadcastsOff flipped (other keys preserved). */
export function setBroadcastsOff(raw: unknown, off: boolean): string {
  const prefs = prefsObject(raw);
  return JSON.stringify({ ...prefs, [BROADCASTS_OFF_KEY]: off === true });
}

function leadLabel(phase: BroadcastPhase): string {
  if (phase === 'pre_60m') return '1 hour(s)';
  if (phase === 'pre_15m') return '15 minute(s)';
  return '';
}

/** Copy: pre reminder / started "Live now" / post "Still open - join". */
export function buildBroadcastNotification(
  contest: BroadcastContestLike,
  phase: BroadcastPhase,
): { title: string; message: string; type: string; priority: string; source: string } {
  const platform = contest.platform || 'Contest';
  const url = contest.url || '';
  if (phase === 'started') {
    return {
      title: `Live now: ${contest.title}`,
      message: `${platform} — "${contest.title}" has started. Join now. ${url}`.trim(),
      type: 'CONTEST_BROADCAST',
      priority: 'HIGH',
      source: broadcastSource(contest.id, phase, contest.collegeId ?? 'global'),
    };
  }
  if (phase === 'post_30m') {
    return {
      title: `Still open - join: ${contest.title}`,
      message: `${platform} — "${contest.title}" is still open. Join before it ends. ${url}`.trim(),
      type: 'CONTEST_BROADCAST',
      priority: 'MEDIUM',
      source: broadcastSource(contest.id, phase, contest.collegeId ?? 'global'),
    };
  }
  const lead = leadLabel(phase);
  return {
    title: `Contest in ${lead}: ${contest.title}`,
    message: `${platform} — "${contest.title}" starts in ${lead}. ${url}`.trim(),
    type: 'CONTEST_BROADCAST',
    priority: 'HIGH',
    source: broadcastSource(contest.id, phase, contest.collegeId ?? 'global'),
  };
}

/**
 * Dedup source key per (contest, phase, college). NO migration: rows in
 * Notification carry this source; existence check skips re-send.
 * collegeKey = collegeId ?? 'global' (global contests dedup once).
 */
export function broadcastSource(contestId: string, phase: BroadcastPhase, collegeKey: string): string {
  const col = collegeKey && collegeKey.trim() ? collegeKey.trim() : 'global';
  return `contest-broadcast:${contestId}:${phase}:${col}`;
}

/**
 * College fan-out keys for one contest.
 * - scoped (collegeId=X) → ['X'] (strict college-scope + SUPER_ADMIN once via audience query).
 * - global (null) → ['global'] (caller pages per-college users, SUPER_ADMIN once).
 */
export function resolveBroadcastCollegeKeys(contest: BroadcastContestLike): string[] {
  if (contest.collegeId && String(contest.collegeId).trim()) return [String(contest.collegeId)];
  return ['global'];
}

/** Filter user rows to notifiable ids (opt-out honored). Pure, never throws. */
export function filterBroadcastRecipients(users: BroadcastUserLike[], contestId: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of users) {
    if (!u || !u.id || seen.has(u.id)) continue;
    if (isBroadcastOptedOut((u as BroadcastUserLike).preferences, contestId)) continue;
    seen.add(u.id);
    out.push(u.id);
  }
  return out;
}

// ---- Job runner (cron + tests share this; Prisma/socket injected) ----

export interface BroadcastJobDeps {
  now?: Date;
  env?: NodeJS.ProcessEnv | Record<string, unknown>;
  /** Contests in the broadcast window (caller bounds query; job caps 100 phases). */
  listContests?: (now: Date) => Promise<BroadcastContestLike[]>;
  /** Paged users for one collegeKey ('global' = all colleges batched by caller). */
  listUsersForCollege?: (collegeKey: string) => Promise<BroadcastUserLike[]>;
  /** Dedup: true when source already broadcast (Notification.source check). */
  hasBroadcast?: (source: string) => Promise<boolean>;
  markBroadcast?: (source: string) => Promise<void>;
  /** Fan-out (caller wraps notifyUsers chunked + online-guard). */
  notify?: (userIds: string[], n: { title: string; message: string; type: string; priority: string; source: string }) => Promise<unknown>;
}

// Process-local fallback dedup (single-replica best-effort; DB check is canonical).
const sentSources = new Set<string>();
export function __clearBroadcastDedupForTests(): void {
  sentSources.clear();
}

export async function runContestBroadcastsJob(deps: BroadcastJobDeps = {}): Promise<{
  checked: number;
  sent: number;
  skipped: number;
  failed: number;
}> {
  const env = deps.env ?? process.env;
  if (!isBroadcastEnabled(env)) return { checked: 0, sent: 0, skipped: 0, failed: 0 };
  const now = deps.now ?? new Date();
  let listContests = deps.listContests;
  let listUsersForCollege = deps.listUsersForCollege;
  let hasBroadcast = deps.hasBroadcast;
  let markBroadcast = deps.markBroadcast;
  let notify = deps.notify;
  if (!listContests || !listUsersForCollege || !hasBroadcast || !markBroadcast || !notify) {
    const [{ default: prisma }, { notifyUsers }] = await Promise.all([
      import('../config/db'),
      import('./notificationService'),
    ]);
    const { logger } = await import('../utils/logger');
    listContests =
      listContests ??
      (async (at: Date) => {
        // Window-bounded preload: contests whose start is within
        // [at-40m, at+65m] cover all 4 phases + tolerances in ONE query.
        // take:100 bounds prod fan-out (job caps 100 phases below anyway).
        const lo = new Date(at.getTime() - 40 * 60_000);
        const hi = new Date(at.getTime() + 65 * 60_000);
        try {
          const rows = await prisma.codingContest.findMany({
            where: {
              OR: [
                { startAt: { gte: lo, lte: hi } },
                { startTime: { gte: lo.toISOString(), lte: hi.toISOString() } },
              ],
            },
            select: { id: true, title: true, platform: true, url: true, startTime: true, duration: true, collegeId: true },
            orderBy: { startAt: 'asc' },
            take: 100,
          });
          return rows as unknown as BroadcastContestLike[];
        } catch {
          // startAt may be missing pre-migration → fall back to String range.
          const rows = await prisma.codingContest.findMany({
            where: { startTime: { gte: lo.toISOString(), lte: hi.toISOString() } },
            select: { id: true, title: true, platform: true, url: true, startTime: true, duration: true, collegeId: true },
            take: 100,
          });
          return rows as unknown as BroadcastContestLike[];
        }
      });
    listUsersForCollege =
      listUsersForCollege ??
      (async (collegeKey: string) => {
        // College-size paging: 500/page (NOTIFY_CHUNK_SIZE) × up to 20 pages
        // (10k users/college cap). SUPER_ADMIN included once for scoped
        // contests; for 'global' the caller iterates colleges and SUPER_ADMIN
        // is fetched once (see global branch below).
        const PAGE = BROADCAST_USER_PAGE_SIZE;
        const MAX_PAGES = 20;
        const all: BroadcastUserLike[] = [];
        const seenSu = new Set<string>();
        for (let page = 0; page < MAX_PAGES; page++) {
          let rows: Array<{ id: string; preferences: unknown }> = [];
          try {
            if (collegeKey === 'global') {
              rows = (await prisma.user.findMany({
                where: { role: { in: ['STUDENT', 'TEACHER', 'COLLEGE_ADMIN'] } },
                select: { id: true, preferences: true },
                orderBy: { id: 'asc' },
                skip: page * PAGE,
                take: PAGE,
              })) as Array<{ id: string; preferences: unknown }>;
              // SUPER_ADMIN once: only on first page.
              if (page === 0) {
                try {
                  const sus = (await prisma.user.findMany({
                    where: { role: 'SUPER_ADMIN' },
                    select: { id: true, preferences: true },
                    take: 100,
                  })) as Array<{ id: string; preferences: unknown }>;
                  for (const s of sus) {
                    if (!seenSu.has(s.id)) {
                      seenSu.add(s.id);
                      all.push({ id: s.id, role: 'SUPER_ADMIN', preferences: s.preferences });
                    }
                  }
                } catch { /* fail-open: skip SU */ }
              }
            } else {
              rows = (await prisma.user.findMany({
                where: {
                  OR: [
                    { collegeId: collegeKey, role: { in: ['STUDENT', 'TEACHER', 'COLLEGE_ADMIN'] } },
                    { role: 'SUPER_ADMIN' },
                  ],
                },
                select: { id: true, preferences: true, role: true, collegeId: true },
                orderBy: { id: 'asc' },
                skip: page * PAGE,
                take: PAGE,
              })) as Array<{ id: string; preferences: unknown }>;
            }
          } catch {
            break; // fail-open: keep what we have
          }
          if (rows.length === 0) break;
          for (const r of rows) {
            if (collegeKey !== 'global' && (r as { role?: string }).role === 'SUPER_ADMIN') {
              if (seenSu.has(r.id)) continue;
              seenSu.add(r.id);
            }
            all.push({ id: r.id, preferences: r.preferences });
          }
          if (rows.length < PAGE) break;
        }
        return all;
      });
    hasBroadcast =
      hasBroadcast ??
      (async (source: string) => {
        if (sentSources.has(source)) return true;
        try {
          const hit = await prisma.notification.findFirst({ where: { source }, select: { id: true } });
          return !!hit;
        } catch {
          return sentSources.has(source);
        }
      });
    markBroadcast =
      markBroadcast ??
      (async (source: string) => {
        sentSources.add(source);
      });
    notify =
      notify ??
      (async (userIds: string[], n) => {
        try {
          await notifyUsers(userIds, n);
        } catch (err) {
          logger.debug({ err }, '[contest-broadcast] notify failed (fail-open, poison guard marks skip)');
          throw err;
        }
      });
  }
  let contests: BroadcastContestLike[] = [];
  try {
    contests = await listContests!(now);
  } catch {
    return { checked: 0, sent: 0, skipped: 0, failed: 0 }; // fail-open
  }
  let checked = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  // Global SUPER_ADMIN-once guard across colleges in one tick.
  const superAdminDone = new Set<string>();
  for (const contest of contests) {
    let phases: BroadcastPhase[] = [];
    try {
      phases = getDueBroadcastPhases(contest, now);
    } catch {
      failed++;
      continue; // poison guard: bad row never blocks the tick
    }
    if (phases.length === 0) continue;
    const collegeKeys = resolveBroadcastCollegeKeys(contest);
    for (const collegeKey of collegeKeys) {
      for (const phase of phases) {
        if (checked >= MAX_BROADCAST_PHASES_PER_TICK) {
          return { checked, sent, skipped, failed }; // cap, fail-open
        }
        checked++;
        const source = broadcastSource(contest.id, phase, collegeKey);
        try {
          if (sentSources.has(source)) {
            skipped++;
            continue;
          }
          if (await hasBroadcast!(source)) {
            sentSources.add(source);
            skipped++;
            continue;
          }
          let users: BroadcastUserLike[] = [];
          try {
            users = await listUsersForCollege!(collegeKey);
          } catch {
            failed++;
            continue; // poison guard: college fetch failure skips phase, tick continues
          }
          // SUPER_ADMIN once across global fan-out pages in one tick.
          const filtered = filterBroadcastRecipients(users, contest.id).filter((id) => {
            const isSu = (users.find((u) => u.id === id) as BroadcastUserLike | undefined)?.role === 'SUPER_ADMIN';
            if (!isSu) return true;
            if (superAdminDone.has(id)) return false;
            superAdminDone.add(id);
            return true;
          });
          if (filtered.length === 0) {
            // Nobody to notify (all opted out) — still mark to avoid re-scan.
            try {
              await markBroadcast!(source);
            } catch { /* ignore */ }
            sentSources.add(source);
            skipped++;
            continue;
          }
          const n = buildBroadcastNotification({ ...contest, collegeId: collegeKey === 'global' ? null : collegeKey }, phase);
          // Canonical source must match the dedup key used above.
          const canonical = { ...n, source };
          await notify!(filtered, canonical);
          try {
            await markBroadcast!(source);
          } catch { /* ignore */ }
          sentSources.add(source);
          sent++;
        } catch {
          failed++; // poison guard: one bad phase never kills the tick
        }
      }
    }
  }
  return { checked, sent, skipped, failed };
}
