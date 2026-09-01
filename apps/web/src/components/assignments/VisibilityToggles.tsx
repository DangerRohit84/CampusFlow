type Flags = { showGrades: boolean; showFeedback: boolean; showSubmissionStatus: boolean; showStats: boolean }
interface Props { values: Flags; onChange: (patch: Partial<Flags>)=> void }
const items: { key: keyof Flags; title: string; plain: string; detail: string }[] = [
  { key: 'showGrades', title: 'Show grades', plain: 'Let students see their score', detail: 'After you grade, they see e.g. 42 / 50' },
  { key: 'showFeedback', title: 'Show feedback', plain: 'Let students read your comments', detail: 'Your written feedback is visible to the student' },
  { key: 'showSubmissionStatus', title: 'Show submission status', plain: 'Show “Submitted / Graded / Late”', detail: 'Students see a badge for their own submission' },
  { key: 'showStats', title: 'Show class stats', plain: 'Share class submission counts', detail: 'Students see how many classmates submitted' },
]
export default function VisibilityToggles({ values, onChange }: Props) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-semibold text-surface-700 dark:text-night-300">What can students see?</label>
        <p className="text-xs text-surface-500 dark:text-night-400 mt-1">You control what students see before and after you grade. Change anytime — even after grading.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map(it => (
          <label key={it.key} className={`flex items-start justify-between gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition-all ${values[it.key] ? 'border-primary-200 dark:border-primary-800 bg-primary-50/50 dark:bg-primary-900/10' : 'border-surface-200 dark:border-night-700 bg-white dark:bg-night-800 '}`}>
            <div className="flex-1 min-w-0">
              <div className={`text-sm font-semibold ${values[it.key] ? 'text-primary-900 dark:text-primary-100' : 'text-surface-900 dark:text-night-50 dark:text-night-50'}`}>{it.title}</div>
              <div className={`text-xs font-medium ${values[it.key] ? 'text-primary-700 dark:text-primary-300' : 'text-surface-600 dark:text-night-300'}`}>{it.plain}</div>
              <div className="text-xs text-surface-500 dark:text-night-400 mt-1 leading-relaxed">{it.detail}</div>
            </div>
            <span className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${values[it.key] ? 'bg-primary-600' : 'bg-surface-200 dark:bg-night-600'}`}>
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${values[it.key] ? 'translate-x-5' : 'translate-x-0'}`} />
              <input type="checkbox" checked={values[it.key]} onChange={e=> onChange({ [it.key]: e.target.checked } as any)} className="sr-only" />
            </span>
          </label>
        ))}
      </div>
      <p className="text-xs text-surface-500 dark:text-night-400">Tip: Hide grades while you’re still grading, then turn “Show grades” on when ready.</p>
    </div>
  )
}
