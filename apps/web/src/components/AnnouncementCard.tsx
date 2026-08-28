import { useState } from 'react'
import { Megaphone, Trash2, Pencil, ChevronDown, ChevronUp } from 'lucide-react'
import clsx from 'clsx'

interface AnnouncementCardProps {
  announcement: {
    id: string
    title: string
    content: string
    target: string
    targetScope?: string
    collegeId?: string | null
    createdAt: string
    publishAt?: string | null
    expiresAt?: string | null
    creator: { id: string; name: string; role: string; avatar?: string | null }
    departments: { department: { id: string; name: string } }[]
    colleges?: { college: { id: string; name: string } }[]
  }
  onDelete?: (id: string) => void
  onEdit?: (announcement: AnnouncementCardProps['announcement']) => void
  canDelete?: boolean
  canEdit?: boolean
  isRead?: boolean
  onMarkRead?: (id: string) => void
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `${weeks}w ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function relativeFutureTime(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now()
  if (diff <= 0) return 'now'
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'in less than a minute'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `in ${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `in ${days}d`
  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `in ${weeks}w`
  return `on ${new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  COLLEGE_ADMIN: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  TEACHER: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  STUDENT: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
}

export default function AnnouncementCard({ announcement, onDelete, onEdit, canDelete, canEdit, isRead, onMarkRead }: AnnouncementCardProps) {
  const [expanded, setExpanded] = useState(false)
  const isLong = announcement.content.length > 200
  const displayContent = expanded || !isLong
    ? announcement.content
    : announcement.content.slice(0, 200) + '…'
  const unread = isRead === false

  const handleCardClick = () => {
    if (unread && onMarkRead) onMarkRead(announcement.id)
  }

  return (
    <div
      onClick={handleCardClick}
      className={clsx(
        'bg-white dark:bg-night-800 rounded-xl border shadow-sm p-5 hover:shadow-md transition-shadow relative',
        unread ? 'border-blue-200 dark:border-blue-900/40 ring-1 ring-blue-100 dark:ring-blue-900/20' : 'border-gray-200 dark:border-night-600'
      )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Avatar */}
          {announcement.creator.avatar ? (
            <img
              src={announcement.creator.avatar}
              alt={announcement.creator.name}
              className="w-10 h-10 rounded-full object-cover shrink-0"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-primary-600 flex items-center justify-center shrink-0">
              <Megaphone size={16} className="text-white" />
            </div>
          )}
           <div className="min-w-0">
            <h3 className="font-bold text-surface-900 dark:text-night-50 text-sm leading-tight truncate flex items-center gap-1.5">
              {unread && <span className="inline-block w-2 h-2 rounded-full bg-blue-500 shrink-0" aria-label="unread" />}
              {announcement.title}
            </h3>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-surface-500 dark:text-night-300">{announcement.creator.name}</span>
              <span className={clsx('text-[10px] font-semibold px-1.5 py-0.5 rounded-full', ROLE_COLORS[announcement.creator.role] || ROLE_COLORS.STUDENT)}>
                {announcement.creator.role.replace('_', ' ')}
              </span>
              <span className="text-xs text-surface-400 dark:text-night-400">· {relativeTime(announcement.createdAt)}</span>
            </div>
          </div>
        </div>

        {(canEdit || canDelete) && (
          <div className="flex items-center gap-1 shrink-0">
            {canEdit && onEdit && (
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(announcement) }}
                className="p-1.5 rounded-lg text-surface-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                title="Edit announcement"
              >
                <Pencil size={14} />
              </button>
            )}
            {canDelete && onDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(announcement.id) }}
                className="p-1.5 rounded-lg text-surface-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                title="Delete announcement"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="mt-3">
        <p className="text-sm text-surface-600 dark:text-night-200 whitespace-pre-wrap leading-relaxed">
          {displayContent}
        </p>
        {isLong && (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
            className="text-xs font-semibold text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 mt-1 flex items-center gap-1"
          >
            {expanded ? <><ChevronUp size={12} /> Show less</> : <><ChevronDown size={12} /> Read more</>}
          </button>
        )}
      </div>

      {/* Target badges */}
      <div className="flex flex-wrap gap-1.5 mt-3">
        {/* Schedule badges */}
        {announcement.publishAt && new Date(announcement.publishAt) > new Date() && (
          <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            Scheduled · {relativeFutureTime(announcement.publishAt)}
          </span>
        )}
        {announcement.expiresAt && (
          <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
            Expires {relativeFutureTime(announcement.expiresAt)}
          </span>
        )}
        {/* College scope badges */}
        {announcement.targetScope && announcement.targetScope !== 'MY_COLLEGES' && (
          <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${
            announcement.targetScope === 'ALL_COLLEGES'
              ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
              : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
          }`}>
            {announcement.targetScope === 'ALL_COLLEGES'
              ? 'All Colleges'
              : `${announcement.colleges?.length || 0} college${(announcement.colleges?.length || 0) !== 1 ? 's' : ''}`
            }
          </span>
        )}
        {/* Department badges */}
        {announcement.target === 'ALL_DEPARTMENTS' ? (
          <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            All Departments
          </span>
        ) : (
          announcement.departments.map((ad) => (
            <span
              key={ad.department.id}
              className="text-[10px] font-semibold px-2 py-1 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
            >
              {ad.department.name}
            </span>
          ))
        )}
      </div>
    </div>
  )
}
