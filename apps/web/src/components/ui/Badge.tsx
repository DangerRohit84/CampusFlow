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
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border',
        {
          'bg-primary-50 text-primary-600 border-primary-100': variant === 'primary',
          'bg-success-50 text-success-600 border-success-100': variant === 'success',
          'bg-warning-50 text-warning-600 border-warning-100': variant === 'warning',
          'bg-danger-50 text-danger-600 border-danger-100': variant === 'danger',
          'bg-accent-50 text-accent-600 border-accent-100': variant === 'accent',
          'bg-surface-100 text-surface-600 border-surface-200': variant === 'default',
        },
        className
      )}
    >
      {dot && (
        <span
          className={clsx('w-1.5 h-1.5 rounded-full', {
            'bg-primary-600': variant === 'primary',
            'bg-success-600': variant === 'success',
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
