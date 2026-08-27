import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Download, Layers, Loader2, Zap, RefreshCw
} from 'lucide-react'
import api from '../lib/api'
import PlatformCard from '../components/fetch/PlatformCard'
import FetchStats from '../components/fetch/FetchStats'

interface PlatformStats {
  platform: string
  hackathons: { fetched: number; enriched: number; pending: number }
  internships: { fetched: number; enriched: number; pending: number }
}

interface Stats {
  totalFetched: number
  totalEnriched: number
  totalPending: number
  platforms: PlatformStats[]
}

const HACKATHON_PLATFORMS = [
  { id: 'DEVFOLIO', name: 'Devfolio', icon: '💻', color: 'border-l-[#635BFF]' },
  { id: 'DEVPOST', name: 'Devpost', icon: '🏆', color: 'border-l-[#635BFF]' },
  { id: 'MLH', name: 'MLH', icon: '🎯', color: 'border-l-[#DC2626]' },
  { id: 'UNSTOP', name: 'Unstop', icon: '🚀', color: 'border-l-[#F5A623]' },
]

const INTERNSHIP_PLATFORMS = [
  { id: 'INTERNSHALA', name: 'Internshala', icon: '💼', color: 'border-l-[#007060]' },
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
  const [fetchingAll, setFetchingAll] = useState(false)
  const [enrichingAll, setEnrichingAll] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const fetchStats = async () => {
    try {
      const { data } = await api.get('/fetch/stats')
      setStats(data)
    } catch (error: any) {
      console.error('Failed to fetch stats:', error?.response?.data || error.message)
    } finally {
      setLoading(false)
    }
  }

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
      const hackRes = await api.post('/fetch/hackathons/enrich')
      const internRes = await api.post('/fetch/internships/enrich')
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900">Fetch Opportunities</h1>
          <p className="text-surface-500 mt-1">Manage data fetching from external platforms</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => fetchStats()}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-surface-100 text-surface-700 rounded-lg hover:bg-surface-200 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </button>
          <button
            onClick={handleEnrichAll}
            disabled={enrichingAll}
            className="flex items-center gap-2 px-4 py-2 bg-surface-100 text-surface-700 rounded-lg hover:bg-surface-200 transition-colors disabled:opacity-50"
          >
            {enrichingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Enrich All
          </button>
          <button
            onClick={handleFetchAll}
            disabled={fetchingAll}
            className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-xl hover:bg-primary-600 transition-colors disabled:opacity-50 text-sm font-medium"
          >
            {fetchingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Fetch All
          </button>
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
        <h2 className="text-lg font-semibold text-surface-900 mb-4 flex items-center gap-2">
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
              onRefresh={fetchStats}
            />
          ))}
        </div>
      </div>

      {/* Internship Platforms */}
      <div>
        <h2 className="text-lg font-semibold text-surface-900 mb-4 flex items-center gap-2">
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
              onRefresh={fetchStats}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
