import { useState, useEffect } from 'react'
import { Loader2, Search, Check, Users, ShieldCheck, SearchX } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import Modal from '../ui/Modal'
import { roomAPI } from '../../lib/api'

const CHAT_MODE_OPTIONS = [
  {
    value: 'EVERYONE',
    label: 'Everyone',
    description: 'All room members can send messages',
  },
  {
    value: 'ADMINS_ONLY',
    label: 'Admins only',
    description: 'Only you and college admins can send messages',
  },
  {
    value: 'SELECTED',
    label: 'Selected members',
    description: 'You, admins and picked members can send messages',
  },
]

interface RoomChatSettingsModalProps {
  open: boolean
  onClose: () => void
  roomId: string
  chatMode: string
  allowedMembers: any[]
  members: any[]
  onOptimisticSave: (settings: { chatMode: string; allowedMembers: any[] }) => void
  onSaveFailed: () => void
}

export default function RoomChatSettingsModal({
  open,
  onClose,
  roomId,
  chatMode,
  allowedMembers,
  members,
  onOptimisticSave,
  onSaveFailed,
}: RoomChatSettingsModalProps) {
  const [mode, setMode] = useState('EVERYONE')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setMode(chatMode || 'EVERYONE')
      setSelectedIds(new Set(allowedMembers.map((m) => m.id)))
      setSearch('')
    }
  }, [open, chatMode, allowedMembers])

  const toggleMember = (memberId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(memberId)) next.delete(memberId)
      else next.add(memberId)
      return next
    })
  }

  const filteredMembers = members.filter((m) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return m.name?.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q) || m.studentId?.toLowerCase().includes(q)
  })

  const handleSave = async () => {
    if (saving) return
    setSaving(true)

    // Optimistic update — revert via onSaveFailed if the request fails
    const optimisticAllowed = mode === 'SELECTED' ? members.filter((m) => selectedIds.has(m.id)) : []
    onOptimisticSave({ chatMode: mode, allowedMembers: optimisticAllowed })

    try {
      await roomAPI.updateChatSettings(roomId, {
        chatMode: mode,
        ...(mode === 'SELECTED' ? { allowedUserIds: Array.from(selectedIds) } : {}),
      })
      toast.success('Chat settings updated!')
      onClose()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to update chat settings')
      onSaveFailed()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Room Settings" size="md">
      <div className="space-y-5">
        {/* Chat mode selector */}
        <div>
          <label className="text-sm font-medium text-surface-700 dark:text-night-100 mb-2 block">Who can send chat messages?</label>
          <div className="space-y-2">
            {CHAT_MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setMode(option.value)}
                className={clsx(
                  'w-full flex items-start gap-3 px-4 py-3 rounded-xl border text-left transition-all',
                  mode === option.value
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10'
                    : 'border-surface-200 dark:border-night-600 hover:border-surface-300 dark:hover:border-night-500'
                )}
              >
                <div
                  className={clsx(
                    'w-4 h-4 mt-0.5 rounded-full border-2 flex items-center justify-center shrink-0',
                    mode === option.value ? 'border-primary-500' : 'border-surface-300 dark:border-night-400'
                  )}
                >
                  {mode === option.value && <div className="w-2 h-2 rounded-full bg-primary-500" />}
                </div>
                <div>
                  <p className={clsx(
                    'text-sm font-semibold',
                    mode === option.value ? 'text-primary-600 dark:text-primary-400' : 'text-surface-900 dark:text-night-50'
                  )}>
                    {option.label}
                  </p>
                  <p className="text-xs text-surface-500 dark:text-night-200 mt-0.5">{option.description}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Member picker for SELECTED mode */}
        {mode === 'SELECTED' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-surface-700 dark:text-night-100">
                Selected members ({selectedIds.size})
              </label>
              <div className="flex items-center gap-1 text-xs text-surface-400 dark:text-night-300">
                <ShieldCheck size={12} />
                <span>Admins can always chat</span>
              </div>
            </div>
            <div className="relative mb-2">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 dark:text-night-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search members..."
                className="w-full pl-9 pr-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm bg-white dark:bg-night-850 text-surface-900 dark:text-night-50 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
              />
            </div>
            <div className="max-h-56 overflow-y-auto border border-surface-100 dark:border-night-600 rounded-xl divide-y divide-surface-50 dark:divide-night-700">
              {members.length === 0 ? (
                <div className="py-8 flex flex-col items-center justify-center gap-2 text-center">
                  <Users size={20} className="text-surface-300 dark:text-night-400" />
                  <p className="text-xs text-surface-500 dark:text-night-200">No members in this room yet</p>
                </div>
              ) : filteredMembers.length === 0 ? (
                <div className="py-6 flex flex-col items-center justify-center gap-2 text-center">
                  <SearchX size={18} className="text-surface-300 dark:text-night-400" />
                  <p className="text-xs text-surface-400 dark:text-night-300">No members match your search</p>
                </div>
              ) : (
                filteredMembers.map((member) => {
                  const isSelected = selectedIds.has(member.id)
                  return (
                    <button
                      key={member.id}
                      onClick={() => toggleMember(member.id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-surface-50 dark:bg-night-800 dark:hover:bg-night-700 transition-colors text-left"
                    >
                      <div
                        className={clsx(
                          'w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors',
                          isSelected ? 'bg-primary-500 border-primary-500' : 'border-surface-300 dark:border-night-400'
                        )}
                      >
                        {isSelected && <Check size={10} className="text-white" strokeWidth={3} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-surface-900 dark:text-night-50 truncate">{member.name}</p>
                        <p className="text-xs text-surface-400 dark:text-night-300 truncate">
                          {member.studentId ? `${member.studentId} · ` : ''}{member.email}
                        </p>
                      </div>
                      {member.isCR && (
                        <span className="px-1.5 py-0.5 text-[10px] font-bold bg-warning-100 text-warning-700 rounded-full shrink-0">
                          CR
                        </span>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-surface-100 dark:bg-night-600 text-surface-700 dark:text-night-100 rounded-xl font-medium hover:bg-surface-200 dark:hover:bg-night-500"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-gradient-to-r from-primary-500 to-primary-500 text-white rounded-xl font-medium hover:shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Save Settings
          </button>
        </div>
      </div>
    </Modal>
  )
}
