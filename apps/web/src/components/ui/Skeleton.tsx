export default function Skeleton({ className = '', lines = 1 }: { className?: string; lines?: number }) {
  return (
    <div className={`animate-pulse space-y-3 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-4 bg-surface-200 rounded-lg" style={{ width: `${70 + Math.random() * 30}%` }} />
      ))}
    </div>
  )
}

export function CardSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-surface-100 p-6 animate-pulse">
      <div className="flex items-start justify-between">
        <div className="space-y-3 flex-1">
          <div className="h-4 bg-surface-200 rounded-lg w-1/3" />
          <div className="h-8 bg-surface-200 rounded-lg w-1/4" />
          <div className="h-3 bg-surface-200 rounded-lg w-1/5" />
        </div>
        <div className="w-12 h-12 bg-surface-200 rounded-xl" />
      </div>
    </div>
  )
}

export function ListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-surface-100 p-5 animate-pulse">
          <div className="flex items-center gap-4">
            <div className="w-1 h-12 bg-surface-200 rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-surface-200 rounded-lg w-2/3" />
              <div className="h-3 bg-surface-200 rounded-lg w-1/3" />
            </div>
            <div className="w-16 h-8 bg-surface-200 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function StatSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-surface-100 p-6 animate-pulse">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-3 bg-surface-200 rounded w-20" />
          <div className="h-8 bg-surface-200 rounded w-16" />
        </div>
        <div className="w-12 h-12 bg-surface-200 rounded-xl" />
      </div>
    </div>
  )
}