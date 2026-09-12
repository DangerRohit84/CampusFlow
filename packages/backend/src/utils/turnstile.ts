/**
 * Turnstile (Cloudflare) verification stub — CAPTCHA/bot defense for auth/register.
 * - Prod with TURNSTILE_SECRET set: verifies via siteverify API (fail-closed).
 * - Dev / no secret: fail-open with warn log (never blocks local dev/tests).
 * Callers pass the client `turnstileToken` (optional during rollout); when absent,
 * dev allows, prod rejects when TURNSTILE_ENFORCE=true, else allows with log.
 */
import { logger } from './logger';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(token: string | undefined | null, remoteIp?: string): Promise<boolean> {
  const secret = (process.env.TURNSTILE_SECRET || '').trim();
  const isProd = process.env.NODE_ENV === 'production';
  const enforce = process.env.TURNSTILE_ENFORCE === 'true' || (isProd && !!secret);

  if (!token) {
    if (enforce) {
      logger.warn('[turnstile] missing token (enforced) — rejecting');
      return false;
    }
    logger.debug('[turnstile] missing token (dev/no-secret) — allowing with log');
    return true;
  }
  if (!secret) {
    if (isProd) {
      logger.warn('[turnstile] no TURNSTILE_SECRET in prod — rejecting (fail-closed)');
      return false;
    }
    logger.debug('[turnstile] no secret (dev) — allowing with log');
    return true;
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const body = new URLSearchParams();
    body.set('secret', secret);
    body.set('response', String(token));
    if (remoteIp) body.set('remoteip', String(remoteIp));
    const resp = await fetch(VERIFY_URL, { method: 'POST', body, signal: ctrl.signal });
    clearTimeout(t);
    const data = (await resp.json()) as any;
    if (data?.success === true) return true;
    logger.warn({ codes: data?.['error-codes'] }, '[turnstile] verification failed');
    return false;
  } catch (e: any) {
    // Offline-safe: fail-open in dev (log), fail-closed in prod when enforced.
    if (isProd && enforce) {
      logger.warn({ err: String(e?.message || e).slice(0, 200) }, '[turnstile] verify error (prod, fail-closed)');
      return false;
    }
    logger.debug({ err: String(e?.message || e).slice(0, 200) }, '[turnstile] verify error (dev, fail-open)');
    return true;
  }
}
