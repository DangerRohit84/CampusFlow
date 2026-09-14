// lib/dashboardWindow.test.ts — locks the stable super-dashboard window.
// WHY: SuperAdminDashboardPage fed a fresh `to` ISO per render into the RQ key
// (and backend cache key), so every re-render refetched and no cache ever hit
// (prod burst: ~25 dashboard queries + KPI scans per render). The window must
// be pure, range-derived, and minute-floored for cross-viewer cache sharing.
import { describe, it, expect } from 'vitest'
import { getSuperDashboardWindow, normalizeDashboardRange } from './dashboardWindow'
import { qk } from './queryKeys'

const NOW = new Date('2026-09-14T11:24:33.456Z')

describe('normalizeDashboardRange', () => {
  it('keeps valid ranges, defaults junk to 30d', () => {
    expect(normalizeDashboardRange('7d')).toBe('7d')
    expect(normalizeDashboardRange('30d')).toBe('30d')
    expect(normalizeDashboardRange('90d')).toBe('90d')
    expect(normalizeDashboardRange('90D')).toBe('30d')
    expect(normalizeDashboardRange(null)).toBe('30d')
    expect(normalizeDashboardRange(undefined)).toBe('30d')
    expect(normalizeDashboardRange('')).toBe('30d')
  })
})

describe('getSuperDashboardWindow', () => {
  it('offsets from by range length (7/30/90d)', () => {
    expect(getSuperDashboardWindow('7d', NOW).from).toBe('2026-09-07T11:24:00.000Z')
    expect(getSuperDashboardWindow('30d', NOW).from).toBe('2026-08-15T11:24:00.000Z')
    expect(getSuperDashboardWindow('90d', NOW).from).toBe('2026-06-16T11:24:00.000Z')
  })

  it('floors to the minute (stable key within a minute, shared across viewers)', () => {
    const w = getSuperDashboardWindow('30d', NOW)
    expect(w.to).toBe('2026-09-14T11:24:00.000Z')
    // Same minute, different seconds/ms → identical window (cache hit).
    expect(getSuperDashboardWindow('30d', new Date('2026-09-14T11:24:59.999Z'))).toEqual(w)
    // Next minute → new window (bounded 1/min refetch at most).
    expect(getSuperDashboardWindow('30d', new Date('2026-09-14T11:25:00.000Z')).to).toBe('2026-09-14T11:25:00.000Z')
  })

  it('is deterministic (same inputs → same key inputs)', () => {
    expect(getSuperDashboardWindow('30d', NOW)).toEqual(getSuperDashboardWindow('30d', new Date(NOW.getTime())))
  })
})

describe('qk.fetchSettings (shared PlatformCard key)', () => {
  it('returns a stable single key so all cards dedupe to 1 GET', () => {
    expect(qk.fetchSettings()).toEqual(['fetch-settings'])
    expect(qk.fetchSettings()).toEqual(qk.fetchSettings())
  })
})
