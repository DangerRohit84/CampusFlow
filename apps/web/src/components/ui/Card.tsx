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
        'bg-white rounded-[14px] border border-surface-200 shadow-e1',
        {
          'hover:shadow-e2 transition-shadow duration-200': hover,
          'p-0': padding === 'none',
          'p-4': padding === 'sm',
          'p-5': padding === 'md',
          'p-6': padding === 'lg',
          'cursor-pointer hover:border-primary-200': hover && onClick,
        },
        className
      )}
    >
      {children}
    </div>
  )
}
