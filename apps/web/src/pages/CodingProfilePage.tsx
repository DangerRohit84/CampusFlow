import { useState, useEffect, useRef } from 'react'
import { codingProfileAPI, departmentAPI, waitForCodingSync } from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Code, Loader2, ExternalLink, RefreshCw, AlertTriangle,
  Trophy, TrendingUp, Target, BarChart3, Medal, ChevronDown, Users, Star, Award, Filter
} from 'lucide-react'
import toast from 'react-hot-toast'
import { PlatformLogo } from '../components/PlatformLogos'

interface PlatformStat {
  platform: string
  handle: string
  valid: boolean
  problemsSolved?: number | null
  easySolved?: number | null
  mediumSolved?: number | null
  hardSolved?: number | null
  totalProblems?: number | null
  rating?: number | null
  maxRating?: number | null
  rankTitle?: string | null
  maxRankTitle?: string | null
  globalRank?: number | null
  countryRank?: number | null
  stars?: number | null
  division?: string | null
  score?: number | null
  badges?: number | null
  contestCount?: number | null
}

const platforms = [
  { key: 'leetcodeHandle', label: 'LeetCode', id: 'leetcode', color: '#FFA116', url: 'https://leetcode.com/' },
  { key: 'codeforcesHandle', label: 'Codeforces', id: 'codeforces', color: '#1F8ACB', url: 'https://codeforces.com/profile/' },
  { key: 'codechefHandle', label: 'CodeChef', id: 'codechef', color: '#5B4638', url: 'https://www.codechef.com/users/' },
  { key: 'hackerrankHandle', label: 'HackerRank', id: 'hackerrank', color: '#00EA64', url: 'https://www.hackerrank.com/profile/' },
  { key: 'gfgHandle', label: 'GeeksforGeeks', id: 'gfg', color: '#2F8D46', url: 'https://www.geeksforgeeks.org/user/' },
]

