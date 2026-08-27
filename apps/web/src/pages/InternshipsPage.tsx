import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { internshipAPI, departmentAPI } from '../lib/api'
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
  const [internships, setInternships] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
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

  const createModal = useModal()

  const isTeacher = user?.role === 'TEACHER' || user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'

  useEffect(() => {
    loadInternships()
    departmentAPI.getAll().then(setDepartments).catch(() => {})
  }, [])

  const loadInternships = async () => {
    try {
      const data = await internshipAPI.getAll()
      setInternships(data)
    } catch (err) {
      console.error('Failed to load internships', err)
    } finally {
      setLoading(false)
    }
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
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Internships"
        subtitle="Discover and track internship opportunities"
        action={
          <div className="flex items-center gap-3">
            <div className="relative hidden sm:block">
              <input type="text" placeholder="Search internships..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                className="w-64 pl-4 pr-4 py-2 bg-surface-50 border border-surface-200 rounded-xl text-sm text-surface-900 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all" />
            </div>
            <button
              onClick={() => internshipAPI.exportAll().then(() => toast.success('Exported!')).catch(() => toast.error('Export failed'))}
              className="flex items-center gap-2 px-4 py-2 bg-surface-100 text-surface-700 rounded-xl hover:bg-surface-200 transition-all text-sm font-medium"
            >
              <Download size={16} /> Export All
            </button>
            {isTeacher && (
              <button
                onClick={createModal.open}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-500 to-primary-500 text-white rounded-xl hover:shadow-lg transition-all text-sm font-medium"
              >
                <Plus size={16} /> Post Internship
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {pagedInternships.map((i) => {
            const status = getInternshipStatus(i)

            return (
              <motion.div
                key={i.id}
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
                      {i.mode && (
                        <Badge variant="default">
                          {i.mode}
                        </Badge>
                      )}
                    </div>

                    {/* Title */}
                    <h3
                      className="text-lg font-bold text-surface-900 mb-1 line-clamp-1 group-hover:text-primary-600 transition-colors cursor-pointer"
                      onClick={() => navigate(`/internships/${i.id}`)}
                    >
                      {i.title}
                    </h3>

                    {/* Company */}
                    {i.company && (
                      <p className="text-sm font-medium text-primary-600 mb-2 flex items-center gap-1.5">
                        <Building2 size={13} /> {i.company}
                      </p>
                    )}

                    {/* Description */}
                    {i.description && (
                      <p className="text-surface-500 text-sm mb-4 line-clamp-2 flex-1">
                        {i.description}
                      </p>
                    )}

                    {/* Meta Row */}
                    <div className="flex items-center gap-3 text-xs text-surface-500 mb-4 flex-wrap">
                      {i.stipend && (
                        <span className="px-2 py-0.5 bg-success-50 text-success-700 rounded-md font-medium">
                          {i.stipend}
                        </span>
                      )}
                      {i.duration && (
                        <span className="flex items-center gap-1">
                          <Timer size={12} className="text-surface-400" />
                          {i.duration}
                        </span>
                      )}
                      {i.deadline && (
                        <span className={clsx(
                          'flex items-center gap-1',
                          isNearDeadline(i.deadline) && 'text-danger-600 font-semibold'
                        )}>
                          <Calendar size={12} className={isNearDeadline(i.deadline) ? 'text-danger-500' : 'text-surface-400'} />
                          {new Date(i.deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Bottom Row */}
                  <div className="flex items-center justify-between px-5 pb-4 pt-2">
                    <div className="flex items-center gap-3 text-xs text-surface-500">
                      <span className="flex items-center gap-1.5">
                        <Users size={13} className="text-surface-400" />
                        {i.registrations?.length || 0} Registered
                      </span>
                      {i.role && (
                        <span className="flex items-center gap-1.5">
                          <Briefcase size={13} className="text-surface-400" />
                          {i.role}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => navigate(`/internships/${i.id}`)}
                      className={clsx(
                        'w-8 h-8 rounded-full flex items-center justify-center transition-all',
                        status === 'ended'
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
        <Pagination page={page} totalPages={intTotalPages} onChange={setPage} />
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
              <h2 className="text-xl font-bold text-surface-900 mb-4">Post Internship</h2>

              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-surface-700 mb-1 block">Quick Fill from URL</label>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={form.url}
                      onChange={(e) => setForm({ ...form, url: e.target.value })}
                      placeholder="Paste internship link..."
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
                <div>
                  <label className="text-sm font-medium text-surface-700 mb-1 block">Title *</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
                    placeholder="e.g., Software Development Intern"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-surface-700 mb-1 block">Company *</label>
                    <input
                      type="text"
                      value={form.company}
                      onChange={(e) => setForm({ ...form, company: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
                      placeholder="Company name"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-surface-700 mb-1 block">Role</label>
                    <input
                      type="text"
                      value={form.role}
                      onChange={(e) => setForm({ ...form, role: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
                      placeholder="e.g., Frontend Developer"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-surface-700 mb-1 block">Description</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm h-20"
                    placeholder="About the internship"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-surface-700 mb-1 block">Application URL</label>
                  <input
                    type="url"
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                    className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
                    placeholder="https://..."
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-sm font-medium text-surface-700 mb-1 block">Stipend</label>
                    <input
                      type="text"
                      value={form.stipend}
                      onChange={(e) => setForm({ ...form, stipend: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
                      placeholder="e.g., ₹15,000/mo"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-surface-700 mb-1 block">Duration</label>
                    <input
                      type="text"
                      value={form.duration}
                      onChange={(e) => setForm({ ...form, duration: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
                      placeholder="e.g., 3 months"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-surface-700 mb-1 block">Mode</label>
                    <select
                      value={form.mode}
                      onChange={(e) => setForm({ ...form, mode: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm bg-white"
                    >
                      <option value="REMOTE">Remote</option>
                      <option value="ONSITE">On-site</option>
                      <option value="HYBRID">Hybrid</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
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
                    <label className="text-sm font-medium text-surface-700 mb-1 block">Deadline</label>
                    <input
                      type="date"
                      value={form.deadline}
                      onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                      className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
                    />
                  </div>
                </div>
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
