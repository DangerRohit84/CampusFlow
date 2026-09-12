// middleware/rateLimits.ts — SRP extract from index.ts (factories, Redis-shared).
// WHY: 3 inline limiter configs in the composition root. Factories here;
// index.ts only wires them. Each limiter gets its own shared-store prefix so
// counters stay consistent across N replicas (see lib/cache.ts +
// lib/redis.ts). Store is Redis-atomic when REDIS_URL is set, process-local
// memory otherwise — identical 429 contracts either way.

import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { createSharedRateLimitStore } from '../lib/cache'

// Per-actor key: IP + user (college NAT fix).
// WHY: generalLimiter was IP-only (default keyGenerator). An entire college
// behind one NAT egress IP shared a single 500/15m bucket across ~20 routes:
// dashboard bundle alone is 6 parallel GETs per mount, plus 30s polls,
// plus waitForCodingSync 2s×30 polls per sync — 30 students × 6 = 180 hits
// on one page-load wave, tripping 500 quickly. The exact string
// "Too many requests, please try again later" in the user report matches
// ONLY generalLimiter.message below (auth/cron/sync/AI all have distinct
// messages; Neon pool errors are 500s, not 429s).
// FIX: key = ipKeyGenerator(req.ip) + ':' + userId when known, else IP alone.
// IP stays in the key so spoofed/fake userIds can't escape the IP bucket;
// distinct users behind one NAT get distinct buckets. Pattern mirrors the
// proven contests fetchNowRateLimiter (per-IP+user + ipKeyGenerator).
// NOTE: generalLimiter runs BEFORE authenticate (see index.ts wiring), so
// req.userId is not yet set. Extract userId best-effort from the Bearer
// payload (unsigned decode, no verify — only for bucketing, never auth).
function extractRateLimitUserId(req: any): string | null {
  try {
    const direct = req?.userId
    if (typeof direct === 'string' && direct) return direct
    const auth: unknown = req?.headers?.authorization
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      const parts = auth.split(' ')[1]?.split('.')
      if (parts && parts.length >= 2 && parts[1]) {
        const json = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'))
        if (json && typeof json.userId === 'string' && json.userId) return json.userId
      }
    }
  } catch {}
  return null
}

function retrySecsFromReq(req: any, windowMs: number): number {
  try {
    const reset = (req as any)?.rateLimit?.resetTime
    if (reset instanceof Date) {
      return Math.max(1, Math.ceil((reset.getTime() - Date.now()) / 1000))
    }
  } catch {}
  return Math.max(1, Math.ceil(windowMs / 1000))
}

export function generalLimiter(overrides?: { windowMs?: number; limit?: number; prefix?: string }): ReturnType<typeof rateLimit> {
  // Budget: 500/15m shared-IP → 1000/15m per (IP+user).
  // MATH: heavy user ≈ 100 req/15m (bundle 6 + 5 pages×5 + polls + sync 30).
  // 50 NAT users × 100 = 5000/window shared → 500 trips at ~10% of cohort.
  // Per-user split → each actor gets 1000 (10× headroom); effective NAT
  // capacity 50×1000 while per-actor abuse cap only 2× looser. Auth/cron
  // stay strict (unchanged below) — abuse surface preserved.
  // 10k SCALE (shared store): per-user keys spread load (no hotspot key);
  // all N replicas share one counter via Redis (budget is global, not N×).
  // Without Redis the budget would inflate N× (each replica counts alone) —
  // acceptable in dev (N=1), fixed in prod by REDIS_URL. See scale10k report.
  const windowMs = overrides?.windowMs ?? 15 * 60 * 1000
  const limit = overrides?.limit ?? 1000
  const prefix = overrides?.prefix ?? 'rl:general:'
  return rateLimit({
    windowMs,
    // `limit` is v8 canonical (`max` deprecated alias — cronLimiter already
    // uses `limit`; standardize here, keep `max` working elsewhere).
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    store: createSharedRateLimitStore(windowMs, prefix),
    // Skip CORS preflight: browsers send OPTIONS before JSON POSTs; counting
    // it doubles POST cost (OPTIONS+POST = 2 hits). Health was never behind
    // this limiter (index.ts registers /api/health without it) — skip here
    // defensively in case wiring moves (check originalUrl: req.path is
    // mount-relative under app.use('/api/x', limiter)).
    skip: (req) => req.method === 'OPTIONS' || (req as any)?.originalUrl?.includes('/api/health') || req.path === '/api/health',
    keyGenerator: (req) => {
      // IPv6-safe: ipKeyGenerator(req.ip) required (ERR_ERL_KEY_GEN_IPV6).
      const ipPart = (req as any).ip ? ipKeyGenerator((req as any).ip) : 'unknown'
      const uid = extractRateLimitUserId(req)
      return uid ? `${ipPart}:${uid}` : ipPart
    },
    // Friendly 429 with seconds (syncThrottle countdown pattern reuse):
    // { error: "Too many requests, please try again in Ns", retryAfterSec: N }
    // + Retry-After header (lib also sets it pre-handler when
    // standardHeaders — set-if-missing here for custom-store safety).
    // Frontend surfaces e.response.data.error directly (already includes Ns)
    // and CodingProfilePage-style countdowns can seed from retryAfterSec.
    handler: (req, res, _next, options) => {
      const secs = retrySecsFromReq(req, windowMs)
      try {
        if (!res.getHeader('Retry-After')) res.setHeader('Retry-After', String(secs))
      } catch {}
      res.status((options as any)?.statusCode ?? 429).json({
        error: `Too many requests, please try again in ${secs}s`,
        retryAfterSec: secs,
      })
    },
  })
}

export function authLimiter(): ReturnType<typeof rateLimit> {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    store: createSharedRateLimitStore(15 * 60 * 1000, 'rl:auth:'),
    message: { error: 'Too many auth attempts, please try again later' },
  })
}

export function cronLimiter(): ReturnType<typeof rateLimit> {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    store: createSharedRateLimitStore(60 * 60 * 1000, 'rl:cron:'),
  })
}

export function collegeRegisterLimiter(): ReturnType<typeof rateLimit> {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    store: createSharedRateLimitStore(60 * 60 * 1000, 'rl:college-register:'),
    message: { error: 'Too many registration attempts, please try again later' },
  })
}