const platformColors: Record<string, { bg: string; text: string; border: string }> = {
  leetcode: { bg: 'bg-yellow-50 dark:bg-yellow-500/10', text: 'text-yellow-700 dark:text-yellow-400', border: 'border-yellow-200 dark:border-yellow-500/20' },
  codeforces: { bg: 'bg-blue-50 dark:bg-blue-500/10', text: 'text-blue-700 dark:text-blue-400', border: 'border-blue-200 dark:border-blue-500/20' },
  codechef: { bg: 'bg-amber-50 dark:bg-amber-500/10', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-500/20' },
  hackerrank: { bg: 'bg-green-50 dark:bg-green-500/10', text: 'text-green-700 dark:text-green-400', border: 'border-green-200 dark:border-green-500/20' },
  gfg: { bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-500/20' },
}

// Codeforces rating -> color (official palette)
function cfColor(rating: number | null | undefined): string {
  if (!rating) return '#9CA3AF'
  if (rating < 1200) return '#808080'      // Newbie
  if (rating < 1400) return '#00A210'      // Pupil
  if (rating < 1600) return '#03A89E'      // Specialist
  if (rating < 1900) return '#0000FF'      // Expert
  if (rating < 2100) return '#AA00AA'      // Candidate Master
  if (rating < 2300) return '#FF8C00'      // Master
  if (rating < 2400) return '#FF8C00'      // International Master
  return '#FF0000'                          // Grandmaster+
}

// CodeChef stars -> color
function ccStarColor(stars: number): string {
  const colors = ['#666666', '#2E8B57', '#1565C0', '#8E24AA', '#EF6C00']
  return colors[Math.min(Math.max(stars, 1), 5) - 1]
}

function StatBox({ value, label, accent }: { value: React.ReactNode; label: string; accent?: boolean }) {
  return (
    <div className="text-center px-2 py-1.5 rounded-xl bg-white/50 dark:bg-night-850/60">
      <p className={`text-lg font-bold ${accent ? 'text-primary-600 dark:text-[#90B9A4]' : 'text-surface-900 dark:text-night-50'}`}>{value}</p>
      <p className="text-[10px] text-surface-500 dark:text-night-300 leading-tight mt-0.5">{label}</p>
    </div>
  )
}

// Difficulty bar for LeetCode
function DifficultyBar({ stat }: { stat: PlatformStat }) {
  const items = [
    { label: 'Easy', count: stat.easySolved ?? 0, total: Math.max(stat.easySolved ?? 0, 850), color: '#22C55E' },
    { label: 'Med.', count: stat.mediumSolved ?? 0, total: Math.max(stat.mediumSolved ?? 0, 1750), color: '#F59E0B' },
    { label: 'Hard', count: stat.hardSolved ?? 0, total: Math.max(stat.hardSolved ?? 0, 750), color: '#EF4444' },
  ]
  return (
    <div className="space-y-2">
      {items.map((it) => (
        <div key={it.label}>
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-surface-500 dark:text-night-300">{it.label}</span>
            <span className="font-medium text-surface-700 dark:text-night-200">{it.count}</span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-100 dark:bg-night-600 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, (it.count / it.total) * 100)}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className="h-full rounded-full"
              style={{ backgroundColor: it.color }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function CodingProfilePage() {
  const { user } = useAuthStore()
  const [profile, setProfile] = useState<any>(null)
  const [handles, setHandles] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [participations, setParticipations] = useState<any[]>([])
  const [leaderboard, setLeaderboard] = useState<any[]>([])
  const [showProfilePrompt, setShowProfilePrompt] = useState(false)
  const [showHandles, setShowHandles] = useState(false)
  const [activeTab, setActiveTab] = useState<'stats' | 'history' | 'leaderboard'>('stats')
  const [historyFilter, setHistoryFilter] = useState('all')
  const [leaderboardPlatform, setLeaderboardPlatform] = useState('all')
  const [leaderboardDept, setLeaderboardDept] = useState('all')
  const [departments, setDepartments] = useState<any[]>([])
  const autoSyncRef = useRef(false)

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      const [profileData, partData] = await Promise.all([
        codingProfileAPI.get(),
        codingProfileAPI.getParticipations(),
      ])
      setProfile(profileData)
      setHandles({
        leetcodeHandle: profileData?.leetcodeHandle || '',
        codeforcesHandle: profileData?.codeforcesHandle || '',
        codechefHandle: profileData?.codechefHandle || '',
        hackerrankHandle: profileData?.hackerrankHandle || '',
        gfgHandle: profileData?.gfgHandle || '',
      })
      setParticipations(partData)
      const count = [
        profileData?.leetcodeHandle,
        profileData?.codeforcesHandle,
        profileData?.codechefHandle,
        profileData?.hackerrankHandle,
        profileData?.gfgHandle,
      ].filter(Boolean).length
      if (count === 0 && !showProfilePrompt) setShowProfilePrompt(true)

      // Auto-sync in background when data is stale (>30 min) and handles exist
      if (count > 0 && !autoSyncRef.current) {
        const last = profileData?.lastSyncedAt ? new Date(profileData.lastSyncedAt).getTime() : 0
        if (Date.now() - last > 30 * 60 * 1000) {
          autoSyncRef.current = true
          codingProfileAPI.sync(true)
            .then((r: any) => {
              // 202 = sync kicked off server-side; refresh once it has likely finished
              if (r && !r.skipped) {
                setTimeout(() => { autoSyncRef.current = false; loadData() }, 20000)
              } else {
                autoSyncRef.current = false
              }
            })
            .catch(() => { autoSyncRef.current = false })
        }
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const loadLeaderboard = async (platform = leaderboardPlatform, deptId = leaderboardDept) => {
    try {
      const params: { platform?: string; departmentId?: string } = {}
      if (platform !== 'all') params.platform = platform
      if (deptId !== 'all') params.departmentId = deptId
      const data = await codingProfileAPI.getLeaderboard(params)
      setLeaderboard(data)
    } catch { }
  }

  useEffect(() => {
    departmentAPI.getAll().then(setDepartments).catch(() => {})
  }, [])

  useEffect(() => {
    if (activeTab === 'leaderboard') loadLeaderboard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, leaderboardPlatform, leaderboardDept])

  const handleSave = async () => {
    setSaving(true)
    try {
      await codingProfileAPI.update(handles)
      toast.success('Profiles saved! Hit Sync to fetch your stats.')
      loadData()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleSync = async () => {
    if (syncing) return
    const baseline = profile?.lastSyncedAt ? new Date(profile.lastSyncedAt).getTime() : 0
    setSyncing(true)
    try {
      const result = await codingProfileAPI.sync()
      if (result?.skipped) {
        if (result.reason === 'no-handles') {
          // Server refused to start a job because no handles are configured —
          // inform instead of polling until timeout.
          toast(result.message || 'Add at least one coding platform handle first', { icon: 'ℹ️' })
        } else {
          toast.success('Stats are already up to date')
        }
        setSyncing(false)
        return
      }
    } catch {
      toast.error('Sync failed')
      setSyncing(false)
      return
    }
    toast.success('Syncing your profiles...')
    const { completed } = await waitForCodingSync(baseline)
    if (completed) toast.success('Profiles synced!')
    else toast.error('Sync is taking longer than expected')
    loadData()
    setSyncing(false)
  }

  const filledCount = Object.values(handles).filter(Boolean).length

  // Parse stored platform stats
  let statsMap: Record<string, PlatformStat> = {}
  try {
    const parsed: PlatformStat[] = profile?.platformStats ? JSON.parse(profile.platformStats) : []
    statsMap = Object.fromEntries(parsed.filter(s => s.valid).map(s => [s.platform, s]))
  } catch { statsMap = {} }

  // Aggregate numbers
  const totalSolved = Object.values(statsMap).reduce((s, st) => s + (st.problemsSolved || 0), 0)
  const totalContests = participations.length
  const ratedPlatforms = Object.values(statsMap).filter(s => s.rating)
  const bestRating = ratedPlatforms.reduce((max, s) => Math.max(max, s.rating || 0), 0)
  const avgRank = participations.length > 0
    ? Math.round(participations.filter(p => p.rank).reduce((s, p) => s + p.rank, 0) / participations.filter(p => p.rank).length)
    : null

  const filteredParticipations = historyFilter === 'all'
    ? participations
    : participations.filter(p => p.platform === historyFilter)

  if (loading) return (
    <div className="flex items-center justify-center h-96">
      <Loader2 className="animate-spin text-primary-500 dark:text-[#90B9A4]" size={32} />
    </div>
  )

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">

      {/* ===== Header ===== */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-primary-600 dark:from-[#90B9A4] dark:to-[#A8C2B3] flex items-center justify-center text-white font-bold text-xl shadow-lg">
            {user?.name?.charAt(0) || 'S'}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-surface-900 dark:text-night-50">{user?.name}</h1>
            <p className="text-sm text-surface-500 dark:text-night-300">
              {filledCount > 0 ? `${filledCount} platform${filledCount > 1 ? 's' : ''} linked` : 'No platforms linked yet'}
              {profile?.lastSyncedAt && ` ⬢ Last synced ${new Date(profile.lastSyncedAt).toLocaleDateString()}`}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowHandles(!showHandles)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-200 dark:border-night-600 text-surface-700 dark:text-night-200 hover:bg-surface-100 dark:hover:bg-night-700 text-sm font-medium transition-colors"
          >
            <Code size={16} /> Handles {filledCount > 0 && `(${filledCount})`}
            <ChevronDown size={14} className={`transition-transform ${showHandles ? 'rotate-180' : ''}`} />
          </button>
          <button
            onClick={handleSync}
            disabled={syncing || filledCount === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 dark:bg-[#90B9A4] dark:hover:bg-[#A8C2B3] text-white text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {syncing ? 'Syncing...' : 'Sync Stats'}
          </button>
        </div>
      </motion.div>

      {/* ===== Collapsible Handles Editor ===== */}
      <AnimatePresence>
        {showHandles && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-surface-50 dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 p-6">
              <h3 className="font-semibold text-surface-900 dark:text-night-50 mb-4">Platform Handles</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {platforms.map((p) => (
                  <div key={p.key} className="flex items-center gap-2">
                    <span className="w-6 flex justify-center shrink-0"><PlatformLogo platform={p.id} size={20} /></span>
                    <input
                      type="text"
                      value={handles[p.key] || ''}
                      onChange={(e) => setHandles({ ...handles, [p.key]: e.target.value })}
                      placeholder={`${p.label} username`}
                      className="flex-1 min-w-0 px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 rounded-xl text-sm text-surface-900 dark:text-night-50 placeholder-surface-400"
                    />
                    {handles[p.key] && (
                      <a href={`${p.url}${handles[p.key]}`} target="_blank" rel="noopener noreferrer"
                        className="p-1.5 text-surface-400 hover:text-primary-500 shrink-0">
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </div>
                ))}
              </div>
              <button onClick={handleSave} disabled={saving}
                className="mt-4 px-5 py-2 bg-primary-600 hover:bg-primary-700 dark:bg-[#90B9A4] dark:hover:bg-[#A8C2B3] text-white rounded-xl text-sm font-medium disabled:opacity-50 flex items-center gap-2">
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                Save Handles
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== Tabs ===== */}
      <div className="flex gap-1 bg-surface-100 dark:bg-night-800 rounded-xl p-1 w-fit">
        {[
          { key: 'stats', label: 'My Stats', icon: BarChart3 },
          { key: 'history', label: 'Contest History', icon: Trophy },
          { key: 'leaderboard', label: 'College Leaderboard', icon: Medal },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-white dark:bg-night-650 text-primary-600 dark:text-[#90B9A4] shadow-sm'
                : 'text-surface-500 dark:text-night-300 hover:text-surface-700 dark:hover:text-night-200'
            }`}
          >
            <tab.icon size={16} /> {tab.label}
          </button>
        ))}
      </div>

      {/* ================= STATS TAB ================= */}
      {activeTab === 'stats' && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Problems Solved', value: totalSolved.toLocaleString(), sub: 'across all platforms', icon: Target, grad: 'from-emerald-400 to-teal-500' },
              { label: 'Contests', value: totalContests, sub: avgRank ? `avg rank #${avgRank}` : 'participated', icon: Trophy, grad: 'from-yellow-400 to-orange-500' },
              { label: 'Best Rating', value: bestRating || '—', sub: bestRating ? cfColor(bestRating) !== '#9CA3AF' ? 'peak performance' : '' : 'sync to update', icon: TrendingUp, grad: 'from-blue-400 to-indigo-500' },
              { label: 'Linked Platforms', value: `${Object.keys(statsMap).length}/${filledCount}`, sub: 'with live data', icon: Code, grad: 'from-purple-400 to-pink-500' },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07 }}
                className="bg-surface-50 dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 p-5"
              >
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${stat.grad} flex items-center justify-center text-white mb-3`}>
                  <stat.icon size={20} />
                </div>
                <p className="text-2xl font-bold text-surface-900 dark:text-night-50">{stat.value}</p>
                <p className="text-xs font-medium text-surface-600 dark:text-night-200">{stat.label}</p>
                {stat.sub && <p className="text-[10px] text-surface-400 dark:text-night-300 mt-0.5">{stat.sub}</p>}
              </motion.div>
            ))}
          </div>

          {/* Per-platform cards */}
          {Object.keys(statsMap).length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* ---- LeetCode ---- */}
              {statsMap.leetcode && (() => {
                const s = statsMap.leetcode
                return (
                  <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                    className="bg-surface-50 dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl bg-white dark:bg-night-850 border border-surface-200/50 dark:border-night-600 flex items-center justify-center">
                          <PlatformLogo platform="leetcode" size={26} />
                        </div>
                        <div>
                          <p className="font-bold text-surface-900 dark:text-night-50">LeetCode</p>
                          <a href={`https://leetcode.com/u/${s.handle}`} target="_blank" rel="noopener noreferrer" className="text-xs text-surface-400 hover:text-primary-500 flex items-center gap-1">@{s.handle} <ExternalLink size={10} /></a>
                        </div>
                      </div>
                      {s.globalRank != null && (
                        <div className="text-right">
                          <p className="text-xs text-surface-400 dark:text-night-300">Global Rank</p>
                          <p className="font-bold text-surface-900 dark:text-night-50">#{(s.globalRank as number).toLocaleString()}</p>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-3xl font-extrabold text-surface-900 dark:text-night-50">{(s.problemsSolved ?? 0).toLocaleString()}</p>
                        <p className="text-xs text-surface-500 dark:text-night-300">problems solved</p>
                        {s.totalProblems != null && (
                          <p className="text-[10px] text-surface-400 mt-1">
                            {(((s.problemsSolved ?? 0) / s.totalProblems) * 100).toFixed(1)}% of {s.totalProblems.toLocaleString()}
                          </p>
                        )}
                      </div>
                      <DifficultyBar stat={s} />
                    </div>
                  </motion.div>
                )
              })()}

              {/* ---- Codeforces ---- */}
              {statsMap.codeforces && (() => {
                const s = statsMap.codeforces
                const color = cfColor(s.rating)
                return (
                  <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                    className="bg-surface-50 dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl bg-white dark:bg-night-850 border border-surface-200/50 dark:border-night-600 flex items-center justify-center">
                          <PlatformLogo platform="codeforces" size={26} />
                        </div>
                        <div>
                          <p className="font-bold text-surface-900 dark:text-night-50">Codeforces</p>
                          <a href={`https://codeforces.com/profile/${s.handle}`} target="_blank" rel="noopener noreferrer" className="text-xs text-surface-400 hover:text-primary-500 flex items-center gap-1">@{s.handle} <ExternalLink size={10} /></a>
                        </div>
                      </div>
                      {s.rankTitle && (
                        <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold text-white" style={{ backgroundColor: color }}>
                          {s.rankTitle}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <p className="text-3xl font-extrabold" style={{ color }}>{s.rating ?? '—'}</p>
                        <p className="text-xs text-surface-500 dark:text-night-300">current rating</p>
                      </div>
                      <div>
                        <p className="text-3xl font-extrabold text-surface-300 dark:text-[#2A3A4A]">{s.maxRating ?? '—'}</p>
                        <p className="text-xs text-surface-500 dark:text-night-300">max rating{s.maxRankTitle ? ` (${s.maxRankTitle})` : ''}</p>
                      </div>
                      <div className="space-y-1.5 pt-1">
                        <div className="flex items-baseline gap-1.5">
                          <p className="text-lg font-bold text-surface-900 dark:text-night-50">{(s.problemsSolved ?? 0).toLocaleString()}</p>
                          <span className="text-[10px] text-surface-400">solved</span>
                        </div>
                        <div className="flex items-baseline gap-1.5">
                          <p className="text-lg font-bold text-surface-900 dark:text-night-50">{s.contestCount ?? '—'}</p>
                          <span className="text-[10px] text-surface-400">contests</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )
              })()}

              {/* ---- CodeChef ---- */}
              {statsMap.codechef && (() => {
                const s = statsMap.codechef
                return (
                  <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                    className="bg-surface-50 dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl bg-white dark:bg-night-850 border border-surface-200/50 dark:border-night-600 flex items-center justify-center">
                          <PlatformLogo platform="codechef" size={26} />
                        </div>
                        <div>
                          <p className="font-bold text-surface-900 dark:text-night-50">CodeChef</p>
                          <a href={`https://www.codechef.com/users/${s.handle}`} target="_blank" rel="noopener noreferrer" className="text-xs text-surface-400 hover:text-primary-500 flex items-center gap-1">@{s.handle} <ExternalLink size={10} /></a>
                        </div>
                      </div>
                      {s.stars != null && (
                        <div className="flex items-center gap-1">
                          {Array.from({ length: s.stars }).map((_, i) => (
                            <Star key={i} size={16} fill={ccStarColor(s.stars!)} color={ccStarColor(s.stars!)} />
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <StatBox value={s.rating ?? '—'} label="rating" accent />
                      <StatBox value={(s.problemsSolved ?? 0).toLocaleString()} label="solved" />
                      <StatBox value={s.globalRank ? `#${s.globalRank.toLocaleString()}` : '—'} label="global rank" />
                      <StatBox value={s.division ?? '—'} label="division" />
                    </div>
                  </motion.div>
                )
              })()}

              {/* ---- GFG ---- */}
              {statsMap.gfg && (() => {
                const s = statsMap.gfg
                return (
                  <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                    className="bg-surface-50 dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl bg-white dark:bg-night-850 border border-surface-200/50 dark:border-night-600 flex items-center justify-center">
                          <PlatformLogo platform="gfg" size={26} />
                        </div>
                        <div>
                          <p className="font-bold text-surface-900 dark:text-night-50">GeeksforGeeks</p>
                          <a href={`https://www.geeksforgeeks.org/user/${s.handle}/`} target="_blank" rel="noopener noreferrer" className="text-xs text-surface-400 hover:text-primary-500 flex items-center gap-1">@{s.handle} <ExternalLink size={10} /></a>
                        </div>
                      </div>
                      {s.countryRank != null && s.countryRank > 0 && (
                        <div className="text-right">
                          <p className="text-xs text-surface-400 dark:text-night-300">Institute Rank</p>
                          <p className="font-bold text-surface-900 dark:text-night-50">#{s.countryRank}</p>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <StatBox value={(s.problemsSolved ?? 0).toLocaleString()} label="problems solved" />
                      <StatBox value={(s.score ?? 0).toLocaleString()} label="coding score" accent />
                    </div>
                  </motion.div>
                )
              })()}

              {/* ---- HackerRank ---- */}
              {statsMap.hackerrank && (() => {
                const s = statsMap.hackerrank
                return (
                  <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                    className="bg-surface-50 dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl bg-white dark:bg-night-850 border border-surface-200/50 dark:border-night-600 flex items-center justify-center">
                          <PlatformLogo platform="hackerrank" size={26} />
                        </div>
                        <div>
                          <p className="font-bold text-surface-900 dark:text-night-50">HackerRank</p>
                          <a href={`https://www.hackerrank.com/profile/${s.handle}`} target="_blank" rel="noopener noreferrer" className="text-xs text-surface-400 hover:text-primary-500 flex items-center gap-1">@{s.handle} <ExternalLink size={10} /></a>
                        </div>
                      </div>
                      {s.badges != null && (
                        <div className="flex items-center gap-1.5 text-surface-600 dark:text-night-200">
                          <Award size={18} />
                          <span className="text-lg font-bold">{s.badges}</span>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <StatBox value={(s.score ?? 0).toLocaleString()} label="total score" />
                      <StatBox value={s.badges ?? '—'} label="badges earned" accent />
                    </div>
                  </motion.div>
                )
              })()}
            </div>
          ) : filledCount > 0 ? (
            <div className="bg-primary-50 dark:bg-[rgba(0,168,143,0.06)] border border-primary-200 dark:border-[rgba(0,168,143,0.25)] rounded-2xl p-6 text-center">
              <RefreshCw className="mx-auto text-primary-500 dark:text-[#90B9A4] mb-2" size={28} />
              <p className="font-semibold text-surface-900 dark:text-night-50">Handles saved  —  sync to load your stats</p>
              <p className="text-sm text-surface-500 dark:text-night-300 mt-1">Click "Sync Stats" above to pull problems solved, ratings and ranks.</p>
            </div>
          ) : (
            <div className="bg-surface-50 dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 p-12 text-center">
              <Code className="mx-auto text-surface-300 dark:text-[#232F3B] mb-3" size={40} />
              <p className="text-surface-500 dark:text-night-300">Link your handles above to see problem counts, ratings and contest history here.</p>
            </div>
          )}
        </div>
      )}

      {/* ================= HISTORY TAB ================= */}
      {activeTab === 'history' && (
        <div className="space-y-3">
          {/* Platform filter chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-surface-500 dark:text-night-300 mr-1">
              <Filter size={13} /> Filter:
            </span>
            <button
              onClick={() => setHistoryFilter('all')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                historyFilter === 'all'
                  ? 'bg-primary-600 dark:bg-[#90B9A4] text-white border-transparent'
                  : 'bg-surface-50 dark:bg-night-800 text-surface-600 dark:text-night-200 border-surface-200 dark:border-night-600 hover:bg-surface-100 dark:hover:bg-night-700'
              }`}
            >
              All ({participations.length})
            </button>
            {platforms.map((p) => {
              const count = participations.filter(x => x.platform === p.id).length
              if (count === 0) return null
              return (
                <button
                  key={p.id}
                  onClick={() => setHistoryFilter(p.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    historyFilter === p.id
                      ? 'bg-primary-600 dark:bg-[#90B9A4] text-white border-transparent'
                      : 'bg-surface-50 dark:bg-night-800 text-surface-600 dark:text-night-200 border-surface-200 dark:border-night-600 hover:bg-surface-100 dark:hover:bg-night-700'
                  }`}
                >
                  <PlatformLogo platform={p.id} size={12} /> {p.label} ({count})
                </button>
              )
            })}
          </div>

          <div className="bg-surface-50 dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 overflow-hidden">
          {filteredParticipations.length === 0 ? (
            <div className="p-12 text-center">
              <Trophy className="mx-auto text-surface-300 dark:text-[#232F3B] mb-3" size={40} />
              <p className="text-surface-500 dark:text-night-300">No contests found{historyFilter !== 'all' ? ' for this platform' : ' yet. Add handles and hit Sync.'}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-200 dark:border-night-600">
                    <th className="text-left py-3 px-4 text-surface-500 dark:text-night-300 font-medium">Contest</th>
                    <th className="text-left py-3 px-4 text-surface-500 dark:text-night-300 font-medium">Platform</th>
                    <th className="text-center py-3 px-4 text-surface-500 dark:text-night-300 font-medium">Rank</th>
                    <th className="text-center py-3 px-4 text-surface-500 dark:text-night-300 font-medium">Rating</th>
                    <th className="text-center py-3 px-4 text-surface-500 dark:text-night-300 font-medium">Change</th>
                    <th className="text-right py-3 px-4 text-surface-500 dark:text-night-300 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredParticipations.slice(0, 50).map((p) => {
                    const pc = platformColors[p.platform] || { bg: 'bg-surface-50', text: 'text-surface-700', border: 'border-surface-200' }
                    return (
                      <tr key={p.id} className="border-b border-surface-100 dark:border-night-700 hover:bg-surface-100 dark:hover:bg-night-700 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-medium text-surface-900 dark:text-night-50">{p.contestName}</div>
                          {p.contestUrl && (
                            <a href={p.contestUrl} target="_blank" rel="noopener noreferrer"
                              className="text-xs text-primary-500 hover:underline flex items-center gap-1">
                              View <ExternalLink size={10} />
                            </a>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${pc.bg} ${pc.text} border ${pc.border}`}>
                            {p.platform}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center font-medium text-surface-900 dark:text-night-50">
                          {p.rank ? `#${p.rank.toLocaleString()}` : '-'}
                        </td>
                        <td className="py-3 px-4 text-center font-semibold" style={{ color: cfColor(p.rating) }}>
                          {p.rating || '-'}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {p.ratingChange != null && p.ratingChange !== 0 ? (
                            <span className={p.ratingChange > 0 ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-red-500 font-medium'}>
                              {p.ratingChange > 0 ? '+' : ''}{p.ratingChange}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="py-3 px-4 text-right text-surface-500 dark:text-night-300">
                          {p.participatedAt ? new Date(p.participatedAt).toLocaleDateString() : '-'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          </div>
        </div>
      )}

      {/* ================= LEADERBOARD TAB ================= */}
      {activeTab === 'leaderboard' && (
        <div className="space-y-3">
          {/* Leaderboard filters */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs font-medium text-surface-500 dark:text-night-300">
              <Filter size={13} /> Filters:
            </span>

            {/* Platform select */}
            <select
              value={leaderboardPlatform}
              onChange={(e) => setLeaderboardPlatform(e.target.value)}
              className="px-3 py-2 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-sm text-surface-700 dark:text-night-200 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            >
              <option value="all">All Platforms</option>
              {platforms.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>

            {/* Department select */}
            <select
              value={leaderboardDept}
              onChange={(e) => setLeaderboardDept(e.target.value)}
              className="px-3 py-2 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-sm text-surface-700 dark:text-night-200 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            >
              <option value="all">All Departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          <div className="bg-surface-50 dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 overflow-hidden">
          {leaderboard.length === 0 ? (
            <div className="p-12 text-center">
              <Users className="mx-auto text-surface-300 dark:text-[#232F3B] mb-3" size={40} />
              <p className="text-surface-500 dark:text-night-300">
                {leaderboardPlatform !== 'all' || leaderboardDept !== 'all'
                  ? 'No entries match the selected filters.'
                  : 'No leaderboard data yet.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-200 dark:border-night-600">
                    <th className="text-left py-3 px-4 text-surface-500 dark:text-night-300 font-medium w-14">#</th>
                    <th className="text-left py-3 px-4 text-surface-500 dark:text-night-300 font-medium">Student</th>
                    <th className="text-left py-3 px-4 text-surface-500 dark:text-night-300 font-medium">Department</th>
                    <th className="text-center py-3 px-4 text-surface-500 dark:text-night-300 font-medium">Contests</th>
                    <th className="text-center py-3 px-4 text-surface-500 dark:text-night-300 font-medium">Best Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.slice(0, 50).map((entry, i) => (
                    <tr key={entry.userId}
                      className={`border-b border-surface-100 dark:border-night-700 hover:bg-surface-100 dark:hover:bg-night-700 transition-colors ${
                        entry.userId === user?.id ? 'bg-primary-50/60 dark:bg-[rgba(0,168,143,0.07)]' : ''
                      }`}>
                      <td className="py-3 px-4">
                        <span className={`font-bold ${
                          i === 0 ? 'text-yellow-500' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-amber-600' : 'text-surface-400'
                        }`}>
                          {i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                            {entry.name?.charAt(0) || '?'}
                          </div>
                          <div>
                            <p className="font-medium text-surface-900 dark:text-night-50">{entry.name}</p>
                            {entry.userId === user?.id && (
                              <span className="text-[10px] text-primary-500 dark:text-[#90B9A4] font-medium">You</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-surface-500 dark:text-night-300">{entry.department || '-'}</td>
                      <td className="py-3 px-4 text-center font-medium text-surface-900 dark:text-night-50">{entry.totalContests}</td>
                      <td className="py-3 px-4 text-center font-semibold" style={{ color: cfColor(entry.bestRating) }}>
                        {entry.bestRating || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </div>
        </div>
      )}

      {/* ===== First-time Prompt Modal ===== */}
      <AnimatePresence>
        {showProfilePrompt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 shadow-2xl max-w-md w-full p-8 text-center"
            >
              <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-warning-100 dark:bg-warning-900/30 flex items-center justify-center">
                <AlertTriangle className="text-warning-600 dark:text-warning-400" size={28} />
              </div>
              <h2 className="text-xl font-bold text-surface-900 dark:text-night-50 mb-2">Add Your Coding Profiles</h2>
              <p className="text-surface-500 dark:text-night-300 text-sm mb-6">
                Link at least one platform to track problems solved, ratings, contest history and compete on the college leaderboard.
              </p>
              <button
                onClick={() => { setShowProfilePrompt(false); setShowHandles(true) }}
                className="px-6 py-2.5 bg-primary-600 hover:bg-primary-700 dark:bg-[#90B9A4] dark:hover:bg-[#A8C2B3] text-white rounded-xl font-medium transition-colors"
              >
                Add Profiles
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
