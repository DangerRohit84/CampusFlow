type Flags = { showGrades: boolean; showFeedback: boolean; showSubmissionStatus: boolean; showStats: boolean }
interface Props { values: Flags; onChange: (patch: Partial<Flags>)=> void }
const items: { key: keyof Flags; label: string; desc: string }[] = [
  { key: 'showGrades', label: 'Show grades', desc: 'Students see points/grade after grading' },
  { key: 'showFeedback', label: 'Show feedback', desc: 'Students see written feedback' },
  { key: 'showSubmissionStatus', label: 'Show submission status', desc: 'Students see SUBMITTED/GRADED/LATE badge' },
  { key: 'showStats', label: 'Show stats', desc: 'Students see class submission stats' },
]
export default function VisibilityToggles({ values, onChange }: Props) {
  return (
    <div className="space-y-3">
      <label className="block text-sm font-semibold text-surface-700 dark:text-[#A6B3BE]">Teacher Visibility Controls</label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map(it => (
          <label key={it.key} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-surface-200 dark:border-[#202C35] bg-white dark:bg-[#111920]">
            <div><div className="text-sm font-medium text-surface-900 dark:text-[#F4F7F8]">{it.label}</div><div className="text-xs text-surface-500">{it.desc}</div></div>
            <input type="checkbox" checked={values[it.key]} onChange={e=> onChange({ [it.key]: e.target.checked } as any)} className="w-11 h-6 rounded-full appearance-none bg-surface-200 dark:bg-[#202C35] checked:bg-primary-600 relative before:content-[''] before:absolute before:w-5 before:h-5 before:bg-white before:rounded-full before:top-0.5 before:left-0.5 checked:before:translate-x-5 transition-all" />
          </label>
        ))}
      </div>
    </div>
  )
}
