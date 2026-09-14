/**
 * P0-A RED: coding sync socket wait (kill 2s×30 poll -> room push + single fetch).
 */
import { describe, it, expect } from 'vitest'

describe('P0-A coding sync socket', () => {
  it('recognises sync-done room events (legacy + alias)', async () => {
    const mod = await import('../codingSyncSocket')
    expect(mod.isProfileSyncDoneEvent('profile-sync')).toBe(true)
    expect(mod.isProfileSyncDoneEvent('profile-sync:done')).toBe(true)
    expect(mod.isProfileSyncDoneEvent('coding:profile:mutated')).toBe(false)
    expect(mod.isProfileSyncDoneEvent('hackathon:mutated')).toBe(false)
  })

  it('completes only when completedAt advances past baseline', async () => {
    const mod = await import('../codingSyncSocket')
    const baseline = Date.parse('2026-09-14T00:00:00.000Z')
    expect(
      mod.isSyncCompletedAfterBaseline(
        { status: 'completed', completedAt: '2026-09-14T00:00:01.000Z' },
        baseline,
      ),
    ).toBe(true)
    expect(
      mod.isSyncCompletedAfterBaseline(
        { status: 'completed', completedAt: '2026-09-13T23:59:59.000Z' },
        baseline,
      ),
    ).toBe(false)
    expect(mod.isSyncCompletedAfterBaseline({ status: 'started' }, baseline)).toBe(false)
    expect(mod.isSyncCompletedAfterBaseline(null, baseline)).toBe(false)
  })

  it('waits via socket push (no polling) and resolves on done', async () => {
    const mod = await import('../codingSyncSocket')
    const handlers = new Map<string, (p: any) => void>()
    const fakeSocket = {
      connected: true,
      on: (ev: string, fn: (p: any) => void) => {
        handlers.set(ev, fn)
      },
      off: (ev: string) => {
        handlers.delete(ev)
      },
    }
    const baseline = Date.parse('2026-09-14T00:00:00.000Z')
    const pending = mod.waitForCodingSyncViaSocket(baseline, {
      socket: fakeSocket as any,
      timeoutMs: 1000,
    })
    // Server room-targeted push arrives (no GET polling involved).
    handlers.get('profile-sync:done')?.({
      status: 'completed',
      completedAt: '2026-09-14T00:00:05.000Z',
      synced: 2,
    })
    const result = await pending
    expect(result.completed).toBe(true)
    expect(result.payload?.synced).toBe(2)
  })

  it('times out fail-open (caller falls back to single fetch, not 30 polls)', async () => {
    const mod = await import('../codingSyncSocket')
    const fakeSocket = {
      connected: true,
      on: () => {},
      off: () => {},
    }
    const baseline = Date.now()
    const result = await mod.waitForCodingSyncViaSocket(baseline, {
      socket: fakeSocket as any,
      timeoutMs: 10,
    })
    expect(result.completed).toBe(false)
    expect(result.timedOut).toBe(true)
  })
})
