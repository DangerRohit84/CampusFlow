import { useEffect, useState } from 'react'
import { Building2, Users, DoorOpen } from 'lucide-react'
import { departmentAPI, roomAPI } from '../../lib/api'

type Scope = 'ALL' | 'DEPARTMENT' | 'ROOM'
interface Props { value: Scope; departmentId?: string | null; roomId?: string | null; onChange: (patch: { scope: Scope; departmentId?: string | null; roomId?: string | null }) => void }

export default function ScopeSelector({ value, departmentId, roomId, onChange }: Props) {
  const [departments, setDepartments] = useState<any[]>([])
  const [rooms, setRooms] = useState<any[]>([])
  useEffect(() => { if (value==='DEPARTMENT') departmentAPI.getAll().then(setDepartments).catch(()=>{}) }, [value])
  useEffect(() => { if (value==='ROOM') roomAPI.getAll({ limit: 50 }).then((r:any)=> setRooms(r.data||r)).catch(()=>{}) }, [value])
  return (
    <div className="space-y-3">
      <label className="block text-sm font-semibold text-surface-700 dark:text-[#A6B3BE]">Target Scope</label>
      <div className="flex items-center gap-1 bg-surface-100 dark:bg-[#0C1218] rounded-xl p-1 w-fit">
        {(['ALL','DEPARTMENT','ROOM'] as Scope[]).map(s => (
          <button key={s} onClick={() => onChange({ scope: s, departmentId: null, roomId: null })} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${value===s?'bg-white dark:bg-[#111920] text-surface-900 dark:text-[#F4F7F8] shadow-sm':'text-surface-500 hover:text-surface-700'}`}>
            {s==='ALL'?<Users size={14}/>:s==='DEPARTMENT'?<Building2 size={14}/>:<DoorOpen size={14}/>} {s==='ALL'?'All College':s==='DEPARTMENT'?'Department':'Room'}
          </button>
        ))}
      </div>
      {value==='DEPARTMENT' && (
        <select value={departmentId||''} onChange={e=> onChange({ scope: value, departmentId: e.target.value||null, roomId: null })} className="w-full px-4 py-3 bg-surface-50 dark:bg-[#0D151C] border border-surface-200 dark:border-[#202C35] rounded-xl text-sm">
          <option value="">Select department</option>
          {departments.map((d:any)=> <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      )}
      {value==='ROOM' && (
        <select value={roomId||''} onChange={e=> onChange({ scope: value, departmentId: null, roomId: e.target.value||null })} className="w-full px-4 py-3 bg-surface-50 dark:bg-[#0D151C] border border-surface-200 dark:border-[#202C35] rounded-xl text-sm">
          <option value="">Select room</option>
          {rooms.map((r:any)=> <option key={r.id} value={r.id}>{r.name} ({r.joinCode})</option>)}
        </select>
      )}
    </div>
  )
}
