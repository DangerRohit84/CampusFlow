/**
 * P1 SSE fallback (one-way status when the socket is dead).
 *
 * WHY: the app is socket-first (correct for two-way chat), but corporate
 * firewalls / dead upgrades left one-way status on polling fallbacks (5m
 * counts poll, 30-poll sync wait). SSE is the 2026-consensus one-way
 * transport (HTTP/2 multiplex, EventSource auto-reconnect, no upgrade).
 * Backend streams live at `GET /api/stream/:topic` (see
 * packages/backend/src/routes/stream.ts) with cookie auth (`withCredentials`
 * carries `campusflow_token`, same as the socket).
 *
 * CONTRACT (additive / backward-compat / fail-open):
 * - Socket alive = this module is never used (callers check
 *   `isSocketConnected()` first; 0 SSE traffic on the happy path).
 * - Socket dead = subscribe to the one-way topic; server pushes change-only
 *   events (dirty-flag) + 25s heartbeats; callers keep their existing slow
 *   poll as the final backstop (SSE failure → old behavior, never hangs).
 * - Patches reuse the existing `setQueryData` helpers (counts) and the
 *   baseline compare (sync) — no new cache shapes, idempotent on overlap
 *   (socket reconnect + SSE can briefly coexist; both patch identically).
 * - Never throws (EventSource missing/disabled → null → caller falls back).
 */

export const SSE_TOPICS = {
  PROFILE_SYNC: 'profile-sync',
  STAGING_COUNTS: 'staging-counts',
  NOTIFICATIONS: 'notifications',
} as const

export type SseTopic = (typeof SSE_TOPICS)[keyof typeof SSE_TOPICS]

/** Named wire events per topic (server `event:` field). Pure. */
export function sseEventNames(topic: string): string[] {
  try {
    if (topic === SSE_TOPICS.PROFILE_SYNC) return ['profile-sync:done', 'profile-sync']
    if (topic === SSE_TOPICS.STAGING_COUNTS) return ['staging:counts:updated']
    if (topic === SSE_TOPICS.NOTIFICATIONS) return ['notification:new', 'notification:snapshot']
    return []
  } catch {
    return []
  }
}

/** True for room-targeted sync-done payloads (same shape as the socket push). Pure. */
export function isSseSyncCompletedAfterBaseline(
  payload: { status?: string; completedAt?: string } | null | undefined,
  baseline: number,
): boolean {
  try {
    if (!payload || payload.status !== 'completed') return false
    if (!payload.completedAt) return false
    const t = Date.parse(payload.completedAt)
    if (!Number.isFinite(t)) return false
    return t > baseline
  } catch {
    return false
  }
}

/** Stream URL for a topic (same origin rules as the socket). Pure. */
export function streamUrl(topic: string): string {
  const API_BASE = (import.meta as unknown as { env?: Record<string, string> })?.env?.VITE_API_URL || 'http://localhost:4000'
  const base = String(API_BASE).replace(/\/+$/, '')
  return `${base}/api/stream/${encodeURIComponent(String(topic))}`
}

export type SseHandler = (payload: unknown, event: string) => void

export interface EventSourceLike {
  addEventListener: (type: string, listener: (ev: { data?: string }) => void) => void
  removeEventListener?: (type: string, listener: (...args: unknown[]) => void) => void
  close: () => void
}

function parseSseData(raw: unknown): unknown {
  try {
    if (typeof raw !== 'string' || !raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Subscribe to a one-way SSE topic. Returns a cleanup fn, or null when SSE
 * is unavailable (caller falls back to slow poll). Never throws.
 */
export function subscribeSse(
  topic: string,
  onEvent: SseHandler,
  opts?: {
    eventSourceFactory?: (url: string, init?: { withCredentials?: boolean }) => EventSourceLike | null
    withCredentials?: boolean
  },
): (() => void) | null {
  try {
    const names = sseEventNames(topic)
    if (names.length === 0) return null
    const factory =
      opts?.eventSourceFactory ??
      ((url: string, init?: { withCredentials?: boolean }) => {
        try {
          const ES = (globalThis as unknown as { EventSource?: new (url: string, init?: { withCredentials?: boolean }) => EventSourceLike }).EventSource
          if (typeof ES !== 'function') return null
          return new ES(url, { withCredentials: init?.withCredentials ?? true })
        } catch {
          return null
        }
      })
    let es: EventSourceLike | null = null
    try {
      es = factory(streamUrl(topic), { withCredentials: opts?.withCredentials ?? true })
    } catch {
      es = null
    }
    if (!es) return null
    let cleaned = false
    const listeners: Array<{ name: string; fn: (ev: { data?: string }) => void }> = []
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      try {
        for (const { name, fn } of listeners) {
          try {
            es?.removeEventListener?.(name, fn as (...args: unknown[]) => void)
          } catch {}
        }
      } catch {}
      try {
        es?.close()
      } catch {}
    }
    for (const name of [...names, 'ready']) {
      const fn = (ev: { data?: string }) => {
        try {
          if (cleaned) return
          onEvent(parseSseData(ev?.data), name)
        } catch {}
      }
      try {
        es.addEventListener(name, fn)
        listeners.push({ name, fn })
      } catch {}
    }
    return cleanup
  } catch {
    return null
  }
}

export type SseSyncResult = {
  completed: boolean
  payload?: unknown
  timedOut?: boolean
}

/**
 * Wait for ONE `profile-sync:done` SSE push past baseline (no polling).
 * Mirrors `waitForCodingSyncViaSocket` (same result shape) so callers can
 * chain socket → SSE → legacy poll. Cleans up the stream in all paths.
 */
export function waitForCodingSyncViaSse(
  baseline: number,
  opts?: {
    timeoutMs?: number
    subscribe?: typeof subscribeSse
  },
): Promise<SseSyncResult> {
  const timeoutMs = opts?.timeoutMs ?? 60_000
  const subscribe = opts?.subscribe ?? subscribeSse
  return new Promise((resolve) => {
    let settled = false
    let cleanup: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const done = (result: SseSyncResult) => {
      if (settled) return
      settled = true
      try {
        if (timer) clearTimeout(timer)
      } catch {}
      try {
        cleanup?.()
      } catch {}
      resolve(result)
    }
    let off: (() => void) | null = null
    try {
      off = subscribe(SSE_TOPICS.PROFILE_SYNC, (payload, event) => {
        try {
          if (event !== 'profile-sync:done' && event !== 'profile-sync') return
          if (isSseSyncCompletedAfterBaseline(payload as { status?: string; completedAt?: string }, baseline)) {
            done({ completed: true, payload })
          }
        } catch {}
      })
      cleanup = off
    } catch {
      off = null
    }
    if (!off) {
      done({ completed: false, timedOut: true })
      return
    }
    timer = setTimeout(() => {
      done({ completed: false, timedOut: true })
    }, timeoutMs)
    try {
      ;(timer as unknown as { unref?: () => void }).unref?.()
    } catch {}
  })
}
