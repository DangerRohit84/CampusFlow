interface PageHeaderProps {
  title: string
  subtitle?: string
  action?: React.ReactNode
  icon?: React.ReactNode
}

export default function PageHeader({ title, subtitle, action, icon }: PageHeaderProps) {
  return (
    <div className="paper overflow-hidden">
      <div className="h-[3px] bg-brass-400" />
      <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {icon && <div className="w-10 h-10 rounded-xl bg-surface-900 flex items-center justify-center shrink-0">{icon}</div>}
          <div>
            <h1 className="font-display text-xl font-extrabold text-surface-900 dark:text-night-50 leading-none">{title}</h1>
            {subtitle && <p className="text-xs text-surface-500 dark:text-night-400 mt-1">{subtitle}</p>}
          </div>
        </div>
        {action && <div className="flex items-center gap-2">{action}</div>}
      </div>
    </div>
  )
}
