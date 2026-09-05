import { useState, useEffect } from 'react'
import { Download, RefreshCw, Loader2, Globe } from 'lucide-react'
import api from '../../lib/api'

interface Props {
  type: 'hackathons' | 'internships'
  platform: string // "OTHER_HACKATHON" | "OTHER_INTERNSHIP"
  onRefresh?: () => void
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

const META: Record<string, { name: string; icon: string; color: string; desc: string }> = {
  OTHER_HACKATHON: { name: 'Other Hackathons', icon: '🌐', color: 'border-l-teal-500', desc: 'India + global hackathons via search' },
  OTHER_INTERNSHIP: { name: 'Other Internships', icon: '🌍', color: 'border-l-teal-600', desc: 'India + global internships via search' },
}

export default function OtherSourcesCard({ type, platform, onRefresh }: Props) {
  const [fetching, setFetching] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [pasteFetching, setPasteFetching] = useState(false)
  const [limit, setLimit] = useState(0)
  const [savingLimit, setSavingLimit] = useState(false)
  const [stats, setStats] = useState({ fetched: 0, enriched: 0, pending: 0 })
  const [urlsText, setUrlsText] = useState('')
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const meta = META[platform] || { name: platform, icon: '🌐', color: 'border-l-teal-500', desc: '' }
  const enrichedPercent = stats.fetched > 0 ? Math.round((stats.enriched / stats.fetched) * 100) : 0

  const loadStats = async () => {
    try {
      const { data } = await api.get('/fetch/stats')
      const found = data.platforms?.find((p: any) => p.platform === platform)
      if (found) {
        const s = type === 'hackathons' ? found.hackathons : found.internships
        setStats({ fetched: s.fetched, enriched: s.enriched, pending: s.pending })
      }
    } catch {}
  }

  // Keep limits as other PlatformCards — unified PlatformSettings pattern:
  // Other sources share platform 'OTHER' with type HACKATHON/INTERNSHIP (vs split OTHER_HACKATHON/OTHER_INTERNSHIP).
  // This keeps limit persistence identical to PlatformCard (GET /fetch/settings/all → find platform+type, PUT /fetch/other/limit).
  // Fallback to legacy split platform supports existing rows after migration.
  const LIMIT_PLATFORM = 'OTHER'

  const loadLimit = async () => {
    try {
      const { data } = await api.get('/fetch/settings/all')
      const expectedType = type === 'hackathons' ? 'HACKATHON' : 'INTERNSHIP'
      // Primary: unified OTHER (preferred per PlatformSettings pattern like PlatformCard)
      let setting = data.settings?.find((s: any) => s.platform === LIMIT_PLATFORM && s.type === expectedType)
      // Fallback: legacy split (OTHER_HACKATHON / OTHER_INTERNSHIP) for backward compat
      if (!setting) {
        setting = data.settings?.find((s: any) => s.platform === platform && s.type === expectedType)
      }
      if (setting) setLimit(setting.fetchLimit)
    } catch {}
  }

  useEffect(() => {
    loadStats()
    loadLimit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, type])

  const handleLimitChange = async (newLimit: number) => {
    setLimit(newLimit)
    setSavingLimit(true)
    try {
      // Same persistence as PlatformCard: PUT /fetch/${platform.toLowerCase()}/limit with {limit, type}
      // Use unified OTHER platform so both hackathon/internship cards persist via PlatformSettings like other cards.
      await api.put(`/fetch/${LIMIT_PLATFORM.toLowerCase()}/limit`, {
        limit: newLimit,
        type: type === 'hackathons' ? 'HACKATHON' : 'INTERNSHIP',
      })
    } catch (e) {
      console.error('Failed to save limit', e)
    } finally {
      setSavingLimit(false)
    }
  }

  const handleFetch = async () => {
    setFetching(true)
    setMsg(null)
    try {
      const endpoint =
        type === 'hackathons' ? '/fetch/other/hackathons' : '/fetch/other/internships'
      // 120s: OTHER fetch does page scrape + Groq enrichment (6023 chars) which can exceed default 60s.
      const { data } = await api.post(endpoint, { limit }, { timeout: 120000 })
      // Backend returns {success:true, fetched, saved, enriched} even when trust HIGH (ai:HIGH computed:MEDIUM) — treat any success true as success.
      if (data?.success === false) throw new Error(data?.error || 'Fetch failed')
      const enrichedVal = data?.enriched ?? 0
      setMsg({ type: 'success', text: data?.message || `Fetched ${data?.fetched ?? 0} • saved ${data?.saved ?? 0} • enriched ${enrichedVal}` })
      await loadStats()
      onRefresh?.()
    } catch (error: any) {
      const isTimeout = error?.code === 'ECONNABORTED' || String(error?.message || '').toLowerCase().includes('timeout')
      if (isTimeout) {
        setMsg({ type: 'error', text: 'Fetch timed out — backend may still be enriching (check logs). Refresh stats to verify.' })
      } else {
        setMsg({ type: 'error', text: error?.response?.data?.error || error?.message || 'Fetch failed' })
      }
    } finally {
      setFetching(false)
    }
  }

  const handleEnrich = async () => {
    setEnriching(true)
    setMsg(null)
    try {
      const endpoint =
        type === 'hackathons'
          ? `/fetch/hackathons/enrich?source=${platform}&limit=${limit > 0 ? limit : ''}`
          : `/fetch/internships/enrich?source=${platform}&limit=${limit > 0 ? limit : ''}`
      // Enrich fetches 1 page (6023 chars) + Groq openai/gpt-oss-120b — needs longer than default; backend succeeded 11 fields trust HIGH even when computed MEDIUM.
      const { data } = await api.post(endpoint, {}, { timeout: 120000 })
      // Do not treat enriched===0 as failure — backend returns success:true with enriched 0 when no pending or AI_DISABLED; trust mismatch HIGH vs MEDIUM is not an error.
      if (data?.success === false) throw new Error(data?.error || 'Enrich failed')
      if (typeof data?.enriched === 'number' || data?.message) {
        setMsg({ type: 'success', text: data.message || `Enriched ${data.enriched ?? 0}` })
      } else {
        // Fallback: backend always returns success true even for trust HIGH/MEDIUM; show generic success
        setMsg({ type: 'success', text: data?.message || `Enriched ${data?.enriched ?? 0}` })
      }
      await loadStats()
      onRefresh?.()
    } catch (error: any) {
      const isTimeout = error?.code === 'ECONNABORTED' || String(error?.message || '').toLowerCase().includes('timeout')
      if (isTimeout) {
        setMsg({ type: 'error', text: 'Enrich timed out — backend may still be enriching (check logs for 11 fields updated). Refresh to verify.' })
      } else {
        setMsg({ type: 'error', text: error?.response?.data?.error || error?.message || 'Enrich failed' })
      }
    } finally {
      setEnriching(false)
    }
  }

  const handlePasteFetch = async () => {
    const raw = urlsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    if (raw.length === 0) {
      setMsg({ type: 'error', text: 'Paste at least 1 URL' })
      return
    }
    if (raw.length > 10) {
      setMsg({ type: 'error', text: 'Up to 10 URLs only' })
      return
    }
    setPasteFetching(true)
    setMsg(null)
    try {
      const { data } = await api.post('/fetch/custom', { urls: raw, type }, { timeout: 120000 })
      if (data?.success === false) throw new Error(data?.error || 'Paste fetch failed')
      setMsg({ type: 'success', text: data?.message || `Pasted ${data.saved ?? raw.length} saved • enriched ${data.enriched ?? 0}` })
      setUrlsText('')
      await loadStats()
      onRefresh?.()
    } catch (error: any) {
      const isTimeout = error?.code === 'ECONNABORTED' || String(error?.message || '').toLowerCase().includes('timeout')
      if (isTimeout) {
        setMsg({ type: 'error', text: 'Paste timed out — backend may still be processing. Refresh stats.' })
        return
      }
      const err = error?.response?.data?.error || error?.message || 'Paste fetch failed'
      // If custom endpoint not implemented, show graceful fallback
      if (error?.response?.status === 404) {
        setMsg({ type: 'error', text: 'Paste endpoint not available — use Bulk Fetch' })
      } else {
        setMsg({ type: 'error', text: err })
      }
    } finally {
      setPasteFetching(false)
    }
  }

  return (
    <div className={`bg-white dark:bg-night-800 rounded-xl border border-surface-200 dark:border-night-600 p-4 border-l-4 ${meta.color}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{meta.icon}</span>
          <div>
            <h3 className="font-semibold text-surface-900 dark:text-night-50 leading-none">{meta.name}</h3>
            <p className="text-[11px] text-surface-500 dark:text-night-400">{meta.desc}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
            {savingLimit && <Loader2 className="w-3 h-3 animate-spin text-surface-400" />}
          </div>
          {stats.fetched > 0 && (
            <span
              className={`px-2 py-1 rounded-full text-xs font-medium ${
                stats.pending === 0 ? 'bg-green-100 text-green-700' : stats.pending > 5 ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
              }`}
            >
              {stats.pending === 0 ? 'Complete' : `${stats.pending} pending`}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="text-center">
          <p className="text-2xl font-bold text-surface-900 dark:text-night-50">{stats.fetched}</p>
          <p className="text-xs text-surface-500 dark:text-night-400">Fetched</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-green-600">{stats.enriched}</p>
          <p className="text-xs text-surface-500 dark:text-night-400">Enriched</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-yellow-600">{stats.pending}</p>
          <p className="text-xs text-surface-500 dark:text-night-400">Pending</p>
        </div>
      </div>

      <div className="w-full bg-surface-100 dark:bg-night-700 rounded-full h-2 mb-4">
        <div className="bg-teal-500 h-2 rounded-full transition-all duration-300" style={{ width: `${enrichedPercent}%` }} />
      </div>

      {msg && (
        <div className={`mb-3 text-xs px-3 py-2 rounded-lg border ${msg.type === 'success' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
          {msg.text}
        </div>
      )}

      <div className="flex gap-2 mb-3">
        <button
          onClick={handleFetch}
          disabled={fetching}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 text-sm"
        >
          {fetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Fetch
        </button>
        <button
          onClick={handleEnrich}
          disabled={enriching || stats.pending === 0}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-surface-100 dark:bg-night-700 text-surface-700 dark:text-night-200 rounded-lg hover:bg-surface-200 transition-colors disabled:opacity-50 text-sm"
        >
          {enriching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Re-enrich
        </button>
      </div>

      {/* Paste separate mode — not union with bulk */}
      <div className="border-t border-surface-100 dark:border-night-700 pt-3">
        <label className="text-xs font-medium text-surface-600 dark:text-night-300 flex items-center gap-1.5 mb-1.5">
          <Globe className="w-3.5 h-3.5" /> Paste custom URLs (up to 10) — separate from Bulk
        </label>
        <textarea
          value={urlsText}
          onChange={(e) => setUrlsText(e.target.value)}
          placeholder={'https://example.com/hackathon-1\nhttps://example.com/hackathon-2'}
          rows={3}
          className="w-full text-xs border border-surface-300 dark:border-night-600 rounded-lg px-3 py-2 bg-white dark:bg-night-800 text-surface-700 dark:text-night-200 placeholder:text-surface-400 focus:outline-none focus:ring-1 focus:ring-teal-500 resize-none"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-[11px] text-surface-500 dark:text-night-400">
            {urlsText.split('\n').filter((s) => s.trim()).length}/10 URLs
          </span>
          <button
            onClick={handlePasteFetch}
            disabled={pasteFetching || urlsText.trim().length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-night-700 border border-surface-200 dark:border-night-600 text-surface-700 dark:text-night-200 rounded-lg hover:bg-surface-50 dark:hover:bg-night-600 text-xs font-medium disabled:opacity-50"
          >
            {pasteFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            Fetch Pasted
          </button>
        </div>
        <p className="text-[11px] text-surface-400 dark:text-night-500 mt-1">Bulk and Paste are separate — Paste does not combine with Limit.</p>
      </div>
    </div>
  )
}
