/**
 * P1 SSE fallback — one-way status when the socket is dead (no polling).
 */
import { describe, it, expect } from 'vitest'

describe('P1 SSE topics + wire events', () => {
  it('maps each topic to its named wire events (unknown → [])', async () => {
    const mod = await import('../sseFallback')
    expect(mod.sseEventNames('profile-sync')).toEqual(['profile-sync:done', 'profile-sync'])
    expect(mod.sseEventNames('staging-counts')).toEqual(['staging:counts:updated'])
    expect(mod.sseEventNames('notifications')).toEqual(['notification:new', 'notification:snapshot'])
    expect(mod.sseEventNames('chat')).toEqual([])
    expect(mod.SSE_TOPICS.PROFILE_SYNC).toBe('profile-sync')
    expect(mod.SSE_TOPICS.STAGING_COUNTS).toBe('staging-counts')
  })

  it('accepts room-targeted sync-done only past baseline (fail-open false)', async () => {
    const mod = await import('../sseFallback')
    const now = Date.now()
    const iso = new Date(now + 1000).toISOString()
    expect(mod.isSseSyncCompletedAfterBaseline({ status: 'completed', completedAt: iso }, now)).toBe(true)
    expect(mod.isSseSyncCompletedAfterBaseline({ status: 'completed', completedAt: new Date(now - 1000).toISOString() }, now)).toBe(false)
    expect(mod.isSseSyncCompletedAfterBaseline({ status: 'started', completedAt: iso }, now)).toBe(false)
    expect(mod.isSseSyncCompletedAfterBaseline({ status: 'completed' }, now)).toBe(false)
    expect(mod.isSseSyncCompletedAfterBaseline(null, now)).toBe(false)
  })

  it('builds the /api/stream/:topic URL (same origin rules as the socket)', async () => {
    const mod = await import('../sseFallback')
    expect(mod.streamUrl('profile-sync')).toContain('/api/stream/profile-sync')
  })
})

describe('P1 subscribeSse — fail-open subscription', () => {
  function fakeFactory(events: Array<{ name: string; payload: unknown }>) {
    const listeners = new Map<string, Array<(ev: { data?: string }) => void>>()
    let closed = false
    const es = {
      addEventListener: (name: string, fn: (ev: { data?: string }) => void) => {
        const arr = listeners.get(name) ?? []
        arr.push(fn)
        listeners.set(name, arr)
      },
      close: () => {
        closed = true
      },
      __emit: () => {
        for (const { name, payload } of events) {
          for (const fn of listeners.get(name) ?? []) fn({ data: JSON.stringify(payload) })
        }
      },
      __closed: () => closed,
    }
    return es
  }

  it('delivers named events to the handler and cleans up (close)', async () => {
    const mod = await import('../sseFallback')
    const seen: Array<{ payload: unknown; event: string }> = []
    const es = fakeFactory([{ name: 'staging:counts:updated', payload: { counts: { a: 1 } } }])
    const off = mod.subscribeSse('staging-counts', (payload, event) => {
      seen.push({ payload, event })
    }, { eventSourceFactory: () => es as any })
    expect(typeof off).toBe('function')
    es.__emit()
    expect(seen).toEqual([{ payload: { counts: { a: 1 } }, event: 'staging:counts:updated' }])
    off!()
    expect(es.__closed()).toBe(true)
  })

  it('returns null when SSE unavailable / topic unknown (caller falls back to poll)', async () => {
    const mod = await import('../sseFallback')
    expect(mod.subscribeSse('nope', () => {}, { eventSourceFactory: () => null })).toBeNull()
    expect(mod.subscribeSse('staging-counts', () => {}, { eventSourceFactory: () => null })).toBeNull()
  })
})

describe('P1 waitForCodingSyncViaSse — socket-equivalent result shape', () => {
  it('resolves completed on a fresh push (no polling)', async () => {
    const mod = await import('../sseFallback')
    const now = Date.now()
    const iso = new Date(now + 5000).toISOString()
    const r = await mod.waitForCodingSyncViaSse(now, {
      timeoutMs: 1000,
      subscribe: ((_topic: string, onEvent: (p: unknown, e: string) => void) => {
        setTimeout(() => onEvent({ status: 'completed', completedAt: iso }, 'profile-sync:done'), 10)
        return () => {}
      }) as any,
    })
    expect(r.completed).toBe(true)
    expect((r.payload as { completedAt?: string })?.completedAt).toBe(iso)
  })

  it('times out cleanly when no push arrives (caller falls back to fetch/poll)', async () => {
    const mod = await import('../sseFallback')
    let cleaned = false
    const r = await mod.waitForCodingSyncViaSse(Date.now(), {
      timeoutMs: 30,
      subscribe: (() => () => {
        cleaned = true
      }) as any,
    })
    expect(r).toMatchObject({ completed: false, timedOut: true })
    expect(cleaned).toBe(true)
  })

  it('times out when subscribe is unavailable (fail-open, never hangs)', async () => {
    const mod = await import('../sseFallback')
    const r = await mod.waitForCodingSyncViaSse(Date.now(), {
      timeoutMs: 50,
      subscribe: (() => null) as any,
    })
    expect(r.completed).toBe(false)
  })
})
