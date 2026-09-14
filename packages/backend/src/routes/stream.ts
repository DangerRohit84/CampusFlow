/**
 * P1 (SSE fallback for one-way status) + P2-3: Server-Sent Events for
 * one-way feeds (profile-sync status, staging counts, notifications).
 *
 * WHY: frontend is socket-first (correct for two-way chat), but corporate
 * firewalls / dead upgrades leave one-way status on polling fallbacks (5m
 * counts poll, 30-poll sync wait). SSE is the 2026-consensus transport for
 * one-way server→client status: HTTP/2 multiplex, auto-reconnect via
 * EventSource, no upgrade/proxy issues. Frontend prefers WS and falls back
 * to THESE endpoints only when the socket is dead (see
 * apps/web/src/lib/sseFallback.ts) — socket alive = 0 SSE traffic.
 *
 * CONTRACT (additive / backward-compat / fail-open):
 * - NEW router only (`GET /api/stream/:topic`); no existing route touched.
 * - Topics allow-listed (`profile-sync`, `staging-counts`, `notifications`);
 *   unknown topic → 404 (no topic enumeration beyond the allow-list).
 * - `authenticate` (cookie `campusflow_token` works with EventSource
 *   `withCredentials`; Bearer also accepted) + per-tenant scoping on every
 *   poll (college scope for counts, userId for sync/notifications — never
 *   cross-tenant, same rules as the REST routes).
 * - Dirty-flag pushes only: server polls lightweight state every 15s and
 *   emits an event ONLY on change (hash/baseline compare) + 25s heartbeat
 *   comments (LB idle guard). No per-tick GET equivalent on the client.
 * - Any DB error → keep the stream open with heartbeats (fail-open, never
 *   500 mid-stream); client slow-poll still covers.
 * - Never throws after headers are sent (all pollers try/catch).
 */

import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import { scopeForUser } from '../services/stagingCounts'

/** Stable hash for SSE dirty-flag comparison (sorted keys). Pure. */
export function streamPayloadHash(payload: Record<string, unknown>): string {
  try {
    const ordered: Record<string, unknown> = {}
    for (const k of Object.keys(payload || {}).sort()) ordered[k] = (payload as Record<string, unknown>)[k]
    return crypto.createHash('md5').update(JSON.stringify(ordered)).digest('hex')
  } catch {
    return 'error'
  }
}

export const STREAM_TOPICS = ['profile-sync', 'staging-counts', 'notifications'] as const
export type StreamTopic = (typeof STREAM_TOPICS)[number]

/** Allow-list check for stream topics. Pure, never throws. */
export function isAllowedStreamTopic(topic: unknown): topic is StreamTopic {
  try {
    return typeof topic === 'string' && (STREAM_TOPICS as readonly string[]).includes(topic)
  } catch {
    return false
  }
}

/** SSE event wire format. Pure, never throws (control chars stripped). */
export function formatSseEvent(event: string, data: unknown, id?: string | number): string {
  try {
    const safeEvent = String(event || 'message').replace(/[\r\n]/g, '').slice(0, 120) || 'message'
    let payload = ''
    try {
      payload = typeof data === 'string' ? data : JSON.stringify(data ?? null)
    } catch {
      payload = 'null'
    }
    const safeData = String(payload).split('\n').map((l) => `data: ${l}`).join('\n')
    const safeId = id === undefined || id === null ? '' : `id: ${String(id).replace(/[\r\n]/g, '').slice(0, 80)}\n`
    return `event: ${safeEvent}\n${safeId}${safeData}\n\n`
  } catch {
    return 'event: message\ndata: null\n\n'
  }
}

/** SSE response headers (no-cache, no buffering). Pure. */
export function sseHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  }
}

/** Poll cadence for change detection (15s: status-grade, not chat-grade). */
export const STREAM_POLL_MS = 15_000
/** Heartbeat comment cadence (keeps LB/proxy idle timers from killing the stream). */
export const STREAM_HEARTBEAT_MS = 25_000

type StreamContext = {
  req: Request
  res: Response
  userId: string
  topic: StreamTopic
  closed: boolean
  timer: ReturnType<typeof setInterval> | null
  heartbeat: ReturnType<typeof setInterval> | null
  seq: number
}

function sendEvent(ctx: StreamContext, event: string, data: unknown): void {
  if (ctx.closed) return
  try {
    ctx.seq++
    ctx.res.write(formatSseEvent(event, data, ctx.seq))
  } catch {}
}

