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
 * Storage is in-memory (single-instance) + persistent AiUsage/AiQuota rows.
 * For multi-replica Render, replace the Maps with Redis (INCR + EXPIRE per
 * day bucket) — same key scheme:
 *   ai:quota:user:{userId}:{yyyy-mm-dd} / ai:quota:college:{collegeId}:{yyyy-mm-dd}
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
  try {
    const u: any = await prisma.user.findUnique({ where: { id: userId }, select: { collegeId: true } });
    return u?.collegeId || 'no-college';
  } catch {
    return 'unknown';
  }
}

/** Call from catch blocks when upstream AI throws — opens breaker on 429. */
export function noteAiUpstreamError(feature: string, err: unknown): void {
  try {
    if (isAiRateLimitError(err)) {
      breakerOpenUntil.set(feature, Date.now() + 60_000);
      logger.warn({ feature }, '[aiQuota] upstream 429 — breaker open 60s');
    }
  } catch {}
}

export function aiQuota(feature: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    // Breaker fail-fast (429 + Retry-After) — prevents retry storms during Groq TPM exhaustion.
    const openUntil = breakerOpenUntil.get(feature) || 0;
    if (Date.now() < openUntil) {
      const retryAfter = Math.max(1, Math.ceil((openUntil - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: 'AI rate limit reached, try again shortly', retryAfter, feature });
      return;
    }

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

    // Per-user 100/day
    const uKey = `${userId}:${day}`;
    const u = userCounts.get(uKey);
    const uCount = !u || u.day !== day ? 0 : u.count;
    if (uCount >= AI_USER_DAILY_LIMIT) {
      res.status(429).json({ error: 'Daily AI quota exceeded (100/day). Try again tomorrow.', feature });
      return;
    }

    // Per-college 10k tokens/day (estimated) — in-memory fast path.
    const collegeId = await resolveCollegeId(req.userId);
    const cKey = `${collegeId}:${day}`;
    const c = collegeTokens.get(cKey);
    const cTokens = !c || c.day !== day ? 0 : c.tokens;
    const reqTokens = estimateTokens(input);
    if (cTokens + reqTokens > AI_COLLEGE_DAILY_TOKENS) {
      res.status(429).json({ error: 'College AI token budget exhausted for today (10k tokens/day).', feature });
      return;
    }

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
    userCounts.set(uKey, { day, count: uCount + 1 });
    collegeTokens.set(cKey, { day, tokens: cTokens + reqTokens });
    (req as any).aiQuota = { feature, collegeId, reqTokens, userCount: uCount + 1, collegeTokens: cTokens + reqTokens };

    // #11 persistent metering (best-effort, never blocks the response).
    void recordAiUsage({ collegeId, feature, tokens: reqTokens }).catch(() => {});

    res.on('finish', () => {
      try {
        logger.info(
          { userId, collegeId, feature, reqTokens, status: res.statusCode, userCount: uCount + 1 },
          '[aiSpend]',
        );
      } catch {}
    });

    next();
  };
}
