export default function Skeleton({ className = '', lines = 1 }: { className?: string; lines?: number }) {
  // WHY: skeletons are decorative placeholders — hide from AT (the real
  // content announces via role=status loaders or the loaded region itself).
  return (
    <div aria-hidden="true" className={`animate-pulse space-y-3 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-4 bg-surface-200 rounded-lg dark:bg-[#282828]" style={{ width: `${70 + Math.random() * 30}%` }} />
      ))}
    </div>
  )
}

export function CardSkeleton() {
  return (
    <div aria-hidden="true" className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-6 animate-pulse">
      <div className="flex items-start justify-between">
        <div className="space-y-3 flex-1">
          <div className="h-4 bg-surface-200 rounded-lg w-1/3 dark:bg-[#282828]" />
          <div className="h-8 bg-surface-200 rounded-lg w-1/4 dark:bg-[#282828]" />
          <div className="h-3 bg-surface-200 rounded-lg w-1/5 dark:bg-[#282828]" />
        </div>
        <div className="w-12 h-12 bg-surface-200 rounded-xl dark:bg-[#282828]" />
      </div>
    </div>
  )
}

export function ListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div aria-hidden="true" className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-5 animate-pulse">
          <div className="flex items-center gap-4">
            <div className="w-1 h-12 bg-surface-200 rounded-full dark:bg-[#282828]" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-surface-200 rounded-lg w-2/3 dark:bg-[#282828]" />
              <div className="h-3 bg-surface-200 rounded-lg w-1/3 dark:bg-[#282828]" />
            </div>
            <div className="w-16 h-8 bg-surface-200 rounded-lg dark:bg-[#282828]" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function StatSkeleton() {
  return (
    <div aria-hidden="true" className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-6 animate-pulse">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-3 bg-surface-200 rounded w-20 dark:bg-[#282828]" />
          <div className="h-8 bg-surface-200 rounded w-16 dark:bg-[#282828]" />
        </div>
        <div className="w-12 h-12 bg-surface-200 rounded-xl dark:bg-[#282828]" />
      </div>
    </div>
  )
}
