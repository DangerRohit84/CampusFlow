import Card from '../ui/Card'
import { Users, CheckCircle, Clock, Award, BarChart2 } from 'lucide-react'

export default function StatsPanel({ stats, hub, isTeacher }: any) {
  if (!hub.showStats && !isTeacher) return <div className="text-center py-8 text-surface-400 dark:text-night-400 text-sm">Stats hidden by teacher</div>
  if (!stats) return <div className="text-center py-8 text-surface-400 dark:text-night-400">Loading stats...</div>
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {[
        { label: 'Eligible', value: stats.eligible, icon: Users, bg: 'bg-primary-50 dark:bg-primary-900/20', color: 'text-primary-600' },
        { label: 'Submitted', value: stats.submitted, icon: CheckCircle, bg: 'bg-primary-50 dark:bg-primary-900/20', color: 'text-primary-600' },
        { label: 'Pending', value: stats.pending, icon: Clock, bg: 'bg-warning-50 dark:bg-warning-900/20', color: 'text-warning-600' },
        { label: 'Graded', value: stats.graded, icon: Award, bg: 'bg-success-50 dark:bg-success-900/20', color: 'text-success-600' },
        { label: 'Avg Points', value: stats.avgPoints ?? '—', icon: BarChart2, bg: 'bg-surface-50 dark:bg-night-800', color: 'text-surface-600' },
        { label: 'Rate', value: `${stats.submissionRate}%`, icon: BarChart2, bg: 'bg-surface-50 dark:bg-night-800', color: 'text-surface-600' },
      ].map(s => (
        <Card key={s.label} className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center`}><s.icon size={18} className={s.color}/></div>
          <div><div className="text-lg font-bold text-surface-900 dark:text-night-50 dark:text-night-50">{s.value}</div><div className="text-xs text-surface-500">{s.label}</div></div>
        </Card>
      ))}
    </div>
  )
}
