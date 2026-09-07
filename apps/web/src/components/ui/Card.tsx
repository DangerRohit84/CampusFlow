import clsx from 'clsx'

interface CardProps {
  children: React.ReactNode
  className?: string
  hover?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
  onClick?: () => void
  accent?: 'brass' | 'blue' | 'emerald' | 'rose' | 'neutral' | 'default'
}

export default function Card({ children, className, hover = false, padding = 'md', onClick, accent = 'default' }: CardProps) {
  const accentHover =
    accent === 'brass' ? 'card-accent--brass' :
    accent === 'blue' ? 'card-accent--blue' :
    accent === 'emerald' ? 'card-accent--emerald' :
    accent === 'rose' ? 'card-accent--rose' :
    accent === 'neutral' ? 'card-accent--neutral' : ''
  const isInteractive = Boolean(onClick)
  return (
    <div
      onClick={onClick}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onKeyDown={isInteractive ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
        }
      } : undefined}
      className={clsx(
        'bg-white dark:bg-night-800 rounded-[14px] border border-surface-200 dark:border-night-600 shadow-e1',
        {
          'hover:shadow-e2 transition-shadow duration-200': hover,
          'p-0': padding === 'none',
          'p-4': padding === 'sm',
          'p-5': padding === 'md',
          'p-6': padding === 'lg',
          'cursor-pointer hover:border-primary-200': hover && onClick && accent==='default',
          'cursor-pointer': hover && onClick && accent!=='default',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30': isInteractive,
        },
        accentHover,
        className
      )}
    >
      {children}
    </div>
  )
}
