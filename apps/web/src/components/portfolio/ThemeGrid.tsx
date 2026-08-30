import { Check } from 'lucide-react'

export type ThemeItem = { id: string; name: string }

type Props = {
  selectedId: string | null
  onSelect: (id: string) => void
}

const THEMES: ThemeItem[] = Array.from({ length: 30 }, (_, i) => ({
  id: `theme-${String(i + 1).padStart(2, '0')}`,
  name: `Theme ${i + 1}`,
}))

const gradients = [
  'from-violet-500 to-fuchsia-500',
  'from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-500',
  'from-orange-500 to-red-500',
  'from-zinc-700 to-zinc-900',
  'from-rose-500 to-pink-500',
  'from-amber-500 to-orange-500',
  'from-indigo-500 to-purple-500',
  'from-green-500 to-emerald-500',
  'from-slate-600 to-slate-800',
]

export function themeList(): ThemeItem[] {
  // keep 01,02 filtered for now per portfolio 1,2 removal request
  return THEMES.filter(t => t.id !== 'theme-01' && t.id !== 'theme-02')
}

export default function ThemeGrid({ selectedId, onSelect }: Props) {
  // Theme 01, 02 temporarily hidden per request — filtered out for now
  const visibleThemes = THEMES.filter(t => t.id !== 'theme-01' && t.id !== 'theme-02')
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {visibleThemes.map((t, idx) => {
        const selected = selectedId === t.id
        const originalIdx = THEMES.findIndex(x => x.id === t.id)
        const grad = gradients[originalIdx % gradients.length]
        return (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            className={`relative rounded-2xl overflow-hidden border-2 text-left transition-all group ${selected ? 'border-primary-600 ring-2 ring-primary-500/20' : 'border-surface-200 dark:border-night-600 hover:border-surface-300 dark:hover:border-night-500'}`}
          >
            <div className={`h-24 bg-gradient-to-br ${grad} relative flex items-center justify-center`}>
              <span className="text-white font-bold text-lg drop-shadow">{t.name.replace('Theme ', '')}</span>
              {selected && (
                <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white text-primary-600 flex items-center justify-center shadow">
                  <Check size={14} />
                </span>
              )}
              <span className="absolute bottom-1 left-2 text-[10px] font-medium text-white/90 bg-black/20 px-1.5 py-0.5 rounded-full backdrop-blur">
                {t.id}
              </span>
            </div>
            <div className={`px-3 py-2 ${selected ? 'bg-primary-50 dark:bg-primary-500/10' : 'bg-white dark:bg-night-800'}`}>
              <p className={`text-xs font-semibold truncate ${selected ? 'text-primary-700 dark:text-primary-300' : 'text-surface-900 dark:text-night-50'}`}>{t.name}</p>
              <p className="text-[11px] text-surface-500 dark:text-night-300">Porty</p>
            </div>
          </button>
        )
      })}
    </div>
  )
}