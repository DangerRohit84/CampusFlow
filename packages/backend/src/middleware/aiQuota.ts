/**
 * AI quota middleware — cost + abuse guard for 10k traffic.
 *
 * Enforces:
 *  - per-user 100 requests/day
 *  - per-college 10k tokens/day (estimated chars/4) via in-memory fast path
 *  - per-college persistent caps via AiQuota/AiUsage (#11): daily tokens,
 *    monthly tokens, lifetime cost — 429 with a clear budget message when hit
 *  - max 8000 input chars per request (413 when exceeded)
 *  - spend log (userId, collegeId, feature, tokens) via logger
 *  - persistent usage write (AiUsage, best-effort, never blocks the response)
 *  - 429 circuit breaker: when upstream Groq returns 429, open breaker 60s
 *    and fail fast with 429 + Retry-After (prevents retry storms).
 *
 * Storage (Track D, 10k multi-instance):
 *  - Redis primary when REDIS_URL is set (INCR/INCRBY + EXPIRE per day
 *    bucket, shared across N replicas — no N× over-admit):
 *      ai:quota:user:{userId}:{yyyy-mm-dd} / ai:quota:college:{collegeId}:{yyyy-mm-dd}
 *      ai:breaker:{feature} (PX 60s, owner-only by TTL)
 *  - In-memory Maps as L1 fast-path + fallback when Redis is unset/blipping
 *    (identical single-instance behavior; multi-instance degraded to N×
 *    until REDIS_URL, fail-open never 500s).
 *  - Persistent AiUsage/AiQuota rows remain authoritative for cost caps.
 * Pre-migration (AiQuota/AiUsage absent) the persistent layer falls back to
 * allow + in-memory only (non-fatal, see services/aiMetering.ts).
 * Rollback: remove `aiQuota(...)` from routes (generalLimiter remains).
 */
import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import prisma from '../config/db';
import { logger } from '../utils/logger';
import { isAiRateLimitError } from '../ai/client';
import { checkCollegeCap, recordAiUsage } from '../services/aiMetering';
import { getRedisClient, redisGet, redisIncr, redisIncrBy, redisPttl, redisSet } from '../lib/redis';

export const AI_USER_DAILY_LIMIT = 100;
export const AI_COLLEGE_DAILY_TOKENS = 10_000;
export const AI_MAX_INPUT_CHARS = 8000;

