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
    <div className="flex items-center gap-2 flex-wrap border-b border-surface-200 pb-3">
      {tabs.map(({ key, label, icon: Icon, count }) => (
        <button
          key={key}
          onClick={() => onTabChange(key)}
          className={clsx(
            'flex items-center gap-1.5 px-4 min-h-[36px] rounded-full text-sm font-semibold transition-colors border',
            activeTab === key
              ? 'bg-primary-600 text-white border-primary-600 shadow-e1'
              : 'bg-white text-surface-600 border-surface-200 hover:bg-surface-50 hover:border-surface-300'
          )}
        >
          <Icon size={14} />
          {label}
          {count !== undefined && (
            <span className={clsx(
              'ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold border',
              activeTab === key ? 'bg-white text-primary-700 border-white' : 'bg-surface-100 text-surface-600 border-surface-200'
            )}>
              {count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
