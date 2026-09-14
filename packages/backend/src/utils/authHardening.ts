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
// Unbounded-store fix: process-local maps are DoS-amplifiers without bounds
// (attacker-controlled keys: emails + jtis). LRU + TTL caps keep memory flat:
// attempts evict oldest past MAX_ATTEMPT_KEYS (15m window entries expire
// lazily on read + opportunistically on insert); revoked jtis carry a 24h
// expiry (matches access-token TTL) and evict oldest past MAX_REVOKED_JTIS.
const MAX_ATTEMPT_KEYS = 5000;
const MAX_REVOKED_JTIS = 10_000;
const REVOKED_TTL_MS = 24 * 60 * 60 * 1000;

interface AttemptState {
  count: number;
  firstAt: number;
  lockedUntil?: number;
}

const attempts = new Map<string, AttemptState>();
// jti -> expiresAt (epoch ms). Map preserves insertion order for LRU eviction.
const revokedJtis = new Map<string, number>();

function pruneAttempts(now = Date.now()): void {
  if (attempts.size < MAX_ATTEMPT_KEYS) return;
  // Opportunistic: drop expired windows/locks first, then oldest-first to cap.
  for (const [key, s] of attempts) {
    if (attempts.size < MAX_ATTEMPT_KEYS) break;
    if (s.lockedUntil && now < s.lockedUntil) continue;
    if (now - s.firstAt <= LOCKOUT_WINDOW_MS) continue;
    attempts.delete(key);
  }
  while (attempts.size >= MAX_ATTEMPT_KEYS) {
    const oldest = attempts.keys().next();
    if (oldest.done) break;
    attempts.delete(oldest.value);
  }
}

function pruneRevoked(now = Date.now()): void {
  if (revokedJtis.size < MAX_REVOKED_JTIS) {
    // Still drop expired hits opportunistically when small (cheap scan only
    // when oversized to avoid O(n) on every revoke in the common case).
    return;
  }
  for (const [jti, exp] of revokedJtis) {
    if (revokedJtis.size < MAX_REVOKED_JTIS) break;
    if (exp <= now) revokedJtis.delete(jti);
  }
  while (revokedJtis.size >= MAX_REVOKED_JTIS) {
    const oldest = revokedJtis.keys().next();
    if (oldest.done) break;
    revokedJtis.delete(oldest.value);
  }
}

/** Test-only: clear lockout + revocation state (isolates hermetic tests). */
export function clearAuthHardeningForTests(): void {
  attempts.clear();
  revokedJtis.clear();
}

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

/**
 * Canonical email normalization (SSOT for auth + college adminEmail match +
 * admin/bulk user creation).
 * WHY: User.email is @unique in Postgres (case-sensitive B-tree), so
 * `Example@gmail.com` and `example@gmail.com` are distinct keys. Every
 * writer must store lowercased+trimmed and every lookup must query the same
 * key, otherwise register/login diverge by case and duplicates are possible.
 * Lockout keys already used this shape (normEmail); this export makes the
 * DB path share it. Existing mixed-case rows stay distinct until a
 * case-insensitive backfill + citext/lower() unique index lands (documented,
 * NOT migrated here — prod LIVE).
 */
export function normalizeEmail(email: unknown): string {
  return String(email ?? '').trim().toLowerCase();
}

/**
 * Case-insensitive Prisma email filter sharing the normalizeEmail SSOT.
 * WHY: Postgres `User.email @unique` is a case-sensitive B-tree, so legacy
 * mixed-case rows (`Demo@gmail.com`) are distinct keys from `demo@gmail.com`.
 * Every auth lookup MUST use this (findFirst + mode:insensitive on the
 * normalized key) so BOTH new normalized rows AND legacy mixed-case rows hit.
 * New writes still store normalizeEmail() (exact key); the insensitive read
 * is the bridge until the lower() backfill + unique index lands (migration
 * 20260928000000_email_case_insensitive, additive, NOT auto-applied to prod).
 */
export function emailInsensitiveFilter(email: unknown): { equals: string; mode: 'insensitive' } {
  return { equals: normalizeEmail(email), mode: 'insensitive' };
}

/**
 * JS-side case-insensitive email equality (College.adminEmail match + tests).
 * Both sides go through normalizeEmail SSOT; empty never matches (prevents
 * `'' === ''` from authorizing a missing adminEmail).
 */
export function emailsMatchInsensitive(a: unknown, b: unknown): boolean {
  const x = normalizeEmail(a);
  const y = normalizeEmail(b);
  if (!x || !y) return false;
  return x === y;
}

/**
 * Runtime case-insensitive user lookup (login / register duplicate check /
 * admin single-create). Uses findFirst + mode:insensitive on the normalized
 * key so legacy `Demo@gmail.com` is found via `demo@gmail.com`,
 * `DEMO@GMAIL.COM`, or `' demo@gmail.com '`.
 * `extra` (e.g. `{ select: { id: true } }`) is shallow-merged; `where` in
 * extra is AND-ed with the email condition (callers must not pass raw email).
 */
