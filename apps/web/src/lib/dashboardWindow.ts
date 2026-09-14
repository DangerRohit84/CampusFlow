/**
 * Super-admin dashboard time-window helper (prod burst fix).
 *
 * WHY: SuperAdminDashboardPage recomputed `from`/`to` on EVERY render
 * (`getToNow()` = a fresh ISO with ms each call) and fed them straight into
 * `qk.superDashboard(collegeId, from, to)` + PlatformKpisPanel. Every
 * re-render (60s clock tick, tenant-search keystrokes, chart-metric toggles)
 * minted a NEW query key → instant refetch + React Query cache never hit.
 * Worse, the backend super-dashboard/KPI caches key on the same from/to
 * strings, so the backend 60s caches never hit either — every render burst
 * recomputed ~25 dashboard queries + the KPI paginated scans.
 *
 * This helper is pure + minute-floored: renders within the same minute share
 * one key (frontend RQ hit + backend cache hit, shared across viewers via
 * Redis). Call it inside `useMemo(..., [range])` so the window only moves
 * when the range changes or a socket invalidation refetches (same key).
 */
export type DashboardRangeKey = '7d' | '30d' | '90d'

export function normalizeDashboardRange(raw: unknown): DashboardRangeKey {
  return raw === '7d' || raw === '90d' ? raw : '30d'
}

export function getSuperDashboardWindow(range: DashboardRangeKey, now: Date = new Date()): { from: string; to: string } {
  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30
  const floored = new Date(now)
  floored.setSeconds(0, 0)
  const from = new Date(floored)
  from.setDate(from.getDate() - days)
  return { from: from.toISOString(), to: floored.toISOString() }
}
