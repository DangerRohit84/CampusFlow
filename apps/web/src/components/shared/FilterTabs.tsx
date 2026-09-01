import clsx from 'clsx'
import { type LucideIcon } from 'lucide-react'

interface Tab {
  key: string
  label: string
  icon: LucideIcon
  count?: number
}

interface FilterTabsProps {
  tabs: Tab[]
  activeTab: string
  onTabChange: (key: string) => void
  accent?: 'brass' | 'blue' | 'emerald' | 'rose' | 'neutral' | 'default'
}

export default function FilterTabs({ tabs, activeTab, onTabChange, accent = 'default' }: FilterTabsProps) {
  const activeMap: Record<string, string> = {
    default: 'bg-slate-800 text-white border-slate-800 dark:bg-white dark:text-slate-900 dark:border-white shadow-sm',
    brass: 'bg-brass-500 text-slate-900 border-brass-500 dark:bg-brass-500 dark:text-slate-900 dark:border-brass-500 shadow-sm',
    blue: 'bg-primary-600 text-white border-primary-600 dark:bg-primary-600 dark:text-white dark:border-primary-600 shadow-sm',
    emerald: 'bg-success-600 text-white border-success-600 dark:bg-success-600 dark:text-white dark:border-success-600 shadow-sm',
    rose: 'bg-rose-600 text-white border-rose-600 dark:bg-rose-500 dark:text-white dark:border-rose-500 shadow-sm',
    neutral: 'bg-surface-50 text-slate-700 border-surface-200 dark:bg-zinc-800 dark:text-zinc-200 dark:border-zinc-700 shadow-sm',
  }
  const countActiveMap: Record<string, string> = {
    default: 'bg-white dark:bg-zinc-900 text-slate-800 dark:text-white border-white dark:border-zinc-900',
    brass: 'bg-white dark:bg-zinc-900 text-brass-700 dark:text-amber-300 border-white dark:border-zinc-900',
    blue: 'bg-white dark:bg-zinc-900 text-primary-700 dark:text-sky-300 border-white dark:border-zinc-900',
    emerald: 'bg-white dark:bg-zinc-900 text-success-700 dark:text-emerald-300 border-white dark:border-zinc-900',
    rose: 'bg-white dark:bg-zinc-900 text-rose-700 dark:text-rose-300 border-white dark:border-zinc-900',
    neutral: 'bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 border-white dark:border-zinc-900',
  }
  const activeCls = activeMap[accent] || activeMap.default
  const countActiveCls = countActiveMap[accent] || countActiveMap.default
  return (
    <div className="flex items-center gap-2 flex-wrap border-b border-surface-200 dark:border-night-600 pb-3">
      {tabs.map(({ key, label, icon: Icon, count }) => (
        <button
          key={key}
          onClick={() => onTabChange(key)}
          className={clsx(
            'flex items-center gap-1.5 px-4 min-h-[36px] rounded-full text-sm font-semibold transition-colors border',
            activeTab === key
              ? activeCls
              : 'bg-white dark:bg-night-700 text-surface-600 dark:text-night-200 border-surface-200 dark:border-night-600 hover:bg-surface-50 dark:hover:bg-night-600 hover:border-surface-300 dark:hover:border-night-500'
          )}
        >
          <Icon size={14} />
          {label}
          {count !== undefined && (
            <span className={clsx(
              'ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold border',
              activeTab === key ? countActiveCls : 'bg-surface-100 dark:bg-night-600 text-surface-600 dark:text-night-200 border-surface-200 dark:border-night-500'
            )}>
              {count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
