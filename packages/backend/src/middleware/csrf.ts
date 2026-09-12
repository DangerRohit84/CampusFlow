import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { logger } from '../utils/logger';

/**
 * CSRF double-submit (cf_csrf cookie + X-CSRF-Token header).
 * - Skips safe methods (GET/HEAD/OPTIONS).
 * - Skips Bearer-authed requests (Authorization header present — not auto-sent by browser).
 * - Enforces when cookie auth (campusflow_token) is used without Bearer: requires
 *   X-CSRF-Token === cf_csrf cookie value. Missing/mismatch => 403.
 * Dual support: existing Bearer clients unaffected; cookie-only web gets CSRF defense.
 */
function getCookie(req: AuthRequest, name: string): string | undefined {
  try {
    const raw = (req.headers as any).cookie as string | undefined;
    if (raw) {
      const m = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
      if (m?.[1]) return decodeURIComponent(m[1].trim());
    }
    const parsed = (req as any).cookies?.[name] as string | undefined;
    if (parsed) return String(parsed);
  } catch {}
  return undefined;
}

export function requireCsrf(req: AuthRequest, res: Response, next: NextFunction): void {
  const method = String(req.method || 'GET').toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    next();
    return;
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    next();
    return;
  }
  const cookieToken = getCookie(req, 'cf_csrf');
  const headerToken = (req.headers['x-csrf-token'] as string | undefined) || (req.headers['x-csrfToken'] as string | undefined);
  if (!cookieToken || !headerToken || cookieToken !== String(headerToken)) {
    logger.warn({ requestId: (req as any).requestId, route: `${method} ${req.path}` }, 'CSRF check failed');
    res.status(403).json({ error: 'CSRF token missing or invalid' });
    return;
  }
  next();
}
