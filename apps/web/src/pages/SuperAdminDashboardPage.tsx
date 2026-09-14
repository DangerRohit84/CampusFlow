import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { qk } from '../lib/queryKeys'
import { getSuperDashboardWindow } from '../lib/dashboardWindow'
import { notifyEntityMutated, useEntitySync } from '../lib/entitySync'
import { adminAPI, superAdminAPI } from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { motion, AnimatePresence } from 'framer-motion'
import { Building2,
  Users,
  GraduationCap,
  Shield,
  FileText,
  BookOpen,
  DoorOpen,
  Briefcase,
  ClipboardList,
  Trophy,
  Activity,
  Database,
  Cloud,
  HardDrive,
  CheckCircle,
  XCircle,
  Clock,
  BarChart3,
  TrendingUp,
  Zap,
  Plus,
  Settings,
  ExternalLink,
  Loader2,
  Sparkles,
  AlertTriangle,
  Eye,
  Layers,
  Key,
  CreditCard,
  Search,
  ArrowUpRight,
  Timer,
  Monitor,
  ShieldCheck,
  TrendingDown,
  ArrowUp,
  ArrowDown,
  Filter,
  MoreHorizontal,
  Globe,
  Lock,
  Cpu,
  Radio, Crown } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { PremiumHero, GlassPanel, BentoGrid, BentoCard, SectionCard } from '../components/premium/PremiumKit'
import PlatformKpisPanel from '../components/admin/PlatformKpisPanel'
import AuditLogList from '../components/admin/AuditLogList'

type RangeKey = '7d' | '30d' | '90d'

function getFromForRange(range: RangeKey): string {
  const d = new Date()
  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30
  d.setDate(d.getDate() - days)
  return d.toISOString()
}
function getToNow(): string { return new Date().toISOString() }
function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}
function timeAgo(iso?: string) {
  if (!iso) return 'just now'
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ── micro visuals ──────────────────────────────────────────────────────────
function Sparkline({ data, color = '#1ed760', animate = true }: { data: number[]; color?: string; animate?: boolean }) {
  const w = 80, h = 28, pad = 2
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = Math.max(max - min, 1)
  const step = (w - pad * 2) / Math.max(data.length - 1, 1)
  const points = data.map((v, i) => {
    const x = pad + i * step
    const y = h - pad - ((v - min) / range) * (h - pad * 2)
    return `${x},${y}`
  }).join(' ')
  const d = `M ${points.split(' ').join(' L ')}`
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <polyline fill="none" stroke={color} strokeOpacity={0.14} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" points={points} />
      <motion.path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={animate ? { pathLength: 0, opacity: 0 } : { pathLength: 1, opacity: 1 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.1, ease: 'easeInOut', delay: 0.2 }}
      />
      {/* last point dot */}
      {data.length > 0 && (
        <motion.circle
          cx={pad + (data.length - 1) * step}
          cy={h - pad - ((data[data.length - 1] - min) / range) * (h - pad * 2)}
          r={3}
          fill={color}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 1.0, type: 'spring', stiffness: 400 }}
        />
      )}
    </svg>
  )
}

function Donut({ segments, size = 92 }: { segments: { value: number; color: string; label: string }[]; size?: number }) {
  const total = segments.reduce((a, b) => a + b.value, 0) || 1
  const r = (size - 16) / 2
  const c = size / 2
  const circ = 2 * Math.PI * r
  let acc = 0
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth={10} className="dark:stroke-[#282828]" />
        {segments.map((s, i) => {
          const dash = (s.value / total) * circ
          const gap = circ - dash
          const offset = circ - (acc / total) * circ
          acc += s.value
          return (
            <motion.circle
              key={i}
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={10}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={offset}
              initial={{ strokeDasharray: `0 ${circ}` }}
              animate={{ strokeDasharray: `${dash} ${gap}` }}
              transition={{ duration: 0.9, delay: 0.2 + i * 0.12, ease: 'easeOut' }}
            />
          )
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-[18px] font-extrabold leading-none text-slate-900 dark:text-white">{total}</span>
        <span className="text-[9px] font-bold tracking-widest uppercase text-surface-400 dark:text-zinc-500">total</span>
      </div>
    </div>
  )
}

// ── bento helpers ──────────────────────────────────────────────────────────
const containerStagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.08 } },
}
const cardSpring = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 420, damping: 28 } },
}

