/**
 * P0-A: admin counts socket push (kill 60s poll -> setQueryData).
 *
 * WHY: counts change ~2×/day (cron) + rare approve/reject, but every open
 * admin tab polled 2 GETs every 60s (1440/day/tab). Server now busts the
 * 60s cache on staging mutations (fail-open TTL otherwise) and the client
 * patches RQ via setQueryData on `staging:counts:updated` (0 GET).
 * Fallback is a 5m slow poll + ETag 304 when the socket is dead.
 *
 * Backward-compat: generic `hackathon:mutated`/`internship:mutated` still
 * invalidate via the canonical bridge (RELATED) — this hook ADDS the
 * zero-GET patch path without removing the old refetch path.
 */
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { qk } from '../lib/queryKeys'
import { getSocket } from '../lib/socket'
import { SSE_TOPICS, subscribeSse } from '../lib/sseFallback'
import {
  STAGING_COUNTS_EVENT,
  mergeStagingCounts,
  type AdminCountsShape,
} from '../lib/queryDiscipline'
import { logger } from '../lib/logger'

export function useAdminCountsPush(enabled = true) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!enabled) return
    let cleanup = false
    let socket: ReturnType<typeof getSocket> = null
    try {
      socket = getSocket()
    } catch {
      socket = null
    }
    const patchFrom = (payload: any, fallbackKind: 'hack' | 'int' | null) => {
      try {
        // Full aggregate wins verbatim (server dirty-flag push, 0 GET).
        if (payload?.counts) return { counts: payload.counts as AdminCountsShape }
        // Per-kind optimistic patch (approve/reject/delete/created, 0 GET).
        // `fetched:0` (no change) and assign/bulk-assign (counts unchanged)
        // are ignored — server emits only on change (bust gated the same way).
        const action = String(payload?.action ?? '')
        if (action === 'fetched' && Number(payload?.fetched ?? 0) <= 0) return null
        if (
          action === 'staging:assigned' ||
          action === 'staging:bulk-assigned' ||
          action === 'staging:updated'
        ) {
          return null
        }
        const kind =
          payload?.kind ?? fallbackKind ?? (action ? fallbackKind : null)
        if ((kind === 'hack' || kind === 'int') && action) {
          return { kind, action } as const
        }
        return null
      } catch {
        return null
      }
    }
    const applyPatch = (payload: any, fallbackKind: 'hack' | 'int' | null) => {
      if (cleanup) return
      const patch = patchFrom(payload, fallbackKind)
      if (!patch) return
      try {
        queryClient.setQueryData(qk.adminCounts(), (old: unknown) =>
          mergeStagingCounts(old as AdminCountsShape, patch as any),
        )
      } catch (err) {
        logger.debug('[adminCountsPush] patch failed (non-fatal, slow poll covers)', { err })
      }
    }
    const onCounts = (payload: any) => applyPatch(payload, null)
    // Generic mutated events carry {action} without kind — kind is implied by
    // the event name (hackathon:* => hack, internship:* => int).
    const onHack = (payload: any) => applyPatch(payload, 'hack')
    const onInt = (payload: any) => applyPatch(payload, 'int')
    const HACK_EVENTS = [
      'hackathon:mutated',
      'hackathon:updated',
      'hackathon:created',
      'hackathon:deleted',
      'hackathon:staging:updated',
    ]
    const INT_EVENTS = [
      'internship:mutated',
      'internship:updated',
      'internship:created',
      'internship:deleted',
      'internship:staging:updated',
    ]
    // P1 SSE fallback: socket missing/disconnected → one-way counts stream
    // (0 polling; server pushes change-only events). Overlap with a
    // reconnecting socket is safe (patches are idempotent setQueryData).
    let socketAlive = false
    try {
      socketAlive = !!socket && (socket as unknown as { connected?: boolean }).connected === true
    } catch {
      socketAlive = false
    }
    if (!socketAlive) {
      let sseOff: (() => void) | null = null
      try {
        sseOff = subscribeSse(SSE_TOPICS.STAGING_COUNTS, (payload) => applyPatch(payload, null))
      } catch {
        sseOff = null
      }
      // Socket listeners below are skipped (no socket); SSE covers pushes
      // while the 5m slow poll remains the final backstop.
      if (!socket) {
        return () => {
          cleanup = true
          try {
            sseOff?.()
          } catch {}
        }
      }
      // Disconnected-but-present socket: keep SSE AND attach socket handlers
      // so a reconnect resumes pushes without remount (both idempotent).
      try {
        socket.on(STAGING_COUNTS_EVENT, onCounts)
        for (const ev of HACK_EVENTS) socket.on(ev, onHack)
        for (const ev of INT_EVENTS) socket.on(ev, onInt)
      } catch {}
      return () => {
        cleanup = true
        try {
          sseOff?.()
        } catch {}
        try {
          socket?.off(STAGING_COUNTS_EVENT, onCounts)
          for (const ev of HACK_EVENTS) socket?.off(ev, onHack)
          for (const ev of INT_EVENTS) socket?.off(ev, onInt)
        } catch {}
      }
    }
    // Socket-alive path (socketAlive verified above; guard for TS + fail-open).
    if (!socket) return
    try {
      socket.on(STAGING_COUNTS_EVENT, onCounts)
      for (const ev of HACK_EVENTS) socket.on(ev, onHack)
      for (const ev of INT_EVENTS) socket.on(ev, onInt)
    } catch {
      return
    }
    return () => {
      cleanup = true
      try {
        socket?.off(STAGING_COUNTS_EVENT, onCounts)
        for (const ev of HACK_EVENTS) socket?.off(ev, onHack)
        for (const ev of INT_EVENTS) socket?.off(ev, onInt)
      } catch {}
    }
  }, [enabled, queryClient])
}
