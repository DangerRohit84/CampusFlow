import { Upload, Building2, Layers } from 'lucide-react'
type Mode = 'ONLINE'|'OFFLINE'|'HYBRID'
interface Props { value: Mode; onChange: (m: Mode)=> void }
const opts: { id: Mode; title: string; plain: string; detail: string; icon: any }[] = [
  { id: 'ONLINE', title: 'Online only', plain: 'Upload file or type answer', detail: 'Students upload files or type text right here. You grade online.', icon: Upload },
  { id: 'OFFLINE', title: 'In-person only', plain: 'Hand in physical copy', detail: 'No upload. Students bring paper / lab work to class.', icon: Building2 },
  { id: 'HYBRID', title: 'Either is OK', plain: 'Online or in-person', detail: 'Students choose: upload online OR hand in offline.', icon: Layers },
]
export default function SubmissionModeToggle({ value, onChange }: Props) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-semibold text-surface-700 dark:text-[#A6B3BE]">How will students submit? <span className="text-danger-500">*</span></label>
      <p className="text-xs text-surface-500 dark:text-night-400">Tell students how to hand in their work — this shows as an instruction on their card.</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {opts.map(o => {
          const active = value===o.id
          const Icon = o.icon
          return (
            <button key={o.id} onClick={()=> onChange(o.id)} className={`p-4 rounded-xl border-2 text-left transition-all ${active?'border-primary-500 bg-primary-50 dark:bg-primary-900/20 shadow-sm':'border-surface-200 dark:border-[#202C35] bg-white dark:bg-[#111920] hover:border-surface-300 dark:hover:border-[#2A3A44]'}`}>
              <Icon size={18} className={active?'text-primary-600 dark:text-primary-400':'text-surface-500'} />
              <div className={`text-sm font-bold mt-2 ${active?'text-primary-900 dark:text-primary-100':'text-surface-900 dark:text-night-50 dark:text-[#F4F7F8]'}`}>{o.title}</div>
              <div className={`text-xs font-medium mt-1 ${active?'text-primary-700 dark:text-primary-300':'text-surface-600 dark:text-[#A6B3BE]'}`}>{o.plain}</div>
              <div className={`text-xs mt-1.5 leading-relaxed ${active?'text-primary-700/80 dark:text-primary-300/80':'text-surface-500'}`}>{o.detail}</div>
              {active && <div className="mt-3 text-xs font-semibold text-primary-700 dark:text-primary-300">✓ Selected</div>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
