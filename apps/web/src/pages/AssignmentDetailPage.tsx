import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Download, FileText, Search, Loader2, Settings, Clock } from 'lucide-react'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { assignmentHubAPI, departmentAPI } from '../lib/api'
import { getSubmissionChannel, channelBadgeClasses } from '../lib/assignments'
import { useAuthStore } from '../store/authStore'
import { queryClient } from '../lib/queryClient'
import { getSocket } from '../lib/socket'
import StatsPanel from '../components/assignments/StatsPanel'
import SubmissionPanel from '../components/assignments/SubmissionPanel'
import GradeModal from '../components/assignments/GradeModal'
import CreateAssignmentModal from '../components/assignments/CreateAssignmentModal'
import Modal from '../components/ui/Modal'
import toast from 'react-hot-toast'
import { PremiumHero, GlassPanel, BentoGrid, BentoCard, SectionCard } from '../components/premium/PremiumKit'
import { motion } from 'framer-motion'

export default function AssignmentDetailPage() {
  const { hubId } = useParams<{ hubId: string }>()
  const navigate = useNavigate()
  const user = useAuthStore(s=> s.user)
  const isTeacher = user?.role==='TEACHER' || user?.role==='COLLEGE_ADMIN' || user?.role==='SUPER_ADMIN'

  const [hub, setHub] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [submissions, setSubmissions] = useState<any[]>([])
  const [pending, setPending] = useState<any[]>([])
  const [stats, setStats] = useState<any>(null)
  const [grading, setGrading] = useState<any>(null)

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'submitted'|'pending'>('submitted')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [offlineTarget, setOfflineTarget] = useState<any>(null)
  const [offlineNote, setOfflineNote] = useState('')
  const [offlinePoints, setOfflinePoints] = useState('')
  const [offlineGrade, setOfflineGrade] = useState('')
  const [offlineFeedback, setOfflineFeedback] = useState('')
  const [offlineSaving, setOfflineSaving] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkPoints, setBulkPoints] = useState('')
  const [bulkGrade, setBulkGrade] = useState('')
  const [bulkFeedback, setBulkFeedback] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)

  // filters
  const [search, setSearch] = useState('')
  const [selectedDept, setSelectedDept] = useState<string>('ALL')
  const [selectedYear, setSelectedYear] = useState<string>('ALL')
  const [departments, setDepartments] = useState<any[]>([])

  const loadHub = async () => {
    if (!hubId) return
    setLoading(true)
    try {
      const full = await assignmentHubAPI.getHub(hubId)
      setHub(full)
      if (isTeacher) {
        const [subs, st, pend] = await Promise.all([
          assignmentHubAPI.listSubmissions(full.id, { limit: 100 }),
          assignmentHubAPI.stats(full.id).catch(()=> null),
          assignmentHubAPI.getPending(full.id).catch(()=> ({ data: [] }))
        ])
        setSubmissions(subs.data||subs||[])
        setStats(st)
        const pendData = (pend as any)?.data ?? pend ?? []
        setPending(Array.isArray(pendData) ? pendData : [])
      } else {
        setSubmissions([]); setStats(null); setPending([])
      }
      // fetch departments for ALL scope filter
      if (full.scope === 'ALL') {
        try {
          const depts = await departmentAPI.getAll()
          setDepartments(Array.isArray(depts) ? depts : (depts as any)?.data ?? [])
        } catch {}
      }
    } catch (e:any) {
      console.error(e)
      toast.error(e.response?.data?.error || 'Failed to load assignment')
    } finally { setLoading(false) }
  }

  useEffect(()=> { loadHub() }, [hubId])

  const refreshTeacherData = async () => {
    if (!hub) return
    try {
      const [subs, st, pend] = await Promise.all([
        assignmentHubAPI.listSubmissions(hub.id, { limit: 100 }),
        assignmentHubAPI.stats(hub.id).catch(()=> null),
        assignmentHubAPI.getPending(hub.id).catch(()=> ({ data: [] }))
      ])
      setSubmissions(Array.isArray(subs.data) ? [...subs.data] : Array.isArray(subs) ? [...subs] : [])
      setStats(st ? { ...(st as any) } : st)
      const pendData = (pend as any)?.data ?? pend ?? []
      setPending(Array.isArray(pendData) ? [...pendData] : [])
    } catch (e) { console.error('refreshTeacherData', e) }
  }

  // Realtime: socket push for this hub (cross-client) — also covers hub settings edits
  useEffect(()=> {
    const socket = getSocket()
    if (!socket || !hub?.id) return
    const hubId = hub.id
    const handler = (payload: any) => {
      const incomingHubId = payload?.hubId || payload?.hub?.id || payload?.assignmentId
      if (incomingHubId && incomingHubId !== hubId) return
      // hub metadata may have changed (title/dueDate with time/visibility) — refresh hub for both roles
      assignmentHubAPI.getHub(hubId).then(full=> setHub(full)).catch(()=>{})
      if (isTeacher) {
        if (payload?.submission?.id) {
          const sub = payload.submission
          setSubmissions(prev => {
            const idx = prev.findIndex(s=> s.id === sub.id)
            if (idx !== -1) {
              const next = [...prev]
              next[idx] = { ...prev[idx], ...sub, student: sub.student || prev[idx].student }
              return next
            }
            return prev
          })
          if (sub.student?.id || sub.studentId) {
            const sid = sub.student?.id || sub.studentId
            setPending(prev => prev.filter(p=> p.id !== sid && p.studentId !== sid))
          }
        }
        if (payload?.submissions && Array.isArray(payload.submissions)) {
          const map = new Map(payload.submissions.map((s:any)=> [s.id, s]))
          setSubmissions(prev => prev.map(s=> map.has(s.id) ? { ...s, ...(map.get(s.id) as any) } : s))
        }
        refreshTeacherData().catch(()=>{})
      }
      queryClient.invalidateQueries({ queryKey: ['assignmentHubs'] })
    }
    const events = ['assignment:submission:updated','assignment:graded','assignment:offline:marked','assignment:bulk:graded','assignment:pending:updated','assignment:stats:updated','assignment:mutated','assignment:hub:updated']
    events.forEach(ev=> socket.on(ev, handler))
    return ()=> { events.forEach(ev=> socket.off(ev, handler)) }
  }, [hub?.id, isTeacher])

  useEffect(()=> {
    const onMutated = (e: any) => {
      const hubId = e?.detail?.hubId
      if (hubId && hub?.id && hubId !== hub.id) return
      if (!hub?.id) return
      // refetch hub metadata (settings) + teacher data for any mutation on this hub
      assignmentHubAPI.getHub(hub.id).then(full=> setHub(full)).catch(()=>{})
      if (isTeacher) refreshTeacherData().catch(()=>{})
    }
    window.addEventListener('assignment:mutated' as any, onMutated as any)
    const onCustom = (e: Event) => {
      const ce = e as CustomEvent
      if (ce.detail?.hubId && hub?.id && ce.detail.hubId !== hub.id) return
      if (!hub?.id) return
      assignmentHubAPI.getHub(hub!.id).then(full=> setHub(full)).catch(()=>{})
      if (isTeacher) refreshTeacherData().catch(()=>{})
    }
    window.addEventListener('assignment:mutated', onCustom as any)
    return ()=> {
      window.removeEventListener('assignment:mutated' as any, onMutated as any)
      window.removeEventListener('assignment:mutated', onCustom as any)
    }
  }, [hub?.id, isTeacher])

  // derived filter options
  const availableYears = useMemo(()=> {
    const years = new Set<string>()
    pending.forEach((p:any)=> { if(p.incomingYear) years.add(String(p.incomingYear)) })
    submissions.forEach((s:any)=> { const y = s.student?.incomingYear; if(y) years.add(String(y)) })
    return Array.from(years).sort()
  }, [pending, submissions])

  const pendingDeptBreakdown = useMemo(()=> {
    const map = new Map<string, number>()
    pending.forEach((p:any)=> {
      const key = p.departmentName || 'Unknown'
      map.set(key, (map.get(key)||0)+1)
    })
    return Array.from(map.entries()).sort((a,b)=> b[1]-a[1])
  }, [pending])

  const channelBreakdown = useMemo(()=> {
    let online = 0, offline = 0
    submissions.forEach((s:any)=> {
      const ch = getSubmissionChannel(s)
      if (ch==='OFFLINE') offline++
      else online++
    })
    return { online, offline, total: submissions.length }
  }, [submissions])

  const gradingProgress = useMemo(()=> {
    if (!submissions.length) return 0
    const graded = submissions.filter((s:any)=> s.status==='GRADED').length
    return Math.round((graded / submissions.length)*100)
  }, [submissions])

  const filteredPending = useMemo(()=> {
    const term = search.trim().toLowerCase()
    return pending.filter((p:any)=> {
      if (term) {
        const hay = `${p.name||''} ${p.studentId||''} ${p.email||''}`.toLowerCase()
        if (!hay.includes(term)) return false
      }
      if (selectedDept !== 'ALL') {
        // match by id or name
        const deptObj = departments.find(d=> d.id===selectedDept)
        const deptName = deptObj?.name
        if (p.departmentId) {
          if (p.departmentId !== selectedDept) return false
        } else if (deptName) {
          if (p.departmentName !== deptName) return false
        } else {
          if (p.departmentName !== selectedDept) return false
        }
      }
      if (selectedYear !== 'ALL') {
        if (String(p.incomingYear ?? '') !== selectedYear) return false
      }
      return true
    })
  }, [pending, search, selectedDept, selectedYear, departments])

  const filteredSubmissions = useMemo(()=> {
    const term = search.trim().toLowerCase()
    return submissions.filter((s:any)=> {
      const stu = s.student || {}
      if (term) {
        const hay = `${stu.name||''} ${stu.studentId||''} ${stu.email||''} ${s.content||''}`.toLowerCase()
        if (!hay.includes(term)) return false
      }
      if (selectedDept !== 'ALL') {
        const deptObj = departments.find(d=> d.id===selectedDept)
        const deptName = deptObj?.name
        if (stu.departmentId) {
          if (stu.departmentId !== selectedDept) return false
        } else if (deptName) {
          if (stu.departmentName !== deptName) return false
        } else {
          if (stu.departmentName !== selectedDept) return false
        }
      }
      if (selectedYear !== 'ALL') {
        if (String(stu.incomingYear ?? '') !== selectedYear) return false
      }
      return true
    })
  }, [submissions, search, selectedDept, selectedYear, departments])

  const toggleSelect = (studentId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(studentId)) next.delete(studentId)
      else next.add(studentId)
      return next
    })
  }
  const toggleSelectAll = () => {
    const ids = filteredSubmissions.map((s:any)=> s.student?.id || s.studentId)
    const allSelected = ids.every((id:string)=> selectedIds.has(id)) && ids.length>0
    if (allSelected) {
      setSelectedIds(prev=> {
        const next = new Set(prev)
        ids.forEach(id=> next.delete(id))
        return next
      })
    } else {
      setSelectedIds(prev=> {
        const next = new Set(prev)
        ids.forEach(id=> next.add(id))
        return next
      })
    }
  }

  const handleOfflineMark = async () => {
    if (!hub || !offlineTarget) return
    if (!offlineNote.trim()) { toast.error('Add offline note (receipt / roll / remarks)'); return }
    if (offlinePoints.trim() !== '') {
      const n = Number(offlinePoints)
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > hub.maxPoints) { toast.error(`Points must be integer 0-${hub.maxPoints}`); return }
    }
    setOfflineSaving(true)
    const targetName = offlineTarget.name
    const targetId = offlineTarget.id
    try {
      const payload: any = { studentId: targetId, offlineNote: offlineNote.trim() }
      if (offlinePoints.trim() !== '') payload.points = Number(offlinePoints)
      if (offlineGrade.trim() !== '') payload.grade = offlineGrade.trim()
      if (offlineFeedback.trim() !== '') payload.feedback = offlineFeedback.trim()
      const res:any = await assignmentHubAPI.offlineSubmit(hub.id, payload)
      const hasGrade = payload.points !== undefined || payload.grade !== undefined || payload.feedback !== undefined
      const newSub = res?.id ? res : null
      toast.success(hasGrade ? `Marked ${targetName} as offline submitted & graded` : `Marked ${targetName} as offline submitted`)
      if (newSub) {
        setSubmissions(prev => {
          const idx = prev.findIndex(s=> s.studentId === targetId || s.student?.id === targetId)
          if (idx !== -1) {
            const next = [...prev]
            next[idx] = { ...prev[idx], ...newSub, student: newSub.student || prev[idx].student }
            return next
          }
          return [ { ...newSub, student: newSub.student || offlineTarget }, ...prev ]
        })
        setPending(prev => prev.filter(p=> p.id !== targetId && p.studentId !== targetId))
        setStats((prev:any)=> prev ? { ...prev, submitted: (prev.submitted||0)+1, pending: Math.max(0, (prev.pending||0)-1), graded: hasGrade ? (prev.graded||0)+1 : prev.graded } : prev)
      }
      setOfflineTarget(null); setOfflineNote(''); setOfflinePoints(''); setOfflineGrade(''); setOfflineFeedback('')
      refreshTeacherData().catch(()=>{})
      queryClient.invalidateQueries({ queryKey: ['assignmentHubs'] })
      window.dispatchEvent(new CustomEvent('assignment:mutated', { detail: { hubId: hub.id } }))
    } catch (e:any) { toast.error(e.response?.data?.error || 'Failed to mark offline') } finally { setOfflineSaving(false) }
  }

  const handleBulkGrade = async () => {
    if (!hub || selectedIds.size===0) return
    if (bulkPoints !== '') {
      const n = Number(bulkPoints)
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > hub.maxPoints) { toast.error(`Points must be integer 0-${hub.maxPoints}`); return }
    }
    if (!bulkPoints.trim() && !bulkGrade.trim() && !bulkFeedback.trim()) { toast.error('Enter points, grade or feedback to apply'); return }
    setBulkSaving(true)
    const idsSnapshot = Array.from(selectedIds)
    const grades = idsSnapshot.map(studentId => ({
      studentId,
      points: bulkPoints.trim() !== '' ? Number(bulkPoints) : undefined,
      grade: bulkGrade.trim() || undefined,
      feedback: bulkFeedback.trim() || undefined,
    }))
    const pointsVal = bulkPoints.trim()!==''?Number(bulkPoints):undefined
    const gradeVal = bulkGrade.trim()||undefined
    const feedbackVal = bulkFeedback.trim()||undefined
    setSubmissions(prev => prev.map(s=> {
      const sid = s.student?.id || s.studentId
      if (idsSnapshot.includes(sid)) {
        return { ...s, points: pointsVal ?? s.points, grade: gradeVal ?? s.grade, feedback: feedbackVal ?? s.feedback, status: (pointsVal!==undefined||gradeVal!==undefined||feedbackVal!==undefined) ? 'GRADED' : s.status, gradedAt: new Date().toISOString() } as any
      }
      return s
    }))
    try {
      const res:any = await assignmentHubAPI.bulkGrade(hub.id, { grades })
      const updatedList: any[] = res?.data || res || []
      if (updatedList.length) {
        const map = new Map(updatedList.map((u:any)=> [(u.studentId||u.student?.id), u]))
        setSubmissions(prev => prev.map(s=> {
          const sid = s.student?.id || s.studentId
          return map.has(sid) ? { ...s, ...map.get(sid) } : s
        }))
      }
      toast.success(`Graded ${grades.length} submission(s)`)
      setBulkOpen(false); setBulkPoints(''); setBulkGrade(''); setBulkFeedback(''); setSelectedIds(new Set())
      refreshTeacherData().catch(()=>{})
      queryClient.invalidateQueries({ queryKey: ['assignmentHubs'] })
      window.dispatchEvent(new CustomEvent('assignment:mutated', { detail: { hubId: hub.id } }))
    } catch (e:any) {
      toast.error(e.response?.data?.error || 'Bulk grade failed')
      refreshTeacherData().catch(()=>{})
    } finally { setBulkSaving(false) }
  }

  const handleExport = () => {
    if (!hub) return
    const rows: any[] = []
    filteredSubmissions.forEach((s:any)=> {
      const stu = s.student || {}
      rows.push({
        name: stu.name || '',
        studentId: stu.studentId || s.studentId || '',
        department: stu.departmentName || '',
        status: s.status || 'Submitted',
        channel: getSubmissionChannel(s),
        points: s.points ?? '',
        grade: s.grade ?? '',
        feedback: s.feedback || '',
        submittedAt: s.submittedAt ? new Date(s.submittedAt).toISOString() : '',
        offlineNote: s.offlineNote || ''
      })
    })
    filteredPending.forEach((p:any)=> {
      rows.push({
        name: p.name || '',
        studentId: p.studentId || '',
        department: p.departmentName || '',
        status: 'Pending',
        channel: '',
        points: '',
        grade: '',
        feedback: '',
        submittedAt: '',
        offlineNote: ''
      })
    })
    const header = ['Student Name','Student ID','Department','Status','Channel','Points','Grade','Feedback','SubmittedAt','OfflineNote']
    const esc = (v:any)=> {
      const s = String(v ?? '')
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g,'""')}"`
      return s
    }
    const csvLines = [header.map(esc).join(',')]
    rows.forEach(r=> {
      const cols = [r.name, r.studentId, r.department, r.status, r.channel, r.points, r.grade, r.feedback, r.submittedAt, r.offlineNote]
      csvLines.push(cols.map(esc).join(','))
    })
    const csv = csvLines.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const date = new Date().toISOString().slice(0,10)
    a.download = `assignment-${hub.id}-${date}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(()=> URL.revokeObjectURL(url), 1000)
    toast.success(`Exported ${rows.length} rows`)
  }

  const channelBadge = (s:any) => {
    const ch = getSubmissionChannel(s)
    const isOffline = ch === 'OFFLINE'
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border ${channelBadgeClasses(isOffline)}`}>{ch}</span>
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="w-8 h-8 animate-spin text-primary-500" /></div>
  }
  if (!hub) {
    return <div className="p-8 text-center"><p className="text-surface-500">Assignment not found</p><Button onClick={()=> navigate('/assignments')} className="mt-4">Back to assignments</Button></div>
  }

  const isLateHub = new Date() > new Date(hub.dueDate) && !hub.allowLateSubmission

  return (
    <div className="space-y-6 max-w-[1280px] mx-auto">
      {/* ─── Premium Dark Hero — bento 12-col, glass, Spotify green ─── */}
      <PremiumHero
        icon={<FileText size={18} />}
        eyebrow="Assignment · Detail"
        title={<>Assignment Detail</>}
        subtitle="Submissions, grading and analytics — all in one bento workspace."
      />
      {/* premium tokens: bg-[#0a0a0a] rounded-[32px] backdrop-blur-xl bg-white/[0.03] border-white/10 grid-cols-12 #1ed760 */}
      <div className="hidden rounded-[32px] bg-[#0a0a0a] backdrop-blur-xl bg-white/[0.03] border border-white/10 grid-cols-12" />
      {/* Header */}
      <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] shadow-sm overflow-hidden !border-primary-500/15 dark:!border-primary-500/20">
        <div className="h-[3px] bg-brass-500" />
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-3">
            <button onClick={()=> navigate('/assignments')} className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-night-800 text-surface-600 dark:text-night-300">
              <ArrowLeft size={18} />
            </button>
            <div className="w-10 h-10 rounded-xl bg-brass-500 border border-brass-500/20 flex items-center justify-center shrink-0"><FileText size={18} className="text-slate-900" /></div>
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-xl font-extrabold text-slate-800 dark:text-night-50 leading-tight truncate">{hub.title}</h1>
              <p className="text-xs text-surface-500 dark:text-night-400 mt-0.5">{hub.courseId || 'General'} • {hub.scope}{hub.department?.name?` • ${hub.department.name}`:''}{hub.room?.name?` • ${hub.room.name}`:''} • {hub.submissionMode} • {hub.maxPoints} pts</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isTeacher && (
                <button
                  onClick={()=> setSettingsOpen(true)}
                  title="Edit assignment settings (title, due date & time, submission mode, marks, visibility)"
                  aria-label="Edit assignment settings"
                  className="p-2.5 rounded-xl border border-surface-200 dark:border-night-700 bg-white dark:bg-night-800 hover:bg-surface-50 dark:hover:bg-night-700 text-surface-600 dark:text-night-300 hover:text-primary-600 dark:hover:text-primary-400 shadow-sm transition"
                >
                  <Settings size={18} />
                </button>
              )}
              {isTeacher && <Button size="sm" variant="secondary" onClick={handleExport}><Download size={14}/> Export</Button>}
            </div>
          </div>
          {hub.description && <p className="text-sm whitespace-pre-wrap text-surface-700 dark:text-night-300 bg-surface-50 dark:bg-night-800 rounded-xl p-3 border dark:border-night-700">{hub.description}</p>}
          <p className="text-xs text-surface-400 dark:text-night-400 flex flex-wrap items-center gap-1.5"><Clock size={12}/> Due {new Date(hub.dueDate).toLocaleString(undefined, { weekday:'short', year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})} {isLateHub && <span className="text-danger-600 font-semibold">• Overdue</span>} {hub.allowLateSubmission && <span className="text-success-600">• Late allowed</span>}</p>
        </div>
      </div>

      {isTeacher ? (
        <>
          <StatsPanel stats={stats} hub={hub} isTeacher={isTeacher} />
          {/* Extra analytics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] shadow-sm p-4 space-y-2">
              <h4 className="text-sm font-bold text-surface-900 dark:text-night-50">Channel breakdown</h4>
              <div className="flex items-center gap-3 text-sm">
                <span className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold">ONLINE {channelBreakdown.online}</span>
                <span className="px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-xs font-bold">OFFLINE {channelBreakdown.offline}</span>
                <span className="text-xs text-surface-500">{channelBreakdown.total} total</span>
              </div>
              <div className="w-full h-2 bg-surface-100 dark:bg-night-800 rounded-full overflow-hidden flex">
                {channelBreakdown.total>0 && <>
                  <div className="bg-emerald-500" style={{ width: `${(channelBreakdown.online/channelBreakdown.total)*100}%` }} />
                  <div className="bg-amber-500" style={{ width: `${(channelBreakdown.offline/channelBreakdown.total)*100}%` }} />
                </>}
              </div>
              <p className="text-xs text-surface-500">Online vs offline submissions among submitted</p>
            </div>
            <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] shadow-sm p-4 space-y-2">
              <h4 className="text-sm font-bold text-surface-900 dark:text-night-50">Grading progress</h4>
              <div className="flex items-center justify-between text-sm">
                <span className="text-surface-600 dark:text-night-300">{submissions.filter(s=> s.status==='GRADED').length} / {submissions.length} graded</span>
                <span className="font-bold text-primary-600">{gradingProgress}%</span>
              </div>
              <div className="w-full h-2 bg-surface-100 dark:bg-night-800 rounded-full overflow-hidden">
                <div className="h-full bg-primary-500 transition-all" style={{ width: `${gradingProgress}%` }} />
              </div>
              <p className="text-xs text-surface-500">Graded submissions / total submitted</p>
            </div>
            <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] shadow-sm p-4 space-y-2">
              <h4 className="text-sm font-bold text-surface-900 dark:text-night-50">Pending by department</h4>
              {pendingDeptBreakdown.length===0 ? <p className="text-xs text-surface-400">No pending</p> : (
                <div className="space-y-1 max-h-[90px] overflow-y-auto">
                  {pendingDeptBreakdown.map(([dept, cnt])=> (
                    <div key={dept} className="flex items-center justify-between text-xs">
                      <span className="truncate text-surface-700 dark:text-night-300">{dept}</span>
                      <span className="font-bold px-1.5 py-0.5 rounded bg-surface-100 dark:bg-night-700 border dark:border-night-600">{cnt}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-surface-500">{pending.length} pending total</p>
            </div>
          </div>

          {/* Filters */}
          <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] shadow-sm p-4 space-y-3">
            <div className="flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                <input value={search} onChange={e=> setSearch(e.target.value)} placeholder="Search name, student ID, email..." className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-surface-200 dark:border-night-700 bg-white dark:bg-night-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20" />
              </div>
              {hub.scope==='ALL' && (
                <select value={selectedDept} onChange={e=> setSelectedDept(e.target.value)} className="px-3 py-2.5 rounded-xl border border-surface-200 dark:border-night-700 bg-white dark:bg-night-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 min-w-[160px]">
                  <option value="ALL">All departments</option>
                  {departments.map((d:any)=> <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              )}
              {(hub.scope==='ALL' || hub.scope==='DEPARTMENT') && availableYears.length>0 && (
                <select value={selectedYear} onChange={e=> setSelectedYear(e.target.value)} className="px-3 py-2.5 rounded-xl border border-surface-200 dark:border-night-700 bg-white dark:bg-night-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20">
                  <option value="ALL">All years</option>
                  {availableYears.map(y=> <option key={y} value={y}>{y}</option>)}
                </select>
              )}
              <div className="flex items-center gap-2 ml-auto">
                <Button size="sm" variant="secondary" onClick={handleExport}><Download size={14}/> Export CSV</Button>
                <Button size="sm" variant="secondary" disabled={selectedIds.size===0} onClick={()=> setBulkOpen(true)}>Bulk Grade ({selectedIds.size})</Button>
              </div>
            </div>
            <div className="text-xs text-surface-400 dark:text-night-400 flex flex-wrap gap-2">
              <span>Scope: {hub.scope}</span>
              <span>• {filteredSubmissions.length}/{submissions.length} submitted shown</span>
              <span>• {filteredPending.length}/{pending.length} pending shown</span>
              {(selectedDept!=='ALL' || selectedYear!=='ALL' || search) && <button onClick={()=>{setSearch(''); setSelectedDept('ALL'); setSelectedYear('ALL')}} className="text-primary-600 underline">Clear filters</button>}
            </div>
          </div>

          {/* Tabs */}
          <div>
            <div className="flex items-center gap-2 border-b border-surface-200 dark:border-night-700">
              <button onClick={()=> setActiveTab('submitted')} className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${activeTab==='submitted' ? 'border-primary-500 text-primary-600 dark:text-primary-400' : 'border-transparent text-surface-500 hover:text-surface-700 dark:text-night-400'}`}>Submitted ({filteredSubmissions.length}{filteredSubmissions.length!==submissions.length?` / ${submissions.length}`:''})</button>
              <button onClick={()=> setActiveTab('pending')} className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${activeTab==='pending' ? 'border-primary-500 text-primary-600 dark:text-primary-400' : 'border-transparent text-surface-500 hover:text-surface-700 dark:text-night-400'}`}>Pending ({filteredPending.length}{filteredPending.length!==pending.length?` / ${pending.length}`:''})</button>
              <div className="ml-auto pb-2 hidden sm:block text-xs text-surface-400 dark:text-night-400">{pending.length} pending • {submissions.length} submitted</div>
            </div>

            {activeTab==='submitted' ? (
              <div className="space-y-2 mt-3">
                {filteredSubmissions.length>0 && (
                  <div className="flex items-center justify-between gap-2 p-2 bg-surface-50 dark:bg-night-800 rounded-xl border dark:border-night-700">
                    <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
                      <input type="checkbox" checked={filteredSubmissions.length>0 && filteredSubmissions.every((s:any)=> selectedIds.has(s.student?.id || s.studentId))} onChange={toggleSelectAll} className="w-4 h-4 rounded border-surface-300 dark:border-night-600" />
                      <span className="font-medium">{filteredSubmissions.every((s:any)=> selectedIds.has(s.student?.id || s.studentId)) && filteredSubmissions.length>0 ? 'Deselect filtered' : 'Select filtered'}</span>
                      {selectedIds.size>0 && <span className="text-primary-600 dark:text-primary-400">{selectedIds.size} selected</span>}
                    </label>
                    <Button size="sm" variant="secondary" disabled={selectedIds.size===0} onClick={()=> setBulkOpen(true)}>Bulk Grade ({selectedIds.size})</Button>
                  </div>
                )}
                {filteredSubmissions.map((s:any)=> {
                  const checked = selectedIds.has(s.student?.id || s.studentId)
                  return (
                    <div key={s.id} className={`flex items-center justify-between p-3 border rounded-xl dark:border-night-700 gap-3 ${checked ? 'bg-primary-50/60 dark:bg-primary-900/10 border-primary-200 dark:border-primary-800' : 'bg-white dark:bg-night-900'}`}>
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <input type="checkbox" checked={checked} onChange={()=> toggleSelect(s.student?.id || s.studentId)} className="w-4 h-4 rounded border-surface-300 dark:border-night-600 shrink-0" />
                        <div className="min-w-0">
                          <div className="font-medium text-sm flex flex-wrap items-center gap-2">
                            <span className="truncate">{s.student?.name} <span className="text-surface-500 dark:text-night-400 font-normal">{s.student?.studentId}</span></span>
                            {channelBadge(s)}
                            {s.points !== null && s.points !== undefined && <span className="text-xs px-1.5 py-0.5 rounded bg-surface-100 dark:bg-night-700 border dark:border-night-600">{s.points}/{hub.maxPoints}</span>}
                          </div>
                          <div className="text-xs text-surface-500 dark:text-night-400 flex flex-wrap gap-2">
                            <span>{s.status} • {new Date(s.submittedAt).toLocaleString()}</span>
                            {(s as any).offlineNote && <span className="text-amber-700 dark:text-amber-300">• {String((s as any).offlineNote).slice(0,40)}</span>}
                            {s.student?.departmentName && <span>• {s.student.departmentName}</span>}
                            {s.student?.incomingYear && <span>• {s.student.incomingYear}</span>}
                          </div>
                        </div>
                      </div>
                      <Button size="sm" onClick={()=> setGrading(s)}>Grade</Button>
                    </div>
                  )
                })}
                {filteredSubmissions.length===0 && <div className="text-sm text-surface-400 dark:text-night-400 py-6 text-center border border-dashed rounded-xl dark:border-night-700">No submissions match filters</div>}
                {filteredSubmissions.length===0 && submissions.length>0 && <div className="text-xs text-center text-surface-400">Try clearing department / year / search filters</div>}
                {filteredSubmissions.length===0 && submissions.length===0 && <div className="text-sm text-surface-400 dark:text-night-400 py-6 text-center border border-dashed rounded-xl dark:border-night-700">No submissions yet — pending students appear in the Pending tab.</div>}
              </div>
            ) : (
              <div className="space-y-2 mt-3">
                {filteredPending.map((stu:any)=> (
                  <div key={stu.id} className="flex items-center justify-between p-3 border rounded-xl dark:border-night-700 bg-white dark:bg-night-900 gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{stu.name} <span className="text-surface-500 dark:text-night-400 font-normal">{stu.studentId}</span></div>
                      <div className="text-xs text-surface-500 dark:text-night-400 truncate flex flex-wrap gap-2">
                        <span>{stu.email}</span>
                        {stu.departmentName && <span>• {stu.departmentName}</span>}
                        {stu.incomingYear && <span>• {stu.incomingYear}</span>}
                      </div>
                    </div>
                    <Button size="sm" variant="secondary" onClick={()=> { setOfflineTarget(stu); setOfflineNote(''); setOfflinePoints(''); setOfflineGrade(''); setOfflineFeedback('') }}>Mark Offline Submitted</Button>
                  </div>
                ))}
                {filteredPending.length===0 && pending.length>0 && <div className="text-sm text-surface-400 dark:text-night-400 py-6 text-center border border-dashed rounded-xl dark:border-night-700">No pending students match filters</div>}
                {filteredPending.length===0 && pending.length===0 && <div className="text-sm text-surface-400 dark:text-night-400 py-6 text-center border border-dashed rounded-xl dark:border-night-700">All eligible students have submitted 🎉</div>}
              </div>
            )}
          </div>
        </>
      ) : (
        <SubmissionPanel hub={hub} submission={hub.mySubmission} onSubmitted={()=> { loadHub(); queryClient.invalidateQueries({ queryKey:['assignmentHubs']}) }} onClose={()=> navigate('/assignments')} />
      )}

      {/* Offline marking modal — marks optional */}
      <Modal open={!!offlineTarget} onClose={()=> { setOfflineTarget(null); setOfflineNote(''); setOfflinePoints(''); setOfflineGrade(''); setOfflineFeedback('') }} title={offlineTarget ? `Mark offline: ${offlineTarget.name}` : 'Mark offline'} size="sm">
        <div className="space-y-4">
          {offlineTarget && <div className="text-sm text-surface-600 dark:text-night-300"><div className="font-medium">{offlineTarget.name} <span className="text-surface-500">{offlineTarget.studentId}</span></div><div className="text-xs text-surface-500 dark:text-night-400">{offlineTarget.email}</div></div>}
          <div>
            <label className="block text-sm font-semibold mb-1">Offline note <span className="text-danger-500">*</span></label>
            <textarea value={offlineNote} onChange={e=> setOfflineNote(e.target.value)} rows={3} placeholder="Receipt no., roll, desk, or remarks — e.g., Received rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] shadow-sm copy at dept office, roll 21CS042" className="w-full px-4 py-3 bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20" />
            <p className="text-xs text-surface-400 dark:text-night-400 mt-1">Creates an OFFLINE submission for this student (bypasses ONLINE file check).</p>
          </div>
          <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/10 p-3 space-y-3">
            <div className="text-xs font-bold text-amber-800 dark:text-amber-300">Optional — grade now or later</div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-semibold mb-1">Points (max {hub?.maxPoints})</label><Input type="number" value={offlinePoints} onChange={e=> setOfflinePoints(e.target.value)} placeholder="—" /></div>
              <div><label className="block text-xs font-semibold mb-1">Grade</label><Input value={offlineGrade} onChange={e=> setOfflineGrade(e.target.value)} placeholder="A" /></div>
            </div>
            <div><label className="block text-xs font-semibold mb-1">Feedback (optional)</label><textarea value={offlineFeedback} onChange={e=> setOfflineFeedback(e.target.value)} rows={2} className="w-full px-3 py-2 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-700 rounded-xl text-sm" placeholder="Well done, etc. — leave blank to grade later" /></div>
            <p className="text-[11px] text-amber-700 dark:text-amber-400">Leave blank to mark as Submitted (pending → submitted). Add marks here to create as Graded in one step; you can still re-grade later via Grade button.</p>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={()=> { setOfflineTarget(null); setOfflineNote(''); setOfflinePoints(''); setOfflineGrade(''); setOfflineFeedback('') }} className="flex-1">Cancel</Button>
            <Button onClick={handleOfflineMark} disabled={offlineSaving || !offlineNote.trim()} className="flex-1">{offlineSaving ? 'Saving...' : (offlinePoints.trim()||offlineGrade.trim()||offlineFeedback.trim()) ? 'Mark & Grade' : 'Mark Submitted'}</Button>
          </div>
        </div>
      </Modal>

      {/* Bulk grade modal */}
      <Modal open={bulkOpen} onClose={()=> setBulkOpen(false)} title={`Bulk grade (${selectedIds.size})`} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-surface-500 dark:text-night-400">Applies the same points / grade / feedback to all {selectedIds.size} selected submission(s). Leaves blank fields unchanged if you prefer per-student grading via individual Grade buttons.</p>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-semibold mb-1">Points (max {hub?.maxPoints})</label><Input type="number" value={bulkPoints} onChange={e=> setBulkPoints(e.target.value)} placeholder="85" /></div>
            <div><label className="block text-sm font-semibold mb-1">Grade</label><Input value={bulkGrade} onChange={e=> setBulkGrade(e.target.value)} placeholder="A" /></div>
          </div>
          <div><label className="block text-sm font-semibold mb-1">Feedback</label><textarea value={bulkFeedback} onChange={e=> setBulkFeedback(e.target.value)} rows={3} className="w-full px-4 py-3 bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-700 rounded-xl text-sm" placeholder="Well done, etc." /></div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={()=> setBulkOpen(false)} className="flex-1">Cancel</Button>
            <Button onClick={handleBulkGrade} disabled={bulkSaving || selectedIds.size===0} className="flex-1">{bulkSaving ? 'Saving...' : `Apply to ${selectedIds.size}`}</Button>
          </div>
        </div>
      </Modal>

      {grading && <GradeModal key={grading.id} submission={grading} hub={hub} open={!!grading} onClose={()=> setGrading(null)} onGraded={async (updated:any)=> {
        if (updated?.id) {
          setSubmissions(prev => prev.map(s=> s.id===updated.id ? { ...s, ...updated, student: updated.student || s.student } : s))
        }
        refreshTeacherData().catch(()=>{})
        queryClient.invalidateQueries({ queryKey:['assignmentHubs']})
        window.dispatchEvent(new CustomEvent('assignment:mutated', { detail: { hubId: hub?.id } }))
      }} />}

      {/* Settings edit modal — gear icon in header */}
      <CreateAssignmentModal
        open={settingsOpen}
        hub={hub}
        onClose={()=> setSettingsOpen(false)}
        onSaved={async ()=> {
          await loadHub()
          queryClient.invalidateQueries({ queryKey: ['assignmentHubs'] })
          queryClient.invalidateQueries({ queryKey: ['hubs'] })
          if (hub?.id) window.dispatchEvent(new CustomEvent('assignment:mutated', { detail: { hubId: hub.id } }))
          else window.dispatchEvent(new Event('assignment:mutated'))
          setSettingsOpen(false)
        }}
      />
    </div>
  )
}
