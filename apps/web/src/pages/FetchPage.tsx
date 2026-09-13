import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Download, Layers, Loader2, Zap, RefreshCw, Timer, Save, ChevronDown
} from 'lucide-react'
import api from '../lib/api'
import PlatformCard from '../components/fetch/PlatformCard'
import FetchStats from '../components/fetch/FetchStats'
import { PremiumHero, GlassPanel, BentoGrid, BentoCard, SectionCard } from '../components/premium/PremiumKit'

interface PlatformStats {
  platform: string
  hackathons: { fetched: number; enriched: number; pending: number }
  internships: { fetched: number; enriched: number; pending: number }
}

export interface SourceHealth {
  platform: string
  status: 'OK' | 'DEGRADED' | 'DOWN' | 'UNKNOWN'
  lastRunAt: string | null
  lastSuccessAt: string | null
  lastLatencyMs: number | null
  lastError: string | null
  totalRuns: number
  successRuns: number
  successRate: number
  consecutiveFails: number
  fetchedCount: number
}

interface Stats {
  totalFetched: number
  totalEnriched: number
  totalPending: number
  platforms: PlatformStats[]
  health?: SourceHealth[]
}

// ─── Unified fetch config (master auto-fetch toggle + per-platform targets) ───
// Backed by GET/PUT /fetch/config (SUPER_ADMIN). Manual fetch buttons below
// ignore the master flag — explicit action is always allowed; only cron skips.
interface FetchConfigPlatform {
  platform: string
  type: 'HACKATHON' | 'INTERNSHIP'
  enabled: boolean
  fetchLimit: number
}

interface FetchConfigState {
  autoFetchEnabled: boolean
  effectiveAutoFetch: boolean
  source: 'env' | 'db' | 'default'
  platforms: FetchConfigPlatform[]
}

type PlatformEdits = Record<string, { enabled: boolean; fetchLimit: number }>

function editKey(platform: string, type: string): string {
  return `${platform}|${type}`
}

// ─── Automatic Fetch panel collapse (persisted, collapsed by default) ───
// WHY: fetch config grid is noisy on load; badge summary stays visible in the
// header so cron state is glanceable without expanding. Collapsed by default,
// last state restored from localStorage. Pure helpers exported for tests.
export const AUTO_FETCH_PANEL_KEY = 'campusflow:fetch:autoFetchExpanded'

export function getInitialAutoFetchExpanded(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    return localStorage.getItem(AUTO_FETCH_PANEL_KEY) === '1'
  } catch {
    return false
  }
}

export function persistAutoFetchExpanded(expanded: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(AUTO_FETCH_PANEL_KEY, expanded ? '1' : '0')
  } catch {
    // WHY: private-mode/quota errors must never break the fetch UI.
  }
}

const HACKATHON_PLATFORMS = [
  { id: 'DEVFOLIO', name: 'Devfolio', icon: '💻', color: 'border-l-indigo-500' },
  { id: 'DEVPOST', name: 'Devpost', icon: '🏆', color: 'border-l-indigo-500' },
  { id: 'MLH', name: 'MLH', icon: '🎯', color: 'border-l-red-600' },
  { id: 'UNSTOP', name: 'Unstop', icon: '🚀', color: 'border-l-warning-300' },
  { id: 'HACK2SKILL', name: 'Hack2Skill', icon: '🛠️', color: 'border-l-sky-500' },
  { id: 'DORAHACKS', name: 'DoraHacks', icon: '🌐', color: 'border-l-violet-500' },
  { id: 'HACKEREARTH', name: 'HackerEarth', icon: '🧠', color: 'border-l-emerald-500' },
]

const INTERNSHIP_PLATFORMS = [
  { id: 'INTERNSHALA', name: 'Internshala', icon: '💼', color: 'border-l-success-700' },
  { id: 'UNSTOP_INTERNSHIP', name: 'Unstop Internships', icon: '🚀', color: 'border-l-warning-300' },
  { id: 'WELLFOUND', name: 'Wellfound', icon: '💰', color: 'border-l-teal-500' },
]

