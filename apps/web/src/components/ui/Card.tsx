import clsx from 'clsx'

interface CardProps {
  children: React.ReactNode
  className?: string
  hover?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
  onClick?: () => void
}

export default function Card({ children, className, hover = false, padding = 'md', onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        'bg-white rounded-2xl border border-surface-100',
        {
          'shadow-soft hover:shadow-soft-lg transition-all duration-300': hover,
          'shadow-soft': !hover,
          'p-0': padding === 'none',
          'p-4': padding === 'sm',
          'p-6': padding === 'md',
          'p-8': padding === 'lg',
          'cursor-pointer hover:border-primary-200 hover:-translate-y-0.5': hover && onClick,
        },
        className
      )}
    >
      {children}
    </div>
  )
}