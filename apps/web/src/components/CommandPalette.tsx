import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, CalendarDays, Sparkles, FileText, Trophy, UserCheck,
  Bell, Search, Lightbulb, Briefcase, Globe, Settings, X, type LucideIcon,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { searchAPI } from '../lib/api'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useDebounce } from '../hooks/useDebounce'

interface PaletteEntry {
  path: string
  label: string
  icon: LucideIcon
}

const pages: PaletteEntry[] = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/schedule', label: 'Schedule', icon: CalendarDays },
  { path: '/chat', label: 'AI Assistant', icon: Sparkles },
  { path: '/assignments', label: 'Assignments', icon: FileText },
  { path: '/grades', label: 'Grades', icon: Trophy },
  { path: '/attendance', label: 'Attendance', icon: UserCheck },
  { path: '/notifications', label: 'Notifications', icon: Bell },
  { path: '/search', label: 'Search', icon: Search },
  { path: '/insights', label: 'AI Insights', icon: Lightbulb },
  { path: '/resume-studio', label: 'Resume Studio', icon: FileText },
  { path: '/portfolio-studio', label: 'Portfolio Studio', icon: Globe },
  { path: '/internships', label: 'Internships', icon: Briefcase },
  { path: '/settings', label: 'Settings', icon: Settings },
]

function resultIcon(type: string): LucideIcon {
  if (type === 'schedule') return CalendarDays
  if (type === 'assignment') return FileText
  return Bell
}

export default function CommandPalette({ open: externalOpen, onClose }: { open?: boolean; onClose?: () => void } = {}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = externalOpen !== undefined ? externalOpen : internalOpen
  const setOpen = (val: boolean) => {
    if (externalOpen !== undefined) {
      if (!val) onClose?.()
    } else {
      setInternalOpen(val)
    }
  }
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const navigate = useNavigate()
  // WHY: modal dialog must trap focus + restore to trigger on close (WCAG 2.4.3). useFocusTrap handles Tab wrap + restore.
  useFocusTrap(dialogRef as any, open)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setOpen(true) }
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setActiveIndex(0)
      // Focus the combobox when the palette opens.
      const t = window.setTimeout(() => inputRef.current?.focus(), 30)
      return () => window.clearTimeout(t)
    }
  }, [open])

  // P0-D search discipline (GitHub/Stripe instant-search pattern): the raw
  // 200ms setTimeout fired per keystroke with no cancellation — typing
  // "hackathon" (9 keys) stacked up to 9 overlapping GETs that resolved
  // out-of-order (stale results winning). Now: 300ms debounce (1 GET per
  // pause) + AbortController (stale in-flight cancelled, never stacks) +
  // min-length 2 (matches SearchPage + backend 400 guard).
  const debouncedQuery = useDebounce(query, 300)
  useEffect(() => {
    const q = debouncedQuery.trim()
    if (q.length < 2) { setResults([]); return }
    const controller = new AbortController()
    searchAPI.search(q, controller.signal).then((data) => setResults(data.results || [])).catch(() => setResults([]))
    return () => controller.abort()
  }, [debouncedQuery])

  const filteredPages = pages.filter((p) => p.label.toLowerCase().includes(query.toLowerCase()))

  // WHY: one flat option list drives ArrowUp/Down + Enter + aria-activedescendant
  // (combobox pattern) so keyboard and screen-reader users get the same palette.
  const options = useMemo(() => {
    if (query.length < 2) return filteredPages.map((p) => ({ key: p.path, path: p.path, title: p.label, subtitle: 'Page', icon: p.icon }))
    const pageOpts = filteredPages.map((p) => ({ key: p.path, path: p.path, title: p.label, subtitle: 'Page', icon: p.icon }))
    const resOpts = results.slice(0, 5).map((r: any) => ({
      key: `${r.type}-${r.id}`,
      path: r.type === 'schedule' ? '/schedule' : r.type === 'assignment' ? '/assignments' : '/notifications',
      title: String(r.title ?? 'Result'),
      subtitle: String(r.subtitle ?? r.type ?? ''),
      icon: resultIcon(String(r.type ?? '')),
    }))
    return [...pageOpts, ...resOpts]
  }, [query, filteredPages, results])

  useEffect(() => { setActiveIndex(0) }, [query])

  const handleSelect = (path: string) => { navigate(path); setOpen(false); setQuery('') }

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, Math.max(options.length - 1, 0))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const opt = options[activeIndex]; if (opt) handleSelect(opt.path) }
  }

  if (!open) return null
  const activeId = options.length > 0 ? `${listId}-opt-${activeIndex}` : undefined

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} aria-hidden="true" />
        <motion.div
          ref={dialogRef}
          initial={{ opacity: 0, scale: 0.95, y: -10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95 }}
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          className="relative w-full max-w-lg bg-white dark:bg-night-800 rounded-2xl shadow-2xl overflow-hidden"
        >
          <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-100 dark:border-night-600">
            <Search size={20} className="text-surface-400 dark:text-night-400 shrink-0" aria-hidden="true" />
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={activeId}
              aria-label="Search pages and campus content"
              aria-autocomplete="list"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Search pages, schedules, assignments..."
              className="flex-1 text-sm bg-transparent text-surface-900 dark:text-night-50 placeholder-surface-400 focus:outline-none min-h-[44px]"
            />
            <button
              onClick={() => setOpen(false)}
              aria-label="Close command palette"
              className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-xl text-surface-400 hover:text-surface-600 hover:bg-surface-100 dark:hover:bg-night-700 transition-colors"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto p-2">
            {options.length === 0 ? (
              <p className="text-center py-8 text-surface-400 dark:text-night-400 text-sm" role="status">No results found</p>
            ) : (
              <div role="listbox" id={listId} aria-label={query.length < 2 ? 'Quick navigation' : 'Search results'} className="py-2">
                {query.length < 2 && (
                  <p className="text-xs font-semibold text-surface-400 dark:text-night-400 uppercase tracking-wider mb-1 px-3" aria-hidden="true">Quick Navigation</p>
                )}
                {options.map((o, i) => {
                  const Icon = o.icon
                  const active = i === activeIndex
                  return (
                    <button
                      key={o.key}
                      id={`${listId}-opt-${i}`}
                      role="option"
                      aria-selected={active}
                      onClick={() => handleSelect(o.path)}
                      onMouseMove={() => setActiveIndex(i)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-left transition-colors min-h-[44px] ${active ? 'bg-surface-100 dark:bg-night-700 text-surface-900 dark:text-night-50' : 'text-surface-700 dark:text-night-200'}`}
                    >
                      <Icon size={16} className="shrink-0 text-surface-400 dark:text-night-400" aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block font-medium truncate">{o.title}</span>
                        {o.subtitle && o.subtitle !== 'Page' && (
                          <span className="block text-xs text-surface-400 dark:text-night-400 truncate">{o.subtitle}</span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
