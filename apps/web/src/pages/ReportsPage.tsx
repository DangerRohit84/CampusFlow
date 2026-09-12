import { useEffect, useRef, useState } from 'react'
import { reportAPI, collegeAPI } from '../lib/api'
import { notifyEntityMutated, useEntitySync } from '../lib/entitySync'
import { useAuthStore } from '../store/authStore'
import { Flag, Building2, Globe, Bug, AlertTriangle, Zap, Shield, Lightbulb, Filter, Search, ChevronDown, Eye, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useConfirm } from '../components/ui/ConfirmModal'
import { PremiumHero, GlassPanel, BentoGrid, BentoCard, SectionCard } from '../components/premium/PremiumKit'
import clsx from 'clsx'

const ISSUE_LABEL: Record<string, string> = {
  DESIGN: 'Design', BUG: 'Bug', CRASH: 'Crash', PERFORMANCE: 'Performance', SECURITY: 'Security', FEATURE_REQUEST: 'Feature', OTHER: 'Other'
}
const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Open', IN_PROGRESS: 'In Progress', RESOLVED: 'Resolved', CLOSED: 'Closed'
}
const PRIORITY_LABEL: Record<string, string> = {
  LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', CRITICAL: 'Critical'
}

function priorityBadge(p: string) {
  if (p === 'CRITICAL') return 'bg-danger-500 dark:bg-danger-500 text-white dark:text-white border-danger-500 dark:border-danger-500'
  if (p === 'HIGH') return 'bg-orange-500 dark:bg-orange-500 text-white dark:text-white border-orange-500 dark:border-orange-500'
  if (p === 'MEDIUM') return 'bg-amber-500 dark:bg-amber-500 text-white dark:text-white border-amber-500 dark:border-amber-500'
  return 'bg-zinc-100 dark:bg-white/10 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-white/10'
}
function statusBadge(s: string) {
  if (s === 'OPEN') return 'bg-[#0a0a0a] dark:bg-white text-white dark:text-black border-black dark:border-white'
  if (s === 'IN_PROGRESS') return 'bg-primary-500 dark:bg-primary-500 text-black dark:text-black border-primary-500 dark:border-primary-500'
  if (s === 'RESOLVED') return 'bg-emerald-500 dark:bg-emerald-500 text-white dark:text-white border-emerald-500 dark:border-emerald-500'
  return 'bg-zinc-500 dark:bg-zinc-500 text-white dark:text-white border-zinc-500 dark:border-zinc-500'
}

