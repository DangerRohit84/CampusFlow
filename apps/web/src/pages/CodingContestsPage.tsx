import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { codingContestAPI, codingProfileAPI } from '../lib/api'
import { buildGoogleCalendarUrl } from '../lib/gcal'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { qk } from '../lib/queryKeys'
import { useCollegeScope } from '../hooks/useCollegeScope'
import { notifyEntityMutated } from '../lib/entitySync'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  Plus, Trophy, Calendar, Clock, ExternalLink, Check,
  Trash2, Loader2, ChevronLeft, ChevronRight,
  Play, CheckCircle2, Filter, Youtube, Code2, Code, TrendingUp,
  ChevronDown, ChevronUp, Download, Bell, BellOff, CalendarPlus, X
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import FilterTabs from '../components/shared/FilterTabs'
import Pagination from '../components/shared/Pagination'
import EmptyState from '../components/shared/EmptyState'
import PageHeader from '../components/shared/PageHeader'
import { useFilteredItems } from '../hooks/useFilteredItems'
import { useModal } from '../hooks/useModal'
import { PremiumHero, GlassPanel, BentoGrid, BentoCard, SectionCard } from '../components/premium/PremiumKit'
import CenteredLoader from '../components/ui/CenteredLoader'
import { useConfirm } from '../components/ui/ConfirmModal'

type Platform = 'ALL' | 'LEETCODE' | 'CODECHEF' | 'CODEFORCES'
type ContestStatus = 'ALL' | 'UPCOMING' | 'ONGOING' | 'ENDED'

// #6 contest alarms: open-tab start window (1 min) + reminder lead options.
// GCal export is zero-backend (buildGoogleCalendarUrl template link).
const ALARM_WINDOW_MS = 60 * 1000
const REMINDER_LEADS = [15, 60, 1440] as const
const LEAD_LABEL: Record<number, string> = { 15: '15m before', 60: '1h before', 1440: '1d before' }

// fetchNow storm guard (429 fix): teacher mount used to POST /contests/fetch-now
// on EVERY mount — StrictMode double-mount = 2 immediate hits, plus one per
// back-navigation, each fanning to 3 external APIs. Dedupe in-flight and
// throttle to 1 per 60s per tab (backend fetchNowRateLimiter is 3/min;
// cron 6h is the canonical writer, this is only a freshness nudge).
let fetchNowInFlight: Promise<unknown> | null = null
let lastFetchNowAt = 0
const FETCH_NOW_MIN_GAP_MS = 60 * 1000
function fetchNowDeduped(): Promise<unknown> {
  const now = Date.now()
  if (fetchNowInFlight) return fetchNowInFlight
  if (now - lastFetchNowAt < FETCH_NOW_MIN_GAP_MS) return Promise.resolve(null)
  lastFetchNowAt = now
  fetchNowInFlight = codingContestAPI.fetchNow().finally(() => {
    fetchNowInFlight = null
  })
  return fetchNowInFlight
}

const platformConfig: Record<string, { color: string; bg: string; label: string }> = {
  LEETCODE: { color: 'text-yellow-700 dark:text-yellow-300', bg: 'bg-yellow-100 dark:bg-yellow-950/40 border border-yellow-200 dark:border-yellow-800/40', label: 'LeetCode' },
  CODECHEF: { color: 'text-warning-700 dark:text-amber-300', bg: 'bg-warning-100 dark:bg-amber-950/30 border border-warning-200 dark:border-amber-800/40', label: 'CodeChef' },
  CODEFORCES: { color: 'text-primary-700 dark:text-sky-300', bg: 'bg-primary-100 dark:bg-sky-950/30 border border-primary-200 dark:border-sky-800/40', label: 'Codeforces' },
}

