import clsx from 'clsx'

interface BadgeProps {
  variant?: 'primary' | 'success' | 'warning' | 'danger' | 'accent' | 'default'
  children: React.ReactNode
  dot?: boolean
  className?: string
}

export default function Badge({ variant = 'default', children, dot, className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold',
        {
          'bg-primary-50 text-primary-600 dark:bg-primary-500/15 dark:text-primary-300': variant === 'primary',
          'bg-primary-50 text-primary-500 dark:bg-primary-500/15 dark:text-primary-300': variant === 'success',
          'bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-300': variant === 'warning',
          'bg-danger-50 text-danger-500 dark:bg-danger-500/15 dark:text-danger-300': variant === 'danger',
          'bg-accent-100 text-accent-500 dark:bg-accent-500/15 dark:text-accent-300': variant === 'accent',
          'bg-surface-100 text-surface-600 dark:bg-night-700 dark:text-night-200': variant === 'default',
        },
        className
      )}
    >
      {dot && (
        <span
          className={clsx('w-1.5 h-1.5 rounded-full', {
            'bg-primary-600': variant === 'primary',
            'bg-primary-400': variant === 'success',
            'bg-warning-500': variant === 'warning',
            'bg-danger-500': variant === 'danger',
            'bg-accent-500': variant === 'accent',
            'bg-surface-400': variant === 'default',
          })}
        />
      )}
      {children}
    </span>
  )
}
