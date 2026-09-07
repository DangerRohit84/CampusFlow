import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Calendar, BookOpen, Bell, MessageSquare, Award, Target, Settings, BarChart3, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { searchAPI } from '../lib/api'

const pages = [
  { path: '/dashboard', label: 'Dashboard', icon: '📊' },
  { path: '/schedule', label: 'Schedule', icon: '📅' },
  { path: '/chat', label: 'AI Assistant', icon: '🤖' },
  { path: '/assignments', label: 'Assignments', icon: '📝' },
  { path: '/grades', label: 'Grades', icon: '🏆' },
  { path: '/attendance', label: 'Attendance', icon: '✅' },
  { path: '/notifications', label: 'Notifications', icon: '🔔' },
  { path: '/search', label: 'Search', icon: '🔍' },
  { path: '/insights', label: 'AI Insights', icon: '💡' },
  { path: '/resume-studio', label: 'Resume Studio', icon: '📄' },
  { path: '/portfolio-studio', label: 'Portfolio Studio', icon: '🌐' },
  { path: '/settings', label: 'Settings', icon: '⚙️' },
]

export default function CommandPalette({ open: externalOpen, onClose }: { open?: boolean; onClose?: () => void } = {}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = externalOpen !== undefined ? externalOpen : internalOpen
  const setOpen = (val: boolean) => {
    if (externalOpen !== undefined) {
      onClose?.()
    } else {
      setInternalOpen(val)
    }
  }
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setOpen(true) }
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (query.length < 2) { setResults([]); return }
    const timer = setTimeout(() => {
      searchAPI.search(query).then((data) => setResults(data.results || [])).catch(() => setResults([]))
    }, 200)
    return () => clearTimeout(timer)
  }, [query])

  const filteredPages = pages.filter((p) => p.label.toLowerCase().includes(query.toLowerCase()))

  const handleSelect = (path: string) => { navigate(path); setOpen(false); setQuery('') }

  if (!open) return null

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
        <motion.div initial={{ opacity: 0, scale: 0.95, y: -10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-lg bg-white dark:bg-night-800 rounded-2xl shadow-2xl overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-100 dark:border-night-600">
            <Search size={20} className="text-surface-400 dark:text-night-400 shrink-0" />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search pages, schedules, assignments..." className="flex-1 text-sm text-surface-900 dark:text-night-50 placeholder-surface-400 focus:outline-none" />
            <kbd className="px-1.5 py-0.5 bg-surface-100 dark:bg-night-700 border border-surface-200 dark:border-night-600 rounded text-[10px] text-surface-400 dark:text-night-400 font-mono">ESC</kbd>
          </div>

          <div className="max-h-80 overflow-y-auto p-2">
            {query.length < 2 ? (
              <div className="py-3 px-3">
                <p className="text-xs font-semibold text-surface-400 dark:text-night-400 uppercase tracking-wider mb-2 px-2">Quick Navigation</p>
                {filteredPages.map((p) => (
                  <button key={p.path} onClick={() => handleSelect(p.path)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-surface-700 dark:text-night-200 hover:bg-surface-100 dark:hover:bg-night-700 transition-colors text-left dark:bg-[#1e1e1e]">
                    <span className="text-base">{p.icon}</span>{p.label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="py-2">
                {filteredPages.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs font-semibold text-surface-400 dark:text-night-400 uppercase tracking-wider mb-1 px-3">Pages</p>
                    {filteredPages.map((p) => (
                      <button key={p.path} onClick={() => handleSelect(p.path)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-surface-700 dark:text-night-200 hover:bg-surface-100 dark:hover:bg-night-700 transition-colors text-left dark:bg-[#1e1e1e]">
                        <span className="text-base">{p.icon}</span>{p.label}
                      </button>
                    ))}
                  </div>
                )}
                {results.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-surface-400 dark:text-night-400 uppercase tracking-wider mb-1 px-3">Search Results</p>
                    {results.slice(0, 5).map((r: any) => (
                      <button key={`${r.type}-${r.id}`} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-surface-700 dark:text-night-200 hover:bg-surface-100 dark:hover:bg-night-700 transition-colors text-left dark:bg-[#1e1e1e]">
                        <span className="text-base">{r.type === 'schedule' ? '📅' : r.type === 'assignment' ? '📝' : '🔔'}</span>
                        <div className="min-w-0"><p className="font-medium truncate">{r.title}</p><p className="text-xs text-surface-400 dark:text-night-400 truncate">{r.subtitle}</p></div>
                      </button>
                    ))}
                  </div>
                )}
                {filteredPages.length === 0 && results.length === 0 && (
                  <p className="text-center py-8 text-surface-400 dark:text-night-400 text-sm">No results found</p>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
