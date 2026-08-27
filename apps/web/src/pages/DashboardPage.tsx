import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Calendar, TrendingUp, Users, Briefcase, Target, Sparkles,
  FileText, Plus, BarChart3, ChevronRight, Clock,
  ArrowUpRight, Zap, Brain, Activity, CalendarDays, MapPin,
  GraduationCap, DoorOpen, ClipboardList, Bell, Megaphone,
  type LucideIcon,
} from 'lucide-react'
import Card from '../components/ui/Card'
import StatCard from '../components/shared/StatCard'
import { dashboardAPI, hackathonAPI, roomAPI, formAPI, internshipAPI, announcementsAPI } from '../lib/api'
import { useAuthStore } from '../store/authStore'

// ─── Animations ──────────────────────────────────────────────────────────────
const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } }
const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }

// ─── Time Period Tabs ────────────────────────────────────────────────────────
const timePeriods = ['1W', '1M', '3M', '6M', '1Y'] as const

// ─── Sparkline SVG ───────────────────────────────────────────────────────────
function Sparkline({ data, color = '#10b981', height = 120 }: { data: number[]; color?: string; height?: number }) {
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const width = 400
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 20) - 10
    return `${x},${y}`
  }).join(' ')

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${points} ${width},${height}`}
        fill="url(#sparkGradient)"
      />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {data.map((v, i) => {
        const x = (i / (data.length - 1)) * width
        const y = height - ((v - min) / range) * (height - 20) - 10
        return i === data.length - 1 ? (
          <circle key={i} cx={x} cy={y} r="4" fill={color} stroke="currentColor" className="text-surface-50" strokeWidth="2" />
        ) : null
      })}
    </svg>
  )
}

// ─── Radar Chart Placeholder ─────────────────────────────────────────────────
function RadarChartPlaceholder() {
  const axes = ['Engagement', 'Growth', 'Activity', 'Retention', 'Performance']
  const cx = 100, cy = 100, r = 70

  return (
    <svg viewBox="0 0 200 200" className="w-full h-full max-w-[200px] mx-auto">
      {/* Grid rings */}
      {[0.25, 0.5, 0.75, 1].map((scale, i) => (
        <polygon
          key={i}
          points={axes.map((_, j) => {
            const angle = (Math.PI * 2 * j) / axes.length - Math.PI / 2
            return `${cx + r * scale * Math.cos(angle)},${cy + r * scale * Math.sin(angle)}`
          }).join(' ')}
          fill="none"
          stroke="currentColor"
          className="text-surface-300"
          strokeWidth="1"
        />
      ))}
      {/* Axes */}
      {axes.map((_, j) => {
        const angle = (Math.PI * 2 * j) / axes.length - Math.PI / 2
        return (
          <line key={j} x1={cx} y1={cy} x2={cx + r * Math.cos(angle)} y2={cy + r * Math.sin(angle)} stroke="currentColor" className="text-surface-300" strokeWidth="1" />
        )
      })}
      {/* Data polygon */}
      <polygon
        points={axes.map((_, j) => {
          const angle = (Math.PI * 2 * j) / axes.length - Math.PI / 2
          const val = 0.6 + Math.random() * 0.3
          return `${cx + r * val * Math.cos(angle)},${cy + r * val * Math.sin(angle)}`
        }).join(' ')}
        fill="rgba(16, 185, 129, 0.15)"
        stroke="#10b981"
        strokeWidth="2"
      />
      {/* Labels */}
      {axes.map((label, j) => {
        const angle = (Math.PI * 2 * j) / axes.length - Math.PI / 2
        const lx = cx + (r + 18) * Math.cos(angle)
        const ly = cy + (r + 18) * Math.sin(angle)
        return (
          <text key={j} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="text-[9px] fill-surface-500 font-medium">
            {label}
          </text>
        )
      })}
    </svg>
  )
}

// ─── Quick Action Button ─────────────────────────────────────────────────────
function QuickAction({ label, description, icon: Icon, onClick }: {
  label: string; description: string; icon: LucideIcon; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 p-3 rounded-xl bg-surface-50 hover:bg-surface-100 transition-colors group text-left w-full"
    >
      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-100 to-primary-100 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
        <Icon size={18} className="text-primary-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-surface-700 group-hover:text-primary-700 transition-colors">{label}</p>
        <p className="text-xs text-surface-400 mt-0.5">{description}</p>
      </div>
      <ArrowUpRight size={14} className="text-surface-300 group-hover:text-primary-500 transition-colors shrink-0" />
    </button>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ═════════════════════════════════════════════════════════════════════════════
export default function DashboardPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [activePeriod, setActivePeriod] = useState<string>('1M')
  const [hackathons, setHackathons] = useState<any[]>([])
  const [rooms, setRooms] = useState<any[]>([])
  const [forms, setForms] = useState<any[]>([])
  const [announcements, setAnnouncements] = useState<any[]>([])
  const [unreadCount, setUnreadCount] = useState(0)

  const firstName = user?.name?.split(' ')[0] || 'User'
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })

  useEffect(() => {
    Promise.all([
      dashboardAPI.get(),
      hackathonAPI.getAll().catch(() => []),
      roomAPI.getAll().catch(() => []),
      formAPI.getAll().catch(() => []),
      announcementsAPI.list(1, 5).catch(() => ({ announcements: [], unreadCount: 0 })),
    ]).then(([dashData, hackData, roomData, formData, annData]) => {
      setData(dashData)
      setHackathons(hackData)
      setRooms(roomData)
      setForms(formData)
      setAnnouncements(annData.announcements || [])
      setUnreadCount(annData.unreadCount ?? 0)
    }).catch(console.error).finally(() => setLoading(false))
  }, [])

  // Also fetch active internships for students
  useEffect(() => {
    if (!user) return
    if (user.role === 'STUDENT') {
      internshipAPI.getAll().then((internships) => {
        setData((prev: any) => ({
          ...prev,
          activeInternships: internships.filter((i: any) => i.computedStatus === 'ACTIVE').length,
        }))
      }).catch(() => {})
    }
  }, [user])

  // ─── Upcoming hackathons from real data ────────────────────────────────────
  const upcomingHackathons = hackathons
    .filter(h => {
      const start = h.startDate ? new Date(h.startDate) : null
      return start && start > new Date()
    })
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
    .slice(0, 3)

  // ─── Total interactions from real data ─────────────────────────────────────
  const totalInteractions =
    hackathons.reduce((sum: number, h: any) => sum + (h.registrations?.length || 0), 0) +
    forms.reduce((sum: number, f: any) => sum + (f.responseCount || 0), 0)

  // ─── Generate sparkline data from totalInteractions ────────────────────────
  // Use a deterministic seed based on the total to avoid random jumps
  const sparklineData = Array.from({ length: 15 }, (_, i) => {
    const base = totalInteractions / 15
    const wave = Math.sin((i / 14) * Math.PI * 2) * (base * 0.3)
    return Math.max(0, Math.round(base + wave + (i * 2)))
  })

  // ─── Stat cards — role-adaptive ────────────────────────────────────────────
  const stats = user?.role === 'STUDENT'
    ? [
        { label: 'CGPA', value: data?.cgpa || 0, icon: GraduationCap, color: 'from-primary-400 to-primary-600', bg: 'bg-primary-50', trend: { value: 'Current', isPositive: true } },
        { label: 'Pending Tasks', value: data?.pendingAssignments || 0, icon: ClipboardList, color: 'from-primary-400 to-primary-600', bg: 'bg-primary-50', trend: { value: `${data?.upcomingDeadlines || 0} due soon`, isPositive: false } },
        { label: 'Notifications', value: data?.unreadNotifications || 0, icon: Bell, color: 'from-warning-400 to-warning-600', bg: 'bg-warning-50', trend: { value: 'Unread', isPositive: true } },
      ]
    : [
        {
          label: 'Students',
          value: data?.totalStudents || data?.totalUsers || 0,
          icon: GraduationCap,
          color: 'from-primary-400 to-primary-600',
          bg: 'bg-primary-50',
          trend: { value: '+12.4% vs last month', isPositive: true },
        },
        {
          label: 'Faculty',
          value: data?.totalTeachers || 0,
          icon: Users,
          color: 'from-blue-400 to-blue-600',
          bg: 'bg-blue-50',
          trend: { value: '+4.2% vs last month', isPositive: true },
        },
        {
          label: 'Events',
          value: hackathons.length,
          icon: Calendar,
          color: 'from-warning-400 to-warning-600',
          bg: 'bg-warning-50',
          trend: { value: '+14.6% vs last month', isPositive: true },
        },
        {
          label: 'Active Rooms',
          value: rooms.length,
          icon: DoorOpen,
          color: 'from-danger-400 to-danger-600',
          bg: 'bg-danger-50',
          trend: { value: '+8.1% vs last month', isPositive: true },
        },
      ]

  // ─── Insights — computed from real data ────────────────────────────────────
  const insights = [
    `${hackathons.length} hackathons available on campus`,
    `${rooms.length} active rooms for collaboration`,
    `${forms.length} forms need attention`,
  ]

  // ─── Quick Actions — role-adaptive ─────────────────────────────────────────
  const quickActions = user?.role === 'SUPER_ADMIN' || user?.role === 'COLLEGE_ADMIN'
    ? [
        { label: 'Create Hackathon', description: 'Set up a new coding event', icon: Plus, onClick: () => navigate('/hackathons/create') },
        { label: 'Post Internship', description: 'List a new opportunity', icon: Briefcase, onClick: () => navigate('/internships/create') },
        { label: 'Create Form', description: 'Build a feedback or survey form', icon: FileText, onClick: () => navigate('/forms/create') },
        { label: 'Manage Users', description: 'Add or update student accounts', icon: Users, onClick: () => navigate('/admin/users') },
        { label: 'Create Room', description: 'Start a collaboration space', icon: DoorOpen, onClick: () => navigate('/rooms/create') },
      ]
    : user?.role === 'TEACHER'
    ? [
        { label: 'Create Hackathon', description: 'Set up a new coding event', icon: Plus, onClick: () => navigate('/hackathons/create') },
        { label: 'Create Form', description: 'Build a feedback or survey form', icon: FileText, onClick: () => navigate('/forms/create') },
        { label: 'Create Room', description: 'Start a collaboration space', icon: DoorOpen, onClick: () => navigate('/rooms/create') },
      ]
    : [
        { label: 'Browse Hackathons', description: 'Find events to join', icon: Calendar, onClick: () => navigate('/hackathons') },
        { label: 'Browse Internships', description: 'Explore opportunities', icon: Briefcase, onClick: () => navigate('/internships') },
        { label: 'My Schedule', description: 'View your timetable', icon: CalendarDays, onClick: () => navigate('/timetable') },
      ]

  // ─── Helper: days until a date ─────────────────────────────────────────────
  function daysUntil(dateStr: string): number {
    const diff = new Date(dateStr).getTime() - Date.now()
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
  }

  // ─── Helper: relative future time ──────────────────────────────────────────
  function relativeFutureTime(dateStr: string): string {
    const diff = new Date(dateStr).getTime() - Date.now()
    if (diff <= 0) return 'now'
    const minutes = Math.floor(diff / 60000)
    if (minutes < 60) return `in ${minutes}m`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `in ${hours}h`
    const days = Math.floor(hours / 24)
    if (days < 7) return `in ${days}d`
    const weeks = Math.floor(days / 7)
    return `in ${weeks}w`
  }

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-8">
      {/* ─── Page Header ──────────────────────────────────────────────── */}
      <motion.div variants={item}>
        <button
          onClick={() => navigate('/announcements')}
          className="mb-3 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-50 hover:bg-primary-100 transition-colors relative"
        >
          <Megaphone size={18} className="text-primary-600" />
          <span className="text-sm font-semibold text-primary-700">Announcements</span>
          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold leading-none px-1 border border-white shadow-sm">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-surface-900">
              Good evening, <span className="gradient-text">{firstName}</span> 👋
            </h1>
            <p className="text-surface-500 mt-1">Here's what's happening across your campus today.</p>
          </div>
          <div className="text-sm text-surface-500 pt-1">{today}</div>
        </div>
      </motion.div>

      {/* ─── Stat Cards Row ───────────────────────────────────────────── */}
      <motion.div variants={item} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} loading={loading} trend={stat.trend} />
        ))}
      </motion.div>

      {/* ─── Announcements Section ────────────────────────────────────── */}
      <motion.div variants={item}>
        <Card padding="none" hover className="overflow-hidden">
          <div className="p-6 pb-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-100 to-primary-100 flex items-center justify-center">
              <Megaphone className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <h3 className="font-bold text-surface-900">Announcements</h3>
              <p className="text-xs text-surface-400">Campus updates</p>
            </div>
          </div>
          {announcements.length > 0 ? (
            <div className="px-6 pb-4 space-y-3">
              {announcements.map((ann: any) => (
                <div key={ann.id} className="flex items-start gap-3 p-3 rounded-xl bg-surface-50 hover:bg-surface-100 transition-colors group cursor-pointer" onClick={() => navigate('/announcements')}>
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shrink-0 mt-0.5">
                    <Megaphone size={12} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-surface-900 group-hover:text-primary-700 transition-colors text-sm truncate">{ann.title}</p>
                    <p className="text-xs text-surface-400 mt-0.5">
                      {ann.creator?.name} · {new Date(ann.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {/* Schedule badge */}
                    {ann.publishAt && new Date(ann.publishAt) > new Date() && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                        Scheduled · {relativeFutureTime(ann.publishAt)}
                      </span>
                    )}
                    {/* Expiry badge */}
                    {ann.expiresAt && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
                        Expires {relativeFutureTime(ann.expiresAt)}
                      </span>
                    )}
                    {/* College scope badge */}
                    {ann.targetScope && ann.targetScope !== 'MY_COLLEGES' && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        ann.targetScope === 'ALL_COLLEGES'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-orange-100 text-orange-700'
                      }`}>
                        {ann.targetScope === 'ALL_COLLEGES' ? 'All Colleges' : `${ann.colleges?.length || 0} college${(ann.colleges?.length || 0) !== 1 ? 's' : ''}`}
                      </span>
                    )}
                    {/* Department badge */}
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      ann.target === 'ALL_DEPARTMENTS'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-blue-100 text-blue-700'
                    }`}>
                      {ann.target === 'ALL_DEPARTMENTS' ? 'All Depts' : `${ann.departments?.length || 0} dept`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-6 pb-6 text-center">
              <Megaphone size={32} className="mx-auto text-surface-300 mb-2" />
              <p className="text-sm text-surface-400">No announcements yet</p>
              <p className="text-xs text-surface-300 mt-1">Announcements from your college will appear here</p>
            </div>
          )}
        </Card>
      </motion.div>

      {/* ─── Main Content Grid ────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-5 gap-6">
        {/* Left — Campus Activity Chart (wider) */}
        <motion.div variants={item} className="lg:col-span-3">
          <Card padding="none" hover className="overflow-hidden h-full">
            <div className="p-6 pb-2 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-surface-900">Campus Activity</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-2xl font-bold text-surface-900">{totalInteractions.toLocaleString()}</span>
                  <span className="text-sm text-surface-500">Total Interactions</span>
                </div>
              </div>
              <button className="text-xs font-semibold text-surface-600 hover:text-surface-800 px-3 py-1.5 rounded-lg bg-surface-50 hover:bg-surface-100 transition-colors">
                This Week ▾
              </button>
            </div>

            {/* Time period tabs */}
            <div className="px-6 flex gap-1 border-b border-surface-100">
              {timePeriods.map((period) => (
                <button
                  key={period}
                  onClick={() => setActivePeriod(period)}
                  className={`px-3 py-2 text-xs font-semibold transition-colors ${
                    activePeriod === period
                      ? 'text-primary-700 border-b-2 border-primary-600'
                      : 'text-surface-400 hover:text-surface-600'
                  }`}
                >
                  {period}
                </button>
              ))}
            </div>

            {/* Chart area */}
            <div className="px-6 pt-4 pb-6 h-48">
              <Sparkline data={sparklineData} color="#10b981" height={160} />
            </div>
          </Card>
        </motion.div>

        {/* Right — Up Next Events */}
        <motion.div variants={item} className="lg:col-span-2">
          <Card padding="none" hover className="overflow-hidden h-full">
            <div className="p-6 pb-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-surface-900">Up Next</h3>
              </div>
              <button
                onClick={() => navigate('/hackathons')}
                className="text-xs font-semibold text-primary-600 hover:text-primary-700 flex items-center gap-1"
              >
                View all events →
              </button>
            </div>
            <div className="px-6 pb-4 space-y-3">
              {upcomingHackathons.length > 0 ? (
                upcomingHackathons.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center gap-3 p-3 rounded-xl bg-surface-50 hover:bg-surface-100 transition-colors group cursor-pointer"
                  >
                    <div className="w-3 h-3 rounded-full shrink-0 bg-primary-500" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-surface-900 group-hover:text-primary-700 transition-colors text-sm">{event.title}</p>
                      <p className="text-xs text-surface-400 mt-0.5">
                        Hackathon · {new Date(event.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </p>
                    </div>
                    <span className="text-xs text-surface-400 shrink-0">{daysUntil(event.startDate)} days left</span>
                  </div>
                ))
              ) : (
                <div className="text-center py-6 text-surface-400 text-sm">
                  No upcoming events
                </div>
              )}
            </div>
            <div className="px-6 pb-6">
              <button
                onClick={() => navigate('/hackathons')}
                className="text-sm font-semibold text-primary-600 hover:text-primary-700"
              >
                View all events →
              </button>
            </div>
          </Card>
        </motion.div>
      </div>

      {/* ─── Bottom Row ───────────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Left — CampusFlow AI Insights */}
        <motion.div variants={item}>
          <Card padding="none" hover className="overflow-hidden">
            <div className="p-6 pb-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-100 to-primary-100 flex items-center justify-center">
                <Brain className="w-5 h-5 text-primary-600" />
              </div>
              <div>
                <h3 className="font-bold text-surface-900">CampusFlow AI Insights</h3>
              </div>
            </div>
            <div className="px-6 pb-4 flex gap-6 items-start">
              {/* Radar chart */}
              <div className="shrink-0 w-48 h-48">
                <RadarChartPlaceholder />
              </div>
              {/* Insight bullets */}
              <div className="flex-1 space-y-3">
                {insights.map((insight, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <div className="w-5 h-5 rounded-full bg-primary-100 flex items-center justify-center shrink-0 mt-0.5">
                      <Sparkles size={10} className="text-primary-600" />
                    </div>
                    <p className="text-sm text-surface-600 leading-relaxed">{insight}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="px-6 pb-6">
              <button className="text-sm font-semibold text-primary-600 hover:text-primary-700">
                View detailed insights →
              </button>
            </div>
          </Card>
        </motion.div>

        {/* Right — Quick Actions */}
        <motion.div variants={item}>
          <Card padding="none" hover className="overflow-hidden">
            <div className="p-6 pb-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-100 to-primary-100 flex items-center justify-center">
                <Zap className="w-5 h-5 text-primary-600" />
              </div>
              <div>
                <h3 className="font-bold text-surface-900">Quick Actions</h3>
                <p className="text-xs text-surface-400">Jump to what you need</p>
              </div>
            </div>
            <div className="px-6 pb-6 space-y-2">
              {quickActions.map((action) => (
                <QuickAction
                  key={action.label}
                  label={action.label}
                  description={action.description}
                  icon={action.icon}
                  onClick={action.onClick}
                />
              ))}
            </div>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  )
}