function teardown(ctx: StreamContext): void {
  ctx.closed = true
  try {
    if (ctx.timer) clearInterval(ctx.timer)
  } catch {}
  try {
    if (ctx.heartbeat) clearInterval(ctx.heartbeat)
  } catch {}
  ctx.timer = null
  ctx.heartbeat = null
  try {
    ctx.res.end()
  } catch {}
}

async function snapshotProfileSync(userId: string): Promise<{ lastSyncedAt: string | null; lastSyncError: string | null }> {
  try {
    const row: { lastSyncedAt?: Date | null; lastSyncError?: string | null } | null =
      await (prisma as unknown as {
        codingProfile: { findUnique: (args: unknown) => Promise<{ lastSyncedAt?: Date | null; lastSyncError?: string | null } | null> }
      }).codingProfile.findUnique({ where: { userId }, select: { lastSyncedAt: true, lastSyncError: true } })
    if (!row) return { lastSyncedAt: null, lastSyncError: null }
    return {
      lastSyncedAt: row.lastSyncedAt ? new Date(row.lastSyncedAt).toISOString() : null,
      lastSyncError: typeof row.lastSyncError === 'string' ? row.lastSyncError.slice(0, 500) : null,
    }
  } catch {
    return { lastSyncedAt: null, lastSyncError: null }
  }
}

async function snapshotStagingCounts(scope: string): Promise<Record<string, number> | null> {
  // Narrow groupBy counts (same numbers as the REST counts endpoints, no rows).
  // Global scope counts all staging; college scope filters collegeId (same
  // rule as routes/hackathons counts). Fail-open null on any DB error.
  try {
    const isGlobal = scope === 'global'
    const hackWhere: Record<string, unknown> = isGlobal ? {} : { collegeId: scope.startsWith('college:') ? scope.slice('college:'.length) : null }
    const intWhere: Record<string, unknown> = { ...(hackWhere as object) }
    const [hackGroups, intGroups] = await Promise.all([
      (prisma as unknown as { hackathonStaging: { groupBy: (args: unknown) => Promise<Array<{ status: string; _count: { status: number } }>> } }).hackathonStaging.groupBy({
        by: ['status'],
        where: hackWhere,
        _count: { status: true },
      }),
      (prisma as unknown as { internshipStaging: { groupBy: (args: unknown) => Promise<Array<{ status: string; _count: { status: number } }>> } }).internshipStaging.groupBy({
        by: ['status'],
        where: intWhere,
        _count: { status: true },
      }),
    ])
    const counts: Record<string, number> = { hackPending: 0, hackApproved: 0, hackRejected: 0, intPending: 0, intApproved: 0, intRejected: 0 }
    for (const g of hackGroups || []) {
      const n = g?._count?.status ?? 0
      if (g?.status === 'PENDING' || g?.status === 'DRAFT') counts.hackPending += n
      else if (g?.status === 'APPROVED') counts.hackApproved += n
      else if (g?.status === 'REJECTED') counts.hackRejected += n
    }
    for (const g of intGroups || []) {
      const n = g?._count?.status ?? 0
      if (g?.status === 'PENDING' || g?.status === 'DRAFT') counts.intPending += n
      else if (g?.status === 'APPROVED') counts.intApproved += n
      else if (g?.status === 'REJECTED') counts.intRejected += n
    }
    return counts
  } catch {
    return null
  }
}

async function snapshotUnreadCount(userId: string): Promise<number | null> {
  try {
    const n: number = await (prisma as unknown as { notification: { count: (args: unknown) => Promise<number> } }).notification.count({
      where: { userId, read: false },
    })
    return typeof n === 'number' ? n : null
  } catch {
    return null
  }
}

const router = Router()

/**
 * GET /api/stream/:topic — SSE fallback stream (authenticated).
 * Emits `ready` immediately, then change-only events:
 *  - profile-sync: `profile-sync:done` {status:'completed', completedAt}
 *    when lastSyncedAt advances past the connection baseline.
 *  - staging-counts: `staging:counts:updated` {counts} on hash change.
 *  - notifications: `notification:new` {unread} on unread-count change.
 */
