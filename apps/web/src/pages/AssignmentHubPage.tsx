import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Plus, Search, FileText} from 'lucide-react'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { assignmentHubAPI } from '../lib/api'
import { queryClient } from '../lib/queryClient'
import { useAuthStore } from '../store/authStore'
import { useDebounce } from '../hooks/useDebounce'
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

export default function AssignmentHubPage() {
  const navigate = useNavigate()
  const user = useAuthStore(s=> s.user)
  const isTeacher = user?.role==='TEACHER' || user?.role==='COLLEGE_ADMIN' || user?.role==='SUPER_ADMIN'
  const [hubs, setHubs] = useState<any[]>([])
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 1 })
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [filterScope, setFilterScope] = useState('ALL')
  const [filterMode, setFilterMode] = useState('ALL')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [detail, setDetail] = useState<any>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [submissions, setSubmissions] = useState<any[]>([])
  const [stats, setStats] = useState<any>(null)
  const [grading, setGrading] = useState<any>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = async ()=> {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    try {
      const res = await assignmentHubAPI.getHubs({ page, limit: 20, search: debouncedSearch||undefined, scope: filterScope!=='ALL'?filterScope:undefined, submissionMode: filterMode!=='ALL'?filterMode:undefined, signal: controller.signal } as any)
      if (controller.signal.aborted) return
      setHubs(res.data); setPagination(res.pagination)
    } catch(e: any){ if (e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED' || controller.signal.aborted) return; console.error(e)} finally{ if (abortRef.current === controller) setLoading(false)}
  }

  // Guard filtered empty with loading — prevents initial flash of "No assignments match your filters" before fetch completes
  const filteredAssignments = hubs
  useEffect(()=>{ load(); return () => abortRef.current?.abort() }, [page, filterScope, filterMode, debouncedSearch])
  useEffect(()=>{ setPage(1) }, [debouncedSearch, filterScope, filterMode])

  const openDetail = async (hub:any)=> {
    setDetailLoading(true)
    setDetail(hub) // optimistically show title while fetching
    try {
      const full = await assignmentHubAPI.getHub(hub.id)
      setDetail(full)
      if(isTeacher) {
        const [subs, st] = await Promise.all([assignmentHubAPI.listSubmissions(hub.id), assignmentHubAPI.stats(hub.id).catch(()=> null)])
        setSubmissions(subs.data||subs); setStats(st)
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
    // invalidate queries and reload list so updated submission counts/status appear
    queryClient.invalidateQueries({ queryKey: ['assignmentHubs'] })
    queryClient.invalidateQueries({ queryKey: ['hubs'] })
    window.dispatchEvent(new Event('assignment:mutated'))
    await load()
  }

  const handleSaved = async () => {
    queryClient.invalidateQueries({ queryKey: ['assignmentHubs'] })
    queryClient.invalidateQueries({ queryKey: ['hubs'] })
    window.dispatchEvent(new Event('assignment:mutated'))
    await load()
  }

  const handleDelete = async (hub:any)=> { if(!confirm('Delete assignment?')) return; await assignmentHubAPI.delete(hub.id); toast.success('Deleted'); queryClient.invalidateQueries({ queryKey: ['assignmentHubs'] }); window.dispatchEvent(new Event('assignment:mutated')); load() }

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
        <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 dark:text-night-400"/><Input value={search} onChange={e=> setSearch(e.target.value)} placeholder="Search..." className="pl-9" onKeyDown={e=> e.key==='Enter' && load()} /></div>
        <select value={filterScope} onChange={e=> setFilterScope(e.target.value)} className="px-3 py-2 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"><option value="ALL">All scopes</option><option value="DEPARTMENT">DEPARTMENT</option><option value="ROOM">ROOM</option></select>
        <select value={filterMode} onChange={e=> setFilterMode(e.target.value)} className="px-3 py-2 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-surface-900 dark:text-night-50 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"><option value="ALL">All modes</option><option value="ONLINE">ONLINE</option><option value="OFFLINE">OFFLINE</option><option value="HYBRID">HYBRID</option></select>
      </div>

      <div className="space-y-3">
        {loading ? (
          <CenteredLoader />
        ) : filteredAssignments.length===0 ? <EmptyState icon={FileText} title="No assignments" description="No assignments match your filters" /> : filteredAssignments.map(h=> (
          <AssignmentHubCard key={h.id} hub={h} onClick={()=> navigate(`/assignments/${h.id}`)} onEdit={isTeacher? (hub:any)=>{setEditing(hub); setModalOpen(true)}:undefined} onDelete={isTeacher? handleDelete:undefined} />
        ))}
      </div>

      <Pagination page={pagination.page} totalPages={pagination.pages} onChange={setPage} />

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

      {grading && <GradeModal submission={grading} hub={detail} open={!!grading} onClose={()=> setGrading(null)} onGraded={()=> { openDetail(detail); assignmentHubAPI.listSubmissions(detail.id).then(r=> setSubmissions(r.data||r)); queryClient.invalidateQueries({ queryKey:['assignmentHubs']}) }} />}
    </motion.div>
  )
}
