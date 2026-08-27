import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { codingContestAPI, codingProfileAPI } from '../lib/api'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Trophy, Calendar, Clock, ExternalLink, Check,
  Trash2, Loader2, ChevronLeft, ChevronRight,
  Play, CheckCircle2, Filter, Youtube, Code2, TrendingUp,
  ChevronDown, ChevronUp, Download
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import FilterTabs from '../components/shared/FilterTabs'
import Pagination from '../components/shared/Pagination'
import EmptyState from '../components/shared/EmptyState'
import PageHeader from '../components/shared/PageHeader'
import { useFilteredItems } from '../hooks/useFilteredItems'
import { useModal } from '../hooks/useModal'

type Platform = 'ALL' | 'LEETCODE' | 'CODECHEF' | 'CODEFORCES'
type ContestStatus = 'ALL' | 'UPCOMING' | 'ONGOING' | 'ENDED'

const platformConfig: Record<string, { color: string; bg: string; label: string }> = {
  LEETCODE: { color: 'text-yellow-700', bg: 'bg-yellow-100', label: 'LeetCode' },
  CODECHEF: { color: 'text-warning-700', bg: 'bg-warning-100', label: 'CodeChef' },
  CODEFORCES: { color: 'text-primary-700', bg: 'bg-primary-100', label: 'Codeforces' },
}

const statusConfig: Record<string, { color: string; dot: string; label: string }> = {
  UPCOMING: { color: 'bg-primary-100 text-primary-700', dot: 'bg-primary-500', label: 'Upcoming' },
  ONGOING: { color: 'bg-primary-100 text-primary-700', dot: 'bg-primary-500', label: 'Ongoing' },
  ENDED: { color: 'bg-surface-100 text-surface-500', dot: 'bg-surface-400', label: 'Ended' },
}

