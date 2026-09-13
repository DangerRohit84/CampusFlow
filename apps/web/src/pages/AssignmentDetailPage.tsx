import { useEffect, useState, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Download, FileText, Search, Settings, Clock, Sparkles, Layers, GraduationCap, Users, BarChart3, TrendingUp, CheckCircle2, AlertCircle, ChevronRight, Filter } from 'lucide-react'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { assignmentHubAPI } from '../lib/api'
import { useDepartments } from '../hooks/useDepartments'
import { getSubmissionChannel, channelBadgeClasses } from '../lib/assignments'
import { useAuthStore } from '../store/authStore'
import { queryClient } from '../lib/queryClient'
import { notifyEntityMutated } from '../lib/entitySync'
import { getSocket } from '../lib/socket'
import StatsPanel from '../components/assignments/StatsPanel'
import SubmissionPanel from '../components/assignments/SubmissionPanel'
import GradeModal from '../components/assignments/GradeModal'
import CreateAssignmentModal from '../components/assignments/CreateAssignmentModal'
import Modal from '../components/ui/Modal'
import toast from 'react-hot-toast'
import { PremiumHero, GlassPanel, BentoGrid, BentoCard, SectionCard, StatBento } from '../components/premium/PremiumKit'
import { motion } from 'framer-motion'
import CenteredLoader from '../components/ui/CenteredLoader'
import clsx from 'clsx'

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
  // PERPAGE-HALF1: shared cached departments (was an uncached
  // departmentAPI.getAll() awaited AFTER the subs batch — 3rd sequential
  // round + a duplicate of 6 other pages' mount fetch). Fetched only when
  // the hub actually needs it (ALL-scope dept filter).
  const { data: departmentsData } = useDepartments({ enabled: hub?.scope === 'ALL' })
  const departments: any[] = Array.isArray(departmentsData) ? departmentsData : []
  // Epoch guard: rapid hubId switches / unmount must not let a stale
  // loadHub resolve paint over the fresh hub (no AbortSignal on these
  // endpoints, so generation-check instead — same data when current).
  const loadEpoch = useRef(0)

  const loadHub = async () => {
    if (!hubId) return
    setLoading(true)
    const epoch = ++loadEpoch.current
    try {
      const full = await assignmentHubAPI.getHub(hubId)
      if (epoch !== loadEpoch.current) return
      setHub(full)
      if (isTeacher) {
        // Single parallel round for the whole teacher bundle (subs + stats
        // + pending were already parallel; departments moved to the shared
        // hook above so they no longer serialize behind this batch).
        const [subs, st, pend] = await Promise.all([
          assignmentHubAPI.listSubmissions(full.id, { limit: 100 }),
          assignmentHubAPI.stats(full.id).catch(()=> null),
          assignmentHubAPI.getPending(full.id).catch(()=> ({ data: [] }))
        ])
        if (epoch !== loadEpoch.current) return
        setSubmissions(subs.data||subs||[])
        setStats(st)
        const pendData = (pend as any)?.data ?? pend ?? []
        setPending(Array.isArray(pendData) ? pendData : [])
      } else {
        setSubmissions([]); setStats(null); setPending([])
      }
    } catch (e:any) {
      if (epoch !== loadEpoch.current) return
      console.error(e)
      toast.error(e.response?.data?.error || 'Failed to load assignment')
    } finally { if (epoch === loadEpoch.current) setLoading(false) }
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
      // PERPAGE-HALF1: optimistic patch + single notify path only. Was:
      // direct getHub + refreshTeacherData HERE plus notifyEntityMutated →
      // window listener doing getHub + refresh AGAIN = 2× getHub + 2× batch
      // per socket event. The window listener below (triggered by the notify)
      // owns the refetch, so per event there is now 1× getHub + 1× batch.
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
      }
      notifyEntityMutated('assignment')
    }
    const events = ['assignment:submission:updated','assignment:graded','assignment:offline:marked','assignment:bulk:graded','assignment:pending:updated','assignment:stats:updated','assignment:mutated','assignment:hub:updated']
    events.forEach(ev=> socket.on(ev, handler))
    return ()=> { events.forEach(ev=> socket.off(ev, handler)) }
  }, [hub?.id, isTeacher])

  // PERPAGE-HALF1: ONE window listener — was TWO listeners (onMutated +
  // onCustom) on the SAME 'assignment:mutated' event doing the same
  // getHub + refreshTeacherData, i.e. 2× GETs per mutation. Single path now.
  useEffect(()=> {
    const onMutated = (e: any) => {
      const evtHubId = e?.detail?.hubId
      if (evtHubId && hub?.id && evtHubId !== hub.id) return
      if (!hub?.id) return
      // refetch hub metadata (settings) + teacher data for any mutation on this hub
      assignmentHubAPI.getHub(hub.id).then(full=> setHub(full)).catch(()=>{})
      if (isTeacher) refreshTeacherData().catch(()=>{})
    }
    window.addEventListener('assignment:mutated', onMutated as any)
    return ()=> {
      window.removeEventListener('assignment:mutated', onMutated as any)
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
      // PERPAGE-HALF1: no direct refreshTeacherData — optimistic sets above
      // paint instantly; the notify below triggers the single window listener
      // which refetches (was: direct batch + listener batch = 2×).
      notifyEntityMutated('assignment', { hubId: hub.id, action: 'offline-marked' })
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
      // PERPAGE-HALF1: single refresh path via the notify → window listener
      // (was: direct batch + listener batch = 2×). Catch branch below keeps
      // its direct refresh to reconcile the optimistic update on failure.
      notifyEntityMutated('assignment', { hubId: hub.id, action: 'bulk-graded' })
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
    return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-black tracking-wide border ${channelBadgeClasses(isOffline)}`}>{ch}</span>
  }

  if (loading) {
    return <CenteredLoader />
  }
  if (!hub) {
    return <div className="p-8 text-center"><p className="text-surface-500 dark:text-zinc-400">Assignment not found</p><Button onClick={()=> navigate('/assignments')} className="mt-4">Back to assignments</Button></div>
  }

  const isLateHub = new Date() > new Date(hub.dueDate) && !hub.allowLateSubmission
  const dueLabel = new Date(hub.dueDate).toLocaleString(undefined, { weekday:'short', year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})

  return (
    <div className="space-y-6 max-w-[1280px] mx-auto">
      <h1 className="sr-only">Assignment Detail</h1>
      {/* ─── Premium Hero — Brand mesh, glass stats ─── */}
      <PremiumHero
        icon={<FileText size={18} />}
        eyebrow="Assignments · Detail"
        title={<span className="text-balance">{hub.title}</span>}
        subtitle={`${hub.courseId || 'General'} · ${hub.scope}${hub.department?.name?` · ${hub.department.name}`:''}${hub.room?.name?` · ${hub.room.name}`:''} · ${hub.submissionMode} · ${hub.maxPoints} pts · Due ${dueLabel}`}
        actions={
          <>
            <button onClick={()=> navigate('/assignments')} className="inline-flex items-center gap-2 px-5 h-11 rounded-full bg-white text-black text-[13px] font-black hover:bg-zinc-100 transition-colors shadow-lg">
              <ArrowLeft size={14}/> Back
            </button>
            {isTeacher && (
              <button onClick={()=> setSettingsOpen(true)} className="inline-flex items-center gap-2 px-5 h-11 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-white text-[13px] font-bold hover:bg-white/15 transition-colors">
                <Settings size={14}/> Edit
              </button>
            )}
            {isTeacher && (
              <button onClick={handleExport} className="inline-flex items-center gap-2 px-5 h-11 rounded-full bg-primary-500 text-black text-[13px] font-black hover:bg-[#1ed760] shadow-[0_8px_24px_rgba(30,215,96,0.35)] transition-colors">
                <Download size={14}/> Export CSV
              </button>
            )}
            {isLateHub && <span className="inline-flex items-center gap-1.5 px-3 h-11 rounded-full bg-[#ff4b5c] text-white text-xs font-black">Overdue</span>}
            {hub.allowLateSubmission && !isLateHub && <span className="inline-flex items-center gap-1.5 px-3 h-11 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-white text-xs font-bold">Late allowed</span>}
          </>
        }
        stats={
          <GlassPanel className="p-4">
            <p className="text-[10px] font-black tracking-[0.12em] uppercase text-white/60">Assignment Pulse</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-white p-3 dark:bg-[#121212] border border-white/10">
                <p className="text-[10px] font-black tracking-widest uppercase text-black/50 dark:text-white/60">Points</p>
                <p className="mt-1 font-display text-[22px] font-[800] leading-none text-black dark:text-white">{hub.maxPoints}</p>
                <p className="mt-1 text-[11px] font-semibold text-black/60 dark:text-white/60">{hub.submissionMode}</p>
              </div>
              <div className="rounded-2xl bg-primary-500 p-3 text-black">
                <p className="text-[10px] font-black tracking-widest uppercase text-black/60">Progress</p>
                <p className="mt-1 font-display text-[22px] font-[800] leading-none">{gradingProgress}%</p>
                <p className="mt-1 text-[11px] font-bold text-black/70">graded</p>
              </div>
              <div className="rounded-2xl bg-white/10 backdrop-blur border border-white/10 p-3 col-span-2">
                <div className="flex items-center justify-between text-white">
                  <span className="text-[11px] font-bold text-white/70 flex items-center gap-1"><Users size={11}/> Submitted</span>
                  <span className="text-sm font-black">{submissions.length}</span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden flex">
                  <div className="bg-primary-500 transition-all" style={{ width: `${submissions.length ? (channelBreakdown.online/channelBreakdown.total)*100 : 0}%` }} />
                  <div className="bg-white/60" style={{ width: `${submissions.length ? (channelBreakdown.offline/channelBreakdown.total)*100 : 0}%` }} />
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] font-semibold text-white/60">
                  <span>ONLINE {channelBreakdown.online}</span><span>·</span><span>OFFLINE {channelBreakdown.offline}</span>
                </div>
              </div>
            </div>
            {hub.description && <p className="mt-3 text-[12px] leading-relaxed text-white/70 line-clamp-3">{hub.description}</p>}
          </GlassPanel>
        }
      />
      <div className="hidden rounded-[32px] bg-[#0a0a0a] backdrop-blur-xl bg-white/[0.03] border border-white/10 grid-cols-12" />

      {isTeacher ? (
        <motion.div initial="hidden" animate="show" variants={{ hidden:{}, show:{ transition:{ staggerChildren:0.06, delayChildren:0.12 } } }} className="space-y-6">
          {/* Stats bento */}
          <motion.div variants={{ hidden:{opacity:0,y:12}, show:{opacity:1,y:0, transition:{ duration:0.4, ease:[0.22,1,0.36,1] as any } } }}>
            <SectionCard title="Overview" subtitle={`${stats?.eligible ?? '—'} eligible · ${stats?.submissionRate ?? 0}% rate`} icon={<BarChart3 size={16}/>} action={<span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-500 text-black text-[11px] font-black tracking-widest uppercase"><span className="w-1.5 h-1.5 rounded-full bg-black animate-pulse"/> Live</span>}>
              <StatsPanel stats={stats} hub={hub} isTeacher={isTeacher} />
            </SectionCard>
          </motion.div>

          {/* Analytics bento — Brand primaries */}
          <BentoGrid>
            <motion.div variants={{ hidden:{opacity:0,y:12}, show:{opacity:1,y:0, transition:{ delay:0.06, duration:0.4 } } }} className="col-span-12 md:col-span-4">
              <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] overflow-hidden h-full hover:shadow-[0_12px_32px_rgba(0,0,0,0.06)] hover:border-primary-500/20 transition-all">
                <div className="h-1.5 bg-gradient-to-r from-primary-500 via-primary-500 to-emerald-500" />
                <div className="p-5 sm:p-6">
                  <div className="flex items-center gap-2.5 mb-3">
                    <span className="w-9 h-9 rounded-xl bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center"><Layers size={16}/></span>
                    <h4 className="font-display text-[15px] font-[800] tracking-[-0.02em] text-[#0a0a0a] dark:text-white">Channel Mix</h4>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-full bg-primary-500 text-black text-xs font-black">ONLINE {channelBreakdown.online}</span>
                    <span className="px-2.5 py-1 rounded-full bg-[#0a0a0a] dark:bg-white text-white dark:text-black text-xs font-black">OFFLINE {channelBreakdown.offline}</span>
                  </div>
                  <div className="mt-3 w-full h-2 bg-surface-100 dark:bg-[#1a1a1a] rounded-full overflow-hidden flex">
                    {channelBreakdown.total>0 && <>
                      <div className="bg-primary-500" style={{ width: `${(channelBreakdown.online/channelBreakdown.total)*100}%` }} />
                      <div className="bg-[#0a0a0a] dark:bg-white" style={{ width: `${(channelBreakdown.offline/channelBreakdown.total)*100}%` }} />
                    </>}
                  </div>
                  <p className="mt-2 text-xs font-medium text-surface-500 dark:text-night-400">{channelBreakdown.total} total · online vs offline</p>
                </div>
              </div>
            </motion.div>
            <motion.div variants={{ hidden:{opacity:0,y:12}, show:{opacity:1,y:0, transition:{ delay:0.12, duration:0.4 } } }} className="col-span-12 md:col-span-4">
              <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] overflow-hidden h-full hover:shadow-[0_12px_32px_rgba(0,0,0,0.06)] hover:border-primary-500/20 transition-all">
                <div className="h-1.5 bg-gradient-to-r from-primary-500 to-emerald-500" />
                <div className="p-5 sm:p-6">
                  <div className="flex items-center gap-2.5 mb-3">
                    <span className="w-9 h-9 rounded-xl bg-primary-500 text-black flex items-center justify-center"><TrendingUp size={16}/></span>
                    <h4 className="font-display text-[15px] font-[800] tracking-[-0.02em] text-[#0a0a0a] dark:text-white">Grading Progress</h4>
                    <span className="ml-auto text-xs font-black px-2.5 py-1 rounded-full bg-primary-500 text-black">{gradingProgress}%</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-surface-600 dark:text-night-300 font-medium">{submissions.filter(s=> s.status==='GRADED').length} / {submissions.length} graded</span>
                  </div>
                  <div className="mt-3 w-full h-2 bg-surface-100 dark:bg-[#1a1a1a] rounded-full overflow-hidden">
                    <div className="h-full bg-primary-500 transition-all" style={{ width: `${gradingProgress}%` }} />
                  </div>
                  <p className="mt-2 text-xs font-medium text-surface-500 dark:text-night-400">Keep momentum — grade remaining {submissions.length - submissions.filter(s=> s.status==='GRADED').length}</p>
                </div>
              </div>
            </motion.div>
            <motion.div variants={{ hidden:{opacity:0,y:12}, show:{opacity:1,y:0, transition:{ delay:0.18, duration:0.4 } } }} className="col-span-12 md:col-span-4">
              <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] overflow-hidden h-full hover:shadow-[0_12px_32px_rgba(0,0,0,0.06)] hover:border-primary-500/20 transition-all">
                <div className="h-1.5 bg-gradient-to-r from-[#0a0a0a] dark:from-white via-primary-500 to-primary-500" />
                <div className="p-5 sm:p-6">
                  <div className="flex items-center gap-2.5 mb-3">
                    <span className="w-9 h-9 rounded-xl bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center"><Users size={16}/></span>
                    <h4 className="font-display text-[15px] font-[800] tracking-[-0.02em] text-[#0a0a0a] dark:text-white">Pending by Dept</h4>
                    <span className="ml-auto text-xs font-black px-2.5 py-1 rounded-full bg-surface-900 dark:bg-white text-white dark:text-black">{pending.length}</span>
                  </div>
                  {pendingDeptBreakdown.length===0 ? <p className="text-xs text-surface-400 dark:text-night-400 py-6 text-center border border-dashed rounded-2xl dark:border-[#282828]">No pending</p> : (
                    <div className="space-y-1.5 max-h-[92px] overflow-y-auto pr-1">
                      {pendingDeptBreakdown.map(([dept, cnt])=> (
                        <div key={dept} className="flex items-center justify-between text-xs bg-surface-50 dark:bg-[#1a1a1a] rounded-xl px-3 py-2 border border-surface-100 dark:border-[#282828]">
                          <span className="truncate font-semibold text-surface-700 dark:text-night-200">{dept}</span>
                          <span className="font-black px-1.5 py-0.5 rounded-full bg-primary-500 text-black text-[11px]">{cnt}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-xs font-medium text-surface-500 dark:text-night-400">{pending.length} pending total</p>
                </div>
              </div>
            </motion.div>
          </BentoGrid>

          {/* Filters — SectionCard premium */}
          <motion.div variants={{ hidden:{opacity:0,y:12}, show:{opacity:1,y:0, transition:{ delay:0.16, duration:0.4 } } }}>
            <SectionCard title="Filters & Actions" subtitle={`Scope: ${hub.scope} · ${filteredSubmissions.length}/${submissions.length} submitted · ${filteredPending.length}/${pending.length} pending`} icon={<Filter size={16}/>} gradient="from-primary-500 via-primary-500 to-primary-600">
              <div className="flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 min-w-[220px]">
                  <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 dark:text-zinc-500" />
                  <label htmlFor="assign-search" className="sr-only">Search submissions by name, student ID or email</label>
                  <input id="assign-search" value={search} onChange={e=> setSearch(e.target.value)} placeholder="Search name, student ID, email..." aria-label="Search submissions by name, student ID or email" className="w-full pl-9 pr-3 min-h-[44px] py-2.5 rounded-xl border border-surface-200 dark:border-[#282828] bg-surface-50 dark:bg-[#0a0a0a] text-sm text-surface-900 dark:text-white placeholder:text-[#6b7280] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2" />
                </div>
                {hub.scope==='ALL' && (
                  <select value={selectedDept} onChange={e=> setSelectedDept(e.target.value)} className="px-3 py-2.5 rounded-xl border border-surface-200 dark:border-[#282828] bg-white dark:bg-[#0a0a0a] text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 min-w-[160px]">
                    <option value="ALL">All departments</option>
                    {departments.map((d:any)=> <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                )}
                {(hub.scope==='ALL' || hub.scope==='DEPARTMENT') && availableYears.length>0 && (
                  <select value={selectedYear} onChange={e=> setSelectedYear(e.target.value)} className="px-3 py-2.5 rounded-xl border border-surface-200 dark:border-[#282828] bg-white dark:bg-[#0a0a0a] text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20">
                    <option value="ALL">All years</option>
                    {availableYears.map(y=> <option key={y} value={y}>{y}</option>)}
                  </select>
                )}
                <div className="flex items-center gap-2 ml-auto">
                  <button onClick={handleExport} className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-full bg-white dark:bg-[#1a1a1a] border border-surface-200 dark:border-[#282828] text-sm font-bold hover:border-primary-500/30 transition-colors"><Download size={14}/> Export</button>
                  <button disabled={selectedIds.size===0} onClick={()=> setBulkOpen(true)} className={clsx('inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-full text-sm font-black transition-colors', selectedIds.size===0 ? 'bg-surface-100 dark:bg-[#1a1a1a] text-surface-400 dark:text-night-500 cursor-not-allowed border border-surface-200 dark:border-[#282828]' : 'bg-[#0a0a0a] dark:bg-white text-white dark:text-black hover:bg-black dark:hover:bg-zinc-100 shadow')}>Bulk Grade ({selectedIds.size})</button>
                </div>
              </div>
              {(selectedDept!=='ALL' || selectedYear!=='ALL' || search) && <button onClick={()=>{setSearch(''); setSelectedDept('ALL'); setSelectedYear('ALL')}} className="mt-3 text-xs font-bold text-primary-600 hover:text-primary-700 dark:text-primary-400 underline">Clear filters →</button>}
            </SectionCard>
          </motion.div>

          {/* Tabs + Lists — premium */}
          <motion.div variants={{ hidden:{opacity:0,y:12}, show:{opacity:1,y:0, transition:{ delay:0.20, duration:0.4 } } }}>
            <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] overflow-hidden">
              <div className="h-1.5 bg-gradient-to-r from-primary-500 via-primary-500 to-emerald-500" />
              <div className="px-5 sm:px-6 pt-5">
                <div className="flex items-center gap-2 border-b border-surface-200 dark:border-[#282828] overflow-x-auto">
                  <button onClick={()=> setActiveTab('submitted')} className={`px-4 py-2.5 text-sm font-black border-b-2 whitespace-nowrap transition ${activeTab==='submitted' ? 'border-primary-500 text-primary-600 dark:text-primary-400' : 'border-transparent text-surface-500 hover:text-surface-700 dark:text-night-400'}`}>Submitted ({filteredSubmissions.length}{filteredSubmissions.length!==submissions.length?` / ${submissions.length}`:''})</button>
                  <button onClick={()=> setActiveTab('pending')} className={`px-4 py-2.5 text-sm font-black border-b-2 whitespace-nowrap transition ${activeTab==='pending' ? 'border-primary-500 text-primary-600 dark:text-primary-400' : 'border-transparent text-surface-500 hover:text-surface-700 dark:text-night-400'}`}>Pending ({filteredPending.length}{filteredPending.length!==pending.length?` / ${pending.length}`:''})</button>
                  <div className="ml-auto pb-2 hidden sm:flex items-center gap-2 text-xs font-medium text-surface-400 dark:text-night-400"><span className="w-2 h-2 rounded-full bg-primary-500 animate-pulse"/>{pending.length} pending · {submissions.length} submitted</div>
                </div>
              </div>

              <div className="p-5 sm:p-6">
              {activeTab==='submitted' ? (
                <div className="space-y-3">
                  {filteredSubmissions.length>0 && (
                    <div className="flex items-center justify-between gap-2 p-3 bg-surface-50 dark:bg-[#0a0a0a] rounded-2xl border border-surface-200 dark:border-[#282828]">
                      <label className="flex items-center gap-2.5 cursor-pointer select-none text-sm">
                        <input type="checkbox" checked={filteredSubmissions.length>0 && filteredSubmissions.every((s:any)=> selectedIds.has(s.student?.id || s.studentId))} onChange={toggleSelectAll} className="w-4 h-4 rounded border-surface-300 dark:border-[#3a3a3a] text-primary-600 focus:ring-primary-500/20 bg-white dark:bg-[#1a1a1a]" />
                        <span className="font-bold text-surface-800 dark:text-night-200">{filteredSubmissions.every((s:any)=> selectedIds.has(s.student?.id || s.studentId)) && filteredSubmissions.length>0 ? 'Deselect filtered' : 'Select filtered'}</span>
                        {selectedIds.size>0 && <span className="text-primary-600 dark:text-primary-400 font-black">{selectedIds.size} selected</span>}
                      </label>
                      <button disabled={selectedIds.size===0} onClick={()=> setBulkOpen(true)} className={clsx('px-3 py-1.5 rounded-full text-xs font-black', selectedIds.size===0 ? 'bg-surface-200 dark:bg-[#1a1a1a] text-surface-400' : 'bg-primary-500 text-black')}>Bulk Grade ({selectedIds.size})</button>
                    </div>
                  )}
                  {filteredSubmissions.map((s:any)=> {
                    const checked = selectedIds.has(s.student?.id || s.studentId)
                    return (
                      <div key={s.id} className={clsx('flex items-center justify-between p-4 border rounded-[16px] gap-3 transition-all', checked ? 'bg-primary-50/70 dark:bg-primary-500/10 border-primary-200 dark:border-primary-500/30 shadow-sm' : 'bg-white dark:bg-[#0a0a0a] border-surface-200 dark:border-[#282828] hover:border-surface-300 dark:hover:border-[#3a3a3a] hover:shadow-sm')}>
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <input type="checkbox" checked={checked} onChange={()=> toggleSelect(s.student?.id || s.studentId)} className="w-4 h-4 rounded border-surface-300 dark:border-[#3a3a3a] text-primary-600 focus:ring-primary-500/20 bg-white dark:bg-[#1a1a1a] shrink-0" />
                          <div className="min-w-0">
                            <div className="font-bold text-sm flex flex-wrap items-center gap-2 text-[#0a0a0a] dark:text-white">
                              <span className="truncate">{s.student?.name} <span className="text-surface-500 dark:text-night-400 font-medium">{s.student?.studentId}</span></span>
                              {channelBadge(s)}
                              {s.points !== null && s.points !== undefined && <span className="text-xs px-2 py-0.5 rounded-full bg-[#0a0a0a] dark:bg-white text-white dark:text-black font-black">{s.points}/{hub.maxPoints}</span>}
                              {s.status==='GRADED' && <span className="w-5 h-5 rounded-full bg-primary-500 flex items-center justify-center"><CheckCircle2 size={12} className="text-black"/></span>}
                            </div>
                            <div className="text-xs text-surface-500 dark:text-night-400 flex flex-wrap gap-1.5 mt-1">
                              <span className="inline-flex items-center gap-1"><Clock size={10}/>{s.status} • {new Date(s.submittedAt).toLocaleString()}</span>
                              {(s as any).offlineNote && <span className="px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-900/30 font-medium">• {(s as any).offlineNote.slice(0,40)}</span>}
                              {s.student?.departmentName && <span>• {s.student.departmentName}</span>}
                              {s.student?.incomingYear && <span>• Year {s.student.incomingYear}</span>}
                            </div>
                          </div>
                        </div>
                        <button onClick={()=> setGrading(s)} className="shrink-0 inline-flex items-center gap-1 min-h-[40px] px-4 rounded-full bg-[#0a0a0a] dark:bg-white text-white dark:text-black text-xs font-black hover:bg-black dark:hover:bg-zinc-100 transition-colors">Grade <ChevronRight size={12}/></button>
                      </div>
                    )
                  })}
                  {filteredSubmissions.length===0 && <div className="text-sm text-surface-400 dark:text-night-400 py-8 text-center border border-dashed rounded-2xl dark:border-[#282828] bg-surface-50/50 dark:bg-[#0a0a0a]/50">No submissions match filters</div>}
                  {filteredSubmissions.length===0 && submissions.length>0 && <div className="text-xs text-center text-surface-400 dark:text-zinc-500">Try clearing department / year / search filters</div>}
                  {filteredSubmissions.length===0 && submissions.length===0 && <div className="text-sm text-surface-400 dark:text-night-400 py-8 text-center border border-dashed rounded-2xl dark:border-[#282828]">No submissions yet — pending students appear in the Pending tab.</div>}
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredPending.map((stu:any)=> (
                    <div key={stu.id} className="flex items-center justify-between p-4 border rounded-[16px] dark:border-[#282828] bg-white dark:bg-[#0a0a0a] gap-3 hover:border-surface-300 dark:hover:border-[#3a3a3a] hover:shadow-sm transition-all">
                      <div className="min-w-0 flex-1 flex items-center gap-3">
                        <span className="w-10 h-10 rounded-xl bg-surface-100 dark:bg-[#1a1a1a] border border-surface-200 dark:border-[#282828] flex items-center justify-center font-black text-surface-600 dark:text-night-300 shrink-0">{stu.name?.charAt(0)?.toUpperCase() || '?'}</span>
                        <div className="min-w-0">
                          <div className="font-bold text-sm truncate text-[#0a0a0a] dark:text-white">{stu.name} <span className="text-surface-500 dark:text-night-400 font-medium">{stu.studentId}</span></div>
                          <div className="text-xs text-surface-500 dark:text-night-400 truncate flex flex-wrap gap-1.5">
                            <span>{stu.email}</span>
                            {stu.departmentName && <span>• {stu.departmentName}</span>}
                            {stu.incomingYear && <span>• Year {stu.incomingYear}</span>}
                          </div>
                        </div>
                      </div>
                      <button onClick={()=> { setOfflineTarget(stu); setOfflineNote(''); setOfflinePoints(''); setOfflineGrade(''); setOfflineFeedback('') }} className="shrink-0 inline-flex items-center gap-1 min-h-[40px] px-4 rounded-full bg-primary-500 text-black text-xs font-black hover:bg-[#1ed760] shadow">Mark Offline <ChevronRight size={12}/></button>
                    </div>
                  ))}
                  {filteredPending.length===0 && pending.length>0 && <div className="text-sm text-surface-400 dark:text-night-400 py-8 text-center border border-dashed rounded-2xl dark:border-[#282828]">No pending students match filters</div>}
                  {filteredPending.length===0 && pending.length===0 && <div className="text-sm py-8 text-center border border-dashed rounded-2xl dark:border-[#282828] bg-primary-50/50 dark:bg-primary-500/5"><span className="inline-flex items-center gap-2 font-bold text-primary-700 dark:text-primary-300"><CheckCircle2 size={16}/> All eligible students have submitted 🎉</span></div>}
                </div>
              )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : (
        <motion.div initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }} transition={{ duration:0.45, ease:[0.22,1,0.36,1] as any }}>
          <SectionCard title="Your Submission" subtitle={`${hub.submissionMode} · ${hub.maxPoints} pts · ${isLateHub?'Overdue':'Open'}`} icon={<GraduationCap size={16}/>} gradient="from-primary-500 via-primary-500 to-emerald-500" action={<button onClick={()=> navigate('/assignments')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-100 dark:bg-[#1a1a1a] border border-surface-200 dark:border-[#282828] text-xs font-bold">Back to list</button>}>
            <SubmissionPanel hub={hub} submission={hub.mySubmission} onSubmitted={()=> { loadHub(); notifyEntityMutated('assignment') }} onClose={()=> navigate('/assignments')} />
          </SectionCard>
        </motion.div>
      )}

      {/* Offline marking modal — marks optional */}
      <Modal open={!!offlineTarget} onClose={()=> { setOfflineTarget(null); setOfflineNote(''); setOfflinePoints(''); setOfflineGrade(''); setOfflineFeedback('') }} title={offlineTarget ? `Mark offline: ${offlineTarget.name}` : 'Mark offline'} size="sm">
        <div className="space-y-4">
          {offlineTarget && <div className="text-sm text-surface-600 dark:text-night-300"><div className="font-bold text-[#0a0a0a] dark:text-white">{offlineTarget.name} <span className="text-surface-500 dark:text-zinc-400 font-medium">{offlineTarget.studentId}</span></div><div className="text-xs text-surface-500 dark:text-night-400">{offlineTarget.email}</div></div>}
          <div>
            <label className="block text-sm font-bold mb-1 text-[#0a0a0a] dark:text-white">Offline note <span className="text-[#ff4b5c]">*</span></label>
            <textarea value={offlineNote} onChange={e=> setOfflineNote(e.target.value)} rows={3} placeholder="Receipt no., roll, desk, or remarks — e.g., Received paper copy at dept office, roll 21CS042" className="w-full px-4 py-3 bg-surface-50 dark:bg-[#0a0a0a] border border-surface-200 dark:border-[#282828] rounded-xl text-sm text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" />
            <p className="text-xs text-surface-400 dark:text-night-400 mt-1">Creates an OFFLINE submission for this student (bypasses ONLINE file check).</p>
          </div>
          <div className="rounded-xl border border-primary-200 dark:border-primary-900/30 bg-primary-50/60 dark:bg-primary-500/10 p-3 space-y-3">
            <div className="text-xs font-black tracking-wide uppercase text-primary-700 dark:text-primary-300">Optional — grade now or later</div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-bold mb-1 text-[#0a0a0a] dark:text-white">Points (max {hub?.maxPoints})</label><Input type="number" value={offlinePoints} onChange={e=> setOfflinePoints(e.target.value)} placeholder="—" /></div>
              <div><label className="block text-xs font-bold mb-1 text-[#0a0a0a] dark:text-white">Grade</label><Input value={offlineGrade} onChange={e=> setOfflineGrade(e.target.value)} placeholder="A" /></div>
            </div>
            <div><label className="block text-xs font-bold mb-1 text-[#0a0a0a] dark:text-white">Feedback (optional)</label><textarea value={offlineFeedback} onChange={e=> setOfflineFeedback(e.target.value)} rows={2} className="w-full px-3 py-2 bg-white dark:bg-[#0a0a0a] border border-surface-200 dark:border-[#282828] rounded-xl text-sm text-surface-900 dark:text-white" placeholder="Well done, etc. — leave blank to grade later" /></div>
            <p className="text-[11px] font-medium text-primary-700 dark:text-primary-300">Leave blank to mark as Submitted. Add marks here to create as Graded in one step.</p>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={()=> { setOfflineTarget(null); setOfflineNote(''); setOfflinePoints(''); setOfflineGrade(''); setOfflineFeedback('') }} className="flex-1">Cancel</Button>
            <Button onClick={handleOfflineMark} disabled={offlineSaving || !offlineNote.trim()} className="flex-1 !bg-primary-500 !text-black hover:!bg-[#1ed760] font-black">{offlineSaving ? 'Saving...' : (offlinePoints.trim()||offlineGrade.trim()||offlineFeedback.trim()) ? 'Mark & Grade' : 'Mark Submitted'}</Button>
          </div>
        </div>
      </Modal>

      {/* Bulk grade modal */}
      <Modal open={bulkOpen} onClose={()=> setBulkOpen(false)} title={`Bulk grade (${selectedIds.size})`} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-surface-500 dark:text-night-400">Applies the same points / grade / feedback to all {selectedIds.size} selected submission(s).</p>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-bold mb-1 text-[#0a0a0a] dark:text-white">Points (max {hub?.maxPoints})</label><Input type="number" value={bulkPoints} onChange={e=> setBulkPoints(e.target.value)} placeholder="85" /></div>
            <div><label className="block text-sm font-bold mb-1 text-[#0a0a0a] dark:text-white">Grade</label><Input value={bulkGrade} onChange={e=> setBulkGrade(e.target.value)} placeholder="A" /></div>
          </div>
          <div><label className="block text-sm font-bold mb-1 text-[#0a0a0a] dark:text-white">Feedback</label><textarea value={bulkFeedback} onChange={e=> setBulkFeedback(e.target.value)} rows={3} className="w-full px-4 py-3 bg-surface-50 dark:bg-[#0a0a0a] border border-surface-200 dark:border-[#282828] rounded-xl text-sm text-surface-900 dark:text-white" placeholder="Well done, etc." /></div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={()=> setBulkOpen(false)} className="flex-1">Cancel</Button>
            <Button onClick={handleBulkGrade} disabled={bulkSaving || selectedIds.size===0} className="flex-1 !bg-primary-500 !text-black font-black">{bulkSaving ? 'Saving...' : `Apply to ${selectedIds.size}`}</Button>
          </div>
        </div>
      </Modal>

      {grading && <GradeModal key={grading.id} submission={grading} hub={hub} open={!!grading} onClose={()=> setGrading(null)} onGraded={async (updated:any)=> {
        if (updated?.id) {
          setSubmissions(prev => prev.map(s=> s.id===updated.id ? { ...s, ...updated, student: updated.student || s.student } : s))
        }
        // PERPAGE-HALF1: optimistic map above + notify → listener refresh
        // (was + direct batch = 2×).
        notifyEntityMutated('assignment', { hubId: hub?.id, action: 'graded' })
      }} />}

      {/* Settings edit modal — gear icon in header */}
      <CreateAssignmentModal
        open={settingsOpen}
        hub={hub}
        onClose={()=> setSettingsOpen(false)}
        onSaved={async ()=> {
          await loadHub()
          notifyEntityMutated('assignment', { hubId: hub?.id, action: 'updated' })
          setSettingsOpen(false)
        }}
      />
    </div>
  )
}
