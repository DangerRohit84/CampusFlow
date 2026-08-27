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
    <div className="flex items-center gap-2 flex-wrap">
      {tabs.map(({ key, label, icon: Icon, count }) => (
        <button
          key={key}
          onClick={() => onTabChange(key)}
          className={clsx(
            'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all',
            activeTab === key
              ? 'bg-primary-500 text-white shadow-md'
              : 'bg-surface-100 text-surface-600 hover:bg-surface-200'
          )}
        >
          <Icon size={14} />
          {label}
          {count !== undefined && (
            <span className={clsx(
              'ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold',
              activeTab === key ? 'bg-white text-primary-600' : 'bg-surface-200 text-surface-600'
            )}>
              {count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