export default function CodingContestsPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [contests, setContests] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  // calendar dots are now derived from filteredContests (respects status filter)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [platformFilter, setPlatformFilter] = useState<Platform>('ALL')
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [expandedContest, setExpandedContest] = useState<string | null>(null)
  const [solutions, setSolutions] = useState<Record<string, any[]>>({})
  const [myParticipations, setMyParticipations] = useState<any[]>([])
  const [participants, setParticipants] = useState<any[]>([])
  const [participantCounts, setParticipantCounts] = useState<Record<string, number>>({})
  const [activeParticipantContest, setActiveParticipantContest] = useState<string | null>(null)

  const createModal = useModal()
  const participantsModal = useModal()

  const isTeacher = user?.role === 'TEACHER' || user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'

  // Check if user participated in a specific contest
  const hasParticipated = (contest: any) => {
    return myParticipations.some((p) => {
      // Match by contestId if linked
      if (p.contestId && p.contestId === contest.id) return true
      // Fallback: match by platform + normalized title
      if (p.platform?.toLowerCase() !== contest.platform?.toLowerCase()) return false
      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
      const pName = normalize(p.contestName || '')
      const cTitle = normalize(contest.title || '')
      return pName === cTitle || pName.includes(cTitle) || cTitle.includes(pName)
    })
  }

  const [form, setForm] = useState({
    title: '',
    platform: 'LEETCODE',
    url: '',
    startTime: '',
    duration: '',
    contestType: 'OTHER',
  })

  useEffect(() => {
    const init = async () => {
      // Auto-fetch from platforms first, then load (with 6-hour cache)
      if (isTeacher) {
        const CACHE_KEY = 'campusflow-last-contest-fetch'
        const SIX_HOURS_MS = 6 * 60 * 60 * 1000
        const lastFetch = localStorage.getItem(CACHE_KEY)
        const now = Date.now()
        if (!lastFetch || now - parseInt(lastFetch, 10) > SIX_HOURS_MS) {
          try {
            await codingContestAPI.fetchNow()
            localStorage.setItem(CACHE_KEY, String(now))
          } catch {}
        }
      }
      await loadContests()
      codingContestAPI.getParticipantCounts().then(setParticipantCounts).catch(() => {})
      if (user?.role === 'STUDENT') {
        codingProfileAPI.getParticipations().then(setMyParticipations).catch(() => {})
      }
    }
    init()
  }, [currentMonth])

  const loadContests = async (platform?: string) => {
    try {
      const params: any = {}
      const plat = platform || platformFilter
      if (plat !== 'ALL') params.platform = plat
      const data = await codingContestAPI.getAll(params)
      setContests(data)
    } catch (err) {
      console.error('Failed to load contests', err)
    } finally {
      setLoading(false)
    }
  }

  // Calendar is now derived from filteredContests  —  no separate API call needed

  const loadParticipants = async (contestId: string) => {
    setActiveParticipantContest(contestId)
    setPartPage(1)
    const data = await codingProfileAPI.getContestParticipants(contestId)
    setParticipants(data)
    participantsModal.open()
  }

  // Participants modal pagination
  const [partPage, setPartPage] = useState(1)
  const partTotalPages = Math.max(1, Math.ceil(participants.length / 10))
  const pagedParticipants = participants.slice((partPage - 1) * 10, partPage * 10)

  const exportParticipantsToCSV = () => {
    if (participants.length === 0) {
      toast.error('No participants to export')
      return
    }
    const headers = ['name', 'department', 'rank', 'rating']
    const csvRows = [headers.join(',')]
    for (const row of participants) {
      csvRows.push(headers.map(h => `"${String(row[h] ?? row.user?.[h] ?? '').replace(/"/g, '""')}"`).join(','))
    }
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'participants.csv'
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Participants exported')
  }

  // Helper: local date string YYYY-MM-DD (avoids UTC shift from toISOString)
  const toLocalDateStr = (d: Date) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  const getContestStatus = (c: any): ContestStatus => {
    const now = new Date()
    const start = new Date(c.startTime)
    const end = new Date(start.getTime() + (c.duration || 180) * 60000)
    if (now < start) return 'UPCOMING'
    if (now > end) return 'ENDED'
    return 'ONGOING'
  }

  const { activeTab, setActiveTab, filteredItems: filteredContests } = useFilteredItems<any>({
    items: contests,
    tabs: [
      { key: 'ALL', label: 'All' },
      { key: 'UPCOMING', label: 'Upcoming' },
      { key: 'ONGOING', label: 'Ongoing' },
      { key: 'ENDED', label: 'Ended' },
    ],
    filterFn: (c, tab) => tab === 'ALL' || getContestStatus(c) === tab,
    defaultTab: 'UPCOMING',
  })

  const tabCounts = useMemo(() => ({
    ALL: contests.length,
    UPCOMING: contests.filter((c) => getContestStatus(c) === 'UPCOMING').length,
    ONGOING: contests.filter((c) => getContestStatus(c) === 'ONGOING').length,
    ENDED: contests.filter((c) => getContestStatus(c) === 'ENDED').length,
  }), [contests])

  const displayContests = useMemo(() => {
    let list = filteredContests
    if (selectedDate) {
      list = list.filter((c) => {
        const contestDate = toLocalDateStr(new Date(c.startTime))
        return contestDate === selectedDate
      })
    }
    // Sort by actual contest time: recently completed first, soonest upcoming first
    const ts = (s: string) => {
      const t = Date.parse(s)
      return isNaN(t) ? 0 : t
    }
    return [...list].sort((a, b) => {
      const sa = getContestStatus(a)
      const sb = getContestStatus(b)
      if (sa === 'UPCOMING' && sb === 'UPCOMING') return ts(a.startTime) - ts(b.startTime)
      return ts(b.startTime) - ts(a.startTime)
    })
  }, [filteredContests, selectedDate])

  // ===== Pagination =====
  const CONTESTS_PER_PAGE = 10
  const [page, setPage] = useState(1)
  const contestTotalPages = Math.max(1, Math.ceil(displayContests.length / CONTESTS_PER_PAGE))
  const pagedContests = displayContests.slice((page - 1) * CONTESTS_PER_PAGE, page * CONTESTS_PER_PAGE)
  useEffect(() => { setPage(1) }, [activeTab, platformFilter, selectedDate])

  const handleCreate = async () => {
    if (!form.title || !form.startTime) {
      toast.error('Title and start time are required')
      return
    }
    try {
      await codingContestAPI.create({
        ...form,
        duration: form.duration ? parseInt(form.duration) : null,
      })
      toast.success('Contest created!')
      createModal.close()
      setForm({ title: '', platform: 'LEETCODE', url: '', startTime: '', duration: '', contestType: 'OTHER' })
      loadContests()
    } catch (err) {
      toast.error('Failed to create contest')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this contest?')) return
    try {
      await codingContestAPI.delete(id)
      toast.success('Deleted')
      loadContests()
    } catch (err) {
      toast.error('Failed to delete')
    }
  }

  const toggleSolutions = (contestId: string) => {
    if (expandedContest === contestId) {
      setExpandedContest(null)
    } else {
      setExpandedContest(contestId)
      // Load solutions if not cached
      const contest = contests.find((c) => c.id === contestId)
      if (contest && !solutions[contestId]) {
        try {
          const parsed = JSON.parse(contest.solutions || '[]')
          setSolutions((prev) => ({ ...prev, [contestId]: parsed }))
        } catch {
          setSolutions((prev) => ({ ...prev, [contestId]: [] }))
        }
      }
    }
  }

  // ===== Manual solution add/remove (teachers/admins) =====
  const [showAddSolution, setShowAddSolution] = useState<string | null>(null)
  const [solProblem, setSolProblem] = useState('')
  const [solUrl, setSolUrl] = useState('')
  const [savingSolution, setSavingSolution] = useState(false)

  const handleAddSolution = async (contestId: string) => {
    if (!solProblem.trim() || !solUrl.trim()) {
      toast.error('Problem name and YouTube URL are required')
      return
    }
    if (!/youtu\.?be/i.test(solUrl)) {
      toast.error('Please paste a valid YouTube link')
      return
    }
    setSavingSolution(true)
    try {
      await codingContestAPI.addSolution(contestId, { problemName: solProblem.trim(), solutionUrl: solUrl.trim() })
      const contest = contests.find((c) => c.id === contestId)
      const updated = JSON.parse((contest?.solutions as string) || '[]').concat([
        { problemName: solProblem.trim(), solutionUrl: solUrl.trim() },
      ])
      setSolutions((prev) => ({ ...prev, [contestId]: updated }))
      setContests((prev) => prev.map((c) => c.id === contestId ? { ...c, solutions: JSON.stringify(updated) } : c))
      setSolProblem(''); setSolUrl(''); setShowAddSolution(null)
      toast.success('Solution added')
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to add solution')
    } finally {
      setSavingSolution(false)
    }
  }

  const handleRemoveSolution = async (contestId: string, idx: number) => {
    if (!window.confirm('Remove this solution?')) return
    try {
      await codingContestAPI.removeSolution(contestId, idx)
      setSolutions((prev) => ({ ...prev, [contestId]: (prev[contestId] || []).filter((_, i) => i !== idx) }))
      toast.success('Solution removed')
    } catch {
      toast.error('Failed to remove solution')
    }
  }

  // Counts derived straight from contest data so they're correct immediately after refresh
  const solutionCounts = useMemo(() => {
    const m: Record<string, number> = {}
    contests.forEach((c) => {
      try { m[c.id] = (JSON.parse(c.solutions || '[]') as any[]).length } catch { m[c.id] = 0 }
    })
    return m
  }, [contests])

  const formatDuration = (minutes: number | null) => {
    if (!minutes) return '—'
    const hrs = Math.floor(minutes / 60)
    const mins = minutes % 60
    if (hrs > 0 && mins > 0) return `${hrs}h ${mins}m`
    if (hrs > 0) return `${hrs}h`
    return `${mins}m`
  }

  // ===== YouTube helpers for solution cards =====
  const getYtId = (url?: string) => {
    if (!url) return null
    try {
      const u = new URL(url)
      if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0] || null
      if (u.searchParams.get('v')) return u.searchParams.get('v')
      const m = u.pathname.match(/\/(shorts|embed|live)\/([\w-]{6,})/)
      if (m) return m[2]
    } catch { /* ignore */ }
    return null
  }

  const getSolThumb = (sol: any) =>
    sol.thumbnail || (getYtId(sol.url || sol.solutionUrl) ? `https://i.ytimg.com/vi/${getYtId(sol.url || sol.solutionUrl)}/mqdefault.jpg` : '')

  const formatSecs = (secs?: number | null) => {
    if (!secs || secs <= 0) return null
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  }

  // Calendar helpers
  const getDaysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  }

  const getFirstDayOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay()
  }

  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))
    setSelectedDate(null)
  }

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))
    setSelectedDate(null)
  }

  const handleDateClick = (day: number) => {
    const dateStr = toLocalDateStr(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day))
    setSelectedDate(selectedDate === dateStr ? null : dateStr)
  }

  const calendarDays = useMemo(() => {
    const daysInMonth = getDaysInMonth(currentMonth)
    const firstDay = getFirstDayOfMonth(currentMonth)
    const days: Array<{ day: number; dateStr: string; hasContests: boolean; count: number; platforms: string[] }> = []

    // Build a map of date -> unique platforms from filtered contests
    const filteredByDate: Record<string, Set<string>> = {}
    for (const c of filteredContests) {
      const dateKey = toLocalDateStr(new Date(c.startTime))
      if (!filteredByDate[dateKey]) filteredByDate[dateKey] = new Set()
      filteredByDate[dateKey].add(c.platform)
    }

    for (let i = 0; i < firstDay; i++) {
      days.push({ day: 0, dateStr: '', hasContests: false, count: 0, platforms: [] })
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = toLocalDateStr(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), d))
      const platforms = filteredByDate[dateStr] ? Array.from(filteredByDate[dateStr]) : []
      days.push({ day: d, dateStr, hasContests: platforms.length > 0, count: platforms.length, platforms })
    }

    return days
  }, [currentMonth, filteredContests])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Coding Contests"
        subtitle="Track LeetCode, CodeChef, and Codeforces contests"
        action={
          <div className="flex items-center gap-3">
            {isTeacher && (
              <>
                <button
                  onClick={() => navigate('/contests/leaderboard')}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-yellow-500 to-warning-500 text-white rounded-xl hover:shadow-lg transition-all text-sm font-medium"
                >
                  <Trophy size={16} /> Leaderboard
                </button>
                <button
                  onClick={createModal.open}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-500 to-primary-500 text-white rounded-xl hover:shadow-lg transition-all text-sm font-medium"
                >
                  <Plus size={16} /> Add Contest
                </button>
              </>
            )}
          </div>
        }
      />

      {/* Platform Filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {(['ALL', 'LEETCODE', 'CODECHEF', 'CODEFORCES'] as Platform[]).map((p) => {
          const cfg = platformConfig[p]
          const isActive = platformFilter === p
          return (
            <button
              key={p}
              onClick={() => {
                setPlatformFilter(p)
                setSelectedDate(null)
                loadContests(p)
              }}
              className={clsx(
                'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all',
                isActive
                  ? 'bg-primary-500 text-white shadow-md'
                  : 'bg-surface-100 text-surface-600 hover:bg-surface-200 dark:bg-night-600 dark:text-night-200 dark:hover:bg-[#232F3B]'
              )}
            >
              {p === 'ALL' ? (
                <Filter size={14} />
              ) : (
                <Code2 size={14} className={isActive ? 'text-white' : cfg?.color} />
              )}
              {p === 'ALL' ? 'All' : cfg?.label || p}
            </button>
          )
        })}
      </div>

      {/* Status Tabs */}
      <FilterTabs
        tabs={[
          { key: 'UPCOMING', label: 'Upcoming', icon: Clock, count: tabCounts.UPCOMING },
          { key: 'ONGOING', label: 'Ongoing', icon: Play, count: tabCounts.ONGOING },
          { key: 'ENDED', label: 'Ended', icon: CheckCircle2, count: tabCounts.ENDED },
        ]}
        activeTab={activeTab}
        onTabChange={(key) => setActiveTab(key as any)}
      />

      {/* Selected Date Indicator */}
      {selectedDate && (
        <div className="flex items-center gap-2 px-4 py-2 bg-primary-50 rounded-xl border border-primary-100">
          <Calendar size={14} className="text-primary-500" />
          <span className="text-sm font-medium text-primary-700">
            Showing contests for {formatDate(selectedDate)}
          </span>
          <button
            onClick={() => setSelectedDate(null)}
            className="ml-auto text-primary-500 hover:text-primary-700 dark:hover:text-primary-400"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}

      {/* Main Content: Cards + Calendar */}
      <div className="flex gap-6">
        {/* Left Panel - Contest Cards (60%) */}
        <div className="flex-1 min-w-0">
          {displayContests.length === 0 ? (
            <EmptyState
              icon={Trophy}
              title="No contests found"
              description={isTeacher ? 'Add a contest or fetch from platforms' : 'No contests available yet'}
            />
          ) : (
            <>
            <div className="space-y-3">
              {pagedContests.map((c) => {
                const status = getContestStatus(c)
                const sCfg = statusConfig[status]
                const pCfg = platformConfig[c.platform] || { color: 'text-surface-700', bg: 'bg-surface-100', label: c.platform }
                const contestSolutions = solutions[c.id] || []
                const isExpanded = expandedContest === c.id

                return (
                  <motion.div
                    key={c.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-4 hover:shadow-lg transition-all"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={clsx('px-2 py-0.5 rounded-full text-xs font-semibold', pCfg.bg, pCfg.color)}>
                            {pCfg.label}
                          </span>
                          <span className={clsx('px-2 py-0.5 rounded-full text-xs font-semibold flex items-center gap-1', sCfg.color)}>
                            <span className={clsx('w-1.5 h-1.5 rounded-full', sCfg.dot)} />
                            {sCfg.label}
                          </span>
                          {c.contestType && c.contestType !== 'OTHER' && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-surface-100 text-surface-600 dark:bg-night-600 dark:text-night-200">
                              {c.contestType}
                            </span>
                          )}
                        </div>

                        <h3 className="font-bold text-surface-900 dark:text-night-50 mb-1 line-clamp-1">{c.title}</h3>

                        {(() => {
                          const mine = myParticipations.find((p) => {
                            if (p.contestId && p.contestId === c.id) return true
                            if (p.platform?.toLowerCase() !== c.platform?.toLowerCase()) return false
                            const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
                            const pn = norm(p.contestName || '')
                            const ct = norm(c.title || '')
                            return pn === ct || pn.includes(ct) || ct.includes(pn)
                          })
                          if (!mine) return null
                          return (
                            <div className="flex items-center gap-1.5 mt-2 mb-1 flex-wrap">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200/70 dark:border-emerald-500/25">
                                <CheckCircle2 size={11} /> Participated
                              </span>
                              {mine.rank ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-surface-100 dark:bg-night-700 text-surface-700 dark:text-night-200">
                                  <Trophy size={11} className="text-amber-500" /> Rank #{mine.rank.toLocaleString()}
                                </span>
                              ) : null}
                              {mine.rating ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-surface-100 dark:bg-night-700 text-surface-700 dark:text-night-200">
                                  <TrendingUp size={11} className="text-primary-500" /> {Math.round(mine.rating)}
                                </span>
                              ) : null}
                            </div>
                          )
                        })()}

                        <div className="flex items-center gap-4 text-xs text-surface-500">
                          <span className="flex items-center gap-1">
                            <Calendar size={12} className="text-primary-500" />
                            {formatDate(c.startTime)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock size={12} className="text-primary-500" />
                            {formatTime(c.startTime)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Play size={12} className="text-primary-500" />
                            {formatDuration(c.duration)}
                          </span>
                        </div>

                        {/* Solutions Section */}
                        {status === 'ENDED' && (
                          <div className="mt-3">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => toggleSolutions(c.id)}
                                className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700"
                              >
                                <Youtube size={14} />
                                Solutions ({solutionCounts[c.id] ?? 0})
                                {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                              </button>
                              {isTeacher && (
                                <button
                                  onClick={() => { setShowAddSolution(showAddSolution === c.id ? null : c.id); setSolProblem(''); setSolUrl('') }}
                                  className="flex items-center gap-1 text-xs font-medium text-accent-600 hover:text-accent-700"
                                >
                                  <Plus size={12} /> Add
                                </button>
                              )}
                            </div>

                            {/* Inline add form (teacher only) */}
                            {isTeacher && showAddSolution === c.id && (
                              <div className="mt-2 p-3 bg-surface-50 dark:bg-night-850 rounded-lg space-y-2">
                                <input
                                  type="text"
                                  value={solProblem}
                                  onChange={(e) => setSolProblem(e.target.value)}
                                  placeholder="Problem / contest name"
                                  className="w-full px-2.5 py-1.5 text-xs border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 rounded-lg text-surface-900 dark:text-night-50"
                                />
                                <input
                                  type="url"
                                  value={solUrl}
                                  onChange={(e) => setSolUrl(e.target.value)}
                                  placeholder="https://youtube.com/watch?v=..."
                                  className="w-full px-2.5 py-1.5 text-xs border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 rounded-lg text-surface-900 dark:text-night-50"
                                />
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => handleAddSolution(c.id)}
                                    disabled={savingSolution}
                                    className="px-3 py-1.5 text-xs font-medium bg-primary-600 hover:bg-primary-700 dark:bg-[#7BA290] dark:hover:bg-[#A8C2B3] text-white rounded-lg disabled:opacity-50 flex items-center gap-1"
                                  >
                                    {savingSolution ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
                                  </button>
                                  <button
                                    onClick={() => setShowAddSolution(null)}
                                    className="px-3 py-1.5 text-xs font-medium text-surface-500 hover:text-surface-700 dark:text-night-200 dark:hover:text-night-50"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}

                            <AnimatePresence>
                              {isExpanded && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  className="overflow-hidden"
                                >
                                  <div className="mt-2 space-y-2">
                                    {contestSolutions.length === 0 ? (
                                      <p className="text-xs text-surface-400 italic">No solutions available yet</p>
                                    ) : (
                                      contestSolutions.map((sol: any, idx: number) => {
                                        const url = sol.url || sol.solutionUrl
                                        const title = sol.title || sol.problemName || 'Solution'
                                        const thumb = getSolThumb(sol)
                                        const dur = formatSecs(sol.duration)
                                        if (!url) return null
                                        return (
                                          <div key={idx} className="flex items-center gap-3 p-2 bg-surface-50 rounded-lg hover:bg-surface-100 transition-colors dark:bg-night-850 dark:hover:bg-night-600">
                                            <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 flex-1 min-w-0">
                                              {thumb ? (
                                                <div className="relative w-20 h-[46px] shrink-0">
                                                  <img src={thumb} alt="" className="w-20 h-[46px] object-cover rounded" loading="lazy"
                                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                                  <span className="absolute inset-0 flex items-center justify-center">
                                                    <span className="w-5 h-5 rounded-full bg-black/60 flex items-center justify-center">
                                                      <Play size={9} className="text-white ml-[1px]" fill="white" />
                                                    </span>
                                                  </span>
                                                  {dur && (
                                                    <span className="absolute bottom-0.5 right-0.5 px-1 py-[1px] text-[9px] font-bold bg-black/80 text-white rounded">
                                                      {dur}
                                                    </span>
                                                  )}
                                                </div>
                                              ) : (
                                                <span className="w-10 h-10 rounded-lg bg-red-100 dark:bg-red-500/15 flex items-center justify-center shrink-0">
                                                  <Youtube size={18} className="text-red-500" />
                                                </span>
                                              )}
                                              <div className="flex-1 min-w-0">
                                                <p className="text-xs font-medium text-surface-700 dark:text-night-50 line-clamp-1">{title}</p>
                                                {sol.language && <p className="text-[10px] text-surface-400">{sol.language}</p>}
                                              </div>
                                              <ExternalLink size={12} className="text-surface-400 shrink-0" />
                                            </a>
                                            {isTeacher && (
                                              <button
                                                onClick={() => handleRemoveSolution(c.id, idx)}
                                                className="text-surface-400 hover:text-red-500 shrink-0"
                                                title="Remove solution"
                                              >
                                                <Trash2 size={12} />
                                              </button>
                                            )}
                                          </div>
                                        )
                                      })
                                    )}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        )}

                        {/* Participants Section (Teacher only) */}
                        {isTeacher && (
                          <div className="mt-3">
                            <button
                              onClick={() => loadParticipants(c.id)}
                              className="flex items-center gap-1.5 text-xs font-medium text-surface-600 hover:text-surface-800"
                            >
                                View Participants ({participantCounts[c.id] ?? 0})
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 ml-3">
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 rounded-lg text-surface-400 hover:text-primary-500 hover:bg-primary-50 transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink size={16} />
                        </a>
                        {isTeacher && !c.isAutoFetched && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(c.id) }}
                            className="p-2 rounded-lg text-surface-400 hover:text-danger-500 hover:bg-danger-50 transition-colors"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </div>
            <Pagination page={page} totalPages={contestTotalPages} onChange={setPage} />
            </>
          )}

        </div>

        {/* Right Panel - Calendar (40%) */}
        <div className="w-80 shrink-0">
          <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-4 sticky top-24">
            {/* Calendar Header */}
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={prevMonth}
                className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-night-600 transition-colors"
              >
                <ChevronLeft size={18} className="text-surface-600 dark:text-night-200" />
              </button>
              <h3 className="font-semibold text-surface-900">
                {currentMonth.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
              </h3>
              <button
                onClick={nextMonth}
                className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-night-600 transition-colors"
              >
                <ChevronRight size={18} className="text-surface-600 dark:text-night-200" />
              </button>
            </div>

            {/* Day Headers */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
                <div key={day} className="text-center text-xs font-medium text-surface-400 dark:text-night-200 py-1">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar Days */}
            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map((item, idx) => {
                if (item.day === 0) {
                  return <div key={`empty-${idx}`} className="h-8" />
                }

                const isToday = toLocalDateStr(new Date()) === item.dateStr
                const isSelected = selectedDate === item.dateStr

                return (
                  <button
                    key={item.day}
                    onClick={() => handleDateClick(item.day)}
                    className={clsx(
                      'relative h-8 rounded-lg text-sm font-medium transition-all',
                      isSelected
                        ? 'bg-primary-500 text-white'
                        : isToday
                        ? 'bg-primary-50 text-primary-700 dark:bg-[#7BA290]/10 dark:text-[#7BA290]'
                        : item.hasContests
                        ? 'bg-surface-50 text-surface-900 hover:bg-surface-100 dark:bg-night-850 dark:text-night-50 dark:hover:bg-night-600'
                        : 'text-surface-600 hover:bg-surface-50 dark:text-night-200 dark:hover:bg-night-600'
                    )}
                  >
                    {item.day}
                    {item.hasContests && (
                      <span className={clsx(
                        'absolute bottom-0.5 left-1/2 -translate-x-1/2 flex gap-0.5',
                      )}>
                        {item.platforms.map((p) => {
                          const dotColor = p === 'LEETCODE' ? (isSelected ? 'bg-white' : 'bg-yellow-500')
                            : p === 'CODECHEF' ? (isSelected ? 'bg-white' : 'bg-warning-500')
                            : p === 'CODEFORCES' ? (isSelected ? 'bg-white' : 'bg-primary-500')
                            : (isSelected ? 'bg-white' : 'bg-surface-400')
                          return (
                            <span key={p} className={clsx('w-1 h-1 rounded-full', dotColor)} />
                          )
                        })}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Legend */}
            <div className="mt-4 pt-3 border-t border-surface-100 dark:border-night-600">
              <p className="text-xs text-surface-400 dark:text-night-200 mb-2">Platform Colors</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(platformConfig).map(([key, cfg]) => (
                  <div key={key} className="flex items-center gap-1">
                    <span className={clsx('w-2 h-2 rounded-full', cfg.bg.replace('100', '500'))} />
                    <span className="text-xs text-surface-500 dark:text-night-200">{cfg.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Create Modal */}
      <AnimatePresence>
        {createModal.isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={createModal.close}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-night-800 rounded-2xl w-full max-w-md p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-bold text-surface-900 dark:text-night-50 mb-4">Add Contest</h2>

              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Title *</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm dark:border-night-600 dark:bg-night-850 dark:text-night-50"
                    placeholder="Contest name"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Platform</label>
                    <select
                      value={form.platform}
                      onChange={(e) => setForm({ ...form, platform: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm bg-white dark:bg-night-850 dark:border-night-600 dark:text-night-50"
                    >
                      <option value="LEETCODE">LeetCode</option>
                      <option value="CODECHEF">CodeChef</option>
                      <option value="CODEFORCES">Codeforces</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Type</label>
                    <select
                      value={form.contestType}
                      onChange={(e) => setForm({ ...form, contestType: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm bg-white dark:bg-night-850 dark:border-night-600 dark:text-night-50"
                    >
                      <option value="WEEKLY">Weekly</option>
                      <option value="BIWEEKLY">Biweekly</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">URL</label>
                  <input
                    type="url"
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                    className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm dark:border-night-600 dark:bg-night-850 dark:text-night-50"
                    placeholder="https://..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Start Time *</label>
                    <input
                      type="datetime-local"
                      value={form.startTime}
                      onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm dark:border-night-600 dark:bg-night-850 dark:text-night-50"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Duration (min)</label>
                    <input
                      type="number"
                      value={form.duration}
                      onChange={(e) => setForm({ ...form, duration: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm dark:border-night-600 dark:bg-night-850 dark:text-night-50"
                      placeholder="90"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-5">
                <button
                  onClick={createModal.close}
                  className="flex-1 px-4 py-2 bg-surface-100 text-surface-700 rounded-xl font-medium hover:bg-surface-200 dark:bg-night-600 dark:text-night-50 dark:hover:bg-[#232F3B]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-primary-500 to-primary-500 text-white rounded-xl font-medium hover:shadow-lg"
                >
                  Create
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Participants Modal */}
      <AnimatePresence>
        {participantsModal.isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={participantsModal.close}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-night-800 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-surface-100 dark:border-night-600">
                <h2 className="text-xl font-bold text-surface-900 dark:text-night-50">Participants</h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={exportParticipantsToCSV}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-500 to-primary-500 text-white rounded-xl hover:shadow-lg transition-all text-sm font-medium"
                  >
                    <Download size={16} /> Export CSV
                  </button>
                  <button
                    onClick={participantsModal.close}
                    className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-night-600 transition-colors text-surface-500 dark:text-night-200"
                  >
            ✕
                  </button>
                </div>
              </div>

              {/* Modal Body */}
              <div className="overflow-y-auto flex-1 p-6">
                {participants.length === 0 ? (
                  <p className="text-center text-surface-400 py-8">No participants found</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-surface-100 dark:border-night-600">
                          <th className="px-4 py-3 text-left text-xs font-semibold text-surface-500 dark:text-night-200 uppercase tracking-wider">Name</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-surface-500 dark:text-night-200 uppercase tracking-wider">Department</th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-surface-500 dark:text-night-200 uppercase tracking-wider">Rank</th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-surface-500 dark:text-night-200 uppercase tracking-wider">Rating</th>
                        </tr>
                      </thead>
                        <tbody className="divide-y divide-surface-50 dark:divide-night-600">
                        {pagedParticipants.map((p) => (
                          <tr key={p.id} className="hover:bg-surface-50 dark:hover:bg-night-600 transition-colors">
                            <td className="px-4 py-3 font-medium text-surface-900 dark:text-night-50">{p.user?.name || p.name}</td>
                            <td className="px-4 py-3 text-surface-500 dark:text-night-200">{p.user?.department?.name || p.department}</td>
                            <td className="px-4 py-3 text-center font-semibold text-surface-900 dark:text-night-50">{p.rank ? `#${p.rank}` : '—'}</td>
                            <td className="px-4 py-3 text-center font-bold text-primary-600">{p.rating || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <Pagination page={partPage} totalPages={partTotalPages} onChange={setPartPage} scroll={false} />
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
