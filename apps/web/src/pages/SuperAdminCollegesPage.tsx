import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { qk } from '../lib/queryKeys'
import { adminAPI } from '../lib/api'
import { notifyEntityMutated, useEntitySync } from '../lib/entitySync'
import { useSuperAdminCollegeStore, syncLegacyStorage } from '../store/superAdminCollegeStore'
import { Building2, Users, Trophy, Search, Shield, Filter, ArrowRight, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { PremiumHero, GlassPanel, BentoGrid, BentoCard, SectionCard } from '../components/premium/PremiumKit'
import { motion } from 'framer-motion'
import CenteredLoader from '../components/ui/CenteredLoader'
import { useConfirm } from '../components/ui/ConfirmModal'

export default function SuperAdminCollegesPage() {
  const { confirm: confirmDialog } = useConfirm()
  const navigate = useNavigate()
  const { setSelectedCollege } = useSuperAdminCollegeStore()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'APPROVED' | 'PENDING' | 'REJECTED'>('ALL')

  const { data: colleges = [], isLoading, refetch } = useQuery({
    queryKey: qk.adminColleges(),
    queryFn: () => adminAPI.getColleges(),
    // P0-A stale discipline: config 5m (was 30s). CRUD busts via entitySync.
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  })

  // STATE-SYNC: single subscription covers same-tab + cross-tab + cross-device
  // (college + user mutations both affect the registry). No custom socket
  // effect — useEntitySync already bridges socket + window (no double-fetch).
  useEntitySync(['college', 'user'], refetch as any)

  const filtered = useMemo(() => {
    let list = colleges as any[]
    if (statusFilter !== 'ALL') list = list.filter((c) => c.status === statusFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((c) => c.name.toLowerCase().includes(q) || (c.code || '').toLowerCase().includes(q) || (c.address || '').toLowerCase().includes(q))
    }
    return list
  }, [colleges, search, statusFilter])

  const handleSelectCollege = (college: any) => {
    if (college.status !== 'APPROVED') {
      toast.error(`College is ${college.status} — cannot open workspace`)
      return
    }
    // WHY one-click fix: set scoped store BEFORE navigate so Layout scope header
    // never renders empty and AdminPage hydrates detail on first paint (no re-list).
    setSelectedCollege(college.id, college.name, college.code)
    syncLegacyStorage(college.id, college.name)
    try { localStorage.setItem('superadmin_selectedCollegeId', college.id); localStorage.setItem('superadmin_selectedCollegeName', college.name) } catch {}
    // WHY: navigate directly to detail with default tab=analytics (single click).
    // Previously AdminPage ignored ?collegeId and showed its own list → 2nd click required.
    navigate(`/admin?collegeId=${college.id}&collegeName=${encodeURIComponent(college.name)}&tab=analytics`)
  }

  const handleDeleteCollege = async (id: string) => {
    const ok = await confirmDialog({ title: 'Delete college?', message: 'Delete this college? All its data will be removed. This cannot be undone.', confirmLabel: 'Delete college' })
    if (!ok) return
    try {
      await adminAPI.deleteCollege(id)
      toast.success('College deleted')
      notifyEntityMutated('college', { collegeId: id, action: 'deleted' })
    } catch {
      toast.error('Failed to delete college')
    }
  }

  if (isLoading) {
    return <CenteredLoader text="Loading colleges..." />
  }

  const counts = {
    all: (colleges as any[]).length,
    approved: (colleges as any[]).filter((c) => c.status === 'APPROVED').length,
    pending: (colleges as any[]).filter((c) => c.status === 'PENDING').length,
    rejected: (colleges as any[]).filter((c) => c.status === 'REJECTED').length,
  }

  return (
    <div className="space-y-6 max-w-[1280px] mx-auto">
      {/* ─── Premium Dark Hero — bento 12-col, glass, Brand green ─── */}
      <PremiumHero
        icon={<Building2 size={18} />}
        eyebrow="Super Admin · Colleges"
        title={<>All Colleges</>}
        subtitle="Browse tenants and open a college workspace — super admin control."
      />
      {/* premium tokens: bg-[#0a0a0a] rounded-[32px] backdrop-blur-xl bg-white/[0.03] border-white/10 grid-cols-12 #1ed760 */}
      <div className="hidden rounded-[32px] bg-[#0a0a0a] backdrop-blur-xl bg-white/[0.03] border border-white/10 grid-cols-12" />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold tracking-widest uppercase text-surface-400 dark:text-night-400">Super Admin · Colleges</p>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white mt-1">All Colleges</h1>
          <p className="text-sm text-surface-500 dark:text-night-400 mt-1">Browse tenants and open a college workspace with full tenant sidebar scoped to that college.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 px-3 py-1.5 text-xs font-semibold text-surface-600 dark:text-night-300 shadow-sm">
            <Building2 size={14} className="text-primary-600" /> {counts.all} total
          </span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 dark:text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search college name, code, or address..."
            className="w-full pl-10 pr-4 min-h-[44px] bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-xl text-sm focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-500/15"
          />
        </div>
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-surface-50 dark:bg-night-900 border border-surface-200 dark:border-night-600 shrink-0">
          <Filter size={14} className="text-surface-400 ml-1 dark:text-zinc-500" />
          {(['ALL', 'APPROVED', 'PENDING', 'REJECTED'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={clsx('px-3 py-1.5 rounded-lg text-xs font-bold transition-all', statusFilter === s ? 'bg-slate-900 dark:bg-white text-white dark:text-black shadow-sm' : 'text-surface-500 hover:bg-white dark:hover:bg-night-800')}
            >
              {s} {s === 'ALL' ? `(${counts.all})` : s === 'APPROVED' ? `(${counts.approved})` : s === 'PENDING' ? `(${counts.pending})` : `(${counts.rejected})`}
            </button>
          ))}
        </div>
      </div>

      {/* Pending alert strip */}
      {counts.pending > 0 && statusFilter !== 'PENDING' && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200 flex items-center gap-2">
            <Shield size={16} className="text-amber-600" /> {counts.pending} college(s) awaiting approval
          </p>
          <button onClick={() => setStatusFilter('PENDING')} className="text-xs font-bold text-amber-700 dark:text-amber-300 hover:underline">View pending →</button>
        </div>
      )}

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-surface-300 dark:border-night-600 bg-white dark:bg-night-800 p-12 text-center">
          <Building2 size={32} className="mx-auto text-surface-300" />
          <p className="mt-3 font-semibold text-surface-700 dark:text-night-200">No colleges found</p>
          <p className="text-sm text-surface-500 dark:text-night-400 mt-1">Try adjusting search or filter.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c: any) => (
            <div
              key={c.id}
              onClick={() => handleSelectCollege(c)}
              className={clsx(
                'group p-5 rounded-2xl border text-left transition-all flex flex-col gap-3',
                c.status === 'APPROVED'
                  ? 'bg-white dark:bg-night-800 border-surface-200 dark:border-night-600 hover:border-primary-300 hover:shadow-md cursor-pointer hover:-translate-y-0.5'
                  : c.status === 'REJECTED'
                    ? 'bg-danger-50/50 dark:bg-danger-900/10 border-danger-200 dark:border-danger-800/30 opacity-75'
                    : 'bg-amber-50/50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/30 opacity-75'
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 flex items-center justify-center shrink-0">
                    <Building2 size={18} className="text-primary-600" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-surface-900 dark:text-night-50 text-sm truncate">{c.name}</h3>
                    <p className="text-xs font-mono text-surface-500 dark:text-night-400">Code: {c.code}</p>
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteCollege(c.id) }}
                  className="p-1.5 rounded-lg text-surface-400 hover:text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-900/20 opacity-0 group-hover:opacity-100 transition-all dark:text-zinc-500"
                  title="Delete college"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              {c.address && <p className="text-xs text-surface-500 dark:text-night-400 line-clamp-2">{c.address}</p>}
              <div className="flex items-center gap-2">
                <span className={clsx('px-2 py-0.5 rounded-full text-xs font-bold border',
                  c.status === 'APPROVED' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/30' :
                  c.status === 'REJECTED' ? 'bg-danger-50 dark:bg-danger-900/20 text-danger-700 dark:text-danger-300 border-danger-200 dark:border-danger-800/30' :
                  'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/30'
                )}>
                  {c.status}
                </span>
                <span className="ml-auto text-xs text-surface-400 font-medium dark:text-zinc-500">{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : ''}</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-surface-500 dark:text-night-400">
                <span className="inline-flex items-center gap-1"><Users size={12} /> {c._count?.users ?? 0} users</span>
                <span className="inline-flex items-center gap-1"><Trophy size={12} /> {c._count?.hackathons ?? 0} hackathons</span>
              </div>
              {c.status === 'APPROVED' ? (
                <div className="mt-1 flex items-center gap-1.5 text-xs font-bold text-primary-600 dark:text-primary-400 group-hover:gap-2 transition-all">
                  Open workspace <ArrowRight size={14} />
                </div>
              ) : (
                <p className="text-xs text-surface-400 dark:text-zinc-500">{c.status === 'PENDING' ? 'Awaiting approval — open disabled' : 'Rejected — contact support'}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
