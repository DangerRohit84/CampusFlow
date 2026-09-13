import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { hackathonAPI } from '../lib/api'
import { useDepartments } from '../hooks/useDepartments'
import { notifyEntityMutated, useEntitySync } from '../lib/entitySync'
import {
  ArrowLeft, Trophy, Calendar, Users, ExternalLink, Download,
  Loader2, CheckCircle, Clock, Plus,
  Edit, Trash2, MapPin, Timer, DollarSign,
  Target, GraduationCap, BookOpen, CircleDot, Rocket, Printer,
  Lightbulb, Star, Zap, XCircle, Info, Layers, CalendarClock, Shield, Link2, List,
  Search, Filter, BarChart3, TrendingUp, Bell, Send
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import type { Department } from '../types/api'
import {
  getRegAvailableYears,
  getRegDeptBreakdown,
  getRegYearBreakdown,
  filterRegs,
} from '../components/hackathonDetail'
import { PremiumHero, GlassPanel, BentoGrid, BentoCard, SectionCard } from '../components/premium/PremiumKit'
import { motion } from 'framer-motion'
import { useConfirm } from '../components/ui/ConfirmModal'

export default function HackathonDetailPage() {
  const { confirm: confirmDialog } = useConfirm()
  const { id } = useParams<{ id: string }>()
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [hackathon, setHackathon] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  // PERPAGE-HALF1: shared cached departments (was an uncached mount GET,
  // duplicated across 7 pages). Same array data; RQ dedupes StrictMode
  // double-mount and shares one 10min-stale entry app-wide.
  const { data: departmentsData } = useDepartments()
  const departments: any[] = Array.isArray(departmentsData) ? departmentsData : []
  // Epoch guard: rapid id switches must not let a stale getOne resolve
  // paint over the fresh hackathon.
  const loadEpoch = useRef(0)
  const [showRegister, setShowRegister] = useState(false)
  const [showAddRound, setShowAddRound] = useState(false)
  const [form, setForm] = useState({ teamName: '', teamMembers: '', projectIdea: '' })
  const [roundForm, setRoundForm] = useState({ roundNumber: '1', title: '', description: '', date: '', resultDate: '' })
  const [editingRound, setEditingRound] = useState<string | null>(null)
  const [roundEditData, setRoundEditData] = useState({ title: '', description: '', date: '', resultDate: '' })
  const [showResultPopup, setShowResultPopup] = useState(false)
  const [resultForm, setResultForm] = useState({ winPosition: '', review: '' })
  const [showRegistrations, setShowRegistrations] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  // Remind-registered (#5 leftovers): teacher modal state
  const [showRemind, setShowRemind] = useState(false)
  const [remindMessage, setRemindMessage] = useState('')
  const [reminding, setReminding] = useState(false)
  // ── Registrations analytics + filters (keep analytics/export/dept+year like AssignmentDetail) ──
  const [regSearch, setRegSearch] = useState('')
  const [regDept, setRegDept] = useState('ALL')
  const [regYear, setRegYear] = useState('ALL')
  // Pulse selection — visual toggle, fixes dark whitener: selected = green black text, unselected = white/dark with contrast (never white-on-white)
  const [hackPulse, setHackPulse] = useState<'registered' | 'rounds'>('rounds')

  const isTeacher = user?.role === 'TEACHER' || user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'
  const isStudent = user?.role === 'STUDENT'
  const myRegistration = hackathon?.registrations?.find((r: any) => r.userId === user?.id)

  const handlePrint = () => window.print()


  useEffect(() => {
    if (id) loadHackathon()
    // Departments now come from the shared useDepartments() hook above —
    // the old uncached mount fetch was removed (PERPAGE-HALF1).
  }, [id])

  const loadHackathon = async () => {
    const epoch = ++loadEpoch.current
    try {
      const data = await hackathonAPI.getOne(id!)
      if (epoch !== loadEpoch.current) return
      setHackathon(data)
    } catch (err) {
      if (epoch !== loadEpoch.current) return
      toast.error('Failed to load hackathon')
      navigate('/hackathons')
    } finally {
      if (epoch === loadEpoch.current) setLoading(false)
    }
  }

  const handleRegister = async () => {
    try {
      await hackathonAPI.register(id!, form)
      toast.success('Registered successfully!')
      setShowRegister(false)
      setForm({ teamName: '', teamMembers: '', projectIdea: '' })
      notifyEntityMutated('hackathon')
      loadHackathon()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to register')
    }
  }

  const handleUnregister = async () => {
    if (!myRegistration) return
    const ok = await confirmDialog({
      title: 'Unregister?',
      message: `Leave "${hackathon?.title}"? You can re-register later.`,
      confirmLabel: 'Unregister',
    })
    if (!ok) return
    try {
      await hackathonAPI.unregister(id!)
      toast.success('Unregistered — you can re-register anytime')
      notifyEntityMutated('hackathon')
      loadHackathon()
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
      const res: any = await hackathonAPI.remind(id!, message)
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

  const handleMarkSelected = async (round: number) => {
    if (!myRegistration) return
    try {
      const maxRound = hackathon.rounds?.length > 0 ? Math.max(...hackathon.rounds.map((r: any) => r.roundNumber)) : 0
      const isLastRound = round >= maxRound

      if (isLastRound) {
        await hackathonAPI.updateRound(id!, myRegistration.id, { round, status: 'COMPLETED' })
        setShowResultPopup(true)
      } else {
        await hackathonAPI.updateRound(id!, myRegistration.id, { round, status: 'SELECTED' })
        toast.success(`Marked as selected for Round ${round}!`)
        loadHackathon()
      }
    } catch (err) {
      toast.error('Failed to update')
    }
  }

  const handleSubmitResult = async () => {
    if (!myRegistration) return
    try {
      await hackathonAPI.submitResult(id!, myRegistration.id, resultForm)
      toast.success('Result submitted!')
      setShowResultPopup(false)
      setResultForm({ winPosition: '', review: '' })
      loadHackathon()
    } catch (err) {
      toast.error('Failed to submit result')
    }
  }

  const handleAddRound = async () => {
    try {
      await hackathonAPI.addRound(id!, roundForm)
      toast.success('Round added!')
      setShowAddRound(false)
      setRoundForm({ roundNumber: '1', title: '', description: '', date: '', resultDate: '' })
      loadHackathon()
    } catch (err) {
      toast.error('Failed to add round')
    }
  }

  const handleEditRound = (round: any) => {
    setEditingRound(round.id)
    setRoundEditData({ title: round.title, description: round.description || '', date: round.date || '', resultDate: round.resultDate || '' })
  }

  const handleSaveRound = async (roundId: string) => {
    try {
      await hackathonAPI.updateRoundDetails(hackathon!.id, roundId, roundEditData)
      toast.success('Round updated')
      setEditingRound(null)
      loadHackathon()
    } catch (err) { toast.error('Failed to update round') }
  }

  const handleDeleteRound = async (roundId: string) => {
    const ok = await confirmDialog({ title: 'Delete round?', message: 'Delete this round and its results?', confirmLabel: 'Delete' })
    if (!ok) return
    try {
      await hackathonAPI.deleteRound(hackathon!.id, roundId)
      toast.success('Round deleted')
      loadHackathon()
    } catch (err) { toast.error('Failed to delete round') }
  }

  // ── Countdown hooks — MUST be unconditional before early returns (hooks order fix) ──
  // All hooks declared at top level before any conditional return; null-safe args.
  const countdownTarget: Date | null = hackathon?.deadline
    ? new Date(hackathon.deadline)
    : hackathon?.startDate
      ? new Date(hackathon.startDate)
      : null
  const countdownLabel: string = (() => {
    if (!hackathon) return ''
    if (hackathon.deadline && new Date(hackathon.deadline).getTime() > Date.now()) return 'Registration closes in'
    if (hackathon.startDate && new Date(hackathon.startDate).getTime() > Date.now()) return 'Hackathon starts in'
    return ''
  })()
  const [__tick, set__tick] = useState<number>(Date.now())
  // STATE-SYNC: external mutations (other tab/device) refresh without reload.
  useEntitySync('hackathon', loadHackathon as any)
  useEffect(() => {
    if (!countdownTarget || countdownTarget.getTime() <= Date.now()) return
    const id = setInterval(() => set__tick(Date.now()), 1000)
    return () => clearInterval(id)
    // stringify date to avoid object identity churn; empty string when null keeps hook unconditional
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
  // legacy string for side fallback / urgent calc
  const countdown: string | null = countdownParts
    ? countdownParts.d > 0
      ? `${countdownParts.d}d ${countdownParts.h}h left`
      : countdownParts.h > 0
        ? `${countdownParts.h}h ${countdownParts.m}m left`
        : `${countdownParts.m}m ${countdownParts.s}s left`
    : null
  const isUrgent = (() => {
    const dl = hackathon?.deadline ? new Date(hackathon.deadline).getTime() : null
    if (!dl) return false
    const diff = dl - Date.now()
    return diff > 0 && diff <= 3 * 24 * 60 * 60 * 1000
  })()
  const isCritical = countdownParts !== null && countdownParts.d === 0 && countdownParts.h < 6

  // -- Registrations analytics derived (MUST be before early returns -- hooks order fix) --
  // Pure helpers live in components/hackathonDetail/registrationUtils.ts (SRP split).
  const regAvailableYears = useMemo(() => getRegAvailableYears(hackathon?.registrations), [hackathon])
  const regDeptBreakdown = useMemo(() => getRegDeptBreakdown(hackathon?.registrations), [hackathon])
  const regYearBreakdown = useMemo(() => getRegYearBreakdown(hackathon?.registrations), [hackathon])
  const filteredRegs = useMemo(
    () => filterRegs(hackathon?.registrations, { term: regSearch, dept: regDept, year: regYear, departments }),
    [hackathon, regSearch, regDept, regYear, departments],
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[45vh]">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin dark:text-primary-500" />
      </div>
    )
  }

  if (!hackathon) return null

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

  const parsedThemes = safeParse(hackathon.themes)
  const parsedBootcamps = safeParse(hackathon.bootcamps)
  const parsedHighlights = safeParse(hackathon.highlights)
  const selectedCount = hackathon.registrations.filter((r: any) => r.status === 'SELECTED').length

  // Parse prize amounts from prizePool string
  const extractAmounts = (text: string): number[] => {
    if (!text) return []
    const matches = text.match(/[₹$]\s*[\d,]+(?:\.\d+)?(?:\s*(?:lakh|lac|k|L|K|cr|Cr))?/gi) || []
    return matches.map(m => {
      let num = parseFloat(m.replace(/[₹$,]/g, '').trim())
      if (/lakh|lac/i.test(m)) num *= 100000
      else if (/cr/i.test(m)) num *= 10000000
      else if (/k/i.test(m)) num *= 1000
      return num
    }).filter(n => !isNaN(n) && n > 0)
  }

  const prizeAmounts = extractAmounts(hackathon.prizePool || '')
  const maxPrize = prizeAmounts.length > 0 ? Math.max(...prizeAmounts) : null
  const totalPrize = prizeAmounts.length > 1 ? prizeAmounts.reduce((a, b) => a + b, 0) : null

  // Categorize highlights into tiers and extras
  const tierKeywords = ['1st', '2nd', '3rd', 'first', 'second', 'third', 'winner', 'runner', 'prize']
  const extraKeywords = ['certificate', 'certificates', 'goodies', 'swag', 'swags', 'networking', 'recognition', 'mentorship', 'showcase', 'opportunity', 'opportunities', 'workshop', 'tshirt', 't-shirt', 'medal', 'trophy']

  const parsedTiers: string[] = []
  const parsedExtras: string[] = []
  parsedHighlights.forEach((h: string) => {
    const lower = h.toLowerCase()
    if (tierKeywords.some(k => lower.includes(k))) {
      parsedTiers.push(h)
    } else if (extraKeywords.some(k => lower.includes(k))) {
      parsedExtras.push(h)
    } else {
      parsedExtras.push(h)
    }
  })

  const targetDeptIds: string[] = safeParse(hackathon.targetDepartments)
  const targetYears: number[] = safeParse(hackathon.targetYears).map(Number)
  const isUUID = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  const targetDeptNames = targetDeptIds.length > 0
    ? departments.filter(d => targetDeptIds.some(t => isUUID(t) ? t === d.id : t.toUpperCase() === d.name.toUpperCase())).map(d => d.name)
    : []

  const isEligible = !hackathon.eligibilityEnabled || (() => {
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
    const startDate = hackathon.startDate ? new Date(hackathon.startDate) : null
    const endDate = hackathon.endDate ? new Date(hackathon.endDate) : null
    const deadline = hackathon.deadline ? new Date(hackathon.deadline) : null

    if (hackathon.status === 'ENDED') return { label: 'Ended', color: 'bg-zinc-700 dark:bg-zinc-700' }
    if (startDate && endDate) {
      if (now < startDate) return { label: 'Upcoming', color: 'bg-primary-600 dark:bg-primary-600' }
      if (now > endDate) return { label: 'Ended', color: 'bg-zinc-700 dark:bg-zinc-700' }
      return { label: 'Ongoing', color: 'bg-warning-600 dark:bg-warning-600' }
    }
    if (startDate) {
      if (now < startDate) return { label: 'Upcoming', color: 'bg-primary-600 dark:bg-primary-600' }
      return { label: 'Ongoing', color: 'bg-warning-600 dark:bg-warning-600' }
    }
    if (deadline) {
      if (now < deadline) return { label: 'Upcoming', color: 'bg-primary-600 dark:bg-primary-600' }
      return { label: 'Ongoing', color: 'bg-warning-600 dark:bg-warning-600' }
    }
    return { label: 'Upcoming', color: 'bg-primary-600 dark:bg-primary-600' }
  }

  const statusBadge = getStatusBadge()
  const completedCount = hackathon.registrations.filter((r: any) => r.status === 'COMPLETED').length
  const totalRegs = hackathon.registrations.length
  const successRate = totalRegs > 0 ? Math.round((selectedCount / totalRegs) * 100) : 0

  const handleExportFiltered = () => {
    if (filteredRegs.length === 0) { toast.error('No registrations to export'); return }
    const header = ['Roll No','Name','Email','Department','Team','Status','Round','Position','Review']
    const esc = (v:any)=> { const s=String(v??''); if(s.includes(',')||s.includes('"')||s.includes('\n')) return `"${s.replace(/"/g,'""')}"`; return s }
    const lines = [header.map(esc).join(',')]
    filteredRegs.forEach((r:any)=>{
      const cols=[r.user?.studentId||'',r.user?.name||'',r.user?.email||'',r.user?.department?.name||r.user?.department||r.user?.departmentName||'',r.teamName||'',r.status||'',r.currentRound??'',r.winPosition||'',(r.review||'').replace(/\n/g,' ')]
      lines.push(cols.map(esc).join(','))
    })
    const blob=new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8;'})
    const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`hackathon-${hackathon.id}-filtered-${new Date().toISOString().slice(0,10)}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000); toast.success(`Exported ${filteredRegs.length} rows`)
  }
  const handleExportXlsx = () => {
    hackathonAPI.exportOne(hackathon.id, `${hackathon.title.replace(/\s+/g,'_')}.xlsx`)
  }

  const tabs = [
    { key: 'overview', label: 'Overview', icon: Info },
    { key: 'tracks', label: 'Tracks', icon: Layers },
    { key: 'timeline', label: 'Timeline', icon: CalendarClock },
    { key: 'rules', label: 'Rules', icon: Shield },
    { key: 'resources', label: 'Resources', icon: Link2 },
    { key: 'registrations', label: 'Registrations', icon: List },
  ]

  return (
    <div className="space-y-6 max-w-[1280px] mx-auto">
      <h1 className="sr-only">Hackathon Detail</h1>
      <div className="hidden rounded-[32px] bg-[#0a0a0a] backdrop-blur-[18px] bg-white/[0.010] border border-white/[0.035] grid-cols-12 from-primary-500/[0.035] via-white/[0.008] to-emerald-500/[0.04] from-primary-500/[0.07] w-[460px] h-[460px] blur-[72px] opacity-[0.018] bg-white/[0.032] dark:bg-white/[0.028] bg-white/[0.025] backdrop-blur-md border-white/[0.035] dark:border-white/[0.035] bg-white/[0.035] border-white/[0.06] backdrop-blur-[12px] before:h-px bg-white/[0.035] dark:bg-white/[0.010] dark:border-white/[0.035] bg-white/[0.015] via-white/[0.008] from-primary-500/[0.035] opacity-[0.018]" />
      {/* ─── Premium Hero — Brand mesh, glass stats, countdown, orbs ─── */}
      <PremiumHero
        icon={<Trophy size={18} />}
        eyebrow={`Opportunities · Hackathon${hackathon.mode ? ' · ' + hackathon.mode : ''}${isUrgent ? ' · Due soon' : ''}`}
        title={<span className="text-balance">{hackathon.title}</span>}
        subtitle={hackathon.organizer ? `by ${hackathon.organizer} · ${hackathon.mode || 'TBD'} · ${hackathon.location || 'Online'} — ${hackathon.registrations.length} participants · ${hackathon.rounds.length} rounds` : `${hackathon.mode || 'TBD'} · ${hackathon.location || 'Online'} — ${hackathon.registrations.length} participants`}
        actions={
          <>
            <button onClick={() => navigate('/hackathons')} className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full bg-white text-black dark:text-black text-[12px] font-black hover:bg-zinc-100 dark:hover:bg-zinc-100 transition-colors shadow-md">
              <ArrowLeft size={13}/> Back
            </button>
            {hackathon.url && (
              <a href={hackathon.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full bg-white/10 backdrop-blur-md border border-white/15 dark:border-white/15 text-white dark:text-white text-[12px] font-bold hover:bg-white/15 dark:hover:bg-white/15 transition-colors">
                <ExternalLink size={13}/> Website
              </a>
            )}
            {isTeacher && (
              <>
                <button onClick={handlePrint} className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full bg-white/10 backdrop-blur-md border border-white/15 dark:border-white/15 text-white dark:text-white text-[12px] font-bold hover:bg-white/15 dark:hover:bg-white/15 transition-colors">
                  <Printer size={13}/> Print
                </button>
                <button onClick={() => hackathonAPI.exportOne(hackathon.id, `${hackathon.title.replace(/\s+/g, '_')}.xlsx`)} className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full bg-primary-500 text-black dark:text-black text-[12px] font-black hover:bg-[#1ed760] dark:hover:bg-[#1ed760] shadow-[0_6px_16px_rgba(30,215,96,0.30)] transition-colors">
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
              <span>Hackathon Pulse</span>
              {isUrgent && <span className="w-2 h-2 rounded-full bg-danger-500 dark:bg-danger-500 animate-pulse shadow-[0_0_0_4px_rgba(255,75,92,0.2)]" />}
            </p>
            {/* Pulse cards — fixed dark: contrast: unselected = bg-white dark:bg-[#121212] with dark:text-white, selected = bg-primary-500 dark:bg-primary-500 with dark:text-black (no whitener white-on-white). Click to toggle. */}
            <div className="mt-2.5 grid grid-cols-2 gap-1.5">
              <button onClick={() => setHackPulse('registered')} className={clsx('rounded-xl p-2.5 border text-left transition-all active:scale-[0.98] hover:-translate-y-0.5', hackPulse === 'registered' ? 'bg-primary-500 dark:bg-primary-500 border-primary-500 dark:border-primary-500 shadow-[0_6px_16px_rgba(30,215,96,0.22)] text-black dark:text-black' : 'bg-white dark:bg-[#121212] border-white/10 dark:border-white/10')}>
                <p className={clsx('text-[10px] font-black tracking-widest uppercase', hackPulse === 'registered' ? 'text-black/60 dark:text-black/60' : 'text-zinc-500 dark:text-white/60')}>Registered</p>
                <p className={clsx('mt-1 font-display text-[18px] font-[800] leading-none', hackPulse === 'registered' ? 'text-black dark:text-black' : 'text-zinc-900 dark:text-white')}>{hackathon.registrations.length}</p>
                <p className={clsx('mt-1 text-[10px] font-semibold', hackPulse === 'registered' ? 'text-black/60 dark:text-black/60' : 'text-zinc-600 dark:text-white/60')}>{selectedCount} selected</p>
              </button>
              <button onClick={() => setHackPulse('rounds')} className={clsx('rounded-xl p-2.5 border text-left transition-all active:scale-[0.98] hover:-translate-y-0.5', hackPulse === 'rounds' ? 'bg-primary-500 dark:bg-primary-500 border-primary-500 dark:border-primary-500 shadow-[0_6px_16px_rgba(30,215,96,0.22)] text-black dark:text-black' : 'bg-white dark:bg-[#121212] border-white/10 dark:border-white/10')}>
                <p className={clsx('text-[10px] font-black tracking-widest uppercase', hackPulse === 'rounds' ? 'text-black/60 dark:text-black/60' : 'text-zinc-500 dark:text-white/60')}>Rounds</p>
                <p className={clsx('mt-1 font-display text-[18px] font-[800] leading-none', hackPulse === 'rounds' ? 'text-black dark:text-black' : 'text-zinc-900 dark:text-white')}>{hackathon.rounds.length}</p>
                <p className={clsx('mt-1 text-[10px] font-bold', hackPulse === 'rounds' ? 'text-black/70 dark:text-black/70' : 'text-zinc-600 dark:text-white/60')}>{hackathon.teamSize ? `Up to ${hackathon.teamSize}` : 'Team Event'}</p>
              </button>
            </div>
            {hackathon.prizePool && (
              <div className="mt-2.5 rounded-xl bg-white/[0.032] dark:bg-white/[0.028] backdrop-blur-md border border-white/[0.035] dark:border-white/[0.035] p-2.5 flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500 to-primary-500 flex items-center justify-center text-white shadow shrink-0 dark:bg-gradient-to-br dark:from-amber-500 dark:to-primary-500 dark:text-white"><Trophy size={14}/></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-black tracking-widest uppercase text-zinc-500 dark:text-white/60 leading-none">Prize Pool</p>
                  <p className="text-[12px] font-black text-zinc-900 dark:text-white truncate mt-1">{hackathon.prizePool}</p>
                  {maxPrize && <p className="text-[10px] font-mono tabular-nums font-black text-primary-600 dark:text-primary-400">₹{maxPrize.toLocaleString('en-IN')} top</p>}
                </div>
              </div>
            )}
            {/* Meta — starts / deadline compact */}
            <div className="mt-2.5 rounded-xl bg-white/[0.025] dark:bg-white/[0.025] backdrop-blur-md border border-white/[0.035] dark:border-white/[0.035] p-2.5">
              {hackathon.startDate && (
                <div className="flex items-center justify-between text-white dark:text-white">
                  <span className="text-[11px] font-bold text-white/70 dark:text-white/70 flex items-center gap-1"><Calendar size={11}/> Starts</span>
                  <span className="text-xs font-black text-white dark:text-white">{new Date(hackathon.startDate).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric'})}</span>
                </div>
              )}
              {hackathon.deadline && (
                <div className="flex items-center justify-between text-white dark:text-white mt-1.5">
                  <span className="text-[11px] font-bold text-white/70 dark:text-white/70 flex items-center gap-1"><Clock size={11}/> Deadline</span>
                  <span className="text-xs font-black text-white dark:text-white">{new Date(hackathon.deadline).toLocaleDateString()}</span>
                </div>
              )}
              {hackathon.location && (
                <div className="flex items-center gap-1.5 mt-1.5 text-[11px] font-bold text-white/60 dark:text-white/60">
                  <MapPin size={11}/> {hackathon.location}
                </div>
              )}
            </div>
            {/* Countdown — premium 4-box grid in banner next to prize spotlight */}
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
                <p className="text-xs font-black text-white/70 dark:text-white/70">Registration closed</p>
                {hackathon.startDate && <p className="text-[11px] font-medium text-white/50 dark:text-white/50 mt-0.5">Started {new Date(hackathon.startDate).toLocaleDateString()}</p>}
              </div>
            ) : null}
          </GlassPanel>
        }
      />

      {/* ─── Tabs — premium pill, Brand active, glass inactive ─── */}
      <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] p-2 flex items-center gap-1.5 flex-wrap overflow-x-auto print:hidden shadow-sm">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={clsx(
                'inline-flex items-center gap-1.5 px-4 h-10 rounded-full text-sm font-black whitespace-nowrap transition-all active:scale-[0.98]',
                activeTab === key
                  ? 'bg-primary-500 text-black shadow-[0_4px_16px_rgba(30,215,96,0.3)] dark:bg-primary-500 dark:text-black'
                  : 'bg-surface-50 dark:bg-[#0a0a0a] border border-surface-200 dark:border-[#282828] text-surface-600 dark:text-night-300 hover:border-primary-500/20 hover:text-surface-900 dark:hover:text-white'
              )}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
      </div>

      {/* ─── Tab Content — premium bento with stagger ─── */}
      <motion.div initial="hidden" animate="show" variants={{ hidden:{}, show:{ transition:{ staggerChildren:0.06, delayChildren:0.08}}}}>
      <div>
        {/* ============= OVERVIEW TAB — Bento 12-col premium ============= */}
        {activeTab === 'overview' && (
          <BentoGrid>
            {/* Main — 8 cols */}
            <div className="col-span-12 lg:col-span-8 space-y-6">
              {/* About — SectionCard with top gradient */}
              {hackathon.description && (
                <SectionCard title="About this Hackathon" subtitle={`${hackathon.organizer ? 'By ' + hackathon.organizer : 'Overview'} · ${hackathon.mode || 'TBD'} · ${hackathon.location || 'Online'}`} icon={<Info size={16}/>} gradient="from-primary-500 via-primary-500 to-emerald-500 dark:from-primary-500 dark:via-primary-500 dark:to-emerald-500">
                  <p className="text-surface-600 dark:text-night-300 leading-relaxed whitespace-pre-line text-[14px]">{hackathon.description}</p>
                </SectionCard>
              )}

              {/* Quick Facts — BentoGrid 12 with varied sizes: 6 mini bentos — 3 per row on lg */}
              <BentoGrid>
                {hackathon.startDate && (
                  <BentoCard span="col-span-6 lg:col-span-4" padding={false} hover={true} className="p-4 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-500/15 flex items-center justify-center shrink-0 border border-primary-100 dark:border-primary-500/20">
                        <Calendar size={18} className="text-primary-600 dark:text-primary-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-black text-surface-400 dark:text-night-400 uppercase tracking-widest leading-none">Event Starts</p>
                        <p className="text-sm font-[800] text-surface-900 dark:text-white mt-1 whitespace-nowrap tracking-[-0.01em]">{new Date(hackathon.startDate).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric'})}</p>
                      </div>
                  </BentoCard>
                )}
                {hackathon.deadline && (
                  <BentoCard span="col-span-6 lg:col-span-4" padding={false} hover={true} className="p-4 flex items-center gap-3">
                      <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border', isUrgent ? 'bg-danger-50 dark:bg-danger-500/15 border-danger-200 dark:border-danger-500/20' : 'bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700')}>
                        <Clock size={18} className={isUrgent ? 'text-danger-500 dark:text-danger-500' : 'text-zinc-600 dark:text-zinc-300'} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-black text-surface-400 dark:text-night-400 uppercase tracking-widest leading-none">Deadline {isUrgent && '· Due soon'}</p>
                        <p className="text-sm font-[800] text-surface-900 dark:text-white mt-1 whitespace-nowrap">{new Date(hackathon.deadline).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric'})}</p>
                      </div>
                  </BentoCard>
                )}
                {hackathon.prizePool && (
                  <BentoCard span="col-span-6 lg:col-span-4" padding={false} hover={true} className="p-4 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-warning-50 dark:bg-warning-500/15 flex items-center justify-center shrink-0 border border-warning-200 dark:border-warning-500/20">
                        <DollarSign size={18} className="text-warning-600 dark:text-warning-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-black text-surface-400 dark:text-night-400 uppercase tracking-widest leading-none">Prize Pool</p>
                        <p className="text-sm font-[800] text-surface-900 dark:text-white mt-1 break-words leading-tight line-clamp-1">{hackathon.prizePool}</p>
                      </div>
                  </BentoCard>
                )}
                {hackathon.teamSize && (
                  <BentoCard span="col-span-6 lg:col-span-4" padding={false} hover={true} className="p-4 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-500/15 flex items-center justify-center shrink-0 border border-primary-100 dark:border-primary-500/20">
                        <Users size={18} className="text-primary-600 dark:text-primary-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-black text-surface-400 dark:text-night-400 uppercase tracking-widest leading-none">Team Size</p>
                        <p className="text-sm font-[800] text-surface-900 dark:text-white mt-1 whitespace-nowrap">Up to {hackathon.teamSize}</p>
                      </div>
                  </BentoCard>
                )}
                {hackathon.duration && (
                  <BentoCard span="col-span-6 lg:col-span-4" padding={false} hover={true} className="p-4 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 flex items-center justify-center shrink-0 border border-emerald-200 dark:border-emerald-500/20">
                        <Timer size={18} className="text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-black text-surface-400 dark:text-night-400 uppercase tracking-widest leading-none">Duration</p>
                        <p className="text-sm font-[800] text-surface-900 dark:text-white mt-1 break-words leading-tight">{hackathon.duration}</p>
                      </div>
                  </BentoCard>
                )}
                {hackathon.location && (
                  <BentoCard span="col-span-6 lg:col-span-4" padding={false} hover={true} className="p-4 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center shrink-0 border border-zinc-200 dark:border-zinc-700">
                        <MapPin size={18} className="text-zinc-600 dark:text-zinc-300" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-black text-surface-400 dark:text-night-400 uppercase tracking-widest leading-none">Location</p>
                        <p className="text-sm font-[800] text-surface-900 dark:text-white mt-1 break-words leading-tight">{hackathon.location}</p>
                      </div>
                  </BentoCard>
                )}
              </BentoGrid>

              {/* Prizes — Spotlight bento: hero + tiers + perks */}
              {hackathon.prizePool && (
                <SectionCard title="Prizes & Rewards" subtitle="Prize spotlight · What you get · Credibility" icon={<Trophy size={16}/>} gradient="from-warning-500 via-amber-500 to-primary-500 dark:from-warning-500 dark:via-amber-500 dark:to-primary-500">
                  {/* Hero Prize — glass orbs, mesh, max/total chips */}
                  <div className="relative overflow-hidden rounded-[20px] bg-gradient-to-br from-amber-50 via-yellow-50 to-emerald-50 dark:from-amber-950/30 dark:via-yellow-950/20 dark:to-emerald-950/20 border border-amber-200/50 dark:border-amber-800/20 p-6">
                    <div className="absolute -top-10 -right-10 w-40 h-40 bg-amber-200/30 dark:bg-amber-500/10 rounded-full blur-[30px]" />
                    <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-primary-200/20 dark:bg-primary-500/10 rounded-full blur-[30px]" />
                    <div className="relative">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-primary-500 flex items-center justify-center shadow-[0_8px_24px_rgba(245,183,0,0.25)] text-white dark:bg-gradient-to-br dark:from-amber-500 dark:to-primary-500 dark:text-white">
                          <Trophy size={22} />
                        </div>
                        <div>
                          <p className="text-[11px] font-black tracking-widest uppercase text-amber-700 dark:text-amber-300">Total Prize Pool</p>
                          <p className="font-display text-[24px] font-[800] tracking-[-0.02em] leading-none text-amber-900 dark:text-amber-100">{hackathon.prizePool}</p>
                        </div>
                      </div>
                      {(maxPrize || totalPrize) && (
                        <div className="flex gap-3 mt-4">
                          {maxPrize && (
                            <div className="flex-1 rounded-xl bg-white/80 dark:bg-white/[0.06] backdrop-blur border border-amber-200/40 dark:border-white/10 p-3">
                              <p className="text-[10px] font-black tracking-widest uppercase text-zinc-500 dark:text-white/60">Max Prize</p>
                              <p className="font-display text-[18px] font-[800] leading-none text-amber-700 dark:text-amber-300 mt-1">₹{maxPrize.toLocaleString('en-IN')}</p>
                            </div>
                          )}
                          {totalPrize && totalPrize !== maxPrize && (
                            <div className="flex-1 rounded-xl bg-white/80 dark:bg-white/[0.06] backdrop-blur border border-amber-200/40 dark:border-white/10 p-3">
                              <p className="text-[10px] font-black tracking-widest uppercase text-zinc-500 dark:text-white/60">Combined Worth</p>
                              <p className="font-display text-[18px] font-[800] leading-none text-amber-700 dark:text-amber-300 mt-1">₹{totalPrize.toLocaleString('en-IN')}</p>
                            </div>
                          )}
                        </div>
                      )}
                      <p className="mt-3 text-[11px] font-semibold text-amber-700/70 dark:text-amber-300/60 flex items-center gap-1.5"><Star size={11}/> Verified on CampusFlow · Sponsor credibility</p>
                    </div>
                  </div>

                  {/* Prize Tiers — bento varied 3 per row */}
                  {parsedTiers.length > 0 && (
                    <div className="mt-6">
                      <p className="text-[11px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400 mb-3">Prize Breakdown</p>
                      <BentoGrid>
                        {parsedTiers.map((tier: string, i: number) => {
                          const tierAmounts = extractAmounts(tier)
                          const isTop3 = i < 3
                          const medals = ['🥇','🥈','🥉']
                          return (
                            <BentoCard key={i} span={isTop3 ? 'col-span-12 md:col-span-4' : 'col-span-12 md:col-span-6'} hover={true} className={clsx('p-4 flex gap-3 items-start', isTop3 ? 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-800/20' : '')}>
                                <span className="text-xl shrink-0 leading-none">{isTop3 ? medals[i] : '🏆'}</span>
                                <div className="min-w-0">
                                  <p className="text-sm font-[700] text-surface-900 dark:text-white leading-snug">{tier}</p>
                                  {tierAmounts.length > 0 && (
                                    <p className="text-xs font-black text-amber-700 dark:text-amber-300 mt-1">₹{tierAmounts[0].toLocaleString('en-IN')}</p>
                                  )}
                                </div>
                            </BentoCard>
                          )
                        })}
                      </BentoGrid>
                    </div>
                  )}

                  {/* Perks Bento — varied icon grid 2 per row */}
                  {parsedExtras.length > 0 && (
                    <div className="mt-6">
                      <p className="text-[11px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400 mb-3">What You Get — Perks Bento</p>
                      <BentoGrid>
                        {parsedExtras.map((extra: string, i: number) => {
                          const lower = extra.toLowerCase()
                          const icon = lower.includes('certificate') ? '📜'
                            : lower.includes('goodies') || lower.includes('swag') ? '🎁'
                            : lower.includes('networking') ? '🤝'
                            : lower.includes('recognition') ? '⭐'
                            : lower.includes('mentor') ? '👨‍🏫'
                            : lower.includes('showcase') || lower.includes('opportunity') ? '🚀'
                            : lower.includes('workshop') ? '📚'
                            : lower.includes('tshirt') || lower.includes('t-shirt') ? '👕'
                            : lower.includes('medal') || lower.includes('trophy') ? '🏅'
                            : '✨'
                          return (
                            <BentoCard key={i} span="col-span-12 sm:col-span-6" padding={true} hover={true} className="p-3 flex items-center gap-3">
                                <span className="w-9 h-9 rounded-xl bg-surface-50 dark:bg-white/[0.06] border border-surface-200 dark:border-white/10 flex items-center justify-center text-base shrink-0">{icon}</span>
                                <p className="text-sm font-medium text-surface-700 dark:text-night-200 leading-snug">{extra}</p>
                            </BentoCard>
                          )
                        })}
                      </BentoGrid>
                    </div>
                  )}

                  {parsedHighlights.length === 0 && (
                    <p className="mt-4 text-sm text-surface-600 dark:text-night-300 leading-relaxed">{hackathon.prizePool}</p>
                  )}
                </SectionCard>
              )}

              {/* Judging Criteria — 3 bento with mesh, orbs */}
              {hackathon.eligibility && (
                <BentoGrid>
                  <BentoCard span="col-span-12 md:col-span-4" className="text-center p-6 relative overflow-hidden">
                    <div className="absolute -top-8 -right-8 w-24 h-24 bg-primary-500/10 rounded-full blur-[20px] dark:bg-primary-500/10" />
                    <div className="w-11 h-11 rounded-xl bg-primary-500 text-white flex items-center justify-center mx-auto shadow-[0_8px_20px_rgba(30,215,96,0.25)] dark:bg-primary-500 dark:text-white"><Lightbulb size={18}/></div>
                    <p className="mt-3 font-display text-sm font-[800] tracking-[-0.01em] text-surface-900 dark:text-white">Innovation</p>
                    <p className="mt-1 text-xs font-medium text-surface-500 dark:text-night-400 leading-relaxed">Originality and creativity of the idea</p>
                  </BentoCard>
                  <BentoCard span="col-span-12 md:col-span-4" className="text-center p-6 relative overflow-hidden">
                    <div className="absolute -top-8 -right-8 w-24 h-24 bg-emerald-500/10 rounded-full blur-[20px] dark:bg-emerald-500/10" />
                    <div className="w-11 h-11 rounded-xl bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center mx-auto shadow"><Zap size={18}/></div>
                    <p className="mt-3 font-display text-sm font-[800] tracking-[-0.01em] text-surface-900 dark:text-white">Technical Execution</p>
                    <p className="mt-1 text-xs font-medium text-surface-500 dark:text-night-400 leading-relaxed">Code quality and implementation</p>
                  </BentoCard>
                  <BentoCard span="col-span-12 md:col-span-4" className="text-center p-6 relative overflow-hidden">
                    <div className="absolute -top-8 -right-8 w-24 h-24 bg-amber-500/10 rounded-full blur-[20px] dark:bg-amber-500/10" />
                    <div className="w-11 h-11 rounded-xl bg-amber-500 text-white flex items-center justify-center mx-auto shadow dark:bg-amber-500 dark:text-white"><Target size={18}/></div>
                    <p className="mt-3 font-display text-sm font-[800] tracking-[-0.01em] text-surface-900 dark:text-white">Impact</p>
                    <p className="mt-1 text-xs font-medium text-surface-500 dark:text-night-400 leading-relaxed">Real-world usefulness and feasibility</p>
                  </BentoCard>
                </BentoGrid>
              )}

              {/* Bootcamps — premium list bento */}
              {parsedBootcamps.length > 0 && (
                <SectionCard title="Bootcamps" subtitle="Pre-hack learning · Workshops" icon={<GraduationCap size={16}/>} gradient="from-primary-500 via-emerald-500 to-primary-600 dark:from-primary-500 dark:via-emerald-500 dark:to-primary-600">
                  <div className="space-y-3">
                    {parsedBootcamps.map((b: string, i: number) => (
                      <div key={i} className="flex items-start gap-3 p-4 rounded-xl bg-primary-50 dark:bg-primary-500/10 border border-primary-100 dark:border-primary-500/20 hover:-translate-y-0.5 transition-transform">
                        <div className="w-9 h-9 rounded-xl bg-primary-500 text-white flex items-center justify-center shrink-0 mt-0.5 dark:bg-primary-500 dark:text-white"><GraduationCap size={16}/></div>
                        <p className="text-sm font-medium text-surface-700 dark:text-night-200 leading-relaxed flex-1">{b}</p>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )}
            </div>

            {/* Sidebar — 4 cols, bento premium, glass CTA */}
            <div className="col-span-12 lg:col-span-4 space-y-6">
              {/* Registration CTA — glass bento */}
              {isStudent && (
                <div className="relative overflow-hidden rounded-[24px] border border-surface-200 dark:border-[#282828] bg-white dark:bg-[#121212] p-6 shadow-sm print:hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary-500/[0.04] via-transparent to-emerald-500/[0.03] dark:bg-gradient-to-br dark:from-primary-500/[0.04] dark:via-transparent dark:to-emerald-500/[0.03]" />
                  <div className="absolute -top-16 -right-16 w-40 h-40 bg-primary-500/10 rounded-full blur-[30px] dark:bg-primary-500/10" />
                  <div className="relative">
                  {myRegistration ? (
                    <div>
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-primary-500 flex items-center justify-center shadow-[0_8px_20px_rgba(30,215,96,0.25)] dark:bg-primary-500"><CheckCircle size={18} className="text-white dark:text-white" /></div>
                        <div>
                          <h3 className="font-display font-[800] tracking-[-0.01em] text-surface-900 dark:text-white leading-none">Registered!</h3>
                          <p className="text-xs font-medium text-surface-500 dark:text-night-400 mt-1">You're in — track progress below</p>
                        </div>
                      </div>
                      <div className="space-y-2.5 text-sm mb-4">
                        {myRegistration.teamName && (
                          <div className="flex items-center justify-between p-3 rounded-xl bg-surface-50 dark:bg-white/[0.04] border border-surface-100 dark:border-white/10">
                            <span className="text-xs font-bold tracking-widest uppercase text-surface-400 dark:text-night-400">Team</span>
                            <span className="font-[700] text-surface-900 dark:text-white text-sm">{myRegistration.teamName}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between p-3 rounded-xl bg-surface-50 dark:bg-white/[0.04] border border-surface-100 dark:border-white/10">
                          <span className="text-xs font-bold tracking-widest uppercase text-surface-400 dark:text-night-400">Status</span>
                          <span className="font-[800] text-primary-600 dark:text-primary-400 text-xs px-2.5 py-1 rounded-full bg-primary-50 dark:bg-primary-500/15 border border-primary-200 dark:border-primary-500/20">
                            {myRegistration.status === 'COMPLETED' ? 'Completed' : myRegistration.status === 'SELECTED' ? `Round ${myRegistration.currentRound}` : 'Registered'}
                          </span>
                        </div>
                        {myRegistration.winPosition && (
                          <div className="flex items-center justify-between p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
                            <span className="text-xs font-bold tracking-widest uppercase text-amber-700 dark:text-amber-300">Position</span>
                            <span className="font-[800] text-amber-700 dark:text-amber-300">{myRegistration.winPosition}</span>
                          </div>
                        )}
                        {myRegistration.review && (
                          <div className="p-3 rounded-xl bg-surface-50 dark:bg-white/[0.04] border border-surface-100 dark:border-white/10">
                            <p className="text-[10px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400">Your Review</p>
                            <p className="text-sm font-medium text-surface-700 dark:text-night-200 mt-1 leading-relaxed">{myRegistration.review}</p>
                          </div>
                        )}
                        <div className="flex items-center justify-between p-3 rounded-xl bg-surface-50 dark:bg-white/[0.04] border border-surface-100 dark:border-white/10">
                          <span className="text-xs font-bold tracking-widest uppercase text-surface-400 dark:text-night-400">Current Round</span>
                          <span className="w-7 h-7 rounded-full bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center text-xs font-black">{myRegistration.currentRound}</span>
                        </div>
                      </div>

                      <button
                        onClick={handleUnregister}
                        className="mt-4 w-full h-11 rounded-full border border-surface-200 dark:border-white/10 bg-white dark:bg-transparent text-surface-600 dark:text-night-300 text-sm font-black hover:border-danger-500/40 hover:text-danger-600 dark:hover:text-danger-400 transition-colors active:scale-[0.98]"
                      >
                        Unregister
                      </button>

                      {hackathon.rounds.length > 0 && (
                        <div className="pt-4 border-t border-surface-100 dark:border-white/10">
                          <p className="text-[11px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400 mb-3">Self-Report Progress</p>
                          <div className="space-y-2">
                            {hackathon.rounds.map((round: any) => {
                              const isCompleted = myRegistration.currentRound >= round.roundNumber
                              const isNext = myRegistration.currentRound === round.roundNumber - 1
                              const allDone = myRegistration.status === 'COMPLETED'
                              return (
                                <button key={round.id}
                                  onClick={() => handleMarkSelected(round.roundNumber)}
                                  disabled={!isNext || allDone}
                                  className={clsx('w-full flex items-center gap-2.5 p-3 rounded-xl text-sm font-[700] transition-all active:scale-[0.98]',
                                    allDone && isCompleted ? 'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-500/20' :
                                    isCompleted ? 'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-500/20' :
                                    isNext ? 'bg-primary-500 text-black hover:shadow-[0_8px_24px_rgba(30,215,96,0.30)] hover:-translate-y-0.5 shadow dark:bg-primary-500 dark:text-black' :
                                    'bg-surface-50 dark:bg-white/[0.04] text-surface-400 dark:text-night-400 border border-surface-100 dark:border-white/10 cursor-not-allowed'
                                  )}>
                                  {allDone && isCompleted ? <Trophy size={14} /> : isCompleted ? <CheckCircle size={14} /> : isNext ? <Rocket size={14} /> : <Clock size={14} />}
                                  {allDone && isCompleted ? `Round ${round.roundNumber} — Completed` :
                                   isCompleted ? `Round ${round.roundNumber} — Selected` :
                                   `Mark: Round ${round.roundNumber}`}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center">
                      <div className="w-16 h-16 rounded-[16px] bg-gradient-to-br from-primary-500 to-emerald-500 flex items-center justify-center mx-auto mb-4 shadow-[0_12px_32px_rgba(30,215,96,0.30)] dark:bg-gradient-to-br dark:from-primary-500 dark:to-emerald-500">
                        <Rocket size={26} className="text-white dark:text-white" />
                      </div>
                      <h3 className="font-display text-[18px] font-[800] tracking-[-0.02em] text-surface-900 dark:text-white leading-none">Join this Hackathon</h3>
                      <p className="text-surface-500 dark:text-night-400 text-sm mt-1">Register your team and start building</p>
                      {hackathon.eligibilityEnabled && (
                        <div className={clsx('mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-black border',
                          isEligible ? 'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 border-primary-200 dark:border-primary-500/20' : 'bg-danger-50 dark:bg-danger-500/15 text-danger-700 dark:text-danger-300 border-danger-200 dark:border-danger-500/20'
                        )}>
                          {isEligible ? <CheckCircle size={12} /> : <XCircle size={12} />}
                          {isEligible ? 'You are eligible' : 'Not eligible — check departments & years'}
                        </div>
                      )}
                      <button
                        onClick={() => setShowRegister(true)}
                        disabled={hackathon.eligibilityEnabled && !isEligible}
                        className={clsx('mt-4 w-full py-3 rounded-xl font-black text-sm transition-all active:scale-[0.98]',
                          hackathon.eligibilityEnabled && !isEligible
                            ? 'bg-surface-200 dark:bg-zinc-800 text-surface-400 dark:text-zinc-400 cursor-not-allowed'
                            : 'bg-[#0a0a0a] dark:bg-white text-white dark:text-black hover:shadow-[0_12px_32px_rgba(0,0,0,0.15)] hover:-translate-y-0.5'
                        )}>
                        {hackathon.eligibilityEnabled && !isEligible ? 'Not Eligible' : 'Register Now →'}
                      </button>
                    </div>
                  )}
                  </div>
                </div>
              )}

              {/* Stats — bento 2 — dark-safe: explicit dark:text ensures Registered/Selected counts stay visible on both themes */}
              <BentoCard span="col-span-12" className="p-5">
                <h3 className="font-display font-[800] tracking-[-0.01em] text-surface-900 dark:text-white">Live Stats</h3>
                <p className="text-xs font-medium text-surface-500 dark:text-night-400 mt-1">Real-time pulse</p>
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="p-4 rounded-xl bg-primary-50 dark:bg-primary-500/10 border border-primary-100 dark:border-primary-500/20 text-center hover:-translate-y-0.5 transition-transform">
                    <p className="font-display text-2xl font-[800] leading-none text-primary-700 dark:text-primary-300">{hackathon.registrations.length}</p>
                    <p className="text-[10px] font-black tracking-widest uppercase text-primary-600/70 dark:text-primary-300/70 mt-1">Registered</p>
                  </div>
                  <div className="p-4 rounded-xl bg-[#0a0a0a] dark:bg-white text-white dark:text-black text-center hover:-translate-y-0.5 transition-transform">
                    <p className="font-display text-2xl font-[800] leading-none text-white dark:text-black">{selectedCount}</p>
                    <p className="text-[10px] font-black tracking-widest uppercase text-white/70 dark:text-black/60 mt-1">Selected</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs font-semibold text-surface-500 dark:text-night-400 border-t border-surface-100 dark:border-white/10 pt-3">
                  <span className="inline-flex items-center gap-1.5"><Users size={12}/> {hackathon.registrations.length} teams</span>
                  <span className="inline-flex items-center gap-1.5"><CircleDot size={12}/> {hackathon.rounds.length} rounds</span>
                </div>
              </BentoCard>

              {/* Organizer — credibility bento */}
              {hackathon.organizer && (
                <BentoCard span="col-span-12" className="p-5">
                  <h3 className="font-display font-[800] tracking-[-0.01em] text-surface-900 dark:text-white text-sm">Organizer</h3>
                  <div className="mt-3 flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center text-sm font-black shadow">{hackathon.organizer.charAt(0).toUpperCase()}</div>
                    <div className="min-w-0">
                      <p className="font-[700] text-surface-900 dark:text-white text-sm truncate">{hackathon.organizer}</p>
                      <p className="text-xs font-medium text-surface-500 dark:text-night-400 flex items-center gap-1"><Shield size={11}/> Verified organizer · {hackathon.mode || 'TBD'}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-full bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-500/20 text-xs font-black">Trusted</span>
                    {hackathon.location && <span className="px-2.5 py-1 rounded-full bg-surface-50 dark:bg-white/[0.06] border border-surface-200 dark:border-white/10 text-xs font-bold text-surface-600 dark:text-night-300">{hackathon.location}</span>}
                  </div>
                </BentoCard>
              )}

              {/* Questions — resource bento */}
              <BentoCard span="col-span-12" className="p-5">
                <h3 className="font-display font-[800] tracking-[-0.01em] text-surface-900 dark:text-white text-sm">Questions?</h3>
                <p className="text-xs font-medium text-surface-500 dark:text-night-400 mt-1">Links & support</p>
                <div className="mt-3 space-y-2">
                  {hackathon.url && (
                    <a href={hackathon.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center justify-between p-3 rounded-xl bg-surface-50 dark:bg-white/[0.04] hover:bg-surface-100 dark:hover:bg-white/[0.06] border border-surface-100 dark:border-white/10 transition-colors group">
                      <span className="flex items-center gap-2 text-sm font-[600] text-surface-700 dark:text-night-200"><ExternalLink size={14} className="text-primary-500 dark:text-primary-500"/> Visit website</span>
                      <span className="w-7 h-7 rounded-full bg-white dark:bg-[#0a0a0a] border border-surface-200 dark:border-white/10 flex items-center justify-center group-hover:bg-primary-500 group-hover:text-white transition-colors dark:group-hover:bg-primary-500 dark:group-hover:text-white"><ExternalLink size={12}/></span>
                    </a>
                  )}
                  {!hackathon.url && <p className="text-xs font-medium text-surface-400 dark:text-night-400">No external links yet</p>}
                </div>
              </BentoCard>
            </div>
          </BentoGrid>
        )}

        {/* ============= TRACKS TAB — premium bento pills ============= */}
        {activeTab === 'tracks' && (
          <BentoGrid>
            <div className="col-span-12">
              <SectionCard title="Themes & Tracks" subtitle="Choose your battleground · Bento pills" icon={<Layers size={16}/>} gradient="from-primary-500 via-primary-500 to-emerald-500 dark:from-primary-500 dark:via-primary-500 dark:to-emerald-500">
                {parsedThemes.length > 0 ? (
                  <div className="flex flex-wrap gap-3">
                    {parsedThemes.map((theme: string, i: number) => {
                      const variants = [
                        'bg-[#0a0a0a] dark:bg-white text-white dark:text-black border border-black/10',
                        'bg-primary-500 text-black border border-primary-500 dark:bg-primary-500 dark:text-black dark:border-primary-500',
                        'bg-white dark:bg-white/[0.06] text-surface-700 dark:text-white border border-surface-200 dark:border-white/10',
                        'bg-emerald-500 text-white border border-emerald-500 dark:bg-emerald-500 dark:text-white dark:border-emerald-500',
                        'bg-amber-500 text-white border border-amber-500 dark:bg-amber-500 dark:text-white dark:border-amber-500',
                      ]
                      return (
                        <motion.span key={i} initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ delay: 0.05 + i*0.04 }} className={`px-5 py-2.5 rounded-full text-sm font-black tracking-[-0.01em] shadow-sm hover:-translate-y-0.5 transition-transform ${variants[i % variants.length]}`}>
                          {theme}
                        </motion.span>
                      )
                    })}
                  </div>
                ) : (
                  <div className="text-center py-12 rounded-xl bg-surface-50 dark:bg-white/[0.02] border border-dashed border-surface-200 dark:border-white/10">
                    <Layers size={28} className="text-surface-300 mx-auto mb-2 dark:text-surface-300" />
                    <p className="font-display font-[700] text-surface-600 dark:text-night-300">No tracks defined yet</p>
                    <p className="text-xs font-medium text-surface-400 dark:text-night-400 mt-1">Organizer will publish tracks soon</p>
                  </div>
                )}
              </SectionCard>
            </div>
            {hackathon.schedule && (
              <div className="col-span-12">
                <SectionCard title="Schedule" subtitle="Day-wise flow · Devfolio pattern" icon={<CalendarClock size={16}/>} gradient="from-primary-600 via-primary-500 to-emerald-500 dark:from-primary-600 dark:via-primary-500 dark:to-emerald-500">
                  <div className="p-4 rounded-xl bg-surface-50 dark:bg-white/[0.04] border border-surface-100 dark:border-white/10">
                    <p className="text-surface-700 dark:text-night-200 text-sm leading-relaxed whitespace-pre-line">{hackathon.schedule}</p>
                  </div>
                </SectionCard>
              </div>
            )}
          </BentoGrid>
        )}

        {/* ============= TIMELINE TAB — vertical stepper premium ============= */}
        {activeTab === 'timeline' && (
          <SectionCard title="Timeline" subtitle={`${hackathon.rounds.length} rounds · Vertical stepper · Countdown`} icon={<CalendarClock size={16}/>} gradient="from-primary-500 via-amber-500 to-primary-500 dark:from-primary-500 dark:via-amber-500 dark:to-primary-500" action={isTeacher && (
                <button
                  onClick={() => setShowAddRound(true)}
                  className="inline-flex items-center gap-1.5 px-4 h-10 rounded-full bg-[#0a0a0a] dark:bg-white text-white dark:text-black text-xs font-black hover:shadow-lg transition-all active:scale-[0.98] print:hidden">
                  <Plus size={14} /> Add Round
                </button>
              )}>
            {hackathon.rounds.length === 0 ? (
              <div className="text-center py-14 rounded-xl bg-surface-50 dark:bg-white/[0.02] border border-dashed border-surface-200 dark:border-white/10">
                <CircleDot size={36} className="text-surface-300 mx-auto mb-3 dark:text-surface-300" />
                <p className="font-display font-[700] text-surface-600 dark:text-night-300">No rounds defined yet</p>
                <p className="text-xs font-medium text-surface-400 dark:text-night-400 mt-1">Timeline will appear here once organizer adds rounds</p>
                {isTeacher && (
                  <button
                    onClick={() => setShowAddRound(true)}
                    className="mt-4 inline-flex items-center gap-1.5 px-5 h-10 rounded-full bg-primary-500 text-black text-sm font-black hover:shadow-lg transition-all print:hidden dark:bg-primary-500 dark:text-black">
                    <Plus size={14} /> Add First Round
                  </button>
                )}
              </div>
            ) : (
              <div className="relative">
                {hackathon.rounds.length > 1 && (
                    <div className="absolute left-5 top-4 bottom-4 w-0.5 bg-gradient-to-b from-primary-500/30 via-surface-200 dark:via-white/10 to-transparent hidden md:block dark:bg-gradient-to-b dark:from-primary-500/30 dark:to-transparent" />
                )}

                <div className="space-y-4">
                  {hackathon.rounds.map((round: any) => {
                    const isSelected = myRegistration && myRegistration.currentRound >= round.roundNumber
                    const isNext = myRegistration && myRegistration.currentRound === round.roundNumber - 1

                    if (editingRound === round.id) {
                      return (
                        <div key={round.id} className="p-5 rounded-[16px] border border-amber-200 dark:border-amber-800/20 bg-amber-50/50 dark:bg-amber-500/5 space-y-3 ml-0 md:ml-12">
                          <label htmlFor={`round-title-${round.id}`} className="sr-only">Round title</label>
                          <input id={`round-title-${round.id}`} type="text" value={roundEditData.title}
                            onChange={(e) => setRoundEditData({ ...roundEditData, title: e.target.value })}
                            aria-label="Round title"
                            className="w-full px-4 min-h-[44px] h-11 border border-surface-200 dark:border-white/10 rounded-xl text-sm bg-white dark:bg-[#0a0a0a] text-surface-900 dark:text-white placeholder:text-[#6b7280] dark:placeholder:text-night-400 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2" placeholder="Round title" />
                          <label htmlFor={`round-desc-${round.id}`} className="sr-only">Round description</label>
                          <textarea id={`round-desc-${round.id}`} value={roundEditData.description}
                            onChange={(e) => setRoundEditData({ ...roundEditData, description: e.target.value })}
                            aria-label="Round description"
                            className="w-full px-4 py-3 border border-surface-200 dark:border-white/10 rounded-xl text-sm min-h-[44px] bg-white dark:bg-[#0a0a0a] text-surface-900 dark:text-white placeholder:text-[#6b7280] dark:placeholder:text-night-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2" placeholder="Description" />
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label htmlFor={`round-date-${round.id}`} className="sr-only">Round date</label>
                              <input id={`round-date-${round.id}`} type="date" value={roundEditData.date} onChange={(e) => setRoundEditData({ ...roundEditData, date: e.target.value })} aria-label="Round date" className="w-full px-4 min-h-[44px] h-11 border border-surface-200 dark:border-white/10 rounded-xl text-sm bg-white dark:bg-[#0a0a0a] text-surface-900 dark:text-white [color-scheme:light] dark:[color-scheme:dark] focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2" />
                            </div>
                            <div>
                              <label htmlFor={`round-result-${round.id}`} className="sr-only">Result date</label>
                              <input id={`round-result-${round.id}`} type="date" value={roundEditData.resultDate} onChange={(e) => setRoundEditData({ ...roundEditData, resultDate: e.target.value })} aria-label="Result date" className="w-full px-4 min-h-[44px] h-11 border border-surface-200 dark:border-white/10 rounded-xl text-sm bg-white dark:bg-[#0a0a0a] text-surface-900 dark:text-white [color-scheme:light] dark:[color-scheme:dark] focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2" />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => handleSaveRound(round.id)} className="px-5 h-10 bg-primary-500 text-black rounded-full text-xs font-black hover:shadow dark:bg-primary-500 dark:text-black">Save</button>
                            <button onClick={() => setEditingRound(null)} className="px-5 h-10 bg-surface-100 dark:bg-white/10 text-surface-700 dark:text-white rounded-full text-xs font-black">Cancel</button>
                          </div>
                        </div>
                      )
                    }

                    return (
                      <div key={round.id} className="relative flex gap-4 group">
                        <div className="relative z-10 shrink-0">
                          <div className={clsx(
                            'w-10 h-10 rounded-full flex items-center justify-center text-sm font-black shadow-[0_4px_16px_rgba(0,0,0,0.08)] border-2 transition-all group-hover:-translate-y-0.5',
                            isSelected ? 'bg-primary-500 text-black border-primary-500 shadow-[0_8px_24px_rgba(30,215,96,0.30)] dark:bg-primary-500 dark:text-black dark:border-primary-500' :
                            'bg-white dark:bg-[#121212] text-surface-700 dark:text-white border border-surface-200 dark:border-white/10'
                          )}>
                            {round.roundNumber}
                          </div>
                        </div>

                        <div className={clsx(
                          'flex-1 p-5 rounded-[16px] border transition-all hover:shadow-[0_12px_32px_rgba(0,0,0,0.08)] hover:-translate-y-0.5',
                          isSelected ? 'bg-primary-50 dark:bg-primary-500/10 border border-primary-200 dark:border-primary-500/20' : 'bg-white dark:bg-[#121212] border border-surface-200 dark:border-white/10'
                        )}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-display font-[800] tracking-[-0.01em] text-surface-900 dark:text-white">{round.title}</p>
                                {isSelected && (
                                  <span className="px-2.5 py-1 bg-primary-500 text-black rounded-full text-[10px] font-black tracking-widest dark:bg-primary-500 dark:text-black">
                                    SELECTED
                                  </span>
                                )}
                                {isNext && (
                                  <span className="px-2.5 py-1 bg-amber-500 text-white rounded-full text-[10px] font-black tracking-widest animate-pulse dark:bg-amber-500 dark:text-white">
                                    NEXT
                                  </span>
                                )}
                              </div>
                              {round.description && (
                                <p className="text-sm font-medium text-surface-600 dark:text-night-300 mt-2 leading-relaxed">{round.description}</p>
                              )}
                              <div className="flex flex-wrap gap-2 mt-3">
                                {round.date && (
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0a0a0a] dark:bg-white text-white dark:text-black rounded-full text-xs font-bold">
                                    <Calendar size={12} /> {new Date(round.date).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric'})}
                                  </span>
                                )}
                                {round.resultDate && (
                                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/20 rounded-full text-xs font-bold">
                                    <Trophy size={12} /> Results: {new Date(round.resultDate).toLocaleDateString()}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {isSelected && <CheckCircle size={18} className="text-primary-500 mr-1 dark:text-primary-500" />}
                              {isTeacher && (
                                <div className="print:hidden flex items-center gap-1">
                                  <button onClick={() => handleEditRound(round)} className="w-8 h-8 rounded-full bg-surface-50 dark:bg-white/5 hover:bg-surface-100 dark:hover:bg-white/10 flex items-center justify-center text-surface-500 dark:text-night-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors" title="Edit Round">
                                    <Edit size={14} />
                                  </button>
                                  <button onClick={() => handleDeleteRound(round.id)} className="w-8 h-8 rounded-full bg-surface-50 dark:bg-white/5 hover:bg-danger-50 dark:hover:bg-danger-500/15 flex items-center justify-center text-surface-500 dark:text-night-400 hover:text-danger-500 dark:hover:text-danger-400 transition-colors" title="Delete Round">
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </SectionCard>
        )}

        {/* ============= RULES TAB — bento premium ============= */}
        {activeTab === 'rules' && (
          <BentoGrid>
            <div className="col-span-12 lg:col-span-7">
              <SectionCard title="Eligibility" subtitle="Who can compete · Departments & years" icon={<Shield size={16}/>} gradient="from-primary-500 via-primary-500 to-emerald-500 dark:from-primary-500 dark:via-primary-500 dark:to-emerald-500">
                {hackathon.eligibility ? (
                  <div className="flex items-start gap-3 p-4 rounded-xl bg-primary-50 dark:bg-primary-500/10 border border-primary-100 dark:border-primary-500/20">
                    <div className="w-9 h-9 rounded-xl bg-primary-500 text-white flex items-center justify-center shrink-0 dark:bg-primary-500 dark:text-white"><CheckCircle size={16}/></div>
                    <p className="text-surface-700 dark:text-night-200 text-sm leading-relaxed font-medium flex-1">{hackathon.eligibility}</p>
                  </div>
                ) : (
                  <p className="text-surface-500 dark:text-night-400 text-sm font-medium flex items-center gap-2"><CheckCircle size={16} className="text-primary-500 dark:text-primary-500"/> Open to all students</p>
                )}

                {hackathon.eligibilityEnabled && (targetDeptNames.length > 0 || targetYears.length > 0) && (
                  <div className="mt-5 space-y-3">
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
                )}

                {hackathon.eligibilityEnabled && (
                  <div className="mt-5">
                    <span className={clsx('inline-flex items-center gap-1.5 px-4 h-10 rounded-full text-xs font-black border',
                      isEligible ? 'bg-primary-500 text-black border-primary-500 shadow dark:bg-primary-500 dark:text-black dark:border-primary-500' : 'bg-danger-50 dark:bg-danger-500/15 text-danger-700 dark:text-danger-300 border-danger-200 dark:border-danger-500/20'
                    )}>
                      {isEligible ? <CheckCircle size={14} /> : <XCircle size={14} />}
                      {isEligible ? 'You are eligible' : 'You are not eligible'}
                    </span>
                  </div>
                )}
              </SectionCard>
            </div>

            <div className="col-span-12 lg:col-span-5">
              <SectionCard title="Team Rules" subtitle="Squad specs · Devpost pattern" icon={<Users size={16}/>} gradient="from-emerald-500 via-primary-500 to-primary-600 dark:from-emerald-500 dark:via-primary-500 dark:to-primary-600">
                <BentoGrid>
                  <BentoCard span="col-span-6" className="p-4 text-center">
                      <div className="w-10 h-10 rounded-xl bg-primary-500 text-white flex items-center justify-center mx-auto dark:bg-primary-500 dark:text-white"><Users size={16}/></div>
                      <p className="text-xs font-black tracking-widest uppercase text-surface-400 dark:text-night-400 mt-2">Team Size</p>
                      <p className="font-display font-[800] text-surface-900 dark:text-white mt-1">{hackathon.teamSize ? `Up to ${hackathon.teamSize}` : 'Flexible'}</p>
                  </BentoCard>
                  <BentoCard span="col-span-6" className="p-4 text-center">
                      <div className="w-10 h-10 rounded-xl bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center mx-auto"><Timer size={16}/></div>
                      <p className="text-xs font-black tracking-widest uppercase text-surface-400 dark:text-night-400 mt-2">Duration</p>
                      <p className="font-display font-[800] text-surface-900 dark:text-white mt-1">{hackathon.duration || 'TBD'}</p>
                  </BentoCard>
                  <BentoCard span="col-span-12" className="p-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 dark:bg-amber-500 dark:text-white"><MapPin size={16}/></div>
                    <div>
                      <p className="text-xs font-black tracking-widest uppercase text-surface-400 dark:text-night-400">Location & Mode</p>
                      <p className="text-sm font-[700] text-surface-900 dark:text-white mt-0.5">{hackathon.location || 'Online'} · {hackathon.mode || 'TBD'}</p>
                    </div>
                  </BentoCard>
                </BentoGrid>
              </SectionCard>
            </div>
          </BentoGrid>
        )}

        {/* ============= RESOURCES TAB — bento premium ============= */}
        {activeTab === 'resources' && (
          <SectionCard title="Links & Resources" subtitle="Official links · Registration · Trust" icon={<Link2 size={16}/>} gradient="from-primary-500 via-primary-600 to-emerald-500 dark:from-primary-500 dark:via-primary-600 dark:to-emerald-500">
            <BentoGrid>
              {hackathon.url && (
                <BentoCard span="col-span-12 md:col-span-6" hover={true} className="p-0 overflow-hidden group cursor-pointer">
                  <a href={hackathon.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 p-5">
                     <div className="w-12 h-12 rounded-xl bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center shrink-0 group-hover:bg-primary-500 group-hover:text-black transition-colors dark:group-hover:bg-primary-500">
                       <ExternalLink size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-display font-[800] tracking-[-0.01em] text-surface-900 dark:text-white">Hackathon Website</p>
                      <p className="text-xs font-medium text-surface-500 dark:text-night-400 truncate mt-1">{hackathon.url}</p>
                    </div>
                    <span className="w-8 h-8 rounded-full bg-surface-50 dark:bg-white/5 border border-surface-200 dark:border-white/10 flex items-center justify-center group-hover:bg-primary-500 group-hover:text-black group-hover:border-primary-500 transition-colors dark:group-hover:bg-primary-500 dark:group-hover:text-black dark:group-hover:border-primary-500"><ExternalLink size={14}/></span>
                  </a>
                </BentoCard>
              )}
              {hackathon.registrationUrl && (
                <BentoCard span="col-span-12 md:col-span-6" hover={true} className="p-0 overflow-hidden group cursor-pointer">
                  <a href={hackathon.registrationUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 p-5">
                    <div className="w-12 h-12 rounded-xl bg-primary-500 text-black flex items-center justify-center shrink-0 shadow dark:bg-primary-500 dark:text-black">
                      <Rocket size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-display font-[800] tracking-[-0.01em] text-surface-900 dark:text-white">Registration Link</p>
                      <p className="text-xs font-medium text-surface-500 dark:text-night-400 truncate mt-1">{hackathon.registrationUrl}</p>
                    </div>
                    <span className="w-8 h-8 rounded-full bg-primary-50 dark:bg-primary-500/15 border border-primary-200 dark:border-primary-500/20 flex items-center justify-center group-hover:bg-primary-500 transition-colors"><ExternalLink size={14} className="group-hover:text-black dark:group-hover:text-black"/></span>
                  </a>
                </BentoCard>
              )}
              {!hackathon.url && !hackathon.registrationUrl && (
                <div className="col-span-12 text-center py-14 rounded-xl bg-surface-50 dark:bg-white/[0.02] border border-dashed border-surface-200 dark:border-white/10">
                  <Link2 size={28} className="text-surface-300 mx-auto mb-2 dark:text-surface-300" />
                  <p className="font-display font-[700] text-surface-600 dark:text-night-300">No external resources linked</p>
                  <p className="text-xs font-medium text-surface-400 dark:text-night-400 mt-1">Organizer will add links soon</p>
                </div>
              )}
            </BentoGrid>
          </SectionCard>
        )}

        {/* ============= REGISTRATIONS TAB — analytics + filters + export (kept) ============= */}
        {activeTab === 'registrations' && (
          <div className="space-y-6">
            {isTeacher ? (
              <>
                {/* Analytics — keep Stats Registered/Selected/Success/Prize like hero; bento premium */}
                <BentoGrid>
                  <BentoCard span="col-span-12 md:col-span-3" className="p-5">
                    <div className="flex items-center gap-2.5 mb-2">
                      <span className="w-9 h-9 rounded-xl bg-primary-500 text-black flex items-center justify-center shrink-0 dark:bg-primary-500 dark:text-black"><Users size={16}/></span>
                      <p className="text-[10px] font-black tracking-[0.12em] uppercase text-surface-400 dark:text-night-400">Registered</p>
                    </div>
                    <p className="font-display text-[28px] font-[800] leading-none text-surface-900 dark:text-white">{totalRegs}</p>
                    <p className="mt-1 text-[11px] font-bold text-surface-500 dark:text-night-400">Total teams joined</p>
                    <div className="mt-3 h-1.5 rounded-full bg-surface-100 dark:bg-white/10 overflow-hidden flex">
                      <div className="bg-primary-500 dark:bg-primary-500" style={{ width: `${totalRegs?100:0}%` }} />
                    </div>
                  </BentoCard>
                  <BentoCard span="col-span-12 md:col-span-3" className="p-5">
                    <div className="flex items-center gap-2.5 mb-2">
                      <span className="w-9 h-9 rounded-xl bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center shrink-0"><CheckCircle size={16}/></span>
                      <p className="text-[10px] font-black tracking-[0.12em] uppercase text-surface-400 dark:text-night-400">Selected</p>
                      <span className="ml-auto px-2 py-0.5 rounded-full bg-primary-500 text-black text-[11px] font-black dark:bg-primary-500 dark:text-black">{successRate}%</span>
                    </div>
                    <p className="font-display text-[28px] font-[800] leading-none text-surface-900 dark:text-white">{selectedCount}</p>
                    <p className="mt-1 text-[11px] font-bold text-surface-500 dark:text-night-400">{selectedCount} advanced · {successRate}% success</p>
                    <div className="mt-3 w-full h-1.5 bg-surface-100 dark:bg-white/10 rounded-full overflow-hidden"><div className="h-full bg-primary-500 dark:bg-primary-500" style={{ width: `${successRate}%` }}/></div>
                  </BentoCard>
                  <BentoCard span="col-span-12 md:col-span-3" className="p-5">
                    <div className="flex items-center gap-2.5 mb-2">
                      <span className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 dark:bg-amber-500 dark:text-white"><Trophy size={16}/></span>
                      <p className="text-[10px] font-black tracking-[0.12em] uppercase text-surface-400 dark:text-night-400">Completed</p>
                    </div>
                    <p className="font-display text-[28px] font-[800] leading-none text-surface-900 dark:text-white">{completedCount}</p>
                    <p className="mt-1 text-[11px] font-bold text-surface-500 dark:text-night-400">{completedCount} finished final round</p>
                    {hackathon.prizePool && <p className="mt-2 text-xs font-black text-amber-700 dark:text-amber-300 truncate">{hackathon.prizePool}</p>}
                  </BentoCard>
                  <BentoCard span="col-span-12 md:col-span-3" className="p-5">
                    <div className="flex items-center gap-2.5 mb-2">
                      <span className="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0 dark:bg-emerald-500 dark:text-white"><BarChart3 size={16}/></span>
                      <p className="text-[10px] font-black tracking-[0.12em] uppercase text-surface-400 dark:text-night-400">Prize Pool</p>
                    </div>
                    {hackathon.prizePool ? (
                      <>
                        <p className="font-display text-[16px] font-[800] leading-tight text-surface-900 dark:text-white line-clamp-2">{hackathon.prizePool}</p>
                        {maxPrize && <p className="mt-1 text-xs font-mono font-black text-primary-600 dark:text-primary-400">₹{maxPrize.toLocaleString('en-IN')} top prize</p>}
                        {totalPrize && totalPrize!==maxPrize && <p className="text-[11px] font-bold text-surface-500 dark:text-night-400">₹{totalPrize.toLocaleString('en-IN')} combined</p>}
                      </>
                    ) : (
                      <><p className="font-display text-[16px] font-[800] text-surface-500 dark:text-night-400">—</p><p className="text-[11px] font-medium text-surface-400 dark:text-night-400 mt-1">No prize listed</p></>
                    )}
                    <p className="mt-2 text-[10px] font-bold tracking-wide uppercase text-surface-400 dark:text-night-400 flex items-center gap-1"><TrendingUp size={10}/> Live analytics</p>
                  </BentoCard>
                </BentoGrid>

                {/* Dept breakdown mini bento */}
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
                            <span className="font-black px-1.5 py-0.5 rounded-full bg-primary-500 text-black text-[11px] dark:bg-primary-500 dark:text-black">{cnt}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </BentoCard>
                  <BentoCard span="col-span-12 md:col-span-6" className="p-5">
                    <div className="flex items-center gap-2.5 mb-3">
                      <span className="w-9 h-9 rounded-xl bg-primary-500 text-black flex items-center justify-center dark:bg-primary-500 dark:text-black"><BookOpen size={16}/></span>
                      <h4 className="font-display text-[15px] font-[800] tracking-[-0.02em] text-[#0a0a0a] dark:text-white">By Year</h4>
                      <span className="ml-auto text-xs font-black px-2.5 py-1 rounded-full bg-primary-500 text-black dark:bg-primary-500 dark:text-black">{regYearBreakdown.length} cohorts</span>
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

                {/* Filters & Export — keep dept+year + search + export (like AssignmentDetail) */}
                <SectionCard title="Filters & Export" subtitle={`Showing ${filteredRegs.length}/${totalRegs} · Dept & Year filters + search`} icon={<Filter size={16}/>} gradient="from-primary-500 via-primary-500 to-emerald-500 dark:from-primary-500 dark:via-primary-500 dark:to-emerald-500" action={
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => setShowRemind(true)} disabled={totalRegs === 0} className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full bg-[#0a0a0a] dark:bg-white text-white dark:text-black text-xs font-black hover:shadow-lg transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed">
                      <Bell size={14}/> Remind registered
                    </button>
                    <button onClick={handleExportFiltered} className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full bg-white dark:bg-[#1a1a1a] border border-surface-200 dark:border-white/10 text-surface-700 dark:text-white text-xs font-black hover:border-primary-500/30 transition-colors dark:hover:border-primary-500/30">
                      <Download size={14}/> Export CSV
                    </button>
                    <button onClick={handleExportXlsx} className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full bg-primary-500 text-black text-xs font-black hover:bg-[#1ed760] shadow dark:text-black dark:hover:bg-[#1ed760]">
                      <Download size={14}/> Export XLSX
                    </button>
                  </div>
                }>
                  <div className="flex flex-wrap gap-3 items-center">
                    <div className="relative flex-1 min-w-[220px]">
                      <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 dark:text-zinc-500" />
                      <label htmlFor="hack-reg-search" className="sr-only">Search registrations by name, email, roll or team</label>
                      <input id="hack-reg-search" value={regSearch} onChange={e=> setRegSearch(e.target.value)} placeholder="Search name, email, roll, team..." aria-label="Search registrations by name, email, roll or team" className="w-full pl-9 pr-3 min-h-[44px] py-2.5 rounded-xl border border-surface-200 dark:border-white/10 bg-surface-50 dark:bg-[#0a0a0a] text-sm text-surface-900 dark:text-white placeholder:text-[#6b7280] dark:placeholder:text-night-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2" />
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
                  {(regDept!=='ALL' || regYear!=='ALL' || regSearch) && <button onClick={()=>{setRegSearch(''); setRegDept('ALL'); setRegYear('ALL')}} className="mt-3 text-xs font-bold text-primary-600 hover:text-primary-700 dark:text-primary-400 underline dark:hover:text-primary-300">Clear filters →</button>}
                </SectionCard>

                <SectionCard title="All Registrations" subtitle={`${filteredRegs.length}/${totalRegs} shown · ${selectedCount} selected · Live`} icon={<Users size={16}/>} gradient="from-primary-500 via-primary-600 to-emerald-500 dark:from-primary-500 dark:via-primary-600 dark:to-emerald-500">
                  {hackathon.registrations.length === 0 ? (
                    <div className="text-center py-14 rounded-xl bg-surface-50 dark:bg-white/[0.02] border border-dashed border-surface-200 dark:border-white/10">
                      <Users size={36} className="text-surface-300 dark:text-zinc-600 mx-auto mb-3" />
                      <p className="font-display font-[700] text-surface-600 dark:text-night-300">No registrations yet</p>
                      <p className="text-xs font-medium text-surface-400 dark:text-night-400 mt-1">Teams will appear here once they register</p>
                    </div>
                  ) : filteredRegs.length === 0 ? (
                    <div className="text-center py-14 rounded-xl bg-surface-50 dark:bg-white/[0.02] border border-dashed border-surface-200 dark:border-white/10">
                      <Filter size={28} className="text-surface-300 dark:text-zinc-600 mx-auto mb-2" />
                      <p className="font-display font-[700] text-surface-600 dark:text-night-300">No matches</p>
                      <p className="text-xs font-medium text-surface-400 dark:text-night-400 mt-1">Try clearing department / year / search filters</p>
                      <button onClick={()=>{setRegSearch(''); setRegDept('ALL'); setRegYear('ALL')}} className="mt-3 px-4 h-9 rounded-full bg-primary-500 text-black text-xs font-black dark:bg-primary-500 dark:text-black">Clear filters</button>
                    </div>
                  ) : (
                    <div className="overflow-x-auto -mx-1">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-surface-100 dark:border-white/10">
                            <th className="text-left py-3 px-2 text-surface-500 dark:text-night-400 font-black text-[11px] uppercase tracking-widest">Roll No</th>
                            <th className="text-left py-3 px-2 text-surface-500 dark:text-night-400 font-black text-[11px] uppercase tracking-widest">Name</th>
                            <th className="text-left py-3 px-2 text-surface-500 dark:text-night-400 font-black text-[11px] uppercase tracking-widest">Team</th>
                            <th className="text-left py-3 px-2 text-surface-500 dark:text-night-400 font-black text-[11px] uppercase tracking-widest">Status</th>
                            <th className="text-left py-3 px-2 text-surface-500 dark:text-night-400 font-black text-[11px] uppercase tracking-widest">Round</th>
                            <th className="text-left py-3 px-2 text-surface-500 dark:text-night-400 font-black text-[11px] uppercase tracking-widest">Position</th>
                            <th className="text-left py-3 px-2 text-surface-500 dark:text-night-400 font-black text-[11px] uppercase tracking-widest">Review</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredRegs.map((reg: any) => (
                            <tr key={reg.id} className="border-b border-surface-50 dark:border-white/5 hover:bg-surface-50 dark:hover:bg-white/[0.03] transition-colors dark:hover:bg-surface-50">
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
                              <td className="py-3 px-2 text-surface-700 dark:text-night-200 font-medium">{reg.teamName || '-'}</td>
                              <td className="py-3 px-2">
                                <span className={clsx('px-3 py-1 rounded-full text-xs font-black border',
                                 reg.status === 'COMPLETED' ? 'bg-primary-500 text-black border-primary-500 dark:bg-primary-500 dark:text-black dark:border-primary-500' :
                                  reg.status === 'SELECTED' ? 'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 border-primary-200 dark:border-primary-500/20' :
                                 'bg-zinc-50 dark:bg-white/5 text-zinc-700 dark:text-night-300 border-zinc-200 dark:border-white/10'
                                )}>
                                  {reg.status === 'COMPLETED' ? 'Completed' :
                                   reg.status === 'SELECTED' ? `Round ${reg.currentRound}` :
                                   'Registered'}
                                </span>
                              </td>
                              <td className="py-3 px-2">
                                <span className="w-7 h-7 rounded-full bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center text-xs font-black">
                                  {reg.currentRound}
                                </span>
                              </td>
                              <td className="py-3 px-2">
                                {reg.winPosition ? (
                                  <span className="px-2.5 py-1 rounded-full text-xs font-black bg-amber-500 text-white border border-amber-500 shadow dark:bg-amber-500 dark:text-white dark:border-amber-500">
                                    {reg.winPosition}
                                  </span>
                                ) : (
                                  <span className="text-surface-300 dark:text-night-600">—</span>
                                )}
                              </td>
                              <td className="py-3 px-2">
                                {reg.review ? (
                                  <p className="text-xs font-medium text-surface-600 dark:text-night-300 max-w-[200px] truncate" title={reg.review}>{reg.review}</p>
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
              </>
            ) : (
              /* Student view for Registrations tab — bento */
              <SectionCard title="My Registration" subtitle="Your team · Status · Journey" icon={<Users size={16}/>} gradient="from-primary-500 via-primary-500 to-emerald-500 dark:from-primary-500 dark:via-primary-500 dark:to-emerald-500">
                {myRegistration ? (
                  <>
                  <BentoGrid>
                    <BentoCard span="col-span-6 lg:col-span-3" className="text-center p-5">
                        <p className="text-[11px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400">Team</p>
                        <p className="font-display font-[800] text-surface-900 dark:text-white mt-1 truncate">{myRegistration.teamName || '-'}</p>
                    </BentoCard>
                    <BentoCard span="col-span-6 lg:col-span-3" className="text-center p-5">
                        <p className="text-[11px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400">Status</p>
                        <p className="mt-1 inline-flex px-3 py-1 rounded-full bg-primary-500 text-black text-xs font-black dark:bg-primary-500 dark:text-black">
                          {myRegistration.status === 'COMPLETED' ? 'Completed' : myRegistration.status === 'SELECTED' ? `Round ${myRegistration.currentRound}` : 'Registered'}
                        </p>
                    </BentoCard>
                    <BentoCard span="col-span-6 lg:col-span-3" className="text-center p-5">
                        <p className="text-[11px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400">Current Round</p>
                        <p className="mt-1 w-9 h-9 rounded-full bg-[#0a0a0a] dark:bg-white text-white dark:text-black font-black flex items-center justify-center mx-auto">{myRegistration.currentRound}</p>
                    </BentoCard>
                    {myRegistration.winPosition ? (
                      <BentoCard span="col-span-6 lg:col-span-3" className="text-center p-5 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20">
                          <p className="text-[11px] font-black tracking-widest uppercase text-amber-700 dark:text-amber-300">Position</p>
                          <p className="font-display font-[800] text-amber-700 dark:text-amber-300 mt-1">{myRegistration.winPosition}</p>
                      </BentoCard>
                    ) : (
                      <BentoCard span="col-span-6 lg:col-span-3" className="text-center p-5">
                          <p className="text-[11px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400">Position</p>
                          <p className="font-[700] text-surface-500 dark:text-night-400 mt-1">—</p>
                      </BentoCard>
                    )}
                    {myRegistration.review && (
                      <div className="col-span-12 p-4 rounded-xl bg-surface-50 dark:bg-white/[0.04] border border-surface-100 dark:border-white/10">
                        <p className="text-[11px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400">Review</p>
                        <p className="text-sm font-medium text-surface-700 dark:text-night-200 mt-1 leading-relaxed">{myRegistration.review}</p>
                      </div>
                    )}
                  </BentoGrid>
                  <button onClick={handleUnregister} className="mt-4 w-full h-11 rounded-full border border-surface-200 dark:border-white/10 bg-white dark:bg-transparent text-surface-600 dark:text-night-300 text-sm font-black hover:border-danger-500/40 hover:text-danger-600 dark:hover:text-danger-400 transition-colors active:scale-[0.98]">
                    Unregister
                  </button>
                  </>
                ) : (
                  <div className="text-center py-10 rounded-xl bg-surface-50 dark:bg-white/[0.02] border border-dashed border-surface-200 dark:border-white/10">
                    <p className="font-display font-[700] text-surface-600 dark:text-night-300">You haven't registered yet</p>
                    <p className="text-xs font-medium text-surface-400 dark:text-night-400 mt-1">Join now to track your journey</p>
                    {hackathon.eligibilityEnabled && (
                      <div className={clsx('mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-black border',
                    isEligible ? 'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 border-primary-200 dark:border-primary-500/20' : 'bg-danger-50 dark:bg-danger-500/15 text-danger-700 dark:text-danger-300 border-danger-200 dark:border-danger-500/20'
                      )}>
                        {isEligible ? <CheckCircle size={12} /> : <XCircle size={12} />}
                        {isEligible ? 'You are eligible to register' : 'Not eligible — check target departments & years'}
                      </div>
                    )}
                    <button
                      onClick={() => setShowRegister(true)}
                      disabled={hackathon.eligibilityEnabled && !isEligible}
                      className={clsx('mt-4 px-6 h-11 rounded-full font-black text-sm transition-all active:scale-[0.98]',
                        hackathon.eligibilityEnabled && !isEligible
                          ? 'bg-surface-200 text-surface-400 cursor-not-allowed dark:bg-surface-200 dark:text-surface-400'
                           : 'bg-primary-500 text-black hover:shadow-[0_8px_24px_rgba(30,215,96,0.30)] dark:bg-primary-500 dark:text-black'
                      )}>
                      {hackathon.eligibilityEnabled && !isEligible ? 'Not Eligible' : 'Register Now'}
                    </button>
                  </div>
                )}
              </SectionCard>
            )}
          </div>
        )}
      </div>
      </motion.div>

      {/* Register Modal — premium glass */}
      {showRegister && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:hidden dark:bg-black/50"
          onClick={() => setShowRegister(false)}>
          <div className="bg-white dark:bg-[#121212] rounded-[24px] border border-surface-200 dark:border-[#282828] w-full max-w-md p-6 shadow-[0_24px_64px_rgba(0,0,0,0.25)]" onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-xl bg-primary-500 flex items-center justify-center mb-4 shadow dark:bg-primary-500"><Rocket size={20} className="text-black dark:text-black"/></div>
            <h2 className="font-display text-xl font-[800] tracking-[-0.02em] text-surface-900 dark:text-white">Register for {hackathon.title}</h2>
            <p className="text-sm font-medium text-surface-500 dark:text-night-400 mt-1">Team details — you can update round progress later</p>
            <div className="space-y-3 mt-5">
              <div>
                <label htmlFor="hack-team-name" className="text-xs font-black tracking-widest uppercase text-surface-500 dark:text-night-400 mb-1 block">Team Name</label>
                <input id="hack-team-name" type="text" value={form.teamName}
                  onChange={(e) => setForm({ ...form, teamName: e.target.value })}
                  aria-label="Team name"
                  className="w-full px-4 min-h-[44px] h-11 border border-surface-200 dark:border-white/10 rounded-xl text-sm bg-white dark:bg-[#0a0a0a] text-surface-900 dark:text-white placeholder:text-[#6b7280] dark:placeholder:text-night-400 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2" placeholder="Your team name" />
              </div>
              <div>
                <label className="text-xs font-black tracking-widest uppercase text-surface-500 dark:text-night-400 mb-1 block">Team Members</label>
                <textarea value={form.teamMembers}
                  onChange={(e) => setForm({ ...form, teamMembers: e.target.value })}
                  className="w-full px-4 py-3 border border-surface-200 dark:border-white/10 rounded-xl text-sm h-20 bg-white dark:bg-[#0a0a0a] text-surface-900 dark:text-white placeholder:text-[#6b7280] dark:placeholder:text-night-400 focus:outline-none focus:border-primary-500/30 dark:focus:border-primary-500/30" placeholder="Name1, Name2, Name3..." />
              </div>
              <div>
                <label className="text-xs font-black tracking-widest uppercase text-surface-500 dark:text-night-400 mb-1 block">Project Idea <span className="font-medium normal-case tracking-normal text-surface-400 dark:text-night-400">(optional)</span></label>
                <textarea value={form.projectIdea}
                  onChange={(e) => setForm({ ...form, projectIdea: e.target.value })}
                  className="w-full px-4 py-3 border border-surface-200 dark:border-white/10 rounded-xl text-sm h-20 bg-white dark:bg-[#0a0a0a] text-surface-900 dark:text-white placeholder:text-[#6b7280] dark:placeholder:text-night-400 focus:outline-none focus:border-primary-500/30 dark:focus:border-primary-500/30" placeholder="Brief project idea..." />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowRegister(false)} className="flex-1 h-11 bg-surface-100 dark:bg-white/10 text-surface-700 dark:text-white rounded-full font-black text-sm">Cancel</button>
               <button onClick={handleRegister} className="flex-1 h-11 bg-primary-500 text-black rounded-full font-black text-sm hover:shadow-[0_8px_24px_rgba(30,215,96,0.30)] transition-shadow dark:bg-primary-500 dark:text-black">Register</button>
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
            <label htmlFor="hack-remind-msg" className="text-xs font-black tracking-widest uppercase text-surface-500 dark:text-night-400 mb-1 mt-5 block">Message</label>
            <textarea id="hack-remind-msg" value={remindMessage}
              onChange={(e) => setRemindMessage(e.target.value)}
              maxLength={1000}
              rows={4}
              placeholder="e.g. Round 2 starts tomorrow at 10am — check the timeline tab."
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

      {/* Registrations Modal (legacy - kept for backwards compatibility) */}
      {showRegistrations && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:hidden dark:bg-black/50"
          onClick={() => setShowRegistrations(false)}>
          <div className="bg-white dark:bg-[#121212] rounded-[24px] border border-surface-200 dark:border-[#282828] w-full max-w-4xl max-h-[85vh] flex flex-col shadow-[0_24px_64px_rgba(0,0,0,0.25)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-surface-100 dark:border-white/10">
              <div className="flex items-center gap-3">
                 <div className="w-10 h-10 rounded-xl bg-primary-500 flex items-center justify-center shadow dark:bg-primary-500">
                   <Users size={18} className="text-black dark:text-black" />
                </div>
                <div>
                  <h2 className="font-display text-lg font-[800] tracking-[-0.01em] text-surface-900 dark:text-white">Registrations</h2>
                  <p className="text-xs font-medium text-surface-500 dark:text-night-400">{hackathon.registrations.length} registered · {selectedCount} selected</p>
                </div>
              </div>
              <button onClick={() => setShowRegistrations(false)} className="w-9 h-9 rounded-full bg-surface-50 dark:bg-white/5 hover:bg-surface-100 dark:hover:bg-white/10 flex items-center justify-center transition-colors dark:hover:bg-surface-100">
                <XCircle size={18} className="text-surface-400 dark:text-surface-400" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              {hackathon.registrations.length === 0 ? (
                <div className="text-center py-12">
                  <Users size={36} className="text-surface-300 mx-auto mb-3 dark:text-surface-300" />
                  <p className="font-display font-[700] text-surface-600 dark:text-night-300">No registrations yet</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-surface-100 dark:border-white/10">
                        <th className="text-left py-3 px-2 text-surface-500 dark:text-night-400 font-black text-[11px] uppercase tracking-widest">Roll No</th>
                        <th className="text-left py-3 px-2 text-surface-500 dark:text-night-400 font-black text-[11px] uppercase tracking-widest">Name</th>
                        <th className="text-left py-3 px-2 text-surface-500 dark:text-night-400 font-black text-[11px] uppercase tracking-widest">Team</th>
                        <th className="text-left py-3 px-2 text-surface-500 dark:text-night-400 font-black text-[11px] uppercase tracking-widest">Status</th>
                        <th className="text-left py-3 px-2 text-surface-500 dark:text-night-400 font-black text-[11px] uppercase tracking-widest">Round</th>
                        <th className="text-left py-3 px-2 text-surface-500 dark:text-night-400 font-black text-[11px] uppercase tracking-widest">Position</th>
                        <th className="text-left py-3 px-2 text-surface-500 dark:text-night-400 font-black text-[11px] uppercase tracking-widest">Review</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hackathon.registrations.map((reg: any) => (
                        <tr key={reg.id} className="border-b border-surface-50 dark:border-white/5 hover:bg-surface-50 dark:hover:bg-white/[0.03] transition-colors dark:hover:bg-surface-50">
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
                          <td className="py-3 px-2 text-surface-700 dark:text-night-200 font-medium">{reg.teamName || '-'}</td>
                          <td className="py-3 px-2">
                            <span className={clsx('px-3 py-1 rounded-full text-xs font-black border',
                               reg.status === 'COMPLETED' ? 'bg-primary-500 text-black border-primary-500 dark:bg-primary-500 dark:text-black dark:border-primary-500' :
                               reg.status === 'SELECTED' ? 'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 border-primary-200 dark:border-primary-500/20' :
                               'bg-zinc-50 dark:bg-white/5 text-zinc-700 dark:text-night-300 border-zinc-200 dark:border-white/10'
                            )}>
                              {reg.status === 'COMPLETED' ? 'Completed' :
                               reg.status === 'SELECTED' ? `Round ${reg.currentRound}` :
                               'Registered'}
                            </span>
                          </td>
                          <td className="py-3 px-2">
                            <span className="w-7 h-7 rounded-full bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center text-xs font-black">
                              {reg.currentRound}
                            </span>
                          </td>
                          <td className="py-3 px-2">
                            {reg.winPosition ? (
                              <span className="px-2.5 py-1 rounded-full text-xs font-black bg-amber-500 text-white border border-amber-500 shadow dark:bg-amber-500 dark:text-white dark:border-amber-500">
                                {reg.winPosition}
                              </span>
                            ) : (
                              <span className="text-surface-300 dark:text-night-600">—</span>
                            )}
                          </td>
                          <td className="py-3 px-2">
                            {reg.review ? (
                              <p className="text-xs font-medium text-surface-600 dark:text-night-300 max-w-[200px] truncate" title={reg.review}>{reg.review}</p>
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

      {/* Add Round Modal — premium */}
      {showAddRound && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:hidden dark:bg-black/50"
          onClick={() => setShowAddRound(false)}>
          <div className="bg-white dark:bg-[#121212] rounded-[24px] border border-surface-200 dark:border-[#282828] w-full max-w-md p-6 shadow-[0_24px_64px_rgba(0,0,0,0.25)]" onClick={(e) => e.stopPropagation()}>
            <div className="w-11 h-11 rounded-xl bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center mb-4"><Plus size={18}/></div>
            <h2 className="font-display text-xl font-[800] tracking-[-0.02em] text-surface-900 dark:text-white">Add Round</h2>
            <p className="text-xs font-medium text-surface-500 dark:text-night-400 mt-1">Timeline stepper · Devfolio pattern</p>
            <div className="space-y-3 mt-5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-black tracking-widest uppercase text-surface-500 dark:text-night-400 mb-1 block">Round Number</label>
                  <input type="number" value={roundForm.roundNumber}
                    onChange={(e) => setRoundForm({ ...roundForm, roundNumber: e.target.value })}
                    className="w-full px-4 h-11 border border-surface-200 dark:border-white/10 rounded-xl text-sm bg-white dark:bg-[#0a0a0a] text-surface-900 dark:text-white font-medium" />
                </div>
                <div>
                  <label className="text-xs font-black tracking-widest uppercase text-surface-500 dark:text-night-400 mb-1 block">Title</label>
                  <input type="text" value={roundForm.title}
                    onChange={(e) => setRoundForm({ ...roundForm, title: e.target.value })}
                    className="w-full px-4 h-11 border border-surface-200 dark:border-white/10 rounded-xl text-sm bg-white dark:bg-[#0a0a0a] text-surface-900 dark:text-white placeholder:text-[#6b7280] dark:placeholder:text-night-400 font-medium" placeholder="Round 1" />
                </div>
              </div>
              <div>
                <label className="text-xs font-black tracking-widest uppercase text-surface-500 dark:text-night-400 mb-1 block">Description</label>
                <textarea value={roundForm.description}
                  onChange={(e) => setRoundForm({ ...roundForm, description: e.target.value })}
                  className="w-full px-4 py-3 border border-surface-200 dark:border-white/10 rounded-xl text-sm h-20 bg-white dark:bg-[#0a0a0a] text-surface-900 dark:text-white placeholder:text-[#6b7280] dark:placeholder:text-night-400" placeholder="What happens in this round" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-black tracking-widest uppercase text-surface-500 dark:text-night-400 mb-1 block">Date</label>
                  <input type="date" value={roundForm.date} onChange={(e) => setRoundForm({ ...roundForm, date: e.target.value })} className="w-full px-4 h-11 border border-surface-200 dark:border-white/10 rounded-xl text-sm bg-white dark:bg-[#0a0a0a] text-surface-900 dark:text-white [color-scheme:light] dark:[color-scheme:dark]" />
                </div>
                <div>
                  <label className="text-xs font-black tracking-widest uppercase text-surface-500 dark:text-night-400 mb-1 block">Results Date</label>
                  <input type="date" value={roundForm.resultDate} onChange={(e) => setRoundForm({ ...roundForm, resultDate: e.target.value })} className="w-full px-4 h-11 border border-surface-200 dark:border-white/10 rounded-xl text-sm bg-white dark:bg-[#0a0a0a] text-surface-900 dark:text-white [color-scheme:light] dark:[color-scheme:dark]" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowAddRound(false)} className="flex-1 h-11 bg-surface-100 dark:bg-white/10 text-surface-700 dark:text-white rounded-full font-black text-sm">Cancel</button>
              <button onClick={handleAddRound} className="flex-1 h-11 bg-primary-500 text-black rounded-full font-black text-sm hover:shadow-[0_8px_24px_rgba(30,215,96,0.30)] dark:bg-primary-500 dark:text-black">Add Round</button>
            </div>
          </div>
        </div>
      )}

      {/* Final Round Result Modal — premium bento */}
      {showResultPopup && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:hidden dark:bg-black/50"
          onClick={() => setShowResultPopup(false)}>
          <div className="bg-white dark:bg-[#121212] rounded-[24px] border border-surface-200 dark:border-[#282828] w-full max-w-md p-6 shadow-[0_24px_64px_rgba(0,0,0,0.25)]" onClick={(e) => e.stopPropagation()}>
            <div className="text-center mb-6">
              <div className="w-16 h-16 rounded-[16px] bg-gradient-to-br from-amber-500 to-primary-500 flex items-center justify-center mx-auto mb-3 shadow-[0_12px_32px_rgba(245,183,0,0.30)] dark:bg-gradient-to-br dark:from-amber-500 dark:to-primary-500">
                <Trophy className="w-7 h-7 text-white dark:text-white" />
              </div>
              <h2 className="font-display text-xl font-[800] tracking-[-0.02em] text-surface-900 dark:text-white">Final Round Completed!</h2>
              <p className="text-surface-500 dark:text-night-400 text-sm mt-1 font-medium">How did it go? Share your experience</p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-black tracking-widest uppercase text-surface-500 dark:text-night-400 mb-2 block">Did you win a position?</label>
                <div className="grid grid-cols-4 gap-2">
                  {['1st', '2nd', '3rd', 'None'].map((pos) => (
                    <button key={pos}
                      onClick={() => setResultForm({ ...resultForm, winPosition: pos === 'None' ? '' : pos })}
                      className={clsx('h-11 rounded-full text-sm font-black border-2 transition-all active:scale-[0.98] dark:border-2',
                        (resultForm.winPosition === pos || (pos === 'None' && !resultForm.winPosition))
                          ? 'border-amber-400 bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 shadow dark:border-amber-400'
                          : 'border-surface-200 dark:border-white/10 text-surface-600 dark:text-night-300 hover:border-surface-300 dark:hover:border-white/20 bg-white dark:bg-white/5'
                      )}>
                      {pos}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-black tracking-widest uppercase text-surface-500 dark:text-night-400 mb-1 block">Share your review <span className="normal-case font-medium tracking-normal">(optional)</span></label>
                <textarea value={resultForm.review}
                  onChange={(e) => setResultForm({ ...resultForm, review: e.target.value })}
                  className="w-full px-4 py-3 border border-surface-200 dark:border-white/10 rounded-xl text-sm h-24 bg-white dark:bg-[#0a0a0a] text-surface-900 dark:text-white placeholder:text-[#6b7280] dark:placeholder:text-night-400 focus:outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-500/15 dark:focus:border-amber-300"
                  placeholder="How was the experience? Any tips for others?" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowResultPopup(false)} className="flex-1 h-11 bg-surface-100 dark:bg-white/10 text-surface-700 dark:text-white rounded-full font-black text-sm">Skip</button>
              <button onClick={handleSubmitResult} className="flex-1 h-11 bg-[#0a0a0a] dark:bg-white text-white dark:text-black rounded-full font-black text-sm hover:shadow">Submit</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
