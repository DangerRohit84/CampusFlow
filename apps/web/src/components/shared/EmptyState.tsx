import { type LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
}

export default function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="text-center py-16" role="status">
      <Icon aria-hidden="true" focusable="false" className="w-16 h-16 text-surface-300 mx-auto mb-4" />
      {/* WHY: h3 without h2 parent breaks heading order — use h2 (or p when nested). Action must be 44px Button. */}
      <h2 className="text-lg font-semibold text-surface-700 dark:text-night-200">{title}</h2>
      {description && <p className="text-surface-600 dark:text-night-300 mt-1">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}
