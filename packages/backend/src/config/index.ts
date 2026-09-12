import dotenv from 'dotenv'
import { logger } from '../utils/logger'
import { validateEnv } from './envValidation'
dotenv.config()

// Deploy-readiness: centralized boot validation (fail-fast in prod, warn-only in dev).
// - Prod: missing/weak DATABASE_URL, DIRECT_URL, JWT_SECRET, AI_ENCRYPTION_KEY,
//   FRONTEND_URL, or malformed JWT_EXPIRES_IN throws with a clear fix (see
//   envValidation.ts). CRON_SECRET + REDIS_URL never crash boot (route-level
//   503 for cron, memory fallback for cache) — they warn only.
// - Dev/test: warn-only + safe fallbacks so `tsx watch` and hermetic vitest
//   never block on missing secrets. Do NOT commit live values (see .env.example).
const _validation = validateEnv(process.env)
if (_validation.isProd && _validation.errors.length > 0) {
  throw new Error(
    'Invalid production env:\n- ' +
      _validation.errors.join('\n- ') +
      '\nFix env in Render Dashboard (sync: false for secrets, never commit values). See packages/backend/.env.example for the full matrix.',
  )
}
for (const _w of [..._validation.errors, ..._validation.warnings]) {
  // In dev/test, prod-errors are downgraded to warnings (lenient).
  logger.warn(`[config] ${_w}`)
}

// Dev/test fallbacks (warned above via validateEnv — never crash healthy paths).
// Prod never reaches here with missing values (threw above).
const _isProdBoot = process.env.NODE_ENV === 'production'
const _jwtFallback = 'dev-only-insecure-fallback-32plus-chars-xxxxxxxxxxxx'
const _aiFallback = 'dev-only-insecure-ai-fallback-32plus-chars-xxxxx'
const _cronFallback = 'local-cron-fallback-16-chars-xxxxxxxx'

// P0 SECURITY (F16/F31 + C-2): fail closed on weak JWT secrets in prod.
// Classroom/Canvas parity requires >=32 chars of entropy; short defaults like
// "dev-secret" would allow trivial JWT forgery across tenants. Also reject
// dictionary/placeholder values that pass length but have ~20 bits entropy.
// Dev/test: warn-only (validateEnv already warned) + fallback so boot continues.
const _jwtSecret = process.env.JWT_SECRET || (_isProdBoot ? '' : _jwtFallback)
if (_isProdBoot) {
  if (!_jwtSecret) {
    throw new Error('JWT_SECRET environment variable is required')
  }
  if (_jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters (use `openssl rand -hex 32`)')
  }
  if (/campusflow|random-string|replace_me|dev-secret|change-me|your-key|example|password123/i.test(_jwtSecret)) {
    throw new Error('JWT_SECRET looks like a placeholder/weak default — generate with `openssl rand -hex 32`')
  }
}

// AI_ENCRYPTION_KEY + CRON_SECRET (C-2).
// Prod: fail-closed (throw). Dev/test: warn-only + fallback (cron routes still
// fail closed 503 when CRON_SECRET unset — see routes/internalCron.ts).
const _aiKey = process.env.AI_ENCRYPTION_KEY || (_isProdBoot ? '' : _aiFallback)
if (_isProdBoot) {
  if (!_aiKey || _aiKey.length < 32) {
    throw new Error('AI_ENCRYPTION_KEY env var is required (min 32 chars, use `openssl rand -hex 32`)')
  }
  if (/campusflow|random-string|replace_me|dev-encryption|change-me|your-key|example/i.test(_aiKey)) {
    throw new Error('AI_ENCRYPTION_KEY looks like a placeholder/weak default — generate with `openssl rand -hex 32`')
  }
}
const _cron = process.env.CRON_SECRET || (_isProdBoot ? '' : _cronFallback)
if (_isProdBoot) {
  // Boot stays UP without CRON_SECRET (cron routes 503); validateEnv already
  // warned. Only hard-fail on an explicitly-set-but-weak value to catch typos.
  if (process.env.CRON_SECRET && (_cron.length < 16 || /random-string|replace_me|dev-cron|change-me|your-key|example/i.test(_cron))) {
    throw new Error('CRON_SECRET is set but weak (min 16 chars, no placeholders — use `openssl rand -hex 32`)')
  }
}

// Validate JWT expiry format early (e.g. "15m", "7d") — catches ms/s confusion (FS-L05).
// Default 1d until HttpOnly dual-issuance completes (was 7d — narrows XSS window, see I-1).
// Override via JWT_EXPIRES_IN env; 7d still accepted for compat but discouraged.
// Prod: malformed throws (validateEnv already threw). Dev/test: warn + fallback to 1d.
const _expiresInRaw = process.env.JWT_EXPIRES_IN || '1d'
const _expiresIn = /^\d+[smhd]$/.test(_expiresInRaw) ? _expiresInRaw : '1d'

export function parseExpiryToMs(exp: string): number {
  const m = /^(\d+)([smhd])$/.exec(String(exp || '').trim());
  if (!m) throw new Error(`Invalid expiry "${exp}"`);
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const mult: Record<string, number> = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return n * mult[unit];
}

const _jwtExpiresMs = parseExpiryToMs(_expiresIn);
if (process.env.NODE_ENV === 'production' && _jwtExpiresMs > 24 * 60 * 60 * 1000) {
  logger.warn(`[config] JWT_EXPIRES_IN=${_expiresIn} exceeds 1d — session window wider than hardening baseline (see C2). Prefer 1d + refresh rotation.`);
}

export function getCookieMaxAgeMs(): number {
  return _jwtExpiresMs;
}

if (!process.env.GROQ_API_KEY) {
  logger.warn('WARNING: GROQ_API_KEY is not set. AI features will be disabled.')
}

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  databaseUrl: process.env.DATABASE_URL || '',
  jwtSecret: _jwtSecret,
  jwtExpiresIn: _expiresIn,
  jwtExpiresMs: _jwtExpiresMs,
  groqApiKey: process.env.GROQ_API_KEY || '',
  openCodeZenApiKey: process.env.OPENCODE_ZEN_API_KEY || '',
  openCodeZenBaseUrl: process.env.OPENCODE_ZEN_BASE_URL || 'https://opencode.ai/zen/v1',
  openCodeServeUrl: process.env.OPENCODE_SERVE_URL || '',
  frontendUrl: (() => {
    // Fail-closed in prod: localhost fallback must never trust dev origins in prod (I-7).
    if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_URL) {
      throw new Error('FRONTEND_URL is required in production (no localhost fallback)')
    }
    return (process.env.FRONTEND_URL || 'http://localhost:3000').split(',')[0].trim()
  })(),
  // Centralized allowlist for CORS + Socket.IO. Single SSOT — index.ts and socket.ts must use this.
  // Prod: FRONTEND_URL=https://campusflow-web.onrender.com (comma-separated for extra origins).
  // Dev fallback includes localhost:3000 + :5173; prod has no fallback (throws above).
  frontendUrls: (() => {
    if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_URL) {
      throw new Error('FRONTEND_URL is required in production (no localhost fallback)')
    }
    return (process.env.FRONTEND_URL || 'http://localhost:3000,http://localhost:5173')
      .split(',')
      .map((o: string) => o.trim())
      .filter(Boolean)
  })(),
}