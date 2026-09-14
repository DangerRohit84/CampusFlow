/**
 * P0-A RED: FE stale discipline.
 * Global 60s+, gcTime, focus false for lists; profile/config 5m.
 */
import { describe, it, expect } from 'vitest'

describe('P0-A query discipline constants', () => {
  it('exposes stale/gc/fallback constants meeting discipline', async () => {
    const mod = await import('../queryDiscipline')
    // Lists >= 60s, profile/config == 5m, fallback slow poll == 5m.
    expect(mod.STALE_LIST_MS).toBeGreaterThanOrEqual(60_000)
    expect(mod.STALE_SLOW_LIST_MS).toBe(5 * 60_000)
    expect(mod.STALE_PROFILE_MS).toBe(5 * 60_000)
    expect(mod.STALE_CONFIG_MS).toBe(5 * 60_000)
    expect(mod.GC_LIST_MS).toBeGreaterThan(mod.STALE_LIST_MS)
    expect(mod.ADMIN_COUNTS_FALLBACK_POLL_MS).toBe(5 * 60_000)
    expect(mod.REFETCH_ON_WINDOW_FOCUS_LIST).toBe(false)
  })

  it('queryClient defaults already meet 60s+ discipline', async () => {
    const { queryClient } = await import('../queryClient')
    const stale = queryClient.getDefaultOptions().queries?.staleTime as number
    const gc = queryClient.getDefaultOptions().queries?.gcTime as number
    expect(stale).toBeGreaterThanOrEqual(60_000)
    expect(gc).toBeGreaterThan(stale)
    expect(queryClient.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false)
  })
})