function dayBucket(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

const userCounts = new Map<string, { day: string; count: number }>();
const collegeTokens = new Map<string, { day: string; tokens: number }>();
// feature -> breaker open until epoch ms
const breakerOpenUntil = new Map<string, number>();

// Unbounded-store fix: quota Maps are keyed by (actor × day) and grow with
// user count. Bound + prune so 10k users cannot grow them without limit.
// Day-bucketed entries expire lazily (day mismatch resets) and are evicted
// oldest-first past the caps; breaker entries expire by timestamp.
const MAX_QUOTA_KEYS = 5000;
const MAX_BREAKER_KEYS = 500;
// College-id cache: drops the extra user.findUnique per AI request (hot path).
// authorize() already caches role+college 60s in Redis+L1; this mirrors that
// TTL locally so repeated AI calls from one user hit memory, not Postgres.
const COLLEGE_CACHE_TTL_MS = 60_000;
const MAX_COLLEGE_CACHE_KEYS = 2000;
const collegeIdCache = new Map<string, { collegeId: string; expiresAt: number }>();

function pruneQuotaMap(map: Map<string, { day: string; count?: number; tokens?: number }>, day: string): void {
  if (map.size < MAX_QUOTA_KEYS) return;
  for (const [k, v] of map) {
    if (map.size < MAX_QUOTA_KEYS) break;
    if (v.day !== day) map.delete(k);
  }
  while (map.size >= MAX_QUOTA_KEYS) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

function pruneBreaker(now = Date.now()): void {
  if (breakerOpenUntil.size < MAX_BREAKER_KEYS) {
    for (const [k, exp] of breakerOpenUntil) {
      if (exp <= now) breakerOpenUntil.delete(k);
    }
    return;
  }
  for (const [k, exp] of breakerOpenUntil) {
    if (breakerOpenUntil.size < MAX_BREAKER_KEYS) break;
    if (exp <= now) breakerOpenUntil.delete(k);
  }
  while (breakerOpenUntil.size >= MAX_BREAKER_KEYS) {
    const oldest = breakerOpenUntil.keys().next();
    if (oldest.done) break;
    breakerOpenUntil.delete(oldest.value);
  }
}

/** Test-only: clear quota/breaker/college caches (isolates hermetic tests). */
export function clearAiQuotaForTests(): void {
  userCounts.clear();
  collegeTokens.clear();
  breakerOpenUntil.clear();
  collegeIdCache.clear();
  // Redis keys are day-bucketed globals — tests using FakeRedis must also
  // call __resetRedisForTests() (clears the shared FakeRedis store).
  // Best-effort: nothing to del without key enumeration (never KEYS in prod).
}

/** Redis key builders (shared across replicas, per-day buckets). */
export function aiUserQuotaKey(userId: string, day: string): string {
  return `ai:quota:user:${userId}:${day}`;
}
export function aiCollegeQuotaKey(collegeId: string, day: string): string {
  return `ai:quota:college:${collegeId}:${day}`;
}
export function aiBreakerKey(feature: string): string {
  return `ai:breaker:${feature}`;
}

/** ms until next UTC midnight + 1h buffer (day-bucket TTL, covers skew). */
function ttlUntilNextDayMs(nowMs = Date.now()): number {
  try {
    const now = new Date(nowMs);
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    return Math.max(60_000, midnight - nowMs + 3_600_000);
  } catch {
    return 25 * 3_600_000;
  }
}

function parseRedisCount(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : null;
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function extractInputText(body: any): string {
  if (!body || typeof body !== 'object') return '';
  const parts: string[] = [];
  for (const k of ['content', 'prompt', 'rawText', 'text', 'jobDescription', 'job_description']) {
    const v = (body as any)[k];
    if (typeof v === 'string' && v) parts.push(v);
  }
  // ResumeData / subjects shapes
  try {
    if (Array.isArray((body as any).subjects)) parts.push((body as any).subjects.join(' '));
    if ((body as any).data) parts.push(JSON.stringify((body as any).data).slice(0, 8000));
  } catch {}
  return parts.join('\n');
}

async function resolveCollegeId(userId: string | undefined): Promise<string> {
  if (!userId) return 'anon';
  const cached = collegeIdCache.get(userId);
  if (cached && Date.now() < cached.expiresAt) return cached.collegeId;
  try {
    const u: { collegeId?: string | null } | null = await prisma.user.findUnique({ where: { id: userId }, select: { collegeId: true } });
    const cid = u?.collegeId || 'no-college';
    if (collegeIdCache.size >= MAX_COLLEGE_CACHE_KEYS) {
      const oldest = collegeIdCache.keys().next();
      if (!oldest.done) collegeIdCache.delete(oldest.value);
    }
    collegeIdCache.set(userId, { collegeId: cid, expiresAt: Date.now() + COLLEGE_CACHE_TTL_MS });
    return cid;
  } catch {
    return 'unknown';
  }
}

/** Call from catch blocks when upstream AI throws — opens breaker on 429. */
export function noteAiUpstreamError(feature: string, err: unknown): void {
  try {
    if (isAiRateLimitError(err)) {
      pruneBreaker();
      breakerOpenUntil.set(feature, Date.now() + 60_000);
      logger.warn({ feature }, '[aiQuota] upstream 429 — breaker open 60s');
      // Share breaker globally (best-effort, fail-open on Redis blip).
      try {
        if (getRedisClient()) void redisSet(aiBreakerKey(feature), '1', 60_000).catch(() => {});
      } catch {}
    }
  } catch {}
}

async function isBreakerOpenShared(feature: string): Promise<{ open: boolean; retryAfter: number }> {
  const memUntil = breakerOpenUntil.get(feature) || 0;
  if (Date.now() < memUntil) {
    return { open: true, retryAfter: Math.max(1, Math.ceil((memUntil - Date.now()) / 1000)) };
  }
  try {
    if (getRedisClient()) {
      const hit = await redisGet<string | number>(aiBreakerKey(feature));
      if (hit !== null && hit !== undefined) {
        const pttl = await redisPttl(aiBreakerKey(feature));
        const retryAfter = typeof pttl === 'number' && pttl > 0 ? Math.max(1, Math.ceil(pttl / 1000)) : 60;
        // Keep L1 in sync so next check is local (best-effort).
        breakerOpenUntil.set(feature, Date.now() + retryAfter * 1000);
        return { open: true, retryAfter };
      }
    }
  } catch {}
  return { open: false, retryAfter: 0 };
}

export function aiQuota(feature: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    // P1-5 global kill-switch: AI_KILL_SWITCH=true → 503 + heuristic fallback
    // (fail-open for the product: enrich keeps deterministic page-deadline
    // updates, chat surfaces a clean message). Breaker + quotas below are
    // preserved when the switch is OFF (default). Never throws.
    try {
      const kill = String(process.env.AI_KILL_SWITCH || '').trim().toLowerCase() === 'true'
      if (kill) {
        try {
          logger.debug({ feature }, '[aiQuota] AI_KILL_SWITCH=on — failing fast 503 (no quota consumed)')
        } catch {}
        res.status(503).json({ error: 'AI temporarily disabled. Please try again later.', feature, code: 'AI_KILL_SWITCH' })
        return
      }
    } catch {}
    // Breaker fail-fast (429 + Retry-After) — shared across replicas via
    // Redis (L1 memory fast-path, L2 shared). Prevents retry storms during
    // Groq TPM exhaustion.
    try {
      const shared = await isBreakerOpenShared(feature);
      if (shared.open) {
        res.setHeader('Retry-After', String(shared.retryAfter));
        res.status(429).json({ error: 'AI rate limit reached, try again shortly', retryAfter: shared.retryAfter, feature });
        return;
      }
    } catch {}

    const input = extractInputText(req.body);
    if (input.length > AI_MAX_INPUT_CHARS) {
      res.status(413).json({
        error: `AI input too large (max ${AI_MAX_INPUT_CHARS} chars, got ${input.length})`,
        max: AI_MAX_INPUT_CHARS,
      });
      return;
    }

    const userId = req.userId || 'anon';
    const day = dayBucket();

    // Per-user 100/day — L1 memory + L2 Redis (shared budget, no N×).
    const uKey = `${userId}:${day}`;
    const u = userCounts.get(uKey);
    const uCountMem = !u || u.day !== day ? 0 : u.count;
    if (uCountMem >= AI_USER_DAILY_LIMIT) {
      res.status(429).json({ error: 'Daily AI quota exceeded (100/day). Try again tomorrow.', feature });
      return;
    }
    try {
      if (getRedisClient()) {
        const sharedU = parseRedisCount(await redisGet<number | string>(aiUserQuotaKey(userId, day)));
        if (sharedU !== null && sharedU >= AI_USER_DAILY_LIMIT) {
          res.status(429).json({ error: 'Daily AI quota exceeded (100/day). Try again tomorrow.', feature });
          return;
        }
      }
    } catch {}

    // Per-college 10k tokens/day (estimated) — L1 memory + L2 Redis.
    const collegeId = await resolveCollegeId(req.userId);
    const cKey = `${collegeId}:${day}`;
    const c = collegeTokens.get(cKey);
    const cTokensMem = !c || c.day !== day ? 0 : c.tokens;
    const reqTokens = estimateTokens(input);
    if (cTokensMem + reqTokens > AI_COLLEGE_DAILY_TOKENS) {
      res.status(429).json({ error: 'College AI token budget exhausted for today (10k tokens/day).', feature });
      return;
    }
    try {
      if (getRedisClient()) {
        const sharedC = parseRedisCount(await redisGet<number | string>(aiCollegeQuotaKey(collegeId, day)));
        if (sharedC !== null && sharedC + reqTokens > AI_COLLEGE_DAILY_TOKENS) {
          res.status(429).json({ error: 'College AI token budget exhausted for today (10k tokens/day).', feature });
          return;
        }
      }
    } catch {}

    // #11 persistent cost caps (AiQuota/AiUsage) — authoritative when present,
    // fallback-allow pre-migration. Distinct message so the AiManager UI can
    // explain "over cap" vs the legacy in-memory budget above.
    try {
      const cap = await checkCollegeCap(collegeId, reqTokens);
      if (!cap.allowed) {
        res.status(429).json({ error: cap.reason || 'College AI budget exhausted.', feature, code: 'AI_BUDGET_EXHAUSTED' });
        return;
      }
    } catch {
      // Fallback-allow (aiMetering already logs at debug, never throws).
    }

    // Reserve quota pre-flight; spend log on finish (actual tokens unknown until
    // provider responds — estimate is the accounting unit, consistent for all paths).
    // Write-through: L1 memory (fast) + L2 Redis (shared). Redis failures
    // fail open (memory already reserved, never 500s).
    pruneQuotaMap(userCounts, day);
    pruneQuotaMap(collegeTokens, day);
    const nextU = uCountMem + 1;
    const nextC = cTokensMem + reqTokens;
    userCounts.set(uKey, { day, count: nextU });
    collegeTokens.set(cKey, { day, tokens: nextC });
    try {
      if (getRedisClient()) {
        const ttl = ttlUntilNextDayMs();
        void redisIncr(aiUserQuotaKey(userId, day), ttl).catch(() => {});
        if (reqTokens > 0) void redisIncrBy(aiCollegeQuotaKey(collegeId, day), reqTokens, ttl).catch(() => {});
      }
    } catch {}
    (req as any).aiQuota = { feature, collegeId, reqTokens, userCount: nextU, collegeTokens: nextC };

    // #11 persistent metering (best-effort, never blocks the response).
    void recordAiUsage({ collegeId, feature, tokens: reqTokens }).catch(() => {});

    res.on('finish', () => {
      try {
        logger.info(
          { userId, collegeId, feature, reqTokens, status: res.statusCode, userCount: nextU },
          '[aiSpend]',
        );
      } catch {}
    });

    next();
  };
}
