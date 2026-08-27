import { motion } from 'framer-motion'
import { type LucideIcon, TrendingUp, TrendingDown } from 'lucide-react'
import clsx from 'clsx'

interface StatCardProps {
  /** Display label above the value */
  label: string
  /** Primary stat value */
  value: string | number
  /** Lucide icon component */
  icon: LucideIcon
  /** Gradient classes for icon background (e.g. "from-primary-500 to-primary-600") */
  color: string
  /** Background class for decorative blob (e.g. "bg-primary-100") */
  bg: string
  /** Optional loading skeleton state */
  loading?: boolean
  /** Optional trend indicator */
  trend?: {
    /** e.g. "+12.4% vs last month" */
    value: string
    /** true = positive (green), false = negative (red) */
    isPositive: boolean
  }
}

export default function StatCard({
  label,
  value,
  icon: Icon,
  color,
  bg,
  loading,
  trend,
}: StatCardProps) {
  return (
    <motion.div
      whileHover={{ scale: 1.02, y: -2 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className={clsx(
        'relative overflow-hidden rounded-xl bg-white dark:bg-night-800 border border-surface-100 dark:border-night-600',
        'shadow-soft hover:shadow-soft-lg transition-shadow duration-300',
        'p-6'
      )}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Text content */}
        <div className="flex-1 min-w-0">
          {/* Label */}
          <p className="text-sm font-medium text-surface-500 dark:text-night-200 truncate">{label}</p>

          {/* Value */}
          {loading ? (
            <div className="mt-2 h-9 w-20 rounded-lg bg-surface-100 dark:bg-night-600 animate-pulse" />
          ) : (
            <p className="text-3xl font-bold text-surface-900 mt-1 tracking-tight">
              {value}
            </p>
          )}

          {/* Trend indicator */}
          {trend && !loading && (
            <div className="mt-2 flex items-center gap-1.5">
              {trend.isPositive ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700">
                  <TrendingUp size={14} strokeWidth={2.5} />
                  {trend.value}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-danger-50 px-2.5 py-1 text-xs font-semibold text-danger-600">
                  <TrendingDown size={14} strokeWidth={2.5} />
                  {trend.value}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Icon */}
        <div
          className={clsx(
            'flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br flex items-center justify-center text-white shadow-md',
            color
          )}
        >
          {loading ? (
            <div className="w-5 h-5 rounded-full bg-white/30 animate-pulse" />
          ) : (
            <Icon size={22} strokeWidth={2} />
          )}
        </div>
      </div>

      {/* Decorative background blob */}
      <div
        className={clsx(
          'absolute -bottom-8 -right-8 w-24 h-24 rounded-full opacity-40',
          bg
        )}
      />
    </motion.div>
  )
}
