import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Plus, Search, FileText } from 'lucide-react'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { assignmentHubAPI } from '../lib/api'
import { useAuthStore } from '../store/authStore'
import CreateAssignmentModal from '../components/assignments/CreateAssignmentModal'
import AssignmentHubCard from '../components/assignments/AssignmentHubCard'
import SubmissionPanel from '../components/assignments/SubmissionPanel'
import StatsPanel from '../components/assignments/StatsPanel'
import GradeModal from '../components/assignments/GradeModal'
import Modal from '../components/ui/Modal'
import Pagination from '../components/shared/Pagination'
import EmptyState from '../components/shared/EmptyState'
import toast from 'react-hot-toast'

export default function AssignmentHubPage() {
  const user = useAuthStore(s=> s.user)
  const isTeacher = user?.role==='TEACHER' || user?.role==='COLLEGE_ADMIN' || user?.role==='SUPER_ADMIN'
  const [hubs, setHubs] = useState<any[]>([])
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 1 })
  const [search, setSearch] = useState('')
  const [filterScope, setFilterScope] = useState('ALL')
  const [filterMode, setFilterMode] = useState('ALL')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [detail, setDetail] = useState<any>(null)
  const [submissions, setSubmissions] = useState<any[]>([])
  const [stats, setStats] = useState<any>(null)
  const [grading, setGrading] = useState<any>(null)

  const load = async ()=> {
    setLoading(true)
    try {
      const res = await assignmentHubAPI.getHubs({ page, limit: 20, search: search||undefined, scope: filterScope!=='ALL'?filterScope:undefined, submissionMode: filterMode!=='ALL'?filterMode:undefined })
      setHubs(res.data); setPagination(res.pagination)
    } catch(e){ console.error(e)} finally{ setLoading(false)}
  }
  useEffect(()=>{ load() }, [page, filterScope, filterMode])

  const openDetail = async (hub:any)=> {
    const full = await assignmentHubAPI.getHub(hub.id)
    setDetail(full)
    if(isTeacher) {
      const [subs, st] = await Promise.all([assignmentHubAPI.listSubmissions(hub.id), assignmentHubAPI.stats(hub.id).catch(()=> null)])
      setSubmissions(subs.data||subs); setStats(st)
    }
  }

  const handleDelete = async (hub:any)=> { if(!confirm('Delete assignment?')) return; await assignmentHubAPI.delete(hub.id); toast.success('Deleted'); load() }

  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} className="space-y-6">
      <div className="flex justify-between items-end"><div><h1 className="font-display text-xl font-extrabold text-surface-900 dark:text-[#F4F7F8]">Assignments</h1><p className="text-surface-500 dark:text-[#A6B3BE] mt-1">{isTeacher?'Manage and grade assignments':'Track and submit your assignments'}</p></div>{isTeacher && <Button size="sm" onClick={()=>{setEditing(null); setModalOpen(true)}}><Plus size={16}/> New Assignment</Button>}</div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400"/><Input value={search} onChange={e=> setSearch(e.target.value)} placeholder="Search..." className="pl-9" onKeyDown={e=> e.key==='Enter' && load()} /></div>
        <select value={filterScope} onChange={e=> setFilterScope(e.target.value)} className="px-3 py-2 rounded-xl border bg-white dark:bg-[#111920] text-sm"><option value="ALL">All scopes</option><option value="ALL">ALL</option><option value="DEPARTMENT">DEPARTMENT</option><option value="ROOM">ROOM</option></select>
        <select value={filterMode} onChange={e=> setFilterMode(e.target.value)} className="px-3 py-2 rounded-xl border bg-white dark:bg-[#111920] text-sm"><option value="ALL">All modes</option><option value="ONLINE">ONLINE</option><option value="OFFLINE">OFFLINE</option><option value="HYBRID">HYBRID</option></select>
      </div>

      <div className="space-y-3">
        {loading ? <div className="text-center py-12 text-surface-400">Loading...</div> : hubs.length===0 ? <EmptyState icon={FileText} title="No assignments" description="No assignments match your filters" /> : hubs.map(h=> (
          <AssignmentHubCard key={h.id} hub={h} onClick={()=> openDetail(h)} onEdit={isTeacher? (hub:any)=>{setEditing(hub); setModalOpen(true)}:undefined} onDelete={isTeacher? handleDelete:undefined} />
        ))}
      </div>

      <Pagination page={pagination.page} totalPages={pagination.pages} onChange={setPage} />

      <CreateAssignmentModal open={modalOpen} hub={editing} onClose={()=> setModalOpen(false)} onSaved={load} />

      <Modal open={!!detail} onClose={()=> setDetail(null)} title={detail?.title||'Assignment'} size="lg">
        {detail && (
          <div className="space-y-6">
            <div><p className="text-sm text-surface-500">{detail.courseId}</p><p className="text-sm mt-2 whitespace-pre-wrap">{detail.description}</p><p className="text-xs text-surface-400 mt-2">Due {new Date(detail.dueDate).toLocaleString()} • {detail.submissionMode} • {detail.scope}{detail.department?.name?` • ${detail.department.name}`:''}{detail.room?.name?` • ${detail.room.name}`:''}</p></div>
            {isTeacher ? (
              <>
                <StatsPanel stats={stats} hub={detail} />
                <div className="space-y-2">
                  <h4 className="font-semibold">Submissions ({submissions.length})</h4>
                  {submissions.map(s=> (
                    <div key={s.id} className="flex items-center justify-between p-3 border rounded-xl dark:border-[#202C35]">
                      <div><div className="font-medium text-sm">{s.student?.name} <span className="text-surface-500">{s.student?.studentId}</span></div><div className="text-xs text-surface-500">{s.status} • {new Date(s.submittedAt).toLocaleString()}</div></div>
                      <Button size="sm" onClick={()=> setGrading(s)}>Grade</Button>
                    </div>
                  ))}
                  {submissions.length===0 && <div className="text-sm text-surface-400">No submissions yet</div>}
                </div>
              </>
            ) : (
              <SubmissionPanel hub={detail} submission={detail.mySubmission} onSubmitted={()=> openDetail(detail)} />
            )}
          </div>
        )}
      </Modal>

      {grading && <GradeModal submission={grading} hub={detail} open={!!grading} onClose={()=> setGrading(null)} onGraded={()=> { openDetail(detail); assignmentHubAPI.listSubmissions(detail.id).then(r=> setSubmissions(r.data||r)) }} />}
    </motion.div>
  )
}
