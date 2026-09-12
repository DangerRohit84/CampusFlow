import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { hackathonAPI } from '../lib/api'
import { useDepartments } from '../hooks/useDepartments'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useDebounce } from '../hooks/useDebounce'
import { qk } from '../lib/queryKeys'
import { useCollegeScope } from '../hooks/useCollegeScope'
import { notifyEntityMutated } from '../lib/entitySync'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Calendar, Users, Download,
  Loader2, Sparkles, MapPin,
  Clock, Zap, CheckCircle2, Trophy, Filter, Search,
  Code, ChevronRight
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import Badge from '../components/ui/Badge'
import Card from '../components/ui/Card'
import FilterTabs from '../components/shared/FilterTabs'
import Pagination from '../components/shared/Pagination'
import EmptyState from '../components/shared/EmptyState'
import { useFilteredItems } from '../hooks/useFilteredItems'
import { useModal } from '../hooks/useModal'
import type { Department } from '../types/api'
import CenteredLoader from '../components/ui/CenteredLoader'

type HackathonStatus = 'upcoming' | 'ongoing' | 'completed'

export default function HackathonsPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [fetching, setFetching] = useState(false)

  const [form, setForm] = useState({
    title: '',
    description: '',
    url: '',
    organizer: '',
    registrationUrl: '',
    startDate: '',
    endDate: '',
    deadline: '',
    teamSize: '',
    themes: '',
    location: '',
    mode: 'OFFLINE',
    eligibility: '',
    prizePool: '',
    duration: '',
    schedule: '',
    bootcamps: '',
    highlights: '',
  })
  const [aiRounds, setAiRounds] = useState<Array<{roundNumber: number; title: string; description: string; date: string; resultDate: string}>>([])
  const [targetDepartments, setTargetDepartments] = useState<string[]>([])
  const [targetYears, setTargetYears] = useState<number[]>([])
  const [eligibilityEnabled, setEligibilityEnabled] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 300)
  const createModal = useModal()

  const isTeacher = user?.role === 'TEACHER' || user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'

  // PERPAGE-HALF1: shared cached departments (was an uncached mount GET on
  // every visit, duplicated across 7 pages — see useDepartments). Only
  // teachers need it (create modal eligibility picker), so students skip
  // the fetch entirely. MUST sit after isTeacher (TDZ).
  const { data: departmentsData } = useDepartments({ enabled: isTeacher })
  const departments = (departmentsData ?? []) as Department[]

  // React Query with keepPreviousData + SWR (Vercel/GitHub pattern) + AbortController + server-side debounced search (O(log n) indexed scan)
  // STATE-SYNC: reactive college scope (useCollegeScope subscribes to the
  // super-admin store) so college switching changes the key → fresh fetch,
  // never another college's cached list (prefix invalidation still hits all).
  const overrideScope = useCollegeScope()
  const collegeScope = (user as any)?.collegeId || overrideScope
  const { data: hackathonsData, isLoading: loading } = useQuery({
    queryKey: qk.hackathons(debouncedSearch, collegeScope),
    queryFn: ({ signal }) => hackathonAPI.getAll({ search: debouncedSearch || undefined, signal } as any),
    staleTime: 3 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  })
  const hackathons = (hackathonsData as any[]) ?? []

  // ?mine=true — own registrations only, powers the "Registered" tab (#5 leftovers).
  // Separate RQ entry (qk … 'mine') so status-tab counts stay sourced from the
  // full list; placeholderData keeps the previous slice during tab switches.
  const { data: mineHackathonsData } = useQuery({
    queryKey: qk.hackathons(debouncedSearch, collegeScope, true),
    queryFn: ({ signal }) => hackathonAPI.getAll({ search: debouncedSearch || undefined, mine: true, signal } as any),
    staleTime: 3 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  })
  const mineHackathons = (mineHackathonsData as any[]) ?? []

  // Prefetch next client-page slice on hover — hides pagination latency (Shopify instant-nav)
  const prefetchPage = (nextPage: number) => {
    // No server fetch needed — data already cached client-side; warming does nothing but keeps API for future cursor pagination
    // When moving to true server pagination, uncomment:
    // queryClient.prefetchQuery({ queryKey: ['hackathons', debouncedSearch, 'p', nextPage], queryFn: ({signal})=>hackathonAPI.getPaged(nextPage, HACKATHONS_PER_PAGE, debouncedSearch||undefined, signal) , staleTime: 3*60*1000 })
    void nextPage
  }

  // Departments now come from the shared useDepartments() hook above —
  // the old uncached mount useEffect was removed (PERPAGE-HALF1).

  const loadHackathons = async () => {
    notifyEntityMutated('hackathon')
  }

  const getHackathonStatus = (h: any): HackathonStatus => {
    const now = new Date()
    const startDate = h.startDate ? new Date(h.startDate) : null
    const endDate = h.endDate ? new Date(h.endDate) : null
    const deadline = h.deadline ? new Date(h.deadline) : null

    if (h.status === 'ENDED') return 'completed'

    // Has event dates → use them
    if (startDate && endDate) {
      if (now < startDate) return 'upcoming'
      if (now > endDate) return 'completed'
      return 'ongoing'
    }

    // Has only startDate → use it for start, no auto-complete
    if (startDate) {
      if (now < startDate) return 'upcoming'
      return 'ongoing'
    }

    // No event dates → fallback to registration deadline
    if (deadline) {
      if (now < deadline) return 'upcoming'
      return 'ongoing'
    }

    return 'upcoming'
  }

  const getStatusBadgeVariant = (status: HackathonStatus): 'primary' | 'warning' | 'default' => {
    switch (status) {
      case 'upcoming': return 'primary'
      case 'ongoing': return 'warning'
      case 'completed': return 'default'
    }
  }

  const getStatusLabel = (status: HackathonStatus): string => {
    switch (status) {
      case 'upcoming': return 'Upcoming'
      case 'ongoing': return 'Active'
      case 'completed': return 'Completed'
    }
  }

  const getModeLabel = (mode: string): string => {
    switch (mode?.toUpperCase()) {
      case 'ONLINE': return 'Online'
      case 'HYBRID': return 'Hybrid'
      case 'OFFLINE': return 'In-Person'
      default: return mode || 'TBD'
    }
  }

  const { activeTab, setActiveTab, filteredItems: filteredHackathons } = useFilteredItems<any>({
    items: hackathons,
    tabs: [
      { key: 'all', label: 'All' },
      { key: 'upcoming', label: 'Upcoming' },
      { key: 'ongoing', label: 'Ongoing' },
      { key: 'completed', label: 'Completed' },
      { key: 'registered', label: 'Registered' },
    ],
    // 'registered' is server-filtered (?mine=true) — client keeps every mine row;
    // status tabs filter the full list as before.
    filterFn: (h, tab) => tab === 'all' || tab === 'registered' || getHackathonStatus(h) === tab,
    defaultTab: 'upcoming',
  })
  const isMineTab = activeTab === 'registered'

  const tabCounts = useMemo(() => ({
    all: hackathons.length,
    upcoming: hackathons.filter((h) => getHackathonStatus(h) === 'upcoming').length,
    ongoing: hackathons.filter((h) => getHackathonStatus(h) === 'ongoing').length,
    completed: hackathons.filter((h) => getHackathonStatus(h) === 'completed').length,
    registered: mineHackathons.length,
  }), [hackathons, mineHackathons])

  const searchedHackathons = useMemo(() => {
    // Registered tab reads the mine query (own registrations only); every other
    // tab reads the status-filtered full list. Client search + deadline sort
    // apply identically to both sources.
    const source = isMineTab ? mineHackathons : filteredHackathons
    const items = !searchQuery.trim() ? source : source.filter(h =>
      h.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      h.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      h.organizer?.toLowerCase().includes(searchQuery.toLowerCase())
    )
    return [...items].sort((a, b) => {
      const statusA = getHackathonStatus(a)
      const statusB = getHackathonStatus(b)
      // Upcoming: sort by registration deadline (nearest first)
      if (statusA === 'upcoming' && statusB === 'upcoming') {
        if (!a.deadline && !b.deadline) return 0
        if (!a.deadline) return 1
        if (!b.deadline) return -1
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime()
      }
      // Ongoing: sort by round/event deadline (nearest first)
      if (statusA === 'ongoing' && statusB === 'ongoing') {
        const endA = a.endDate ? new Date(a.endDate).getTime() : a.deadline ? new Date(a.deadline).getTime() : Infinity
        const endB = b.endDate ? new Date(b.endDate).getTime() : b.deadline ? new Date(b.deadline).getTime() : Infinity
        return endA - endB
      }
      // Keep original order for mixed statuses
      return 0
    })
  }, [filteredHackathons, mineHackathons, isMineTab, searchQuery])

  const isNearDeadline = (dateStr: string) => {
    if (!dateStr) return false
    const diff = new Date(dateStr).getTime() - Date.now()
    return diff > 0 && diff <= 3 * 24 * 60 * 60 * 1000
  }

  const handleFetchDetails = async () => {
    if (!form.url) {
      toast.error('Enter a URL first')
      return
    }
    setFetching(true)
    try {
      const details = await hackathonAPI.fetchDetails(form.url)
      if (details.title) setForm((f) => ({ ...f, title: details.title }))
      if (details.description) setForm((f) => ({ ...f, description: details.description }))
      if (details.organizer) setForm((f) => ({ ...f, organizer: details.organizer }))
      if (details.registrationUrl) setForm((f) => ({ ...f, registrationUrl: details.registrationUrl }))
      if (details.startDate) setForm((f) => ({ ...f, startDate: parseDate(details.startDate) }))
      if (details.endDate) setForm((f) => ({ ...f, endDate: parseDate(details.endDate) }))
      if (details.deadline) setForm((f) => ({ ...f, deadline: parseDate(details.deadline) }))
      if (details.teamSize) setForm((f) => ({ ...f, teamSize: details.teamSize.toString() }))
      if (details.themes) setForm((f) => ({ ...f, themes: details.themes.join(', ') }))
      if (details.location) setForm((f) => ({ ...f, location: details.location }))
      if (details.mode) setForm((f) => ({ ...f, mode: details.mode }))
      if (details.eligibility) {
        const elig = typeof details.eligibility === 'string' ? details.eligibility : JSON.stringify(details.eligibility)
        setForm((f) => ({ ...f, eligibility: elig }))
      }
      if (details.prizePool) setForm((f) => ({ ...f, prizePool: details.prizePool }))
      if (details.duration) setForm((f) => ({ ...f, duration: details.duration }))
      if (details.schedule) setForm((f) => ({ ...f, schedule: details.schedule }))
      if (details.bootcamps && Array.isArray(details.bootcamps)) {
        setForm((f) => ({ ...f, bootcamps: details.bootcamps.join('\n') }))
      }
      if (details.highlights && Array.isArray(details.highlights)) {
        setForm((f) => ({ ...f, highlights: details.highlights.join('\n') }))
      }
      if (details.rounds && Array.isArray(details.rounds)) {
        setAiRounds(details.rounds.map((r: any) => ({
          roundNumber: r.roundNumber,
          title: r.title || '',
          description: r.description || '',
          date: r.date ? parseDate(r.date) : '',
          resultDate: r.resultDate ? parseDate(r.resultDate) : '',
        })))
      }
      toast.success('Details fetched! Review and edit as needed.')
    } catch (err) {
      toast.error('Failed to fetch details')
    } finally {
      setFetching(false)
    }
  }

  const parseDate = (dateStr: string): string => {
    if (!dateStr) return ''
    // Already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr
    // dd-mm-yyyy or dd/mm/yyyy
    const match = dateStr.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/)
    if (match) {
      return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
    }
    return ''
  }

  // ===== Pagination =====
  const [page, setPage] = useState(1)
  const HACKATHONS_PER_PAGE = 10
  const hackTotalPages = Math.max(1, Math.ceil(searchedHackathons.length / HACKATHONS_PER_PAGE))
  const pagedHackathons = searchedHackathons.slice((page - 1) * HACKATHONS_PER_PAGE, page * HACKATHONS_PER_PAGE)
  useEffect(() => { setPage(1) }, [activeTab, searchQuery])

  const handleCreate = async () => {
    if (!form.title) {
      toast.error('Title is required')
      return
    }
    try {
      await hackathonAPI.create({
        ...form,
        themes: form.themes ? form.themes.split(',').map((t) => t.trim()) : [],
        rounds: aiRounds.length > 0 ? aiRounds : undefined,
        targetDepartments: eligibilityEnabled ? targetDepartments : [],
        targetYears: eligibilityEnabled ? targetYears : [],
        eligibilityEnabled: eligibilityEnabled && (targetDepartments.length > 0 || targetYears.length > 0),
      })
      toast.success('Hackathon created!')
      createModal.close()
      setForm({ title: '', description: '', url: '', organizer: '', registrationUrl: '', startDate: '', endDate: '', deadline: '', teamSize: '', themes: '', location: '', mode: 'OFFLINE', eligibility: '', prizePool: '', duration: '', schedule: '', bootcamps: '', highlights: '' })
      setAiRounds([])
      setTargetDepartments([])
      setTargetYears([])
      setEligibilityEnabled(false)
      notifyEntityMutated('hackathon', { action: 'created' })
    } catch (err) {
      toast.error('Failed to create hackathon')
    }
  }

  if (loading) {
    return <CenteredLoader text="Loading hackathons..." />
  }

  return (
    <div className="space-y-6 section--hackathons max-w-[1280px] mx-auto">
      {/* Notice Board Head — hackathons */}
      <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] shadow-sm overflow-hidden !border-brass-500/15 dark:!border-brass-500/20">
        <div className="h-[3px] bg-brass-500" />
        <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brass-500 flex items-center justify-center border border-brass-500/20"><Trophy size={18} className="text-slate-900 dark:text-white" /></div>
            <div>
              <h1 className="font-display text-xl font-extrabold text-slate-800 dark:text-night-50 leading-none">Notice Board — Hackathons</h1>
              <p className="text-xs text-surface-500 dark:text-night-400">Discover and join hackathons</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative hidden sm:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 dark:text-night-400 pointer-events-none" size={14} aria-hidden="true" />
              <label htmlFor="hackathon-search" className="sr-only">Search hackathons</label>
              <input
                id="hackathon-search"
                type="search"
                aria-label="Search hackathons"
                placeholder="Search notices…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-[200px] pl-9 pr-3 min-h-[44px] border border-surface-200 dark:border-night-600 rounded-xl text-sm bg-surface-50 dark:bg-night-800 placeholder:text-[#6b7280] dark:placeholder:text-night-400 focus:outline-none focus-visible:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-500/15 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:text-zinc-500"
              />
            </div>
            {isTeacher && (
              <button
                onClick={() => hackathonAPI.exportAll()}
                className="inline-flex items-center gap-2 min-h-[44px] px-4 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-700 dark:text-night-200 rounded-xl hover:bg-surface-50 dark:hover:bg-night-700 text-sm font-semibold"
              >
                <Download size={16} /> Export
              </button>
            )}
            {isTeacher && (
              <button
                onClick={createModal.open}
                className="inline-flex items-center gap-2 min-h-[44px] px-4 bg-primary-600 text-white rounded-xl hover:bg-primary-700 text-sm font-semibold"
              >
                <Plus size={16} /> Pin Notice
              </button>
            )}
          </div>
        </div>
        {/* mobile search */}
        <div className="px-5 pb-4 sm:hidden">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 dark:text-night-400 pointer-events-none" size={16} aria-hidden="true" />
            <label htmlFor="hackathon-search-mobile" className="sr-only">Search hackathons</label>
            <input
              id="hackathon-search-mobile"
              type="search"
              aria-label="Search hackathons"
              placeholder="Search hackathons..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 min-h-[44px] border border-surface-200 dark:border-night-600 rounded-xl text-sm bg-surface-50 dark:bg-night-800 placeholder:text-[#6b7280] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
            />
          </div>
        </div>
      </div>

      {/* Filter Tabs — brass for hackathons */}
      <FilterTabs
        accent="brass"
        tabs={[
          { key: 'all', label: 'All', icon: Filter, count: tabCounts.all },
          { key: 'upcoming', label: 'Upcoming', icon: Clock, count: tabCounts.upcoming },
          { key: 'ongoing', label: 'Ongoing', icon: Zap, count: tabCounts.ongoing },
          { key: 'completed', label: 'Completed', icon: CheckCircle2, count: tabCounts.completed },
          { key: 'registered', label: 'Registered', icon: Users, count: tabCounts.registered },
        ]}
        activeTab={activeTab}
        onTabChange={(key) => setActiveTab(key as any)}
      />

      {/* Hackathon Grid */}
      {searchedHackathons.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title={isMineTab ? 'No registered hackathons' : 'No hackathons found'}
          description={
            isMineTab
              ? 'You have not registered for any hackathon yet — open one and hit Register.'
              : isTeacher
                ? 'Create your first hackathon to get started'
                : 'No hackathons available yet'
          }
          action={
            isTeacher && !isMineTab ? (
              <button
                onClick={createModal.open}
                className="btn-primary"
              >
                <Plus size={16} /> Create Hackathon
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {pagedHackathons.map((h) => {
            const status = getHackathonStatus(h)
            const isUrgent = status==='upcoming' && isNearDeadline(h.deadline)
            const cardLabel = `View hackathon ${h.title}${h.organizer ? ` by ${h.organizer}` : ''} — ${getStatusLabel(status)}`
            return (
              <article
                key={h.id}
                role="link"
                tabIndex={0}
                aria-label={cardLabel}
                className={clsx('due-slip p-5 flex flex-col group cursor-pointer hover:shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2', isUrgent ? 'due-slip--urgent' : 'due-slip--brass')}
                onClick={() => navigate(`/hackathons/${h.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    navigate(`/hackathons/${h.id}`)
                  }
                }}
              >
                  <div className="flex items-center justify-between">
                    <span className={clsx('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border', status==='upcoming'?'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800/40': status==='ongoing'?'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/40':'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700')}>
                      <span className={clsx('w-1.5 h-1.5 rounded-full', status==='upcoming'?'bg-amber-500': status==='ongoing'?'bg-emerald-500':'bg-zinc-400')} /> {getStatusLabel(status)}
                    </span>
                    {h.mode && <span className="text-[11px] font-semibold tracking-wide uppercase text-surface-400 dark:text-night-400 border border-surface-200 dark:border-night-600 rounded-full px-2 py-1">{getModeLabel(h.mode)}</span>}
                  </div>
                  <h3 className="mt-3 font-display font-bold text-surface-900 dark:text-night-50 line-clamp-2 leading-tight group-hover:text-zinc-700 dark:group-hover:text-zinc-200">
                    {h.title}
                  </h3>
                  {h.description && <p className="text-sm text-surface-500 dark:text-night-400 line-clamp-2 mt-1.5 flex-1">{h.description}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    {(h.startDate || h.deadline) && (
                      <span className={clsx('inline-flex items-center gap-1 px-2 py-1 rounded-full border text-xs font-medium', isUrgent ? 'bg-danger-50 dark:bg-danger-950/30 text-danger-700 dark:text-danger-300 border-danger-100 dark:border-danger-900/40' : 'bg-surface-50 dark:bg-night-800 text-surface-600 dark:text-night-300 border-surface-200 dark:border-night-600')}>
                        <Calendar size={12} /> {h.startDate ? new Date(h.startDate).toLocaleDateString('en-IN', { day:'numeric', month:'short' }) : new Date(h.deadline).toLocaleDateString('en-IN', { day:'numeric', month:'short' })} {isUrgent && '· Due soon'}
                      </span>
                    )}
                    {h.location && <span className="inline-flex items-center gap-1 text-surface-500 dark:text-night-400"><MapPin size={12}/> {h.location}</span>}
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-surface-100 dark:border-night-600 pt-3">
                    <span className="text-xs text-surface-500 dark:text-night-400 inline-flex items-center gap-3"><span className="inline-flex items-center gap-1"><Users size={12} aria-hidden="true" /> {h.registrations?.length||0}</span> <span className="inline-flex items-center gap-1"><Code size={12} aria-hidden="true" /> {h.rounds?.length||0} rounds</span></span>
                    <span className="w-8 h-8 rounded-full bg-amber-500 text-zinc-900 inline-flex items-center justify-center dark:text-white" aria-hidden="true"><ChevronRight size={14} /></span>
                  </div>
              </article>
            )
          })}
        </div>
        <Pagination page={page} totalPages={hackTotalPages} onChange={setPage} onPrefetch={prefetchPage} />
        </>
      )}

      {/* Create Modal — campus rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] shadow-sm */}
      <AnimatePresence>
        {createModal.isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={createModal.close}
          >
            <motion.div
              initial={{ scale: 0.98, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.98, opacity: 0, y: 8 }}
              className="bg-white dark:bg-night-800 rounded-[14px] border border-surface-200 dark:border-night-600 w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 shadow-e3"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-bold text-surface-900 dark:text-night-50 mb-4">Create Hackathon</h2>

              {/* URL Fetch */}
              <div className="mb-4 p-3 bg-primary-50 dark:bg-sky-950/30 rounded-xl border border-primary-100 dark:border-sky-800/40">
                <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Quick Fill from URL</label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                    placeholder="Paste hackathon link..."
                    className="flex-1 px-3 py-2 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-lg text-sm"
                  />
                  <button
                    onClick={handleFetchDetails}
                    disabled={fetching}
                    className="px-3 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 flex items-center gap-1"
                  >
                    {fetching ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    AI Fetch
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Title *</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 rounded-xl text-sm"
                    placeholder="Hackathon name"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Description</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 rounded-xl text-sm h-20"
                    placeholder="About the hackathon"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Organizer</label>
                    <input
                      type="text"
                      value={form.organizer}
                      onChange={(e) => setForm({ ...form, organizer: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 rounded-xl text-sm"
                      placeholder="Who organizes"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Team Size</label>
                    <input
                      type="number"
                      value={form.teamSize}
                      onChange={(e) => setForm({ ...form, teamSize: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 rounded-xl text-sm"
                      placeholder="Max team size"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Registration URL</label>
                  <input
                    type="url"
                    value={form.registrationUrl}
                    onChange={(e) => setForm({ ...form, registrationUrl: e.target.value })}
                    className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 rounded-xl text-sm"
                    placeholder="Registration link"
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Start Date</label>
                    <input
                      type="date"
                      value={form.startDate}
                      onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 rounded-xl text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">End Date</label>
                    <input
                      type="date"
                      value={form.endDate}
                      onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 rounded-xl text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Deadline</label>
                    <input
                      type="date"
                      value={form.deadline}
                      onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 rounded-xl text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Themes (comma separated)</label>
                  <input
                    type="text"
                    value={form.themes}
                    onChange={(e) => setForm({ ...form, themes: e.target.value })}
                    className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 rounded-xl text-sm"
                    placeholder="AI, HealthTech, FinTech"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Location</label>
                    <input
                      type="text"
                      value={form.location}
                      onChange={(e) => setForm({ ...form, location: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 rounded-xl text-sm"
                      placeholder="Venue or city"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Mode</label>
                    <select
                      value={form.mode}
                      onChange={(e) => setForm({ ...form, mode: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 rounded-xl text-sm"
                    >
                      <option value="OFFLINE">Offline</option>
                      <option value="ONLINE">Online</option>
                      <option value="HYBRID">Hybrid</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Prize Pool</label>
                    <input
                      type="text"
                      value={form.prizePool}
                      onChange={(e) => setForm({ ...form, prizePool: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 rounded-xl text-sm"
                      placeholder="e.g., ₹2,50,000"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Duration</label>
                    <input
                      type="text"
                      value={form.duration}
                      onChange={(e) => setForm({ ...form, duration: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 rounded-xl text-sm"
                      placeholder="e.g., 30 hours"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Eligibility</label>
                  <textarea
                    value={form.eligibility}
                    onChange={(e) => setForm({ ...form, eligibility: e.target.value })}
                    className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 rounded-xl text-sm h-16"
                    placeholder="Departments, years, etc."
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Event Schedule</label>
                  <textarea
                    value={form.schedule}
                    onChange={(e) => setForm({ ...form, schedule: e.target.value })}
                    className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 rounded-xl text-sm h-16"
                    placeholder="Day 1: ... Day 2: ..."
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Bootcamps (optional)</label>
                  <textarea
                    value={form.bootcamps}
                    onChange={(e) => setForm({ ...form, bootcamps: e.target.value })}
                    className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 rounded-xl text-sm h-16"
                    placeholder="DSA Bootcamp, Agentic AI Bootcamp, etc."
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Highlights</label>
                  <textarea
                    value={form.highlights}
                    onChange={(e) => setForm({ ...form, highlights: e.target.value })}
                    className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 rounded-xl text-sm h-16"
                    placeholder="Key gains, placement info, etc."
                  />
                </div>

                {aiRounds.length > 0 && (
                  <div className="mt-4">
                    <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-2 block">
                      AI-Fetched Rounds ({aiRounds.length})
                    </label>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {aiRounds.map((r, i) => (
                        <div key={i} className="p-3 bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-xl text-sm">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-primary-100 dark:bg-sky-950/40 text-primary-700 dark:text-sky-300 flex items-center justify-center text-xs font-bold shrink-0 border border-primary-200 dark:border-sky-800/40">
                              {r.roundNumber}
                            </span>
                            <span className="font-medium text-surface-900 dark:text-night-50">{r.title}</span>
                          </div>
                          {r.description && <p className="text-surface-500 dark:text-night-400 text-xs mt-1 ml-8">{r.description}</p>}
                          <div className="flex gap-3 mt-1 ml-8 text-xs text-surface-400 dark:text-night-400">
                            {r.date && <span>Date: {r.date}</span>}
                            {r.resultDate && <span>Results: {r.resultDate}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Eligibility Section - Inline */}
              <div className="mt-5 p-4 rounded-xl bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-600">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={eligibilityEnabled}
                    onChange={(e) => {
                      setEligibilityEnabled(e.target.checked)
                      if (!e.target.checked) {
                        setTargetDepartments([])
                        setTargetYears([])
                      }
                    }}
                    className="w-4 h-4 rounded text-primary-500 focus:ring-primary-500"
                  />
                  <span className="text-sm font-medium text-surface-700 dark:text-night-200">Restrict eligibility (departments/years)</span>
                </label>
                {eligibilityEnabled && (
                  <div className="mt-4 space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-surface-600 dark:text-night-300 mb-2">Departments</label>
                      <div className="flex flex-wrap gap-2">
                        {departments.map((dept) => (
                          <button
                            key={dept.id}
                            type="button"
                            onClick={() => {
                              setTargetDepartments((prev) =>
                                prev.includes(dept.name) ? prev.filter((d) => d !== dept.name) : [...prev, dept.name]
                              )
                            }}
                            className={clsx(
                              'px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                              targetDepartments.includes(dept.name)
                                ? 'bg-primary-500 text-white border-primary-500'
                                : 'bg-white dark:bg-night-800 text-surface-600 dark:text-night-300 border-surface-200 dark:border-night-600 hover:border-primary-300'
                            )}
                          >
                            {dept.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-surface-600 dark:text-night-300 mb-2">Years</label>
                      <div className="flex flex-wrap gap-2">
                        {[1, 2, 3, 4].map((year) => (
                          <button
                            key={year}
                            type="button"
                            onClick={() => {
                              setTargetYears((prev) =>
                                prev.includes(year) ? prev.filter((y) => y !== year) : [...prev, year]
                              )
                            }}
                            className={clsx(
                              'px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                              targetYears.includes(year)
                                ? 'bg-primary-500 text-white border-primary-500'
                                : 'bg-white dark:bg-night-800 text-surface-600 dark:text-night-300 border-surface-200 dark:border-night-600 hover:border-primary-300'
                            )}
                          >
                            Year {year}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-3 mt-5">
                <button onClick={createModal.close} className="flex-1 px-4 py-2 bg-surface-100 dark:bg-night-700 text-surface-700 dark:text-night-200 rounded-xl font-medium hover:bg-surface-200">
                  Cancel
                </button>
                <button onClick={handleCreate} className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-xl font-medium hover:shadow-lg">
                  Create
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
