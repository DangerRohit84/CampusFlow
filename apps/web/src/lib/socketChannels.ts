// lib/socketChannels.ts — realtime channel subscriptions (SRP extract from api/resources/rooms.ts).
// WHY: rooms.ts re-exported the socket singleton (`export { connectSocket... }`)
// so the API layer depended on transport + realtime (M-4 layering smell).
// Pages MUST import socket from '../socket' (singleton) and channel helpers
// from here. Behavior identical; AbortSignal-free (socket subs, not HTTP).

import { getSocket } from './socket'

export type Unsubscribe = () => void

export function onNotification(callback: (notification: unknown) => void): Unsubscribe {
  const s = getSocket() as unknown as {
    on?: (ev: string, cb: (n: unknown) => void) => void
    off?: (ev: string, cb: (n: unknown) => void) => void
  } | null
  try {
    s?.on?.('notification:new', callback as (n: unknown) => void)
  } catch { /* socket not ready — caller retries on connect */ }
  return () => {
    try {
      s?.off?.('notification:new', callback as (n: unknown) => void)
    } catch { /* ignore teardown race */ }
  }
}

export function onScheduleUpdate(callback: (schedule: unknown) => void): Unsubscribe {
  const s = getSocket() as unknown as {
    on?: (ev: string, cb: (n: unknown) => void) => void
    off?: (ev: string, cb: (n: unknown) => void) => void
  } | null
  try {
    s?.on?.('schedule:update', callback as (n: unknown) => void)
  } catch { /* socket not ready */ }
  return () => {
    try {
      s?.off?.('schedule:update', callback as (n: unknown) => void)
    } catch { /* ignore */ }
  }
}