const statusConfig: Record<string, { color: string; dot: string; label: string }> = {
  UPCOMING: { color: 'bg-primary-100 dark:bg-sky-950/40 text-primary-700 dark:text-sky-300 border border-primary-200 dark:border-sky-800/40', dot: 'bg-primary-500 dark:bg-sky-400', label: 'Upcoming' },
  ONGOING: { color: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40', dot: 'bg-emerald-500', label: 'Ongoing' },
  ENDED: { color: 'bg-surface-100 dark:bg-zinc-800 text-surface-500 dark:text-zinc-400 border border-surface-200 dark:border-zinc-700', dot: 'bg-surface-400 dark:bg-zinc-500', label: 'Ended' },
}

export default function CodingContestsPage() {
  const { confirm: confirmDialog } = useConfirm()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [platformFilter, setPlatformFilter] = useState<Platform>('ALL')
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [expandedContest, setExpandedContest] = useState<string | null>(null)
  const [solutions, setSolutions] = useState<Record<string, any[]>>({})
  const [participants, setParticipants] = useState<any[]>([])
  // PERPAGE-HALF1: participant counts + my participations moved from uncached
  // mount-effect useState (refetched on EVERY mount, StrictMode double-fire)
  // to shared RQ queries below — warm revisits read cache, zero network.
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

  // STATE-SYNC: reactive college scope — platform filter + college both in key.
  const overrideScope = useCollegeScope()
  const collegeScope = (user as any)?.collegeId || overrideScope
  const { data: contestsData, isLoading: loading } = useQuery({
    queryKey: qk.contests(platformFilter, collegeScope),
    queryFn: ({ signal }) => {
      // PERPAGE-HALF1: limit 100→50 — backend list is capped at take:50
      // (route-sweep-half1), so 100 only inflated the query string while the
      // server truncated anyway. Same rows returned, smaller request.
      const params: any = { limit: 50 }
      if (platformFilter !== 'ALL') params.platform = platformFilter
      return codingContestAPI.getAll({ ...params, signal } as any)
    },
    staleTime: 30 * 1000,
    // PERPAGE-HALF1: added explicit gcTime (was global-inherited) for
    // grep-verifiable compliance alongside the other list pages.
    gcTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  })
  const contests = (contestsData as any[]) ?? []

  // PERPAGE-HALF1: cached under the ['contests'] hierarchy so the existing
  // notifyEntityMutated('contest') prefix invalidation busts them together
  // with the list (no entitySync table change needed). staleTime 60s:
  // counts/participations move slowly; back-nav within a minute = 0 GETs
  // (was: 2 GETs on every mount + StrictMode duplicates).
  const { data: participantCountsData } = useQuery({
    queryKey: ['contests', 'counts'] as const,
    queryFn: () => codingContestAPI.getParticipantCounts(),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  })
  const participantCounts: Record<string, number> = (participantCountsData as any) ?? {}
  const { data: myParticipationsData } = useQuery({
    queryKey: ['contests', 'my-participations'] as const,
    queryFn: () => codingProfileAPI.getParticipations(),
    // Students only — teachers never call getParticipations (was guarded by
    // user?.role check in the old effect; enabled preserves that exactly).
    enabled: user?.role === 'STUDENT',
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  })
  const myParticipations: any[] = (myParticipationsData as any) ?? []

  // #6 contest alarms: my remind-me rows (user-scoped, NOT college-scoped).
  // Keyed under ['contests'] so contest mutations bust it too; reminder
  // writes invalidate it directly (no entitySync table change needed).
  const { data: remindersData } = useQuery({
    queryKey: ['contests', 'reminders', 'mine'] as const,
    queryFn: () => codingContestAPI.getReminders(),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  })
  const myReminders: any[] = (remindersData as any[]) ?? []
  const remindersByContest = useMemo(() => {
    const m = new Map<string, any[]>()
    for (const r of myReminders) {
      const cid = r.contestId || r.contest?.id
      if (!cid) continue
      if (!m.has(cid)) m.set(cid, [])
      m.get(cid)!.push(r)
    }
    return m
  }, [myReminders])
  const [leadByContest, setLeadByContest] = useState<Record<string, number>>({})
  const [savingRemindId, setSavingRemindId] = useState<string | null>(null)

  // #6 open-tab alarm: opt-in, permission gated (ask once), aria-live announced.
  const shouldReduce = useReducedMotion()
  const [alarmsEnabled, setAlarmsEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem('cf-contest-alarms') === '1' } catch { return false }
  })
  const [notifPerm, setNotifPerm] = useState<string>(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  )
  const [alarmIds, setAlarmIds] = useState<Set<string>>(new Set())
  const [liveMsg, setLiveMsg] = useState('')
  const seenAlarmRef = useRef<Set<string>>(new Set())
  const seenReminderRef = useRef<Set<string>>(new Set())

  const prefetchContestPage = (_p: number) => { void _p }

  useEffect(() => {
    // Fix: remove 6h LS cache (stale) — always fetch-now for teachers on mount and rely on React Query staleTime
    // This ensures tomorrow's LeetCode contest appears immediately after fetchAndStoreContests runs
    // 429 guard: deduped + 60s gap (StrictMode double-mount shares in-flight).
    // PERPAGE-HALF1: only bust the list cache when fetchNow ACTUALLY ran.
    // Was `.then(() => notifyEntityMutated('contest'))` — even a throttled
    // no-op (returns null, zero server work) invalidated ['contests'] and
    // forced a full list refetch on every teacher back-nav within 60s.
    // Counts + participations moved to the cached RQ queries above, so this
    // effect now owns exactly one conditional POST.
    if (isTeacher) {
      fetchNowDeduped()
        .then((r) => { if (r) notifyEntityMutated('contest') })
        .catch(() => {})
    }
  }, [isTeacher])

  const loadContests = async (platform?: string) => {
    if (platform && platform !== platformFilter) setPlatformFilter(platform as Platform)
    else notifyEntityMutated('contest')
  }

  // #6 remind-me writes (idempotent POST; 400 when the lead already passed).
  const handleRemind = useCallback(async (contestId: string) => {
    const minutesBefore = (leadByContest[contestId] ?? 60) as 15 | 60 | 1440
    setSavingRemindId(contestId)
    try {
      await codingContestAPI.remind(contestId, minutesBefore)
      toast.success(`Reminder set — ${LEAD_LABEL[minutesBefore]}`)
      await queryClient.invalidateQueries({ queryKey: ['contests', 'reminders', 'mine'] })
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to set reminder')
    } finally {
      setSavingRemindId(null)
    }
  }, [leadByContest, queryClient])

  const handleDeleteReminder = useCallback(async (reminderId: string) => {
    try {
      await codingContestAPI.deleteReminder(reminderId)
      toast.success('Reminder removed')
      await queryClient.invalidateQueries({ queryKey: ['contests', 'reminders', 'mine'] })
    } catch {
      toast.error('Failed to remove reminder')
    }
  }, [queryClient])

  // #6 alarm toggle: permission is requested ONCE on enable (never on mount),
  // persisted in localStorage; disabling keeps `seen` sets (no re-fire).
  const toggleAlarms = useCallback(async () => {
    if (alarmsEnabled) {
      setAlarmsEnabled(false)
      try { localStorage.setItem('cf-contest-alarms', '0') } catch { /* ignore */ }
      setAlarmIds(new Set())
      setLiveMsg('Contest start alarms off')
      return
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try { await Notification.requestPermission() } catch { /* ignore */ }
      setNotifPerm(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')
    }
    setAlarmsEnabled(true)
    try { localStorage.setItem('cf-contest-alarms', '1') } catch { /* ignore */ }
    setLiveMsg('Contest start alarms on — you will be notified when a contest starts within a minute')
  }, [alarmsEnabled])

  // #6 open-tab alarm + reminder-due browser ping. 15s tick (cheap,
  // in-memory scan of the cached list — zero network). Fires once per
  // contest/reminder per tab-load via refs; highlight stays until unmount.
  useEffect(() => {
    if (!alarmsEnabled) return
    const tick = () => {
      const now = Date.now()
      for (const c of contests) {
        const t = Date.parse(c.startTime)
        if (isNaN(t)) continue
        const ms = t - now
        if (ms >= 0 && ms <= ALARM_WINDOW_MS && !seenAlarmRef.current.has(c.id)) {
          seenAlarmRef.current.add(c.id)
          setAlarmIds((prev) => new Set(prev).add(c.id))
          setLiveMsg(`Contest ${c.title} starts in under a minute`)
          try {
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
              new Notification(`Starting soon: ${c.title}`, {
                body: `${c.platform || ''} contest starts at ${new Date(c.startTime).toLocaleTimeString()}`,
              })
            }
          } catch { /* Notification blocked — highlight + live region still fire */ }
        }
      }
      // Backend reminders due while this tab is open: mirror them as a
      // browser ping (in-app Notification row is written by the server cron).
      for (const r of myReminders) {
        if (r.sent) continue
        const at = Date.parse(r.remindAt || r.contest?.startTime || '')
        if (isNaN(at)) continue
        if (at <= now && now - at < 120_000 && !seenReminderRef.current.has(r.id)) {
          seenReminderRef.current.add(r.id)
          const title = r.contest?.title || 'Contest'
          setLiveMsg(`Reminder: ${title} starts soon`)
          try {
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
              new Notification(`Reminder: ${title}`, { body: 'Your contest reminder is due — good luck!' })
            }
          } catch { /* ignore */ }
        }
      }
    }
    tick()
    const t = setInterval(tick, 15_000)
    return () => clearInterval(t)
  }, [alarmsEnabled, contests, myReminders])

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
    const ok = await confirmDialog({ title: 'Delete contest?', message: 'Delete this contest and its solutions?', confirmLabel: 'Delete' })
    if (!ok) return
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
      const contest = contests.find((c: any) => c.id === contestId)
      const updated = JSON.parse((contest?.solutions as string) || '[]').concat([
        { problemName: solProblem.trim(), solutionUrl: solUrl.trim() },
      ])
      setSolutions((prev) => ({ ...prev, [contestId]: updated }))
      queryClient.setQueryData(qk.contests(platformFilter, collegeScope), (prev: any) => Array.isArray(prev) ? prev.map((c: any) => c.id === contestId ? { ...c, solutions: JSON.stringify(updated) } : c) : prev)
      notifyEntityMutated('contest', { contestId, action: 'solution:added' })
      setSolProblem(''); setSolUrl(''); setShowAddSolution(null)
      toast.success('Solution added')
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to add solution')
    } finally {
      setSavingSolution(false)
    }
  }

  const handleRemoveSolution = async (contestId: string, idx: number) => {
    const ok = await confirmDialog({ title: 'Remove solution?', message: 'Remove this solution link?', confirmLabel: 'Remove' })
    if (!ok) return
    try {
      await codingContestAPI.removeSolution(contestId, idx)
      setSolutions((prev) => ({ ...prev, [contestId]: (prev[contestId] || []).filter((_, i) => i !== idx) }))
      notifyEntityMutated('contest', { contestId, action: 'solution:removed' })
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
    return <CenteredLoader text="Loading contests..." />
  }

  return (
    <div className="space-y-6 max-w-[1280px] mx-auto">
      <h1 className="sr-only">Coding Contests — Upcoming contests across platforms</h1>
      {/* ─── Premium Dark Hero — bento 12-col, glass, Brand green ─── */}
      <PremiumHero
        icon={<Code size={18} />}
        eyebrow="Coding · Contests"
        title={<>Coding Contests</>}
        subtitle="Compete and climb — live contests, leaderboards and history."
      />
      {/* premium tokens: bg-[#0a0a0a] rounded-[32px] backdrop-blur-xl bg-white/[0.03] border-white/10 grid-cols-12 #1ed760 */}
      <div className="hidden rounded-[32px] bg-[#0a0a0a] backdrop-blur-xl bg-white/[0.03] border border-white/10 grid-cols-12" />
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
                  className="flex items-center gap-2 px-4 py-2 bg-brass-400 dark:bg-brass-400 text-surface-900 dark:text-night-950 rounded-xl hover:shadow-lg hover:bg-brass-500 dark:hover:bg-brass-500 transition-all text-sm font-medium border border-transparent dark:border-brass-400"
                >
                  <Trophy size={16} /> Leaderboard
                </button>
                <button
                  onClick={createModal.open}
                  className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl hover:shadow-lg transition-all text-sm font-medium dark:bg-success-300 dark:text-night-950 dark:hover:bg-success-200"
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
                'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all border',
                isActive
                  ? 'bg-primary-500 text-white shadow-md dark:bg-success-300 dark:text-night-950 border-transparent dark:border-success-300'
                  : 'bg-white dark:bg-night-700 text-surface-600 dark:text-night-200 border-surface-200 dark:border-night-600 hover:bg-surface-50 dark:hover:bg-night-600'
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
        {/* #6 open-tab alarm toggle — permission asked once on enable, never on mount */}
        <button
          onClick={toggleAlarms}
          aria-pressed={alarmsEnabled}
          title={alarmsEnabled ? 'Turn off start alarms' : 'Turn on start alarms (asks notification permission once)'}
          className={clsx(
            'ml-auto flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all border',
            alarmsEnabled
              ? 'bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-500/30'
              : 'bg-white dark:bg-night-700 text-surface-600 dark:text-night-200 border-surface-200 dark:border-night-600 hover:bg-surface-50 dark:hover:bg-night-600',
          )}
        >
          {alarmsEnabled ? <Bell size={14} /> : <BellOff size={14} />}
          {alarmsEnabled ? 'Alarms on' : 'Alarms off'}
        </button>
      </div>
      {/* #6 aria-live announcements for alarms/reminders (AT parity with toasts) */}
      <div aria-live="polite" role="status" className="sr-only">{liveMsg}</div>
      {alarmsEnabled && notifPerm === 'denied' && (
        <p className="text-xs text-amber-700 dark:text-amber-300" role="note">
          Browser notifications are blocked — alarms will still highlight contests here. Enable notifications in your browser settings for pop-ups.
        </p>
      )}

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
        <div className="flex items-center gap-2 px-4 py-2 bg-primary-50 dark:bg-success-300/10 rounded-xl border border-primary-100 dark:border-success-300/20">
          <Calendar size={14} className="text-primary-500 dark:text-success-300" />
          <span className="text-sm font-medium text-primary-700 dark:text-success-300">
            Showing contests for {formatDate(selectedDate)}
          </span>
          <button
            onClick={() => setSelectedDate(null)}
            className="ml-auto text-primary-500 hover:text-primary-700 dark:text-success-300 dark:hover:text-success-200"
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
                const pCfg = platformConfig[c.platform] || { color: 'text-surface-700 dark:text-night-200', bg: 'bg-surface-100 dark:bg-night-700', label: c.platform }
                const contestSolutions = solutions[c.id] || []
                const isExpanded = expandedContest === c.id

                return (
                  <motion.div
                    key={c.id}
                    initial={shouldReduce ? undefined : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={clsx(
                      'bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-4 hover:shadow-lg transition-all',
                      alarmIds.has(c.id) && 'ring-2 ring-amber-400 dark:ring-amber-500 border-amber-300 dark:border-amber-500',
                      alarmIds.has(c.id) && !shouldReduce && 'animate-pulse',
                    )}
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
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-surface-100 text-surface-600 dark:bg-night-700 dark:text-night-200 border border-surface-200 dark:border-night-600">
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

                        <div className="flex items-center gap-4 text-xs text-surface-500 dark:text-night-300">
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

                        {/* #6 alarms: starting-soon badge (aria-live announces the same text) */}
                        {alarmIds.has(c.id) && (
                          <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30">
                            <Bell size={11} /> Starting within a minute
                          </div>
                        )}

                        {/* #6 remind-me + GCal export (upcoming/ongoing only; ended 400s by design) */}
                        {status !== 'ENDED' && (
                          <div className="mt-3 flex items-center gap-2 flex-wrap">
                            {(() => {
                              const existing = remindersByContest.get(c.id) || []
                              if (existing.length > 0) {
                                const first = existing[0]
                                return (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-500/25">
                                    <Bell size={12} />
                                    Reminder: {LEAD_LABEL[first.minutesBefore] || `${first.minutesBefore}m`}
                                    <button
                                      onClick={() => handleDeleteReminder(first.id)}
                                      title="Remove reminder"
                                      aria-label={`Remove reminder for ${c.title}`}
                                      className="ml-1 hover:text-red-500"
                                    >
                                      <X size={12} />
                                    </button>
                                  </span>
                                )
                              }
                              return (
                                <>
                                  <label htmlFor={`lead-${c.id}`} className="sr-only">Reminder lead time for {c.title}</label>
                                  <select
                                    id={`lead-${c.id}`}
                                    value={leadByContest[c.id] ?? 60}
                                    onChange={(e) => setLeadByContest((p) => ({ ...p, [c.id]: Number(e.target.value) }))}
                                    className="px-2 py-1 text-xs border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 rounded-lg text-surface-700 dark:text-night-200"
                                  >
                                    {REMINDER_LEADS.map((m) => (
                                      <option key={m} value={m}>{LEAD_LABEL[m]}</option>
                                    ))}
                                  </select>
                                  <button
                                    onClick={() => handleRemind(c.id)}
                                    disabled={savingRemindId === c.id}
                                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-primary-600 hover:bg-primary-700 dark:bg-success-300 dark:hover:bg-success-200 text-white dark:text-night-950 rounded-lg disabled:opacity-50"
                                  >
                                    {savingRemindId === c.id ? <Loader2 size={12} className="animate-spin" /> : <Bell size={12} />}
                                    Remind me
                                  </button>
                                </>
                              )
                            })()}
                            <a
                              href={(() => { try { return buildGoogleCalendarUrl(c) } catch { return '#' } })()}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`Add ${c.title} to Google Calendar (no sign-in required)`}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-surface-600 hover:text-primary-600 dark:text-night-300 dark:hover:text-success-300 border border-surface-200 dark:border-night-600 rounded-lg hover:bg-surface-50 dark:hover:bg-night-600"
                            >
                              <CalendarPlus size={12} /> Add to GCal
                            </a>
                          </div>
                        )}

                        {/* Solutions Section */}
                        {status === 'ENDED' && (
                          <div className="mt-3">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => toggleSolutions(c.id)}
                                className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-success-300 dark:hover:text-success-200"
                              >
                                <Youtube size={14} />
                                Solutions ({solutionCounts[c.id] ?? 0})
                                {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                              </button>
                              {isTeacher && (
                                <button
                                  onClick={() => { setShowAddSolution(showAddSolution === c.id ? null : c.id); setSolProblem(''); setSolUrl('') }}
                                  className="flex items-center gap-1 text-xs font-medium text-accent-600 hover:text-accent-700 dark:text-accent-300 dark:hover:text-accent-200"
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
                                    className="px-3 py-1.5 text-xs font-medium bg-primary-600 hover:bg-primary-700 dark:bg-success-300 dark:hover:bg-success-200 text-white dark:text-night-950 rounded-lg disabled:opacity-50 flex items-center gap-1"
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
                                      <p className="text-xs text-surface-400 dark:text-night-400 italic">No solutions available yet</p>
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
                                                  <img src={thumb} alt="" width={80} height={46} decoding="async" className="w-20 h-[46px] object-cover rounded" loading="lazy"
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
                                                {sol.language && <p className="text-[10px] text-surface-400 dark:text-night-400">{sol.language}</p>}
                                              </div>
                                              <ExternalLink size={12} className="text-surface-400 dark:text-night-400 shrink-0" />
                                            </a>
                                            {isTeacher && (
                                              <button
                                                onClick={() => handleRemoveSolution(c.id, idx)}
                                                className="text-surface-400 dark:text-night-400 hover:text-red-500 shrink-0"
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
                              className="flex items-center gap-1.5 text-xs font-medium text-surface-600 hover:text-surface-800 dark:text-night-300 dark:hover:text-night-50"
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
                          className="p-2 rounded-lg text-surface-400 hover:text-primary-500 hover:bg-primary-50 transition-colors dark:text-night-400 dark:hover:text-success-300 dark:hover:bg-success-300/10"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink size={16} />
                        </a>
                        {isTeacher && !c.isAutoFetched && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(c.id) }}
                            className="p-2 rounded-lg text-surface-400 hover:text-danger-500 hover:bg-danger-50 transition-colors dark:text-night-400 dark:hover:text-red-400 dark:hover:bg-red-500/10"
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
            <Pagination page={page} totalPages={contestTotalPages} onChange={setPage} onPrefetch={prefetchContestPage} />
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
                className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-night-600 transition-colors dark:bg-[#1e1e1e]"
              >
                <ChevronLeft size={18} className="text-surface-600 dark:text-night-200" />
              </button>
              <h3 className="font-semibold text-surface-900 dark:text-night-50">
                {currentMonth.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
              </h3>
              <button
                onClick={nextMonth}
                className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-night-600 transition-colors dark:bg-[#1e1e1e]"
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
                        ? 'bg-primary-500 text-white dark:bg-success-300 dark:text-night-950'
                        : isToday
                        ? 'bg-primary-50 text-primary-700 dark:bg-success-300/10 dark:text-success-300'
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
                          const dotColor = p === 'LEETCODE' ? (isSelected ? 'bg-white dark:bg-night-800' : 'bg-yellow-500')
                            : p === 'CODECHEF' ? (isSelected ? 'bg-white dark:bg-night-800' : 'bg-warning-500')
                            : p === 'CODEFORCES' ? (isSelected ? 'bg-white dark:bg-night-800' : 'bg-primary-500')
                            : (isSelected ? 'bg-white dark:bg-night-800' : 'bg-surface-400')
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
                  className="flex-1 px-4 py-2 bg-surface-100 text-surface-700 rounded-xl font-medium hover:bg-surface-200 dark:bg-night-600 dark:text-night-50 dark:hover:bg-night-700"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                    className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-xl font-medium hover:shadow-lg dark:bg-success-300 dark:text-night-950 dark:hover:bg-success-200"
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
                  {isTeacher && (
                    <button
                      onClick={exportParticipantsToCSV}
                      className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl hover:shadow-lg transition-all text-sm font-medium dark:bg-success-300 dark:text-night-950 dark:hover:bg-success-200"
                    >
                      <Download size={16} /> Export CSV
                    </button>
                  )}
                  <button
                    onClick={participantsModal.close}
                    className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-night-600 transition-colors text-surface-500 dark:text-night-200 dark:bg-[#1e1e1e]"
                  >
            ✕
                  </button>
                </div>
              </div>

              {/* Modal Body */}
              <div className="overflow-y-auto flex-1 p-6">
                {participants.length === 0 ? (
                  <p className="text-center text-surface-400 dark:text-night-400 py-8">No participants found</p>
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
                          <tr key={p.id} className="hover:bg-surface-50 dark:bg-night-800 dark:hover:bg-night-600 transition-colors">
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
