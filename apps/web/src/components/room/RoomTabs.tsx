import { MessageSquare, Settings, Users, FileText } from 'lucide-react'
import clsx from 'clsx'

export type RoomTabKey = 'chat' | 'resources' | 'members'

interface RoomTabsProps {
  activeTab: RoomTabKey
  onChange: (tab: RoomTabKey) => void
  resourceCount: number
  memberCount: number
  unreadChat?: boolean
  showSettings?: boolean
  onOpenSettings?: () => void
}

export default function RoomTabs({
  activeTab, onChange, resourceCount, memberCount, unreadChat, showSettings, onOpenSettings,
}: RoomTabsProps) {
  const tabs = [
    { key: 'chat' as const, label: 'Chat', icon: MessageSquare, count: undefined as number | undefined },
    { key: 'resources' as const, label: 'Resources', icon: FileText, count: resourceCount },
    { key: 'members' as const, label: 'Members', icon: Users, count: memberCount },
  ]

  return (
    <div className="flex items-center gap-2 flex-wrap border-b border-surface-100 dark:border-night-600 pb-2">
      {tabs.map(({ key, label, icon: Icon, count }) => {
        const isActive = activeTab === key
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={clsx(
              'relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all shrink-0',
              isActive
                ? 'bg-primary-500 text-white shadow-md'
                : 'bg-surface-100 dark:bg-night-700 text-surface-600 dark:text-night-200 hover:bg-surface-200 dark:hover:bg-night-600'
            )}
          >
            <Icon size={14} />
            {label}
            {count !== undefined && (
              <span className={clsx(
                'ml-0.5 px-1.5 py-0.5 rounded-full text-xs',
                isActive ? 'bg-white/20' : 'bg-surface-200 dark:bg-night-600'
              )}>
                {count}
              </span>
            )}
            {key === 'chat' && unreadChat && !isActive && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-danger-500 ring-2 ring-white dark:ring-night-800" />
            )}
          </button>
        )
      })}
      {showSettings && (
        <button
          onClick={onOpenSettings}
          className="ml-auto flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-surface-100 dark:bg-night-700 text-surface-600 dark:text-night-200 hover:bg-surface-200 dark:hover:bg-night-600 transition-all shrink-0"
          title="Room settings"
        >
          <Settings size={14} />
          Settings
        </button>
      )}
    </div>
  )
}