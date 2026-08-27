import { Users } from 'lucide-react'
import clsx from 'clsx'

interface MemberLike {
  id: string
  name: string
  email?: string
  studentId?: string
  isCR?: boolean
}

interface RoomMembersPanelProps {
  members: MemberLike[]
  teacher?: { id: string; name: string; email?: string } | null
  currentUserId: string
  loading?: boolean
  canManageCR?: boolean
  onToggleCR?: (memberId: string, isCurrentlyCR: boolean) => void
}

interface MemberCardProps {
  member: MemberLike
  role: 'creator' | 'cr' | 'student'
  isYou: boolean
  canManageCR: boolean
  onToggleCR?: (memberId: string, isCurrentlyCR: boolean) => void
}

function RoleChip({ role }: { role: 'creator' | 'cr' | 'student' }) {
  const styles = {
    creator: 'bg-primary-100 dark:bg-primary-500/20 text-primary-700 dark:text-primary-300',
    cr: 'bg-warning-100 dark:bg-warning-500/15 text-warning-700 dark:text-warning-300',
    student: 'bg-surface-100 dark:bg-night-600 text-surface-500 dark:text-night-200',
  }
  const labels = { creator: 'Creator', cr: 'CR', student: 'Student' }
  return (
    <span className={clsx('px-1.5 py-0.5 text-[10px] font-bold rounded-full shrink-0', styles[role])}>
      {labels[role]}
    </span>
  )
}

function MemberCard({ member, role, isYou, canManageCR, onToggleCR }: MemberCardProps) {
  return (
    <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-white dark:bg-night-800 border border-surface-100 dark:border-night-600">
      <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center text-sm font-bold text-primary-600 dark:text-primary-300 shrink-0">
        {member.name.trim().charAt(0).toUpperCase() || '?'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="font-medium text-surface-900 dark:text-night-50 text-sm truncate">{member.name}</p>
          {isYou && <span className="text-[10px] font-semibold text-primary-500 shrink-0">(You)</span>}
          <RoleChip role={role} />
        </div>
        <p className="text-xs text-surface-400 dark:text-night-300 truncate mt-0.5">
          {[member.studentId, member.email].filter(Boolean).join(' · ') || '-'}
        </p>
      </div>
      {canManageCR && onToggleCR && role !== 'creator' && (
        <button
          onClick={() => onToggleCR(member.id, !!member.isCR)}
          className={clsx(
            'text-xs font-semibold px-2 py-1 rounded-lg shrink-0 transition-colors',
            member.isCR
              ? 'bg-warning-50 dark:bg-warning-500/10 text-warning-700 dark:text-warning-300 hover:bg-warning-100 dark:hover:bg-warning-500/20'
              : 'bg-surface-100 dark:bg-night-600 text-surface-600 dark:text-night-200 hover:bg-surface-200 dark:hover:bg-night-500'
          )}
        >
          {member.isCR ? 'Remove CR' : 'Make CR'}
        </button>
      )}
    </div>
  )
}

export default function RoomMembersPanel({
  members, teacher, currentUserId, loading, canManageCR, onToggleCR,
}: RoomMembersPanelProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 p-3.5 rounded-2xl bg-white dark:bg-night-800 border border-surface-100 dark:border-night-600 animate-pulse">
            <div className="w-10 h-10 rounded-full bg-surface-100 dark:bg-night-600" />
            <div className="flex-1 space-y-2">
              <div className="h-3 bg-surface-100 dark:bg-night-600 rounded-lg w-1/2" />
              <div className="h-2.5 bg-surface-100 dark:bg-night-600 rounded-lg w-2/3" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (members.length === 0 && !teacher) {
    return (
      <div className="space-y-4">
        <h2 className="font-bold text-surface-900 dark:text-night-50">Members (0)</h2>
        <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-12 text-center">
          <div className="w-12 h-12 rounded-2xl bg-surface-100 dark:bg-night-700 flex items-center justify-center mx-auto mb-3">
            <Users size={22} className="text-surface-400 dark:text-night-300" />
          </div>
          <p className="font-semibold text-surface-700 dark:text-night-100 text-sm">No members yet</p>
          <p className="text-surface-400 dark:text-night-300 text-xs mt-1">Share the join code to invite students</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h2 className="font-bold text-surface-900 dark:text-night-50">
        Members ({members.length + (teacher ? 1 : 0)})
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {teacher && (
          <MemberCard
            key={`teacher-${teacher.id}`}
            member={{ id: teacher.id, name: teacher.name, email: teacher.email }}
            role="creator"
            isYou={teacher.id === currentUserId}
            canManageCR={false}
          />
        )}
        {members.map((member) => (
          <MemberCard
            key={member.id}
            member={member}
            role={member.isCR ? 'cr' : 'student'}
            isYou={member.id === currentUserId}
            canManageCR={!!canManageCR}
            onToggleCR={onToggleCR}
          />
        ))}
      </div>
    </div>
  )
}
