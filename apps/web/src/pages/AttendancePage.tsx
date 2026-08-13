import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Target, CheckCircle, XCircle, Clock, TrendingUp } from 'lucide-react'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import { userAPI } from '../lib/api'

export default function AttendancePage() {
  const [records, setRecords] = useState<any[]>([])
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([userAPI.getAttendance(), userAPI.getAttendanceStats()])
      .then(([r, s]) => { setRecords(r); setStats(s) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const statusColors: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
    PRESENT: { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: CheckCircle },
    ABSENT: { bg: 'bg-red-100', text: 'text-red-700', icon: XCircle },
    LATE: { bg: 'bg-amber-100', text: 'text-amber-700', icon: Clock },
    EXCUSED: { bg: 'bg-blue-100', text: 'text-blue-700', icon: CheckCircle },
  }

  // Group by course
  const courseStats = records.reduce((acc: any, r: any) => {
    if (!acc[r.courseName]) acc[r.courseName] = { total: 0, present: 0, absent: 0, late: 0 }
    acc[r.courseName].total++
    if (r.status === 'PRESENT') acc[r.courseName].present++
    if (r.status === 'ABSENT') acc[r.courseName].absent++
    if (r.status === 'LATE') acc[r.courseName].late++
    return acc
  }, {})

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-bold text-surface-900">Attendance</h1>
        <p className="text-surface-500 mt-1">Track your class attendance</p>
      </motion.div>

      {/* Stats */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Overall', value: `${stats?.percentage || 0}%`, icon: Target, color: 'from-primary-400 to-primary-600' },
          { label: 'Present', value: stats?.present || 0, icon: CheckCircle, color: 'from-emerald-400 to-emerald-600' },
          { label: 'Absent', value: stats?.absent || 0, icon: XCircle, color: 'from-red-400 to-red-600' },
          { label: 'Late', value: stats?.late || 0, icon: Clock, color: 'from-amber-400 to-amber-600' },
        ].map((s) => (
          <Card key={s.label} hover className="relative overflow-hidden">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-surface-500">{s.label}</p>
                <p className="text-3xl font-bold text-surface-900 mt-1">{loading ? '—' : s.value}</p>
              </div>
              <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center text-white shadow-md`}>
                <s.icon size={20} />
              </div>
            </div>
          </Card>
        ))}
      </motion.div>

      {/* Attendance Ring */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <Card hover>
          <div className="flex flex-col md:flex-row items-center gap-8">
            <div className="relative w-40 h-40 shrink-0">
              <svg className="w-40 h-40 transform -rotate-90" viewBox="0 0 160 160">
                <circle cx="80" cy="80" r="70" fill="none" stroke="#e5e7eb" strokeWidth="12" />
                <motion.circle
                  cx="80" cy="80" r="70" fill="none"
                  stroke="url(#gradient)" strokeWidth="12" strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 70}
                  initial={{ strokeDashoffset: 2 * Math.PI * 70 }}
                  animate={{ strokeDashoffset: 2 * Math.PI * 70 * (1 - (stats?.percentage || 0) / 100) }}
                  transition={{ duration: 1.5, delay: 0.5 }}
                />
                <defs>
                  <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#5c7cfa" />
                    <stop offset="100%" stopColor="#845ef7" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold text-surface-900">{stats?.percentage || 0}%</span>
                <span className="text-xs text-surface-400">Attendance</span>
              </div>
            </div>

            <div className="flex-1 w-full">
              <h3 className="font-bold text-surface-900 mb-4">Course-wise Attendance</h3>
              <div className="space-y-4">
                {Object.entries(courseStats).map(([course, data]: [string, any]) => {
                  const pct = data.total > 0 ? Math.round((data.present / data.total) * 100) : 0
                  return (
                    <div key={course}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-surface-700">{course}</span>
                        <span className={`text-sm font-bold ${pct >= 80 ? 'text-emerald-600' : pct >= 60 ? 'text-amber-600' : 'text-red-600'}`}>{pct}%</span>
                      </div>
                      <div className="h-2.5 bg-surface-100 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.8, delay: 0.3 }}
                          className={`h-full rounded-full ${pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                        />
                      </div>
                      <p className="text-xs text-surface-400 mt-0.5">{data.present}/{data.total} classes attended</p>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Recent Records */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <Card padding="none" hover>
          <div className="p-6 pb-3">
            <h3 className="font-bold text-surface-900">Recent Attendance</h3>
          </div>
          <div className="divide-y divide-surface-100">
            {loading ? (
              <div className="text-center py-12 text-surface-400">Loading...</div>
            ) : records.slice(0, 10).map((r) => {
              const s = statusColors[r.status] || statusColors.PRESENT
              const Icon = s.icon
              return (
                <div key={r.id} className="flex items-center gap-4 px-6 py-3 hover:bg-surface-50 transition-colors">
                  <div className={`w-9 h-9 rounded-lg ${s.bg} flex items-center justify-center`}>
                    <Icon size={16} className={s.text} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-surface-900">{r.courseName}</p>
                    <p className="text-xs text-surface-400">{r.courseId}</p>
                  </div>
                  <div className="text-right">
                    <Badge variant={r.status === 'PRESENT' ? 'success' : r.status === 'ABSENT' ? 'danger' : 'warning'}>
                      {r.status}
                    </Badge>
                    <p className="text-xs text-surface-400 mt-0.5">{new Date(r.date).toLocaleDateString()}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      </motion.div>
    </motion.div>
  )
}