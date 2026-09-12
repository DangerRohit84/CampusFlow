import { type LucideIcon } from 'lucide-react'

interface StatCardProps {
  label: string
  value: string | number
  icon: LucideIcon
  color: string
  bg: string
  loading?: boolean
  trend?: { value: string; isPositive: boolean }
  variant?: 'brass' | 'blue' | 'emerald' | 'rose' | 'neutral' | 'default'
}

export default function StatCard({ label, value, icon: Icon, loading, trend, color, bg, variant = 'default' }: StatCardProps) {
  const tone =
    variant === 'brass' ? 'stat-card--brass' :
    variant === 'blue' ? 'stat-card--blue' :
    variant === 'emerald' ? 'stat-card--emerald' :
    variant === 'rose' ? 'stat-card--rose' :
    variant === 'neutral' ? 'stat-card--neutral' : ''
  const iconBg =
    variant === 'brass' ? 'bg-brass-500 text-slate-900' :
    variant === 'blue' ? 'bg-primary-600 text-white' :
    variant === 'emerald' ? 'bg-success-600 text-white' :
    variant === 'rose' ? 'bg-rose-600 text-white' :
    variant === 'neutral' ? 'bg-surface-50 text-slate-700 border border-surface-200' : bg || 'bg-slate-800 text-white'
  const iconColor = variant === 'default' ? color : variant === 'neutral' ? 'text-slate-700' : variant === 'brass' ? 'text-slate-900' : 'text-white'
  return (
    <div className={`stat-card ${tone}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold tracking-widest uppercase text-surface-400 dark:text-night-400 truncate">{label}</p>
          {loading ? (
            <div className="mt-2 h-9 w-20 rounded-lg bg-surface-100 dark:bg-night-700 animate-pulse" />
          ) : (
            <p className="font-display text-3xl font-extrabold text-slate-800 dark:text-night-50 mt-1 tracking-tight">{value}</p>
          )}
          {trend && !loading && (
            <p className="mt-1 text-xs font-medium text-surface-500 dark:text-night-400">{trend.value}</p>
          )}
        </div>
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border ${iconBg} ${bg?.includes('border') ? '' : 'border-transparent'}`}>
          {loading ? <div className="w-5 h-5 rounded-full bg-white/30 animate-pulse" /> : <Icon size={20} className={variant==='brass' ? 'text-zinc-900' : 'text-white'} />}
        </div>
      </div>
    </div>
  )
}
