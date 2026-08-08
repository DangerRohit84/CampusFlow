import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { internshipAPI, departmentAPI } from '../lib/api'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Briefcase, Calendar, Users, Download,
  Trash2, Loader2, ChevronRight,
  Clock, CheckCircle2, Filter, ExternalLink, Building2
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import FilterTabs from '../components/shared/FilterTabs'
import EmptyState from '../components/shared/EmptyState'
import PageHeader from '../components/shared/PageHeader'
import StatCard from '../components/shared/StatCard'
import EligibilityPopup from '../components/shared/EligibilityPopup'
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

  const createModal = useModal()
  const eligibilityPopup = useModal()

  const isTeacher = user?.role === 'TEACHER' || user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'

  useEffect(() => {
    const init = async () => {
      if (isTeacher) {
        try { await internshipAPI.fetchNow() } catch {}
      }
      await loadInternships()
      departmentAPI.getAll().then(setDepartments).catch(() => {})
    }
    init()
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

    // Has deadline → use it
    if (deadline) {
      if (now > deadline) return 'ended'
    }

    // Has startDate → compare with now
    if (startDate) {
      if (now < startDate) return 'upcoming'
      // Active if within 6 months of start
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
  })

  const tabCounts = useMemo(() => ({
    all: internships.length,
    upcoming: internships.filter((i) => getInternshipStatus(i) === 'upcoming').length,
    active: internships.filter((i) => getInternshipStatus(i) === 'active').length,
    ended: internships.filter((i) => getInternshipStatus(i) === 'ended').length,
  }), [internships])

  const statCounts = useMemo(() => ({
    total: internships.length,
    upcoming: internships.filter((i) => getInternshipStatus(i) === 'upcoming').length,
    active: internships.filter((i) => getInternshipStatus(i) === 'active').length,
    registrations: internships.reduce((sum, i) => sum + (i.registrations?.length || i._count?.registrations || 0), 0),
  }), [internships])

  const isNearDeadline = (dateStr: string) => {
    if (!dateStr) return false
    const diff = new Date(dateStr).getTime() - Date.now()
    return diff > 0 && diff <= 3 * 24 * 60 * 60 * 1000
  }

  const handleCreate = async () => {
    if (!form.title || !form.company) {
      toast.error('Title and Company are required')
      return
    }
    createModal.close()
    eligibilityPopup.open()
  }

  const handleConfirmCreate = async (withEligibility: boolean) => {
    try {
      await internshipAPI.create({
        ...form,
        targetDepartments: withEligibility ? targetDepartments : [],
        targetYears: withEligibility ? targetYears : [],
        eligibilityEnabled: withEligibility && (targetDepartments.length > 0 || targetYears.length > 0),
      })
      toast.success('Internship posted!')
      eligibilityPopup.close()
      createModal.close()
      setForm({ title: '', description: '', company: '', role: '', url: '', stipend: '', duration: '', mode: 'REMOTE', startDate: '', deadline: '' })
      setTargetDepartments([])
      setTargetYears([])
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
            <button
              onClick={() => internshipAPI.exportAll().then(() => toast.success('Exported!')).catch(() => toast.error('Export failed'))}
              className="flex items-center gap-2 px-4 py-2 bg-surface-100 text-surface-700 rounded-xl hover:bg-surface-200 transition-all text-sm font-medium"
            >
              <Download size={16} /> Export All
            </button>
            {isTeacher && (
              <button
                onClick={createModal.open}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-500 to-accent-500 text-white rounded-xl hover:shadow-lg transition-all text-sm font-medium"
              >
                <Plus size={16} /> Post Internship
              </button>
            )}
          </div>
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Internships"
          value={statCounts.total}
          icon={Briefcase}
          color="from-blue-500 to-blue-600"
          bg="bg-blue-100"
        />
        <StatCard
          label="Upcoming"
          value={statCounts.upcoming}
          icon={Clock}
          color="from-amber-500 to-amber-600"
          bg="bg-amber-100"
        />
        <StatCard
          label="Active"
          value={statCounts.active}
          icon={CheckCircle2}
          color="from-green-500 to-green-600"
          bg="bg-green-100"
        />
        <StatCard
          label="Registrations"
          value={statCounts.registrations}
          icon={Users}
          color="from-purple-500 to-purple-600"
          bg="bg-purple-100"
        />
      </div>

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
      {filteredInternships.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No internships"
          description={isTeacher ? 'Post your first internship to get started' : 'No internships available yet'}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredInternships.map((i) => {
            const status = getInternshipStatus(i)
            const statusConfig = {
              upcoming: { color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
              active: { color: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
              ended: { color: 'bg-surface-100 text-surface-500', dot: 'bg-surface-400' },
            }
            const cfg = statusConfig[status]

            return (
              <motion.div
                key={i.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-2xl border border-surface-100 p-5 hover:shadow-lg transition-all cursor-pointer group"
                onClick={() => navigate(`/internships/${i.id}`)}
              >
                <div className="flex items-start justify-between mb-3">
                  <span className={clsx('px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5', cfg.color)}>
                    <span className={clsx('w-1.5 h-1.5 rounded-full', cfg.dot)} />
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </span>
                  {i.creatorId === user?.id && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(i.id) }}
                      className="p-1 rounded-lg text-surface-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                <h3 className="font-bold text-surface-900 mb-1 line-clamp-1">{i.title}</h3>
                {i.company && (
                  <p className="text-xs font-medium text-primary-600 mb-1 flex items-center gap-1">
                    <Building2 size={11} /> {i.company}
                  </p>
                )}
                {i.role && <p className="text-surface-500 text-xs mb-2">{i.role}</p>}

                <div className="flex items-center gap-3 text-xs text-surface-500 flex-wrap">
                  {i.stipend && (
                    <span className="px-2 py-0.5 bg-green-50 text-green-700 rounded-md font-medium">
                      {i.stipend}
                    </span>
                  )}
                  {i.duration && (
                    <span className="px-2 py-0.5 bg-surface-50 rounded-md">{i.duration}</span>
                  )}
                  {i.mode && (
                    <span className="px-2 py-0.5 bg-surface-50 rounded-md">{i.mode}</span>
                  )}
                  {i.deadline && (
                    <span className={clsx('flex items-center gap-1', isNearDeadline(i.deadline) && 'text-red-600 font-semibold')}>
                      <Calendar size={11} className={isNearDeadline(i.deadline) ? 'text-red-500' : 'text-accent-500'} />
                      {new Date(i.deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </span>
                  )}
                  {i.registrations?.length > 0 && (
                    <span className="flex items-center gap-1">
                      <Users size={11} className="text-green-500" />
                      {i.registrations.length}
                    </span>
                  )}
                </div>

                <div className="mt-3 pt-3 border-t border-surface-100 flex items-center justify-between">
                  {i.url ? (
                    <span className="text-xs text-primary-500 flex items-center gap-1">
                      <ExternalLink size={11} /> Apply
                    </span>
                  ) : (
                    <span />
                  )}
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
              <h2 className="text-xl font-bold text-surface-900 mb-4">Post Internship</h2>

              <div className="space-y-3">
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

              <div className="flex gap-3 mt-5">
                <button onClick={createModal.close} className="flex-1 px-4 py-2 bg-surface-100 text-surface-700 rounded-xl font-medium hover:bg-surface-200">
                  Cancel
                </button>
                <button onClick={handleCreate} className="flex-1 px-4 py-2 bg-gradient-to-r from-primary-500 to-accent-500 text-white rounded-xl font-medium hover:shadow-lg">
                  Post
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Eligibility Popup */}
      <EligibilityPopup
        show={eligibilityPopup.isOpen}
        title="Who can register?"
        subtitle="Select departments and years, or skip to allow everyone."
        departments={departments}
        targetDepartments={targetDepartments}
        setTargetDepartments={setTargetDepartments}
        targetYears={targetYears}
        setTargetYears={setTargetYears}
        onSkip={() => handleConfirmCreate(false)}
        onConfirm={() => handleConfirmCreate(true)}
        onCancel={() => { eligibilityPopup.close(); createModal.open(); setTargetDepartments([]); setTargetYears([]) }}
      />
    </div>
  )
}
