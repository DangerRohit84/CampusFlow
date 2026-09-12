// components/admin/PlatformKpisPanel.tsx — #11 platform KPI trends.
// WHY: SuperAdmin dashboard showed point-in-time totals but no velocity —
// DAU/WAU, registration, sync and fetch trends plus AI spend. No chart lib:
// counts + CSS bars + reused sparkline idiom (inline SVG). Empty-safe
// pre-migration (#11b: WAU + fetch counts added, same idiom).

import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Activity, Users, UserPlus, RefreshCw, Download, Zap, Loader2 } from 'lucide-react'
import { platformKpisAPI } from '../../lib/api/resources/admin'
import { qk } from '../../lib/queryKeys'

function MiniBars({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(1, ...data)
  return (
    <div className="flex items-end gap-1 h-12" aria-hidden>
      {data.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm min-w-[3px]"
          style={{ height: `${Math.max(8, Math.round((v / max) * 100))}%`, background: color, opacity: 0.35 + 0.65 * (v / max) }}
          title={`${v}`}
        />
      ))}
    </div>
  )
}

export default function PlatformKpisPanel({ collegeId, from, to }: { collegeId?: string; from: string; to: string }) {
  const query = useQuery({
    queryKey: qk.platformKpis(collegeId, from, to),
    queryFn: ({ signal }) => platformKpisAPI.get({ collegeId: collegeId || undefined, from, to, signal }),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  const d = query.data
  // WAU total is the current (last-day) rolling value, not a sum — see route.
  const cards = [
    { label: 'DAU', hint: 'distinct logins/day', icon: Activity, total: d?.totals.dau ?? 0, series: (d?.dau ?? []).map((p) => p.count), color: '#10b981' },
    { label: 'WAU', hint: 'active in trailing 7d', icon: Users, total: d?.totals.wau ?? 0, series: (d?.wau ?? []).map((p) => p.count), color: '#0ea5e9' },
    { label: 'Registrations', hint: 'new users/day', icon: UserPlus, total: d?.totals.registrations ?? 0, series: (d?.registrations ?? []).map((p) => p.count), color: '#1ed760' },
    { label: 'Syncs', hint: 'profile+contest syncs/day', icon: RefreshCw, total: d?.totals.syncs ?? 0, series: (d?.syncs ?? []).map((p) => p.count), color: '#6366f1' },
    { label: 'Fetches', hint: 'fetched items/day', icon: Download, total: d?.totals.fetches ?? 0, series: (d?.fetches ?? []).map((p) => p.count), color: '#8b5cf6' },
    { label: 'AI tokens', hint: 'AI tokens/day', icon: Zap, total: d?.totals.aiTokens ?? 0, series: (d?.ai ?? []).map((p) => p.tokens), color: '#f59e0b' },
  ]

  return (
    <div className="rounded-[20px] bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 shadow-soft p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-slate-900 dark:text-white inline-flex items-center gap-2 text-sm">
          <span className="w-7 h-7 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 flex items-center justify-center"><Activity size={14} className="text-emerald-600" /></span>
          Platform KPIs · {d ? `${d.dau.length}d window` : 'trends'}
        </h3>
        {query.isFetching && <Loader2 size={14} className="animate-spin text-surface-400" />}
      </div>
      {query.isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-28 rounded-xl bg-surface-100 dark:bg-night-700 animate-pulse" />)}
        </div>
      ) : query.isError ? (
        <p className="text-sm text-surface-500 py-6 text-center">KPI trends unavailable — try again shortly.</p>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {cards.map((c) => (
            <div key={c.label} className="rounded-xl border border-surface-200 dark:border-night-600 bg-surface-50/60 dark:bg-night-900/40 p-3">
              <p className="text-[10px] font-bold tracking-widest uppercase text-surface-400 inline-flex items-center gap-1"><c.icon size={11} /> {c.label}</p>
              <p className="font-display text-2xl font-extrabold text-slate-900 dark:text-white mt-0.5">{c.total.toLocaleString()}</p>
              <p className="text-[10px] text-surface-400 dark:text-zinc-500">{c.hint}</p>
              <div className="mt-2"><MiniBars data={c.series.length ? c.series : [0]} color={c.color} /></div>
            </div>
          ))}
        </div>
      )}
      {d && (
        <p className="text-[11px] text-surface-400 mt-3">
          AI spend this window: {d.totals.aiRequests.toLocaleString()} requests · ₹{((d.totals.aiCostCents ?? 0) / 100).toFixed(2)} est. cost
          {d.fetchSources && (
            <> · Fetches: {(d.fetchSources.contests ?? 0).toLocaleString()} contests · {(d.fetchSources.hackathons ?? 0).toLocaleString()} hackathons · {(d.fetchSources.internships ?? 0).toLocaleString()} internships</>
          )}
        </p>
      )}
    </div>
  )
}
