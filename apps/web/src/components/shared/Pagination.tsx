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
    <nav aria-label="Pagination" className="flex items-center justify-center gap-1.5 py-4 mt-4">
      <button
        onClick={() => handle(Math.max(1, page - 1))}
        onMouseEnter={() => onPrefetch?.(Math.max(1, page - 1))}
        onFocus={() => onPrefetch?.(Math.max(1, page - 1))}
        disabled={page <= 1}
        aria-disabled={page <= 1}
        aria-label="Go to previous page"
        className="px-4 min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-sm font-medium text-surface-600 dark:text-night-200 bg-surface-100 dark:bg-night-700 border border-surface-200 dark:border-night-600 rounded-lg hover:bg-surface-200 dark:hover:bg-night-600 transition-all disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
      >
        Prev
      </button>
      {pages.map((p, i) =>
        p === '...' ? (
          <span key={`dots-${i}`} aria-hidden="true" className="px-2 py-1.5 text-sm text-surface-400 dark:text-night-300">...</span>
        ) : (
          <button
            key={p}
            onClick={() => handle(p as number)}
            onMouseEnter={() => onPrefetch?.(p as number)}
            onFocus={() => onPrefetch?.(p as number)}
            aria-label={`Go to page ${p}`}
            aria-current={page === p ? 'page' : undefined}
            // WHY: WCAG 2.5.8 — 44px targets (was w-9 h-9 36px, fails). Active uses black text on green (white-on-#1ed760 fails AA).
            className={`min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-sm font-medium transition-all border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ${
              page === p
                ? 'bg-primary-500 dark:bg-success-300 text-black dark:text-black border-primary-600 dark:border-success-300 shadow-sm'
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
        aria-disabled={page >= totalPages}
        aria-label="Go to next page"
        className="px-4 min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-sm font-medium text-surface-600 dark:text-night-200 bg-surface-100 dark:bg-night-700 border border-surface-200 dark:border-night-600 rounded-lg hover:bg-surface-200 dark:hover:bg-night-600 transition-all disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
      >
        Next
      </button>
    </nav>
  )
}