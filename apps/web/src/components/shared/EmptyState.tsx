import { type LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
}

export default function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="text-center py-16">
      <Icon className="w-16 h-16 text-surface-300 mx-auto mb-4" />
      <h3 className="text-lg font-semibold text-surface-700 dark:text-night-200">{title}</h3>
      {description && <p className="text-surface-400 dark:text-night-400 mt-1">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
