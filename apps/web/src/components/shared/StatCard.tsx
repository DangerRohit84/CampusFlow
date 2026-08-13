import Card from '../ui/Card'
import { type LucideIcon } from 'lucide-react'

interface StatCardProps {
  label: string
  value: string | number
  icon: LucideIcon
  color: string
  bg: string
  loading?: boolean
}

export default function StatCard({ label, value, icon: Icon, color, bg, loading }: StatCardProps) {
  return (
    <Card hover className="relative overflow-hidden group">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-surface-500">{label}</p>
          <p className="text-3xl font-bold text-surface-900 mt-1">{loading ? '—' : value}</p>
        </div>
        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform`}>
          <Icon size={22} />
        </div>
      </div>
      <div className={`absolute -bottom-8 -right-8 w-24 h-24 ${bg} rounded-full opacity-50 group-hover:opacity-80 transition-opacity`} />
    </Card>
  )
}
