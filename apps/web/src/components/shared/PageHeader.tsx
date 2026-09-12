interface PageHeaderProps {
  title: string
  subtitle?: string
  action?: React.ReactNode
  icon?: React.ReactNode
  accent?: 'brass' | 'blue' | 'emerald' | 'rose' | 'neutral' | 'default'
}

export default function PageHeader({ title, subtitle, action, icon, accent = 'brass' }: PageHeaderProps) {
  const bar =
    accent === 'brass' ? 'bg-brass-500' :
    accent === 'blue' ? 'bg-primary-600' :
    accent === 'emerald' ? 'bg-success-600' :
    accent === 'rose' ? 'bg-rose-500' :
    accent === 'neutral' ? 'bg-surface-200 dark:bg-zinc-700' : 'bg-zinc-900 dark:bg-zinc-700'
  const iconBg =
    accent === 'brass' ? 'bg-brass-500 text-slate-900' :
    accent === 'blue' ? 'bg-primary-600 text-white' :
    accent === 'emerald' ? 'bg-success-600 text-white' :
    accent === 'rose' ? 'bg-rose-600 text-white' :
    accent === 'neutral' ? 'bg-white border border-surface-200 text-slate-700 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-300' : 'bg-zinc-900 text-white'
  return (
    <div className="paper overflow-hidden">
      <div className={`h-[3px] ${bar}`} />
      <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {icon && <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>{icon}</div>}
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
