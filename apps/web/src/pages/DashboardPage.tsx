import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Calendar, BookOpen, Clock, TrendingUp, Bell, FileText, ArrowUpRight, ArrowDownRight, ChevronRight, Sparkles, Users, Target, Zap } from 'lucide-react'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import { dashboardAPI } from '../lib/api'
import { useAuthStore } from '../store/authStore'

interface DashboardData {
  cgpa: number
  attendancePercent: number
  pendingAssignments: number
  upcomingDeadlines: number
  unreadNotifications: number
  todaySchedule: any[]
  recentNotifications: any[]
}

export default function DashboardPage() {
  const { user } = useAuthStore()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    dashboardAPI.get().then(setData).catch(console.error).finally(() => setLoading(false))
  }, [])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const stats = [
    { label: 'CGPA', value: data?.cgpa?.toFixed(1) || '—', icon: TrendingUp, color: 'from-emerald-400 to-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Attendance', value: `${data?.attendancePercent || 0}%`, icon: Target, color: 'from-primary-400 to-primary-600', bg: 'bg-primary-50' },
    { label: 'Assignments', value: `${data?.pendingAssignments || 0} Due`, icon: FileText, color: 'from-amber-400 to-amber-600', bg: 'bg-amber-50' },
    { label: 'Notifications', value: `${data?.unreadNotifications || 0} New`, icon: Bell, color: 'from-accent-400 to-accent-600', bg: 'bg-accent-50' },
  ]

  const typeColor = (type: string) => {
    const m: Record<string, string> = { CLASS: 'primary', LAB: 'accent', SEMINAR: 'warning', OTHER: 'default' }
    return m[type] || 'default'
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-bold text-surface-900">{greeting}, <span className="gradient-text">{user?.name?.split(' ')[0] || 'Student'}</span> 👋</h1>
        <p className="text-surface-500 mt-1">Here's your campus overview for today</p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {stats.map((stat) => (
          <Card key={stat.label} hover className="relative overflow-hidden group">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-surface-500">{stat.label}</p>
                <p className="text-3xl font-bold text-surface-900 mt-1">{loading ? '—' : stat.value}</p>
              </div>
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${stat.color} flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform`}>
                <stat.icon size={22} />
              </div>
            </div>
            <div className={`absolute -bottom-8 -right-8 w-24 h-24 ${stat.bg} rounded-full opacity-50 group-hover:opacity-80 transition-opacity`} />
          </Card>
        ))}
      </motion.div>

      <div className="grid lg:grid-cols-3 gap-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="lg:col-span-2">
          <Card padding="none" className="overflow-hidden">
            <div className="p-6 pb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center"><Calendar className="w-5 h-5 text-primary-600" /></div>
                <div>
                  <h3 className="font-bold text-surface-900">Today's Schedule</h3>
                  <p className="text-xs text-surface-400">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</p>
                </div>
              </div>
            </div>
            <div className="px-6 pb-6 space-y-3">
              {loading ? (
                <div className="text-center py-12 text-surface-400">Loading schedule...</div>
              ) : data?.todaySchedule?.length === 0 ? (
                <div className="text-center py-12"><p className="text-surface-500 font-medium">No classes today</p><p className="text-sm text-surface-400">Enjoy your day off!</p></div>
              ) : (
                data?.todaySchedule?.map((event: any, i: number) => (
                  <motion.div key={event.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.1 }} className="flex items-center gap-4 p-4 rounded-xl bg-surface-50 hover:bg-surface-100 transition-colors group cursor-pointer">
                    <div className="w-1 h-12 rounded-full" style={{ backgroundColor: event.color || '#5c7cfa' }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-surface-900 group-hover:text-primary-700 transition-colors">{event.title}</p>
                        <Badge variant={typeColor(event.type) as any}>{event.type}</Badge>
                      </div>
                      <p className="text-sm text-surface-500 mt-0.5">{event.location}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="flex items-center gap-1.5 text-surface-900 font-semibold"><Clock size={14} className="text-surface-400" />{event.startTime}</div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="space-y-6">
          <Card className="bg-gradient-to-br from-primary-600 to-accent-600 text-white border-0">
            <div className="flex items-center gap-2 mb-4"><Sparkles size={20} /><h3 className="font-bold">AI Assistant</h3></div>
            <p className="text-sm text-white/80 mb-4">What can I help you with today?</p>
            <div className="space-y-2">
              {['Summarize my notes', 'Check deadlines', 'Plan study schedule'].map((action) => (
                <button key={action} className="w-full text-left px-4 py-2.5 bg-white/10 backdrop-blur-sm rounded-xl text-sm font-medium hover:bg-white/20 transition-colors border border-white/10">
                  <Zap size={14} className="inline mr-2" />{action}
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <h3 className="font-bold text-surface-900 mb-4">Recent Notifications</h3>
            <div className="space-y-3">
              {data?.recentNotifications?.slice(0, 4).map((n: any) => (
                <div key={n.id} className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${n.type === 'EXAM' ? 'bg-red-100 text-red-600' : n.type === 'ASSIGNMENT' ? 'bg-primary-100 text-primary-600' : 'bg-accent-100 text-accent-600'}`}>
                    {n.type === 'EXAM' ? <FileText size={14} /> : n.type === 'ASSIGNMENT' ? <BookOpen size={14} /> : <Users size={14} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-surface-700">{n.title}</p>
                    <p className="text-xs text-surface-400 mt-0.5">{new Date(n.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  )
}