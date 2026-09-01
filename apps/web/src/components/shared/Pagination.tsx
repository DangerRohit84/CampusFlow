type Props = {
  page: number
  totalPages: number
  onChange: (p: number) => void
  /** Set false for paginating inside modals/panels (no window scroll). Default true. */
  scroll?: boolean
  /** High-scale: prefetch next page on hover (Vercel SWR pattern) — keepPreviousData already avoids flash */
  onPrefetch?: (p: number) => void
}

export default function Pagination({ page, totalPages, onChange, scroll = true, onPrefetch }: Props) {
  if (totalPages <= 1) return null

  const handle = (p: number) => {
    if (p === page) return
    onChange(p)
    if (scroll) {
      const main = document.querySelector('main')
      if (main) main.scrollTo({ top: 0, behavior: 'smooth' })
      else window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const pages: (number | string)[] = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    pages.push(1)
    if (page > 3) pages.push('...')
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i)
    if (page < totalPages - 2) pages.push('...')
    pages.push(totalPages)
  }

  return (
    <div className="flex items-center justify-center gap-1.5 py-4 mt-4">
      <button
        onClick={() => handle(Math.max(1, page - 1))}
        onMouseEnter={() => onPrefetch?.(Math.max(1, page - 1))}
        onFocus={() => onPrefetch?.(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="px-3 py-1.5 text-sm font-medium text-surface-600 dark:text-night-200 bg-surface-100 dark:bg-night-700 border border-surface-200 dark:border-night-600 rounded-lg hover:bg-surface-200 dark:hover:bg-night-600 transition-all disabled:opacity-40"
      >
        Prev
      </button>
      {pages.map((p, i) =>
        p === '...' ? (
          <span key={`dots-${i}`} className="px-2 py-1.5 text-sm text-surface-400 dark:text-night-300">...</span>
        ) : (
          <button
            key={p}
            onClick={() => handle(p as number)}
            onMouseEnter={() => onPrefetch?.(p as number)}
            onFocus={() => onPrefetch?.(p as number)}
            className={`w-9 h-9 rounded-lg text-sm font-medium transition-all border ${
              page === p
                ? 'bg-primary-500 dark:bg-success-300 text-white dark:text-night-950 border-primary-500 dark:border-success-300 shadow-sm'
                : 'text-surface-600 dark:text-night-200 bg-surface-100 dark:bg-night-700 border-surface-200 dark:border-night-600 hover:bg-surface-200 dark:hover:bg-night-600'
            }`}
          >
            {p}
          </button>
        )
      )}
      <button
        onClick={() => handle(Math.min(totalPages, page + 1))}
        onMouseEnter={() => onPrefetch?.(Math.min(totalPages, page + 1))}
        onFocus={() => onPrefetch?.(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="px-3 py-1.5 text-sm font-medium text-surface-600 dark:text-night-200 bg-surface-100 dark:bg-night-700 border border-surface-200 dark:border-night-600 rounded-lg hover:bg-surface-200 dark:hover:bg-night-600 transition-all disabled:opacity-40"
      >
        Next
      </button>
    </div>
  )
}