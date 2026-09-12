// services/platformKpis.ts — #11 platform KPI time-series (DAU/WAU/registrations/syncs/fetches).
// WHY: SuperAdmin dashboard had tenant totals but no platform health trends —
// no DAU/WAU, no registration velocity, no sync/fetch throughput. These pure
// bucketing helpers turn timestamp lists into per-day series for the dashboard
// graphs (no chart lib — frontend reuses Sparkline/bars). DB fetching lives in
// routes/admin.ts (guarded, capped, never 500s); this file stays hermetic for
// Small tests. Days are UTC yyyy-mm-dd.

export interface DayPoint {
  day: string
  count: number
}

export function toDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function dayRange(from: Date, to: Date): string[] {
  const days: string[] = []
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()))
  for (let t = cur.getTime(); t <= end.getTime(); t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10))
  }
  return days.length > 0 ? days : [toDay(to)]
}

/** Count events per day (fills zeros for empty days in range). */
export function bucketByDay(dates: Date[], from: Date, to: Date): DayPoint[] {
  const counts = new Map<string, number>()
  for (const d of dates) {
    if (!(d instanceof Date) || isNaN(d.getTime())) continue
    counts.set(toDay(d), (counts.get(toDay(d)) ?? 0) + 1)
  }
  return dayRange(from, to).map((day) => ({ day, count: counts.get(day) ?? 0 }))
}

/**
 * DAU: distinct keys (email/userId) per day. Input rows carry a key + timestamp;
 * duplicates within a day count once. Fills zeros for empty days.
 */
export function bucketDau(rows: Array<{ key: string; at: Date }>, from: Date, to: Date): DayPoint[] {
  const perDay = new Map<string, Set<string>>()
  for (const r of rows) {
    if (!r || !r.key || !(r.at instanceof Date) || isNaN(r.at.getTime())) continue
    const day = toDay(r.at)
    let set = perDay.get(day)
    if (!set) {
      set = new Set<string>()
      perDay.set(day, set)
    }
    set.add(String(r.key).toLowerCase())
  }
  return dayRange(from, to).map((day) => ({ day, count: perDay.get(day)?.size ?? 0 }))
}

/** Sum a numeric series (totals row for KPI cards). */
export function sumSeries(series: DayPoint[]): number {
  return series.reduce((a, p) => a + (p.count || 0), 0)
}

/**
 * WAU: distinct keys active in the trailing 7-day window ending on each day.
 * Input rows SHOULD include up to 6 days of lookback before `from` so the
 * first days' windows are seeded; rows outside any window are ignored.
 * Same key normalization as bucketDau (case-insensitive). Fills zeros.
 */
export function bucketWau(rows: Array<{ key: string; at: Date }>, from: Date, to: Date): DayPoint[] {
  const perDay = new Map<string, Set<string>>()
  for (const r of rows) {
    if (!r || !r.key || !(r.at instanceof Date) || isNaN(r.at.getTime())) continue
    const day = toDay(r.at)
    let set = perDay.get(day)
    if (!set) {
      set = new Set<string>()
      perDay.set(day, set)
    }
    set.add(String(r.key).toLowerCase())
  }
  const dayMs = new Map<string, number>()
  for (const d of perDay.keys()) dayMs.set(d, new Date(`${d}T00:00:00.000Z`).getTime())
  return dayRange(from, to).map((day) => {
    const end = new Date(`${day}T00:00:00.000Z`).getTime()
    const union = new Set<string>()
    for (const [d, set] of perDay) {
      const t = dayMs.get(d) ?? NaN
      if (!Number.isFinite(t)) continue
      const diffDays = Math.round((end - t) / 86_400_000)
      if (diffDays >= 0 && diffDays < 7) {
        for (const key of set) union.add(key)
      }
    }
    return { day, count: union.size }
  })
}
