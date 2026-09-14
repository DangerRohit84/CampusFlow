import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, RefreshCw, Loader2, RotateCcw } from 'lucide-react'
import api from '../../lib/api'
import { qk } from '../../lib/queryKeys'
import { useFetchSettings, findFetchSetting } from '../../hooks/useFetchSettings'
import type { SourceHealth } from '../../pages/FetchPage'

interface PlatformCardProps {
  platform: {
    platform: string
    name: string
    icon: string
    color: string
    fetched: number
    enriched: number
    pending: number
  }
  type: 'hackathons' | 'internships'
  health?: SourceHealth
  onRefresh: () => void
}

function healthBadgeClass(status: SourceHealth['status']): string {
  switch (status) {
    case 'OK': return 'bg-green-100 text-green-700'
    case 'DEGRADED': return 'bg-yellow-100 text-yellow-800'
    case 'DOWN': return 'bg-red-100 text-red-700'
    default: return 'bg-surface-100 dark:bg-night-700 text-surface-500 dark:text-night-300'
  }
}

function formatLatency(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatLastSuccess(iso: string | null): string {
  if (!iso) return 'never'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 'never'
  return d.toLocaleString()
}

const LIMIT_OPTIONS = [
  { value: 0, label: 'All' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 5, label: '5' },
  { value: 10, label: '10' },
  { value: 15, label: '15' },
  { value: 20, label: '20' },
  { value: 50, label: '50' },
]

export default function PlatformCard({ platform, type, health, onRefresh }: PlatformCardProps) {
  const [fetching, setFetching] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [limit, setLimit] = useState(0)
  const [savingLimit, setSavingLimit] = useState(false)

  const { fetched, enriched, pending } = platform
  const enrichedPercent = fetched > 0 ? Math.round((enriched / fetched) * 100) : 0
  const healthStatus = health?.status ?? 'UNKNOWN'
  const isFailing = healthStatus === 'DOWN' || healthStatus === 'DEGRADED'

  // PERF: shared settings query (was a per-card GET /fetch/settings/all on
  // every mount — 10 identical GETs per FetchPage visit). All cards share one
  // cached trip; local `limit` state keeps the UI instant.
  const queryClient = useQueryClient()
  const { data: settingsData } = useFetchSettings()
  useEffect(() => {
    const setting = findFetchSetting(settingsData?.settings, platform.platform, type)
    if (setting && typeof setting.fetchLimit === 'number') setLimit(setting.fetchLimit)
  }, [settingsData, platform.platform, type])

  const handleLimitChange = async (newLimit: number) => {
    setLimit(newLimit)
    setSavingLimit(true)
    try {
      await api.put(`/fetch/${platform.platform.toLowerCase()}/limit`, {
        limit: newLimit,
        type: type === 'hackathons' ? 'HACKATHON' : 'INTERNSHIP',
      })
      // Keep the shared cache fresh for the other cards (1 background refetch).
      await queryClient.invalidateQueries({ queryKey: qk.fetchSettings() })
    } catch (error) {
      console.error('Failed to save limit:', error)
    } finally {
      setSavingLimit(false)
    }
  }

  const handleFetch = async () => {
    setFetching(true)
    try {
      const { data } = await api.post(`/fetch/${platform.platform.toLowerCase()}`, { limit }, { timeout: 120000 })
      if (data?.success === false) throw new Error(data?.error || 'Fetch failed')
      // success includes enriched even when trust HIGH vs computed MEDIUM — show success
      onRefresh()
    } catch (error) {
      console.error('Fetch error:', error)
    } finally {
      setFetching(false)
    }
  }

  // #4 health: per-source retry re-runs the single-platform fetch (same
  // endpoint as Fetch — the distinction is intent: recover a DOWN/DEGRADED
  // source, and the card refreshes health badges afterwards).
  const handleRetry = async () => {
    setRetrying(true)
    try {
      const { data } = await api.post(`/fetch/${platform.platform.toLowerCase()}`, { limit }, { timeout: 120000 })
      if (data?.success === false) throw new Error(data?.error || 'Retry failed')
      onRefresh()
    } catch (error) {
      console.error('Retry error:', error)
      onRefresh()
    } finally {
      setRetrying(false)
    }
  }

  const handleEnrich = async () => {
    setEnriching(true)
    try {
      const endpoint = type === 'hackathons'
        ? `/fetch/hackathons/enrich?source=${platform.platform.toLowerCase()}${limit > 0 ? `&limit=${limit}` : ''}`
        : `/fetch/internships/enrich?source=${platform.platform.toLowerCase()}${limit > 0 ? `&limit=${limit}` : ''}`
      const { data } = await api.post(endpoint, {}, { timeout: 120000 })
      // Backend returns success:true + enriched count even for trust HIGH (ai:HIGH computed:MEDIUM) — do not treat enriched===0 or trust mismatch as failure.
      if (data?.success === false) throw new Error(data?.error || 'Enrich failed')
      onRefresh()
    } catch (error) {
      console.error('Enrich error:', error)
    } finally {
      setEnriching(false)
    }
  }

  return (
    <div className={`bg-white dark:bg-night-800 rounded-xl border p-4 border-l-4 ${platform.color} ${
      healthStatus === 'DOWN'
        ? 'border-red-300 dark:border-red-800 ring-2 ring-red-500/40'
        : isFailing
          ? 'border-yellow-300 dark:border-yellow-800 ring-1 ring-yellow-500/40'
          : 'border-surface-200 dark:border-night-600'
    }`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{platform.icon}</span>
          <h3 className="font-semibold text-surface-900 dark:text-night-50">{platform.name}</h3>
          {/* #4 health badge */}
          <span
            title={health?.lastError || `Source status: ${healthStatus}`}
            className={`px-2 py-0.5 rounded-full text-xs font-semibold ${healthBadgeClass(healthStatus)}`}
          >
            {healthStatus === 'OK' ? '● Healthy' : healthStatus === 'DEGRADED' ? '● Degraded' : healthStatus === 'DOWN' ? '● Down' : '○ Unknown'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Limit setter */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-surface-500 dark:text-night-400">Limit:</span>
            <select
              value={limit}
              onChange={(e) => handleLimitChange(Number(e.target.value))}
              disabled={savingLimit}
              className="text-xs border border-surface-300 dark:border-night-600 rounded px-1.5 py-0.5 bg-white dark:bg-night-800 text-surface-700 dark:text-night-200 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:opacity-50"
            >
              {LIMIT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {savingLimit && <Loader2 className="w-3 h-3 animate-spin text-surface-400 dark:text-night-400" />}
          </div>
          {fetched > 0 && (
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
              pending === 0
                ? 'bg-green-100 text-green-700'
                : pending > 5
                  ? 'bg-red-100 text-red-700'
                  : 'bg-yellow-100 text-yellow-700'
            }`}>
              {pending === 0 ? 'Complete' : `${pending} pending`}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="text-center">
          <p className="text-2xl font-bold text-surface-900 dark:text-night-50">{fetched}</p>
          <p className="text-xs text-surface-500 dark:text-night-400">Fetched</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-green-600">{enriched}</p>
          <p className="text-xs text-surface-500 dark:text-night-400">Enriched</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-yellow-600">{pending}</p>
          <p className="text-xs text-surface-500 dark:text-night-400">Pending</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-surface-100 dark:bg-night-700 rounded-full h-2 mb-4">
        <div
          className="bg-primary-500 h-2 rounded-full transition-all duration-300"
          style={{ width: `${enrichedPercent}%` }}
        />
      </div>

      {/* #4 health signals: last success, latency, success rate */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3 text-xs text-surface-500 dark:text-night-400">
        <span title={health?.lastSuccessAt || 'No successful run yet'}>
          Last success: {formatLastSuccess(health?.lastSuccessAt ?? null)}
        </span>
        <span title="Wall-clock time of the latest fetch for this source">
          Latency: {formatLatency(health?.lastLatencyMs ?? null)}
        </span>
        <span title={health && health.totalRuns > 0 ? `${health.successRuns}/${health.totalRuns} runs succeeded` : 'No runs recorded yet'}>
          Success: {health && health.totalRuns > 0 ? `${health.successRate}%` : '—'}
        </span>
        {health?.lastError && isFailing && (
          <span className="text-red-600 dark:text-red-300 truncate max-w-full" title={health.lastError}>
            {health.lastError.slice(0, 80)}
          </span>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleFetch}
          disabled={fetching || retrying}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors disabled:opacity-50 text-sm"
        >
          {fetching ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          Fetch
        </button>
        <button
          onClick={handleRetry}
          disabled={fetching || retrying}
          title={isFailing ? `Retry ${platform.name} (currently ${healthStatus})` : `Re-run ${platform.name} fetch`}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg transition-colors disabled:opacity-50 text-sm ${
            isFailing
              ? 'bg-red-600 text-white hover:bg-red-700'
              : 'bg-surface-100 dark:bg-night-700 text-surface-700 dark:text-night-200 hover:bg-surface-200'
          }`}
        >
          {retrying ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RotateCcw className="w-4 h-4" />
          )}
          Retry
        </button>
        <button
          onClick={handleEnrich}
          disabled={enriching || pending === 0}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-surface-100 dark:bg-night-700 text-surface-700 dark:text-night-200 rounded-lg hover:bg-surface-200 transition-colors disabled:opacity-50 text-sm"
        >
          {enriching ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Re-enrich
        </button>
      </div>
    </div>
  )
}
