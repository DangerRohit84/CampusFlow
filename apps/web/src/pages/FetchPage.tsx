import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Download, Layers, Loader2, Zap, RefreshCw
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

  const failedSources = (stats?.health || []).filter((h) => h.status === 'DOWN' || h.status === 'DEGRADED')

  useEffect(() => {
    fetchStats()
  }, [])

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
              onRefresh={fetchStats}
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
              onRefresh={fetchStats}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
