// components/ai/AiUsagePanel.tsx — #11 AI metering + cost caps in AiManager.
// WHY: token spend was invisible (in-memory only) and uncapped per college.
// Shows per-college usage (requests/tokens/est. cost) with daily-cap progress
// plus SUPER_ADMIN cap editing (daily/monthly tokens, cost cap, enabled).
// #11b: month-tokens column + per-college budget-use bars (CSS only, no chart
// lib) so over-cap colleges are visible at a glance. Pre-migration: empty
// usage + default 10k caps (never crashes).

import { useState, useEffect } from 'react'
import { useQuery, keepPreviousData, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Gauge, Loader2, Pencil } from 'lucide-react'
import { aiManagerAPI, type AiQuota } from '../../lib/api/resources/admin'
import { qk } from '../../lib/queryKeys'

/** Server default when a quota row is absent (mirrors DEFAULT_DAILY_TOKEN_CAP). */
const FALLBACK_DAILY_CAP = 10_000

function costFmt(cents: number) {
  return `₹${(cents / 100).toFixed(2)}`
}

export default function AiUsagePanel({ colleges }: { colleges: { id: string; name: string; code: string }[] }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState({ dailyTokenCap: '10000', monthlyTokenCap: '', totalCostCapCents: '', enabled: true })
  const [saving, setSaving] = useState(false)

  const usageQuery = useQuery({
    queryKey: qk.aiUsage(),
    queryFn: ({ signal }) => aiManagerAPI.getUsage({ signal }),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  const usage = usageQuery.data?.usage ?? []
  const totals = usageQuery.data?.totals
  const visible = colleges.slice(0, 12)

  // Per-college quotas for the budget-use bars (guarded — missing rows fall
  // back to the server default cap; a failed fetch shows a loading shimmer).
  const [quotas, setQuotas] = useState<Record<string, AiQuota>>({})
  useEffect(() => {
    let cancelled = false
    const ids = colleges.slice(0, 12).map((c) => c.id)
    if (!ids.length) return
    void Promise.all(
      ids.map((id) => aiManagerAPI.getQuota(id).then((r) => ({ id, quota: r.quota })).catch(() => null)),
    ).then((rows) => {
      if (cancelled) return
      const map: Record<string, AiQuota> = {}
      for (const r of rows) if (r) map[r.id] = r.quota
      setQuotas(map)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colleges])

  // Aggregate today (UTC day) per college for cap progress.
  const today = new Date().toISOString().slice(0, 10)
  const month = today.slice(0, 7)
  const todayByCollege = new Map<string, { tokens: number; requests: number; costCents: number }>()
  const monthByCollege = new Map<string, { tokens: number; requests: number }>()
  for (const r of usage) {
    if (r.day.startsWith(month)) {
      const m = monthByCollege.get(r.collegeId) ?? { tokens: 0, requests: 0 }
      m.tokens += r.tokens || 0
      m.requests += r.requests || 0
      monthByCollege.set(r.collegeId, m)
    }
    if (r.day !== today) continue
    const e = todayByCollege.get(r.collegeId) ?? { tokens: 0, requests: 0, costCents: 0 }
    e.tokens += r.tokens || 0
    e.requests += r.requests || 0
    e.costCents += r.costCents || 0
    todayByCollege.set(r.collegeId, e)
  }

  const openEdit = async (collegeId: string) => {
    setEditing(collegeId)
    try {
      const { quota } = await aiManagerAPI.getQuota(collegeId)
      setForm({
        dailyTokenCap: String(quota.dailyTokenCap),
        monthlyTokenCap: quota.monthlyTokenCap != null ? String(quota.monthlyTokenCap) : '',
        totalCostCapCents: quota.totalCostCapCents != null ? String(quota.totalCostCapCents) : '',
        enabled: quota.enabled,
      })
    } catch {
      setForm({ dailyTokenCap: '10000', monthlyTokenCap: '', totalCostCapCents: '', enabled: true })
    }
  }

  const saveQuota = async (collegeId: string) => {
    setSaving(true)
    try {
      const daily = parseInt(form.dailyTokenCap, 10)
      if (!Number.isInteger(daily) || daily < 0) { toast.error('Daily cap must be a non-negative integer'); return }
      const monthly = form.monthlyTokenCap.trim() === '' ? null : parseInt(form.monthlyTokenCap, 10)
      const cost = form.totalCostCapCents.trim() === '' ? null : parseInt(form.totalCostCapCents, 10)
      if (monthly !== null && (!Number.isInteger(monthly) || monthly < 0)) { toast.error('Monthly cap must be a non-negative integer or blank'); return }
      if (cost !== null && (!Number.isInteger(cost) || cost < 0)) { toast.error('Cost cap must be a non-negative integer (cents) or blank'); return }
      await aiManagerAPI.updateQuota(collegeId, {
        dailyTokenCap: daily,
        monthlyTokenCap: monthly ?? undefined,
        totalCostCapCents: cost ?? undefined,
        enabled: form.enabled,
      }).then((r) => {
        // Refresh the budget-use bar immediately (no extra round-trip).
        if (r?.quota) setQuotas((prev) => ({ ...prev, [collegeId]: r.quota }))
      })
      toast.success('AI budget saved')
      setEditing(null)
      void queryClient.invalidateQueries({ queryKey: qk.aiUsage() })
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to save budget')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-[20px] bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 shadow-soft p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-bold text-slate-900 dark:text-white inline-flex items-center gap-2 text-sm">
          <span className="w-7 h-7 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 flex items-center justify-center"><Gauge size={14} className="text-amber-600" /></span>
          AI usage & cost caps
        </h2>
        {usageQuery.isFetching && <Loader2 size={14} className="animate-spin text-surface-400" />}
      </div>
      <p className="text-xs text-surface-500 dark:text-night-400 mb-4">
        {totals ? `${totals.requests.toLocaleString()} requests · ${totals.tokens.toLocaleString()} tokens · ${costFmt(totals.costCents)} est. cost (window)` : 'Per-college daily metering with budget caps — over-cap requests are blocked with a clear message.'}
      </p>

      {usageQuery.isLoading ? (
        <div className="h-24 rounded-xl bg-surface-100 dark:bg-night-700 animate-pulse" />
      ) : colleges.length === 0 ? (
        <p className="text-sm text-surface-500 py-6 text-center">No colleges to meter yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-surface-200 dark:border-night-600">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-surface-50 dark:bg-night-900 border-b border-surface-200 dark:border-night-600">
                <th className="text-left py-2.5 px-3 font-bold uppercase tracking-widest text-[10px] text-surface-400">College</th>
                <th className="text-right py-2.5 px-3 font-bold uppercase tracking-widest text-[10px] text-surface-400">Today tokens</th>
                <th className="text-right py-2.5 px-3 font-bold uppercase tracking-widest text-[10px] text-surface-400">Month tokens</th>
                <th className="text-right py-2.5 px-3 font-bold uppercase tracking-widest text-[10px] text-surface-400">Requests</th>
                <th className="text-right py-2.5 px-3 font-bold uppercase tracking-widest text-[10px] text-surface-400">Est. cost</th>
                <th className="text-left py-2.5 px-3 font-bold uppercase tracking-widest text-[10px] text-surface-400">Budget use</th>
                <th className="text-right py-2.5 px-3 font-bold uppercase tracking-widest text-[10px] text-surface-400">Caps</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-50 dark:divide-night-800">
              {visible.map((c) => {
                const t = todayByCollege.get(c.id) ?? { tokens: 0, requests: 0, costCents: 0 }
                const m = monthByCollege.get(c.id) ?? { tokens: 0, requests: 0 }
                const quota = quotas[c.id]
                const cap = quota?.dailyTokenCap ?? FALLBACK_DAILY_CAP
                const pct = cap > 0 ? Math.min(100, Math.round((t.tokens / cap) * 100)) : (t.tokens > 0 ? 100 : 0)
                const over = cap > 0 && t.tokens >= cap
                const disabled = quota?.enabled === false
                const barColor = disabled ? '#6b7280' : over ? '#ef4444' : pct >= 75 ? '#f59e0b' : '#10b981'
                const isEditing = editing === c.id
                return (
                  <tr key={c.id} className="hover:bg-surface-50 dark:hover:bg-night-700/30">
                    <td className="py-2.5 px-3 font-semibold text-slate-800 dark:text-night-100">{c.name} <span className="font-mono text-[10px] text-surface-400 ml-1">{c.code}</span></td>
                    <td className="py-2.5 px-3 text-right font-mono">{t.tokens.toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{m.tokens.toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{t.requests.toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{costFmt(t.costCents)}</td>
                    <td className="py-2.5 px-3 min-w-[150px]">
                      {!quota ? (
                        <div className="h-2 rounded-full bg-surface-100 dark:bg-night-700 animate-pulse" aria-label="Loading budget" />
                      ) : (
                        <div>
                          <div
                            className="h-2 rounded-full bg-surface-100 dark:bg-night-700 overflow-hidden"
                            role="progressbar"
                            aria-valuenow={pct}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`${c.name} daily AI budget use`}
                          >
                            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
                          </div>
                          <p className={`text-[10px] mt-1 font-semibold ${over ? 'text-danger-600' : 'text-surface-400'}`}>
                            {disabled ? 'AI disabled' : over ? 'Over cap — requests blocked' : `${pct}% of ${cap.toLocaleString()}/day`}
                          </p>
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {!isEditing ? (
                        <button onClick={() => openEdit(c.id)} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-surface-200 dark:border-night-600 text-[11px] font-bold hover:bg-surface-50 dark:hover:bg-night-700">
                          <Pencil size={11} /> Caps
                        </button>
                      ) : (
                        <div className="flex flex-col gap-1.5 items-end" onClick={(e) => e.stopPropagation()}>
                          <label className="flex items-center gap-1.5 text-[11px]">Daily <input value={form.dailyTokenCap} onChange={(e) => setForm({ ...form, dailyTokenCap: e.target.value })} inputMode="numeric" aria-label="Daily token cap" className="w-24 h-7 px-2 border border-surface-200 dark:border-night-600 rounded-lg text-xs dark:bg-night-900" /></label>
                          <label className="flex items-center gap-1.5 text-[11px]">Monthly <input value={form.monthlyTokenCap} onChange={(e) => setForm({ ...form, monthlyTokenCap: e.target.value })} inputMode="numeric" placeholder="—" aria-label="Monthly token cap" className="w-24 h-7 px-2 border border-surface-200 dark:border-night-600 rounded-lg text-xs dark:bg-night-900" /></label>
                          <label className="flex items-center gap-1.5 text-[11px]">Cost¢ <input value={form.totalCostCapCents} onChange={(e) => setForm({ ...form, totalCostCapCents: e.target.value })} inputMode="numeric" placeholder="—" aria-label="Total cost cap in cents" className="w-24 h-7 px-2 border border-surface-200 dark:border-night-600 rounded-lg text-xs dark:bg-night-900" /></label>
                          <label className="flex items-center gap-1.5 text-[11px]"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} aria-label="AI enabled" /> Enabled</label>
                          <div className="flex gap-1.5">
                            <button onClick={() => setEditing(null)} className="h-7 px-2.5 rounded-lg text-[11px] font-semibold border border-surface-200 dark:border-night-600">Cancel</button>
                            <button onClick={() => saveQuota(c.id)} disabled={saving} className="h-7 px-2.5 rounded-lg text-[11px] font-bold bg-slate-900 dark:bg-white text-white dark:text-black disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