export async function findUserByEmailInsensitive(
  db: { user: { findFirst: (args: unknown) => Promise<unknown> } },
  email: unknown,
  extra?: Record<string, unknown>,
): Promise<any> {
  const { where: extraWhere, ...rest } = (extra ?? {}) as { where?: Record<string, unknown> } & Record<string, unknown>;
  const emailCond = { email: emailInsensitiveFilter(email) };
  const where = extraWhere ? { AND: [emailCond, extraWhere] } : emailCond;
  return (db as any).user.findFirst({ where, ...rest });
}

/**
 * Bulk case-insensitive WHERE for `email IN (...)` lists.
 * WHY: `where: { email: { in: emails } }` is exact in Postgres and MISSES
 * legacy mixed-case rows. Prisma `in` + `mode` support varies by version, so
 * this builds the portable single-query shape:
 * `{ OR: emails.map(e => ({ email: { equals: e, mode: 'insensitive' } })) }`
 * (one round-trip, no N+1). Input is normalized + deduped via SSOT; empty
 * input returns `{ email: { in: [] } }` (matches nothing, valid Prisma).
 */
export function buildBulkEmailInsensitiveWhere(emails: unknown[]): Record<string, unknown> {
  const list = [...new Set((Array.isArray(emails) ? emails : []).map((e) => normalizeEmail(e)).filter(Boolean))];
  if (list.length === 0) return { email: { in: [] as string[] } };
  return { OR: list.map((e) => ({ email: { equals: e, mode: 'insensitive' as const } })) };
}

/**
 * Bulk case-insensitive fetch (prefetch existing + post-create dual-write
 * re-read). Single findMany with the OR-insensitive WHERE above.
 */
export async function findUsersByEmailsInsensitive(
  db: { user: { findMany: (args: unknown) => Promise<unknown> } },
  emails: unknown[],
  extra?: Record<string, unknown>,
): Promise<any[]> {
  const { where: extraWhere, ...rest } = (extra ?? {}) as { where?: Record<string, unknown> } & Record<string, unknown>;
  const emailWhere = buildBulkEmailInsensitiveWhere(emails as unknown[]);
  const where = extraWhere ? { AND: [emailWhere, extraWhere] } : emailWhere;
  const rows = (await (db as any).user.findMany({ where, ...rest })) as any[];
  return Array.isArray(rows) ? rows : [];
}

function normEmail(email: string): string {
  return normalizeEmail(email);
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
    if (!s) pruneAttempts(now);
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
  if (jti) {
    pruneRevoked();
    revokedJtis.set(jti, Date.now() + REVOKED_TTL_MS);
  }
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
  const exp = revokedJtis.get(jti);
  if (exp === undefined) return false;
  if (Date.now() >= exp) {
    revokedJtis.delete(jti);
    return false;
  }
  return true;
}

/**
 * Best-effort DB read-through for future multi-replica use. Memory Map is
 * checked first (authoritative, sync-safe for middleware); on miss it tries
 * RevokedToken.findUnique and memoizes hits. Missing table/client degrades to
 * warn-once + false (fail-open to memory — auth continues). Never throws.
 * Socket handshake uses this async read-through; sync middleware stays on
 * isJtiRevoked until callers go async.
 */
export async function isJtiRevokedWithDb(jti: string | undefined, prismaClient?: any): Promise<boolean> {
  if (!jti) return false;
  if (isJtiRevoked(jti)) return true;
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
      pruneRevoked();
      revokedJtis.set(jti, Date.now() + REVOKED_TTL_MS);
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

/**
 * Bulk-password mass revoke helper (follow-up 2026-09-14).
 * WHY: bulk reset sets passwordNudgeAt=now for the cohort (no per-user jti
 * registry, no migration). Old refresh tokens (iat < nudgeAt) must die so stolen
 * sessions end, while fresh logins with the new shared pw (iat >= nudgeAt) pass
 * nudge-only (no login block — banner only). Pure, hermetic, testable.
 * Fail-open: missing iat or nudge → false (allow). Strict < (equal allows —
 * avoids same-second race locking out a fresh login). Never throws.
 */
export function isRefreshTokenStaleAfterBulkReset(
  tokenIatSec: number | undefined | null,
  passwordNudgeAt: Date | string | number | null | undefined,
): boolean {
  try {
    if (passwordNudgeAt == null) return false
    if (typeof tokenIatSec !== 'number' || !Number.isFinite(tokenIatSec)) return false
    const nudgeMs =
      passwordNudgeAt instanceof Date
        ? passwordNudgeAt.getTime()
        : typeof passwordNudgeAt === 'number'
          ? passwordNudgeAt
          : Date.parse(String(passwordNudgeAt))
    if (!Number.isFinite(nudgeMs)) return false
    return Math.floor(tokenIatSec * 1000) < nudgeMs
  } catch {
    return false
  }
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
