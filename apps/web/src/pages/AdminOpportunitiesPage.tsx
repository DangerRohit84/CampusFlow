import { useState, useEffect, useMemo } from 'react'
import { useAuthStore } from '../store/authStore'
import { opportunityAPI, adminAPI } from '../lib/api'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Briefcase, Code2, Calendar, Globe, Building2,
  Loader2, CheckCircle, XCircle, UserCheck, RefreshCw,
  Clock, Filter, Sparkles, AlertCircle, Trash2, BarChart3
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import FilterTabs from '../components/shared/FilterTabs'
import EmptyState from '../components/shared/EmptyState'
import PageHeader from '../components/shared/PageHeader'

type TabKey = 'pending' | 'approved' | 'rejected' | 'all'

export default function AdminOpportunitiesPage() {
  const { user } = useAuthStore()
  const [opportunities, setOpportunities] = useState<any[]>([])
  const [pendingOpportunities, setPendingOpportunities] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchingNow, setFetchingNow] = useState(false)
  const [activeTab, setActiveTab] = useState<TabKey>('pending')
  const [teachers, setTeachers] = useState<any[]>([])
  const [assigningId, setAssigningId] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [allData, pendingData, teachersData] = await Promise.all([
        opportunityAPI.getAll(),
        opportunityAPI.getPending(),
        adminAPI.getUsers().then((users: any[]) => users.filter((u: any) => u.role === 'TEACHER')),
      ])
      setOpportunities(allData)
      setPendingOpportunities(pendingData)
      setTeachers(teachersData)
    } catch (err) {
      console.error('Failed to load opportunities', err)
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async (id: string) => {
    try {
      await opportunityAPI.approve(id)
      toast.success('Opportunity approved!')
      loadData()
    } catch (err) {
      toast.error('Failed to approve')
    }
  }

  const handleReject = async (id: string) => {
    try {
      await opportunityAPI.reject(id)
      toast.success('Opportunity rejected')
      loadData()
    } catch (err) {
      toast.error('Failed to reject')
    }
  }

  const handleAssign = async (id: string, teacherId: string) => {
    try {
      await opportunityAPI.assign(id, teacherId)
      toast.success('Assigned to teacher!')
      setAssigningId(null)
      loadData()
    } catch (err) {
      toast.error('Failed to assign')
    }
  }

  const handleFetchNow = async () => {
    setFetchingNow(true)
    try {
      await opportunityAPI.fetchNow()
      toast.success('Fetch triggered! New opportunities will appear shortly.')
      setTimeout(loadData, 3000)
    } catch (err) {
      toast.error('Failed to trigger fetch')
    } finally {
      setFetchingNow(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this opportunity?')) return
    try {
      await opportunityAPI.delete(id)
      toast.success('Deleted')
      loadData()
    } catch (err) {
      toast.error('Failed to delete')
    }
  }

  const filtered = useMemo(() => {
    if (activeTab === 'all') return opportunities
    if (activeTab === 'pending') return pendingOpportunities
    if (activeTab === 'approved') return opportunities.filter((o) => o.status === 'APPROVED')
    return opportunities.filter((o) => o.status === 'REJECTED')
  }, [opportunities, pendingOpportunities, activeTab])

  const stats = useMemo(() => {
    const today = new Date().toDateString()
    return {
      totalPending: pendingOpportunities.length,
      approvedToday: opportunities.filter(
        (o) => o.status === 'APPROVED' && new Date(o.approvedAt || o.updatedAt).toDateString() === today
      ).length,
      rejectedToday: opportunities.filter(
        (o) => o.status === 'REJECTED' && new Date(o.updatedAt).toDateString() === today
      ).length,
    }
  }, [opportunities, pendingOpportunities])

  const formatDate = (dateStr: string) => {
    if (!dateStr) return null
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
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
      <PageHeader
        title="Opportunity Management"
        subtitle="Review and approve external opportunities"
        action={
          <button
            onClick={handleFetchNow}
            disabled={fetchingNow}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-500 to-accent-500 text-white rounded-xl hover:shadow-lg transition-all text-sm font-medium disabled:opacity-50"
          >
            {fetchingNow ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RefreshCw size={16} />
            )}
            Fetch Now
          </button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl border border-surface-100 p-5"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
              <Clock size={20} className="text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-surface-900">{stats.totalPending}</p>
              <p className="text-xs text-surface-500">Pending Review</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-2xl border border-surface-100 p-5"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
              <CheckCircle size={20} className="text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-surface-900">{stats.approvedToday}</p>
              <p className="text-xs text-surface-500">Approved Today</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-2xl border border-surface-100 p-5"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
              <XCircle size={20} className="text-red-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-surface-900">{stats.rejectedToday}</p>
              <p className="text-xs text-surface-500">Rejected Today</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Tabs */}
      <FilterTabs
        tabs={[
          { key: 'pending', label: 'Pending', icon: AlertCircle, count: pendingOpportunities.length },
          { key: 'approved', label: 'Approved', icon: CheckCircle, count: opportunities.filter((o) => o.status === 'APPROVED').length },
          { key: 'rejected', label: 'Rejected', icon: XCircle, count: opportunities.filter((o) => o.status === 'REJECTED').length },
          { key: 'all', label: 'All', icon: Filter, count: opportunities.length },
        ]}
        activeTab={activeTab}
        onTabChange={(key) => setActiveTab(key as TabKey)}
      />

      {/* Opportunities List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title={
            activeTab === 'pending'
              ? 'No pending opportunities'
              : `No ${activeTab} opportunities`
          }
          description={
            activeTab === 'pending'
              ? 'All caught up! Click "Fetch Now" to check for new ones.'
              : 'No opportunities match this filter.'
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((opp, i) => (
            <motion.div
              key={opp.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className={clsx(
                'bg-white rounded-2xl border p-5 transition-all',
                opp.status === 'PENDING'
                  ? 'border-amber-200 hover:border-amber-300'
                  : opp.status === 'APPROVED'
                  ? 'border-green-200'
                  : 'border-surface-100'
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={clsx(
                        'px-2.5 py-1 rounded-full text-xs font-semibold',
                        opp.type === 'HACKATHON'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-blue-100 text-blue-700'
                      )}
                    >
                      {opp.type === 'HACKATHON' ? 'Hackathon' : 'Internship'}
                    </span>
                    <span
                      className={clsx(
                        'px-2 py-0.5 rounded-full text-xs font-semibold',
                        opp.status === 'PENDING'
                          ? 'bg-amber-100 text-amber-700'
                          : opp.status === 'APPROVED'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      )}
                    >
                      {opp.status}
                    </span>
                    {opp.source && (
                      <span className="px-2 py-0.5 bg-surface-100 text-surface-600 rounded-md text-xs font-medium">
                        {opp.source}
                      </span>
                    )}
                  </div>

                  <h3 className="font-bold text-surface-900 mb-1">{opp.title}</h3>

                  {(opp.company || opp.organizer) && (
                    <p className="text-surface-500 text-xs mb-2 flex items-center gap-1">
                      <Building2 size={12} />
                      {opp.company || opp.organizer}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-3 text-xs text-surface-500">
                    {opp.mode && (
                      <span className="flex items-center gap-1">
                        <Globe size={11} className="text-accent-500" />
                        {opp.mode}
                      </span>
                    )}
                    {opp.deadline && (
                      <span className="flex items-center gap-1">
                        <Calendar size={11} className="text-accent-500" />
                        {formatDate(opp.deadline)}
                      </span>
                    )}
                    {opp.url && (
                      <a
                        href={opp.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary-500 hover:underline"
                      >
                        View Source
                      </a>
                    )}
                  </div>
                </div>

                {/* Actions */}
                {opp.status === 'PENDING' && (
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="relative">
                      <button
                        onClick={() => setAssigningId(assigningId === opp.id ? null : opp.id)}
                        className="flex items-center gap-1.5 px-3 py-2 bg-surface-100 text-surface-700 rounded-xl text-sm font-medium hover:bg-surface-200 transition-all"
                      >
                        <UserCheck size={14} />
                        Assign
                      </button>
                      <AnimatePresence>
                        {assigningId === opp.id && (
                          <motion.div
                            initial={{ opacity: 0, y: -5 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -5 }}
                            className="absolute right-0 top-full mt-1 bg-white border border-surface-200 rounded-xl shadow-lg z-10 w-56 max-h-48 overflow-y-auto"
                          >
                            {teachers.length === 0 ? (
                              <div className="px-3 py-2 text-xs text-surface-400">No teachers found</div>
                            ) : (
                              teachers.map((t) => (
                                <button
                                  key={t.id}
                                  onClick={() => handleAssign(opp.id, t.id)}
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-surface-50 transition-all flex items-center gap-2"
                                >
                                  <div className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold">
                                    {t.name?.charAt(0)}
                                  </div>
                                  <div>
                                    <p className="font-medium text-surface-900 text-xs">{t.name}</p>
                                    <p className="text-[10px] text-surface-400">{t.email}</p>
                                  </div>
                                </button>
                              ))
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    <button
                      onClick={() => handleApprove(opp.id)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-green-500 text-white rounded-xl text-sm font-medium hover:bg-green-600 transition-all"
                    >
                      <CheckCircle size={14} />
                      Approve
                    </button>
                    <button
                      onClick={() => handleReject(opp.id)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 transition-all"
                    >
                      <XCircle size={14} />
                      Reject
                    </button>
                  </div>
                )}

                {opp.status !== 'PENDING' && (
                  <button
                    onClick={() => handleDelete(opp.id)}
                    className="p-2 rounded-xl text-surface-400 hover:text-red-500 hover:bg-red-50 transition-all shrink-0"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