export default function ReportsPage() {
  const { user } = useAuthStore()
  const { confirm: confirmDialog } = useConfirm()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  // For superadmin this page is not used; but keep generic so it works if routed
  const [reports, setReports] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState('ALL')
  const [status, setStatus] = useState('ALL')
  const [issueType, setIssueType] = useState('ALL')
  const [priority, setPriority] = useState('ALL')
  const [search, setSearch] = useState('')
  const [colleges, setColleges] = useState<any[]>([])
  const [collegeFilter, setCollegeFilter] = useState('ALL')
  const [selected, setSelected] = useState<any | null>(null)
  // PERPAGE-MISSED: epoch guard + AbortSignal — rapid filter switches fired
  // overlapping list GETs with last-write-wins races (CodingProfile/
  // InternshipDetail precedent). Only the latest filter generation commits;
  // the previous in-flight request is aborted. Same data when current.
  const loadSeq = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const load = async () => {
    const seq = ++loadSeq.current
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    try {
      const params: any = {}
      if (scope !== 'ALL') params.scope = scope
      if (status !== 'ALL') params.status = status
      if (issueType !== 'ALL') params.issueType = issueType
      if (priority !== 'ALL') params.priority = priority
      if (search.trim()) params.search = search.trim()
      if (isSuperAdmin && collegeFilter !== 'ALL') params.collegeId = collegeFilter
      const res = await reportAPI.list({ ...params, signal: ctrl.signal } as any)
      if (seq !== loadSeq.current) return
      const data = Array.isArray(res) ? res : res.data || []
      setReports(data)
    } catch (e: any) {
      if (seq !== loadSeq.current) return
      // Aborted superseded generations are silent (a newer filter already loading).
      if (ctrl.signal.aborted) return
      toast.error(e?.response?.data?.error || 'Failed to load reports')
    } finally { if (seq === loadSeq.current) setLoading(false) }
  }

  // STATE-SYNC: external mutations (other tab/device) refresh without reload.
  useEntitySync('report', load as any)

  useEffect(() => { load() }, [scope, status, issueType, priority, collegeFilter])
  useEffect(() => {
    if (isSuperAdmin) {
      collegeAPI.getPublicList().then((list: any) => setColleges(Array.isArray(list) ? list : list?.data || [])).catch(() => {})
    }
  }, [isSuperAdmin])

  const handleSearch = () => load()
  const handleDeleteReport = async (id: string) => {
    const ok = await confirmDialog({ title: 'Delete report?', message: 'Delete this report? This cannot be undone.', confirmLabel: 'Delete' })
    if (!ok) return
    // PERPAGE-MISSED: notify-only (was bare load()). The useEntitySync('report')
    // listener above owns the single reload, and notify busts RQ lists
    // (super-dashboard/dashboard) so counts stay fresh cross-page.
    try { await reportAPI.delete(id); toast.success('Deleted'); notifyEntityMutated('report', { id } as any) } catch (e: any) { toast.error(e?.response?.data?.error || 'Failed') }
  }

  const handleStatusChange = async (id: string, newStatus: string) => {    try {
      await reportAPI.updateStatus(id, newStatus)
      toast.success('Status updated')
      // PERPAGE-MISSED: notify-only (was bare load()) — same single-path
      // rationale as delete above; listener reloads the list once.
      notifyEntityMutated('report', { id } as any)
      if (selected?.id === id) setSelected((prev: any) => prev ? { ...prev, status: newStatus } : prev)
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Failed to update status') }
  }

  const canManage = user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'

  const openCount = reports.filter(r => r.status === 'OPEN').length
  const inProgCount = reports.filter(r => r.status === 'IN_PROGRESS').length
  const resolvedCount = reports.filter(r => r.status === 'RESOLVED').length

  return (
    <div className="space-y-6 max-w-[1280px] mx-auto">
      <h1 className="sr-only">{isSuperAdmin ? 'Platform Reports — Triage all tenants' : 'College Reports — Issues tracked to resolution'}</h1>
      <PremiumHero
        icon={<Flag size={18} />}
        eyebrow={`${isSuperAdmin ? 'Super Admin · Reports' : 'College · Reports'} · ${reports.length} total`}
        title={<span className="text-balance">{isSuperAdmin ? 'Platform Reports' : 'College Reports'}</span>}
        subtitle={isSuperAdmin ? 'Website + college-scoped reports across all tenants — triage by status, priority, and college.' : 'Reports from your college — design, bug, crash, performance, security, feature requests. Website-scoped reports from your students are also visible here.'}
        actions={
          <>
            <span className="inline-flex items-center gap-1.5 px-3 h-9 rounded-full bg-white dark:bg-white text-black dark:text-black text-xs font-black border border-white dark:border-white shadow-sm">College-scoped</span>
            <span className="inline-flex items-center gap-1.5 px-3 h-9 rounded-full bg-white/10 dark:bg-white/10 backdrop-blur border border-white/15 dark:border-white/15 text-white dark:text-white text-xs font-bold">{openCount} Open · {inProgCount} In Progress</span>
          </>
        }
        stats={
          <GlassPanel className="p-3">
            <p className="text-[10px] font-black tracking-[0.12em] uppercase text-white/60 dark:text-white/60">Reports Pulse</p>
            {/* Pulse — selectable filter: selected = bg-primary-500 dark:bg-primary-500 text-black dark:text-black (green, no whitener), unselected = bg-white dark:bg-[#121212] with zinc-900 dark:text-white contrast */}
            <div className="mt-2.5 grid grid-cols-3 gap-1.5">
              <button onClick={() => setStatus('ALL')} className={clsx('rounded-xl p-2.5 text-center border transition-all active:scale-[0.98] hover:-translate-y-0.5', status === 'ALL' ? 'bg-primary-500 dark:bg-primary-500 border-primary-500 dark:border-primary-500 shadow-[0_6px_16px_rgba(30,215,96,0.22)]' : 'bg-white dark:bg-[#121212] border-white/10 dark:border-white/10')}>
                <p className={clsx('font-display text-[18px] font-[800] leading-none', status === 'ALL' ? 'text-black dark:text-black' : 'text-zinc-900 dark:text-white')}>{reports.length}</p>
                <p className={clsx('text-[10px] font-black tracking-widest uppercase mt-1', status === 'ALL' ? 'text-black/60 dark:text-black/60' : 'text-zinc-500 dark:text-white/60')}>Total</p>
              </button>
              <button onClick={() => setStatus('OPEN')} className={clsx('rounded-xl p-2.5 text-center border transition-all active:scale-[0.98] hover:-translate-y-0.5', status === 'OPEN' ? 'bg-primary-500 dark:bg-primary-500 border-primary-500 dark:border-primary-500 shadow-[0_6px_16px_rgba(30,215,96,0.22)]' : 'bg-white dark:bg-[#121212] border-white/10 dark:border-white/10')}>
                <p className={clsx('font-display text-[18px] font-[800] leading-none', status === 'OPEN' ? 'text-black dark:text-black' : 'text-zinc-900 dark:text-white')}>{openCount}</p>
                <p className={clsx('text-[10px] font-black tracking-widest uppercase mt-1', status === 'OPEN' ? 'text-black/60 dark:text-black/60' : 'text-zinc-500 dark:text-white/60')}>Open</p>
              </button>
              <button onClick={() => setStatus('RESOLVED')} className={clsx('rounded-xl p-2.5 text-center border transition-all active:scale-[0.98] hover:-translate-y-0.5', status === 'RESOLVED' ? 'bg-primary-500 dark:bg-primary-500 border-primary-500 dark:border-primary-500 shadow-[0_6px_16px_rgba(30,215,96,0.22)]' : 'bg-white dark:bg-[#121212] border-white/10 dark:border-white/10')}>
                <p className={clsx('font-display text-[18px] font-[800] leading-none', status === 'RESOLVED' ? 'text-black dark:text-black' : 'text-zinc-900 dark:text-white')}>{resolvedCount}</p>
                <p className={clsx('text-[10px] font-black tracking-widest uppercase mt-1', status === 'RESOLVED' ? 'text-black/60 dark:text-black/60' : 'text-zinc-500 dark:text-white/60')}>Resolved</p>
              </button>
            </div>
            <p className="mt-2.5 text-[11px] font-medium text-white/60 dark:text-white/60">Best practice: Acknowledge in 24h · Resolve critical in 72h · Link fix commit in description. Tap a pulse to filter.</p>
          </GlassPanel>
        }
      />

      <SectionCard title="Filters & Triage" subtitle={`${reports.length} reports · Filter by scope, status, issue, priority`} icon={<Filter size={16} />} gradient="from-primary-500 via-primary-500 to-emerald-500">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 dark:text-night-400" />
            <input value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=> e.key==='Enter' && handleSearch()} placeholder="Search title, description..." className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-surface-200 dark:border-white/10 bg-surface-50 dark:bg-[#0a0a0a] text-sm text-surface-900 dark:text-white placeholder:text-[#6b7280] dark:placeholder:text-night-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 dark:focus:border-primary-500/40" />
          </div>
          <button onClick={handleSearch} className="px-5 h-11 rounded-full bg-[#0a0a0a] dark:bg-white text-white dark:text-black text-sm font-black hover:bg-black dark:hover:bg-zinc-100 transition-colors shadow-sm">Search</button>
          {(search || scope!=='ALL' || status!=='ALL' || issueType!=='ALL' || priority!=='ALL' || collegeFilter!=='ALL') && (
            <button onClick={()=>{setSearch(''); setScope('ALL'); setStatus('ALL'); setIssueType('ALL'); setPriority('ALL'); setCollegeFilter('ALL')}} className="text-xs font-bold text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 underline">Clear</button>
          )}
        </div>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <select value={scope} onChange={e=>setScope(e.target.value)} className="px-3 py-2.5 rounded-xl border border-surface-200 dark:border-white/10 bg-white dark:bg-[#0a0a0a] text-sm text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500/30">
            <option value="ALL">All scopes</option>
            <option value="COLLEGE">College</option>
            <option value="WEBSITE">Website</option>
          </select>
          <select value={status} onChange={e=>setStatus(e.target.value)} className="px-3 py-2.5 rounded-xl border border-surface-200 dark:border-white/10 bg-white dark:bg-[#0a0a0a] text-sm text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500/30">
            <option value="ALL">All statuses</option>
            <option value="OPEN">Open</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="RESOLVED">Resolved</option>
            <option value="CLOSED">Closed</option>
          </select>
          <select value={issueType} onChange={e=>setIssueType(e.target.value)} className="px-3 py-2.5 rounded-xl border border-surface-200 dark:border-white/10 bg-white dark:bg-[#0a0a0a] text-sm text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500/30">
            <option value="ALL">All issues</option>
            <option value="DESIGN">Design</option>
            <option value="BUG">Bug</option>
            <option value="CRASH">Crash</option>
            <option value="PERFORMANCE">Performance</option>
            <option value="SECURITY">Security</option>
            <option value="FEATURE_REQUEST">Feature Request</option>
            <option value="OTHER">Other</option>
          </select>
          <select value={priority} onChange={e=>setPriority(e.target.value)} className="px-3 py-2.5 rounded-xl border border-surface-200 dark:border-white/10 bg-white dark:bg-[#0a0a0a] text-sm text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500/30">
            <option value="ALL">All priorities</option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="CRITICAL">Critical</option>
          </select>
          {isSuperAdmin && (
            <select value={collegeFilter} onChange={e=>setCollegeFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-surface-200 dark:border-white/10 bg-white dark:bg-[#0a0a0a] text-sm text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500/30 col-span-2 md:col-span-1">
              <option value="ALL">All colleges</option>
              {colleges.map((c:any)=> <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>
      </SectionCard>

      <BentoGrid>
        <div className="col-span-12">
          <SectionCard title="Reports" subtitle={`${reports.length} items · Click eye to view detail · Status badge shows workflow`} icon={<Flag size={16} />} gradient="from-primary-500 via-emerald-500 to-primary-600">
            {loading ? (
              <div className="py-12 text-center text-sm text-surface-500 dark:text-night-400">Loading reports...</div>
            ) : reports.length === 0 ? (
              <div className="text-center py-14 rounded-xl bg-surface-50 dark:bg-white/[0.02] border border-dashed border-surface-200 dark:border-white/10">
                <Flag size={32} className="mx-auto text-surface-300 dark:text-zinc-600 mb-3" />
                <p className="font-display font-[700] text-surface-600 dark:text-night-300">No reports yet</p>
                <p className="text-xs font-medium text-surface-400 dark:text-night-400 mt-1">When users report college or website issues, they appear here for triage.</p>
              </div>
            ) : (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-surface-100 dark:border-white/10">
                      <th className="text-left py-3 px-2 text-[11px] font-black tracking-widest uppercase text-surface-500 dark:text-night-400">Date</th>
                      <th className="text-left py-3 px-2 text-[11px] font-black tracking-widest uppercase text-surface-500 dark:text-night-400">Scope</th>
                      <th className="text-left py-3 px-2 text-[11px] font-black tracking-widest uppercase text-surface-500 dark:text-night-400">Issue</th>
                      <th className="text-left py-3 px-2 text-[11px] font-black tracking-widest uppercase text-surface-500 dark:text-night-400">Title</th>
                      <th className="text-left py-3 px-2 text-[11px] font-black tracking-widest uppercase text-surface-500 dark:text-night-400">Priority</th>
                      <th className="text-left py-3 px-2 text-[11px] font-black tracking-widest uppercase text-surface-500 dark:text-night-400">Status</th>
                      <th className="text-left py-3 px-2 text-[11px] font-black tracking-widest uppercase text-surface-500 dark:text-night-400">Reporter</th>
                      <th className="text-right py-3 px-2 text-[11px] font-black tracking-widest uppercase text-surface-500 dark:text-night-400">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((r:any)=> (
                      <tr key={r.id} className="border-b border-surface-50 dark:border-white/5 hover:bg-surface-50 dark:hover:bg-white/[0.03] transition-colors">
                        <td className="py-3 px-2 whitespace-nowrap text-xs font-medium text-surface-500 dark:text-night-400">{new Date(r.createdAt).toLocaleDateString('en-IN', { day:'2-digit', month:'short' })} <span className="text-[11px] opacity-70 dark:opacity-60">{new Date(r.createdAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}</span></td>
                        <td className="py-3 px-2">
                          <span className={clsx('inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black border', r.scope==='COLLEGE' ? 'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 border-primary-200 dark:border-primary-500/20' : 'bg-[#0a0a0a] dark:bg-white text-white dark:text-black border-black dark:border-white')}>
                            {r.scope==='COLLEGE' ? <Building2 size={11}/> : <Globe size={11}/>} {r.scope}
                          </span>
                        </td>
                        <td className="py-3 px-2"><span className="px-2.5 py-1 rounded-full text-xs font-bold bg-surface-100 dark:bg-white/10 border border-surface-200 dark:border-white/10 text-surface-700 dark:text-night-200">{ISSUE_LABEL[r.issueType] || r.issueType}</span></td>
                        <td className="py-3 px-2 max-w-[260px]">
                          <p className="font-semibold text-surface-900 dark:text-white truncate" title={r.title}>{r.title}</p>
                          <p className="text-xs text-surface-500 dark:text-night-400 truncate max-w-[260px]" title={r.description}>{r.description.slice(0,80)}</p>
                          {r.college?.name && <p className="text-[11px] font-medium text-surface-400 dark:text-night-400 truncate">{r.college.name}</p>}
                        </td>
                        <td className="py-3 px-2"><span className={clsx('px-2.5 py-1 rounded-full text-xs font-black border', priorityBadge(r.priority))}>{PRIORITY_LABEL[r.priority] || r.priority}</span></td>
                        <td className="py-3 px-2">
                          {canManage ? (
                            <select value={r.status} onChange={e=>handleStatusChange(r.id, e.target.value)} className={clsx('px-2.5 py-1.5 rounded-full text-xs font-black border focus:outline-none focus:ring-2 focus:ring-primary-500/20', statusBadge(r.status))}>
                              <option value="OPEN">Open</option>
                              <option value="IN_PROGRESS">In Progress</option>
                              <option value="RESOLVED">Resolved</option>
                              <option value="CLOSED">Closed</option>
                            </select>
                          ) : (
                            <span className={clsx('px-2.5 py-1 rounded-full text-xs font-black border', statusBadge(r.status))}>{STATUS_LABEL[r.status] || r.status}</span>
                          )}
                        </td>
                        <td className="py-3 px-2">
                          <p className="text-xs font-semibold text-surface-900 dark:text-white truncate max-w-[140px]">{r.user?.name}</p>
                          <p className="text-[11px] text-surface-500 dark:text-night-400 truncate max-w-[140px]">{r.user?.email}</p>
                        </td>
                        <td className="py-3 px-2">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={()=>setSelected(r)} aria-label={`View report ${r.title || r.id}`} className="min-w-[44px] min-h-[44px] rounded-full bg-surface-50 dark:bg-white/5 hover:bg-surface-100 dark:hover:bg-white/10 inline-flex items-center justify-center text-surface-600 dark:text-night-300 hover:text-surface-900 dark:hover:text-white transition-colors" title="View">
                              <Eye size={14} />
                            </button>
                            {canManage && (
                              <button onClick={() => handleDeleteReport(r.id)} aria-label={`Delete report ${r.title || r.id}`} className="min-w-[44px] min-h-[44px] rounded-full bg-surface-50 dark:bg-white/5 hover:bg-danger-50 dark:hover:bg-danger-500/15 inline-flex items-center justify-center text-surface-500 dark:text-night-400 hover:text-danger-600 dark:hover:text-danger-400 transition-colors" title="Delete">
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      </BentoGrid>

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 dark:bg-black/60 backdrop-blur-sm" onClick={()=>setSelected(null)} />
          <div className="relative w-full max-w-[680px] max-h-[92vh] overflow-hidden rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] shadow-xl flex flex-col">
            <div className="px-6 py-5 border-b border-surface-100 dark:border-white/10 shrink-0">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={clsx('px-2.5 py-1 rounded-full text-xs font-black border', selected.scope==='COLLEGE' ? 'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 border-primary-200 dark:border-primary-500/20' : 'bg-[#0a0a0a] dark:bg-white text-white dark:text-black border-black dark:border-white')}>{selected.scope}</span>
                    <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-surface-100 dark:bg-white/10 border border-surface-200 dark:border-white/10 text-surface-700 dark:text-night-200">{ISSUE_LABEL[selected.issueType]}</span>
                    <span className={clsx('px-2.5 py-1 rounded-full text-xs font-black border', priorityBadge(selected.priority))}>{selected.priority}</span>
                    <span className={clsx('px-2.5 py-1 rounded-full text-xs font-black border', statusBadge(selected.status))}>{selected.status}</span>
                  </div>
                  <h3 className="mt-3 font-display text-lg font-[800] tracking-[-0.02em] leading-tight text-surface-900 dark:text-white">{selected.title}</h3>
                  <p className="text-xs font-medium text-surface-500 dark:text-night-400 mt-1">Reported {new Date(selected.createdAt).toLocaleString()} · by {selected.user?.name} ({selected.user?.email}) {selected.college?.name ? `· ${selected.college.name}` : selected.collegeName ? `· ${selected.collegeName}` : ''}</p>
                </div>
                <button onClick={()=>setSelected(null)} className="w-9 h-9 rounded-full bg-surface-50 dark:bg-white/10 flex items-center justify-center text-surface-700 dark:text-night-200 hover:bg-surface-100 dark:hover:bg-white/15 transition-colors">✕</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div className="p-4 rounded-xl bg-surface-50 dark:bg-white/[0.04] border border-surface-100 dark:border-white/10">
                <p className="text-[11px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400">Description</p>
                <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-surface-700 dark:text-night-200">{selected.description}</p>
              </div>
              {selected.attachmentUrl && (
                <div className="p-4 rounded-xl bg-primary-50/50 dark:bg-primary-500/5 border border-primary-100 dark:border-primary-500/20">
                  <p className="text-[11px] font-black tracking-widest uppercase text-primary-700 dark:text-primary-300">Attachment</p>
                  <a href={selected.attachmentUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 underline break-all">{selected.attachmentUrl}</a>
                </div>
              )}
              {canManage && (
                <div className="p-4 rounded-xl bg-amber-50/50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20">
                  <p className="text-[11px] font-black tracking-widest uppercase text-amber-700 dark:text-amber-300">Triage — Update Status</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(['OPEN','IN_PROGRESS','RESOLVED','CLOSED'] as const).map(s=> (
                      <button key={s} onClick={()=>handleStatusChange(selected.id, s)} className={clsx('px-4 h-9 rounded-full text-xs font-black border transition-colors', selected.status===s ? statusBadge(s)+' ring-1 ring-black/10 dark:ring-white/10' : 'bg-white dark:bg-white/5 border-surface-200 dark:border-white/10 text-surface-700 dark:text-night-300 hover:bg-surface-50 dark:hover:bg-white/10')}>{STATUS_LABEL[s]}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-surface-100 dark:border-white/10 bg-surface-50/50 dark:bg-white/[0.02] flex justify-end shrink-0">
              <button onClick={()=>setSelected(null)} className="px-5 h-10 rounded-full bg-[#0a0a0a] dark:bg-white text-white dark:text-black text-sm font-black hover:bg-black dark:hover:bg-zinc-100 transition-colors">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
