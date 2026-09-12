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
          'bg-success-50 text-success-700 border-success-200 dark:bg-[#1e1e1e] dark:text-primary-500 dark:border-primary-500/30': variant === 'success' || variant === 'emerald',
          'bg-warning-50 text-warning-700 border-warning-200 dark:bg-[#1e1e1e] dark:text-warning-400 dark:border-warning-500/30': variant === 'warning' || variant === 'brass',
          'bg-danger-50 text-danger-600 border-danger-200 dark:bg-[#1e1e1e] dark:text-danger-400 dark:border-danger-500/30': variant === 'danger' || variant === 'rose',
          'bg-primary-50 text-primary-700 border-primary-200 dark:bg-[#1e1e1e] dark:text-primary-500 dark:border-primary-500/30': variant === 'accent' || variant === 'primary',
          'bg-surface-100 text-slate-700 border-surface-200 dark:bg-[#1f1f1f] dark:text-[#a7a7a7] dark:border-[#282828]': variant === 'neutral' || variant === 'default',
        },
        className
      )}
    >
      {dot && (
        <span
          className={clsx('w-1.5 h-1.5 rounded-full', {
            'bg-primary-500': variant === 'primary' || variant === 'accent',
            'bg-success-500': variant === 'success' || variant === 'emerald',
            'bg-warning-500': variant === 'warning' || variant === 'brass',
            'bg-danger-500': variant === 'danger' || variant === 'rose',
            'bg-zinc-400': variant === 'neutral',
            'bg-surface-400': variant === 'default',
          })}
        />
      )}
      {children}
    </span>
  )
}