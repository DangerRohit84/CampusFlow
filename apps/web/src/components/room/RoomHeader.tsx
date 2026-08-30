import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, Check, Copy, KeyRound, LogOut, User, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import type { ReactNode } from 'react'

interface RoomHeaderProps {
  roomName: string
  description?: string | null
  memberCount: number
  resourceCount: number
  teacherName?: string | null
  joinCode?: string | null
  onBack: () => void
  onLeave?: () => void
}

function Chip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-100 dark:bg-night-700 text-xs font-medium text-surface-600 dark:text-night-200">
      {icon}
      {children}
    </span>
  )
}

export default function RoomHeader({
  roomName, description, memberCount, resourceCount, teacherName, joinCode, onBack, onLeave,
}: RoomHeaderProps) {
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

  const copyJoinCode = () => {
    if (!joinCode) return
    navigator.clipboard.writeText(joinCode)
    toast.success('Join code copied!')
    setCopied(true)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex items-start gap-3 flex-wrap">
      <button
        onClick={onBack}
        className="p-2 rounded-xl bg-surface-100 dark:bg-night-700 dark:text-night-100 hover:bg-surface-200 dark:hover:bg-night-600 transition-all shrink-0"
        title="Back to rooms"
      >
        <ArrowLeft size={18} />
      </button>

      <div className="w-10 h-10 rounded-xl bg-primary-600 from-primary-500 to-primary-700 flex items-center justify-center shrink-0 shadow-sm">
        <BookOpen size={18} className="text-white" />
      </div>

      <div className="min-w-0 flex-1">
        <h1 className="text-xl sm:text-2xl font-bold text-surface-900 dark:text-night-50 truncate">{roomName}</h1>
        {description && (
          <p className="text-surface-500 dark:text-night-200 text-sm mt-0.5 line-clamp-1">{description}</p>
        )}
        <div className="flex items-center gap-2 flex-wrap mt-2">
          <Chip icon={<Users size={12} className="text-primary-500" />}>{memberCount} members</Chip>
          <Chip icon={<BookOpen size={12} className="text-primary-500" />}>{resourceCount} resources</Chip>
          {teacherName && (
            <Chip icon={<User size={12} className="text-primary-500" />}>{teacherName}</Chip>
          )}
        </div>
      </div>

      {joinCode && (
        <div className="flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-xl bg-primary-50 dark:bg-primary-500/10 border border-primary-100 dark:border-primary-500/20">
          <KeyRound size={14} className="text-primary-500" />
          <span className="font-mono font-bold text-sm text-surface-900 dark:text-night-50 tracking-wider">{joinCode}</span>
          <button
            onClick={copyJoinCode}
            className={clsx(
              'p-1.5 rounded-lg transition-colors',
              copied
                ? 'text-success-600 dark:text-success-400 bg-success-50 dark:bg-success-500/10'
                : 'text-surface-400 dark:text-night-300 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10'
            )}
            title={copied ? 'Copied!' : 'Copy join code'}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      )}

      {onLeave && (
        <button
          onClick={onLeave}
          className="flex items-center gap-2 px-4 py-2 bg-danger-50 dark:bg-danger-500/10 text-danger-600 dark:text-danger-400 rounded-xl border border-danger-200 dark:border-danger-500/20 text-sm font-medium hover:bg-danger-100 dark:hover:bg-danger-500/20 transition-all"
        >
          <LogOut size={14} /> Leave Room
        </button>
      )}
    </div>
  )
}