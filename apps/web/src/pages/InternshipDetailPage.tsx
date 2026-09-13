import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { internshipAPI } from '../lib/api'
import { useDepartments } from '../hooks/useDepartments'
import { notifyEntityMutated, useEntitySync } from '../lib/entitySync'
import {
  ArrowLeft, Briefcase, Calendar, Users, ExternalLink, Download,
  Loader2, CheckCircle, Clock, Plus,
  Edit, Trash2, MapPin, Timer, DollarSign,
  Target, GraduationCap, BookOpen, CircleDot, Rocket, Printer,
  Lightbulb, Star, Zap, XCircle, Building2, Info, Shield, Link2, List,
  Search, Filter, BarChart3, TrendingUp, Bell, Send
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import type { Department } from '../types/api'
import { PremiumHero, GlassPanel, BentoGrid, BentoCard, SectionCard } from '../components/premium/PremiumKit'
import { motion } from 'framer-motion'
import CenteredLoader from '../components/ui/CenteredLoader'
import { useConfirm } from '../components/ui/ConfirmModal'

export default function InternshipDetailPage() {
  const { confirm: confirmDialog } = useConfirm()
  const { id } = useParams<{ id: string }>()
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [internship, setInternship] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  // PERPAGE-HALF1: shared cached departments (was an uncached mount GET,
  // duplicated across 7 pages). Same array data; RQ dedupes StrictMode
  // double-mount and shares one 10min-stale entry app-wide.
  const { data: departmentsData } = useDepartments()
  const departments: any[] = Array.isArray(departmentsData) ? departmentsData : []
  // Epoch guard: rapid id switches must not let a stale getOne resolve
  // paint over the fresh internship.
  const loadEpoch = useRef(0)
  const [showRegister, setShowRegister] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [reportStatus, setReportStatus] = useState('SELECTED')
  const [showRegistrations, setShowRegistrations] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  // Remind-registered (#5 leftovers): teacher modal state
  const [showRemind, setShowRemind] = useState(false)
  const [remindMessage, setRemindMessage] = useState('')
  const [reminding, setReminding] = useState(false)
  // ── Registrations analytics + filters (keep like AssignmentDetail) ──
  const [regSearch, setRegSearch] = useState('')
  const [regDept, setRegDept] = useState('ALL')
  const [regYear, setRegYear] = useState('ALL')

  const isTeacher = user?.role === 'TEACHER' || user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'
  const isStudent = user?.role === 'STUDENT'
  const myRegistration = internship?.registrations?.find((r: any) => r.userId === user?.id)

  const handlePrint = () => window.print()


  useEffect(() => {
    if (id) loadInternship()
    // Departments now come from the shared useDepartments() hook above —
    // the old uncached mount fetch was removed (PERPAGE-HALF1).
  }, [id])

  const loadInternship = async () => {
    const epoch = ++loadEpoch.current
    try {
      const data = await internshipAPI.getOne(id!)
      if (epoch !== loadEpoch.current) return
      setInternship(data)
    } catch (err) {
      if (epoch !== loadEpoch.current) return
      toast.error('Failed to load internship')
      navigate('/internships')
    } finally {
      if (epoch === loadEpoch.current) setLoading(false)
    }
  }

  const handleRegister = async () => {
    try {
      await internshipAPI.register(id!)
      toast.success('Registered successfully!')
      setShowRegister(false)
      notifyEntityMutated('internship')
      loadInternship()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to register')
    }
  }

  const handleUnregister = async () => {
    if (!myRegistration) return
    const ok = await confirmDialog({
      title: 'Unregister?',
      message: `Withdraw your application for "${internship?.title}"? You can re-register later.`,
      confirmLabel: 'Unregister',
    })
    if (!ok) return
    try {
      await internshipAPI.unregister(id!)
      toast.success('Unregistered — you can re-register anytime')
      notifyEntityMutated('internship')
      loadInternship()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to unregister')
    }
  }

  const handleRemind = async () => {
    const message = remindMessage.trim()
    if (!message) {
      toast.error('Message is required')
      return
    }
    setReminding(true)
    try {
      const res: any = await internshipAPI.remind(id!, message)
      const n = res?.notified ?? 0
      toast.success(n > 0 ? `Reminded ${n} registered student${n === 1 ? '' : 's'}!` : 'No registered students to remind')
      setShowRemind(false)
      setRemindMessage('')
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to send reminders')
    } finally {
      setReminding(false)
    }
  }

  const handleReport = async () => {
    try {
      await internshipAPI.report(id!, reportStatus)
      toast.success('Status reported!')
      setShowReport(false)
      loadInternship()
    } catch (err) {
      toast.error('Failed to report status')
    }
  }

  const handleExport = async () => {
    try {
      const blob = await internshipAPI.exportOne(internship.id)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${internship.title.replace(/\s+/g, '_')}-registrations.xlsx`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      toast.success('Exported!')
    } catch (err) {
      toast.error('Export failed')
    }
  }

  // ── Countdown hooks — MUST be unconditional before early returns (hooks order fix) ──
  // All hooks declared at top level before any conditional return; null-safe args.
  const countdownTarget: Date | null = internship?.deadline
    ? new Date(internship.deadline)
    : internship?.startDate ? new Date(internship.startDate) : null
  const countdownLabel: string = (() => {
    if (!internship) return ''
    if (internship.deadline && new Date(internship.deadline).getTime() > Date.now()) return 'Applications close in'
    if (internship.startDate && new Date(internship.startDate).getTime() > Date.now()) return 'Starts in'
    return ''
  })()
  const [__tick, set__tick] = useState<number>(Date.now())
  // STATE-SYNC: external mutations (other tab/device) refresh without reload.
  useEntitySync('internship', loadInternship as any)
  useEffect(() => {
    if (!countdownTarget || countdownTarget.getTime() <= Date.now()) return
    const id = setInterval(() => set__tick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [countdownTarget?.toISOString() ?? ''])
  const countdownParts = (() => {
    if (!countdownTarget) return null
    const diff = countdownTarget.getTime() - __tick
    if (diff <= 0) return null
    return {
      d: Math.floor(diff / 86400000),
      h: Math.floor((diff % 86400000) / 3600000),
      m: Math.floor((diff % 3600000) / 60000),
      s: Math.floor((diff % 60000) / 1000),
    }
  })()
  const countdown: string | null = countdownParts
    ? countdownParts.d > 0 ? `${countdownParts.d}d ${countdownParts.h}h left` : countdownParts.h > 0 ? `${countdownParts.h}h ${countdownParts.m}m left` : `${countdownParts.m}m ${countdownParts.s}s left`
    : null
  const isUrgent = (() => {
    const dl = internship?.deadline ? new Date(internship.deadline).getTime() : null
    if (!dl) return false
    const diff = dl - Date.now()
    return diff > 0 && diff <= 3 * 24 * 60 * 60 * 1000
  })()
  const isCritical = countdownParts !== null && countdownParts.d === 0 && countdownParts.h < 6

  // -- Registrations derived for analytics + dept/year filters (MUST be before early returns -- hooks order fix) --
  const regAvailableYears = useMemo(() => {
    const s = new Set<string>()
    ;(internship?.registrations ?? []).forEach((r: any) => { if (r.user?.incomingYear) s.add(String(r.user.incomingYear)) })
    return Array.from(s).sort()
  }, [internship])
  const regDeptBreakdown = useMemo(() => {
    const m = new Map<string, number>()
    ;(internship?.registrations ?? []).forEach((r: any) => {
      const key = r.user?.department?.name || r.user?.department || r.user?.departmentName || 'Unknown'
      const label = typeof key === 'string' && key.trim() ? key.trim() : 'Unknown'
      m.set(label, (m.get(label) || 0) + 1)
    })
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [internship])
  const regYearBreakdown = useMemo(() => {
    const m = new Map<string, number>()
    ;(internship?.registrations ?? []).forEach((r: any) => {
      const y = r.user?.incomingYear ? String(r.user.incomingYear) : 'Unknown'
      m.set(y, (m.get(y) || 0) + 1)
    })
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [internship])
  const filteredRegs = useMemo(() => {
    const term = regSearch.trim().toLowerCase()
    return (internship?.registrations ?? []).filter((r: any) => {
      if (term) {
        const hay = `${r.user?.name || ''} ${r.user?.email || ''} ${r.user?.studentId || ''}`.toLowerCase()
        if (!hay.includes(term)) return false
      }
      if (regDept !== 'ALL') {
        const deptObj = departments.find(d => d.id === regDept)
        const deptName = deptObj?.name
        const userDeptId = r.user?.departmentId
        const userDeptName = r.user?.department?.name || r.user?.department || r.user?.departmentName
        if (userDeptId) { if (userDeptId !== regDept) return false } else if (deptName) { if (String(userDeptName).toLowerCase() !== deptName.toLowerCase()) return false } else { if (String(userDeptName) !== regDept) return false }
      }
      if (regYear !== 'ALL') {
        if (String(r.user?.incomingYear ?? '') !== regYear) return false
      }
      return true
    })
  }, [internship, regSearch, regDept, regYear, departments])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[45vh]">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    )
  }

  if (!internship) return null

  const safeParse = (val: string): string[] => {
    if (!val) return []
    if (Array.isArray(val)) return val
    if (typeof val === 'string') {
      try {
        const parsed = JSON.parse(val)
        return Array.isArray(parsed) ? parsed : [parsed]
      } catch {
        return val.trim() ? [val] : []
      }
    }
    return []
  }

  const targetDeptIds: string[] = safeParse(internship.targetDepartments)
  const targetYears: number[] = safeParse(internship.targetYears).map(Number)
  const isUUID = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  const targetDeptNames = targetDeptIds.length > 0
    ? departments.filter(d => targetDeptIds.some(t => isUUID(t) ? t === d.id : t.toUpperCase() === d.name.toUpperCase())).map(d => d.name)
    : []

  const isEligible = !internship.eligibilityEnabled || (() => {
    if (!user || user.role !== 'STUDENT') return true
    if (targetDeptIds.length > 0 && (!user.departmentId || !targetDeptIds.some(t => isUUID(t) ? t === user.departmentId : t.toUpperCase() === (user.department?.name || '').toUpperCase()))) return false
    if (targetYears.length > 0 && user.incomingYear) {
      const currentYear = Math.min(new Date().getFullYear() - user.incomingYear + 1, 4)
      if (!targetYears.includes(currentYear)) return false
    }
    return true
  })()

  const getStatusBadge = () => {
    const now = new Date()
    const startDate = internship.startDate ? new Date(internship.startDate) : null
    const deadline = internship.deadline ? new Date(internship.deadline) : null
    if (internship.status === 'ENDED') return { label: 'Ended', color: 'bg-zinc-700' }

    if (startDate) {
      if (now < startDate) return { label: 'Upcoming', color: 'bg-primary-600' }
      return { label: 'Active', color: 'bg-emerald-600' }
    }
    if (deadline) {
      if (now < deadline) return { label: 'Upcoming', color: 'bg-primary-600' }
      return { label: 'Active', color: 'bg-emerald-600' }
    }
    return { label: 'Upcoming', color: 'bg-primary-600' }
  }

  const statusBadge = getStatusBadge()
  const selectedCount = internship.registrations?.filter((r: any) => r.status === 'SELECTED').length || 0
  const rejectedCount = internship.registrations?.filter((r: any) => r.status === 'REJECTED').length || 0
  const totalRegs = internship.registrations?.length || 0
  const successRate = totalRegs>0 ? Math.round((selectedCount/totalRegs)*100) : 0

  const handleExportFiltered = () => {
    if(filteredRegs.length===0){ toast.error('No registrations to export'); return }
    const header=['Roll No','Name','Email','Department','Status','Reported At']
    const esc=(v:any)=>{ const s=String(v??''); if(s.includes(',')||s.includes('"')||s.includes('\n')) return `"${s.replace(/"/g,'""')}"`; return s }
    const lines=[header.map(esc).join(',')]
    filteredRegs.forEach((r:any)=>{
      const cols=[r.user?.studentId||'',r.user?.name||'',r.user?.email||'',r.user?.department?.name||r.user?.department||r.user?.departmentName||'',r.status||'',r.reportedAt?new Date(r.reportedAt).toLocaleDateString():'']
      lines.push(cols.map(esc).join(','))
    })
    const blob=new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8;'})
    const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`internship-${internship.id}-filtered-${new Date().toISOString().slice(0,10)}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000); toast.success(`Exported ${filteredRegs.length} rows`)
  }

  const tabs = [
    { key: 'overview', label: 'Overview', icon: Info },
    { key: 'eligibility', label: 'Eligibility', icon: Shield },
    { key: 'registrations', label: 'Registrations', icon: List },
  ]

  return (
    <div className="space-y-6 max-w-[1280px] mx-auto">
      <h1 className="sr-only">Internship Detail</h1>
      <div className="hidden rounded-[32px] bg-[#0a0a0a] backdrop-blur-[18px] bg-white/[0.010] border border-white/[0.035] grid-cols-12 from-primary-500/[0.035] via-white/[0.008] to-emerald-500/[0.04] from-primary-500/[0.07] w-[460px] h-[460px] blur-[72px] opacity-[0.018] bg-white/[0.032] dark:bg-white/[0.028] bg-white/[0.025] backdrop-blur-md border-white/[0.035] dark:border-white/[0.035] bg-white/[0.035] border-white/[0.06] backdrop-blur-[12px] before:h-px bg-white/[0.035] dark:bg-white/[0.010] dark:border-white/[0.035] bg-white/[0.015] via-white/[0.008] from-primary-500/[0.035] opacity-[0.018]" />
      {/* ─── Premium Hero — Brand mesh, glass stats, countdown ─── */}
      <PremiumHero
        icon={<Briefcase size={18} />}
        eyebrow={`Opportunities · Internship${internship.mode ? ' · ' + internship.mode : ''}${isUrgent ? ' · Due soon' : ''}`}
        title={<span className="text-balance">{internship.title}</span>}
        subtitle={`${internship.company ? internship.company + ' · ' : ''}${internship.role || 'Intern'}${internship.mode ? ' · ' + internship.mode : ''} — ${internship.registrations?.length || 0} registered${internship.stipend ? ' · ' + internship.stipend : ''}${internship.duration ? ' · ' + internship.duration : ''}`}
        actions={
          <>
            <button onClick={() => navigate('/internships')} className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full bg-white dark:bg-white text-black dark:text-black text-[12px] font-black hover:bg-zinc-100 dark:hover:bg-zinc-100 transition-colors shadow-md">
              <ArrowLeft size={13}/> Back
            </button>
            {internship.url && (
              <a href={internship.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full bg-white/10 dark:bg-white/10 backdrop-blur-md border border-white/15 dark:border-white/15 text-white dark:text-white text-[12px] font-bold hover:bg-white/15 dark:hover:bg-white/15 transition-colors">
                <ExternalLink size={13}/> Website
              </a>
            )}
            {isTeacher && (
              <>
                <button onClick={handlePrint} className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full bg-white/10 dark:bg-white/10 backdrop-blur-md border border-white/15 dark:border-white/15 text-white dark:text-white text-[12px] font-bold hover:bg-white/15 dark:hover:bg-white/15 transition-colors">
                  <Printer size={13}/> Print
                </button>
                <button onClick={handleExport} className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full bg-primary-500 dark:bg-primary-500 text-black dark:text-black text-[12px] font-black hover:bg-[#1ed760] dark:hover:bg-[#1ed760] shadow-[0_6px_16px_rgba(30,215,96,0.30)] transition-colors">
                  <Download size={13}/> Export
                </button>
              </>
            )}
            <span className={`inline-flex items-center gap-1.5 px-3 h-9 rounded-full text-xs font-black ${statusBadge.color} text-white dark:text-white shadow ${isUrgent ? 'ring-2 ring-white/20 dark:ring-white/20 animate-pulse' : ''}`}>{statusBadge.label.toUpperCase()}</span>
          </>
        }
        stats={
          <GlassPanel className="p-3">
            <p className="text-[10px] font-black tracking-[0.12em] uppercase text-white/60 dark:text-white/60 flex items-center justify-between">
              <span>Internship Pulse</span>
              {isUrgent && <span className="w-2 h-2 rounded-full bg-danger-500 dark:bg-danger-500 animate-pulse shadow-[0_0_0_4px_rgba(255,75,92,0.2)]" />}
            </p>
            <div className="mt-2.5 grid grid-cols-2 gap-1.5">
              <div className="rounded-xl bg-white dark:bg-[#121212] p-2.5 border border-white/10 dark:border-white/10 hover:-translate-y-0.5 transition-transform">
                <p className="text-[10px] font-black tracking-widest uppercase text-black/50 dark:text-white/60">Registered</p>
                <p className="mt-1 font-display text-[18px] font-[800] leading-none text-black dark:text-white">{internship.registrations?.length || 0}</p>
                <p className="mt-1 text-[10px] font-semibold text-black/60 dark:text-white/60">{selectedCount} selected</p>
              </div>
              <div className="rounded-xl bg-primary-500 dark:bg-primary-500 p-2.5 text-black dark:text-black hover:-translate-y-0.5 transition-transform shadow-[0_6px_16px_rgba(30,215,96,0.22)]">
                <p className="text-[10px] font-black tracking-widest uppercase text-black/60 dark:text-black/60">Status</p>
                <p className="mt-1 font-display text-[14px] font-[800] leading-none truncate text-black dark:text-black">{statusBadge.label}</p>
                <p className="mt-1 text-[10px] font-bold text-black/70 dark:text-black/70">{internship.mode || 'TBD'}</p>
              </div>
            </div>
            {/* Stipend spotlight — premium glass next to timer */}
            {(internship.stipend || internship.company) && (
              <div className="mt-2.5 rounded-xl bg-white/[0.032] dark:bg-white/[0.028] backdrop-blur-md border border-white/[0.035] dark:border-white/[0.035] p-2.5 flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary-500 to-emerald-500 flex items-center justify-center text-black shadow shrink-0"><DollarSign size={14}/></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-black tracking-widest uppercase text-zinc-500 dark:text-white/60 leading-none">Stipend Spotlight</p>
                  <p className="text-[12px] font-black text-zinc-900 dark:text-white truncate mt-1">{internship.stipend || 'Unpaid / Not disclosed'}</p>
                  <p className="text-[10px] font-bold text-zinc-500 dark:text-white/60 truncate">{internship.company || 'Company'} · {internship.role || 'Intern'} · {internship.duration || 'TBD'}</p>
                </div>
              </div>
            )}
            <div className="mt-2.5 rounded-xl bg-white/[0.025] dark:bg-white/[0.025] backdrop-blur-md border border-white/[0.035] dark:border-white/[0.035] p-2.5">
              {internship.company && (
                <div className="flex items-center gap-2 text-white dark:text-white">
                  <span className="w-7 h-7 rounded-lg bg-white dark:bg-white text-black dark:text-black flex items-center justify-center shadow"><Building2 size={12}/></span>
                  <span className="text-xs font-black truncate text-white dark:text-white">{internship.company}</span>
                  {internship.role && <span className="text-[11px] font-bold text-white/60 dark:text-white/60 truncate">· {internship.role}</span>}
                </div>
              )}
              <div className="mt-2 flex items-center gap-3 text-[11px] font-bold text-white/70 dark:text-white/70">
                {internship.stipend && <span className="inline-flex items-center gap-1"><DollarSign size={11}/>{internship.stipend}</span>}
                {internship.duration && <span className="inline-flex items-center gap-1"><Timer size={11}/>{internship.duration}</span>}
              </div>
              {internship.deadline && <p className="mt-1 text-[11px] font-bold text-white/50 dark:text-white/50 flex items-center gap-1"><Clock size={11}/> Deadline {new Date(internship.deadline).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric'})}</p>}
              {internship.startDate && <p className="mt-0.5 text-[11px] font-medium text-white/50 dark:text-white/50 flex items-center gap-1"><Calendar size={11}/> Starts {new Date(internship.startDate).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric'})}</p>}
            </div>
            {/* Countdown — premium 4-box grid in banner next to stipend spotlight */}
            {countdownParts ? (
              <div className="mt-2.5">
                <p className="text-[10px] font-black tracking-widest uppercase text-white/60 dark:text-white/60 mb-1.5 flex items-center gap-1.5">
                  <Timer size={10} className="text-primary-400 dark:text-primary-400" /> {countdownLabel}
                  {isCritical && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-danger-500 dark:bg-danger-500 animate-pulse" />}
                </p>
                <div className="grid grid-cols-4 gap-1.5">
                  {[
                    { label: 'Days', value: String(countdownParts.d).padStart(2,'0') },
                    { label: 'Hrs', value: String(countdownParts.h).padStart(2,'0') },
                    { label: 'Mins', value: String(countdownParts.m).padStart(2,'0') },
                    { label: 'Secs', value: String(countdownParts.s).padStart(2,'0') },
                  ].map((box) => (
                    <div key={box.label} className={clsx('rounded-xl p-2 bg-white/[0.028] dark:bg-white/[0.025] border backdrop-blur-md text-center shadow-sm', isCritical ? 'border-danger-500/30 dark:border-danger-500/30 animate-pulse' : 'border-white/[0.035] dark:border-white/[0.035]')}>
                      <p className="font-mono tabular-nums text-[15px] font-black leading-none text-zinc-900 dark:text-white">{box.value}</p>
                      <p className="text-[8px] font-black tracking-widest uppercase text-zinc-500 dark:text-white/60 mt-1">{box.label}</p>
                    </div>
                  ))}
                </div>
                {isCritical && <p className="mt-1.5 text-[10px] font-black tracking-widest uppercase text-danger-400 dark:text-danger-400">Ending soon</p>}
              </div>
            ) : countdownTarget ? (
              <div className="mt-2.5 rounded-xl bg-white/[0.025] dark:bg-white/[0.025] backdrop-blur-md border border-white/[0.035] dark:border-white/[0.035] p-2.5 text-center">
                <p className="text-xs font-black text-white/70 dark:text-white/70">Applications closed</p>
                {internship.startDate && <p className="text-[11px] font-medium text-white/50 dark:text-white/50 mt-0.5">Started {new Date(internship.startDate).toLocaleDateString()}</p>}
              </div>
            ) : null}
          </GlassPanel>
        }
      />

      {/* ─── Tabs — premium pill Brand ─── */}
      <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] p-2 flex items-center gap-1.5 flex-wrap overflow-x-auto print:hidden shadow-sm">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={clsx(
                'inline-flex items-center gap-1.5 px-4 h-10 rounded-full text-sm font-black whitespace-nowrap transition-all active:scale-[0.98]',
                activeTab === key
                  ? 'bg-primary-500 text-black shadow-[0_4px_16px_rgba(30,215,96,0.30)]'
                  : 'bg-surface-50 dark:bg-[#0a0a0a] border border-surface-200 dark:border-[#282828] text-surface-600 dark:text-night-300 hover:border-primary-500/20 hover:text-surface-900 dark:hover:text-white'
              )}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
      </div>

      {/* ─── Tab Content — bento with stagger ─── */}
      <motion.div initial="hidden" animate="show" variants={{ hidden:{}, show:{ transition:{ staggerChildren:0.06, delayChildren:0.08}}}}>
      <div>
        {activeTab === 'overview' && (
          <BentoGrid>
            {/* Main — 8 cols */}
            <div className="col-span-12 lg:col-span-8 space-y-6">
              {/* About — SectionCard */}
              {internship.description && (
                <SectionCard title="About this Internship" subtitle={`${internship.company || 'Company'} · ${internship.role || 'Intern'} · ${internship.mode || 'TBD'}`} icon={<Info size={16}/>} gradient="from-primary-500 via-primary-500 to-emerald-500">
                  <p className="text-surface-600 dark:text-night-300 leading-relaxed whitespace-pre-line text-[14px]">{internship.description}</p>
                </SectionCard>
              )}

              {/* Stipend Spotlight — hero bento for internship (Devfolio prize pattern adapted) */}
              {(internship.stipend || internship.duration || internship.mode) && (
                <SectionCard title="Opportunity Spotlight" subtitle="Stipend · Duration · Mode · Credibility" icon={<DollarSign size={16}/>} gradient="from-primary-500 via-emerald-500 to-primary-600">
                  <div className="relative overflow-hidden rounded-[20px] bg-gradient-to-br from-primary-50 via-emerald-50 to-white dark:from-primary-950/20 dark:via-emerald-950/15 dark:to-zinc-900 border border-primary-200/40 dark:border-primary-800/20 p-6">
                    <div className="absolute -top-10 -right-10 w-40 h-40 bg-primary-200/20 dark:bg-primary-500/10 rounded-full blur-[30px]" />
                    <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-emerald-200/15 dark:bg-emerald-500/10 rounded-full blur-[30px]" />
                    <div className="relative">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500 to-emerald-500 flex items-center justify-center shadow-[0_8px_24px_rgba(30,215,96,0.25)] text-black"><DollarSign size={20}/></div>
                          <div>
                            <p className="text-[11px] font-black tracking-widest uppercase text-primary-700 dark:text-primary-300">Stipend & Rewards</p>
                            <p className="font-display text-[22px] font-[800] tracking-[-0.02em] leading-none text-primary-900 dark:text-primary-100">{internship.stipend || 'Unpaid / Not disclosed'}</p>
                          </div>
                        </div>
                        {internship.duration && (
                          <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#0a0a0a] dark:bg-white text-white dark:text-black text-xs font-black"><Timer size={12}/>{internship.duration}</span>
                        )}
                      </div>
                      <BentoGrid className="mt-5">
                        <BentoCard span="col-span-6 md:col-span-4" padding={true} className="p-4 bg-white/80 dark:bg-white/[0.06] backdrop-blur">
                            <p className="text-[10px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400">Role</p>
                            <p className="font-display font-[700] text-surface-900 dark:text-white mt-1 text-sm leading-tight">{internship.role || 'Intern'}</p>
                            <p className="text-xs font-medium text-surface-500 dark:text-night-400 mt-0.5">{internship.company || 'Company'}</p>
                        </BentoCard>
                        <BentoCard span="col-span-6 md:col-span-4" padding={true} className="p-4 bg-white/80 dark:bg-white/[0.06] backdrop-blur">
                            <p className="text-[10px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400">Duration</p>
                            <p className="font-display font-[700] text-surface-900 dark:text-white mt-1 text-sm">{internship.duration || 'TBD'}</p>
                            <p className="text-xs font-medium text-surface-500 dark:text-night-400 mt-0.5 flex items-center gap-1"><Timer size={11}/>{internship.mode || 'Remote'}</p>
                        </BentoCard>
                        <BentoCard span="col-span-12 md:col-span-4" padding={true} className="p-4 bg-[#0a0a0a] dark:bg-white text-white dark:text-black">
                            <p className="text-[10px] font-black tracking-widest uppercase text-white/60 dark:text-black/60">Apply Before</p>
                            <p className="font-display font-[700] mt-1 text-sm">{internship.deadline ? new Date(internship.deadline).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric'}) : 'Open'}</p>
                            {countdown && <p className="text-xs font-bold text-primary-400 dark:text-primary-600 mt-0.5">{countdown}</p>}
                        </BentoCard>
                      </BentoGrid>
                      <p className="mt-3 text-[11px] font-semibold text-primary-700/60 dark:text-primary-300/60 flex items-center gap-1.5"><Star size={11}/> Verified on CampusFlow · Sponsor credibility · Direct apply</p>
                    </div>
                  </div>
                </SectionCard>
              )}

              {/* Quick Info Bento — varied sizes 2x2 but with premium hover */}
              <BentoGrid>
                {internship.company && (
                  <BentoCard span="col-span-6" padding={true} className="p-4 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center shrink-0 shadow">
                        <Building2 size={16} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400 leading-none">Company</p>
                        <p className="text-sm font-[800] tracking-[-0.01em] text-surface-900 dark:text-white mt-1 truncate">{internship.company}</p>
                      </div>
                  </BentoCard>
                )}
                {internship.role && (
                  <BentoCard span="col-span-6" padding={true} className="p-4 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-primary-500 text-black flex items-center justify-center shrink-0 shadow">
                        <Briefcase size={16} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400 leading-none">Role</p>
                        <p className="text-sm font-[800] tracking-[-0.01em] text-surface-900 dark:text-white mt-1 truncate">{internship.role}</p>
                      </div>
                  </BentoCard>
                )}
                {internship.stipend && (
                  <BentoCard span="col-span-6" padding={true} className="p-4 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/20 flex items-center justify-center shrink-0">
                        <DollarSign size={16} className="text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400 leading-none">Stipend</p>
                        <p className="text-sm font-[800] tracking-[-0.01em] text-surface-900 dark:text-white mt-1 truncate">{internship.stipend}</p>
                      </div>
                  </BentoCard>
                )}
                {internship.duration && (
                  <BentoCard span="col-span-6" padding={true} className="p-4 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/20 flex items-center justify-center shrink-0">
                        <Timer size={16} className="text-amber-600 dark:text-amber-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400 leading-none">Duration</p>
                        <p className="text-sm font-[800] tracking-[-0.01em] text-surface-900 dark:text-white mt-1 truncate">{internship.duration}</p>
                      </div>
                  </BentoCard>
                )}
                {internship.mode && (
                  <BentoCard span="col-span-6" padding={true} className="p-4 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-surface-50 dark:bg-white/5 border border-surface-200 dark:border-white/10 flex items-center justify-center shrink-0">
                        <MapPin size={16} className="text-surface-600 dark:text-night-300" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400 leading-none">Mode</p>
                        <p className="text-sm font-[800] tracking-[-0.01em] text-surface-900 dark:text-white mt-1">{internship.mode}</p>
                      </div>
                  </BentoCard>
                )}
                {internship.startDate && (
                  <BentoCard span="col-span-6" padding={true} className="p-4 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-500/15 border border-primary-100 dark:border-primary-500/20 flex items-center justify-center shrink-0">
                        <Calendar size={16} className="text-primary-600 dark:text-primary-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400 leading-none">Starts</p>
                        <p className="text-sm font-[800] tracking-[-0.01em] text-surface-900 dark:text-white mt-1">{new Date(internship.startDate).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric'})}</p>
                      </div>
                  </BentoCard>
                )}
              </BentoGrid>

              {/* Perks Bento — what you get */}
              <SectionCard title="What You Get" subtitle="Perks · Growth · Credibility" icon={<Star size={16}/>} gradient="from-amber-500 via-primary-500 to-emerald-500">
                <BentoGrid>
                  <BentoCard span="col-span-6 md:col-span-4" className="p-4 flex items-start gap-3">
                    <span className="w-9 h-9 rounded-xl bg-primary-500 text-black flex items-center justify-center shrink-0">💼</span>
                    <div>
                      <p className="text-sm font-[700] text-surface-900 dark:text-white">Live Project</p>
                      <p className="text-xs font-medium text-surface-500 dark:text-night-400 mt-1 leading-relaxed">Real work, mentor feedback</p>
                    </div>
                  </BentoCard>
                  <BentoCard span="col-span-6 md:col-span-4" className="p-4 flex items-start gap-3">
                    <span className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0">📜</span>
                    <div>
                      <p className="text-sm font-[700] text-surface-900 dark:text-white">Certificate</p>
                      <p className="text-xs font-medium text-surface-500 dark:text-night-400 mt-1 leading-relaxed">Completion & creds</p>
                    </div>
                  </BentoCard>
                  <BentoCard span="col-span-12 md:col-span-4" className="p-4 flex items-start gap-3">
                    <span className="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0">🤝</span>
                    <div>
                      <p className="text-sm font-[700] text-surface-900 dark:text-white">Networking</p>
                      <p className="text-xs font-medium text-surface-500 dark:text-night-400 mt-1 leading-relaxed">Team & industry connect</p>
                    </div>
                  </BentoCard>
                  <BentoCard span="col-span-6" className="p-4 flex items-start gap-3">
                    <span className="w-9 h-9 rounded-xl bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center shrink-0">🚀</span>
                    <div>
                      <p className="text-sm font-[700] text-surface-900 dark:text-white">PPO Potential</p>
                      <p className="text-xs font-medium text-surface-500 dark:text-night-400 mt-1 leading-relaxed">Convert to full-time</p>
                    </div>
                  </BentoCard>
                  <BentoCard span="col-span-6" className="p-4 flex items-start gap-3">
                    <span className="w-9 h-9 rounded-xl bg-surface-50 dark:bg-white/5 border border-surface-200 dark:border-white/10 flex items-center justify-center shrink-0">👨‍🏫</span>
                    <div>
                      <p className="text-sm font-[700] text-surface-900 dark:text-white">Mentorship</p>
                      <p className="text-xs font-medium text-surface-500 dark:text-night-400 mt-1 leading-relaxed">Guidance from experts</p>
                    </div>
                  </BentoCard>
                </BentoGrid>
              </SectionCard>
            </div>

            {/* Sidebar — 4 cols, registration CTA, stats, company */}
            <div className="col-span-12 lg:col-span-4 space-y-6">
              {/* Registration CTA — glass bento */}
              {isStudent && (
                <div className="relative overflow-hidden rounded-[24px] border border-surface-200 dark:border-[#282828] bg-white dark:bg-[#121212] p-6 shadow-sm print:hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary-500/[0.04] via-transparent to-emerald-500/[0.03]" />
                  <div className="absolute -top-16 -right-16 w-40 h-40 bg-primary-500/10 rounded-full blur-[30px]" />
                  <div className="relative">
                  {myRegistration ? (
                    <div>
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-primary-500 flex items-center justify-center shadow-[0_8px_20px_rgba(30,215,96,0.25)]"><CheckCircle size={18} className="text-white" /></div>
                        <div>
                          <h3 className="font-display font-[800] tracking-[-0.01em] text-surface-900 dark:text-white leading-none">Registered!</h3>
                          <p className="text-xs font-medium text-surface-500 dark:text-night-400 mt-1">Track your application</p>
                        </div>
                      </div>
                      <div className="space-y-2.5 text-sm mb-4">
                        <div className="flex items-center justify-between p-3 rounded-xl bg-surface-50 dark:bg-white/[0.04] border border-surface-100 dark:border-white/10">
                          <span className="text-xs font-black tracking-widest uppercase text-surface-400 dark:text-night-400">Status</span>
                          <span className={clsx('font-black text-xs px-3 py-1 rounded-full border',
                            myRegistration.status === 'SELECTED' ? 'bg-primary-500 text-black border-primary-500' :
                            myRegistration.status === 'REJECTED' ? 'bg-danger-50 dark:bg-danger-500/15 text-danger-700 dark:text-danger-300 border-danger-200 dark:border-danger-500/20' :
                             'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 border-primary-200 dark:border-primary-500/20'
                          )}>
                            {myRegistration.status}
                          </span>
                        </div>
                        {myRegistration.reportedAt && (
                          <div className="flex items-center justify-between p-3 rounded-xl bg-surface-50 dark:bg-white/[0.04] border border-surface-100 dark:border-white/10">
                            <span className="text-xs font-black tracking-widest uppercase text-surface-400 dark:text-night-400">Reported</span>
                            <span className="font-[700] text-surface-900 dark:text-white text-xs">{new Date(myRegistration.reportedAt).toLocaleDateString()}</span>
                          </div>
                        )}
                      </div>
                      <div className="pt-4 border-t border-surface-100 dark:border-white/10">
                        <p className="text-[11px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400 mb-3">Self-Report Status</p>
                        <button
                          onClick={() => setShowReport(true)}
                          className="w-full h-11 rounded-full bg-[#0a0a0a] dark:bg-white text-white dark:text-black font-black text-sm hover:shadow-lg hover:-translate-y-0.5 transition-all active:scale-[0.98]"
                        >
                          Report Status
                        </button>
                        <button
                          onClick={handleUnregister}
                          className="mt-2 w-full h-11 rounded-full border border-surface-200 dark:border-white/10 bg-white dark:bg-transparent text-surface-600 dark:text-night-300 text-sm font-black hover:border-danger-500/40 hover:text-danger-600 dark:hover:text-danger-400 transition-colors active:scale-[0.98]"
                        >
                          Unregister
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center">
                      <div className="w-16 h-16 rounded-[16px] bg-gradient-to-br from-primary-500 to-emerald-500 flex items-center justify-center mx-auto mb-4 shadow-[0_12px_32px_rgba(30,215,96,0.30)]">
                        <Rocket size={26} className="text-white" />
                      </div>
                      <h3 className="font-display text-[18px] font-[800] tracking-[-0.02em] text-surface-900 dark:text-white leading-none">Apply for this Internship</h3>
                      <p className="text-surface-500 dark:text-night-400 text-sm mt-1">Register and track your application</p>
                      {internship.eligibilityEnabled && (
                        <div className={clsx('mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-black border',
                          isEligible ? 'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 border-primary-200 dark:border-primary-500/20' : 'bg-danger-50 dark:bg-danger-500/15 text-danger-700 dark:text-danger-300 border-danger-200 dark:border-danger-500/20'
                        )}>
                          {isEligible ? <CheckCircle size={12} /> : <XCircle size={12} />}
                          {isEligible ? 'You are eligible' : 'Not eligible — check departments & years'}
                        </div>
                      )}
                      <button
                        onClick={() => setShowRegister(true)}
                        disabled={internship.eligibilityEnabled && !isEligible}
                        className={clsx('mt-4 w-full h-11 rounded-full font-black text-sm transition-all active:scale-[0.98]',
                          internship.eligibilityEnabled && !isEligible
                            ? 'bg-surface-200 dark:bg-zinc-800 text-surface-400 cursor-not-allowed'
                            : 'bg-[#0a0a0a] dark:bg-white text-white dark:text-black hover:shadow-[0_12px_32px_rgba(0,0,0,0.15)] hover:-translate-y-0.5'
                        )}>
                        {internship.eligibilityEnabled && !isEligible ? 'Not Eligible' : 'Register Now →'}
                      </button>
                    </div>
                  )}
                  </div>
                </div>
              )}

              {/* Stats — bento — dark-safe: explicit dark:text ensures Registered/Selected counts stay visible */}
              <BentoCard span="col-span-12" className="p-5">
                <h3 className="font-display font-[800] tracking-[-0.01em] text-surface-900 dark:text-white">Live Stats</h3>
                <p className="text-xs font-medium text-surface-500 dark:text-night-400 mt-1">Pulse · Unstop pattern</p>
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="p-4 rounded-xl bg-[#0a0a0a] dark:bg-white text-white dark:text-black text-center">
                    <p className="font-display text-2xl font-[800] leading-none text-white dark:text-black">{internship.registrations?.length || 0}</p>
                    <p className="text-[10px] font-black tracking-widest uppercase text-white/70 dark:text-black/60 mt-1">Registered</p>
                  </div>
                  <div className="p-4 rounded-xl bg-primary-500 dark:bg-primary-500 text-black dark:text-black text-center shadow-[0_8px_24px_rgba(30,215,96,0.25)]">
                    <p className="font-display text-2xl font-[800] leading-none text-black dark:text-black">{selectedCount}</p>
                    <p className="text-[10px] font-black tracking-widest uppercase text-black/70 dark:text-black/60 mt-1">Selected</p>
                  </div>
                </div>
              </BentoCard>

              {/* Company credibility */}
              {internship.company && (
                <BentoCard span="col-span-12" className="p-5">
                  <h3 className="font-display font-[800] tracking-[-0.01em] text-surface-900 dark:text-white text-sm">Company</h3>
                  <div className="mt-3 flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center text-sm font-black shadow">{internship.company.charAt(0).toUpperCase()}</div>
                    <div className="min-w-0">
                      <p className="font-[700] text-surface-900 dark:text-white text-sm truncate">{internship.company}</p>
                      <p className="text-xs font-medium text-surface-500 dark:text-night-400 flex items-center gap-1"><Building2 size={11}/> {internship.role || 'Intern'} · {internship.mode || 'TBD'}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-full bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-500/20 text-xs font-black">Verified</span>
                    {internship.stipend && <span className="px-2.5 py-1 rounded-full bg-surface-50 dark:bg-white/[0.06] border border-surface-200 dark:border-white/10 text-xs font-bold text-surface-600 dark:text-night-300">{internship.stipend}</span>}
                  </div>
                </BentoCard>
              )}
            </div>
          </BentoGrid>
        )}

        {activeTab === 'eligibility' && (
          <BentoGrid>
            <div className="col-span-12 lg:col-span-7">
              <SectionCard title="Eligibility" subtitle="Departments · Years · Access" icon={<Shield size={16}/>} gradient="from-primary-500 via-primary-500 to-emerald-500">
                {internship.eligibilityEnabled && (targetDeptNames.length > 0 || targetYears.length > 0) ? (
                  <div className="space-y-4">
                    {targetDeptNames.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#0a0a0a] dark:bg-white text-white dark:text-black text-xs font-black"><GraduationCap size={12}/> Departments</span>
                        {targetDeptNames.map(name => (
                          <span key={name} className="px-3 py-1.5 bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-500/20 rounded-full text-xs font-black">{name}</span>
                        ))}
                      </div>
                    )}
                    {targetYears.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-100 dark:bg-white/10 text-surface-700 dark:text-white border border-surface-200 dark:border-white/10 text-xs font-black"><BookOpen size={12}/> Years</span>
                        {targetYears.sort().map(y => (
                          <span key={y} className="px-3 py-1.5 bg-surface-50 dark:bg-white/5 text-surface-700 dark:text-night-200 border border-surface-200 dark:border-white/10 rounded-full text-xs font-bold">Year {y}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-3 p-4 rounded-xl bg-primary-50 dark:bg-primary-500/10 border border-primary-100 dark:border-primary-500/20">
                    <div className="w-9 h-9 rounded-xl bg-primary-500 text-white flex items-center justify-center shrink-0"><CheckCircle size={16}/></div>
                    <div>
                      <p className="font-display font-[700] text-surface-900 dark:text-white text-sm">Open to all students</p>
                      <p className="text-xs font-medium text-surface-500 dark:text-night-400 mt-0.5">No department/year restriction</p>
                    </div>
                  </div>
                )}

                {isStudent && internship.eligibilityEnabled && (
                  <div className={clsx(
                    'mt-5 inline-flex items-center gap-2 px-4 h-10 rounded-full text-sm font-black border',
                    isEligible ? 'bg-primary-500 text-black border-primary-500 shadow' : 'bg-danger-50 dark:bg-danger-500/15 text-danger-700 dark:text-danger-300 border-danger-200 dark:border-danger-500/20'
                  )}>
                    {isEligible ? <CheckCircle size={14} /> : <XCircle size={14} />}
                    {isEligible ? 'You are eligible to register' : 'Not eligible — check target departments & years'}
                  </div>
                )}
              </SectionCard>
            </div>
            <div className="col-span-12 lg:col-span-5">
              <SectionCard title="At a Glance" subtitle="Quick facts · Mode & timeline" icon={<Info size={16}/>} gradient="from-emerald-500 via-primary-500 to-primary-600">
                <BentoGrid>
                  <BentoCard span="col-span-6" className="p-4 text-center">
                      <div className="w-10 h-10 rounded-xl bg-primary-500 text-black flex items-center justify-center mx-auto"><Building2 size={16}/></div>
                      <p className="text-xs font-black tracking-widest uppercase text-surface-400 dark:text-night-400 mt-2">Company</p>
                      <p className="font-display font-[700] text-surface-900 dark:text-white mt-1 text-sm truncate">{internship.company}</p>
                  </BentoCard>
                  <BentoCard span="col-span-6" className="p-4 text-center">
                      <div className="w-10 h-10 rounded-xl bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center mx-auto"><Briefcase size={16}/></div>
                      <p className="text-xs font-black tracking-widest uppercase text-surface-400 dark:text-night-400 mt-2">Role</p>
                      <p className="font-display font-[700] text-surface-900 dark:text-white mt-1 text-sm truncate">{internship.role || 'Intern'}</p>
                  </BentoCard>
                  <BentoCard span="col-span-12" className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center"><Clock size={16}/></div>
                      <div>
                        <p className="text-xs font-black tracking-widest uppercase text-surface-400 dark:text-night-400">Deadline</p>
                        <p className="text-sm font-[700] text-surface-900 dark:text-white">{internship.deadline ? new Date(internship.deadline).toLocaleDateString() : 'Open'}</p>
                      </div>
                    </div>
                    {countdown && <span className="px-3 py-1.5 rounded-full bg-danger-50 dark:bg-danger-500/15 text-danger-700 dark:text-danger-300 border border-danger-200 dark:border-danger-500/20 text-xs font-black">{countdown}</span>}
                  </BentoCard>
                </BentoGrid>
              </SectionCard>
            </div>
          </BentoGrid>
        )}

        {activeTab === 'registrations' && isTeacher && (
          <div className="space-y-6">
            {/* Analytics — Registered/Selected/Success/Prize style, keep export */}
            <BentoGrid>
              <BentoCard span="col-span-12 md:col-span-3" className="p-5">
                <div className="flex items-center gap-2.5 mb-2">
                  <span className="w-9 h-9 rounded-xl bg-primary-500 text-black flex items-center justify-center shrink-0"><Users size={16}/></span>
                  <p className="text-[10px] font-black tracking-[0.12em] uppercase text-surface-400 dark:text-night-400">Applied</p>
                </div>
                <p className="font-display text-[28px] font-[800] leading-none text-surface-900 dark:text-white">{totalRegs}</p>
                <p className="mt-1 text-[11px] font-bold text-surface-500 dark:text-night-400">Total applicants</p>
                <div className="mt-3 h-1.5 rounded-full bg-surface-100 dark:bg-white/10 overflow-hidden flex"><div className="bg-primary-500" style={{ width: `${totalRegs?100:0}%` }}/></div>
              </BentoCard>
              <BentoCard span="col-span-12 md:col-span-3" className="p-5">
                <div className="flex items-center gap-2.5 mb-2">
                  <span className="w-9 h-9 rounded-xl bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center shrink-0"><CheckCircle size={16}/></span>
                  <p className="text-[10px] font-black tracking-[0.12em] uppercase text-surface-400 dark:text-night-400">Selected</p>
                  <span className="ml-auto px-2 py-0.5 rounded-full bg-primary-500 text-black text-[11px] font-black">{successRate}%</span>
                </div>
                <p className="font-display text-[28px] font-[800] leading-none text-surface-900 dark:text-white">{selectedCount}</p>
                <p className="mt-1 text-[11px] font-bold text-surface-500 dark:text-night-400">{selectedCount} offered · {successRate}% success</p>
                <div className="mt-3 w-full h-1.5 bg-surface-100 dark:bg-white/10 rounded-full overflow-hidden"><div className="h-full bg-primary-500" style={{ width: `${successRate}%` }}/></div>
              </BentoCard>
              <BentoCard span="col-span-12 md:col-span-3" className="p-5">
                <div className="flex items-center gap-2.5 mb-2">
                  <span className="w-9 h-9 rounded-xl bg-danger-500 text-white flex items-center justify-center shrink-0"><XCircle size={16}/></span>
                  <p className="text-[10px] font-black tracking-[0.12em] uppercase text-surface-400 dark:text-night-400">Rejected</p>
                </div>
                <p className="font-display text-[28px] font-[800] leading-none text-surface-900 dark:text-white">{rejectedCount}</p>
                <p className="mt-1 text-[11px] font-bold text-surface-500 dark:text-night-400">{rejectedCount} not selected</p>
                {internship.stipend && <p className="mt-2 text-xs font-black text-primary-600 dark:text-primary-400 truncate">{internship.stipend}</p>}
              </BentoCard>
              <BentoCard span="col-span-12 md:col-span-3" className="p-5">
                <div className="flex items-center gap-2.5 mb-2">
                  <span className="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0"><BarChart3 size={16}/></span>
                  <p className="text-[10px] font-black tracking-[0.12em] uppercase text-surface-400 dark:text-night-400">Insights</p>
                </div>
                <p className="font-display text-[16px] font-[800] leading-tight text-surface-900 dark:text-white">{internship.company || 'Company'}</p>
                <p className="text-xs font-bold text-surface-500 dark:text-night-400 mt-1">{internship.role || 'Intern'} · {internship.mode || 'TBD'}</p>
                <p className="mt-2 text-[10px] font-bold tracking-wide uppercase text-surface-400 dark:text-night-400 flex items-center gap-1"><TrendingUp size={10}/> Live pipeline</p>
              </BentoCard>
            </BentoGrid>
            <BentoGrid>
              <BentoCard span="col-span-12 md:col-span-6" className="p-5">
                <div className="flex items-center gap-2.5 mb-3">
                  <span className="w-9 h-9 rounded-xl bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center"><GraduationCap size={16}/></span>
                  <h4 className="font-display text-[15px] font-[800] tracking-[-0.02em] text-[#0a0a0a] dark:text-white">By Department</h4>
                  <span className="ml-auto text-xs font-black px-2.5 py-1 rounded-full bg-surface-900 dark:bg-white text-white dark:text-black">{regDeptBreakdown.length} depts</span>
                </div>
                {regDeptBreakdown.length===0 ? <p className="text-xs text-surface-400 dark:text-night-400 py-6 text-center border border-dashed rounded-2xl dark:border-white/10">No data</p> : (
                  <div className="space-y-1.5 max-h-[120px] overflow-y-auto pr-1">
                    {regDeptBreakdown.map(([dept,cnt])=> (
                      <div key={dept} className="flex items-center justify-between text-xs bg-surface-50 dark:bg-white/[0.04] rounded-xl px-3 py-2 border border-surface-100 dark:border-white/10">
                        <span className="truncate font-semibold text-surface-700 dark:text-night-200">{dept}</span>
                        <span className="font-black px-1.5 py-0.5 rounded-full bg-primary-500 text-black text-[11px]">{cnt}</span>
                      </div>
                    ))}
                  </div>
                )}
              </BentoCard>
              <BentoCard span="col-span-12 md:col-span-6" className="p-5">
                <div className="flex items-center gap-2.5 mb-3">
                  <span className="w-9 h-9 rounded-xl bg-primary-500 text-black flex items-center justify-center"><BookOpen size={16}/></span>
                  <h4 className="font-display text-[15px] font-[800] tracking-[-0.02em] text-[#0a0a0a] dark:text-white">By Year</h4>
                  <span className="ml-auto text-xs font-black px-2.5 py-1 rounded-full bg-primary-500 text-black">{regYearBreakdown.length} cohorts</span>
                </div>
                {regYearBreakdown.length===0 ? <p className="text-xs text-surface-400 dark:text-night-400 py-6 text-center border border-dashed rounded-2xl dark:border-white/10">No data</p> : (
                  <div className="space-y-1.5 max-h-[120px] overflow-y-auto pr-1">
                    {regYearBreakdown.map(([y,cnt])=> (
                      <div key={y} className="flex items-center justify-between text-xs bg-surface-50 dark:bg-white/[0.04] rounded-xl px-3 py-2 border border-surface-100 dark:border-white/10">
                        <span className="font-semibold text-surface-700 dark:text-night-200">{y==='Unknown'?'Unknown':`Year ${y}`}</span>
                        <span className="font-black px-1.5 py-0.5 rounded-full bg-[#0a0a0a] dark:bg-white text-white dark:text-black text-[11px]">{cnt}</span>
                      </div>
                    ))}
                  </div>
                )}
              </BentoCard>
            </BentoGrid>
            {/* Filters & Export — dept + year + search kept */}
            <SectionCard title="Filters & Export" subtitle={`Showing ${filteredRegs.length}/${totalRegs} · Dept & Year filters + search`} icon={<Filter size={16}/>} gradient="from-primary-500 via-primary-500 to-emerald-500" action={
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => setShowRemind(true)} disabled={totalRegs === 0} className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full bg-[#0a0a0a] dark:bg-white text-white dark:text-black text-xs font-black hover:shadow-lg transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed">
                  <Bell size={14}/> Remind registered
                </button>
                <button onClick={handleExportFiltered} className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full bg-white dark:bg-[#1a1a1a] border border-surface-200 dark:border-white/10 text-surface-700 dark:text-white text-xs font-black hover:border-primary-500/30 transition-colors">
                  <Download size={14}/> Export CSV
                </button>
                <button onClick={handleExport} className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full bg-primary-500 text-black text-xs font-black hover:bg-[#1ed760] shadow">
                  <Download size={14}/> Export XLSX
                </button>
              </div>
            }>
              <div className="flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 min-w-[220px]">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 dark:text-zinc-500" />
                  <input value={regSearch} onChange={e=> setRegSearch(e.target.value)} placeholder="Search name, email, roll..." className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-surface-200 dark:border-white/10 bg-surface-50 dark:bg-[#0a0a0a] text-sm text-surface-900 dark:text-white placeholder:text-[#6b7280] focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" />
                </div>
                <select value={regDept} onChange={e=> setRegDept(e.target.value)} className="px-3 py-2.5 rounded-xl border border-surface-200 dark:border-white/10 bg-white dark:bg-[#0a0a0a] text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 min-w-[160px]">
                  <option value="ALL">All departments</option>
                  {departments.map((d:any)=> <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <select value={regYear} onChange={e=> setRegYear(e.target.value)} className="px-3 py-2.5 rounded-xl border border-surface-200 dark:border-white/10 bg-white dark:bg-[#0a0a0a] text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20">
                  <option value="ALL">All years</option>
                  {regAvailableYears.map(y=> <option key={y} value={y}>Year {y}</option>)}
                </select>
              </div>
              {(regDept!=='ALL' || regYear!=='ALL' || regSearch) && <button onClick={()=>{setRegSearch(''); setRegDept('ALL'); setRegYear('ALL')}} className="mt-3 text-xs font-bold text-primary-600 hover:text-primary-700 dark:text-primary-400 underline">Clear filters →</button>}
            </SectionCard>

            <SectionCard title="All Applicants" subtitle={`${filteredRegs.length}/${totalRegs} shown · ${selectedCount} selected · Live`} icon={<Users size={16}/>} gradient="from-primary-500 via-primary-600 to-emerald-500">
              {!internship.registrations?.length ? (
                <div className="text-center py-14 rounded-xl bg-surface-50 dark:bg-white/[0.02] border border-dashed border-surface-200 dark:border-white/10">
                  <Users size={36} className="text-surface-300 dark:text-zinc-600 mx-auto mb-3" />
                  <p className="font-display font-[700] text-surface-600 dark:text-night-300">No registrations yet</p>
                  <p className="text-xs font-medium text-surface-400 dark:text-night-400 mt-1">Applicants will appear here</p>
                </div>
              ) : filteredRegs.length===0 ? (
                <div className="text-center py-14 rounded-xl bg-surface-50 dark:bg-white/[0.02] border border-dashed border-surface-200 dark:border-white/10">
                  <Filter size={28} className="text-surface-300 dark:text-zinc-600 mx-auto mb-2" />
                  <p className="font-display font-[700] text-surface-600 dark:text-night-300">No matches</p>
                  <p className="text-xs font-medium text-surface-400 dark:text-night-400 mt-1">Try clearing department / year / search filters</p>
                  <button onClick={()=>{setRegSearch(''); setRegDept('ALL'); setRegYear('ALL')}} className="mt-3 px-4 h-9 rounded-full bg-primary-500 text-black text-xs font-black">Clear filters</button>
                </div>
              ) : (
                <div className="overflow-x-auto -mx-1">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-surface-100 dark:border-white/10">
                        <th className="text-left py-3 px-2 text-surface-500 dark:text-night-400 font-black text-[11px] uppercase tracking-widest">Roll No</th>
                        <th className="text-left py-3 px-2 text-surface-500 dark:text-night-400 font-black text-[11px] uppercase tracking-widest">Name</th>
                        <th className="text-left py-3 px-2 text-surface-500 dark:text-night-400 font-black text-[11px] uppercase tracking-widest">Email</th>
                        <th className="text-left py-3 px-2 text-surface-500 dark:text-night-400 font-black text-[11px] uppercase tracking-widest">Status</th>
                        <th className="text-left py-3 px-2 text-surface-500 dark:text-night-400 font-black text-[11px] uppercase tracking-widest">Reported At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRegs.map((reg: any) => (
                        <tr key={reg.id} className="border-b border-surface-50 dark:border-white/5 hover:bg-surface-50 dark:hover:bg-white/[0.03] transition-colors">
                          <td className="py-3 px-2">
                            <span className="font-mono text-xs bg-surface-50 dark:bg-white/5 px-2.5 py-1 rounded-full border border-surface-200 dark:border-white/10 text-surface-700 dark:text-night-300">{reg.user.studentId || '-'}</span>
                          </td>
                          <td className="py-3 px-2">
                            <div className="flex items-center gap-2.5">
                               <div className="w-8 h-8 rounded-full bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center text-xs font-black shrink-0">
                                {reg.user.name?.charAt(0)?.toUpperCase()}
                              </div>
                              <div>
                                <p className="font-[700] text-surface-900 dark:text-white text-sm leading-none">{reg.user.name}</p>
                                <p className="text-xs font-medium text-surface-500 dark:text-night-400">{reg.user.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-2 text-surface-700 dark:text-night-200 font-medium">{reg.user.email}</td>
                          <td className="py-3 px-2">
                            <span className={clsx('px-3 py-1 rounded-full text-xs font-black border',
                              reg.status === 'SELECTED' ? 'bg-primary-500 text-black border-primary-500' :
                              reg.status === 'REJECTED' ? 'bg-danger-50 dark:bg-danger-500/15 text-danger-700 dark:text-danger-300 border-danger-200 dark:border-danger-500/20' :
                               'bg-zinc-50 dark:bg-white/5 text-zinc-700 dark:text-night-300 border-zinc-200 dark:border-white/10'
                            )}>
                              {reg.status}
                            </span>
                          </td>
                          <td className="py-3 px-2">
                            {reg.reportedAt ? (
                              <span className="text-xs font-medium text-surface-700 dark:text-night-300">{new Date(reg.reportedAt).toLocaleDateString()}</span>
                            ) : (
                              <span className="text-surface-300 dark:text-night-600">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </div>
        )}
        {activeTab === 'registrations' && !isTeacher && (
          <SectionCard title="My Application" subtitle="Your status · Journey" icon={<Users size={16}/>} gradient="from-primary-500 via-primary-500 to-emerald-500">
            {myRegistration ? (
              <>
              <BentoGrid>
                <BentoCard span="col-span-6 lg:col-span-4" className="text-center p-5">
                    <p className="text-[11px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400">Status</p>
                    <p className="mt-2 inline-flex px-3 py-1 rounded-full bg-primary-500 text-black text-xs font-black">{myRegistration.status}</p>
                </BentoCard>
                <BentoCard span="col-span-6 lg:col-span-4" className="text-center p-5">
                    <p className="text-[11px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400">Company</p>
                    <p className="font-display font-[700] text-surface-900 dark:text-white mt-1">{internship.company}</p>
                </BentoCard>
                <BentoCard span="col-span-12 lg:col-span-4" className="text-center p-5">
                    <p className="text-[11px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400">Reported</p>
                    <p className="font-[700] text-surface-900 dark:text-white mt-1 text-sm">{myRegistration.reportedAt ? new Date(myRegistration.reportedAt).toLocaleDateString() : '—'}</p>
                </BentoCard>
              </BentoGrid>
              <button onClick={handleUnregister} className="mt-4 w-full h-11 rounded-full border border-surface-200 dark:border-white/10 bg-white dark:bg-transparent text-surface-600 dark:text-night-300 text-sm font-black hover:border-danger-500/40 hover:text-danger-600 dark:hover:text-danger-400 transition-colors active:scale-[0.98]">
                Unregister
              </button>
              </>
            ) : (
              <div className="text-center py-10 rounded-xl bg-surface-50 dark:bg-white/[0.02] border border-dashed border-surface-200 dark:border-white/10">
                <p className="font-display font-[700] text-surface-600 dark:text-night-300">You haven't applied yet</p>
                <button onClick={() => setShowRegister(true)} className="mt-4 px-6 h-11 rounded-full bg-primary-500 text-black font-black text-sm">Register Now</button>
              </div>
            )}
          </SectionCard>
        )}
      </div>
      </motion.div>

      {/* Register Modal — premium */}
      {showRegister && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:hidden"
          onClick={() => setShowRegister(false)}>
          <div className="bg-white dark:bg-[#121212] rounded-[24px] border border-surface-200 dark:border-[#282828] w-full max-w-md p-6 shadow-[0_24px_64px_rgba(0,0,0,0.25)]" onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-xl bg-primary-500 flex items-center justify-center mb-4 shadow"><Briefcase size={20} className="text-black"/></div>
            <h2 className="font-display text-xl font-[800] tracking-[-0.02em] text-surface-900 dark:text-white">Register for {internship.title}</h2>
            <p className="text-surface-600 dark:text-night-300 text-sm mt-1 font-medium">You'll be added to the applicant list. Report status after.</p>
            {internship.eligibilityEnabled && !isEligible && (
              <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-danger-50 dark:bg-danger-500/15 border border-danger-200 dark:border-danger-500/20 text-danger-700 dark:text-danger-300 text-xs font-black">
                <XCircle size={14}/> Not eligible — check departments & years
              </div>
            )}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowRegister(false)} className="flex-1 h-11 bg-surface-100 dark:bg-white/10 text-surface-700 dark:text-white rounded-full font-black text-sm">Cancel</button>
               <button onClick={handleRegister} disabled={internship.eligibilityEnabled && !isEligible} className={clsx('flex-1 h-11 rounded-full font-black text-sm', internship.eligibilityEnabled && !isEligible ? 'bg-surface-200 text-surface-400 cursor-not-allowed' : 'bg-primary-500 text-black hover:shadow-[0_8px_24px_rgba(30,215,96,0.30)]')}>Register</button>
            </div>
          </div>
        </div>
      )}

      {/* Remind registered modal — teacher/admin only, notifies registered users (#5 leftovers) */}
      {showRemind && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:hidden"
          onClick={() => setShowRemind(false)}>
          <div className="bg-white dark:bg-[#121212] rounded-[24px] border border-surface-200 dark:border-[#282828] w-full max-w-md p-6 shadow-[0_24px_64px_rgba(0,0,0,0.25)]" onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-xl bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center mb-4"><Bell size={20}/></div>
            <h2 className="font-display text-xl font-[800] tracking-[-0.02em] text-surface-900 dark:text-white">Remind registered students</h2>
            <p className="text-sm font-medium text-surface-500 dark:text-night-400 mt-1">Sends a notification to {totalRegs} registered student{totalRegs === 1 ? '' : 's'} only — no one else.</p>
            <label htmlFor="intern-remind-msg" className="text-xs font-black tracking-widest uppercase text-surface-500 dark:text-night-400 mb-1 mt-5 block">Message</label>
            <textarea id="intern-remind-msg" value={remindMessage}
              onChange={(e) => setRemindMessage(e.target.value)}
              maxLength={1000}
              rows={4}
              placeholder="e.g. Applications close tomorrow — complete your profile."
              className="w-full px-4 py-3 border border-surface-200 dark:border-white/10 rounded-xl text-sm min-h-[44px] bg-white dark:bg-[#0a0a0a] text-surface-900 dark:text-white placeholder:text-[#6b7280] dark:placeholder:text-night-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20" />
            <p className="mt-1 text-right text-[11px] font-medium text-surface-400 dark:text-night-400">{remindMessage.length}/1000</p>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setShowRemind(false)} className="flex-1 h-11 bg-surface-100 dark:bg-white/10 text-surface-700 dark:text-white rounded-full font-black text-sm">Cancel</button>
              <button onClick={handleRemind} disabled={reminding || !remindMessage.trim()} className="flex-1 h-11 bg-primary-500 text-black rounded-full font-black text-sm hover:shadow-[0_8px_24px_rgba(30,215,96,0.30)] disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5">
                <Send size={14}/> {reminding ? 'Sending…' : 'Send reminder'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report Status Modal — premium */}
      {showReport && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:hidden"
          onClick={() => setShowReport(false)}>
          <div className="bg-white dark:bg-[#121212] rounded-[24px] border border-surface-200 dark:border-[#282828] w-full max-w-md p-6 shadow-[0_24px_64px_rgba(0,0,0,0.25)]" onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-xl bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center mb-4"><CheckCircle size={20}/></div>
            <h2 className="font-display text-xl font-[800] tracking-[-0.02em] text-surface-900 dark:text-white">Report Status</h2>
            <p className="text-surface-600 dark:text-night-300 text-sm mt-1 font-medium">Let us know the outcome of your application.</p>
            <div className="space-y-3 mt-5 mb-4">
              <button
                onClick={() => setReportStatus('SELECTED')}
                className={clsx('w-full p-4 rounded-xl text-sm font-black border-2 transition-all text-left flex items-center gap-3',
                  reportStatus === 'SELECTED' ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300' : 'border-surface-200 dark:border-white/10 text-surface-600 dark:text-night-300 hover:border-surface-300 bg-white dark:bg-white/5'
                )}>
                  <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center', reportStatus==='SELECTED' ? 'bg-primary-500 text-black' : 'bg-surface-100 dark:bg-white/10')}>
                    <CheckCircle size={16} />
                  </div>
                  <span>Selected / Offered</span>
              </button>
              <button
                onClick={() => setReportStatus('REJECTED')}
                className={clsx('w-full p-4 rounded-xl text-sm font-black border-2 transition-all text-left flex items-center gap-3',
                  reportStatus === 'REJECTED' ? 'border-danger-500 bg-danger-50 dark:bg-danger-500/15 text-danger-700 dark:text-danger-300' : 'border-surface-200 dark:border-white/10 text-surface-600 dark:text-night-300 hover:border-surface-300 bg-white dark:bg-white/5'
                )}>
                <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center', reportStatus==='REJECTED' ? 'bg-danger-500 text-white' : 'bg-surface-100 dark:bg-white/10')}>
                    <XCircle size={16} />
                  </div>
                  <span>Rejected / Not Selected</span>
              </button>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowReport(false)} className="flex-1 h-11 bg-surface-100 dark:bg-white/10 text-surface-700 dark:text-white rounded-full font-black text-sm">Cancel</button>
              <button onClick={handleReport} className="flex-1 h-11 bg-primary-500 text-black rounded-full font-black text-sm hover:shadow-[0_8px_24px_rgba(30,215,96,0.30)]">Submit</button>
            </div>
          </div>
        </div>
      )}

      {/* Registrations Modal */}
      {showRegistrations && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:hidden"
          onClick={() => setShowRegistrations(false)}>
          <div className="bg-white dark:bg-[#121212] rounded-[24px] border border-surface-200 dark:border-[#282828] w-full max-w-4xl max-h-[85vh] flex flex-col shadow-[0_24px_64px_rgba(0,0,0,0.25)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-surface-100 dark:border-white/10">
              <div className="flex items-center gap-3">
               <div className="w-10 h-10 rounded-xl bg-primary-500 flex items-center justify-center shadow">
                   <Users size={18} className="text-black" />
                </div>
                <div>
                  <h2 className="font-display text-lg font-[800] tracking-[-0.01em] text-surface-900 dark:text-white">Registrations</h2>
                  <p className="text-xs font-medium text-surface-500 dark:text-night-400">{internship.registrations?.length || 0} registered · {selectedCount} selected</p>
                </div>
              </div>
              <button onClick={() => setShowRegistrations(false)} className="w-9 h-9 rounded-full bg-surface-50 dark:bg-white/5 hover:bg-surface-100 dark:hover:bg-white/10 flex items-center justify-center transition-colors">
                <XCircle size={18} className="text-surface-400" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              {!internship.registrations?.length ? (
                <div className="text-center py-12">
                  <Users size={36} className="text-surface-300 mx-auto mb-3" />
                  <p className="font-display font-[700] text-surface-600 dark:text-night-300">No registrations yet</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-surface-100 dark:border-white/10">
                        <th className="text-left py-3 px-2 text-surface-500 dark:text-night-400 font-black text-[11px] uppercase tracking-widest">Roll No</th>
                        <th className="text-left py-3 px-2 text-surface-500 dark:text-night-400 font-black text-[11px] uppercase tracking-widest">Name</th>
                        <th className="text-left py-3 px-2 text-surface-500 dark:text-night-400 font-black text-[11px] uppercase tracking-widest">Email</th>
                        <th className="text-left py-3 px-2 text-surface-500 dark:text-night-400 font-black text-[11px] uppercase tracking-widest">Status</th>
                        <th className="text-left py-3 px-2 text-surface-500 dark:text-night-400 font-black text-[11px] uppercase tracking-widest">Reported At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {internship.registrations.map((reg: any) => (
                        <tr key={reg.id} className="border-b border-surface-50 dark:border-white/5 hover:bg-surface-50 dark:hover:bg-white/[0.03] transition-colors">
                          <td className="py-3 px-2">
                            <span className="font-mono text-xs bg-surface-50 dark:bg-white/5 px-2.5 py-1 rounded-full border border-surface-200 dark:border-white/10 text-surface-700 dark:text-night-300">{reg.user.studentId || '-'}</span>
                          </td>
                          <td className="py-3 px-2">
                            <div className="flex items-center gap-2.5">
                               <div className="w-8 h-8 rounded-full bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center text-xs font-black shrink-0">
                                {reg.user.name?.charAt(0)?.toUpperCase()}
                              </div>
                              <div>
                                <p className="font-[700] text-surface-900 dark:text-white text-sm leading-none">{reg.user.name}</p>
                                <p className="text-xs font-medium text-surface-500 dark:text-night-400">{reg.user.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-2 text-surface-700 dark:text-night-200 font-medium">{reg.user.email}</td>
                          <td className="py-3 px-2">
                            <span className={clsx('px-3 py-1 rounded-full text-xs font-black border',
                              reg.status === 'SELECTED' ? 'bg-primary-500 text-black border-primary-500' :
                              reg.status === 'REJECTED' ? 'bg-danger-50 dark:bg-danger-500/15 text-danger-700 dark:text-danger-300 border-danger-200 dark:border-danger-500/20' :
                               'bg-zinc-50 dark:bg-white/5 text-zinc-700 dark:text-night-300 border-zinc-200 dark:border-white/10'
                            )}>
                              {reg.status}
                            </span>
                          </td>
                          <td className="py-3 px-2">
                            {reg.reportedAt ? (
                              <span className="text-xs font-medium text-surface-700 dark:text-night-300">{new Date(reg.reportedAt).toLocaleDateString()}</span>
                            ) : (
                              <span className="text-surface-300 dark:text-night-600">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
