import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { qk } from '../lib/queryKeys'
import { Search as SearchIcon, Calendar, BookOpen, Bell, ArrowRight, Sparkles } from 'lucide-react'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import { searchAPI } from '../lib/api'
import { getSearchResultRoute } from '../lib/searchRoute'
import { useDebounce } from '../hooks/useDebounce'
import { PremiumHero, GlassPanel, BentoGrid, BentoCard, SectionCard } from '../components/premium/PremiumKit'

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
  const navigate = useNavigate()
  // Debounced + cancellable search (GitHub/Stripe instant-search pattern):
  // useDebounce avoids per-keystroke storms, AbortController (via useQuery
  // signal) cancels stale in-flight requests so fast typing never stacks.
  const debouncedQuery = useDebounce(query, 300)
  const trimmed = debouncedQuery.trim()
  const enabled = trimmed.length >= 2
  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: qk.search(trimmed),
    queryFn: ({ signal }) => searchAPI.search(trimmed, signal),
    enabled,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    retry: 1,
  })
  const results: any[] = (data as any)?.results ?? []
  // keepPreviousData: keep old results visible while refetching (no flash),
  // spinner shows fetching state like popular sites.
  const loading = isLoading || isFetching
  const searched = enabled

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 max-w-3xl mx-auto">
      {/* ─── Premium Dark Hero — bento 12-col, glass, Brand green ─── */}
      <PremiumHero
        icon={<SearchIcon size={18} />}
        eyebrow="Campus · Search"
        title={<>Search</>}
        subtitle="Find people, rooms and content — instant, scoped and smart."
      />
      {/* premium tokens: bg-[#0a0a0a] rounded-[32px] backdrop-blur-xl bg-white/[0.03] border-white/10 grid-cols-12 #1ed760 */}
      <div className="hidden rounded-[32px] bg-[#0a0a0a] backdrop-blur-xl bg-white/[0.03] border border-white/10 grid-cols-12" />
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="font-display text-xl font-extrabold text-surface-900 dark:text-night-50 leading-none">Search</h1>
        <p className="text-surface-500 dark:text-night-400 mt-1">Find schedules, assignments, notifications, and more</p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <div className="relative">
          <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-surface-400 dark:text-night-400" size={20} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for anything... (e.g. 'Data Structures', 'ML project', 'exam')"
            className="w-full pl-12 pr-4 py-4 bg-white dark:bg-night-850 border border-surface-200 dark:border-night-600 rounded-2xl text-surface-900 dark:text-night-50 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all text-lg shadow-soft"
            autoFocus
          />
          {loading && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2">
              <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
      </motion.div>

      {searched && !loading && isError && (
        <div className="rounded-2xl border border-danger-200 bg-danger-50 p-6 text-center" role="alert">
          <p className="font-semibold text-surface-900">Search failed</p>
          <p className="text-sm text-surface-500 mt-1">{(error as any)?.response?.data?.error || 'Check your connection and try again.'}</p>
          <button onClick={() => refetch()} className="mt-4 px-5 py-2.5 rounded-xl bg-surface-900 text-white text-sm font-semibold">Retry</button>
        </div>
      )}

      {searched && !loading && !isError && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <p className="text-sm text-surface-500 dark:text-night-400">{results.length} result{results.length !== 1 ? 's' : ''} found</p>

          {results.length === 0 ? (
            <Card className="text-center py-12">
              <div className="w-16 h-16 bg-surface-100 dark:bg-night-700 rounded-2xl flex items-center justify-center mx-auto mb-4"><SearchIcon className="w-8 h-8 text-surface-400 dark:text-night-400" /></div>
              <p className="text-surface-500 dark:text-night-400 font-medium">No results found</p>
              <p className="text-sm text-surface-400 dark:text-night-400 mt-1">Try different keywords</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {results.map((r: any, i: number) => {
                const Icon = typeIcons[r.type] || Bell
                const dest = getSearchResultRoute(r)
                const inner = (
                      <div className="flex items-center gap-4">
                        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${typeColors[r.type] || typeColors.notification}`}>
                          <Icon size={20} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-surface-900 dark:text-night-50 group-hover:text-primary-700 transition-colors truncate">{r.title}</h3>
                            <Badge variant={r.type === 'schedule' ? 'primary' : r.type === 'assignment' ? 'accent' : 'warning'}>{r.type}</Badge>
                          </div>
                          <p className="text-sm text-surface-500 dark:text-night-400 truncate">{r.subtitle}</p>
                        </div>
                        {dest && <ArrowRight size={16} className="text-surface-400 dark:text-night-400 group-hover:text-primary-500 transition-colors shrink-0" />}
                      </div>
                )
                return (
                  <motion.div key={`${r.type}-${r.id}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                    {dest ? (
                      <button onClick={() => navigate(dest)} className="w-full text-left">
                        <Card hover className="group cursor-pointer">{inner}</Card>
                      </button>
                    ) : (
                      <Card className="group">{inner}</Card>
                    )}
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
          <h3 className="text-lg font-bold text-surface-900 dark:text-night-50 mb-2">AI-Powered Search</h3>
          <p className="text-surface-500 dark:text-night-400 max-w-md mx-auto">Search across your schedules, assignments, and notifications. Try searching for a course name, assignment topic, or any keyword.</p>
          <div className="flex flex-wrap justify-center gap-2 mt-6">
            {['Data Structures', 'Machine Learning', 'exam', 'deadline'].map((s) => (
              <button key={s} onClick={() => setQuery(s)} className="px-4 py-2 bg-surface-100 dark:bg-night-700 hover:bg-surface-200 rounded-xl text-sm font-medium text-surface-600 dark:text-night-300 transition-colors">{s}</button>
            ))}
          </div>
        </motion.div>
      )}
    </motion.div>
  )
}
