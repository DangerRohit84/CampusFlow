/**
 * Auth hardening — lockout + jti revocation + breach-check + refresh/CSRF.
 *
 * Single-instance limit (documented): `attempts` Map + `revokedJtis` Set are
 * process-local. Correct on single Render instance; on multi-replica, revoked
 * jtis resurrect after restart/rotate. Persistent store exists as Prisma models
 * RevokedToken/LoginAttempt (schema.prisma, migration
 * 20260912000000_auth_revocation) — see persistRevocationAttempt()
 * best-effort writer below (P2021/P2022-tolerant, warn-once, never breaks
 * auth). Until Redis rollout lands, DO NOT claim multi-instance safety.
 * TODO(persist): read-through RevokedToken on isJtiRevoked — async helper
 * isJtiRevokedWithDb() below is ready; middleware stays sync (memory) until
 * callers go async + hourly prune lands (see jobs/cron.ts future).
 *
 * Access TTL is 1d (config.jwtExpiresIn) with rotating 30d refresh (cf_refresh,
 * SameSite=Strict, /api/auth/refresh path) + double-submit CSRF (cf_csrf /
 * X-CSRF-Token). Bearer header still accepted during migration (dual support).
 * Rollback: delete jti/lockout checks (plain userId JWT + global authLimiter remain).
 */
import jwt from 'jsonwebtoken';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { config } from '../config';
import { logger } from './logger';

const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MAX_FAILS = 5;

interface AttemptState {
  count: number;
  firstAt: number;
  lockedUntil?: number;
}

const attempts = new Map<string, AttemptState>();
const revokedJtis = new Set<string>();

// --- Defensive: pre-migration / stale-client tolerance ----------------------
// Production incident (2026-09-09, same class as lastSyncError): the live DB
// never got a RevokedToken migration (no migration folder shipped), so every
// `revokedToken.create()` threw P2021 ("table public.RevokedToken does not
// exist") on login/socket revoke paths and broke auth instead of degrading.
// Fixed by migration 20260912000000_auth_revocation + these helpers: a
// missing table/client MUST never break auth — revocation is defense-in-depth,
// the in-memory Set stays authoritative this process, DB persist is
// best-effort with warn-once (same lesson as saveSyncResult in syncEngine).
let warnedMissingRevocationTable = false;

function warnOnceMissingRevocationTable(err: unknown): void {
  if (warnedMissingRevocationTable) return;
  warnedMissingRevocationTable = true;
  logger.warn(
    { err: (err as any)?.message || err },
    '[auth] RevokedToken/LoginAttempt unavailable (migration 20260912000000_auth_revocation not applied or stale client?) — revocation stays in-memory only'
  );
}

/** Test-only: reset warn-once flag. */
export function __resetRevocationWarnForTests(): void {
  warnedMissingRevocationTable = false;
}

/** True when the DB/client predates the auth_revocation migration. */
export function isMissingRevocationTableError(err: any): boolean {
  if (!err) return false;
  // P2021: table does not exist. P2022: column does not exist.
  if (err.code === 'P2021' || err.code === 'P2022') return true;
  const msg = String(err?.message || err);
  return (
    /revokedtoken.*(unknown argument|does not exist)|relation "?revokedtoken"? does not exist/i.test(msg) ||
    /loginattempt.*(unknown argument|does not exist)|relation "?loginattempt"? does not exist/i.test(msg) ||
    /table .*revokedtoken.* does not exist/i.test(msg) ||
    /unknown argument.*revokedtoken/i.test(msg)
  );
}

function normEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

export function isLockedOut(email: string): { locked: boolean; retryAfterSec?: number } {
  const s = attempts.get(normEmail(email));
  if (!s?.lockedUntil) return { locked: false };
  if (Date.now() >= s.lockedUntil) {
    attempts.delete(normEmail(email));
    return { locked: false };
  }
  return { locked: true, retryAfterSec: Math.max(1, Math.ceil((s.lockedUntil - Date.now()) / 1000)) };
}

