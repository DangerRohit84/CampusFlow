import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Plus, Search, FileText} from 'lucide-react'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { assignmentHubAPI } from '../lib/api'
import { notifyEntityMutated } from '../lib/entitySync'
import { useAuthStore } from '../store/authStore'
import { useDebounce } from '../hooks/useDebounce'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { qk } from '../lib/queryKeys'
import { useCollegeScope } from '../hooks/useCollegeScope'
import {
  normalizeAssignmentStatus,
  getStoredAssignmentStatus,
  setStoredAssignmentStatus,
  type AssignmentStatusFilter,
} from '../lib/assignmentStatus'
import CreateAssignmentModal from '../components/assignments/CreateAssignmentModal'
import AssignmentHubCard from '../components/assignments/AssignmentHubCard'
import SubmissionPanel from '../components/assignments/SubmissionPanel'
import StatsPanel from '../components/assignments/StatsPanel'
import GradeModal from '../components/assignments/GradeModal'
import Modal from '../components/ui/Modal'
import Pagination from '../components/shared/Pagination'
import EmptyState from '../components/shared/EmptyState'
import toast from 'react-hot-toast'
import CenteredLoader from '../components/ui/CenteredLoader'
import { useConfirm } from '../components/ui/ConfirmModal'

export default function AssignmentHubPage() {
  const { confirm: confirmDialog } = useConfirm()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const user = useAuthStore(s=> s.user)
  const isTeacher = user?.role==='TEACHER' || user?.role==='COLLEGE_ADMIN' || user?.role==='SUPER_ADMIN'
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [filterScope, setFilterScope] = useState('ALL')
  const [filterMode, setFilterMode] = useState('ALL')
  // WHY: default Active on open — URL ?status takes precedence, then localStorage, else active.
  const [statusFilter, setStatusFilter] = useState<AssignmentStatusFilter>(() => {
    const urlRaw = searchParams.get('status')
    if (urlRaw && urlRaw.trim().toLowerCase() === normalizeAssignmentStatus(urlRaw)) return normalizeAssignmentStatus(urlRaw)
    return getStoredAssignmentStatus() ?? 'active'
  })
  const [page, setPage] = useState(1)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [detail, setDetail] = useState<any>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [submissions, setSubmissions] = useState<any[]>([])
  const [stats, setStats] = useState<any>(null)
  const [grading, setGrading] = useState<any>(null)

  // TAB-NOREFRESH: reactive college scope feeds the stable query key so every
  // tab/filter/page has its own cache slice (qk.assignmentHubs factory).
  // Switching All/Active/Completed only swaps keys — TanStack serves the cached
  // slice instantly (placeholderData) and revalidates in background after
  // staleTime. No useEffect fetch on tab state, no remount, no full loader.
  const collegeScope = useCollegeScope()
  const queryClient = useQueryClient()
  const hubsKey = qk.assignmentHubs({
    page,
    search: debouncedSearch || '',
    scope: filterScope,
    mode: filterMode,
    status: statusFilter,
    collegeId: collegeScope,
  })

  const {
    data: hubsData,
    isLoading,
    isFetching,
    isPlaceholderData,
  } = useQuery({
    queryKey: hubsKey,
    queryFn: ({ signal }) =>
      // WHY: omit status=all (no param = all, backward compat); active/completed filter server-side.
      // signal cancels stale tab/page switches (no out-of-order overwrite).
      assignmentHubAPI.getHubs({
        page,
        limit: 20,
        search: debouncedSearch || undefined,
        scope: filterScope !== 'ALL' ? filterScope : undefined,
        submissionMode: filterMode !== 'ALL' ? filterMode : undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        signal,
      } as any),
    // Lists: stale 60s (within 30s-2min window) + gc 5min. Focus refetch OFF —
    // browser tab switches must never reload the list; background revalidate
    // only after staleTime. Mutations bust via notifyEntityMutated prefix.
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    retry: 1,
  })
  const hubs: any[] = (hubsData as any)?.data ?? []
  const pagination = (hubsData as any)?.pagination ?? { page: 1, limit: 20, total: 0, pages: 1 }
  // keepPreviousData: isLoading is false when a cached slice exists → cached
  // list stays visible while the new tab revalidates (no spinner flash).
  const loading = isLoading && !isPlaceholderData && hubs.length === 0
  const refreshing = isFetching && !isLoading

  // Prefetch adjacent status tab on hover/focus (Vercel instant-nav): warms the
  // other slice's cache so hover→click renders instantly even when cold.
  const prefetchStatus = (s: AssignmentStatusFilter) => {
    if (s === statusFilter) return
    try {
      void queryClient.prefetchQuery({
        queryKey: qk.assignmentHubs({
          page: 1,
          search: debouncedSearch || '',
          scope: filterScope,
          mode: filterMode,
          status: s,
          collegeId: collegeScope,
        }),
        queryFn: ({ signal }) =>
          assignmentHubAPI.getHubs({
            page: 1,
            limit: 20,
            search: debouncedSearch || undefined,
            scope: filterScope !== 'ALL' ? filterScope : undefined,
            submissionMode: filterMode !== 'ALL' ? filterMode : undefined,
            status: s !== 'all' ? s : undefined,
            signal,
          } as any),
        staleTime: 60 * 1000,
      })
    } catch {}
  }

  const prefetchPage = (p: number) => {
    if (p === page) return
    try {
      void queryClient.prefetchQuery({
        queryKey: qk.assignmentHubs({
          page: p,
          search: debouncedSearch || '',
          scope: filterScope,
          mode: filterMode,
          status: statusFilter,
          collegeId: collegeScope,
        }),
        queryFn: ({ signal }) =>
          assignmentHubAPI.getHubs({
            page: p,
            limit: 20,
            search: debouncedSearch || undefined,
            scope: filterScope !== 'ALL' ? filterScope : undefined,
            submissionMode: filterMode !== 'ALL' ? filterMode : undefined,
            status: statusFilter !== 'all' ? statusFilter : undefined,
            signal,
          } as any),
        staleTime: 60 * 1000,
      })
    } catch {}
  }

  // Persist status tab to URL (?status=active) + localStorage on change/open.
  useEffect(() => {
    setStoredAssignmentStatus(statusFilter)
    const current = searchParams.get('status')?.toLowerCase()
    if (current !== statusFilter) {
      const next = new URLSearchParams(searchParams)
      next.set('status', statusFilter)
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  useEffect(()=>{ setPage(1) }, [debouncedSearch, filterScope, filterMode, statusFilter])

  // STATE-SYNC: no manual useEntitySync subscription — TanStack prefix
  // invalidation owns freshness. notifyEntityMutated('assignment') busts
  // ['assignmentHubs'] (+ dashboard/search/tasks) so creates/edits/grades from
  // any tab/device refetch automatically without a focus listener or reload.

  const handleClearFilters = () => {
    setSearch('')
    setFilterScope('ALL')
    setFilterMode('ALL')
    setStatusFilter('all')
    setPage(1)
  }

  const openDetail = async (hub:any)=> {
    setDetailLoading(true)
    setDetail(hub) // optimistically show title while fetching
    try {
      // PERPAGE-HALF1: single parallel round — was waterfall (await getHub,
      // THEN await subs+stats = 2 sequential rounds). hub.id is already known
      // from the list row, so all three fire together. Same setState outcome.
      const [full, subs, st] = await Promise.all([
        assignmentHubAPI.getHub(hub.id),
        isTeacher ? assignmentHubAPI.listSubmissions(hub.id) : Promise.resolve({ data: [] } as any),
        isTeacher ? assignmentHubAPI.stats(hub.id).catch(()=> null) : Promise.resolve(null),
      ])
      setDetail(full)
      if(isTeacher) {
        setSubmissions((subs as any).data||subs); setStats(st)
      } else {
        setSubmissions([]); setStats(null)
      }
    } catch(e){ console.error(e); toast.error('Failed to load assignment') } finally{ setDetailLoading(false) }
  }

  // called after student submit success — auto-close popup and refresh list
  const handleSubmitted = async () => {
    toast.success('Submitted successfully')
    // close detail modal/panel immediately on success
    setDetail(null)
    setSubmissions([])
    setStats(null)
    // Central truth: RQ prefix + window event so dashboard/counts/search update.
    // No manual load() — invalidation refetches the active slice in background.
    notifyEntityMutated('assignment', { action: 'submitted' })
  }

  const handleSaved = async () => {
    notifyEntityMutated('assignment', { action: 'saved' })
  }

  const handleDelete = async (hub:any)=> { const ok = await confirmDialog({ title: 'Delete assignment?', message: `Delete "${hub?.title || 'this assignment'}" and its submissions?`, confirmLabel: 'Delete' }); if(!ok) return; await assignmentHubAPI.delete(hub.id); toast.success('Deleted'); notifyEntityMutated('assignment', { hubId: hub.id, action: 'deleted' }) }

  const filteredAssignments = hubs

  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} className="space-y-6 max-w-[1280px] mx-auto">
      <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] shadow-sm overflow-hidden section--assignments">
        <div className="h-[3px] bg-surface-200 dark:bg-zinc-700" />
        <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white border border-surface-200 dark:bg-zinc-900 dark:border-zinc-700 flex items-center justify-center"><FileText size={18} className="text-slate-700 dark:text-zinc-300" /></div>
            <div>
              <h1 className="font-display text-xl font-extrabold text-slate-800 dark:text-night-50 leading-none">Assignments</h1>
              <p className="text-xs text-surface-500 dark:text-night-400 mt-1">{isTeacher?'Manage and grade' :'Track and submit'}</p>
            </div>
          </div>
          {isTeacher && <Button size="sm" variant="secondary" onClick={()=>{setEditing(null); setModalOpen(true)}}><Plus size={16}/> New Assignment</Button>}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 dark:text-night-400"/><Input value={search} onChange={e=> setSearch(e.target.value)} placeholder="Search..." aria-label="Search assignments" className="pl-9" /></div>
        <select value={filterScope} onChange={e=> setFilterScope(e.target.value)} aria-label="Filter by scope" className="px-3 py-2 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"><option value="ALL">All scopes</option><option value="DEPARTMENT">DEPARTMENT</option><option value="ROOM">ROOM</option></select>
        <select value={filterMode} onChange={e=> setFilterMode(e.target.value)} aria-label="Filter by mode" className="px-3 py-2 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"><option value="ALL">All modes</option><option value="ONLINE">ONLINE</option><option value="OFFLINE">OFFLINE</option><option value="HYBRID">HYBRID</option></select>
        {refreshing && hubs.length > 0 && (
          <span className="text-xs text-surface-500 dark:text-night-300" aria-live="polite">Updating…</span>
        )}
      </div>

      <div role="tablist" aria-label="Filter assignments by status" className="inline-flex p-1 rounded-xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 gap-1">
        {(['all', 'active', 'completed'] as AssignmentStatusFilter[]).map((s) => {
          const selected = statusFilter === s
          const label = s === 'all' ? 'All' : s === 'active' ? 'Active' : 'Completed'
          return (
            <button
              key={s}
              role="tab"
              aria-selected={selected}
              onClick={() => setStatusFilter(s)}
              onMouseEnter={() => prefetchStatus(s)}
              onFocus={() => prefetchStatus(s)}
              className={`px-4 h-9 rounded-lg text-sm font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500/30 ${
                selected
                  ? 'bg-white dark:bg-night-900 text-slate-800 dark:text-night-50 shadow-sm border border-surface-200 dark:border-night-600'
                  : 'text-surface-500 dark:text-night-400 hover:text-slate-800 dark:hover:text-night-50 border border-transparent'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>

      <div className="space-y-3">
        {loading ? (
          <CenteredLoader />
        ) : filteredAssignments.length===0 ? (
          statusFilter==='active' ? (
            <EmptyState icon={FileText} title="No active assignments" description="You're all caught up! No pending assignments." action={<Button size="sm" variant="secondary" onClick={handleClearFilters}>Clear filters</Button>} />
          ) : statusFilter==='completed' ? (
            <EmptyState icon={FileText} title="No completed assignments" description="Nothing completed yet. Submit an assignment to see it here." action={<Button size="sm" variant="secondary" onClick={handleClearFilters}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={FileText} title="No assignments" description="No assignments match your filters." action={<Button size="sm" variant="secondary" onClick={handleClearFilters}>Clear filters</Button>} />
          )
        ) : filteredAssignments.map(h=> (
          <AssignmentHubCard key={h.id} hub={h} onClick={()=> navigate(`/assignments/${h.id}`)} onEdit={isTeacher? (hub:any)=>{setEditing(hub); setModalOpen(true)}:undefined} onDelete={isTeacher? handleDelete:undefined} />
        ))}
      </div>

      <Pagination page={pagination.page} totalPages={pagination.pages} onChange={setPage} onPrefetch={prefetchPage} />

      <CreateAssignmentModal open={modalOpen} hub={editing} onClose={()=> setModalOpen(false)} onSaved={handleSaved} />

      <Modal open={!!detail} onClose={()=> { setDetail(null); setDetailLoading(false) }} title={detail?.title||'Assignment'} size="lg">
        {detailLoading ? (
          <CenteredLoader minHeight="min-h-[40vh]" />
        ) : detail ? (
          <div className="space-y-6">
            <div><p className="text-sm text-surface-500 dark:text-night-400">{detail.courseId}</p><p className="text-sm mt-2 whitespace-pre-wrap">{detail.description}</p><p className="text-xs text-surface-400 mt-2 dark:text-zinc-500">Due {new Date(detail.dueDate).toLocaleString()} • {detail.submissionMode} • {detail.scope}{detail.department?.name?` • ${detail.department.name}`:''}{detail.room?.name?` • ${detail.room.name}`:''}</p></div>
            {isTeacher ? (
              <>
                <StatsPanel stats={stats} hub={detail} isTeacher={isTeacher} />
                <div className="space-y-2">
                  <h4 className="font-semibold">Submissions ({submissions.length})</h4>
                  {submissions.map(s=> (
                    <div key={s.id} className="flex items-center justify-between p-3 border rounded-xl dark:border-night-700">
                      <div><div className="font-medium text-sm">{s.student?.name} <span className="text-surface-500 dark:text-night-400">{s.student?.studentId}</span></div><div className="text-xs text-surface-500 dark:text-night-400">{s.status} • {new Date(s.submittedAt).toLocaleString()}</div></div>
                      <Button size="sm" onClick={()=> setGrading(s)}>Grade</Button>
                    </div>
                  ))}
                  {submissions.length===0 && <div className="text-sm text-surface-400 dark:text-night-400">No submissions yet</div>}
                </div>
              </>
            ) : (
              <SubmissionPanel hub={detail} submission={detail.mySubmission} onSubmitted={handleSubmitted} onClose={()=> setDetail(null)} />
            )}
          </div>
        ) : null}
      </Modal>

      {grading && <GradeModal submission={grading} hub={detail} open={!!grading} onClose={()=> setGrading(null)} onGraded={()=> { openDetail(detail); notifyEntityMutated('assignment', { hubId: detail.id, action: 'graded' }) }} />}
    </motion.div>
  )
}
