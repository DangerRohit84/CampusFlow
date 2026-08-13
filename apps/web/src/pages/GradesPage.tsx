import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { GraduationCap, TrendingUp, Award, BookOpen, BarChart3 } from 'lucide-react'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import { userAPI } from '../lib/api'

export default function GradesPage() {
  const [grades, setGrades] = useState<any[]>([])
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([userAPI.getGrades(), userAPI.getGradeStats()])
      .then(([g, s]) => { setGrades(g); setStats(s) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const gradeColors: Record<string, string> = {
    'A+': 'bg-emerald-100 text-emerald-700', 'A': 'bg-emerald-100 text-emerald-700',
    'A-': 'bg-green-100 text-green-700', 'B+': 'bg-blue-100 text-blue-700',
    'B': 'bg-blue-100 text-blue-700', 'B-': 'bg-cyan-100 text-cyan-700',
    'C+': 'bg-amber-100 text-amber-700', 'C': 'bg-amber-100 text-amber-700',
    'F': 'bg-red-100 text-red-700',
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-bold text-surface-900">Grades</h1>
        <p className="text-surface-500 mt-1">Your academic performance overview</p>
      </motion.div>

      {/* Stats Row */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <Card hover className="relative overflow-hidden">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-surface-500">CGPA</p>
              <p className="text-4xl font-bold text-surface-900 mt-1">{loading ? '—' : stats?.cgpa?.toFixed(2) || '0.00'}</p>
              <p className="text-xs text-surface-400 mt-1">out of 10.0</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white shadow-lg"><TrendingUp size={22} /></div>
          </div>
          <div className="absolute -bottom-8 -right-8 w-24 h-24 bg-emerald-50 rounded-full opacity-50" />
        </Card>

        <Card hover className="relative overflow-hidden">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-surface-500">Total Credits</p>
              <p className="text-4xl font-bold text-surface-900 mt-1">{loading ? '—' : stats?.totalCredits || 0}</p>
              <p className="text-xs text-surface-400 mt-1">across {stats?.courseCount || 0} courses</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white shadow-lg"><BookOpen size={22} /></div>
          </div>
          <div className="absolute -bottom-8 -right-8 w-24 h-24 bg-primary-50 rounded-full opacity-50" />
        </Card>

        <Card hover className="relative overflow-hidden">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-surface-500">Highest Grade</p>
              <p className="text-4xl font-bold text-surface-900 mt-1">
                {loading ? '—' : grades.reduce((best, g) => g.gpa > (best?.gpa || 0) ? g : best, null)?.grade || '—'}
              </p>
              <p className="text-xs text-surface-400 mt-1">keep it up!</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-accent-400 to-accent-600 flex items-center justify-center text-white shadow-lg"><Award size={22} /></div>
          </div>
          <div className="absolute -bottom-8 -right-8 w-24 h-24 bg-accent-50 rounded-full opacity-50" />
        </Card>
      </motion.div>

      {/* GPA Visual Bar */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <Card hover>
          <h3 className="font-bold text-surface-900 mb-4">GPA Scale</h3>
          <div className="relative h-8 bg-surface-100 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${((stats?.cgpa || 0) / 10) * 100}%` }}
              transition={{ duration: 1, delay: 0.5 }}
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary-500 to-accent-500 rounded-full"
            />
            <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-surface-900">
              {stats?.cgpa?.toFixed(2) || '0.00'} / 10.00
            </div>
          </div>
          <div className="flex justify-between mt-2 text-xs text-surface-400">
            <span>0</span><span>2</span><span>4</span><span>6</span><span>8</span><span>10</span>
          </div>
        </Card>
      </motion.div>

      {/* Grades Table */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <Card padding="none" hover>
          <div className="p-6 pb-3">
            <h3 className="font-bold text-surface-900">Course Grades</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-t border-surface-100">
                  <th className="text-left text-xs font-semibold text-surface-500 uppercase tracking-wider px-6 py-3">Course</th>
                  <th className="text-left text-xs font-semibold text-surface-500 uppercase tracking-wider px-6 py-3">Code</th>
                  <th className="text-center text-xs font-semibold text-surface-500 uppercase tracking-wider px-6 py-3">Credits</th>
                  <th className="text-center text-xs font-semibold text-surface-500 uppercase tracking-wider px-6 py-3">Grade</th>
                  <th className="text-center text-xs font-semibold text-surface-500 uppercase tracking-wider px-6 py-3">GPA</th>
                  <th className="text-center text-xs font-semibold text-surface-500 uppercase tracking-wider px-6 py-3">Performance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {loading ? (
                  <tr><td colSpan={6} className="text-center py-12 text-surface-400">Loading...</td></tr>
                ) : grades.map((g) => (
                  <tr key={g.id} className="hover:bg-surface-50 transition-colors">
                    <td className="px-6 py-4 font-semibold text-surface-900">{g.courseName}</td>
                    <td className="px-6 py-4 text-surface-500 text-sm">{g.courseId}</td>
                    <td className="px-6 py-4 text-center text-surface-600">{g.credits}</td>
                    <td className="px-6 py-4 text-center">
                      <span className={`inline-flex px-3 py-1 rounded-full text-xs font-bold ${gradeColors[g.grade] || 'bg-surface-100 text-surface-600'}`}>{g.grade}</span>
                    </td>
                    <td className="px-6 py-4 text-center font-bold text-surface-900">{g.gpa.toFixed(1)}</td>
                    <td className="px-6 py-4">
                      <div className="w-full h-2 bg-surface-100 rounded-full overflow-hidden max-w-[120px] mx-auto">
                        <div className={`h-full rounded-full ${g.gpa >= 9 ? 'bg-emerald-500' : g.gpa >= 8 ? 'bg-blue-500' : g.gpa >= 7 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${(g.gpa / 10) * 100}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </motion.div>
    </motion.div>
  )
}