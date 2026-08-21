import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Target, CheckCircle, XCircle, Clock, Upload, PencilLine, Sparkles, History } from 'lucide-react'
import Card from '../components/ui/Card'
import { userAPI } from '../lib/api'
import UploadTab from '../components/attendance/UploadTab'
import ManualTab from '../components/attendance/ManualTab'
import PredictionsTab from '../components/attendance/PredictionsTab'
import HistoryTab from '../components/attendance/HistoryTab'

type TabId = 'overview' | 'upload' | 'manual' | 'predictions' | 'history'

const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: Target },
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'manual', label: 'Manual', icon: PencilLine },
  { id: 'predictions', label: 'Predictions', icon: Sparkles },
  { id: 'history', label: 'History', icon: History },
]

const statusColors: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  PRESENT: { bg: 'bg-primary-100', text: 'text-primary-700', icon: CheckCircle },
  ABSENT: { bg: 'bg-danger-100', text: 'text-danger-700', icon: XCircle },
  LATE: { bg: 'bg-warning-100', text: 'text-warning-700', icon: Clock },
  EXCUSED: { bg: 'bg-primary-100', text: 'text-primary-700', icon: CheckCircle },
}

export default function AttendancePage() {
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [records, setRecords] = useState<any[]>([])
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([userAPI.getAttendance(), userAPI.getAttendanceStats()])
      .then(([r, s]) => { setRecords(r); setStats(s) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

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
        <h1 className="text-3xl font-bold text-surface-900 dark:text-[#F4F7F8]">Attendance</h1>
        <p className="text-surface-500 dark:text-[#A6B3BE] mt-1">Track your class attendance</p>
      </motion.div>

      <div className="bg-white dark:bg-[#111920] border border-surface-100 dark:border-[#202C35] rounded-2xl p-1.5 shadow-soft flex gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-colors ${
                isActive
                  ? 'text-white'
                  : 'text-surface-500 dark:text-[#A6B3BE] hover:text-surface-700 dark:hover:text-[#F4F7F8] hover:bg-surface-50 dark:hover:bg-[#1a2530]'
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute inset-0 bg-gradient-to-br from-primary-500 to-primary-600 rounded-xl"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-2">
                <Icon size={16} />
                {tab.label}
              </span>
            </button>
          )
        })}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'overview' && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="space-y-6"
          >
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Overall', value: `${stats?.percentage || 0}%`, icon: Target, color: 'from-primary-400 to-primary-600' },
                { label: 'Present', value: stats?.present || 0, icon: CheckCircle, color: 'from-primary-400 to-primary-600' },
                { label: 'Absent', value: stats?.absent || 0, icon: XCircle, color: 'from-danger-400 to-danger-600' },
                { label: 'Late', value: stats?.late || 0, icon: Clock, color: 'from-warning-400 to-warning-600' },
              ].map((s) => (
                <Card key={s.label} hover className="relative overflow-hidden">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-surface-500 dark:text-[#A6B3BE]">{s.label}</p>
                      <p className="text-3xl font-bold text-surface-900 dark:text-[#F4F7F8] mt-1">{loading ? '\u2014' : s.value}</p>
                    </div>
                    <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center text-white shadow-md`}>
                      <s.icon size={20} />
                    </div>
                  </div>
                </Card>
              ))}
            </motion.div>

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
                      <span className="text-3xl font-bold text-surface-900 dark:text-[#F4F7F8]">{stats?.percentage || 0}%</span>
                      <span className="text-xs text-surface-400 dark:text-[#A6B3BE]">Attendance</span>
                    </div>
                  </div>

                  <div className="flex-1 w-full">
                    <h3 className="font-bold text-surface-900 dark:text-[#F4F7F8] mb-4">Course-wise Attendance</h3>
                    <div className="space-y-4">
                      {Object.entries(courseStats).map(([course, data]: [string, any]) => {
                        const pct = data.total > 0 ? Math.round((data.present / data.total) * 100) : 0
                        return (
                          <div key={course}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium text-surface-700 dark:text-[#A6B3BE]">{course}</span>
                              <span className={`text-sm font-bold ${pct >= 80 ? 'text-primary-600' : pct >= 60 ? 'text-warning-600' : 'text-danger-600'}`}>{pct}%</span>
                            </div>
                            <div className="h-2.5 bg-surface-100 dark:bg-[#202C35] rounded-full overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${pct}%` }}
                                transition={{ duration: 0.8, delay: 0.3 }}
                                className={`h-full rounded-full ${pct >= 80 ? 'bg-primary-500' : pct >= 60 ? 'bg-warning-500' : 'bg-danger-500'}`}
                              />
                            </div>
                            <p className="text-xs text-surface-400 dark:text-[#A6B3BE] mt-0.5">{data.present}/{data.total} classes attended</p>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
              <Card padding="none" hover>
                <div className="p-6 pb-3">
                  <h3 className="font-bold text-surface-900 dark:text-[#F4F7F8]">Recent Attendance</h3>
                </div>
                <div className="divide-y divide-surface-100 dark:divide-[#202C35]">
                  {loading ? (
                    <div className="text-center py-12 text-surface-400 dark:text-[#A6B3BE]">Loading...</div>
                  ) : records.slice(0, 10).map((r) => {
                    const s = statusColors[r.status] || statusColors.PRESENT
                    const Icon = s.icon
                    return (
                      <div key={r.id} className="flex items-center gap-4 px-6 py-3 hover:bg-surface-50 dark:hover:bg-[#202C35] transition-colors">
                        <div className={`w-9 h-9 rounded-lg ${s.bg} flex items-center justify-center`}>
                          <Icon size={16} className={s.text} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-surface-900 dark:text-[#F4F7F8]">{r.courseName}</p>
                          <p className="text-xs text-surface-400 dark:text-[#A6B3BE]">{r.courseId}</p>
                        </div>
                        <div className="text-right">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${r.status === 'PRESENT' ? 'bg-primary-100 text-primary-700' : r.status === 'ABSENT' ? 'bg-danger-100 text-danger-700' : 'bg-warning-100 text-warning-700'}`}>
                            {r.status}
                          </span>
                          <p className="text-xs text-surface-400 dark:text-[#A6B3BE] mt-0.5">{new Date(r.date).toLocaleDateString()}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Card>
            </motion.div>
          </motion.div>
        )}

        {activeTab === 'upload' && (
          <motion.div
            key="upload"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
          >
            <UploadTab />
          </motion.div>
        )}

        {activeTab === 'manual' && (
          <motion.div
            key="manual"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
          >
            <ManualTab />
          </motion.div>
        )}

        {activeTab === 'predictions' && (
          <motion.div
            key="predictions"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
          >
            <PredictionsTab />
          </motion.div>
        )}

        {activeTab === 'history' && (
          <motion.div
            key="history"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
          >
            <HistoryTab />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
