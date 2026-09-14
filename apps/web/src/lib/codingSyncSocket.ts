/**
 * P0-A: coding sync via room-targeted socket push (kill 2s×30 poll).
 *
 * WHY: 1 manual sync = 1 POST + up to 30 GETs (60s window). Backend already
 * pushes `profile-sync` {status:completed, completedAt} to `user:{id}` plus
 * `coding:profile:mutated` for lists. Frontend ignored the push and polled.
 * Now: wait for the room push, then do a SINGLE fetch to hydrate.
 * Fail-open: socket dead/timeout => caller falls back to a single fetch
 * (or legacy poll) — never hangs, never breaks old behavior.
 */

export const PROFILE_SYNC_DONE_EVENTS = ['profile-sync', 'profile-sync:done'] as const

export type SyncSocketLike = {
  connected?: boolean
  on: (event: string, fn: (payload: any) => void) => void
  off: (event: string, fn: (payload: any) => void) => void
}

/** True for room-targeted sync-done pushes (legacy + alias). */
export function isProfileSyncDoneEvent(event: string): boolean {
  return (PROFILE_SYNC_DONE_EVENTS as readonly string[]).includes(event)
}

/** True only when the push completed AFTER the caller's baseline. */
export function isSyncCompletedAfterBaseline(
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

export type SocketSyncResult = {
  completed: boolean
  payload?: any
  timedOut?: boolean
}

/**
 * Wait for ONE room-targeted push (no polling). Listens to both
 * `profile-sync` and `profile-sync:done`, resolves on the first push whose
 * completedAt advances past baseline. Cleans up listeners in all paths.
 */
export function waitForCodingSyncViaSocket(
  baseline: number,
  opts?: { socket?: SyncSocketLike | null; timeoutMs?: number },
): Promise<SocketSyncResult> {
  const socket = opts?.socket ?? null
  const timeoutMs = opts?.timeoutMs ?? 60_000
  return new Promise((resolve) => {
    if (!socket) {
      resolve({ completed: false, timedOut: true })
      return
    }
    let settled = false
    const done = (result: SocketSyncResult) => {
      if (settled) return
      settled = true
      try {
        for (const ev of PROFILE_SYNC_DONE_EVENTS) {
          try {
            socket.off(ev, onPush)
          } catch {}
        }
      } catch {}
      try {
        if (timer) clearTimeout(timer)
      } catch {}
      resolve(result)
    }
    const onPush = (payload: any) => {
      try {
        if (isSyncCompletedAfterBaseline(payload, baseline)) {
          done({ completed: true, payload })
        }
      } catch {}
    }
    try {
      for (const ev of PROFILE_SYNC_DONE_EVENTS) {
        socket.on(ev, onPush)
      }
    } catch {
      done({ completed: false, timedOut: true })
      return
    }
    const timer = setTimeout(() => {
      done({ completed: false, timedOut: true })
    }, timeoutMs)
    // Unref in Node/vitest so the timer never holds the process open.
    try {
      ;(timer as unknown as { unref?: () => void }).unref?.()
    } catch {}
  })
}
