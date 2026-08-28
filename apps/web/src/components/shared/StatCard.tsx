import { type LucideIcon } from 'lucide-react'

interface StatCardProps {
  label: string
  value: string | number
  icon: LucideIcon
  color: string
  bg: string
  loading?: boolean
  trend?: { value: string; isPositive: boolean }
}

export default function StatCard({ label, value, icon: Icon, loading, trend }: StatCardProps) {
  return (
    <div className="stat-card">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold tracking-widest uppercase text-surface-400 truncate">{label}</p>
          {loading ? (
            <div className="mt-2 h-9 w-20 rounded-lg bg-surface-100 animate-pulse" />
          ) : (
            <p className="font-display text-3xl font-extrabold text-surface-900 mt-1 tracking-tight">{value}</p>
          )}
          {trend && !loading && (
            <p className="mt-1 text-xs font-medium text-surface-500">{trend.value}</p>
          )}
        </div>
        <div className="w-11 h-11 rounded-xl bg-primary-600 flex items-center justify-center text-white shrink-0">
          {loading ? <div className="w-5 h-5 rounded-full bg-white/30 animate-pulse" /> : <Icon size={20} />}
        </div>
      </div>
    </div>
  )
}
