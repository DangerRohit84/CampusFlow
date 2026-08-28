import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Search as SearchIcon, Calendar, BookOpen, Bell, ArrowRight, Sparkles } from 'lucide-react'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import { searchAPI } from '../lib/api'

const typeIcons: Record<string, React.ElementType> = {
  schedule: Calendar,
  assignment: BookOpen,
  notification: Bell,
}

const typeColors: Record<string, string> = {
  schedule: 'bg-primary-100 text-primary-600',
  assignment: 'bg-primary-100 text-primary-600',
  notification: 'bg-warning-100 text-warning-600',
}

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    if (query.length < 2) { setResults([]); return }
    const timer = setTimeout(() => {
      setLoading(true)
      searchAPI.search(query).then((data) => { setResults(data.results); setSearched(true) }).catch(console.error).finally(() => setLoading(false))
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 max-w-3xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="font-display text-xl font-extrabold text-surface-900 leading-none">Search</h1>
        <p className="text-surface-500 mt-1">Find schedules, assignments, notifications, and more</p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <div className="relative">
          <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-surface-400" size={20} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for anything... (e.g. 'Data Structures', 'ML project', 'exam')"
            className="w-full pl-12 pr-4 py-4 bg-white border border-surface-200 rounded-2xl text-surface-900 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all text-lg shadow-soft"
            autoFocus
          />
          {loading && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2">
              <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
      </motion.div>

      {searched && !loading && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <p className="text-sm text-surface-500">{results.length} result{results.length !== 1 ? 's' : ''} found</p>

          {results.length === 0 ? (
            <Card className="text-center py-12">
              <div className="w-16 h-16 bg-surface-100 rounded-2xl flex items-center justify-center mx-auto mb-4"><SearchIcon className="w-8 h-8 text-surface-400" /></div>
              <p className="text-surface-500 font-medium">No results found</p>
              <p className="text-sm text-surface-400 mt-1">Try different keywords</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {results.map((r: any, i: number) => {
                const Icon = typeIcons[r.type] || Bell
                return (
                  <motion.div key={`${r.type}-${r.id}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                    <Card hover className="group cursor-pointer">
                      <div className="flex items-center gap-4">
                        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${typeColors[r.type] || typeColors.notification}`}>
                          <Icon size={20} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-surface-900 group-hover:text-primary-700 transition-colors truncate">{r.title}</h3>
                            <Badge variant={r.type === 'schedule' ? 'primary' : r.type === 'assignment' ? 'accent' : 'warning'}>{r.type}</Badge>
                          </div>
                          <p className="text-sm text-surface-500 truncate">{r.subtitle}</p>
                        </div>
                        <ArrowRight size={16} className="text-surface-400 group-hover:text-primary-500 transition-colors shrink-0" />
                      </div>
                    </Card>
                  </motion.div>
                )
              })}
            </div>
          )}
        </motion.div>
      )}

      {!searched && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="text-center py-16">
          <div className="w-20 h-20 bg-gradient-to-br from-primary-100 to-primary-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Sparkles className="w-10 h-10 text-primary-500" />
          </div>
          <h3 className="text-lg font-bold text-surface-900 mb-2">AI-Powered Search</h3>
          <p className="text-surface-500 max-w-md mx-auto">Search across your schedules, assignments, and notifications. Try searching for a course name, assignment topic, or any keyword.</p>
          <div className="flex flex-wrap justify-center gap-2 mt-6">
            {['Data Structures', 'Machine Learning', 'exam', 'deadline'].map((s) => (
              <button key={s} onClick={() => setQuery(s)} className="px-4 py-2 bg-surface-100 hover:bg-surface-200 rounded-xl text-sm font-medium text-surface-600 transition-colors">{s}</button>
            ))}
          </div>
        </motion.div>
      )}
    </motion.div>
  )
}