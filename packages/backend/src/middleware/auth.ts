import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { config } from '../config'
import { isJtiRevoked } from '../utils/authHardening'
import prisma from '../config/db'
import { getRedisClient, redisDel, redisGet, redisSet } from '../lib/redis'

export interface AuthRequest extends Request {
  userId?: string
  jwtJti?: string
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  // Dual-issuance compat (AUTH-HTTPONLY-PLAN.md step 1): prefer Bearer, fall back
  // to HttpOnly cookie `campusflow_token`. Frontend still sends Bearer (no break);
  // cookie path enables gradual migration to memory-only + HttpOnly refresh.
  // Requires `cookie-parser` if cookies are signed; we read raw header to avoid
  // new dep: parse `cookie` header manually for `campusflow_token`.
  const authHeader = req.headers.authorization
  let token: string | undefined
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1]
  } else {
    try {
      const rawCookie = (req.headers as any).cookie as string | undefined
      if (rawCookie) {
        const m = rawCookie.match(/(?:^|;\s*)campusflow_token=([^;]+)/)
        if (m && m[1]) token = decodeURIComponent(m[1].trim())
      }
      // Express may have parsed cookies via middleware if installed:
      const parsed = (req as any).cookies?.campusflow_token as string | undefined
      if (!token && parsed) token = String(parsed)
    } catch {}
  }

  if (!token) {
    res.status(401).json({ error: 'No token provided' })
    return
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { userId: string; jti?: string }
    // jti revocation stub (logout / password-change revokes; see authHardening.ts + RevokedToken model)
    if (decoded.jti && isJtiRevoked(decoded.jti)) {
      res.status(401).json({ error: 'Token revoked' })
      return
    }
    req.userId = decoded.userId
    req.jwtJti = decoded.jti
    next()
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' })
  }
}

/**
 * authorize() role cache — 10k scale (Redis-shared with L1 memory fallback).
 * DB authorize() was N+1 per authenticated request (findUnique on every
 * authorize() call). Cache role per userId 60s (L1 LRU max 1000 keys +
 * shared Redis `authz:{userId}` with 60s PX).
 * Single lookup: select { id, role, collegeId } only (not full user row).
 * Stale window 60s is safe: role changes are rare + admin UI forces
 * re-login; cache can be cleared via clearAuthorizeCache() on role update
 * (clears L1 + Redis best-effort).
 * Behavior identical single-instance (L1 hit, no Redis needed); correct
 * multi-instance (L1 miss → shared Redis → DB). All Redis failures fail
 * open to L1/DB — auth never 500s on a cache blip.
 */
const AUTHORIZE_TTL_MS = 60_000
const AUTHORIZE_MAX_KEYS = 1000
const AUTHORIZE_REDIS_PREFIX = 'authz:'

export interface AuthorizeEntry {
  role: string
  collegeId?: string | null
}

/** Factory for authorize LRU (I-3: testable, no module-global in new code). */
export function createAuthorizeCache(maxKeys = AUTHORIZE_MAX_KEYS, ttlMs = AUTHORIZE_TTL_MS) {
  const store = new Map<string, { role: string; expiresAt: number }>()
  return {
    get(userId: string): string | null {
      const e = store.get(userId)
      if (!e) return null
      if (Date.now() > e.expiresAt) {
        store.delete(userId)
        return null
      }
      store.delete(userId)
      store.set(userId, e)
      return e.role
    },
    set(userId: string, role: string): void {
      if (store.size >= maxKeys) {
        const oldest = store.keys().next()
        if (!oldest.done) store.delete(oldest.value)
      }
      store.set(userId, { role, expiresAt: Date.now() + ttlMs })
    },
    clear(userId?: string): void {
      if (userId) store.delete(userId)
      else store.clear()
    },
    get size(): number {
      return store.size
    },
  }
}

/** Default process-local singleton (compat). Prefer DI in new code. */
export type AuthorizeCache = ReturnType<typeof createAuthorizeCache>
const defaultAuthorizeCache: AuthorizeCache = createAuthorizeCache()
const authorizeCache: AuthorizeCache = defaultAuthorizeCache

function authorizeRedisKey(userId: string): string {
  return `${AUTHORIZE_REDIS_PREFIX}${userId}`
}

function getCachedRole(userId: string): string | null {
  return authorizeCache.get(userId)
}

function setCachedRole(userId: string, role: string, collegeId?: string | null): void {
  authorizeCache.set(userId, role)
  // Write-through to shared Redis (best-effort, never blocks auth).
  // .catch lands the commandTimeout rejection in a handler — bare `void`
  // without catch would surface as UNHANDLED and kill Node (exit 1).
  try {
    if (getRedisClient()) {
      void redisSet(authorizeRedisKey(userId), { role, collegeId: collegeId ?? null } satisfies AuthorizeEntry, AUTHORIZE_TTL_MS).catch(() => {})
    }
  } catch {}
}

/** Shared read: L1 → Redis → null (caller falls through to DB). Never throws. */
async function getSharedRole(userId: string): Promise<AuthorizeEntry | null> {
  const l1 = authorizeCache.get(userId)
  if (l1) return { role: l1 }
  try {
    if (!getRedisClient()) return null
    const hit = await redisGet<AuthorizeEntry | string>(authorizeRedisKey(userId))
    if (!hit) return null
    if (typeof hit === 'string') {
      authorizeCache.set(userId, hit)
      return { role: hit }
    }
    if (hit && typeof (hit as AuthorizeEntry).role === 'string') {
      authorizeCache.set(userId, (hit as AuthorizeEntry).role)
      return hit as AuthorizeEntry
    }
    return null
  } catch {
    return null
  }
}

/** Reset authorize cache for tests (teardown). */
export function resetAuthorizeCacheForTests(): void {
  defaultAuthorizeCache.clear()
}

/** Clear authorize cache (call after role updates + in tests). Clears L1 + Redis best-effort. */
export function clearAuthorizeCache(userId?: string): void {
  authorizeCache.clear(userId)
  try {
    if (!getRedisClient()) return
    if (userId) void redisDel(authorizeRedisKey(userId)).catch(() => {})
    // No global clear: shared Redis holds other tenants' entries (per-key TTL
    // expires them); flushing would wipe prod. L1 clear-all is enough locally.
  } catch {}
}

export function authorize(roles: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(403).json({ error: 'Insufficient permissions' })
        return
      }
      // Fast path: L1 cached role (no DB hit, no Redis hit)
      const cached = getCachedRole(req.userId)
      if (cached) {
        if (!roles.includes(cached)) {
          res.status(403).json({ error: 'Insufficient permissions' })
          return
        }
        next()
        return
      }
      // Shared path: Redis (cross-instance, no DB hit)
      const shared = await getSharedRole(req.userId)
      if (shared) {
        if (!roles.includes(shared.role)) {
          res.status(403).json({ error: 'Insufficient permissions' })
          return
        }
        next()
        return
      }
      // Single minimal lookup (id+role+college only, not full row)
      const user = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { id: true, role: true, collegeId: true },
      })
      if (!user || !roles.includes(user.role)) {
        res.status(403).json({ error: 'Insufficient permissions' })
        return
      }
      setCachedRole(req.userId, user.role, (user as { collegeId?: string | null }).collegeId ?? null)
      next()
    } catch (error) {
      res.status(500).json({ error: 'Authorization check failed' })
    }
  }
}