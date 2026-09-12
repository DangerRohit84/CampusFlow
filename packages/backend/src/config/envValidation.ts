/**
 * Boot env validation — fail-fast in prod, warn-only in dev.
 *
 * WHY: two live crashes came from migrations/env never applied. First deploy
 * must fail with a CLEAR message (which key, why, exact fix) instead of a
 * cryptic P1001/500. Prod crashes on missing/weak required envs; dev warns
 * and continues with safe fallbacks so `tsx watch` never blocks local work.
 *
 * SCOPE (per deploy-readiness task):
 * - Fail-fast (prod ERROR, dev WARN): DATABASE_URL, DIRECT_URL, JWT_SECRET
 *   strength, AI_ENCRYPTION_KEY, FRONTEND_URL (prod-only), JWT_EXPIRES_IN shape.
 * - Route-level (WARN at boot, 503/reject when hit): CRON_SECRET — /internal/cron/*
 *   already fails closed 503 when unset (see routes/internalCron.ts). Booting
 *   the API without CRON_SECRET must NOT crash healthy paths.
 * - Optional with fallback (WARN, never ERROR): REDIS_URL — unset means
 *   process-local memory (single-instance OK; multi-instance needs shared
 *   Redis for rate-limit/cache/locks). See lib/redis.ts + lib/cache.ts.
 * - Advisory (WARN in prod when insecure default): HIBP_STRICT,
 *   UPLOAD_SCAN_STRICT, EXTERNAL_FETCH_ALLOWLIST, TURNSTILE_*, CLAMAV_URL.
 *
 * RULES:
 * - Pure `validateEnv(env)` — hermetic, no process.env reads except via param,
 *   no secrets in messages (key names + shape hints only, never values).
 * - `assertEnvOnBoot()` — throws in prod when errors exist, logs warnings
 *   otherwise. Never throws in dev/test (warn-only).
 * - No `config/index` import here (avoids circular + keeps vitest hermetic).
 */

import { logger } from '../utils/logger'

export interface EnvValidationResult {
  isProd: boolean
  errors: string[]
  warnings: string[]
}

type EnvLike = Record<string, string | undefined>

const PLACEHOLDER_RE =
  /campusflow|random-string|replace_me|dev-secret|dev-encryption|dev-cron|change-me|your-key|example|password123/i

function isBlank(v: string | undefined): boolean {
  return !v || !v.trim()
}

function isProdEnv(env: EnvLike, nodeEnvOverride?: string): boolean {
  const nodeEnv = nodeEnvOverride ?? env.NODE_ENV ?? process.env.NODE_ENV
  return nodeEnv === 'production'
}

/**
 * Pure validation — pass a fake env object in tests, no side effects.
 * Returns errors (prod-fatal) + warnings (advisory / dev-lenient).
 */
