/**
 * P0-D cron hygiene: shared DB pre-flight + lock keys.
 *
 * WHY: hourly profile sync (up to 60k externals/day) + 12h opportunity fetch
 * (200-600 HTTP + 100 Groq/run) hammered externals even when Postgres was
 * down. contestFetcher already pre-flights (`SELECT 1` via base client, no
 * withRetry spam); profile/opportunity/reminder/cleanup jobs did not.
 * Pre-flight = 1 cheap `SELECT 1` before any external fan-out; when down,
 * skip fast with an explicit `skipped:skipReason` result (observability)
 * instead of 60k failing externals + retry-log spam.
 *
 * Rules: additive/backward-compat, fail-open (pre-flight error that is NOT
 * a connection error returns true so logic errors still surface), no secrets.
 */
import prisma, { isRetryableError, isP1001Error, prismaBase } from '../config/db';
import { logger } from '../utils/logger';

/** Redis lock keys / TTLs for cron serialization (N replicas → 1 run). */
export const OPPORTUNITIES_LOCK_KEY = 'lock:opportunities-job';
/** Opportunities enrich holds the worker ~20min; 30m TTL is the deadlock guard. */
export const OPPORTUNITIES_LOCK_TTL_MS = 30 * 60 * 1000;

/**
 * Quick DB reachability probe WITHOUT withRetry spam.
 * Uses the base client directly so a down DB fails fast with 1 log.
 * Returns true when reachable OR when the error is non-connection
 * (auth/schema — let the caller handle the logic error).
 * Never throws (fail-open to true on unexpected probe failure? No —
 * returns false only on retryable/P1001, true otherwise, never rejects).
 */
export async function isDbReachableQuick(): Promise<boolean> {
  try {
    await (prismaBase as any).$queryRaw`SELECT 1`;
    return true;
  } catch (e: any) {
    try {
      if (isRetryableError(e) || isP1001Error(e)) {
        return false;
      }
    } catch {}
    // Non-retryable (auth, schema) — treat as reachable so the caller
    // surfaces the real logic error instead of a misleading skip.
    return true;
  }
}

/**
 * Shared pre-flight for cron jobs: logs once + returns false when the caller
 * should skip fast (DB down). Fail-open on unexpected errors (returns true).
 */
export async function shouldRunCronJob(job: string): Promise<boolean> {
  try {
    const ok = await isDbReachableQuick();
    if (!ok) {
      try {
        logger.warn(
          `[Cron] ${job}: DB unreachable (pre-flight SELECT 1 failed) — skipping run, will retry on next tick. No externals attempted.`,
        );
      } catch {}
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

/** Re-export prisma for callers that need a typed handle (tests/compat). */
export { prisma };
