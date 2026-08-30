import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2 } from 'lucide-react'
import clsx from 'clsx'

interface EligibilityPopupProps {
  show: boolean
  title: string
  subtitle: string
  departments: Array<{ id: string; name: string }>
  targetDepartments: string[]
  setTargetDepartments: (deps: string[]) => void
  targetYears: number[]
  setTargetYears: (years: number[]) => void
  showDepartmentMode?: boolean
  showRoomsMode?: boolean
  eligibilityMode?: 'rooms' | 'department'
  setEligibilityMode?: (mode: 'rooms' | 'department') => void
  rooms?: Array<{ id: string; name: string; memberCount?: number; _count?: { members: number } }>
  selectedRoomIds?: string[]
  toggleRoom?: (id: string) => void
  onSkip: () => void
  onConfirm: () => void
  onCancel: () => void
}

export default function EligibilityPopup({
  show, title, subtitle, departments,
  targetDepartments, setTargetDepartments,
  targetYears, setTargetYears,
  showDepartmentMode = true, showRoomsMode = false,
  eligibilityMode = 'department', setEligibilityMode,
  rooms = [], selectedRoomIds = [], toggleRoom,
  onSkip, onConfirm, onCancel
}: EligibilityPopupProps) {
  if (!show) return null

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={onCancel}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-night-800 rounded-2xl shadow-xl w-full max-w-md p-6"
          >
            <h2 className="text-lg font-bold text-surface-900 dark:text-night-50 mb-1">{title}</h2>
            <p className="text-sm text-surface-500 dark:text-night-400 mb-5">{subtitle}</p>

            {/* Mode buttons */}
            {showRoomsMode && showDepartmentMode && setEligibilityMode && (
              <div className="flex gap-3 mb-4">
                <button onClick={() => setEligibilityMode('rooms')} className={clsx('flex-1 p-3 rounded-xl border-2 transition-all', eligibilityMode === 'rooms' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-200 dark:border-night-600 hover:border-surface-300 text-surface-600 dark:text-night-300')}>
                  <div className="text-center">
                    <span className="text-2xl block mb-1">🏠</span>
                    <p className="font-semibold text-sm">Rooms</p>
                    <p className="text-xs text-surface-400 dark:text-night-400">Select specific rooms</p>
                  </div>
                </button>
                <button onClick={() => setEligibilityMode('department')} className={clsx('flex-1 p-3 rounded-xl border-2 transition-all', eligibilityMode === 'department' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-200 dark:border-night-600 hover:border-surface-300 text-surface-600 dark:text-night-300')}>
                  <div className="text-center">
                    <span className="text-2xl block mb-1">🏫</span>
                    <p className="font-semibold text-sm">Department</p>
                    <p className="text-xs text-surface-400 dark:text-night-400">Select dept + year</p>
                  </div>
                </button>
              </div>
            )}

            {/* Room selection */}
            {eligibilityMode === 'rooms' && showRoomsMode && toggleRoom && (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {rooms.length === 0 ? (
                  <p className="text-sm text-surface-400 dark:text-night-400 text-center py-4">No rooms yet. Create a room first.</p>
                ) : (
                  rooms.map(room => (
                    <label key={room.id} className="flex items-center gap-3 p-2.5 rounded-xl border hover:bg-surface-50 dark:hover:bg-night-700 dark:bg-night-800 cursor-pointer transition-all">
                      <input type="checkbox" checked={selectedRoomIds.includes(room.id)} onChange={() => toggleRoom(room.id)} className="w-4 h-4 rounded text-primary-500 focus:ring-primary-500" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-surface-800">{room.name}</p>
                        <p className="text-xs text-surface-400 dark:text-night-400">{room._count?.members || room.memberCount || 0} members</p>
                      </div>
                    </label>
                  ))
                )}
              </div>
            )}

            {/* Department selection */}
            {eligibilityMode === 'department' && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-surface-600 dark:text-night-300 mb-2 block">Departments</label>
                  <div className="flex flex-wrap gap-1.5">
                    {departments.map(d => (
                      <button key={d.id} type="button" onClick={() => setTargetDepartments(targetDepartments.includes(d.id) ? targetDepartments.filter(id => id !== d.id) : [...targetDepartments, d.id])}
                        className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium border transition-all', targetDepartments.includes(d.id) ? 'bg-primary-100 border-primary-300 text-primary-700' : 'bg-white dark:bg-night-800 border-surface-200 dark:border-night-600 text-surface-600 dark:text-night-300 hover:border-primary-200')}>
                        {d.name}
                      </button>
                    ))}
                    {departments.length === 0 && <p className="text-xs text-surface-400 dark:text-night-400">No departments created yet.</p>}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-surface-600 dark:text-night-300 mb-2 block">Years</label>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4].map(y => (
                      <button key={y} type="button" onClick={() => setTargetYears(targetYears.includes(y) ? targetYears.filter(n => n !== y) : [...targetYears, y])}
                        className={clsx('w-12 h-9 rounded-lg text-sm font-bold border transition-all', targetYears.includes(y) ? 'bg-primary-100 border-primary-300 text-primary-700' : 'bg-white dark:bg-night-800 border-surface-200 dark:border-night-600 text-surface-600 dark:text-night-300 hover:border-primary-200')}>
                        {y}
                      </button>
                    ))}
                  </div>
                </div>
                {(targetDepartments.length > 0 || targetYears.length > 0) && (
                  <div className="flex items-center gap-2 p-2.5 bg-primary-50 rounded-xl text-xs text-primary-700 font-medium">
                    <CheckCircle2 size={14} />
                    {targetDepartments.length > 0 && <span>{targetDepartments.length} dept{targetDepartments.length > 1 ? 's' : ''}</span>}
                    {targetDepartments.length > 0 && targetYears.length > 0 && <span>·</span>}
                    {targetYears.length > 0 && <span>Year {targetYears.sort().join(', ')}</span>}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3 mt-6">
              <button onClick={onSkip} className="flex-1 px-4 py-2.5 bg-surface-100 dark:bg-night-700 text-surface-700 dark:text-night-200 rounded-xl font-medium hover:bg-surface-200 text-sm">Skip — Everyone</button>
              <button onClick={onConfirm} className="flex-1 px-4 py-2.5 bg-gradient-to-r from-primary-500 to-primary-500 text-white rounded-xl font-medium hover:shadow-lg text-sm">Confirm</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