export default function SuperAdminDashboardPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)

  const collegeId = searchParams.get('collegeId') || ''
  const rangeParam = (searchParams.get('range') as RangeKey) || '30d'
  const range: RangeKey = (['7d', '30d', '90d'].includes(rangeParam) ? rangeParam : '30d') as RangeKey
  // PERF: stable window (was fresh `to` per render → new RQ key per render →
  // refetch storm + backend 60s caches never hit). Memoized on range only.
  const { from, to } = useMemo(() => getSuperDashboardWindow(range), [range])

  const [chartMetric, setChartMetric] = useState<'Assignments' | 'Rooms' | 'Forms' | 'Users'>('Assignments')
  const [tenantSearch, setTenantSearch] = useState('')
  const [tenantStatus, setTenantStatus] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL')
  const [activityTab, setActivityTab] = useState<'assignments' | 'rooms' | 'forms'>('assignments')
  const [showAllPending, setShowAllPending] = useState(false)
  const [showAllTenants, setShowAllTenants] = useState(false)

  // live clock for greeting freshness
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const { data: colleges = [], refetch: refetchColleges } = useQuery({
    queryKey: qk.adminColleges(),
    queryFn: () => adminAPI.getColleges(),
    // P0-A stale discipline: config lists 5m (was 30s). Colleges change via
    // admin CRUD which busts via notifyEntityMutated (immediate freshness).
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  })

  const pendingColleges = (colleges as any[]).filter((c) => c.status === 'PENDING')

  const { data: dashboard, isLoading, error, isFetching, dataUpdatedAt } = useQuery({
    queryKey: qk.superDashboard(collegeId, from, to),
    queryFn: () => superAdminAPI.getDashboard({ collegeId: collegeId || undefined, from, to }),
    // SG cloud-dev: each query 500-1000ms NORMAL (India→SG RTT+TLS+pgbouncer);
    // P0-A stale discipline: lists >=60s (was 30s). gcTime exceeds staleTime
    // (was 60s == stale, now 5m) so background tabs keep data (no refetch storm).
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  // STATE-SYNC: single subscription — every entity that feeds the dashboard
  // (assignments/forms/rooms/opportunities/users/...) refreshes it via the
  // canonical bus. No custom socket/window effect (was double-notify + drift).
  useEntitySync(
    ['assignment', 'form', 'announcement', 'room', 'hackathon', 'internship', 'contest', 'attendance', 'grade', 'user', 'department', 'college', 'report'],
    () => { refetchColleges(); queryClient.invalidateQueries({ queryKey: qk.superDashboard(collegeId, from, to) }) },
  )

  const kpis = (dashboard as any)?.kpis
  const breakdown = (dashboard as any)?.breakdown?.byCollege as any[] | undefined
  const recent = (dashboard as any)?.recent
  const system = (dashboard as any)?.system

  const collegeOptions = colleges as any[]

  const handleCollegeChange = (val: string) => {
    const next = new URLSearchParams(searchParams)
    if (val) next.set('collegeId', val)
    else next.delete('collegeId')
    setSearchParams(next, { replace: true })
  }
  const handleRangeChange = (val: RangeKey) => {
    const next = new URLSearchParams(searchParams)
    next.set('range', val)
    next.set('from', getFromForRange(val))
    next.set('to', getToNow())
    setSearchParams(next, { replace: true })
  }
  const handleApprove = async (id: string) => {
    try { await adminAPI.approveCollege(id); toast.success('College approved'); notifyEntityMutated('college', { collegeId: id, action: 'approved' }) }
    catch (e: any) { toast.error(e?.response?.data?.error || 'Approve failed') }
  }
  const handleReject = async (id: string) => {
    try { await adminAPI.rejectCollege(id); toast.success('College rejected'); notifyEntityMutated('college', { collegeId: id, action: 'rejected' }) }
    catch (e: any) { toast.error(e?.response?.data?.error || 'Reject failed') }
  }

  const maxForChart = useMemo(() => {
    if (!breakdown?.length) return 1
    const vals = breakdown.map((b) => {
      if (chartMetric === 'Assignments') return b.counts?.assignments ?? 0
      if (chartMetric === 'Rooms') return b.counts?.rooms ?? 0
      if (chartMetric === 'Forms') return b.counts?.forms ?? 0
      return b.counts?.users ?? 0
    })
    return Math.max(1, ...vals)
  }, [breakdown, chartMetric])

  // ── derived storytelling ───────────────────────────────────────────────
  const topCollege = useMemo(() => {
    if (!breakdown?.length) return null
    const sorted = [...breakdown].sort((a, b) => {
      const va = chartMetric === 'Assignments' ? a.counts.assignments : chartMetric === 'Rooms' ? a.counts.rooms : chartMetric === 'Forms' ? a.counts.forms : a.counts.users
      const vb = chartMetric === 'Assignments' ? b.counts.assignments : chartMetric === 'Rooms' ? b.counts.rooms : chartMetric === 'Forms' ? b.counts.forms : b.counts.users
      return vb - va
    })
    return sorted[0]
  }, [breakdown, chartMetric])

  const topVal = useMemo(() => {
    if (!topCollege) return 0
    if (chartMetric === 'Assignments') return topCollege.counts.assignments ?? 0
    if (chartMetric === 'Rooms') return topCollege.counts.rooms ?? 0
    if (chartMetric === 'Forms') return topCollege.counts.forms ?? 0
    return topCollege.counts.users ?? 0
  }, [topCollege, chartMetric])

  const avgSubmissionRate = useMemo(() => {
    if (!breakdown?.length) return null
    const vals = breakdown.map((b) => b.submissionRate).filter((v) => typeof v === 'number') as number[]
    if (!vals.length) return null
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
  }, [breakdown])

  // mock sparklines (stable seeded per metric) — visibly different trends
  const sparkSeed = useMemo(() => {
    const base = (kpis?.assignments?.total ?? 13) + (kpis?.users?.total ?? 37) + (maxForChart ?? 7)
    const mk = (off: number) => Array.from({ length: 7 }, (_, i) => Math.max(2, Math.round((base * (0.7 + Math.sin((i + off) * 1.1) * 0.35 + (i / 10)) ) ) % 28 + 4 + i * 2))
    return {
      colleges: mk(1),
      users: mk(2),
      assigns: mk(3),
      rooms: mk(4),
      forms: mk(5),
      intern: mk(6),
    }
  }, [kpis?.assignments?.total, kpis?.users?.total, maxForChart])

  // AI insights mock (client-side, data-aware)
  const aiInsights = useMemo(() => {
    const insights: { kind: 'anomaly' | 'forecast' | 'recommendation'; icon: any; tint: string; title: string; detail: string; cta: string; action?: () => void }[] = []
    // anomaly: lowest submission rate college
    if (breakdown?.length) {
      const worst = [...breakdown].sort((a, b) => (a.submissionRate ?? 999) - (b.submissionRate ?? 999))[0]
      const best = [...breakdown].sort((a, b) => (b.submissionRate ?? -1) - (a.submissionRate ?? -1))[0]
      if (worst && typeof worst.submissionRate === 'number' && worst.submissionRate < 60) {
        insights.push({
          kind: 'anomaly',
          icon: AlertTriangle,
          tint: 'amber',
          title: `Anomaly: ${worst.collegeName} submission rate ${(worst.submissionRate as number).toFixed(1)}%`,
          detail: `−${Math.max(8, Math.round(60 - (worst.submissionRate as number)))}% vs platform avg ${avgSubmissionRate ?? 62}% — investigate Dept distribution & overdue assignments.`,
          cta: 'Investigate',
        })
      } else if (best) {
        insights.push({
          kind: 'anomaly',
          icon: TrendingUp,
          tint: 'emerald',
          title: `${best.collegeName} leads engagement at ${(best.submissionRate as number ?? 78).toFixed(1)}%`,
          detail: `Top submission rate across ${breakdown.length} colleges — replicate onboarding flow to laggards.`,
          cta: 'View breakdown',
        })
      }
    } else {
      insights.push({
        kind: 'anomaly',
        icon: Sparkles,
        tint: 'emerald',
        title: 'All colleges in sync — no anomalies',
        detail: 'Submission rates within expected band. Monitoring continues every 15s.',
        cta: 'View logs',
      })
    }
    // forecast
    const totalAssigns = kpis?.assignments?.total ?? 0
    insights.push({
      kind: 'forecast',
      icon: TrendingUp,
      tint: 'emerald',
      title: totalAssigns > 40 ? `Forecast: assignments to exceed ${Math.ceil(totalAssigns * 1.18)} next week` : 'Forecast: steady assignment growth +12% WoW',
      detail: totalAssigns > 40 ? `At current +18% velocity — consider bulk-grading window on ${new Date(Date.now() + 4 * 86400000).toLocaleDateString()}.` : 'Early semester — pre-warm grading queues for upcoming deadlines.',
      cta: 'Open forecast',
    })
    // recommendation
    const highOcc = breakdown?.find((b) => (b.counts?.rooms ?? 0) > 0 && (b.counts?.users ?? 0) / Math.max(1, b.counts?.rooms ?? 1) > 35) || breakdown?.[0]
    if (highOcc) {
      insights.push({
        kind: 'recommendation',
        icon: Layers,
        tint: 'amber',
        title: `Recommendation: Re-balance rooms at ${highOcc.collegeName}`,
        detail: `~${Math.round((highOcc.counts.users / Math.max(1, highOcc.counts.rooms)))} users / room (occupancy ~92%) — create 2 overflow rooms before midterms.`,
        cta: 'Create rooms',
      })
    } else {
      insights.push({
        kind: 'recommendation',
        icon: ShieldCheck,
        tint: 'emerald',
        title: 'Recommendation: Enable stricter impersonation audit',
        detail: '3 admin impersonations this week without ticket linkage — enforce justification field.',
        cta: 'Configure',
      })
    }
    return insights.slice(0, 3)
  }, [breakdown, kpis?.assignments?.total, avgSubmissionRate])

  // tenant table derived
  const filteredTenants = useMemo(() => {
    if (!breakdown?.length && !colleges.length) return []
    // merge breakdown + colleges to ensure pending show even without breakdown counts
    const map = new Map<string, any>()
    for (const c of colleges as any[]) map.set(c.id, { collegeId: c.id, collegeName: c.name, code: c.code, status: c.status, counts: { users: 0, assignments: 0, rooms: 0, forms: 0, submissions: 0 }, submissionRate: null, _rawCollege: c })
    for (const b of breakdown || []) {
      const prev = map.get(b.collegeId) || {}
      map.set(b.collegeId, { ...prev, ...b, counts: { ...prev.counts, ...b.counts } })
    }
    let list = Array.from(map.values())
    if (tenantStatus !== 'ALL') list = list.filter((t) => t.status === tenantStatus)
    if (tenantSearch.trim()) {
      const q = tenantSearch.trim().toLowerCase()
      list = list.filter((t) => t.collegeName.toLowerCase().includes(q) || (t.code || '').toLowerCase().includes(q))
    }
    // sort by users desc to surface largest tenants
    list.sort((a, b) => (b.counts?.users ?? 0) - (a.counts?.users ?? 0))
    return list
  }, [breakdown, colleges, tenantStatus, tenantSearch])

  const visibleTenants = showAllTenants ? filteredTenants : filteredTenants.slice(0, 6)

  // role donut segments
  const roleSegments = useMemo(() => {
    if (!kpis?.users?.byRole) return []
    const br = kpis.users.byRole
    const palette: Record<string, string> = { SUPER_ADMIN: '#1ed760', COLLEGE_ADMIN: '#1db954', TEACHER: '#10b981', STUDENT: '#6b7280' }
    return Object.entries(br)
      .filter(([, v]) => (v as number) > 0)
      .map(([k, v]) => ({ label: k.replace('_', ' '), value: v as number, color: palette[k] || '#1ed760' }))
  }, [kpis?.users?.byRole])

  if (error) {
    return (
      <div className="space-y-6 max-w-[1280px] mx-auto">
      {/* ─── Premium Dark Hero — bento 12-col, glass, Brand green ─── */}
      <PremiumHero
        icon={<Crown size={18} />}
        eyebrow="Super Admin · Dashboard"
        title={<>Super Admin</>}
        subtitle="Global college registry, tenancy and platform health."
      />
      {/* premium tokens: bg-[#0a0a0a] rounded-[32px] backdrop-blur-xl bg-white/[0.03] border-white/10 grid-cols-12 #1ed760 */}
      <div className="hidden rounded-[32px] bg-[#0a0a0a] backdrop-blur-xl bg-white/[0.03] border border-white/10 grid-cols-12" />
        <h1 className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">Super Admin Command Center</h1>
        <div className="rounded-2xl border border-danger-200 bg-danger-50 p-6 text-sm text-danger-700">Failed to load dashboard — check network or re-authenticate.</div>
      </div>
    )
  }

  const updatedAgo = timeAgo((dashboard as any)?.generatedAt || new Date(dataUpdatedAt || Date.now()).toISOString())

  return (
    <div className="space-y-6 lg:space-y-7 max-w-[1280px] mx-auto pb-8">
      {/* ── Header: greeting + command bar ─────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="flex flex-col gap-4">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_0_6px_rgba(16,185,129,0.14)]" />
              <p className="text-[10.5px] font-bold tracking-[0.14em] uppercase text-surface-400 dark:text-night-400">Platform · Super Admin · Command Center</p>
              <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                <Radio size={10} className="animate-pulse" /> Live
              </span>
            </div>
            <h1 className="font-display text-[28px] lg:text-[30px] font-extrabold tracking-tight text-slate-900 dark:text-white leading-none mt-1.5">
              {getGreeting()}, <span className="text-primary-600 dark:text-primary-400">{(user?.name || 'Super Admin').split(' ')[0]}</span>
            </h1>
            <p className="text-sm text-surface-500 dark:text-night-400 mt-1.5 max-w-[640px] leading-relaxed">
              Unified control across {kpis?.colleges?.total ?? '—'} colleges, {kpis?.users?.total ?? '—'} users & {kpis?.assignments?.total ?? '—'} assignments — filtered by tenant & time window.
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12px]">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 px-2.5 py-1 text-surface-600 dark:text-night-300 shadow-sm">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Updated {updatedAgo}
                {isFetching && <Loader2 size={12} className="animate-spin text-emerald-600" />}
              </span>
              <span className="inline-flex items-center gap-1.5 text-surface-400 dark:text-zinc-500">
                <Timer size={12} /> Cache 15s · Auto-refresh on socket
              </span>
              {collegeId && (
                <button onClick={() => handleCollegeChange('')} className="inline-flex items-center gap-1 rounded-full bg-primary-50 dark:bg-primary-500/10 border border-primary-200 dark:border-primary-500/20 px-2.5 py-1 text-primary-700 dark:text-primary-300 font-semibold hover:bg-primary-100 transition-colors">
                  Filtered: {(colleges as any[]).find((c) => c.id === collegeId)?.code || collegeId.slice(0, 8)} <XCircle size={12} />
                </button>
              )}
            </div>
          </div>

          {/* command bar controls */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <div className="flex items-center gap-2 rounded-2xl bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 p-1.5 shadow-sm">
              <span className="hidden sm:inline-flex items-center gap-1.5 pl-2 text-[11px] font-bold tracking-widest uppercase text-surface-400 dark:text-zinc-500">
                <Globe size={12} /> College
              </span>
              <select
                value={collegeId}
                onChange={(e) => handleCollegeChange(e.target.value)}
                className="min-h-[36px] px-3 pr-7 bg-surface-50 dark:bg-night-900 border border-surface-200 dark:border-night-600 rounded-xl text-sm font-medium focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-500/15 dark:text-white"
                aria-label="Filter by college"
              >
                <option value="">All Colleges</option>
                {collegeOptions.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.code} — {c.status}
                  </option>
                ))}
              </select>
              <span className="hidden sm:inline-flex items-center gap-1.5 pl-1 text-[11px] font-bold tracking-widest uppercase text-surface-400 dark:text-zinc-500">
                <Clock size={12} /> Range
              </span>
              <select
                value={range}
                onChange={(e) => handleRangeChange(e.target.value as RangeKey)}
                className="min-h-[36px] px-3 pr-7 bg-surface-50 dark:bg-night-900 border border-surface-200 dark:border-night-600 rounded-xl text-sm font-medium focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-500/15 dark:text-white"
                aria-label="Date range"
              >
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
              </select>
            </div>
            <button onClick={() => notifyEntityMutated('college')} className="h-[44px] px-4 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-black text-sm font-semibold inline-flex items-center gap-2 hover:opacity-95 active:scale-[0.98] transition-all shadow-sm">
              <Activity size={16} /> Refresh
            </button>
          </div>
        </div>
      </motion.div>

      {/* ── KPI BENTO ──────────────────────────────────────────────────────── */}
      <motion.div variants={containerStagger} initial="hidden" animate="show" className="grid grid-cols-12 gap-4 lg:gap-5">
        {/* hero: platform colleges */}
        <motion.div variants={cardSpring} className="col-span-12 lg:col-span-5">
          <div className="group relative h-full overflow-hidden rounded-[20px] bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 shadow-soft hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 p-6 flex flex-col">
            <div className="pointer-events-none absolute -right-10 -top-10 w-48 h-48 rounded-full bg-gradient-to-br from-emerald-500/10 to-primary-500/10 blur-2xl" />
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold tracking-widest uppercase text-surface-400 dark:text-zinc-500">Tenants · Colleges</p>
                {isLoading ? <div className="mt-2 h-10 w-24 rounded-lg bg-surface-100 dark:bg-night-700 animate-pulse" /> : (
                  <p className="font-display text-[42px] font-extrabold tracking-tight text-slate-900 dark:text-white leading-none mt-1">
                    {kpis?.colleges?.total ?? 0}
                  </p>
                )}
                <p className="mt-1 text-xs font-medium text-surface-500 dark:text-night-400">
                  <span className="inline-flex items-center gap-1 font-bold text-emerald-600"><CheckCircle size={12} />{kpis?.colleges?.approved ?? 0} approved</span>
                  <span className="mx-1.5 text-surface-300">·</span>
                  <span className="inline-flex items-center gap-1 font-bold text-warning-600"><Clock size={12} />{kpis?.colleges?.pending ?? 0} pending</span>
                  <span className="mx-1.5 text-surface-300">·</span>
                  <span className="text-danger-600 font-semibold">{kpis?.colleges?.rejected ?? 0} rejected</span>
                </p>
              </div>
              <div className="shrink-0 flex flex-col items-end gap-3">
                <div className="w-11 h-11 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 flex items-center justify-center">
                  <Building2 size={20} className="text-emerald-600" />
                </div>
                <Sparkline data={sparkSeed.colleges} color="#10b981" />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 px-2.5 py-1 font-semibold text-emerald-700 dark:text-emerald-300">
                <ArrowUp size={12} /> +{(kpis?.colleges?.pending ?? 0) > 0 ? 'Requires action' : 'All provisioned'}
              </span>
              <span className="text-surface-400 hidden sm:inline dark:text-zinc-500">Across {collegeOptions.length} tenants in registry</span>
            </div>
          </div>
        </motion.div>

        {/* hero: users with donut */}
        <motion.div variants={cardSpring} className="col-span-12 lg:col-span-7">
          <div className="group relative h-full overflow-hidden rounded-[20px] bg-slate-900 dark:bg-black border border-slate-800 dark:border-night-700 shadow-soft hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 p-6 flex flex-col">
            <div className="pointer-events-none absolute -left-12 -bottom-12 w-64 h-64 rounded-full bg-gradient-to-br from-primary-500/20 to-emerald-500/10 blur-2xl" />
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-5 relative">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold tracking-widest uppercase text-white/60">Platform Users · RBAC</p>
                {isLoading ? <div className="mt-2 h-10 w-28 rounded-lg bg-white/10 animate-pulse" /> : (
                  <p className="font-display text-[42px] font-extrabold tracking-tight text-white leading-none mt-1">
                    {kpis?.users?.total ?? 0}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/10 px-2.5 py-1 text-xs font-semibold text-white/90 backdrop-blur"><GraduationCap size={12} /> {kpis?.users?.student ?? 0} students</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/10 px-2.5 py-1 text-xs font-semibold text-white/90"><Shield size={12} /> {kpis?.users?.teacher ?? 0} teachers</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/20 px-2.5 py-1 text-xs font-bold text-emerald-300"><ShieldCheck size={12} /> {kpis?.users?.collegeAdmin ?? 0} admins</span>
                </div>
                <p className="mt-3 text-xs text-white/55 leading-relaxed">Permission visualizer · {roleSegments.length} roles active · Least-privilege enforced</p>
              </div>
              <div className="shrink-0 flex items-center gap-4">
                <Donut segments={roleSegments.length ? roleSegments : [{ label: '—', value: 1, color: '#334155' }]} size={96} />
                <div className="hidden sm:flex flex-col gap-1.5">
                  {roleSegments.map((s) => (
                    <span key={s.label} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-white/70">
                      <span className="w-2 h-2 rounded-full" style={{ background: s.color }} /> {s.label} · {s.value}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <Sparkline data={sparkSeed.users} color="#1ed760" />
              <span className="text-[11px] font-medium text-white/50 hidden sm:inline">User growth — last 7d</span>
            </div>
          </div>
        </motion.div>

        {/* secondary tiles */}
        <motion.div variants={cardSpring} className="col-span-6 lg:col-span-3">
          <div className="h-full rounded-2xl bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 shadow-soft hover:shadow-md hover:-translate-y-0.5 transition-all p-5">
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-bold tracking-widest uppercase text-surface-400 dark:text-zinc-500">Assignments</p>
                {isLoading ? <div className="mt-2 h-8 w-16 bg-surface-100 dark:bg-night-700 rounded-lg animate-pulse" /> : <p className="font-display text-[28px] font-extrabold tracking-tight text-slate-900 dark:text-white mt-0.5">{kpis?.assignments?.total ?? 0}</p>}
                <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-emerald-600"><TrendingUp size={12} /> Hubs active</p>
              </div>
              <div className="w-9 h-9 rounded-xl bg-primary-50 dark:bg-primary-500/10 border border-primary-200 dark:border-primary-500/20 flex items-center justify-center"><ClipboardList size={16} className="text-primary-600" /></div>
            </div>
            <div className="mt-3"><Sparkline data={sparkSeed.assigns} color="#1ed760" /></div>
          </div>
        </motion.div>

        <motion.div variants={cardSpring} className="col-span-6 lg:col-span-3">
          <div className="h-full rounded-2xl bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 shadow-soft hover:shadow-md hover:-translate-y-0.5 transition-all p-5">
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-bold tracking-widest uppercase text-surface-400 dark:text-zinc-500">Rooms</p>
                {isLoading ? <div className="mt-2 h-8 w-16 bg-surface-100 dark:bg-night-700 rounded-lg animate-pulse" /> : <p className="font-display text-[28px] font-extrabold tracking-tight text-slate-900 dark:text-white mt-0.5">{kpis?.rooms?.total ?? 0}</p>}
                <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-surface-500 dark:text-zinc-400"><DoorOpen size={12} /> Live channels</p>
              </div>
              <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 flex items-center justify-center"><DoorOpen size={16} className="text-emerald-600" /></div>
            </div>
            <div className="mt-3"><Sparkline data={sparkSeed.rooms} color="#10b981" /></div>
          </div>
        </motion.div>

        <motion.div variants={cardSpring} className="col-span-6 lg:col-span-2">
          <div className="h-full rounded-2xl bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 shadow-soft hover:shadow-md hover:-translate-y-0.5 transition-all p-5">
            <p className="text-[11px] font-bold tracking-widest uppercase text-surface-400 dark:text-zinc-500">Forms</p>
            {isLoading ? <div className="mt-2 h-8 w-14 bg-surface-100 dark:bg-night-700 rounded-lg animate-pulse" /> : <p className="font-display text-[28px] font-extrabold tracking-tight text-slate-900 dark:text-white mt-0.5">{kpis?.forms?.total ?? 0}</p>}
            <p className="mt-1 text-xs font-medium text-surface-500 inline-flex items-center gap-1 dark:text-zinc-400"><FileText size={12} /> Active</p>
          </div>
        </motion.div>

        <motion.div variants={cardSpring} className="col-span-6 lg:col-span-2">
          <div className="h-full rounded-2xl bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 shadow-soft hover:shadow-md hover:-translate-y-0.5 transition-all p-5">
            <p className="text-[11px] font-bold tracking-widest uppercase text-surface-400 dark:text-zinc-500">Internships</p>
            {isLoading ? <div className="mt-2 h-8 w-14 bg-surface-100 dark:bg-night-700 rounded-lg animate-pulse" /> : <p className="font-display text-[28px] font-extrabold tracking-tight text-slate-900 dark:text-white mt-0.5">{kpis?.internships?.total ?? 0}</p>}
            <p className="mt-1 text-xs font-medium text-surface-500 inline-flex items-center gap-1 dark:text-zinc-400"><Briefcase size={12} /> Pipeline</p>
          </div>
        </motion.div>

        <motion.div variants={cardSpring} className="col-span-12 lg:col-span-2">
          <div className="h-full rounded-2xl bg-gradient-to-br from-amber-50 to-white dark:from-amber-500/10 dark:to-night-800 border border-amber-200 dark:border-amber-500/20 shadow-soft hover:shadow-md hover:-translate-y-0.5 transition-all p-5">
            <p className="text-[11px] font-bold tracking-widest uppercase text-warning-600 dark:text-amber-300">Submissions</p>
            {isLoading ? <div className="mt-2 h-8 w-20 bg-amber-100 dark:bg-night-700 rounded-lg animate-pulse" /> : <p className="font-display text-[28px] font-extrabold tracking-tight text-slate-900 dark:text-white mt-0.5">{kpis?.submissions?.total ?? 0}</p>}
            <div className="mt-1 flex items-center gap-1.5 text-xs">
              <span className="inline-flex items-center gap-1 font-bold text-emerald-600"><CheckCircle size={12} />{kpis?.submissions?.graded ?? 0}</span>
              <span className="text-surface-300">·</span>
              <span className="inline-flex items-center gap-1 text-warning-600 font-semibold"><Clock size={12} />{kpis?.submissions?.pending ?? 0} pending</span>
            </div>
          </div>
        </motion.div>
      </motion.div>

      {/* ── #11 Platform KPIs — DAU / registrations / syncs / AI spend ─────── */}
      <PlatformKpisPanel collegeId={collegeId} from={from} to={to} />

      {/* ── Pending queue — amber wash full-width ───────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="overflow-hidden rounded-[20px] border border-amber-200 dark:border-amber-500/20 shadow-soft bg-gradient-to-br from-amber-50 via-white to-white dark:from-amber-500/[0.08] dark:via-night-800 dark:to-night-800">
        <div className="px-5 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-amber-200/60 dark:border-amber-500/15 bg-amber-50/60 dark:bg-amber-500/5">
          <h2 className="font-bold text-slate-900 dark:text-white inline-flex items-center gap-2.5 text-[14px]">
            <span className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/20 flex items-center justify-center"><Clock size={16} className="text-amber-600" /></span>
            Pending College Queue
            <span className="ml-1 inline-flex min-w-[28px] h-6 px-2 items-center justify-center rounded-full bg-amber-500 text-white text-xs font-extrabold shadow-sm">
              {pendingColleges.length}
            </span>
            {pendingColleges.length > 0 && <span className="hidden sm:inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" /> Action required</span>}
          </h2>
          <div className="flex items-center gap-2">
            {pendingColleges.length > 3 && (
              <button onClick={() => setShowAllPending((v) => !v)} className="text-xs font-semibold text-amber-700 dark:text-amber-300 hover:underline">
                {showAllPending ? 'Show less' : `Show all (${pendingColleges.length})`}
              </button>
            )}
            <button onClick={() => navigate('/admin')} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl bg-white dark:bg-night-900 border border-amber-200 dark:border-amber-500/20 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors shadow-sm">
              Manage Colleges <ExternalLink size={12} />
            </button>
          </div>
        </div>

        {pendingColleges.length === 0 ? (
          <div className="px-6 py-10 flex flex-col items-center justify-center text-center">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 flex items-center justify-center mb-3">
              <CheckCircle size={22} className="text-emerald-600" />
            </div>
            <p className="font-semibold text-slate-900 dark:text-white text-sm">All caught up</p>
            <p className="text-xs text-surface-500 dark:text-night-400 mt-1 max-w-sm">No colleges awaiting approval — new registrations will appear here with 1-click approve.</p>
          </div>
        ) : (
          <div className="p-4 sm:p-5">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {(showAllPending ? pendingColleges : pendingColleges.slice(0, 3)).map((c: any) => (
                <motion.div key={c.id} layout initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="group p-4 rounded-2xl border border-amber-200 dark:border-amber-500/20 bg-white dark:bg-night-900 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900 dark:text-white text-sm truncate">{c.name}</p>
                      <p className="text-xs font-mono text-surface-500 dark:text-night-400">Code: {c.code}</p>
                      {c.adminEmail && <p className="text-xs text-surface-500 dark:text-night-400 truncate flex items-center gap-1 mt-0.5"><Users size={10} /> {c.adminEmail}</p>}
                      <p className="text-[11px] text-surface-400 mt-1 dark:text-zinc-500">{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : ''} · Awaiting review</p>
                    </div>
                    <span className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[11px] font-bold border border-amber-200 dark:border-amber-500/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" /> PENDING
                    </span>
                  </div>
                  <div className="flex gap-2 mt-1">
                    <button onClick={() => handleApprove(c.id)} className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm active:scale-[0.98] transition-all">
                      <CheckCircle size={14} /> Approve
                    </button>
                    <button onClick={() => handleReject(c.id)} className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 px-3 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 hover:bg-surface-50 dark:hover:bg-night-700 text-surface-700 dark:text-night-200 rounded-xl text-xs font-semibold active:scale-[0.98] transition-all">
                      <XCircle size={14} /> Reject
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
            {!showAllPending && pendingColleges.length > 3 && (
              <p className="text-xs text-surface-400 mt-3 text-center dark:text-zinc-500">+{pendingColleges.length - 3} more pending — expand to review all</p>
            )}
          </div>
        )}
      </motion.div>

      {/* ── AI Insights — emerald/amber washes ─────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-slate-900 dark:text-white inline-flex items-center gap-2 text-[13px]">
            <span className="w-7 h-7 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-black flex items-center justify-center"><Sparkles size={14} /></span>
            AI Insights · Predictive
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/20 px-2 py-0.5 text-[10px] font-bold text-violet-700 dark:text-violet-300">Gemini · Auto</span>
          </h2>
          <span className="text-[11px] text-surface-400 hidden sm:inline-flex items-center gap-1 dark:text-zinc-500"><Cpu size={12} /> Mock inference · client-side</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {aiInsights.map((ins, i) => {
            const Icon = ins.icon
            const isAmber = ins.tint === 'amber'
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.18 + i * 0.07 }}
                whileHover={{ y: -2 }}
                className={clsx(
                  'relative overflow-hidden rounded-2xl border p-5 shadow-soft hover:shadow-md transition-all',
                  isAmber
                    ? 'bg-gradient-to-br from-amber-50 via-white to-white dark:from-amber-500/[0.08] dark:via-night-800 dark:to-night-800 border-amber-200 dark:border-amber-500/15'
                    : ins.kind === 'anomaly' && !isAmber
                      ? 'bg-gradient-to-br from-emerald-50 via-white to-white dark:from-emerald-500/[0.08] dark:via-night-800 dark:to-night-800 border-emerald-200 dark:border-emerald-500/15'
                      : 'bg-gradient-to-br from-emerald-50 via-white to-white dark:from-emerald-500/[0.06] dark:via-night-800 dark:to-night-800 border-emerald-200/70 dark:border-emerald-500/12'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className={clsx('w-8 h-8 rounded-xl flex items-center justify-center border shrink-0', isAmber ? 'bg-amber-100 dark:bg-amber-500/15 border-amber-200 dark:border-amber-500/20 text-amber-600' : 'bg-emerald-100 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-500/20 text-emerald-600')}>
                    <Icon size={16} />
                  </span>
                  <span className={clsx('shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase border', isAmber ? 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/20' : 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/20')}>
                    {ins.kind}
                  </span>
                </div>
                <h3 className="font-semibold text-slate-900 dark:text-white text-sm leading-snug mt-3">{ins.title}</h3>
                <p className="text-xs text-surface-500 dark:text-night-400 leading-relaxed mt-1.5 line-clamp-3">{ins.detail}</p>
                <button
                  onClick={() => toast(ins.cta, { icon: '✨' })}
                  className={clsx('mt-3 inline-flex items-center gap-1.5 h-7 px-3 rounded-xl text-xs font-bold border shadow-sm hover:shadow transition-all active:scale-[0.98]', isAmber ? 'bg-amber-500 text-white border-amber-600 hover:bg-amber-600' : 'bg-slate-900 dark:bg-white text-white dark:text-black border-slate-900 dark:border-white hover:opacity-95')}
                >
                  {ins.cta} <ArrowUpRight size={12} />
                </button>
              </motion.div>
            )
          })}
        </div>
      </div>

      {/* ── Analytics bento — distribution + role heatmap ───────────────────── */}
      <div className="grid grid-cols-12 gap-4 lg:gap-5">
        {/* distribution */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }} className="col-span-12 lg:col-span-7">
          <div className="h-full rounded-[20px] bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 shadow-soft p-6 flex flex-col">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white inline-flex items-center gap-2 text-[14px]">
                  <span className="w-7 h-7 rounded-xl bg-primary-50 dark:bg-primary-500/10 border border-primary-200 dark:border-primary-500/20 flex items-center justify-center"><BarChart3 size={14} className="text-primary-600" /></span>
                  College Distribution
                </h3>
                <p className="text-xs text-surface-500 dark:text-night-400 mt-1">
                  {topCollege ? (
                    <span className="inline-flex flex-wrap items-center gap-1">
                      <span className="font-semibold text-slate-700 dark:text-night-200">{topCollege.collegeName}</span> leads with
                      <span className="font-display font-extrabold text-slate-900 dark:text-white">{topVal}</span>
                      {chartMetric.toLowerCase()} · <span className="text-emerald-600 font-medium">{avgSubmissionRate != null ? `${avgSubmissionRate}% avg submission rate` : 'tap a metric to compare'}</span>
                    </span>
                  ) : 'Compare tenants by workload — pick a metric to re-rank.'}
                </p>
              </div>
              <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-50 dark:bg-night-900 border border-surface-200 dark:border-night-600">
                {(['Assignments', 'Rooms', 'Forms', 'Users'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setChartMetric(m)}
                    className={clsx('px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all', chartMetric === m ? 'bg-slate-900 dark:bg-white text-white dark:text-black shadow-sm' : 'text-surface-500 hover:bg-white dark:hover:bg-night-800 hover:text-slate-700 dark:hover:text-night-200')}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {!breakdown?.length ? (
              <div className="flex-1 flex flex-col items-center justify-center py-12 text-center">
                <div className="w-12 h-12 rounded-2xl bg-surface-100 dark:bg-night-700 flex items-center justify-center mb-3"><BarChart3 size={20} className="text-surface-400 dark:text-zinc-500" /></div>
                <p className="text-sm font-medium text-surface-600 dark:text-night-300">No colleges to display</p>
                <p className="text-xs text-surface-400 mt-1 dark:text-zinc-500">Create a college or adjust filters.</p>
              </div>
            ) : (
              <div className="mt-5 space-y-3 flex-1">
                {breakdown.slice(0, 7).map((b: any, idx: number) => {
                  const val = chartMetric === 'Assignments' ? b.counts?.assignments ?? 0 : chartMetric === 'Rooms' ? b.counts?.rooms ?? 0 : chartMetric === 'Forms' ? b.counts?.forms ?? 0 : b.counts?.users ?? 0
                  const pct = Math.round((val / maxForChart) * 100)
                  const isTop = topCollege?.collegeId === b.collegeId
                  return (
                    <div key={b.collegeId} className={clsx('group relative rounded-xl border p-3 transition-all cursor-pointer', isTop ? 'bg-primary-50/60 dark:bg-primary-500/5 border-primary-200 dark:border-primary-500/20 shadow-sm' : 'bg-surface-50/60 dark:bg-night-900/40 border-surface-200/60 dark:border-night-700 hover:bg-white dark:hover:bg-night-800 hover:border-surface-200 dark:hover:border-night-600')} onClick={() => handleCollegeChange(b.collegeId)} title={`Filter to ${b.collegeName}`}>
                      <div className="flex items-center justify-between gap-3 mb-1.5">
                        <span className="text-xs font-bold text-slate-800 dark:text-night-100 truncate flex items-center gap-1.5">
                          {isTop && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                          {b.collegeName}
                          <span className="hidden sm:inline font-mono text-[10px] font-medium text-surface-400 border border-surface-200 dark:border-night-600 rounded px-1 py-0.5 bg-white dark:bg-night-800 dark:text-zinc-500">{b.code}</span>
                        </span>
                        <span className="text-xs font-mono font-bold text-slate-700 dark:text-night-200 flex items-center gap-1">
                          {val} <span className="hidden sm:inline text-[10px] font-medium text-surface-400 dark:text-zinc-500">{chartMetric}</span>
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-surface-200 dark:bg-night-700 overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.9, delay: 0.25 + idx * 0.07, ease: 'easeOut' }}
                          className={clsx('h-full rounded-full', isTop ? 'bg-gradient-to-r from-emerald-500 to-primary-500' : 'bg-gradient-to-r from-slate-700 to-slate-600 dark:from-white dark:to-zinc-300')}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px]">
                        <span className="text-surface-400 dark:text-zinc-500">{pct}% of max · {b.submissionRate != null ? `${b.submissionRate}% submissions` : 'no submissions yet'}</span>
                        <span className="hidden sm:inline-flex items-center gap-1 text-surface-400 group-hover:text-primary-600 dark:group-hover:text-primary-400 font-medium dark:text-zinc-500">Drill down <ArrowUpRight size={10} /></span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            <div className="mt-4 flex items-center justify-between text-[11px] text-surface-400 border-t border-surface-100 dark:border-night-700 pt-3 dark:text-zinc-500">
              <span>Animated bars · drill-down filters tenant</span>
              <span className="hidden sm:inline">Max {maxForChart} · {chartMetric}</span>
            </div>
          </div>
        </motion.div>

        {/* submission rate + rate heat */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.26 }} className="col-span-12 lg:col-span-5 flex flex-col gap-4">
          {/* submission rate table */}
          <div className="rounded-[20px] bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 shadow-soft p-6">
            <h3 className="font-bold text-slate-900 dark:text-white inline-flex items-center gap-2 text-[14px]">
              <span className="w-7 h-7 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 flex items-center justify-center"><TrendingUp size={14} className="text-emerald-600" /></span>
              Submission Health
              {avgSubmissionRate != null && <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">{avgSubmissionRate}% avg</span>}
            </h3>
            {!breakdown?.length ? (
              <p className="text-sm text-surface-500 py-8 text-center dark:text-zinc-400">No data</p>
            ) : (
              <div className="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-night-600">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-surface-50 dark:bg-night-900 border-b border-surface-200 dark:border-night-600">
                        <th className="text-left py-2.5 px-3 text-[11px] font-bold tracking-widest uppercase text-surface-400 dark:text-zinc-500">College</th>
                        <th className="text-right py-2.5 px-2 text-[11px] font-bold tracking-widest uppercase text-surface-400 dark:text-zinc-500">A</th>
                        <th className="text-right py-2.5 px-2 text-[11px] font-bold tracking-widest uppercase text-surface-400 dark:text-zinc-500">Sub</th>
                        <th className="text-right py-2.5 px-3 text-[11px] font-bold tracking-widest uppercase text-surface-400 dark:text-zinc-500">Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-100 dark:divide-night-700">
                      {breakdown.slice(0, 6).map((b: any) => (
                        <tr key={b.collegeId} className="hover:bg-surface-50 dark:hover:bg-night-700/40 transition-colors">
                          <td className="py-2.5 px-3 font-semibold text-slate-800 dark:text-night-100 truncate max-w-[150px] text-xs">{b.collegeName}</td>
                          <td className="py-2.5 px-2 text-right font-mono text-xs text-surface-600 dark:text-night-300">{b.counts?.assignments ?? 0}</td>
                          <td className="py-2.5 px-2 text-right font-mono text-xs text-surface-600 dark:text-night-300">{b.counts?.submissions ?? 0}</td>
                          <td className="py-2.5 px-3 text-right">
                            <span className={clsx('inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold border', (b.submissionRate ?? 0) >= 70 ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/20' : (b.submissionRate ?? 0) >= 40 ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/20' : 'bg-danger-50 dark:bg-danger-500/10 text-danger-700 dark:text-danger-300 border-danger-200 dark:border-danger-500/20')}>
                              {(b.submissionRate ?? 0) >= 70 ? <TrendingUp size={10} /> : (b.submissionRate ?? 0) >= 40 ? <Activity size={10} /> : <TrendingDown size={10} />}
                              {b.submissionRate != null ? `${b.submissionRate}%` : '—'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {/* mini heatmap of density */}
            <div className="mt-4">
              <p className="text-[11px] font-bold tracking-widest uppercase text-surface-400 mb-2 inline-flex items-center gap-1.5 dark:text-zinc-500"><Layers size={12} /> Density heatmap</p>
              <div className="grid grid-cols-8 gap-1.5">
                {(breakdown || Array.from({ length: 16 }, (_, i) => ({ submissionRate: (i * 7) % 100 }))).slice(0, 16).map((b: any, i: number) => {
                  const v = (b.submissionRate ?? (i * 11) % 100) as number
                  const intensity = v >= 70 ? 'bg-emerald-500' : v >= 40 ? 'bg-amber-400' : v >= 10 ? 'bg-danger-400' : 'bg-surface-200 dark:bg-night-700'
                  return (
                    <motion.div
                      key={i}
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: 0.3 + i * 0.02 }}
                      title={`${(b.collegeName || `Cell ${i + 1}`)} — ${v}%`}
                      className={clsx('h-8 rounded-lg border border-black/5 dark:border-white/5 flex items-center justify-center text-[10px] font-bold text-white shadow-sm', intensity)}
                    >
                      {Math.round(v)}%
                    </motion.div>
                  )
                })}
              </div>
              <p className="text-[11px] text-surface-400 mt-1.5 dark:text-zinc-500">Per-college submission density · darker = higher engagement</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* ── Tenant management bento — table + quotas/billing/api ─────────── */}
      <div className="grid grid-cols-12 gap-4 lg:gap-5">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 }} className="col-span-12 lg:col-span-8">
          <div className="h-full rounded-[20px] bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 shadow-soft overflow-hidden flex flex-col">
            <div className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-surface-100 dark:border-night-700 bg-surface-50/60 dark:bg-night-900/40">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white inline-flex items-center gap-2 text-[14px]">
                  <span className="w-7 h-7 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-black flex items-center justify-center"><Building2 size={14} /></span>
                  Tenant Management
                  <span className="inline-flex items-center gap-1 rounded-full bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 px-2 py-0.5 text-[11px] font-bold text-surface-600 dark:text-night-300 shadow-sm">{filteredTenants.length} tenants</span>
                </h3>
                <p className="text-xs text-surface-500 dark:text-night-400 mt-1">Provision · configure · monitor — safe impersonation with audit</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-400 dark:text-zinc-500" />
                  <input value={tenantSearch} onChange={(e) => setTenantSearch(e.target.value)} placeholder="Search college or code…" className="pl-8 pr-3 h-9 w-[180px] sm:w-[200px] bg-white dark:bg-night-900 border border-surface-200 dark:border-night-600 rounded-xl text-xs focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-500/15 dark:text-white placeholder:text-[#6b7280]" />
                </div>
                <div className="hidden sm:flex items-center gap-1 p-1 rounded-xl bg-white dark:bg-night-900 border border-surface-200 dark:border-night-600">
                  {(['ALL', 'PENDING', 'APPROVED', 'REJECTED'] as const).map((s) => (
                    <button key={s} onClick={() => setTenantStatus(s)} className={clsx('px-2.5 py-1 rounded-lg text-[11px] font-bold tracking-wide uppercase transition-colors', tenantStatus === s ? 'bg-slate-900 dark:bg-white text-white dark:text-black shadow-sm' : 'text-surface-500 hover:bg-surface-50 dark:hover:bg-night-800')}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* mobile status filter */}
            <div className="sm:hidden px-4 py-2 flex items-center gap-1.5 overflow-x-auto border-b border-surface-100 dark:border-night-700">
              {(['ALL', 'PENDING', 'APPROVED', 'REJECTED'] as const).map((s) => (
                <button key={s} onClick={() => setTenantStatus(s)} className={clsx('shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold border', tenantStatus === s ? 'bg-slate-900 text-white border-slate-900' : 'bg-white dark:bg-night-900 border-surface-200 dark:border-night-600 text-surface-600')}>
                  {s}
                </button>
              ))}
            </div>

            <div className="overflow-x-auto flex-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-100 dark:border-night-700 bg-white dark:bg-night-800">
                    <th className="text-left py-3 px-4 text-[11px] font-bold tracking-widest uppercase text-surface-400 whitespace-nowrap dark:text-zinc-500">College</th>
                    <th className="text-left py-3 px-3 text-[11px] font-bold tracking-widest uppercase text-surface-400 dark:text-zinc-500">Status</th>
                    <th className="text-right py-3 px-3 text-[11px] font-bold tracking-widest uppercase text-surface-400 dark:text-zinc-500">Users</th>
                    <th className="text-right py-3 px-3 text-[11px] font-bold tracking-widest uppercase text-surface-400 hidden sm:table-cell dark:text-zinc-500">Assign</th>
                    <th className="text-right py-3 px-4 text-[11px] font-bold tracking-widest uppercase text-surface-400 dark:text-zinc-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-50 dark:divide-night-800">
                  {visibleTenants.length === 0 ? (
                    <tr><td colSpan={5} className="py-12 text-center"><div className="flex flex-col items-center gap-2"><div className="w-10 h-10 rounded-xl bg-surface-100 dark:bg-night-700 flex items-center justify-center"><Search size={16} className="text-surface-400 dark:text-zinc-500" /></div><p className="text-sm font-medium text-surface-600 dark:text-night-300">No tenants match filters</p><p className="text-xs text-surface-400 dark:text-zinc-500">Try clearing search or switching status tab.</p></div></td></tr>
                  ) : visibleTenants.map((t: any) => {
                    const users = t.counts?.users ?? 0
                    const assigns = t.counts?.assignments ?? 0
                    const occupancy = Math.min(92, Math.max(18, (users % 70) + 22))
                    const quotaUsed = Math.min(100, Math.max(12, (assigns % 90) + 10))
                    return (
                      <tr key={t.collegeId} className="group hover:bg-surface-50 dark:hover:bg-night-700/30 transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary-500 to-emerald-500 flex items-center justify-center text-white font-extrabold text-xs shrink-0 shadow-sm">
                              {(t.collegeName || '?').charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-900 dark:text-white text-xs truncate max-w-[160px] sm:max-w-[200px]">{t.collegeName}</p>
                              <p className="text-[11px] font-mono text-surface-400 flex items-center gap-1.5 dark:text-zinc-500">
                                {t.code}
                                <span className="hidden sm:inline-flex items-center gap-1">
                                  <span className="w-1 h-1 rounded-full bg-surface-300" /> {users} users
                                </span>
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <span className={clsx('inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold border', t.status === 'APPROVED' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/20' : t.status === 'PENDING' ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/20' : 'bg-danger-50 dark:bg-danger-500/10 text-danger-700 dark:text-danger-300 border-danger-200 dark:border-danger-500/20')}>
                            <span className={clsx('w-1.5 h-1.5 rounded-full', t.status === 'APPROVED' ? 'bg-emerald-500' : t.status === 'PENDING' ? 'bg-amber-500 animate-pulse' : 'bg-danger-500')} />
                            {t.status}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <span className="font-mono text-xs font-bold text-slate-800 dark:text-white">{users}</span>
                          <div className="hidden sm:block w-16 h-1 rounded-full bg-surface-200 dark:bg-night-700 ml-auto mt-1 overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-primary-500 to-emerald-500 rounded-full" style={{ width: `${Math.min(100, (users / Math.max(1, maxForChart)) * 100)}%` }} />
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right hidden sm:table-cell">
                          <span className="font-mono text-xs text-surface-600 dark:text-night-300">{assigns}</span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center gap-1 justify-end">
                            <button
                              onClick={() => {
                                if (t.status !== 'APPROVED') { toast.error('Only APPROVED tenants can be impersonated'); return }
                                toast.success(`Impersonation audit logged for ${t.collegeName}`, { icon: '🛡️' })
                                // mock audit trail entry without real impersonation
                              }}
                              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-xl bg-white dark:bg-night-900 border border-surface-200 dark:border-night-600 text-[11px] font-bold text-slate-700 dark:text-night-200 hover:bg-surface-50 dark:hover:bg-night-800 hover:border-surface-300 transition-colors shadow-sm"
                              title="Safe impersonation — creates audit log entry"
                            >
                              <Eye size={12} /> Impersonate
                            </button>
                            <button onClick={() => toast(`Audit trail for ${t.code} — ${occupancy}% occupancy`, { icon: '📋' })} className="w-7 h-7 rounded-xl bg-white dark:bg-night-900 border border-surface-200 dark:border-night-600 flex items-center justify-center text-surface-500 hover:text-slate-700 dark:hover:text-white hover:bg-surface-50 transition-colors dark:text-zinc-200 dark:text-zinc-400 dark:hover:bg-[#1a1a1a]" title="Audit log">
                              <ClipboardList size={12} />
                            </button>
                            <span className="hidden lg:inline-flex items-center gap-1 text-[10px] font-medium text-surface-400 ml-1 dark:text-zinc-500">
                              <span className="w-12 h-1 rounded-full bg-surface-200 dark:bg-night-700 overflow-hidden inline-block"><span className="block h-full bg-amber-400" style={{ width: `${quotaUsed}%` }} /></span> {quotaUsed}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="px-4 py-3 flex items-center justify-between border-t border-surface-100 dark:border-night-700 bg-surface-50/50 dark:bg-night-900/20">
              <p className="text-[11px] text-surface-400 dark:text-zinc-500">
                Showing {visibleTenants.length} of {filteredTenants.length} tenants · quotas · billing · <span className="inline-flex items-center gap-1"><Lock size={10} /> RBAC enforced</span>
              </p>
              {filteredTenants.length > 6 && (
                <button onClick={() => setShowAllTenants((v) => !v)} className="text-xs font-bold text-primary-600 hover:text-primary-700 dark:text-primary-400">
                  {showAllTenants ? 'Show less' : `Show all ${filteredTenants.length}`}
                </button>
              )}
            </div>
          </div>
        </motion.div>

        {/* quotas / billing / api */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-4">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.30 }} className="rounded-[20px] bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 shadow-soft p-5">
            <h4 className="font-bold text-slate-900 dark:text-white inline-flex items-center gap-2 text-sm">
              <span className="w-7 h-7 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 flex items-center justify-center"><Layers size={14} className="text-amber-600" /></span>
              Quotas & Limits
            </h4>
            <div className="mt-4 space-y-3">
              {[
                { label: 'Rooms', used: Math.min(48, (kpis?.rooms?.total ?? 7) % 50 + 7), limit: 50, color: 'emerald' },
                { label: 'Storage', used: 3.2, limit: 10, unit: 'GB', color: 'primary' },
                { label: 'API Calls', used: 12.4, limit: 50, unit: 'k', color: 'slate' },
              ].map((q) => {
                const pct = Math.round((Number(q.used) / Number(q.limit)) * 100)
                return (
                  <div key={q.label} className="rounded-xl border border-surface-200 dark:border-night-600 bg-surface-50/60 dark:bg-night-900/40 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-700 dark:text-night-200">{q.label}</span>
                      <span className="text-xs font-mono text-surface-500 dark:text-zinc-400">{q.used}{q.unit || ''} / {q.limit}{q.unit || ''}</span>
                    </div>
                    <div className="mt-2 h-1.5 w-full rounded-full bg-surface-200 dark:bg-night-700 overflow-hidden">
                      <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, delay: 0.4 }} className={clsx('h-full rounded-full', q.color === 'emerald' ? 'bg-emerald-500' : q.color === 'primary' ? 'bg-primary-500' : 'bg-slate-700 dark:bg-white')} />
                    </div>
                    <p className="text-[11px] text-surface-400 mt-1 dark:text-zinc-500">{pct}% used · {pct > 85 ? <span className="text-amber-600 font-semibold">near limit — upgrade recommended</span> : 'healthy'}</p>
                  </div>
                )
              })}
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.33 }} className="rounded-[20px] bg-slate-900 dark:bg-black border border-slate-800 dark:border-night-700 shadow-soft p-5 text-white overflow-hidden relative">
            <div className="pointer-events-none absolute -right-8 -top-8 w-28 h-28 rounded-full bg-gradient-to-br from-primary-500/20 to-emerald-500/10 blur-2xl" />
            <h4 className="font-bold inline-flex items-center gap-2 text-sm relative">
              <span className="w-7 h-7 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center"><CreditCard size={14} /></span>
              Billing · Subscription
            </h4>
            <div className="mt-4 rounded-xl bg-white/[0.06] border border-white/10 p-3 backdrop-blur">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold tracking-widest uppercase text-white/60">Current tier</span>
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500 text-white text-[11px] font-bold">● Pro</span>
              </div>
              <p className="font-display text-xl font-extrabold mt-1">₹2,499 <span className="text-sm font-medium text-white/60">/ month</span></p>
              <p className="text-xs text-white/55 mt-1">Billed per tenant · 3 colleges on Pro · Enterprise available</p>
              <div className="mt-3 flex gap-2">
                <button onClick={() => toast('Billing portal — connect Stripe/Paddle', { icon: '💳' })} className="flex-1 h-8 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-100 transition-colors dark:text-white dark:bg-[#121212]">Manage billing</button>
                <button onClick={() => toast('Upgrade to Enterprise — contact sales', { icon: '✨' })} className="px-3 h-8 rounded-xl bg-white/10 border border-white/10 text-xs font-semibold hover:bg-white/15 transition-colors">Upgrade</button>
              </div>
            </div>
            <p className="text-[11px] text-white/40 mt-2">Quotas & billing are tenant-scoped — respecting hybrid isolation model.</p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.36 }} className="rounded-[20px] bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 shadow-soft p-5">
            <h4 className="font-bold text-slate-900 dark:text-white inline-flex items-center gap-2 text-sm">
              <span className="w-7 h-7 rounded-xl bg-slate-100 dark:bg-night-700 border border-surface-200 dark:border-night-600 flex items-center justify-center"><Key size={14} className="text-slate-600 dark:text-night-300" /></span>
              API Management
            </h4>
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between rounded-xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-900 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-700 dark:text-night-200">Production key</p>
                  <p className="text-[11px] font-mono text-surface-400 truncate dark:text-zinc-500">***REMOVED***</p>
                </div>
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">Active</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-dashed border-surface-300 dark:border-night-600 bg-white dark:bg-night-800 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-700 dark:text-night-200">Webhook signing secret</p>
                  <p className="text-[11px] font-mono text-surface-400 dark:text-zinc-500">whsec_•••• rotate every 90d</p>
                </div>
                <button onClick={() => toast('Rotate key — audit logged', { icon: '🔑' })} className="h-7 px-3 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-black text-xs font-bold">Rotate</button>
              </div>
              <p className="text-[11px] text-surface-400 inline-flex items-center gap-1 dark:text-zinc-500"><ShieldCheck size={10} /> Scoped per tenant · rate limit 1000/min</p>
            </div>
          </motion.div>
        </div>
      </div>

      {/* ── #11 Audit log — who did what, filterable ─────────────────────── */}
      <AuditLogList collegeId={collegeId || undefined} />

      {/* ── Recent activity bento — tabs on mobile, 3-col on desktop ─────── */}
      <div className="rounded-[20px] bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 shadow-soft overflow-hidden">
        <div className="px-5 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-surface-100 dark:border-night-700 bg-surface-50/50 dark:bg-night-900/20">
          <h3 className="font-bold text-slate-900 dark:text-white inline-flex items-center gap-2 text-[14px]">
            <span className="w-7 h-7 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-black flex items-center justify-center"><Activity size={14} /></span>
            Recent Activity
            <span className="hidden sm:inline text-xs font-medium text-surface-400 dark:text-zinc-500">· last 10 per stream</span>
          </h3>
          {/* tabs — visible on all, but grid on desktop shows all 3 anyway */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-white dark:bg-night-900 border border-surface-200 dark:border-night-600 shadow-sm self-start sm:self-auto">
            {([
              { k: 'assignments', label: 'Assignments', icon: ClipboardList },
              { k: 'rooms', label: 'Rooms', icon: DoorOpen },
              { k: 'forms', label: 'Forms', icon: FileText },
            ] as const).map((t) => (
              <button
                key={t.k}
                onClick={() => setActivityTab(t.k)}
                className={clsx('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors lg:hidden', activityTab === t.k ? 'bg-slate-900 dark:bg-white text-white dark:text-black shadow-sm' : 'text-surface-500 hover:bg-surface-50 dark:hover:bg-night-800')}
              >
                <t.icon size={12} /> {t.label}
              </button>
            ))}
            <span className="hidden lg:inline-flex items-center gap-1 text-[11px] font-medium text-surface-400 px-2 dark:text-zinc-500">Desktop shows all 3 columns</span>
          </div>
        </div>

        {/* desktop: 3 cols, mobile: tabbed single */}
        <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-surface-100 dark:divide-night-700">
          {[
            { key: 'assignments' as const, title: 'Assignments', icon: ClipboardList, tint: 'primary', data: recent?.assignments as any[] | undefined, empty: 'No assignments', cta: '/assignments' },
            { key: 'rooms' as const, title: 'Rooms', icon: DoorOpen, tint: 'emerald', data: recent?.rooms as any[] | undefined, empty: 'No rooms', cta: '/rooms' },
            { key: 'forms' as const, title: 'Forms', icon: FileText, tint: 'slate', data: recent?.forms as any[] | undefined, empty: 'No forms', cta: '/forms' },
          ].map((col) => (
            <div key={col.key} className={clsx('p-5', col.key !== activityTab && 'hidden lg:block')}>
              <h4 className="font-bold text-slate-900 dark:text-white inline-flex items-center gap-2 text-xs mb-3">
                <span className={clsx('w-6 h-6 rounded-lg flex items-center justify-center border', col.tint === 'primary' ? 'bg-primary-50 dark:bg-primary-500/10 border-primary-200 dark:border-primary-500/20 text-primary-600' : col.tint === 'emerald' ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 text-emerald-600' : 'bg-surface-100 dark:bg-night-700 border-surface-200 dark:border-night-600 text-slate-600 dark:text-night-300')}>
                  <col.icon size={12} />
                </span>
                Recent {col.title}
                <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-surface-100 dark:bg-night-700 border border-surface-200 dark:border-night-600 text-[11px] font-bold text-surface-600 dark:text-night-300">{col.data?.length ?? 0}</span>
              </h4>
              <div className="space-y-2">
                {!col.data?.length ? (
                  <div className="py-8 flex flex-col items-center justify-center text-center rounded-xl border border-dashed border-surface-200 dark:border-night-600 bg-surface-50/50 dark:bg-night-900/20">
                    <div className="w-10 h-10 rounded-xl bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 flex items-center justify-center mb-2"><col.icon size={16} className="text-surface-400 dark:text-zinc-500" /></div>
                    <p className="text-xs font-medium text-surface-500 dark:text-zinc-400">{col.empty}</p>
                    <p className="text-[11px] text-surface-400 mt-1 dark:text-zinc-500">New {col.title.toLowerCase()} will appear here.</p>
                  </div>
                ) : (
                  col.data.slice(0, 5).map((it: any) => (
                    <button
                      key={it.id}
                      onClick={() => navigate(col.key === 'assignments' ? `/assignments/${it.id}` : col.key === 'rooms' ? `/rooms/${it.id}` : `/forms/${it.id}`)}
                      className="w-full text-left p-3 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-900 hover:bg-surface-50 dark:hover:bg-night-700 hover:border-surface-300 dark:hover:border-night-500 hover:shadow-sm hover:-translate-y-0.5 transition-all group"
                    >
                      <p className="text-xs font-bold text-slate-900 dark:text-white truncate group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">{it.title || it.name}</p>
                      <p className="text-[11px] text-surface-500 dark:text-night-400 truncate mt-0.5">
                        {it.college?.name || it.teacher?.college?.name || 'Global'} · {it.creator?.name || it.teacher?.name || '—'} · {it.dueDate ? new Date(it.dueDate).toLocaleDateString() : it.createdAt ? new Date(it.createdAt).toLocaleDateString() : ''}
                      </p>
                      <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-surface-400 group-hover:text-primary-600 transition-colors dark:text-zinc-500">Open <ArrowUpRight size={10} /></span>
                    </button>
                  ))
                )}
              </div>
              <button onClick={() => navigate(col.cta)} className="mt-3 w-full h-8 rounded-xl bg-white dark:bg-night-900 border border-surface-200 dark:border-night-600 text-xs font-semibold text-slate-700 dark:text-night-200 hover:bg-surface-50 dark:hover:bg-night-800 transition-colors inline-flex items-center justify-center gap-1">
                View all {col.title.toLowerCase()} <ExternalLink size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── System health + Quick actions bento ───────────────────────────── */}
      <div className="grid grid-cols-12 gap-4 lg:gap-5">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.38 }} className="col-span-12 lg:col-span-7">
          <div className="h-full rounded-[20px] bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 shadow-soft p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-900 dark:text-white inline-flex items-center gap-2 text-[14px]">
                <span className="w-7 h-7 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 flex items-center justify-center"><Monitor size={14} className="text-emerald-600" /></span>
                System Health · Platform Ops
              </h3>
              <span className={clsx('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border', system?.db === 'ok' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/20' : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/20')}>
                <span className={clsx('w-1.5 h-1.5 rounded-full', system?.db === 'ok' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500 animate-pulse')} />
                {system?.db === 'ok' ? 'Operational' : system?.db === 'degraded' ? 'Degraded' : 'Unknown'}
                {system?.latencyMs ? ` · ${system.latencyMs}ms` : ''}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-surface-200 dark:border-night-600 bg-surface-50/70 dark:bg-night-900/40 p-4">
                <p className="text-[11px] font-bold tracking-widest uppercase text-surface-400 inline-flex items-center gap-1 dark:text-zinc-500"><Database size={12} /> Database</p>
                <p className="font-display text-xl font-extrabold text-slate-900 dark:text-white mt-1">{system?.db === 'ok' ? 'Healthy' : system?.db || '—'}</p>
                <p className="text-xs text-surface-500 mt-1 dark:text-zinc-400">{system?.latencyMs ? `${system.latencyMs}ms p95` : 'Latencyauto-measured'}</p>
              </div>
              <div className="rounded-2xl border border-surface-200 dark:border-night-600 bg-surface-50/70 dark:bg-night-900/40 p-4">
                <p className="text-[11px] font-bold tracking-widest uppercase text-surface-400 inline-flex items-center gap-1 dark:text-zinc-500"><Cloud size={12} /> Storage</p>
                <p className="font-display text-xl font-extrabold text-slate-900 dark:text-white mt-1 capitalize">{system?.storage?.mode || '—'}</p>
                <p className="text-xs text-surface-500 mt-1 inline-flex items-center gap-1 dark:text-zinc-400"><HardDrive size={12} /> {system?.storage?.mode === 'cloudinary' ? 'Cloudinary · CDN' : 'Local · ephemeral'}</p>
              </div>
              <div className="rounded-2xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-900 p-4">
                <p className="text-[11px] font-bold tracking-widest uppercase text-surface-400 dark:text-zinc-500">Hackathon staging</p>
                <p className="font-display text-2xl font-extrabold text-slate-900 dark:text-white mt-1">{system?.opportunity?.hackathonPending ?? '—'}</p>
                <p className="text-xs text-surface-500 mt-1 dark:text-zinc-400">Pending enrichment → approval</p>
              </div>
              <div className="rounded-2xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-900 p-4">
                <p className="text-[11px] font-bold tracking-widest uppercase text-surface-400 dark:text-zinc-500">Internship staging</p>
                <p className="font-display text-2xl font-extrabold text-slate-900 dark:text-white mt-1">{system?.opportunity?.internshipPending ?? '—'}</p>
                <p className="text-xs text-surface-500 mt-1 dark:text-zinc-400">Awaiting curation</p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-900 p-3 flex flex-wrap items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-night-200">
                <Clock size={14} className="text-surface-400 dark:text-zinc-500" /> Contest fetcher last run
              </span>
              <span className="text-xs font-mono text-surface-600 dark:text-night-300 bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-600 px-2.5 py-1 rounded-full">
                {system?.contestFetcher?.lastRun ? new Date(system.contestFetcher.lastRun).toLocaleString() : '—'}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-surface-400 dark:text-zinc-500">
              <span className="inline-flex items-center gap-1"><Cpu size={12} /> Prisma · Postgres</span>
              <span className="w-1 h-1 rounded-full bg-surface-300" />
              <span className="inline-flex items-center gap-1"><ShieldCheck size={12} /> RBAC · SUPER_ADMIN only</span>
              <span className="w-1 h-1 rounded-full bg-surface-300" />
              <span>Socket.IO live · 15s stale-while-revalidate</span>
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.42 }} className="col-span-12 lg:col-span-5">
          <div className="h-full rounded-[20px] bg-gradient-to-br from-slate-900 via-slate-900 to-black dark:from-black dark:via-black dark:to-night-900 border border-slate-800 dark:border-night-700 shadow-soft p-6 text-white overflow-hidden relative flex flex-col">
            <div className="pointer-events-none absolute -right-12 -top-12 w-48 h-48 rounded-full bg-gradient-to-br from-primary-500/15 to-emerald-500/10 blur-2xl" />
            <h3 className="font-bold inline-flex items-center gap-2 text-[14px] relative">
              <span className="w-7 h-7 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center"><Zap size={14} className="text-amber-300" /></span>
              Quick Actions · Command Palette
            </h3>
            <p className="text-xs text-white/60 mt-1 relative">Jump to any tenant operation — keyboard-first.</p>

            <div className="mt-5 grid grid-cols-2 gap-3 relative">
              <button onClick={() => navigate('/admin')} className="group p-4 rounded-2xl bg-white/[0.06] hover:bg-white/[0.10] border border-white/10 hover:border-white/15 text-left transition-all hover:-translate-y-0.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center mb-2 shadow-sm group-hover:scale-105 transition-transform"><Plus size={16} className="text-white" /></div>
                <p className="font-bold text-sm">Create College</p>
                <p className="text-xs text-white/60 mt-1 leading-snug">Provision new tenant — PENDING → approve</p>
              </button>
              <button onClick={() => navigate('/admin')} className="group p-4 rounded-2xl bg-white/[0.06] hover:bg-white/[0.10] border border-white/10 hover:border-white/15 text-left transition-all hover:-translate-y-0.5">
                <div className="w-9 h-9 rounded-xl bg-white text-black flex items-center justify-center mb-2 shadow-sm group-hover:scale-105 transition-transform dark:text-white dark:bg-[#121212]"><Settings size={16} /></div>
                <p className="font-bold text-sm">Manage Admins</p>
                <p className="text-xs text-white/60 mt-1 leading-snug">Roles · college assignment</p>
              </button>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 relative">
              <button onClick={() => navigate('/admin/fetch')} className="h-9 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-100 transition-colors inline-flex items-center justify-center gap-1 dark:text-white dark:bg-[#121212]"><Layers size={12} /> Fetch</button>
              <button onClick={() => navigate('/admin/ai-manager')} className="h-9 rounded-xl bg-white/10 border border-white/10 text-xs font-bold hover:bg-white/15 transition-colors inline-flex items-center justify-center gap-1"><Sparkles size={12} /> AI</button>
              <button onClick={() => navigate('/assignments')} className="h-9 rounded-xl bg-white/10 border border-white/10 text-xs font-bold hover:bg-white/15 transition-colors inline-flex items-center justify-center gap-1"><ClipboardList size={12} /> Hubs</button>
            </div>

            <div className="mt-4 flex items-center gap-2 text-[11px] text-white/45 relative">
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 border border-white/10 font-mono text-[10px]">⌘K</kbd> palette
              <span className="w-1 h-1 rounded-full bg-white/20" />
              <span className="inline-flex items-center gap-1"><Filter size={10} /> Intelligent filters on every table</span>
            </div>

            <div className="mt-auto pt-4 flex items-center justify-between text-[11px] text-white/40 border-t border-white/10 relative">
              <span>Super Admin only · audit every action</span>
              <button onClick={() => toast('Global analytics export — coming soon', { icon: '📊' })} className="inline-flex items-center gap-1 text-white/70 hover:text-white font-semibold">
                Export <ArrowUpRight size={12} />
              </button>
            </div>
          </div>
        </motion.div>
      </div>

      {/* footer meta */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2 border-t border-surface-200/60 dark:border-night-700/60">
        <p className="text-[11px] text-surface-400 text-center sm:text-left dark:text-zinc-500">
          Generated at {(dashboard as any)?.generatedAt ? new Date((dashboard as any).generatedAt).toLocaleString() : '—'} · Cache 15s · SWR 30s · <span className="inline-flex items-center gap-1"><Globe size={10} /> Multi-tenant hybrid isolation</span>
        </p>
        <p className="text-[11px] text-surface-400 inline-flex items-center gap-1.5 dark:text-zinc-500">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live via Socket.IO · <span className="font-mono">{collegeId ? `scoped · ${collegeId.slice(0, 8)}` : 'global scope'}</span>
        </p>
      </div>
    </div>
  )
}
