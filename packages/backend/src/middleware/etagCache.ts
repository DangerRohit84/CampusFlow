import crypto from 'crypto'
import type { Request, Response, NextFunction } from 'express'

/**
 * High-scale pattern: GitHub/Cloudflare per-page weak ETag + private SWR
 * - Computes W/"<md5-json>" per response
 * - Honors If-None-Match → 304 Not Modified (bandwidth saved, like GitHub pagination)
 * - P0 SECURITY (F11): authenticated JSON must NEVER be `public` / `s-maxage`
 *   (CDN would serve tenant A's data to tenant B). Default is `private`
 *   so only the browser caches. Public caching is opt-in per-route for
 *   truly public endpoints (/health, /colleges/list) which set their own header.
 * - Sets Vary so caches key on Accept-Encoding + Authorization
 *
 * SCALE10k (ETag store evaluated — no migration, by design):
 * - This middleware is STATELESS: the ETag is md5(body) recomputed per
 *   response on whichever replica handles the request. There is no
 *   cross-instance ETag map to share (unlike rate-limit/authorize/throttle).
 * - Authenticated /api GETs never 304 (private, no-store) so replicas agree
 *   trivially; anon public GETs may 304 based on the client's If-None-Match
 *   vs the freshly computed hash — also replica-independent. No Redis needed.
 *
 * STATE-SYNC FIX (stale-state root cause):
 * - React Query is the single source of truth on the client (staleTime 2-3min
 *   + explicit invalidation on every mutation). A SECOND browser HTTP cache
 *   (private, max-age=15) created split-brain: RQ invalidate → refetch → browser
 *   served the 15s-old HTTP-cached copy without hitting the server, so
 *   CREATE/UPDATE/DELETE appeared to "require refresh". Worse, axios XHR
 *   surfaces HTTP 304 as status 304 (outside 2xx validateStatus) with an empty
 *   body, so post-stale-window refetches errored and RQ kept placeholderData.
 * - Fix: authenticated /api GETs are `private, no-store` — every RQ refetch
 *   hits the server, ETag is still sent for observability but NEVER 304.
 *   Truly public endpoints (no Authorization header) keep the SWR window.
 */
export function etagCacheMiddleware(req: Request, res: Response, next: NextFunction) {
  const originalJson = (res.json as unknown as (body: any) => Response).bind(res)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(res as any).json = (body: any) => {
    // Only handle GET 2xx JSON; skip errors, mutations, streams/blob exports
    if (req.method !== 'GET') return originalJson(body)
    const status = res.statusCode
    if (status < 200 || status >= 300) return originalJson(body)
    // Skip if already has ETag (route-level custom)
    if (res.getHeader('ETag')) return originalJson(body)
    // Skip empty/blob-like bodies that shouldn't be hashed (e.g., export endpoints use res.send not res.json)
    if (body === undefined || body === null) return originalJson(body)

    // Authenticated API responses must never sit in the browser HTTP cache.
    // React Query owns caching; a second HTTP-cache layer causes stale reads
    // after mutations (RQ refetch served from HTTP cache, not the server).
    const isAuthenticatedApi =
      (req.originalUrl || req.url || '').startsWith('/api') &&
      !!req.headers.authorization
    if (isAuthenticatedApi) {
      try {
        const payloadStr = JSON.stringify(body)
        if (payloadStr.length <= 500_000) {
          const hash = crypto.createHash('md5').update(payloadStr).digest('hex')
          res.setHeader('ETag', `W/"${hash}"`)
        }
      } catch {}
      if (!res.getHeader('Cache-Control')) {
        res.setHeader('Cache-Control', 'private, no-store, max-age=0')
        res.setHeader('Vary', 'Accept-Encoding, Authorization')
      }
      // Never 304 for authenticated XHR — axios treats 304 as an error with
      // an empty body, which left RQ showing placeholderData (stale) forever.
      return originalJson(body)
    }

    try {
      const payloadStr = JSON.stringify(body)
      // Don't hash huge payloads (>500kb stringified) — just set private headers and return
      if (payloadStr.length > 500_000) {
        if (!res.getHeader('Cache-Control')) {
          res.setHeader('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
          res.setHeader('Vary', 'Accept-Encoding, Authorization')
        }
        return originalJson(body)
      }

      const hash = crypto.createHash('md5').update(payloadStr).digest('hex')
      const etag = `W/"${hash}"`
      res.setHeader('ETag', etag)

      // Default private SWR if route didn't set Cache-Control (most list routes already set fine-grained ones).
      // NEVER public/s-maxage here: this middleware wraps authenticated routes; edge caching
      // cross-tenant JSON is a PII leak (F11). Public endpoints set their own header explicitly.
      if (!res.getHeader('Cache-Control')) {
        // Browser caches 15s, serves stale up to 30s while revalidating — no shared-edge storage.
        res.setHeader('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
      }
      // Ensure CDN varies correctly (avoids leaking user A data to user B from edge)
      if (!res.getHeader('Vary')) {
        res.setHeader('Vary', 'Accept-Encoding, Authorization')
      }

      const inm = req.headers['if-none-match']
      if (inm && (inm === etag || (typeof inm === 'string' && inm.split(',').map(s => s.trim()).includes(etag)))) {
        res.status(304)
        return res.end()
      }
    } catch {
      // hashing failure should never break response — fall through
    }

    return originalJson(body)
  }

  next()
}
