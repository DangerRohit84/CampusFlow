import { useState, useEffect, useMemo } from 'react'
import { useAuthStore } from '../store/authStore'
import { hackathonAPI, internshipAPI, adminAPI } from '../lib/api'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Trophy, Briefcase, RefreshCw, Trash2, Loader2, CheckCircle2,
  Edit3, ExternalLink, Clock, Users, Globe, Search, Filter,
  UserCheck, Calendar, Building2, IndianRupee, ChevronDown, X, Sparkles,
  Zap, Target, Flame, Star, Heart, Shield, Cpu, Leaf, Brain, Code
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import PageHeader from '../components/shared/PageHeader'
import EmptyState from '../components/shared/EmptyState'
import AssignPopup from '../components/shared/AssignPopup'
import { parseJsonArray, parseJsonNumberArray } from '../lib/parseJson'

// ── Helpers ──────────────────────────────────────────────

// Theme tag colors
const THEME_COLORS: Record<string, { bg: string; text: string; icon: any }> = {
  'beginner friendly': { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', icon: Star },
  'health': { bg: 'bg-rose-50 border-rose-200', text: 'text-rose-700', icon: Heart },
  'social good': { bg: 'bg-purple-50 border-purple-200', text: 'text-purple-700', icon: Shield },
  'ai': { bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700', icon: Brain },
  'ml': { bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700', icon: Brain },
  'machine learning': { bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700', icon: Brain },
  'web3': { bg: 'bg-indigo-50 border-indigo-200', text: 'text-indigo-700', icon: Cpu },
  'blockchain': { bg: 'bg-indigo-50 border-indigo-200', text: 'text-indigo-700', icon: Cpu },
  'climate': { bg: 'bg-teal-50 border-teal-200', text: 'text-teal-700', icon: Leaf },
  'sustainability': { bg: 'bg-teal-50 border-teal-200', text: 'text-teal-700', icon: Leaf },
  'fintech': { bg: 'bg-yellow-50 border-yellow-200', text: 'text-yellow-700', icon: IndianRupee },
  'finance': { bg: 'bg-yellow-50 border-yellow-200', text: 'text-yellow-700', icon: IndianRupee },
  'cybersecurity': { bg: 'bg-red-50 border-red-200', text: 'text-red-700', icon: Shield },
  'open innovation': { bg: 'bg-orange-50 border-orange-200', text: 'text-orange-700', icon: Zap },
  'hackathon': { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', icon: Flame },
  'coding': { bg: 'bg-cyan-50 border-cyan-200', text: 'text-cyan-700', icon: Code },
  'design': { bg: 'bg-pink-50 border-pink-200', text: 'text-pink-700', icon: Star },
  'default': { bg: 'bg-surface-50 border-surface-200', text: 'text-surface-600', icon: Tag },
}

function getThemeColor(theme: string) {
  const key = theme.toLowerCase().trim()
  return THEME_COLORS[key] || THEME_COLORS['default']
}

function getModeConfig(mode: string) {
  switch (mode?.toUpperCase()) {
    case 'ONLINE': return { bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700', icon: Globe, label: 'Online' }
    case 'OFFLINE': return { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', icon: Building2, label: 'Offline' }
    case 'HYBRID': return { bg: 'bg-violet-50 border-violet-200', text: 'text-violet-700', icon: Zap, label: 'Hybrid' }
    default: return { bg: 'bg-surface-50 border-surface-200', text: 'text-surface-600', icon: Globe, label: mode || 'N/A' }
  }
}

function getSourceColor(source: string) {
  const s = source?.toLowerCase() || ''
  if (s.includes('devfolio')) return { bg: 'bg-purple-100', text: 'text-purple-700' }
  if (s.includes('devpost')) return { bg: 'bg-green-100', text: 'text-green-700' }
  if (s.includes('mlh')) return { bg: 'bg-red-100', text: 'text-red-700' }
  if (s.includes('unstop')) return { bg: 'bg-blue-100', text: 'text-blue-700' }
  if (s.includes('internshala')) return { bg: 'bg-cyan-100', text: 'text-cyan-700' }
  return { bg: 'bg-surface-100', text: 'text-surface-600' }
}

// Tiny tag helper icon
import { Tag } from 'lucide-react'

// ── Types ────────────────────────────────────────────────
type TabKey = 'pending' | 'approved' | 'rejected' | 'all'
type TypeFilter = 'all' | 'HACKATHON' | 'INTERNSHIP'

// ── Component ────────────────────────────────────────────
export default function AdminOpportunitiesPage() {
  const { user } = useAuthStore()
  const [hackathons, setHackathons] = useState<any[]>([])
  const [internships, setInternships] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchingNow, setFetchingNow] = useState(false)
  const [reEnriching, setReEnriching] = useState(false)
  const [activeTab, setActiveTab] = useState<TabKey>('pending')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [teachers, setTeachers] = useState<any[]>([])
  const [editingItem, setEditingItem] = useState<any>(null)
  const [editType, setEditType] = useState<'HACKATHON' | 'INTERNSHIP'>('HACKATHON')

  // Pagination state
  const [hackPage, setHackPage] = useState(() => parseInt(new URLSearchParams(window.location.search).get('hp') || '1'))
  const [intPage, setIntPage] = useState(() => parseInt(new URLSearchParams(window.location.search).get('ip') || '1'))
  const [hackTotalPages, setHackTotalPages] = useState(1)
  const [intTotalPages, setIntTotalPages] = useState(1)
  const PAGE_SIZE = 20

  // Counts (independent of pagination)
  const [counts, setCounts] = useState({ hackTotal: 0, hackEnriched: 0, hackPending: 0, intTotal: 0, intEnriched: 0, intPending: 0 })

  // Assign popup state
  const [showAssignPopup, setShowAssignPopup] = useState(false)
  const [isBulkAssign, setIsBulkAssign] = useState(false)
  const [assigningItem, setAssigningItem] = useState<any>(null)
  const [assigningType, setAssigningType] = useState<'HACKATHON' | 'INTERNSHIP'>('HACKATHON')

  // Role gate
  const isAdmin = user?.role === 'TEACHER' || user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'

  // ── Data loading ─────────────────────────────────────
  const loadCounts = async () => {
    try {
      const [h, i] = await Promise.all([hackathonAPI.getCounts(), internshipAPI.getCounts()])
      setCounts({ hackTotal: h.total, hackEnriched: h.enriched, hackPending: h.pending, intTotal: i.total, intEnriched: i.enriched, intPending: i.pending })
    } catch (err) {
      console.error('Failed to load counts:', err)
    }
  }

  useEffect(() => {
    if (user) loadCounts()
  }, [user])

  // Poll counts every 30s for live enrichment updates
  useEffect(() => {
    if (!user) return
    const interval = setInterval(loadCounts, 30000)
    return () => clearInterval(interval)
  }, [user])

  useEffect(() => {
    if (isAdmin) loadHackathons(hackPage)
    const params = new URLSearchParams(window.location.search)
    params.set('hp', String(hackPage))
    window.history.replaceState(null, '', `?${params.toString()}`)
  }, [isAdmin, hackPage])

  useEffect(() => {
    if (isAdmin) loadInternships(intPage)
    const params = new URLSearchParams(window.location.search)
    params.set('ip', String(intPage))
    window.history.replaceState(null, '', `?${params.toString()}`)
  }, [isAdmin, intPage])

  const loadHackathons = async (page: number) => {
    setLoading(true)
    try {
      const res = await hackathonAPI.getStaging(page, PAGE_SIZE)
      setHackathons(res.data)
      setHackTotalPages(res.pagination.totalPages)
      document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err: any) {
      console.error('Failed to load hackathons:', err?.message || err)
      toast.error(`Failed to load: ${err?.response?.data?.error || err?.message || 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  const loadInternships = async (page: number) => {
    setLoading(true)
    try {
      const res = await internshipAPI.getStaging(page, PAGE_SIZE)
      setInternships(res.data)
      setIntTotalPages(res.pagination.totalPages)
      document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err: any) {
      console.error('Failed to load internships:', err?.message || err)
      toast.error(`Failed to load: ${err?.response?.data?.error || err?.message || 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  // Load teachers once
  useEffect(() => {
    if (isAdmin) {
      adminAPI.getUsers()
        .then((users: any[]) => setTeachers(users.filter((u: any) => u.role === 'TEACHER')))
        .catch(() => setTeachers([]))
    }
  }, [isAdmin])

  // ── Merge & filter ───────────────────────────────────
  const allItems = useMemo(() => {
    const items = [
      ...hackathons.map((h) => ({ ...h, _type: 'HACKATHON' as const })),
      ...internships.map((i) => ({ ...i, _type: 'INTERNSHIP' as const })),
    ]

    // Tab filter (status-based)
    let filtered = items
    if (activeTab === 'pending') {
      filtered = items.filter((i) => !i.approvedAt && i.status !== 'REJECTED')
    } else if (activeTab === 'approved') {
      filtered = items.filter((i) => !!i.approvedAt || i.status === 'APPROVED')
    } else if (activeTab === 'rejected') {
      filtered = items.filter((i) => i.status === 'REJECTED')
    }

    // Hide non-enriched items (empty targetDepartments)
    filtered = filtered.filter((i) => {
      const depts = parseJsonArray(i.targetDepartments)
      return depts.length > 0
    })

    // Type filter
    if (typeFilter !== 'all') {
      filtered = filtered.filter((i) => i._type === typeFilter)
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (i) =>
          i.title?.toLowerCase().includes(q) ||
          i.description?.toLowerCase().includes(q) ||
          i.company?.toLowerCase().includes(q) ||
          i.organizer?.toLowerCase().includes(q) ||
          i.name?.toLowerCase().includes(q)
      )
    }

    return filtered
  }, [hackathons, internships, typeFilter, searchQuery, activeTab])

  // ── Stats (from DB counts, not paginated data) ────────
  const stats = useMemo(() => {
    const totalPending = counts.hackPending + counts.intPending
    const totalEnriched = counts.hackEnriched + counts.intEnriched
    return {
      total: totalPending,
      hackathons: counts.hackPending,
      internships: counts.intPending,
      withDepts: totalEnriched,
    }
  }, [counts])

  // ── Handlers ─────────────────────────────────────────
  const handleFetchNow = async () => {
    setFetchingNow(true)
    try {
      await Promise.all([hackathonAPI.fetchExternal(), internshipAPI.fetchExternal()])
      toast.success('Fetched latest opportunities!')
      await Promise.all([loadHackathons(hackPage), loadInternships(intPage), loadCounts()])
    } catch {
      toast.error('Failed to fetch opportunities')
    } finally {
      setFetchingNow(false)
    }
  }

  const handleReEnrich = async () => {
    setReEnriching(true)
    try {
      await Promise.all([hackathonAPI.reEnrich(), internshipAPI.reEnrich()])
      toast.success('Re-enrichment started in background!')
    } catch {
      toast.error('Failed to start re-enrichment')
    } finally {
      setReEnriching(false)
    }
  }

  const handleApprove = async (id: string, type: 'HACKATHON' | 'INTERNSHIP') => {
    if (!confirm('Approve this opportunity?')) return
    try {
      if (type === 'HACKATHON') {
        await hackathonAPI.approveStaging(id)
        setHackathons((prev) => prev.map((h) => h.id === id ? { ...h, status: 'APPROVED' } : h))
      } else {
        await internshipAPI.approveStaging(id)
        setInternships((prev) => prev.map((i) => i.id === id ? { ...i, status: 'APPROVED' } : i))
      }
      toast.success('Approved!')
      loadCounts()
    } catch {
      toast.error('Failed to approve')
    }
  }

  const handleDelete = async (id: string, type: 'HACKATHON' | 'INTERNSHIP') => {
    if (!confirm('Delete this opportunity? This cannot be undone.')) return
    try {
      if (type === 'HACKATHON') {
        await hackathonAPI.deleteStaging(id)
        setHackathons((prev) => prev.filter((h) => h.id !== id))
      } else {
        await internshipAPI.deleteStaging(id)
        setInternships((prev) => prev.filter((i) => i.id !== id))
      }
      toast.success('Deleted!')
      loadCounts()
    } catch {
      toast.error('Failed to delete')
    }
  }

  const handleReject = async (id: string, type: 'HACKATHON' | 'INTERNSHIP') => {
    if (!confirm('Reject this opportunity?')) return
    try {
      if (type === 'HACKATHON') {
        await hackathonAPI.rejectStaging(id)
        setHackathons((prev) => prev.filter((h) => h.id !== id))
      } else {
        await internshipAPI.rejectStaging(id)
        setInternships((prev) => prev.filter((i) => i.id !== id))
      }
      toast.success('Rejected')
      loadCounts()
    } catch {
      toast.error('Failed to reject')
    }
  }

  const openEdit = (item: any, type: 'HACKATHON' | 'INTERNSHIP') => {
    setEditingItem({ ...item })
    setEditType(type)
  }

  const handleEditSave = async () => {
    if (!editingItem) return
    try {
      const data = {
        title: editingItem.title || editingItem.name,
        description: editingItem.description,
        mode: editingItem.mode,
        organizer: editingItem.organizer,
        company: editingItem.company,
        role: editingItem.role,
        prizePool: editingItem.prizePool,
        stipend: editingItem.stipend,
        duration: editingItem.duration,
        targetDepartments: editingItem.targetDepartments,
        targetYears: editingItem.targetYears,
        themes: editingItem.themes,
      }
      if (editType === 'HACKATHON') {
        await hackathonAPI.updateStaging(editingItem.id, data)
        setHackathons((prev) => prev.map((h) => (h.id === editingItem.id ? { ...h, ...data } : h)))
      } else {
        await internshipAPI.updateStaging(editingItem.id, data)
        setInternships((prev) => prev.map((i) => (i.id === editingItem.id ? { ...i, ...data } : i)))
      }
      toast.success('Updated!')
      setEditingItem(null)
      loadCounts()
    } catch {
      toast.error('Failed to update')
    }
  }

  const openAssign = (item: any, type: 'HACKATHON' | 'INTERNSHIP') => {
    setAssigningItem(item)
    setAssigningType(type)
    setShowAssignPopup(true)
  }

  const handleAssign = async (teacherId: string) => {
    if (!assigningItem) return
    try {
      const token = useAuthStore.getState().token
      if (assigningType === 'HACKATHON') {
        await fetch(`/api/hackathons/staging/${assigningItem.id}/assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ teacherId }),
        })
      } else {
        await fetch(`/api/internships/staging/${assigningItem.id}/assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ teacherId }),
        })
      }
      toast.success('Assigned!')
      setShowAssignPopup(false)
      loadHackathons(hackPage)
      loadInternships(intPage)
      loadCounts()
    } catch {
      toast.error('Failed to assign')
    }
  }

  const handleBulkAssign = async (teacherId: string) => {
    try {
      const token = useAuthStore.getState().token
      let assigned = 0
      for (const h of hackathons) {
        await fetch(`/api/hackathons/staging/${h.id}/assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ teacherId }),
        })
        assigned++
      }
      for (const i of internships) {
        await fetch(`/api/internships/staging/${i.id}/assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ teacherId }),
        })
        assigned++
      }
      toast.success(`Assigned teacher to ${assigned} items`)
      setShowAssignPopup(false)
      loadHackathons(hackPage)
      loadInternships(intPage)
      loadCounts()
    } catch {
      toast.error('Failed to assign')
    }
  }

  // ── Role gate ────────────────────────────────────────
  if (!isAdmin) {
    return (
    <div id="admin-opportunities-top" className="min-h-screen bg-gradient-to-br from-surface-50 via-white to-primary-50/30">
        <PageHeader title="Review Opportunities" subtitle="Access restricted" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <EmptyState icon={CheckCircle2} title="Access Denied" description="You don't have permission to view this page." />
        </div>
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-50 via-white to-primary-50/30">
      <PageHeader
        title="Review Opportunities"
        subtitle="Review and approve pending hackathons and internships"
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* ── Stats Row ─────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Pending', value: stats.total, icon: CheckCircle2, color: 'text-primary-600 bg-primary-100' },
            { label: 'Hackathons', value: stats.hackathons, icon: Trophy, color: 'text-amber-600 bg-amber-100' },
            { label: 'Internships', value: stats.internships, icon: Briefcase, color: 'text-blue-600 bg-blue-100' },
            { label: 'AI Enriched', value: stats.withDepts, icon: Sparkles, color: 'text-emerald-600 bg-emerald-100' },
          ].map((stat) => (
            <div key={stat.label} className="bg-white rounded-2xl border border-surface-100 p-4 flex items-center gap-3 shadow-sm">
              <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center', stat.color)}>
                <stat.icon size={20} />
              </div>
              <div>
                <p className="text-2xl font-bold text-surface-900">{stat.value}</p>
                <p className="text-xs text-surface-500">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Filter Bar ────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-surface-100 p-4 shadow-sm space-y-3">
          {/* Tabs */}
          <div className="flex items-center gap-2 flex-wrap">
            {(['pending', 'approved', 'rejected', 'all'] as TabKey[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={clsx(
                  'px-4 py-1.5 rounded-xl text-sm font-medium transition-all',
                  activeTab === tab
                    ? 'bg-primary-500 text-white shadow-sm'
                    : 'bg-surface-100 text-surface-600 hover:bg-surface-200'
                )}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
            <div className="flex-1" />
            <button
              onClick={() => { setIsBulkAssign(true); setShowAssignPopup(true) }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary-600 bg-primary-50 rounded-lg hover:bg-primary-100 transition-all"
            >
              <UserCheck size={12} /> Assign Teacher
            </button>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Type filter */}
            <div className="flex items-center gap-1.5">
              <Filter size={14} className="text-surface-400" />
              {(['all', 'HACKATHON', 'INTERNSHIP'] as TypeFilter[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={clsx(
                    'px-3 py-1 rounded-lg text-xs font-medium transition-all',
                    typeFilter === t
                      ? t === 'HACKATHON'
                        ? 'bg-amber-100 text-amber-700'
                        : t === 'INTERNSHIP'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-surface-800 text-white'
                      : 'bg-surface-100 text-surface-500 hover:bg-surface-200'
                  )}
                >
                  {t === 'all' ? 'All Types' : t === 'HACKATHON' ? 'Hackathons' : 'Internships'}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="flex-1 min-w-[200px] relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
              <input
                type="text"
                placeholder="Search opportunities..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-xl border border-surface-200 bg-surface-50 text-sm text-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            {/* Fetch Now - Super Admin only */}
            {isSuperAdmin && (
              <button
                onClick={handleFetchNow}
                disabled={fetchingNow}
                className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-xl text-sm font-medium hover:bg-primary-600 transition-all disabled:opacity-50 shadow-sm"
              >
                {fetchingNow ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Fetch Now
              </button>
            )}
            {/* Re-Enrich - Super Admin only */}
            {isSuperAdmin && (
              <button
                onClick={handleReEnrich}
                disabled={reEnriching}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white rounded-xl text-sm font-medium hover:bg-emerald-600 transition-all disabled:opacity-50 shadow-sm"
              >
                {reEnriching ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                Re-Enrich
              </button>
            )}
          </div>
        </div>

        {/* ── Cards List ───────────────────────────────── */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={32} className="animate-spin text-primary-500" />
          </div>
        ) : allItems.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="No opportunities found"
            description={searchQuery || typeFilter !== 'all' ? 'Try adjusting your filters' : 'No pending items to review'}
          />
        ) : (
          <div className="space-y-4">
            <AnimatePresence>
              {allItems.map((item, idx) => {
                const departments = parseJsonArray(item.targetDepartments)
                const years = parseJsonNumberArray(item.targetYears)
                const themes = parseJsonArray(item.themes)
                const isHackathon = item._type === 'HACKATHON'
                const assignedTeacher = item.assignedTeacherId
                  ? teachers.find((t: any) => t.id === item.assignedTeacherId)
                  : null
                const modeConfig = getModeConfig(item.mode)
                const ModeIcon = modeConfig.icon

                return (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ delay: idx * 0.03 }}
                    className={clsx(
                      'group bg-white rounded-2xl border shadow-sm hover:shadow-lg transition-all overflow-hidden',
                      isHackathon ? 'border-amber-100 hover:border-amber-200' : 'border-blue-100 hover:border-blue-200'
                    )}
                  >
                    {/* Top accent bar */}
                    <div className={clsx(
                      'h-1',
                      isHackathon
                        ? 'bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500'
                        : 'bg-gradient-to-r from-blue-400 via-indigo-400 to-blue-500'
                    )} />

                    <div className="p-5">
                      {/* Header row */}
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          {/* Top badges row */}
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            {/* Type badge */}
                            <span
                              className={clsx(
                                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wide',
                                isHackathon
                                  ? 'bg-amber-100 text-amber-700 border border-amber-200'
                                  : 'bg-blue-100 text-blue-700 border border-blue-200'
                              )}
                            >
                              {isHackathon ? <Trophy size={12} /> : <Briefcase size={12} />}
                              {item._type}
                            </span>

                            {/* Source badge */}
                            {item.source && (
                              <span className={clsx(
                                'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold uppercase tracking-wider',
                                getSourceColor(item.source).bg,
                                getSourceColor(item.source).text
                              )}>
                                {item.source}
                              </span>
                            )}

                            {/* Mode badge */}
                            {item.mode && (
                              <span className={clsx(
                                'inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium border',
                                modeConfig.bg,
                                modeConfig.text
                              )}>
                                <ModeIcon size={11} />
                                {modeConfig.label}
                              </span>
                            )}

                            {/* AI Enriched */}
                            {item.aiExtracted && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-600 border border-emerald-200">
                                <Sparkles size={10} /> AI Enriched
                              </span>
                            )}
                          </div>

                          {/* Title */}
                          <h3 className="text-xl font-extrabold text-surface-900 leading-tight group-hover:text-primary-700 transition-colors">
                            <a
                              href={item.url || item.registrationUrl || '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-primary-600 transition-colors"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {item.title || item.name}
                              <ExternalLink size={14} className="inline ml-1.5 opacity-50" />
                            </a>
                          </h3>

                          {/* Organizer / Company */}
                          {(item.organizer || item.company) && (
                            <p className="text-sm text-surface-500 mt-1 flex items-center gap-1.5">
                              <Building2 size={13} className="text-surface-400" />
                              <span className="font-medium text-surface-700">{item.organizer || item.company}</span>
                            </p>
                          )}

                          {/* Description */}
                          {item.description && (
                            <p className="text-sm text-surface-500 mt-2 line-clamp-2 leading-relaxed">{item.description}</p>
                          )}

                          {/* Key info row */}
                          <div className="flex items-center gap-3 mt-3 flex-wrap">
                            {/* Prize / Stipend */}
                            {(item.prizePool || item.stipend) && (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 text-amber-800 text-sm font-bold">
                                {item.prizePool || item.stipend}
                              </span>
                            )}

                            {/* Duration */}
                            {item.duration && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-50 border border-surface-200 text-surface-600 text-xs font-medium">
                                <Clock size={12} />
                                {item.duration}
                              </span>
                            )}

                            {/* Role (internship) */}
                            {item.role && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium">
                                <Briefcase size={12} />
                                {item.role}
                              </span>
                            )}

                            {/* Deadline */}
                            {item.deadline && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                                <Calendar size={12} />
                                {new Date(item.deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                              </span>
                            )}

                            {/* Assigned teacher */}
                            {assignedTeacher && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary-50 border border-primary-200 text-primary-700 text-xs font-medium">
                                <UserCheck size={12} />
                                {assignedTeacher.name}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Theme tags */}
                      {themes.length > 0 && (
                        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                          {themes.map((theme) => {
                            const tc = getThemeColor(theme)
                            const ThemeIcon = tc.icon
                            return (
                              <span
                                key={theme}
                                className={clsx(
                                  'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border',
                                  tc.bg,
                                  tc.text
                                )}
                              >
                                <ThemeIcon size={11} />
                                {theme}
                              </span>
                            )
                          })}
                        </div>
                      )}

                      {/* Department & Year badges */}
                      {(departments.length > 0 || years.length > 0) && (
                        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                          {departments.map((dept) => (
                            <span
                              key={dept}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-surface-100 text-surface-700 border border-surface-200"
                            >
                              <Target size={10} />
                              {dept}
                            </span>
                          ))}
                          {years.map((yr) => (
                            <span
                              key={yr}
                              className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-primary-50 text-primary-700 border border-primary-200"
                            >
                              Year {yr}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 mt-4 pt-3 border-t border-surface-100">
                        <button
                          onClick={() => openEdit(item, item._type)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-surface-600 bg-surface-100 rounded-lg hover:bg-surface-200 transition-all"
                        >
                          <Edit3 size={12} /> Edit
                        </button>
                        <div className="flex-1" />
                        <button
                          onClick={() => handleReject(item.id, item._type)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-all"
                        >
                          <X size={12} /> Reject
                        </button>
                        <button
                          onClick={() => handleApprove(item.id, item._type)}
                          className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 transition-all shadow-sm"
                        >
                          <CheckCircle2 size={12} /> Approve
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}

        {/* ── Pagination ────────────────────────────────── */}
        {!loading && allItems.length > 0 && (() => {
          const currentPage = typeFilter === 'INTERNSHIP' ? intPage : hackPage
          const totalPages = typeFilter === 'INTERNSHIP' ? intTotalPages : hackTotalPages
          const rawSetPage = typeFilter === 'INTERNSHIP' ? setIntPage : setHackPage
          const setPage = (p: number | ((prev: number) => number)) => {
            rawSetPage(p)
          }
          const pages: (number | string)[] = []
          if (totalPages <= 7) {
            for (let i = 1; i <= totalPages; i++) pages.push(i)
          } else {
            pages.push(1)
            if (currentPage > 3) pages.push('...')
            for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
              pages.push(i)
            }
            if (currentPage < totalPages - 2) pages.push('...')
            pages.push(totalPages)
          }
          return (
            <div className="flex items-center justify-center gap-1.5 py-4">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="px-3 py-1.5 text-sm font-medium text-surface-600 bg-surface-100 rounded-lg hover:bg-surface-200 transition-all disabled:opacity-40"
              >
                Prev
              </button>
              {pages.map((p, i) =>
                p === '...' ? (
                  <span key={`dots-${i}`} className="px-2 py-1.5 text-sm text-surface-400">...</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p as number)}
                    className={`w-9 h-9 rounded-lg text-sm font-medium transition-all ${
                      currentPage === p
                        ? 'bg-primary-500 text-white shadow-sm'
                        : 'text-surface-600 bg-surface-100 hover:bg-surface-200'
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="px-3 py-1.5 text-sm font-medium text-surface-600 bg-surface-100 rounded-lg hover:bg-surface-200 transition-all disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )
        })()}
      </div>

      {/* ── Edit Modal ────────────────────────────────── */}
      <AnimatePresence>
        {editingItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setEditingItem(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-surface-100 sticky top-0 bg-white rounded-t-2xl z-10">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-primary-100 flex items-center justify-center">
                    <Edit3 size={18} className="text-primary-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-surface-900 text-sm">Edit {editType === 'HACKATHON' ? 'Hackathon' : 'Internship'}</h3>
                    <p className="text-xs text-surface-400 truncate max-w-[220px]">{editingItem.title || editingItem.name}</p>
                  </div>
                </div>
                <button
                  onClick={() => setEditingItem(null)}
                  className="p-1.5 rounded-lg hover:bg-surface-100 text-surface-400 transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Modal body */}
              <div className="p-5 space-y-4">
                {/* Title */}
                <div>
                  <label className="block text-xs font-medium text-surface-600 mb-1">Title</label>
                  <input
                    type="text"
                    value={editingItem.title || editingItem.name || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, title: e.target.value, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-surface-200 bg-surface-50 text-sm text-surface-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-xs font-medium text-surface-600 mb-1">Description</label>
                  <textarea
                    rows={3}
                    value={editingItem.description || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-surface-200 bg-surface-50 text-sm text-surface-900 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                  />
                </div>

                {/* Mode */}
                <div>
                  <label className="block text-xs font-medium text-surface-600 mb-1">Mode</label>
                  <select
                    value={editingItem.mode || 'OFFLINE'}
                    onChange={(e) => setEditingItem({ ...editingItem, mode: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-surface-200 bg-surface-50 text-sm text-surface-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="OFFLINE">Offline</option>
                    <option value="ONLINE">Online</option>
                    <option value="HYBRID">Hybrid</option>
                  </select>
                </div>

                {editType === 'HACKATHON' ? (
                  <>
                    {/* Organizer */}
                    <div>
                      <label className="block text-xs font-medium text-surface-600 mb-1">Organizer</label>
                      <input
                        type="text"
                        value={editingItem.organizer || ''}
                        onChange={(e) => setEditingItem({ ...editingItem, organizer: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-surface-200 bg-surface-50 text-sm text-surface-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    {/* Prize Pool */}
                    <div>
                      <label className="block text-xs font-medium text-surface-600 mb-1">Prize Pool</label>
                      <input
                        type="text"
                        value={editingItem.prizePool || ''}
                        onChange={(e) => setEditingItem({ ...editingItem, prizePool: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-surface-200 bg-surface-50 text-sm text-surface-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    {/* Themes */}
                    <div>
                      <label className="block text-xs font-medium text-surface-600 mb-1">Themes</label>
                      <input
                        type="text"
                        value={editingItem.themes || ''}
                        onChange={(e) => setEditingItem({ ...editingItem, themes: e.target.value })}
                        placeholder="Comma-separated themes"
                        className="w-full px-3 py-2 rounded-xl border border-surface-200 bg-surface-50 text-sm text-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    {/* Company */}
                    <div>
                      <label className="block text-xs font-medium text-surface-600 mb-1">Company</label>
                      <input
                        type="text"
                        value={editingItem.company || ''}
                        onChange={(e) => setEditingItem({ ...editingItem, company: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-surface-200 bg-surface-50 text-sm text-surface-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    {/* Role */}
                    <div>
                      <label className="block text-xs font-medium text-surface-600 mb-1">Role</label>
                      <input
                        type="text"
                        value={editingItem.role || ''}
                        onChange={(e) => setEditingItem({ ...editingItem, role: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-surface-200 bg-surface-50 text-sm text-surface-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    {/* Stipend */}
                    <div>
                      <label className="block text-xs font-medium text-surface-600 mb-1">Stipend</label>
                      <input
                        type="text"
                        value={editingItem.stipend || ''}
                        onChange={(e) => setEditingItem({ ...editingItem, stipend: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-surface-200 bg-surface-50 text-sm text-surface-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                  </>
                )}

                {/* Duration (shared) */}
                <div>
                  <label className="block text-xs font-medium text-surface-600 mb-1">Duration</label>
                  <input
                    type="text"
                    value={editingItem.duration || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, duration: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-surface-200 bg-surface-50 text-sm text-surface-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                {/* Target Departments */}
                <div>
                  <label className="block text-xs font-medium text-surface-600 mb-1">Target Departments</label>
                  <input
                    type="text"
                    value={
                      Array.isArray(editingItem.targetDepartments)
                        ? editingItem.targetDepartments.join(', ')
                        : editingItem.targetDepartments || ''
                    }
                    onChange={(e) => setEditingItem({ ...editingItem, targetDepartments: e.target.value })}
                    placeholder="Comma-separated departments"
                    className="w-full px-3 py-2 rounded-xl border border-surface-200 bg-surface-50 text-sm text-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                {/* Target Years */}
                <div>
                  <label className="block text-xs font-medium text-surface-600 mb-1">Target Years</label>
                  <input
                    type="text"
                    value={
                      Array.isArray(editingItem.targetYears)
                        ? editingItem.targetYears.join(', ')
                        : editingItem.targetYears || ''
                    }
                    onChange={(e) => setEditingItem({ ...editingItem, targetYears: e.target.value })}
                    placeholder="Comma-separated years (e.g. 1, 2, 3, 4)"
                    className="w-full px-3 py-2 rounded-xl border border-surface-200 bg-surface-50 text-sm text-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>

              {/* Modal footer */}
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-surface-100 sticky bottom-0 bg-white rounded-b-2xl">
                <button
                  onClick={() => setEditingItem(null)}
                  className="px-4 py-2 text-sm font-medium text-surface-600 bg-surface-100 rounded-xl hover:bg-surface-200 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEditSave}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-500 rounded-xl hover:bg-primary-600 transition-all shadow-sm"
                >
                  Save Changes
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Assign Popup ──────────────────────────────── */}
      <AssignPopup
        show={showAssignPopup}
        onClose={() => { setShowAssignPopup(false); setIsBulkAssign(false) }}
        teachers={teachers}
        onAssign={isBulkAssign ? handleBulkAssign : handleAssign}
        opportunityTitle={isBulkAssign ? 'All pending items' : (assigningItem?.title || assigningItem?.name)}
        assignedToId={isBulkAssign ? null : assigningItem?.assignedTeacherId}
      />
    </div>
  )
}
