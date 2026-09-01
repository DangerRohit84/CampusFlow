import clsx from 'clsx'

interface BadgeProps {
  variant?: 'primary' | 'success' | 'warning' | 'danger' | 'accent' | 'default' | 'brass' | 'emerald' | 'rose' | 'neutral'
  children: React.ReactNode
  dot?: boolean
  className?: string
}

export default function Badge({ variant = 'default', children, dot, className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border',
        {
          'bg-success-50 text-success-700 border-success-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/40': variant === 'success' || variant === 'emerald',
          'bg-warning-50 text-warning-800 border-warning-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/40': variant === 'warning' || variant === 'brass',
          'bg-danger-50 text-danger-700 border-danger-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/40': variant === 'danger',
          'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/40': variant === 'rose',
          'bg-accent-50 text-accent-700 border-accent-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800/40': variant === 'accent' || variant === 'primary',
          'bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700': variant === 'neutral',
          'bg-surface-100 text-surface-600 border-surface-200 dark:bg-zinc-800 dark:text-zinc-300': variant === 'default',
        },
        className
      )}
    >
      {dot && (
        <span
          className={clsx('w-1.5 h-1.5 rounded-full', {
            'bg-accent-600': variant === 'primary' || variant === 'accent',
            'bg-success-600': variant === 'success' || variant === 'emerald',
            'bg-warning-500': variant === 'warning' || variant === 'brass',
            'bg-danger-500': variant === 'danger',
            'bg-rose-500': variant === 'rose',
            'bg-zinc-400': variant === 'neutral',
            'bg-surface-400': variant === 'default',
          })}
        />
      )}
      {children}
    </span>
  )
}