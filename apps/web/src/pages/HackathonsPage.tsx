import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { hackathonAPI, departmentAPI } from '../lib/api'
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

type HackathonStatus = 'upcoming' | 'ongoing' | 'completed'

export default function HackathonsPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [hackathons, setHackathons] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
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
  const [departments, setDepartments] = useState<Department[]>([])
  const [targetDepartments, setTargetDepartments] = useState<string[]>([])
  const [targetYears, setTargetYears] = useState<number[]>([])
  const [eligibilityEnabled, setEligibilityEnabled] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const createModal = useModal()

  const isTeacher = user?.role === 'TEACHER' || user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'

  useEffect(() => {
    loadHackathons()
    departmentAPI.getAll().then(setDepartments).catch(() => {})
  }, [])

  const loadHackathons = async () => {
    try {
      const data = await hackathonAPI.getAll()
      setHackathons(data)
    } catch (err) {
      console.error('Failed to load hackathons', err)
    } finally {
      setLoading(false)
    }
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
    ],
    filterFn: (h, tab) => tab === 'all' || getHackathonStatus(h) === tab,
    defaultTab: 'upcoming',
  })

  const tabCounts = useMemo(() => ({
    all: hackathons.length,
    upcoming: hackathons.filter((h) => getHackathonStatus(h) === 'upcoming').length,
    ongoing: hackathons.filter((h) => getHackathonStatus(h) === 'ongoing').length,
    completed: hackathons.filter((h) => getHackathonStatus(h) === 'completed').length,
  }), [hackathons])

  const searchedHackathons = useMemo(() => {
    const items = !searchQuery.trim() ? filteredHackathons : filteredHackathons.filter(h =>
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
  }, [filteredHackathons, searchQuery])

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
      loadHackathons()
    } catch (err) {
      toast.error('Failed to create hackathon')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-900">Hackathons</h1>
          <p className="text-surface-500 mt-1">Discover and manage hackathons across your campus.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => hackathonAPI.exportAll()}
            className="flex items-center gap-2 px-4 py-2 border border-surface-200 text-surface-700 rounded-xl hover:bg-surface-50 transition-all text-sm font-medium"
          >
            <Download size={16} /> Export
          </button>
          {isTeacher && (
            <button
              onClick={createModal.open}
              className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-xl hover:bg-primary-600 transition-all text-sm font-medium"
            >
              <Plus size={16} /> Create Hackathon
            </button>
          )}
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" size={16} />
        <input
          type="text"
          placeholder="Search hackathons..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-surface-200 rounded-xl text-sm text-surface-900 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-colors"
        />
      </div>

      {/* Filter Tabs */}
      <FilterTabs
        tabs={[
          { key: 'all', label: 'All', icon: Filter, count: tabCounts.all },
          { key: 'upcoming', label: 'Upcoming', icon: Clock, count: tabCounts.upcoming },
          { key: 'ongoing', label: 'Ongoing', icon: Zap, count: tabCounts.ongoing },
          { key: 'completed', label: 'Completed', icon: CheckCircle2, count: tabCounts.completed },
        ]}
        activeTab={activeTab}
        onTabChange={(key) => setActiveTab(key as any)}
      />

      {/* Hackathon Grid */}
      {searchedHackathons.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title="No hackathons found"
          description={
            isTeacher
              ? 'Create your first hackathon to get started'
              : 'No hackathons available yet'
          }
          action={
            isTeacher ? (
              <button
                onClick={createModal.open}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-xl hover:bg-primary-600 transition-all text-sm font-medium"
              >
                <Plus size={16} /> Create Hackathon
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {pagedHackathons.map((h) => {
            const status = getHackathonStatus(h)
            const isCreator = h.creatorId === user?.id

            return (
              <motion.div
                key={h.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                <Card hover padding="none" className="h-full flex flex-col group">
                  {/* Card Content */}
                  <div className="p-5 flex-1 flex flex-col">
                    {/* Status Badge + Mode */}
                    <div className="flex items-center justify-between mb-3">
                      <Badge variant={getStatusBadgeVariant(status)} dot>
                        {getStatusLabel(status)}
                      </Badge>
                      {h.mode && (
                        <Badge variant="default">
                          {getModeLabel(h.mode)}
                        </Badge>
                      )}
                    </div>

                    {/* Hackathon Name */}
                    <h3
                      className="text-lg font-bold text-surface-900 mb-2 line-clamp-1 group-hover:text-primary-600 transition-colors cursor-pointer"
                      onClick={() => navigate(`/hackathons/${h.id}`)}
                    >
                      {h.title}
                    </h3>

                    {/* Description */}
                    {h.description && (
                      <p className="text-surface-500 text-sm mb-4 line-clamp-2 flex-1">
                        {h.description}
                      </p>
                    )}

                    {/* Meta Row */}
                    <div className="flex items-center gap-4 text-xs text-surface-500 mb-4">
                      {/* Date */}
                      {(h.startDate || h.deadline) && (
                        <span className={clsx(
                          'flex items-center gap-1.5',
                           isNearDeadline(h.deadline) && 'text-danger-600 font-semibold'
                        )}>
                          <Calendar size={14} className={isNearDeadline(h.deadline) ? 'text-danger-500' : 'text-surface-400'} />
                          {h.startDate
                            ? new Date(h.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                            : new Date(h.deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                          }
                        </span>
                      )}

                      {/* Location */}
                      {h.location && (
                        <span className="flex items-center gap-1.5">
                          <MapPin size={14} className="text-surface-400" />
                          <span className="truncate max-w-[100px]">{h.location}</span>
                        </span>
                      )}

                    </div>
                  </div>

                  {/* Participants + Rounds + Arrow */}
                  <div className="flex items-center justify-between px-5 pb-4 pt-2">
                    <div className="flex items-center gap-3 text-xs text-surface-500">
                      <span className="flex items-center gap-1.5">
                        <Users size={13} className="text-surface-400" />
                        {h.registrations?.length || 0} Participants
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Code size={13} className="text-surface-400" />
                        {h.rounds?.length || 0} Rounds
                      </span>
                    </div>
                    <button
                      onClick={() => navigate(`/hackathons/${h.id}`)}
                      className={clsx(
                        'w-8 h-8 rounded-full flex items-center justify-center transition-all',
                        status === 'completed'
                          ? 'bg-surface-100 text-surface-600 hover:bg-surface-200'
                          : 'bg-primary-50 text-primary-600 hover:bg-primary-100'
                      )}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </Card>
              </motion.div>
            )
          })}
        </div>
        <Pagination page={page} totalPages={hackTotalPages} onChange={setPage} />
        </>
      )}

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
              className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-bold text-surface-900 mb-4">Create Hackathon</h2>

              {/* URL Fetch */}
              <div className="mb-4 p-3 bg-primary-50 rounded-xl border border-primary-100">
                <label className="text-sm font-medium text-surface-700 mb-1 block">Quick Fill from URL</label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                    placeholder="Paste hackathon link..."
                    className="flex-1 px-3 py-2 bg-white border border-surface-200 rounded-lg text-sm"
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
                  <label className="text-sm font-medium text-surface-700 mb-1 block">Title *</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
                    placeholder="Hackathon name"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-surface-700 mb-1 block">Description</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm h-20"
                    placeholder="About the hackathon"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-surface-700 mb-1 block">Organizer</label>
                    <input
                      type="text"
                      value={form.organizer}
                      onChange={(e) => setForm({ ...form, organizer: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
                      placeholder="Who organizes"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-surface-700 mb-1 block">Team Size</label>
                    <input
                      type="number"
                      value={form.teamSize}
                      onChange={(e) => setForm({ ...form, teamSize: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
                      placeholder="Max team size"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-surface-700 mb-1 block">Registration URL</label>
                  <input
                    type="url"
                    value={form.registrationUrl}
                    onChange={(e) => setForm({ ...form, registrationUrl: e.target.value })}
                    className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
                    placeholder="Registration link"
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-sm font-medium text-surface-700 mb-1 block">Start Date</label>
                    <input
                      type="date"
                      value={form.startDate}
                      onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-surface-700 mb-1 block">End Date</label>
                    <input
                      type="date"
                      value={form.endDate}
                      onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-surface-700 mb-1 block">Deadline</label>
                    <input
                      type="date"
                      value={form.deadline}
                      onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-surface-700 mb-1 block">Themes (comma separated)</label>
                  <input
                    type="text"
                    value={form.themes}
                    onChange={(e) => setForm({ ...form, themes: e.target.value })}
                    className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
                    placeholder="AI, HealthTech, FinTech"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-surface-700 mb-1 block">Location</label>
                    <input
                      type="text"
                      value={form.location}
                      onChange={(e) => setForm({ ...form, location: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
                      placeholder="Venue or city"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-surface-700 mb-1 block">Mode</label>
                    <select
                      value={form.mode}
                      onChange={(e) => setForm({ ...form, mode: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm bg-white"
                    >
                      <option value="OFFLINE">Offline</option>
                      <option value="ONLINE">Online</option>
                      <option value="HYBRID">Hybrid</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-surface-700 mb-1 block">Prize Pool</label>
                    <input
                      type="text"
                      value={form.prizePool}
                      onChange={(e) => setForm({ ...form, prizePool: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
                      placeholder="e.g., ₹2,50,000"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-surface-700 mb-1 block">Duration</label>
                    <input
                      type="text"
                      value={form.duration}
                      onChange={(e) => setForm({ ...form, duration: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
                      placeholder="e.g., 30 hours"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-surface-700 mb-1 block">Eligibility</label>
                  <textarea
                    value={form.eligibility}
                    onChange={(e) => setForm({ ...form, eligibility: e.target.value })}
                    className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm h-16"
                    placeholder="Departments, years, etc."
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-surface-700 mb-1 block">Event Schedule</label>
                  <textarea
                    value={form.schedule}
                    onChange={(e) => setForm({ ...form, schedule: e.target.value })}
                    className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm h-16"
                    placeholder="Day 1: ... Day 2: ..."
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-surface-700 mb-1 block">Bootcamps (optional)</label>
                  <textarea
                    value={form.bootcamps}
                    onChange={(e) => setForm({ ...form, bootcamps: e.target.value })}
                    className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm h-16"
                    placeholder="DSA Bootcamp, Agentic AI Bootcamp, etc."
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-surface-700 mb-1 block">Highlights</label>
                  <textarea
                    value={form.highlights}
                    onChange={(e) => setForm({ ...form, highlights: e.target.value })}
                    className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm h-16"
                    placeholder="Key gains, placement info, etc."
                  />
                </div>

                {aiRounds.length > 0 && (
                  <div className="mt-4">
                    <label className="text-sm font-medium text-surface-700 mb-2 block">
                      AI-Fetched Rounds ({aiRounds.length})
                    </label>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {aiRounds.map((r, i) => (
                        <div key={i} className="p-3 bg-surface-50 border border-surface-200 rounded-xl text-sm">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold shrink-0">
                              {r.roundNumber}
                            </span>
                            <span className="font-medium text-surface-900">{r.title}</span>
                          </div>
                          {r.description && <p className="text-surface-500 text-xs mt-1 ml-8">{r.description}</p>}
                          <div className="flex gap-3 mt-1 ml-8 text-xs text-surface-400">
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
              <div className="mt-5 p-4 rounded-xl bg-surface-50 border border-surface-200">
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
                  <span className="text-sm font-medium text-surface-700">Restrict eligibility (departments/years)</span>
                </label>
                {eligibilityEnabled && (
                  <div className="mt-4 space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-surface-600 mb-2">Departments</label>
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
                                : 'bg-white text-surface-600 border-surface-200 hover:border-primary-300'
                            )}
                          >
                            {dept.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-surface-600 mb-2">Years</label>
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
                                : 'bg-white text-surface-600 border-surface-200 hover:border-primary-300'
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
                <button onClick={createModal.close} className="flex-1 px-4 py-2 bg-surface-100 text-surface-700 rounded-xl font-medium hover:bg-surface-200">
                  Cancel
                </button>
                <button onClick={handleCreate} className="flex-1 px-4 py-2 bg-gradient-to-r from-primary-500 to-primary-500 text-white rounded-xl font-medium hover:shadow-lg">
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