router.get('/:topic', authenticate, async (req: AuthRequest, res: Response) => {
  const topic = String(req.params.topic || '')
  if (!isAllowedStreamTopic(topic)) {
    res.status(404).json({ error: 'Stream not found' })
    return
  }
  const userId = String(req.userId || '')
  if (!userId) {
    res.status(401).json({ error: 'No token provided' })
    return
  }
  try {
    for (const [k, v] of Object.entries(sseHeaders())) res.setHeader(k, v)
    // Explicit 200 before the first write (proxies buffer otherwise).
    res.status(200)
    if (typeof (res as unknown as { flushHeaders?: () => void }).flushHeaders === 'function') {
      try {
        ;(res as unknown as { flushHeaders: () => void }).flushHeaders()
      } catch {}
    }
  } catch {
    return
  }

  const ctx: StreamContext = { req, res, userId, topic, closed: false, timer: null, heartbeat: null, seq: 0 }
  try {
    req.on('close', () => teardown(ctx))
  } catch {}

  // Ready snapshot (client uses it as the SSE-is-alive signal).
  sendEvent(ctx, 'ready', { topic, at: new Date().toISOString() })

  try {
    if (topic === 'profile-sync') {
      let baseline = await snapshotProfileSync(userId)
      ctx.timer = setInterval(async () => {
        if (ctx.closed) return
        try {
          const cur = await snapshotProfileSync(userId)
          const prevT = baseline.lastSyncedAt ? Date.parse(baseline.lastSyncedAt) : 0
          const curT = cur.lastSyncedAt ? Date.parse(cur.lastSyncedAt) : 0
          if (Number.isFinite(curT) && curT > prevT) {
            sendEvent(ctx, 'profile-sync:done', { status: 'completed', completedAt: cur.lastSyncedAt, lastSyncError: cur.lastSyncError })
          }
          baseline = cur
        } catch {}
      }, STREAM_POLL_MS)
    } else if (topic === 'staging-counts') {
      // Scope mirrors the REST counts endpoints (SUPER_ADMIN → global).
      let scope = 'global'
      try {
        const u: { role?: string; collegeId?: string | null } | null = await prisma.user.findUnique({
          where: { id: userId },
          select: { role: true, collegeId: true },
        })
        scope = scopeForUser(u as { role?: string; collegeId?: string | null } | null)
      } catch {}
      let lastHash: string | null = null
      try {
        const first = await snapshotStagingCounts(scope)
        if (first) {
          lastHash = streamPayloadHash(first)
          sendEvent(ctx, 'staging:counts:updated', { counts: first })
        }
      } catch {}
      ctx.timer = setInterval(async () => {
        if (ctx.closed) return
        try {
          const cur = await snapshotStagingCounts(scope)
          if (!cur) return
          const h = streamPayloadHash(cur)
          if (h !== lastHash) {
            lastHash = h
            sendEvent(ctx, 'staging:counts:updated', { counts: cur })
          }
        } catch {}
      }, STREAM_POLL_MS)
    } else {
      let lastUnread: number | null = null
      try {
        lastUnread = await snapshotUnreadCount(userId)
        if (lastUnread !== null) sendEvent(ctx, 'notification:snapshot', { unread: lastUnread })
      } catch {}
      ctx.timer = setInterval(async () => {
        if (ctx.closed) return
        try {
          const cur = await snapshotUnreadCount(userId)
          if (cur === null) return
          if (lastUnread === null || cur !== lastUnread) {
            lastUnread = cur
            sendEvent(ctx, 'notification:new', { unread: cur })
          }
        } catch {}
      }, STREAM_POLL_MS)
    }
  } catch {
    // Poller setup failed — heartbeats still keep the stream useful (ready
    // was already sent; client slow-poll covers). Never 500 mid-stream.
  }
  try {
    if (ctx.timer && typeof (ctx.timer as unknown as { unref?: () => void }).unref === 'function') {
      ;(ctx.timer as unknown as { unref: () => void }).unref()
    }
  } catch {}

  // Heartbeat comments (colon-prefixed, ignored by EventSource dispatch).
  ctx.heartbeat = setInterval(() => {
    if (ctx.closed) return
    try {
      res.write(': heartbeat\n\n')
    } catch {}
  }, STREAM_HEARTBEAT_MS)
  try {
    if (typeof (ctx.heartbeat as unknown as { unref?: () => void }).unref === 'function') {
      ;(ctx.heartbeat as unknown as { unref: () => void }).unref()
    }
  } catch {}
})

export default router
