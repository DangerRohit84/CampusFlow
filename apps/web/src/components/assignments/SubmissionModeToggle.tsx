import { Upload, Building2, Layers } from 'lucide-react'
type Mode = 'ONLINE'|'OFFLINE'|'HYBRID'
interface Props { value: Mode; onChange: (m: Mode)=> void }
const opts: { id: Mode; label: string; desc: string; icon: any }[] = [
  { id: 'ONLINE', label: 'Online', desc: 'Upload file or text', icon: Upload },
  { id: 'OFFLINE', label: 'Offline', desc: 'Submit in person', icon: Building2 },
  { id: 'HYBRID', label: 'Hybrid', desc: 'Either online or offline', icon: Layers },
]
export default function SubmissionModeToggle({ value, onChange }: Props) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-semibold text-surface-700 dark:text-[#A6B3BE]">Submission Mode</label>
      <div className="grid grid-cols-3 gap-3">
        {opts.map(o => (
          <button key={o.id} onClick={()=> onChange(o.id)} className={`p-4 rounded-xl border text-left transition-all ${value===o.id?'border-primary-500 bg-primary-50 dark:bg-primary-900/20':'border-surface-200 dark:border-[#202C35] bg-white dark:bg-[#111920] hover:border-surface-300'}`}>
            <o.icon size={18} className={value===o.id?'text-primary-600':'text-surface-500'} />
            <div className={`text-sm font-semibold mt-2 ${value===o.id?'text-primary-700 dark:text-primary-400':'text-surface-900 dark:text-[#F4F7F8]'}`}>{o.label}</div>
            <div className="text-xs text-surface-500 mt-1">{o.desc}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
