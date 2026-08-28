import crypto from 'crypto'
import type { Request, Response, NextFunction } from 'express'

/**
 * High-scale pattern: GitHub/Cloudflare per-page weak ETag + CDN SWR
 * - Computes W/"<md5-json>" per response
 * - Honors If-None-Match → 304 Not Modified (bandwidth saved, like GitHub pagination)
 * - Adds CDN-aware Cache-Control if route didn't set one: s-maxage for edge, stale-while-revalidate
 * - Sets Vary so CDN keys on Accept-Encoding + Authorization (user-scoped data not shared cross-user incorrectly)
 *
 * Applied globally but only for GET JSON success responses. Cheap: O(n) hash per response,
 * still wins vs re-sending 50kb payload on 304 (~99% saving on poll-heavy pages).
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

    try {
      const payloadStr = JSON.stringify(body)
      // Don't hash huge payloads (>500kb stringified) — just set CDN headers and return
      if (payloadStr.length > 500_000) {
        if (!res.getHeader('Cache-Control')) {
          res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60, s-maxage=120')
          res.setHeader('Vary', 'Accept-Encoding, Authorization')
        }
        return originalJson(body)
      }

      const hash = crypto.createHash('md5').update(payloadStr).digest('hex')
      const etag = `W/"${hash}"`
      res.setHeader('ETag', etag)

      // Default CDN SWR if route didn't set Cache-Control (most list routes already set fine-grained ones)
      if (!res.getHeader('Cache-Control')) {
        // Edge caches 2min, serves stale up to 5min while revalidating — Vercel/Cloudflare SWR pattern
        res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60, s-maxage=120, stale-while-revalidate=300')
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
