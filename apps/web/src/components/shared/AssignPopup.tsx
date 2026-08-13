import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, X, UserCheck, Loader2, Undo2, Check } from 'lucide-react'
import clsx from 'clsx'

interface Teacher {
  id: string
  name: string
  email: string
}

interface AssignPopupProps {
  show: boolean
  onClose: () => void
  teachers: Teacher[]
  onAssign: (teacherId: string) => void
  onUnassign?: () => void
  loading?: boolean
  opportunityTitle?: string
  assignedToId?: string | null
}

export default function AssignPopup({ show, onClose, teachers, onAssign, onUnassign, loading, opportunityTitle, assignedToId }: AssignPopupProps) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return teachers
    const q = search.toLowerCase()
    return teachers.filter(t => t.name.toLowerCase().includes(q) || t.email.toLowerCase().includes(q))
  }, [teachers, search])

  const assignedTeacher = assignedToId ? teachers.find(t => t.id === assignedToId) : null

  if (!show) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-surface-100">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary-100 flex items-center justify-center">
                <UserCheck size={18} className="text-primary-600" />
              </div>
              <div>
                <h3 className="font-bold text-surface-900 text-sm">Assign to Teacher</h3>
                {opportunityTitle && (
                  <p className="text-xs text-surface-400 truncate max-w-[220px]">{opportunityTitle}</p>
                )}
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-100 text-surface-400 transition-colors">
              <X size={16} />
            </button>
          </div>

          {/* Currently Assigned */}
          {assignedTeacher && (
            <div className="px-5 pt-4">
              <div className="flex items-center justify-between p-3 bg-primary-50 rounded-xl border border-primary-100">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
                    {assignedTeacher.name?.charAt(0)?.toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-primary-600 font-medium">Currently Assigned</p>
                    <p className="font-medium text-surface-900 text-sm truncate">{assignedTeacher.name}</p>
                  </div>
                </div>
                {onUnassign && (
                  <button
                    onClick={onUnassign}
                    disabled={loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-red-200 text-red-600 rounded-lg text-xs font-medium hover:bg-red-50 transition-all disabled:opacity-50 shrink-0"
                  >
                    {loading ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />}
                    Undo
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Search */}
          <div className="px-5 pt-4">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
              <input
                type="text"
                placeholder="Search teachers..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-surface-200 bg-surface-50 text-sm text-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                autoFocus
              />
            </div>
          </div>

          {/* Teacher List */}
          <div className="px-3 py-3 max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-surface-400">
                {search ? 'No teachers match your search' : 'No teachers found'}
              </div>
            ) : (
              <div className="space-y-0.5">
                {filtered.map((t) => {
                  const isAssigned = t.id === assignedToId
                  return (
                    <div
                      key={t.id}
                      className={clsx(
                        'w-full text-left px-3 py-2.5 rounded-xl transition-all flex items-center gap-3 group',
                        isAssigned ? 'bg-primary-50' : 'hover:bg-surface-50'
                      )}
                    >
                      <div className={clsx(
                        'w-8 h-8 rounded-full text-white flex items-center justify-center text-xs font-bold shrink-0',
                        isAssigned ? 'bg-primary-500' : 'bg-gradient-to-br from-primary-500 to-accent-500'
                      )}>
                        {t.name?.charAt(0)?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={clsx('font-medium text-sm', isAssigned ? 'text-primary-700' : 'text-surface-900')}>{t.name}</p>
                        <p className="text-xs text-surface-400 truncate">{t.email}</p>
                      </div>
                      {isAssigned ? (
                        <span className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-primary-600 shrink-0">
                          <Check size={12} />
                          Assigned
                        </span>
                      ) : (
                        <button
                          onClick={() => onAssign(t.id)}
                          disabled={loading}
                          className="px-3 py-1.5 bg-surface-100 text-surface-700 rounded-lg text-xs font-medium hover:bg-primary-100 hover:text-primary-700 transition-all disabled:opacity-50 shrink-0"
                        >
                          Assign
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
