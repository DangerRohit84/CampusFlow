import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { internshipAPI, departmentAPI } from '../lib/api'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useDebounce } from '../hooks/useDebounce'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Briefcase, Calendar, Users, Download,
  Trash2, Loader2, ChevronRight, Timer,
  Clock, CheckCircle2, Filter, ExternalLink, Building2, Sparkles, MapPin
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import Badge from '../components/ui/Badge'
import Card from '../components/ui/Card'
import FilterTabs from '../components/shared/FilterTabs'
import EmptyState from '../components/shared/EmptyState'
import Pagination from '../components/shared/Pagination'
import PageHeader from '../components/shared/PageHeader'
import StatCard from '../components/shared/StatCard'
import { useFilteredItems } from '../hooks/useFilteredItems'
import { useModal } from '../hooks/useModal'
import type { Department } from '../types/api'

type InternshipStatus = 'upcoming' | 'active' | 'ended'

export default function InternshipsPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    title: '',
    description: '',
    company: '',
    role: '',
    url: '',
    stipend: '',
    duration: '',
    mode: 'REMOTE',
    startDate: '',
    deadline: '',
  })
  const [departments, setDepartments] = useState<Department[]>([])
  const [targetDepartments, setTargetDepartments] = useState<string[]>([])
  const [targetYears, setTargetYears] = useState<number[]>([])
  const [eligibilityEnabled, setEligibilityEnabled] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 300)

  const createModal = useModal()

  const isTeacher = user?.role === 'TEACHER' || user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'

  const { data: internshipsData, isLoading: loading } = useQuery({
    queryKey: ['internships', debouncedSearch],
    queryFn: ({ signal }) => internshipAPI.getAll({ search: debouncedSearch || undefined, signal } as any),
    staleTime: 3 * 60 * 1000,
    placeholderData: keepPreviousData,
  })
  const internships = (internshipsData as any[]) ?? []

  const prefetchPage = (_p: number) => { void _p }

  useEffect(() => {
    departmentAPI.getAll().then(setDepartments).catch(() => {})
  }, [])

  const loadInternships = async () => {
    await queryClient.invalidateQueries({ queryKey: ['internships'] })
  }

  const getInternshipStatus = (i: any): InternshipStatus => {
    const now = new Date()
    const deadline = i.deadline ? new Date(i.deadline) : null
    const startDate = i.startDate ? new Date(i.startDate) : null

    if (i.status === 'ENDED' || i.status === 'INACTIVE') return 'ended'

    if (deadline) {
      if (now > deadline) return 'ended'
    }

    if (startDate) {
      if (now < startDate) return 'upcoming'
      const sixMonthsMs = 180 * 24 * 60 * 60 * 1000
      if (now.getTime() - startDate.getTime() > sixMonthsMs) return 'ended'
      return 'active'
    }

    return 'upcoming'
  }

  const { activeTab, setActiveTab, filteredItems: filteredInternships } = useFilteredItems<any>({
    items: internships,
    tabs: [
      { key: 'all', label: 'All' },
      { key: 'upcoming', label: 'Upcoming' },
      { key: 'active', label: 'Active' },
      { key: 'ended', label: 'Ended' },
    ],
    filterFn: (i, tab) => tab === 'all' || getInternshipStatus(i) === tab,
    defaultTab: 'upcoming',
  })

  const searchedInternships = useMemo(() => {
    const items = !searchQuery.trim() ? filteredInternships : filteredInternships.filter((i: any) =>
      i.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.company?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.role?.toLowerCase().includes(searchQuery.toLowerCase())
    )
    return [...items].sort((a: any, b: any) => {
      const statusA = getInternshipStatus(a)
      const statusB = getInternshipStatus(b)
      // Upcoming: sort by registration deadline (nearest first)
      if (statusA === 'upcoming' && statusB === 'upcoming') {
        if (!a.deadline && !b.deadline) return 0
        if (!a.deadline) return 1
        if (!b.deadline) return -1
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime()
      }
      // Active: sort by nearest deadline
      if (statusA === 'active' && statusB === 'active') {
        if (!a.deadline && !b.deadline) return 0
        if (!a.deadline) return 1
        if (!b.deadline) return -1
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime()
      }
      return 0
    })
  }, [filteredInternships, searchQuery])

  // ===== Pagination =====
  const [page, setPage] = useState(1)
  const INTERNSHIPS_PER_PAGE = 10
  const intTotalPages = Math.max(1, Math.ceil(searchedInternships.length / INTERNSHIPS_PER_PAGE))
  const pagedInternships = searchedInternships.slice((page - 1) * INTERNSHIPS_PER_PAGE, page * INTERNSHIPS_PER_PAGE)
  useEffect(() => { setPage(1) }, [activeTab, searchQuery])

  const tabCounts = useMemo(() => ({
    all: internships.length,
    upcoming: internships.filter((i) => getInternshipStatus(i) === 'upcoming').length,
    active: internships.filter((i) => getInternshipStatus(i) === 'active').length,
    ended: internships.filter((i) => getInternshipStatus(i) === 'ended').length,
  }), [internships])

  const isNearDeadline = (dateStr: string) => {
    if (!dateStr) return false
    const diff = new Date(dateStr).getTime() - Date.now()
    return diff > 0 && diff <= 3 * 24 * 60 * 60 * 1000
  }

  const getStatusBadgeVariant = (status: InternshipStatus): 'primary' | 'warning' | 'default' => {
    switch (status) {
      case 'upcoming': return 'primary'
      case 'active': return 'warning'
      case 'ended': return 'default'
    }
  }

  const getStatusLabel = (status: InternshipStatus) => {
    switch (status) {
      case 'active': return 'Active'
      case 'upcoming': return 'Upcoming'
      case 'ended': return 'Ended'
    }
  }

  const handleFetchDetails = async () => {
    if (!form.url) {
      toast.error('Enter a URL first')
      return
    }
    setFetching(true)
    try {
      const details = await internshipAPI.fetchDetails(form.url)
      if (details) {
        if (details.title) setForm((f) => ({ ...f, title: details.title }))
        if (details.company) setForm((f) => ({ ...f, company: details.company }))
        if (details.role) setForm((f) => ({ ...f, role: details.role }))
        if (details.description) setForm((f) => ({ ...f, description: details.description }))
        if (details.stipend) setForm((f) => ({ ...f, stipend: details.stipend }))
        if (details.duration) setForm((f) => ({ ...f, duration: details.duration }))
        if (details.mode) setForm((f) => ({ ...f, mode: details.mode }))
        if (details.deadline) setForm((f) => ({ ...f, deadline: details.deadline }))
        toast.success('Details filled by AI!')
      }
    } catch {
      toast.error('Failed to fetch details')
    } finally {
      setFetching(false)
    }
  }

  const handleCreate = async () => {
    if (!form.title || !form.company) {
      toast.error('Title and Company are required')
      return
    }
    try {
      await internshipAPI.create({
        ...form,
        targetDepartments: eligibilityEnabled ? targetDepartments : [],
        targetYears: eligibilityEnabled ? targetYears : [],
        eligibilityEnabled: eligibilityEnabled && (targetDepartments.length > 0 || targetYears.length > 0),
      })
      toast.success('Internship posted!')
      createModal.close()
      setForm({ title: '', description: '', company: '', role: '', url: '', stipend: '', duration: '', mode: 'REMOTE', startDate: '', deadline: '' })
      setTargetDepartments([])
      setTargetYears([])
      setEligibilityEnabled(false)
      loadInternships()
    } catch (err) {
      toast.error('Failed to create internship')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this internship?')) return
    try {
      await internshipAPI.delete(id)
      toast.success('Deleted')
      loadInternships()
    } catch (err) {
      toast.error('Failed to delete')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[45vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6 section--internships">
      {/* Notice Board Head — blue #2563EB 5% wash — one wash per section */}
      <div className="paper overflow-hidden">
        <div className="h-[3px] bg-primary-600" />
        <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center"><Briefcase size={18} className="text-white" /></div>
            <div>
              <h1 className="font-display text-xl font-extrabold text-slate-800 dark:text-night-50 leading-none">Notice Board — Internships</h1>
              <p className="text-xs text-surface-500 dark:text-night-400">Blue wash 5% · #2563EB · slate #1E293B text</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative hidden sm:block">
              <input type="text" placeholder="Search notices…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                className="w-[200px] pl-4 pr-4 min-h-[44px] bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-xl text-sm placeholder:text-surface-400 dark:placeholder:text-night-400 focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-500/15" />
            </div>
            {isTeacher && (
              <button
                onClick={() => internshipAPI.exportAll().then(() => toast.success('Exported!')).catch(() => toast.error('Export failed'))}
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
        <div className="px-5 pb-4 sm:hidden">
          <input type="text" placeholder="Search internships..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full px-4 min-h-[44px] bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-xl text-sm" />
        </div>
      </div>

      {/* Filter Tabs — blue for internships */}
      <FilterTabs
        accent="blue"
        tabs={[
          { key: 'all', label: 'All', icon: Filter, count: tabCounts.all },
          { key: 'upcoming', label: 'Upcoming', icon: Clock, count: tabCounts.upcoming },
          { key: 'active', label: 'Active', icon: CheckCircle2, count: tabCounts.active },
          { key: 'ended', label: 'Ended', icon: Calendar, count: tabCounts.ended },
        ]}
        activeTab={activeTab}
        onTabChange={(key) => setActiveTab(key as any)}
      />

      {/* Internship Grid */}
      {searchedInternships.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No internships found"
          description={
            isTeacher
              ? 'Post your first internship to get started'
              : 'No internships available yet'
          }
          action={
            isTeacher ? (
              <button
                onClick={createModal.open}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-xl hover:bg-primary-600 transition-all text-sm font-medium"
              >
                <Plus size={16} /> Post Internship
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pagedInternships.map((i) => {
            const status = getInternshipStatus(i)
            const isUrgent = status!=='ended' && isNearDeadline(i.deadline)
            return (
              <div
                key={i.id}
                onClick={() => navigate(`/internships/${i.id}`)}
                className={clsx('due-slip p-5 flex flex-col cursor-pointer hover:shadow-e2 transition-shadow', isUrgent ? 'due-slip--urgent' : 'due-slip--blue')}
              >
                  <div className="flex items-center justify-between">
                    <span className={clsx('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border', status==='upcoming'?'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800/40': status==='active'?'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/40':'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700')}>
                      <span className={clsx('w-1.5 h-1.5 rounded-full', status==='upcoming'?'bg-sky-600': status==='active'?'bg-emerald-500':'bg-zinc-400')} /> {getStatusLabel(status)}
                    </span>
                    {i.mode && <span className="text-[11px] font-semibold tracking-wide uppercase text-surface-400 dark:text-night-400 border border-surface-200 dark:border-night-600 rounded-full px-2 py-1">{i.mode}</span>}
                  </div>
                  <h3 className="mt-3 font-display font-bold text-surface-900 dark:text-night-50 line-clamp-1 hover:text-primary-700">
                    {i.title}
                  </h3>
                  {i.company && <p className="text-sm font-semibold text-sky-700 dark:text-sky-300 flex items-center gap-1.5 mt-1"><Building2 size={13}/> {i.company}</p>}
                  {i.description && <p className="text-sm text-surface-500 dark:text-night-400 line-clamp-2 mt-2 flex-1">{i.description}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    {i.stipend && <span className="px-2 py-1 bg-success-50 dark:bg-emerald-950/30 text-success-700 dark:text-emerald-300 border border-success-100 dark:border-emerald-800/40 rounded-full text-xs font-semibold">{i.stipend}</span>}
                    {i.duration && <span className="inline-flex items-center gap-1 text-surface-500 dark:text-night-400"><Timer size={12}/> {i.duration}</span>}
                    {i.deadline && <span className={clsx('inline-flex items-center gap-1 px-2 py-1 rounded-full border text-xs font-medium', isUrgent ? 'bg-danger-50 dark:bg-danger-950/30 text-danger-700 dark:text-danger-300 border-danger-100 dark:border-danger-900/40' : 'bg-surface-50 dark:bg-night-800 text-surface-600 dark:text-night-300 border-surface-200 dark:border-night-600')}><Calendar size={12}/> {new Date(i.deadline).toLocaleDateString('en-IN',{day:'numeric',month:'short'})} {isUrgent && '· Due soon'}</span>}
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-surface-100 dark:border-night-600 pt-3">
                    <span className="text-xs text-surface-500 dark:text-night-400 inline-flex items-center gap-3"><span className="inline-flex items-center gap-1"><Users size={12}/> {i.registrations?.length||0}</span> {i.role && <span className="inline-flex items-center gap-1"><Briefcase size={12}/> {i.role}</span>}</span>
                    <span className="w-8 h-8 rounded-full bg-sky-600 text-white inline-flex items-center justify-center"><ChevronRight size={14}/></span>
                  </div>
              </div>
            )
          })}
        </div>
        <Pagination page={page} totalPages={intTotalPages} onChange={setPage} onPrefetch={prefetchPage} />
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
              className="bg-white dark:bg-night-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-bold text-surface-900 dark:text-night-50 mb-4">Post Internship</h2>

              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Quick Fill from URL</label>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={form.url}
                      onChange={(e) => setForm({ ...form, url: e.target.value })}
                      placeholder="Paste internship link..."
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
                <div>
                  <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Title *</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 rounded-xl text-sm"
                    placeholder="e.g., Software Development Intern"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Company *</label>
                    <input
                      type="text"
                      value={form.company}
                      onChange={(e) => setForm({ ...form, company: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 rounded-xl text-sm"
                      placeholder="Company name"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Role</label>
                    <input
                      type="text"
                      value={form.role}
                      onChange={(e) => setForm({ ...form, role: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 rounded-xl text-sm"
                      placeholder="e.g., Frontend Developer"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Description</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 rounded-xl text-sm h-20"
                    placeholder="About the internship"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Application URL</label>
                  <input
                    type="url"
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                    className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 rounded-xl text-sm"
                    placeholder="https://..."
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Stipend</label>
                    <input
                      type="text"
                      value={form.stipend}
                      onChange={(e) => setForm({ ...form, stipend: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 rounded-xl text-sm"
                      placeholder="e.g., ₹15,000/mo"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Duration</label>
                    <input
                      type="text"
                      value={form.duration}
                      onChange={(e) => setForm({ ...form, duration: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 rounded-xl text-sm"
                      placeholder="e.g., 3 months"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Mode</label>
                    <select
                      value={form.mode}
                      onChange={(e) => setForm({ ...form, mode: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 rounded-xl text-sm"
                    >
                      <option value="REMOTE">Remote</option>
                      <option value="ONSITE">On-site</option>
                      <option value="HYBRID">Hybrid</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
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
                    <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Deadline</label>
                    <input
                      type="date"
                      value={form.deadline}
                      onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 rounded-xl text-sm"
                    />
                  </div>
                </div>
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
                  Post
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