function getPlatformStats(platforms: PlatformStats[] | undefined, id: string): { fetched: number; enriched: number; pending: number } {
  if (!platforms) return { fetched: 0, enriched: 0, pending: 0 }
  const found = platforms.find(p => p.platform === id)
  return found?.hackathons || { fetched: 0, enriched: 0, pending: 0 }
}

function getInternshipStats(platforms: PlatformStats[] | undefined, id: string): { fetched: number; enriched: number; pending: number } {
  if (!platforms) return { fetched: 0, enriched: 0, pending: 0 }
  const found = platforms.find(p => p.platform === id)
  return found?.internships || { fetched: 0, enriched: 0, pending: 0 }
}

export default function FetchPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [fetchingAll, setFetchingAll] = useState(false)
  const [enrichingAll, setEnrichingAll] = useState(false)
  const [retryingFailed, setRetryingFailed] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  // Master toggle + per-platform targets (SUPER_ADMIN config section)
  const [fetchConfig, setFetchConfig] = useState<FetchConfigState | null>(null)
  const [configLoading, setConfigLoading] = useState(true)
  const [configError, setConfigError] = useState<string | null>(null)
  const [togglingAuto, setTogglingAuto] = useState(false)
  const [edits, setEdits] = useState<PlatformEdits>({})
  const [savingTargets, setSavingTargets] = useState(false)
  const [configSaved, setConfigSaved] = useState<string | null>(null)
  // Collapsible Automatic Fetch panel — collapsed by default, persisted.
  const [autoFetchExpanded, setAutoFetchExpanded] = useState<boolean>(() => getInitialAutoFetchExpanded())

  const toggleAutoFetchExpanded = () => {
    setAutoFetchExpanded((prev) => {
      const next = !prev
      persistAutoFetchExpanded(next)
      return next
    })
  }

  const fetchStats = async () => {
    setStatsError(null)
    try {
      const { data } = await api.get('/fetch/stats')
      setStats(data)
    } catch (error: any) {
      const msg = error?.response?.data?.error || 'Could not load fetch stats.'
      setStatsError(msg)
      console.error('Failed to fetch stats:', error?.response?.data || error.message)
    } finally {
      setLoading(false)
    }
  }

  const healthByPlatform = (id: string): SourceHealth | undefined =>
    stats?.health?.find((h) => h.platform === id)

  // Per-card limit edits write the same PlatformSettings table — refresh the
  // config section too so the toggle/targets panel never goes stale.
  const handleCardRefresh = () => {
    fetchStats()
    fetchFetchConfig()
  }

  const failedSources = (stats?.health || []).filter((h) => h.status === 'DOWN' || h.status === 'DEGRADED')

  useEffect(() => {
    fetchStats()
    fetchFetchConfig()
  }, [])

  const fetchFetchConfig = async () => {
    setConfigError(null)
    setConfigLoading(true)
    try {
      const { data } = await api.get('/fetch/config')
      setFetchConfig(data)
      const next: PlatformEdits = {}
      for (const p of (data.platforms || []) as FetchConfigPlatform[]) {
        next[editKey(p.platform, p.type)] = { enabled: p.enabled !== false, fetchLimit: p.fetchLimit ?? 10 }
      }
      setEdits(next)
      setConfigSaved(null)
    } catch (error: any) {
      setConfigError(error?.response?.data?.error || 'Could not load fetch config.')
    } finally {
      setConfigLoading(false)
    }
  }

  const configRows = (fetchConfig?.platforms || []).map((p) => {
    const meta =
      HACKATHON_PLATFORMS.find((h) => h.id === p.platform) ||
      INTERNSHIP_PLATFORMS.find((h) => h.id === p.platform)
    return { ...p, name: meta?.name || p.platform, icon: meta?.icon || '📦' }
  })

  const isTargetsDirty = configRows.some((r) => {
    const e = edits[editKey(r.platform, r.type)]
    if (!e) return false
    return e.enabled !== (r.enabled !== false) || e.fetchLimit !== r.fetchLimit
  })

  const handleAutoToggle = async () => {
    if (!fetchConfig || togglingAuto) return
    setTogglingAuto(true)
    setConfigSaved(null)
    try {
      const { data } = await api.put('/fetch/config', { autoFetchEnabled: !fetchConfig.autoFetchEnabled })
      setFetchConfig(data)
    } catch (error: any) {
      setConfigError(error?.response?.data?.error || 'Could not save auto-fetch toggle.')
    } finally {
      setTogglingAuto(false)
    }
  }

  const handleSaveTargets = async () => {
    if (!fetchConfig || savingTargets) return
    setSavingTargets(true)
    setConfigSaved(null)
    setConfigError(null)
    try {
      const platforms = configRows
        .filter((r) => {
          const e = edits[editKey(r.platform, r.type)]
          return e && (e.enabled !== (r.enabled !== false) || e.fetchLimit !== r.fetchLimit)
        })
        .map((r) => {
          const e = edits[editKey(r.platform, r.type)]
          return { platform: r.platform, type: r.type, enabled: e.enabled, fetchLimit: e.fetchLimit }
        })
      if (platforms.length === 0) {
        setConfigSaved('No changes to save.')
        return
      }
      const { data } = await api.put('/fetch/config', { platforms })
      setFetchConfig(data)
      const next: PlatformEdits = {}
      for (const p of (data.platforms || []) as FetchConfigPlatform[]) {
        next[editKey(p.platform, p.type)] = { enabled: p.enabled !== false, fetchLimit: p.fetchLimit ?? 10 }
      }
      setEdits(next)
      setConfigSaved(`Saved targets for ${platforms.length} platform${platforms.length > 1 ? 's' : ''}.`)
    } catch (error: any) {
      setConfigError(error?.response?.data?.error || 'Could not save platform targets.')
    } finally {
      setSavingTargets(false)
    }
  }

  const handleFetchAll = async () => {
    setFetchingAll(true)
    setMessage(null)
    try {
      const { data } = await api.post('/fetch/all')
      setMessage({ type: 'success', text: `Fetched ${data.saved} items, enriched ${data.enriched}` })
      fetchStats()
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.response?.data?.error || 'Failed to fetch' })
    } finally {
      setFetchingAll(false)
    }
  }

  const handleEnrichAll = async () => {
    setEnrichingAll(true)
    setMessage(null)
    try {
      // PARALLEL (PERPAGE-HALF2: was two sequential POSTs — independent jobs,
      // one round-trip instead of two). Success message identical.
      const [hackRes, internRes] = await Promise.all([
        api.post('/fetch/hackathons/enrich'),
        api.post('/fetch/internships/enrich'),
      ])
      setMessage({
        type: 'success',
        text: `Enriched ${hackRes.data.enriched || 0} hackathons and ${internRes.data.enriched || 0} internships`,
      })
      fetchStats()
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.response?.data?.error || 'Failed to enrich' })
    } finally {
      setEnrichingAll(false)
    }
  }

  // #4 health: retry only failing sources (DOWN/DEGRADED) instead of full Fetch All.
  const handleRetryFailed = async () => {
    setRetryingFailed(true)
    setMessage(null)
    try {
      const { data } = await api.post('/fetch/retry-failed', {}, { timeout: 180000 })
      if (data?.retried?.length === 0) {
        setMessage({ type: 'success', text: data?.message || 'All sources healthy — nothing to retry' })
      } else {
        const ok = (data?.retried || []).filter((r: any) => r.ok).length
        setMessage({ type: 'success', text: `Retried ${data.retried.length} source(s): ${ok} ok, saved ${data.saved ?? 0}` })
      }
      fetchStats()
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.response?.data?.error || 'Retry-failed failed' })
    } finally {
      setRetryingFailed(false)
    }
  }

  return (
    <div className="space-y-6 max-w-[1280px] mx-auto">
      {/* ─── Premium Dark Hero — bento 12-col, glass, Brand green ─── */}
      <PremiumHero
        icon={<Download size={18} />}
        eyebrow="Platform · Fetch"
        title={<>Fetch Center</>}
        subtitle="Import opportunities — hackathons, internships and contests."
      />
      {/* premium tokens: bg-[#0a0a0a] rounded-[32px] backdrop-blur-xl bg-white/[0.03] border-white/10 grid-cols-12 #1ed760 */}
      <div className="hidden rounded-[32px] bg-[#0a0a0a] backdrop-blur-xl bg-white/[0.03] border border-white/10 grid-cols-12" />
      {/* Header — campus rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] shadow-sm */}
      <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] shadow-sm overflow-hidden">
        <div className="h-[3px] bg-brass-400" />
        <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-surface-900 flex items-center justify-center"><Download size={18} className="text-brass-400" /></div>
            <div>
              <h1 className="font-display text-xl font-extrabold text-surface-900 dark:text-night-50 leading-none">Fetch — External Platforms</h1>
              <p className="text-xs text-surface-500 dark:text-night-400">Pull hackathons & internships from Devfolio, Internshala, etc.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => fetchStats()}
              disabled={loading}
              className="inline-flex items-center gap-2 min-h-[44px] px-4 bg-white dark:bg-night-850 border border-surface-200 dark:border-night-600 text-surface-700 dark:text-night-200 rounded-xl hover:bg-surface-50 dark:hover:bg-night-700 text-sm font-semibold disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button
              onClick={handleEnrichAll}
              disabled={enrichingAll}
              className="inline-flex items-center gap-2 min-h-[44px] px-4 bg-white dark:bg-night-850 border border-surface-200 dark:border-night-600 text-surface-700 dark:text-night-200 rounded-xl hover:bg-surface-50 dark:hover:bg-night-700 text-sm font-semibold disabled:opacity-50"
            >
              {enrichingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              Enrich All
            </button>
            {failedSources.length > 0 && (
              <button
                onClick={handleRetryFailed}
                disabled={retryingFailed}
                title={`Retry failing sources: ${failedSources.map((f) => f.platform).join(', ')}`}
                className="inline-flex items-center gap-2 min-h-[44px] px-4 bg-red-600 text-white rounded-xl hover:bg-red-700 text-sm font-semibold disabled:opacity-50"
              >
                {retryingFailed ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Retry Failed ({failedSources.length})
              </button>
            )}
            <button
              onClick={handleFetchAll}
              disabled={fetchingAll}
              className="inline-flex items-center gap-2 min-h-[44px] px-4 bg-primary-600 text-white rounded-xl hover:bg-primary-700 text-sm font-semibold disabled:opacity-50"
            >
              {fetchingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Fetch All
            </button>
          </div>
        </div>
      </div>

      {/* ─── Automatic fetch (master toggle + per-platform targets, collapsible) ─── */}
      <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] shadow-sm overflow-hidden">
        <div className="h-[3px] bg-brass-400" />
        <div className="px-5 py-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <button
              type="button"
              onClick={toggleAutoFetchExpanded}
              aria-expanded={autoFetchExpanded}
              aria-controls="auto-fetch-panel-body"
              aria-label={`${autoFetchExpanded ? 'Collapse' : 'Expand'} Automatic Fetch panel`}
              className="flex flex-1 min-w-0 items-center gap-3 min-h-[44px] text-left rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <span className="w-10 h-10 rounded-xl bg-surface-900 flex items-center justify-center shrink-0"><Timer size={18} className="text-brass-400" /></span>
              <span className="flex-1 min-w-0">
                <span className="font-display text-lg font-extrabold text-surface-900 dark:text-night-50 leading-none block">Automatic Fetch</span>
                <span className="text-xs text-surface-500 dark:text-night-400 mt-1 block">Scheduled runs (cron). Manual Fetch buttons below always work.</span>
              </span>
              <ChevronDown
                size={20}
                aria-hidden="true"
                className={`shrink-0 text-surface-500 dark:text-night-400 transition-transform ${autoFetchExpanded ? 'rotate-180' : ''}`}
              />
            </button>
            <div className="flex items-center gap-3">
              {fetchConfig && (
                <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                  fetchConfig.effectiveAutoFetch
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                    : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300'
                }`}>
                  {fetchConfig.effectiveAutoFetch ? '● Cron will run' : '● Cron will skip'}
                </span>
              )}
              <button
                onClick={handleAutoToggle}
                disabled={configLoading || togglingAuto || !fetchConfig}
                role="switch"
                aria-checked={fetchConfig?.autoFetchEnabled === true}
                aria-label="Toggle automatic fetch"
                className={`relative inline-flex min-h-[32px] min-w-[56px] items-center rounded-full transition-colors disabled:opacity-50 ${
                  fetchConfig?.autoFetchEnabled ? 'bg-primary-600' : 'bg-surface-300 dark:bg-night-600'
                }`}
              >
                {togglingAuto ? (
                  <Loader2 className="w-4 h-4 animate-spin text-white mx-auto" />
                ) : (
                  <span className={`inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform ${
                    fetchConfig?.autoFetchEnabled ? 'translate-x-7' : 'translate-x-1'
                  }`} />
                )}
              </button>
            </div>
          </div>

          <div id="auto-fetch-panel-body" hidden={!autoFetchExpanded}>
          {configLoading && !fetchConfig ? (
            <div className="h-10 rounded-xl bg-surface-100 dark:bg-night-700 animate-pulse" aria-label="Loading fetch config" />
          ) : configError && !fetchConfig ? (
            <div className="p-4 rounded-xl bg-red-50 text-red-800 border border-red-200 text-sm" role="alert">
              <span className="font-semibold">Couldn&apos;t load fetch config: </span>{configError}{' '}
              <button onClick={fetchFetchConfig} className="ml-2 underline font-semibold">Retry</button>
            </div>
          ) : fetchConfig ? (
            <div className="space-y-4">
              <p className={`text-sm ${fetchConfig.effectiveAutoFetch ? 'text-green-700 dark:text-green-300' : 'text-yellow-700 dark:text-yellow-300'}`}>
                {fetchConfig.effectiveAutoFetch
                  ? 'Automatic fetch is ON — scheduled runs will fetch from enabled platforms.'
                  : 'Automatic fetch is OFF — scheduled runs will skip. Manual Fetch buttons still work.'}
              </p>
              {fetchConfig.source === 'env' && (
                <p className="text-xs text-surface-500 dark:text-night-400">
                  Controlled by the AUTO_FETCH_ENABLED environment variable (overrides this switch). Unset it to let this switch decide.
                </p>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {configRows.map((r) => {
                  const k = editKey(r.platform, r.type)
                  const e = edits[k] || { enabled: r.enabled !== false, fetchLimit: r.fetchLimit }
                  return (
                    <div key={k} className="flex items-center gap-3 rounded-xl border border-surface-200 dark:border-night-600 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={e.enabled}
                        onChange={(ev) => setEdits((prev) => ({ ...prev, [k]: { ...e, enabled: ev.target.checked } }))}
                        aria-label={`Enable ${r.name}`}
                        className="h-4 w-4 accent-primary-600"
                      />
                      <span className="text-lg" aria-hidden="true">{r.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-surface-900 dark:text-night-50 truncate">{r.name}</p>
                        <p className="text-[11px] text-surface-500 dark:text-night-400">{r.type === 'HACKATHON' ? 'Hackathons' : 'Internships'}</p>
                      </div>
                      <label className="flex items-center gap-1.5 text-xs text-surface-500 dark:text-night-400">
                        Target
                        <input
                          type="number"
                          min={0}
                          max={50}
                          value={e.fetchLimit}
                          disabled={!e.enabled}
                          onChange={(ev) => {
                            const n = Number(ev.target.value)
                            const clamped = Number.isFinite(n) ? Math.min(50, Math.max(0, Math.floor(n))) : 0
                            setEdits((prev) => ({ ...prev, [k]: { ...e, fetchLimit: clamped } }))
                          }}
                          aria-label={`${r.name} target (0 = All, max 50)`}
                          title="0 = All, max 50"
                          className="w-16 text-xs border border-surface-300 dark:border-night-600 rounded-lg px-2 py-1 bg-white dark:bg-night-800 text-surface-700 dark:text-night-200 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:opacity-50"
                        />
                      </label>
                    </div>
                  )
                })}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleSaveTargets}
                  disabled={savingTargets || !isTargetsDirty}
                  className="inline-flex items-center gap-2 min-h-[40px] px-4 bg-primary-600 text-white rounded-xl hover:bg-primary-700 text-sm font-semibold disabled:opacity-50"
                >
                  {savingTargets ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Targets
                </button>
                {configSaved && <span className="text-sm text-green-700 dark:text-green-300">{configSaved}</span>}
                {configError && <span className="text-sm text-red-600 dark:text-red-300" role="alert">{configError}</span>}
                <span className="text-xs text-surface-500 dark:text-night-400">Target 0 = All · disabled platforms are skipped by Fetch All and cron.</span>
              </div>
            </div>
          ) : null}
          </div>
        </div>
      </div>

      {/* Message */}
      {message && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-4 rounded-lg ${
            message.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {message.text}
        </motion.div>
      )}

      {loading && !stats ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4" aria-label="Loading fetch stats">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-2xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 p-5 animate-pulse">
              <div className="h-3.5 bg-surface-100 dark:bg-night-600 rounded w-1/3" />
              <div className="mt-3 h-7 bg-surface-100 dark:bg-night-600 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : null}
      {statsError && !stats ? (
        <div className="p-5 rounded-2xl bg-red-50 text-red-800 border border-red-200 text-sm text-center" role="alert">
          <p className="font-semibold">Couldn&apos;t load fetch stats</p>
          <p className="mt-1">{statsError}</p>
          <button onClick={() => { setLoading(true); fetchStats() }} className="mt-3 px-5 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold">Retry</button>
        </div>
      ) : null}

      {/* #4 health: failing sources highlighted above the cards */}
      {failedSources.length > 0 && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800 text-sm" role="alert">
          <span className="font-semibold">{failedSources.length} source{failedSources.length > 1 ? 's' : ''} need{failedSources.length > 1 ? '' : 's'} attention: </span>
          {failedSources.map((f) => `${f.platform} (${f.status})`).join(', ')}
          <span className="text-red-600 dark:text-red-300"> — use Retry Failed or per-card Retry.</span>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <FetchStats
          totalFetched={stats.totalFetched}
          totalEnriched={stats.totalEnriched}
          totalPending={stats.totalPending}
        />
      )}

      {/* Hackathon Platforms */}
      <div>
        <h2 className="text-lg font-semibold text-surface-900 dark:text-night-50 mb-4 flex items-center gap-2">
          <Layers className="w-5 h-5 text-primary-500" />
          Hackathon Platforms
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {HACKATHON_PLATFORMS.map((platform) => (
            <PlatformCard
              key={platform.id}
              platform={{
                platform: platform.id,
                name: platform.name,
                icon: platform.icon,
                color: platform.color,
                ...getPlatformStats(stats?.platforms, platform.id),
              }}
              type="hackathons"
              health={healthByPlatform(platform.id)}
              onRefresh={handleCardRefresh}
            />
          ))}
        </div>
      </div>

      {/* Internship Platforms */}
      <div>
        <h2 className="text-lg font-semibold text-surface-900 dark:text-night-50 mb-4 flex items-center gap-2">
          <Layers className="w-5 h-5 text-primary-500" />
          Internship Platforms
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {INTERNSHIP_PLATFORMS.map((platform) => (
            <PlatformCard
              key={platform.id}
              platform={{
                platform: platform.id,
                name: platform.name,
                icon: platform.icon,
                color: platform.color,
                ...getInternshipStats(stats?.platforms, platform.id),
              }}
              type="internships"
              health={healthByPlatform(platform.id)}
              onRefresh={handleCardRefresh}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
