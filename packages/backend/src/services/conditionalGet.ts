/**
 * P0-D selective 304: shared weak-ETag + If-None-Match for idempotent lists.
 *
 * WHY: every authenticated list GET recomputed MD5 + hit Postgres (etagCache
 * is `private,no-store`, never 304 for authed XHR). P0-B memoized bodies in
 * Redis (5m getOrSet) so a cache HIT already avoids Postgres — but still
 * ships full bytes. This module adds the validator layer: stable
 * `W/"md5(body)"` per memoized body + `If-None-Match` compare BEFORE
 * `res.json`, so validators HIT → `304 end()` (40-60% bytes saved, 0 DB).
 *
 * Scope (P0-6): ONLY 4 idempotent list families —
 *   GET /api/contests*, /api/hackathons*, /api/internships*,
 *   /api/coding-problems/sheets|daily.
 * Everything else keeps `private,no-store` + never-304 (state-sync fix:
 * axios surfaces 304 as ERR_NOT_MODIFIED; generic 304 caused split-brain).
 * Callers catch ERR_NOT_MODIFIED → return cached RQ data (P0-A precedent).
 *
 * Rules: additive/backward-compat, fail-open (any error → res.json(body),
 * never 500), no secrets (hashes only), tenant-safe (ETag is per memoized
 * tenant-segmented body — never cross-tenant because keys are segmented).
 */
import crypto from 'crypto';
import type { Request, Response } from 'express';

/** Stable weak ETag for a JSON body. Pure, never throws (garbage → zero hash). */
export function buildListEtag(body: unknown): string {
  try {
    const str = JSON.stringify(body ?? null);
    const hash = crypto.createHash('md5').update(str).digest('hex');
    return `W/"${hash}"`;
  } catch {
    return 'W/"00000000000000000000000000000000"';
  }
}

/** True when the client's If-None-Match covers the fresh ETag. Never throws. */
export function isNotModified(
  ifNoneMatch: string | string[] | null | undefined,
  etag: string,
): boolean {
  try {
    if (!ifNoneMatch || !etag) return false;
    const values = Array.isArray(ifNoneMatch) ? ifNoneMatch : [ifNoneMatch];
    for (const raw of values) {
      if (!raw) continue;
      const s = String(raw);
      if (s === etag) return true;
      const parts = s
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.includes(etag)) return true;
      // Weak comparison: W/"x" matches "x" and vice versa (RFC 7232).
      const bare = etag.replace(/^W\//, '');
      if (parts.includes(bare) || parts.includes(`W/${bare}`)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export interface ConditionalListOptions {
  /** Browser cache window for these idempotent lists (default 60s + SWR 30s). */
  cacheControl?: string;
  vary?: string;
}

/**
 * Send a memoized list body with ETag + 304 short-circuit.
 * - Sets ETag + Cache-Control + Vary + X-Cache (when provided by caller).
 * - When If-None-Match matches → `304 end()` (no body, no extra DB — the
 *   caller already served from Redis memo).
 * - Otherwise `res.json(body)`.
 * Returns true when 304 was sent, false when JSON was sent.
 * Never throws (fail-open to res.json).
 */
export function sendConditionalList(
  req: Request,
  res: Response,
  body: unknown,
  opts?: ConditionalListOptions & { cacheHit?: boolean },
): boolean {
  try {
    const etag = buildListEtag(body);
    try {
      res.setHeader('ETag', etag);
    } catch {}
    try {
      if (!res.getHeader('Cache-Control')) {
        res.setHeader(
          'Cache-Control',
          opts?.cacheControl ?? 'private, max-age=60, stale-while-revalidate=30',
        );
      }
    } catch {}
    try {
      if (!res.getHeader('Vary')) {
        res.setHeader('Vary', opts?.vary ?? 'Authorization, Accept-Encoding');
      }
    } catch {}
    try {
      if (typeof opts?.cacheHit === 'boolean' && !res.getHeader('X-Cache')) {
        res.setHeader('X-Cache', opts.cacheHit ? 'HIT' : 'MISS');
      }
    } catch {}
    let inm: string | string[] | undefined;
    try {
      inm = req.headers['if-none-match'] as string | string[] | undefined;
    } catch {
      inm = undefined;
    }
    if (isNotModified(inm ?? null, etag)) {
      try {
        res.status(304);
        res.end();
      } catch {}
      return true;
    }
    try {
      res.json(body);
    } catch {}
    return false;
  } catch {
    try {
      res.json(body);
    } catch {}
    return false;
  }
}