export function recordFailedLogin(email: string): void {
  const key = normEmail(email);
  const now = Date.now();
  const s = attempts.get(key);
  if (!s || now - s.firstAt > LOCKOUT_WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now });
    return;
  }
  s.count += 1;
  if (s.count >= LOCKOUT_MAX_FAILS) {
    s.lockedUntil = now + LOCKOUT_WINDOW_MS;
  }
}

export function recordSuccessfulLogin(email: string): void {
  attempts.delete(normEmail(email));
}

export function signJwtWithJti(userId: string): { token: string; jti: string } {
  const jti = randomUUID();
  const token = jwt.sign({ userId, jti }, config.jwtSecret, { expiresIn: config.jwtExpiresIn as any });
  return { token, jti };
}

export function revokeJti(jti: string): void {
  if (jti) revokedJtis.add(jti);
  // Persist revocation (fail-open documented): in-memory Set is authoritative
  // this process; best-effort async persist to RevokedToken degrades to
  // warn-once when the table/client is missing (P2021/P2022-tolerant) and
  // NEVER blocks or breaks auth (login/logout/refresh continue — revocation
  // is defense-in-depth). Multi-replica safety needs Redis + hourly prune
  // (lib/cache) — until then DO NOT claim multi-instance safety.
  // Env: none (always best-effort, never blocks auth). See jobs/cron.ts future.
  try {
    void persistRevocationAttempt(jti).catch(() => {});
  } catch {}
}

/**
 * Best-effort persist of a revoked jti. Never throws — callers (login,
 * logout, refresh, change-password, middleware future read-through) must
 * continue auth on any failure. Pre-migration (missing table) or stale
 * client (missing delegate) degrades to warn-once with the in-memory Set
 * authoritative. Other failures log at debug (non-fatal).
 */
export async function persistRevocationAttempt(jti: string, prismaClient?: any, userId?: string | null): Promise<void> {
  if (!jti) return;
  try {
    const client: any = prismaClient ?? (await import('../config/db')).default;
    const delegate = client?.revokedToken;
    if (!delegate?.create) {
      // Stale Prisma client (pre-generate) — in-memory Set authoritative.
      warnOnceMissingRevocationTable(
        new Error('revokedToken delegate missing (stale Prisma client? run `prisma generate`)')
      );
      return;
    }
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    try {
      // Order-1 FK: RevokedToken.userId → User(id) ON DELETE CASCADE, nullable.
      // 'unknown' placeholder would violate the FK — store NULL when the caller
      // has no authenticated user (logout edges, refresh rotate). Callers with
      // a userId should pass it so per-user revocation audits stay joinable.
      await delegate.create({ data: { jti, userId: userId ?? null, expiresAt } });
    } catch (err) {
      if (isMissingRevocationTableError(err)) {
        warnOnceMissingRevocationTable(err);
        return;
      }
      logger.debug(
        { err: String((err as any)?.message || err).slice(0, 300) },
        '[auth] revokedToken persist failed (non-fatal, memory remains authoritative)'
      );
    }
  } catch (err) {
    if (isMissingRevocationTableError(err)) warnOnceMissingRevocationTable(err);
    // Never throw — revocation must never break auth.
  }
}

export function isJtiRevoked(jti: string | undefined): boolean {
  if (!jti) return false;
  return revokedJtis.has(jti);
}

/**
 * Best-effort DB read-through for future multi-replica use. Memory Set is
 * checked first (authoritative, sync-safe for middleware); on miss it tries
 * RevokedToken.findUnique and memoizes hits. Missing table/client degrades to
 * warn-once + false (fail-open to memory — auth continues). Never throws.
 * Current callers (middleware/auth.ts, socket.ts) stay on sync isJtiRevoked;
 * use this only where async is already available (refresh/logout audit).
 */
