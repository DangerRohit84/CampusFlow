import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { hackathonAPI, departmentAPI } from '../lib/api'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Trophy, Calendar, Users, Download,
  Trash2, Loader2, Sparkles, ChevronRight,
  Clock, Zap, CheckCircle2, Filter
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import FilterTabs from '../components/shared/FilterTabs'
import EmptyState from '../components/shared/EmptyState'
import PageHeader from '../components/shared/PageHeader'
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

  const { activeTab, setActiveTab, filteredItems: filteredHackathons } = useFilteredItems<any>({
    items: hackathons,
    tabs: [
      { key: 'all', label: 'All' },
      { key: 'upcoming', label: 'Upcoming' },
      { key: 'ongoing', label: 'Ongoing' },
      { key: 'completed', label: 'Completed' },
    ],
    filterFn: (h, tab) => tab === 'all' || getHackathonStatus(h) === tab,
  })

  const tabCounts = useMemo(() => ({
    all: hackathons.length,
    upcoming: hackathons.filter((h) => getHackathonStatus(h) === 'upcoming').length,
    ongoing: hackathons.filter((h) => getHackathonStatus(h) === 'ongoing').length,
    completed: hackathons.filter((h) => getHackathonStatus(h) === 'completed').length,
  }), [hackathons])

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

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this hackathon?')) return
    try {
      await hackathonAPI.delete(id)
      toast.success('Deleted')
      loadHackathons()
    } catch (err) {
      toast.error('Failed to delete')
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
      {/* Header */}
      <PageHeader
        title="Hackathons"
        subtitle="Discover and track hackathons"
        action={
          <div className="flex items-center gap-3">
            <button
              onClick={() => hackathonAPI.exportAll()}
              className="flex items-center gap-2 px-4 py-2 bg-surface-100 text-surface-700 rounded-xl hover:bg-surface-200 transition-all text-sm font-medium"
            >
              <Download size={16} /> Export All
            </button>
            {isTeacher && (
              <button
                onClick={createModal.open}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-500 to-accent-500 text-white rounded-xl hover:shadow-lg transition-all text-sm font-medium"
              >
                <Plus size={16} /> Create Hackathon
              </button>
            )}
          </div>
        }
      />

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
      {filteredHackathons.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title="No hackathons"
          description={isTeacher ? 'Create your first hackathon to get started' : 'No hackathons available yet'}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredHackathons.map((h) => {
            const status = getHackathonStatus(h)
            const statusConfig = {
              upcoming: { color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
              ongoing: { color: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
              completed: { color: 'bg-surface-100 text-surface-500', dot: 'bg-surface-400' },
            }
            const cfg = statusConfig[status]

            return (
              <motion.div
                key={h.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-2xl border border-surface-100 p-5 hover:shadow-lg transition-all cursor-pointer group"
                onClick={() => navigate(`/hackathons/${h.id}`)}
              >
                <div className="flex items-start justify-between mb-3">
                  <span className={clsx('px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5', cfg.color)}>
                    <span className={clsx('w-1.5 h-1.5 rounded-full', cfg.dot)} />
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </span>
                  {h.creatorId === user?.id && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(h.id) }}
                      className="p-1 rounded-lg text-surface-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                <h3 className="font-bold text-surface-900 mb-1 line-clamp-1">{h.title}</h3>
                {h.organizer && <p className="text-surface-500 text-xs mb-2">{h.organizer}</p>}

                <div className="flex items-center gap-3 text-xs text-surface-500">
                  {h.mode && (
                    <span className="px-2 py-0.5 bg-surface-50 rounded-md">{h.mode}</span>
                  )}
                  {h.deadline && (
                    <span className={clsx('flex items-center gap-1', isNearDeadline(h.deadline) && 'text-red-600 font-semibold')}>
                      <Calendar size={11} className={isNearDeadline(h.deadline) ? 'text-red-500' : 'text-accent-500'} />
                      {new Date(h.deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </span>
                  )}
                  {h.registrations?.length > 0 && (
                    <span className="flex items-center gap-1">
                      <Users size={11} className="text-green-500" />
                      {h.registrations.length}
                    </span>
                  )}
                </div>

                <div className="mt-3 pt-3 border-t border-surface-100 flex items-center justify-between">
                  <span className="text-xs text-surface-400">
                    {h.rounds?.length || 0} rounds
                  </span>
                  <ChevronRight size={14} className="text-surface-400 group-hover:text-primary-500 transition-colors" />
                </div>
              </motion.div>
            )
          })}
        </div>
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
                <button onClick={handleCreate} className="flex-1 px-4 py-2 bg-gradient-to-r from-primary-500 to-accent-500 text-white rounded-xl font-medium hover:shadow-lg">
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
