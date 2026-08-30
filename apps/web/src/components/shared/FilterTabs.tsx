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
}

export default function FilterTabs({ tabs, activeTab, onTabChange }: FilterTabsProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap border-b border-surface-200 dark:border-night-600 pb-3">
      {tabs.map(({ key, label, icon: Icon, count }) => (
        <button
          key={key}
          onClick={() => onTabChange(key)}
          className={clsx(
            'flex items-center gap-1.5 px-4 min-h-[36px] rounded-full text-sm font-semibold transition-colors border',
            activeTab === key
              ? 'bg-primary-600 dark:bg-[#90B9A4] text-white dark:text-night-950 border-primary-600 dark:border-[#90B9A4] shadow-e1'
              : 'bg-white dark:bg-night-700 text-surface-600 dark:text-night-200 border-surface-200 dark:border-night-600 hover:bg-surface-50 dark:hover:bg-night-600 hover:border-surface-300 dark:hover:border-night-500'
          )}
        >
          <Icon size={14} />
          {label}
          {count !== undefined && (
            <span className={clsx(
              'ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold border',
              activeTab === key ? 'bg-white dark:bg-night-950 text-primary-700 dark:text-[#90B9A4] border-white dark:border-night-950' : 'bg-surface-100 dark:bg-night-600 text-surface-600 dark:text-night-200 border-surface-200 dark:border-night-500'
            )}>
              {count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