export async function isJtiRevokedWithDb(jti: string | undefined, prismaClient?: any): Promise<boolean> {
  if (!jti) return false;
  if (revokedJtis.has(jti)) return true;
  try {
    const client: any = prismaClient ?? (await import('../config/db')).default;
    const delegate = client?.revokedToken;
    if (!delegate?.findUnique) {
      warnOnceMissingRevocationTable(
        new Error('revokedToken delegate missing (stale Prisma client? run `prisma generate`)')
      );
      return false;
    }
    const row = await delegate.findUnique({ where: { jti }, select: { jti: true } });
    if (row) {
      revokedJtis.add(jti);
      return true;
    }
    return false;
  } catch (err) {
    if (isMissingRevocationTableError(err)) warnOnceMissingRevocationTable(err);
    return false;
  }
}

// --- Refresh (rotating, 30d, HttpOnly Strict) + CSRF double-submit ---

export function signRefreshToken(userId: string): { token: string; jti: string } {
  const jti = randomUUID();
  const token = jwt.sign({ userId, jti, type: 'refresh' }, config.jwtSecret, { expiresIn: '30d' as any });
  return { token, jti };
}

export function verifyRefreshToken(token: string): { userId: string; jti: string } {
  const decoded = jwt.verify(token, config.jwtSecret) as { userId: string; jti: string; type?: string };
  if ((decoded as any).type !== 'refresh') throw new Error('Not a refresh token');
  if (decoded.jti && isJtiRevoked(decoded.jti)) throw new Error('Refresh token revoked');
  return { userId: decoded.userId, jti: decoded.jti };
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

// --- Password strength + HIBP k-anonymity ---

const COMMON_PASSWORDS = new Set([
  'password123', 'password', '12345678', '123456789', 'qwerty123', 'letmein123',
  'welcome123', 'admin123', 'campus123', 'college123', 'student123', 'teacher123',
  'password1', '1234567890', 'abc123456',
]);

export function isCommonPassword(pw: string): boolean {
  if (!pw) return true;
  const low = String(pw).toLowerCase().trim();
  if (COMMON_PASSWORDS.has(low)) return true;
  if (low.length < 8) return true;
  // Sequential / repeated patterns
  if (/^(.)\1{7,}$/.test(low)) return true;
  if (/^(12345678|abcdefgh|qwertyui|password)/.test(low)) return true;
  return false;
}

/**
 * HIBP k-anonymity check (https://haveibeenpwned.com/API/v3#SearchingPwnedPasswordsByRange).
 * Sends SHA1(prefix 5 chars) only — never full hash/password. Offline-safe:
 * - HIBP_STRICT=true (prod recommended): fail-closed — offline/error => { breached:true, offline:true }
 * - default (dev/test): fail-open with warn log — offline => { breached:false, offline:true }
 * Callers: reject when breached===true (show generic message, do not log password).
 */
export async function checkPasswordBreach(password: string): Promise<{ breached: boolean; offline: boolean }> {
  const strict = process.env.HIBP_STRICT === 'true';
  try {
    const sha1 = createHash('sha1').update(String(password)).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const resp = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'User-Agent': 'CampusFlow/1.0 (HIBP k-anonymity)' },
      signal: ctrl.signal,
    } as any);
    clearTimeout(t);
    if (!resp.ok) throw new Error(`HIBP status ${resp.status}`);
    const text = await resp.text();
    const hit = text.split('\n').some((line) => line.split(':')[0]?.trim().toUpperCase() === suffix);
    return { breached: hit, offline: false };
  } catch (e: any) {
    if (strict) {
      logger.warn('[hibp] offline/error with HIBP_STRICT=true — fail-closed (treat as breached)');
      return { breached: true, offline: true };
    }
    logger.debug({ err: String(e?.message || e).slice(0, 200) }, '[hibp] offline (fail-open, dev) — allowing with log');
    return { breached: false, offline: true };
  }
}

// Breach-check status (register / change-password already wired above via
// checkPasswordBreach — k-anonymity, SHA1 prefix only, 3s timeout).
// Fail-closed documented: HIBP_STRICT=true (prod) treats offline/error as breached
// (400 generic); default dev fail-open with warn log. Do NOT log plaintext
// passwords (see errorHandler FS-L04). Currently enforced: min 8 / max 72
// (bcrypt limit) + reject current==new + generic 401 on login (no enumeration).
export function breachCheckTodo(): string {
  return 'HIBP k-anonymity check pending — see TODO above';
}