export function validateEnv(
  env: EnvLike = process.env as EnvLike,
  opts: { nodeEnv?: string } = {},
): EnvValidationResult {
  const isProd = isProdEnv(env, opts.nodeEnv)
  const errors: string[] = []
  const warnings: string[] = []
  const asError = (msg: string) => {
    if (isProd) errors.push(msg)
    else warnings.push(msg)
  }

  // --- DATABASE_URL (Neon pooled, runtime queries) ---
  const dbUrl = (env.DATABASE_URL || '').trim()
  if (isBlank(dbUrl)) {
    asError(
      'DATABASE_URL is required (Neon pooled URL: -pooler host + ?sslmode=require&pgbouncer=true&connection_limit=50&pool_timeout=30). ' +
        'Set in Render Dashboard (sync: false, never commit). Dev fallback: local postgres via docker-compose or Neon pooled URL.',
    )
  } else if (!/^postgres(ql)?:\/\//i.test(dbUrl)) {
    asError('DATABASE_URL must start with postgresql:// (got unexpected scheme — check Neon dashboard pooled URL).')
  } else if (isProd && !/-pooler/i.test(dbUrl)) {
    warnings.push(
      'DATABASE_URL in prod should use the Neon pooled host (-pooler) with pgbouncer=true — direct host will exhaust connections under burst (P2024).',
    )
  }

  // --- DIRECT_URL (Neon direct, migrations only) ---
  const directUrl = (env.DIRECT_URL || '').trim()
  if (isBlank(directUrl)) {
    asError(
      'DIRECT_URL is required in production (Neon direct URL: no -pooler, no pgbouncer — used by `prisma migrate deploy` via datasource directUrl). ' +
        'Set in Render Dashboard (sync: false). Dev may reuse local postgres URL.',
    )
  } else {
    if (/pgbouncer=true/i.test(directUrl)) {
      warnings.push('DIRECT_URL must not contain pgbouncer=true (direct URL bypasses the pooler — remove pgbouncer params).')
    }
    if (/-pooler/i.test(directUrl)) {
      warnings.push('DIRECT_URL should use the direct host (no -pooler) — pooled host breaks `prisma migrate deploy`.')
    }
    if (!/^postgres(ql)?:\/\//i.test(directUrl)) {
      asError('DIRECT_URL must start with postgresql:// (check Neon dashboard direct URL).')
    }
  }

  // --- JWT_SECRET (strength) ---
  const jwt = (env.JWT_SECRET || '').trim()
  if (isBlank(jwt)) {
    asError('JWT_SECRET is required (min 32 chars, generate with `openssl rand -hex 32`). Auth JWTs are forgeable without it.')
  } else if (jwt.length < 32) {
    asError('JWT_SECRET must be at least 32 characters (generate with `openssl rand -hex 32`). Short secrets allow JWT forgery.')
  } else if (PLACEHOLDER_RE.test(jwt)) {
    asError('JWT_SECRET looks like a placeholder/weak default — generate with `openssl rand -hex 32` (never commit live values).')
  }

  // --- AI_ENCRYPTION_KEY (prod-fatal, dev-lenient) ---
  const aiKey = (env.AI_ENCRYPTION_KEY || '').trim()
  if (isBlank(aiKey)) {
    asError('AI_ENCRYPTION_KEY is required (min 32 chars, `openssl rand -hex 32`) — AI provider keys are encrypted with it.')
  } else if (aiKey.length < 32) {
    asError('AI_ENCRYPTION_KEY must be at least 32 characters (`openssl rand -hex 32`).')
  } else if (PLACEHOLDER_RE.test(aiKey)) {
    asError('AI_ENCRYPTION_KEY looks like a placeholder/weak default — generate with `openssl rand -hex 32`.')
  }

  // --- CRON_SECRET (route-level, NEVER boot-fatal) ---
  // /internal/cron/* fails closed 503 when unset (see internalCron.ts). The API
  // serves healthy traffic without it, so boot only warns — even in prod.
  const cron = (env.CRON_SECRET || '').trim()
  if (isBlank(cron)) {
    warnings.push(
      'CRON_SECRET unset — /internal/cron/* will answer 503 (fail-closed) until set. Set any high-entropy value locally (`openssl rand -hex 32`); set matching CRON_SECRET on API + cron jobs in prod.',
    )
  } else if (cron.length < 16) {
    warnings.push('CRON_SECRET should be at least 16 chars (`openssl rand -hex 32`) — short secrets weaken cron auth.')
  } else if (/random-string|replace_me|dev-cron|change-me|your-key|example/i.test(cron)) {
    warnings.push('CRON_SECRET looks like a placeholder — generate with `openssl rand -hex 32`.')
  }

  // --- REDIS_URL (optional, memory fallback) ---
  // Unset = process-local memory (correct single-instance, unsafe multi-replica:
  // rate-limit budgets inflate N×, throttles double-fire). Never boot-fatal.
  const redisUrl = (env.REDIS_URL || '').trim()
  if (isBlank(redisUrl)) {
    warnings.push(
      isProd
        ? 'REDIS_URL unset — using in-memory fallback (single-instance OK; prod multi-instance requires REDIS_URL for shared rate-limit/cache/locks — add Render Key Value `campusflow-cache` via fromService, see render.yaml).'
        : 'REDIS_URL unset — using in-memory fallback (dev single-instance; fine for local). Set redis://localhost:6379 only if testing shared cache.',
    )
  } else if (!/^rediss?:\/\//i.test(redisUrl)) {
    warnings.push('REDIS_URL should start with redis:// (local) or rediss:// (prod TLS) — unexpected scheme.')
  }

  // --- FRONTEND_URL (prod-fatal, dev has localhost fallback) ---
  if (isProd && isBlank(env.FRONTEND_URL)) {
    errors.push('FRONTEND_URL is required in production (no localhost fallback — CORS/cookie allowlist must trust the real web origin).')
  }

  // --- JWT_EXPIRES_IN shape ---
  const expiresIn = (env.JWT_EXPIRES_IN || '1d').trim()
  if (!/^\d+[smhd]$/.test(expiresIn)) {
    asError(`JWT_EXPIRES_IN must match /^\\d+[smhd]$/ (got "${expiresIn.slice(0, 40)}") — e.g. 1d. Catches ms/s confusion.`)
  } else if (isProd) {
    const m = /^(\d+)([smhd])$/.exec(expiresIn)
    if (m) {
      const n = parseInt(m[1], 10)
      const mult: Record<string, number> = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 }
      if (n * mult[m[2]] > 24 * 60 * 60 * 1000) {
        warnings.push(`JWT_EXPIRES_IN=${expiresIn} exceeds 1d — session window wider than hardening baseline. Prefer 1d + refresh rotation.`)
      }
    }
  }

  // --- Advisory matrix (prod guidance, never fatal) ---
  if (isProd && env.HIBP_STRICT !== 'true') {
    warnings.push('HIBP_STRICT!=true in prod — breached-password check fails OPEN when api.pwnedpasswords.com is offline. Set HIBP_STRICT=true (fail-closed).')
  }
  if (isProd && env.UPLOAD_SCAN_STRICT !== 'true') {
    warnings.push('UPLOAD_SCAN_STRICT!=true in prod — uploads allow .txt/small-office fallback when file-type sniffing is unavailable. Set UPLOAD_SCAN_STRICT=true (fail-closed).')
  }
  if (isProd && isBlank(env.EXTERNAL_FETCH_ALLOWLIST)) {
    warnings.push('EXTERNAL_FETCH_ALLOWLIST unset in prod — SSRF guard falls back to DEFAULT_FETCH_ALLOWLIST (10 platform suffixes). Set explicitly to override.')
  }
  if (isProd && isBlank(env.TURNSTILE_SECRET)) {
    warnings.push('TURNSTILE_SECRET unset in prod — auth CAPTCHA cannot verify (fail-closed when TURNSTILE_ENFORCE=true, else allows with log). Set Cloudflare Turnstile secret to enforce bot defense.')
  }
  if (!isBlank(env.CLAMAV_URL)) {
    warnings.push('CLAMAV_URL is a placeholder for future ClamAV wiring (not read yet — heuristic scan + magic-byte gate is current enforcement, see uploadScan.ts).')
  }
  if (isBlank(env.GROQ_API_KEY)) {
    warnings.push('GROQ_API_KEY unset — AI features disabled (non-fatal).')
  }

  return { isProd, errors, warnings }
}

/**
 * Boot entry — call once at startup (config/index.ts does this).
 * - Prod + errors: throws with every message (fail-fast, Render logs show fix).
 * - Otherwise: logs each warning once, returns result. Never throws in dev/test.
 * Never logs values (messages contain key names + shape hints only).
 */
export function assertEnvOnBoot(env: EnvLike = process.env as EnvLike): EnvValidationResult {
  const result = validateEnv(env)
  if (result.isProd && result.errors.length > 0) {
    throw new Error(
      'Invalid production env:\n- ' +
        result.errors.join('\n- ') +
        '\nFix env in Render Dashboard (sync: false for secrets, never commit values). See packages/backend/.env.example for the full matrix.',
    )
  }
  for (const w of [...result.errors, ...result.warnings]) {
    // In dev, errors are downgraded to warnings (lenient) — still visible.
    logger.warn(`[config] ${w}`)
  }
  return result
}
