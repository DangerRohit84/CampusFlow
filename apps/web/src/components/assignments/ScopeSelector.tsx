import { useEffect, useState } from 'react'
import { Building2, Users, DoorOpen, Info } from 'lucide-react'
import { departmentAPI, roomAPI } from '../../lib/api'

type Scope = 'ALL' | 'DEPARTMENT' | 'ROOM'
interface Props { value: Scope; departmentId?: string | null; roomId?: string | null; onChange: (patch: { scope: Scope; departmentId?: string | null; roomId?: string | null }) => void }

export default function ScopeSelector({ value, departmentId, roomId, onChange }: Props) {
  const [departments, setDepartments] = useState<any[]>([])
  const [rooms, setRooms] = useState<any[]>([])
  const [loadingDept, setLoadingDept] = useState(false)
  const [loadingRoom, setLoadingRoom] = useState(false)

  useEffect(() => {
    if (value==='DEPARTMENT') {
      setLoadingDept(true)
      departmentAPI.getAll().then(setDepartments).catch(()=>{}).finally(()=> setLoadingDept(false))
    }
  }, [value])
  useEffect(() => {
    if (value==='ROOM') {
      setLoadingRoom(true)
      roomAPI.getAll({ limit: 50 }).then((r:any)=> setRooms(r.data||r)).catch(()=>{}).finally(()=> setLoadingRoom(false))
    }
  }, [value])

  const options: { id: Scope; title: string; plain: string; icon: any }[] = [
    { id: 'ALL', title: 'Everyone in college', plain: 'All students can see it', icon: Users },
    { id: 'DEPARTMENT', title: 'One department only', plain: 'Filter by department', icon: Building2 },
    { id: 'ROOM', title: 'One classroom only', plain: 'Filter by class/room', icon: DoorOpen },
  ]

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-semibold text-surface-700 dark:text-night-300">Who can see this assignment? <span className="text-danger-500">*</span></label>
        <p className="text-xs text-surface-500 dark:text-night-400 mt-1">Pick who the assignment is for — students outside this scope won’t see it at all.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {options.map(o => {
          const active = value===o.id
          const Icon = o.icon
          return (
            <button
              key={o.id}
              onClick={() => onChange({ scope: o.id, departmentId: null, roomId: null })}
              className={`p-3 rounded-xl border-2 text-left transition-all ${active ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 shadow-sm' : 'border-surface-200 dark:border-night-700 bg-white dark:bg-night-800 hover:border-surface-300 dark:hover:border-night-600'}`}
            >
              <Icon size={16} className={active?'text-primary-600 dark:text-primary-400':'text-surface-500'} />
              <div className={`text-sm font-semibold mt-1.5 leading-tight ${active?'text-primary-900 dark:text-primary-100':'text-surface-900 dark:text-night-50 dark:text-night-50'}`}>{o.title}</div>
              <div className={`text-xs mt-1 ${active?'text-primary-700 dark:text-primary-300':'text-surface-500'}`}>{o.plain}</div>
              {active && <div className="mt-2 text-xs font-medium text-primary-700 dark:text-primary-300">✓ Selected</div>}
            </button>
          )
        })}
      </div>

      {value==='DEPARTMENT' && (
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-surface-700 dark:text-night-300">Pick a department <span className="text-danger-500">*</span></label>
          {loadingDept ? <div className="text-xs text-surface-500 dark:text-night-400 py-2">Loading departments…</div> :
            <select value={departmentId||''} onChange={e=> onChange({ scope: value, departmentId: e.target.value||null, roomId: null })} className="w-full px-4 py-3 bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-700 rounded-xl text-sm focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-500/20">
              <option value="">— Choose department —</option>
              {departments.map((d:any)=> <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          }
          <p className="text-xs text-surface-500 dark:text-night-400">Only students in this department will get the assignment. Example: CSE, ECE, MBA.</p>
        </div>
      )}

      {value==='ROOM' && (
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-surface-700 dark:text-night-300">Pick a classroom / room <span className="text-danger-500">*</span></label>
          {loadingRoom ? <div className="text-xs text-surface-500 dark:text-night-400 py-2">Loading classrooms…</div> :
            <select value={roomId||''} onChange={e=> onChange({ scope: value, departmentId: null, roomId: e.target.value||null })} className="w-full px-4 py-3 bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-700 rounded-xl text-sm focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-500/20">
              <option value="">— Choose classroom —</option>
              {rooms.map((r:any)=> <option key={r.id} value={r.id}>{r.name} {r.joinCode?`(${r.joinCode})`:''}</option>)}
            </select>
          }
          <p className="text-xs text-surface-500 dark:text-night-400">Only members of this room will see it. Perfect for section-specific work.</p>
        </div>
      )}

      {value==='ALL' && (
        <p className="text-xs flex gap-2 p-2.5 rounded-lg bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-700 text-surface-600 dark:text-night-300"><Info size={14} className="shrink-0 mt-0.5"/> Every student in your college will see this on their Assignments page.</p>
      )}
    </div>
  )
}
