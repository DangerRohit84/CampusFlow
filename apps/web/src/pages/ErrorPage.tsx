import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { TriangleAlert, RotateCcw, Home, Mail } from 'lucide-react'
import PublicPageShell from '../components/PublicPageShell'

interface ErrorPageProps {
  title?: string
  message?: string
  requestId?: string
  onRetry?: () => void
}

function newRequestId(): string {
  try {
    const c = globalThis.crypto as Crypto | undefined
    if (c && 'randomUUID' in c && typeof c.randomUUID === 'function') return c.randomUUID()
  } catch { /* fall through to fallback */ }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Full-page 500/error state. Used as the standalone /error route AND as the
 * ErrorBoundary fallback (pass `error.message` + `onRetry` there).
 * Never renders raw stack traces — request ID goes to support instead.
 */
export default function ErrorPage({ title, message, requestId, onRetry }: ErrorPageProps) {
  const id = useMemo(() => requestId || newRequestId(), [requestId])

  return (
    <PublicPageShell>
      <div className="max-w-[560px] mx-auto text-center py-8">
        <span className="inline-flex items-center gap-2 text-[11px] font-bold tracking-widest uppercase rounded-full px-3.5 py-1.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-300">
          <TriangleAlert size={14} aria-hidden="true" /> Something went wrong
        </span>
        <h1 className="mt-5 font-semibold tracking-[-0.02em] leading-tight text-[36px]" style={{ fontFamily: 'Fraunces, serif' }}>
          {title || 'The board slipped off the wall.'}
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          {message || 'An unexpected error interrupted this page. Your data is safe — try again, and if it keeps happening, send us the request ID below.'}
        </p>
        <p className="mt-3 text-xs font-mono text-zinc-500 dark:text-zinc-400" aria-label="Request ID">
          Request ID: {id}
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          {onRetry && (
            <button
              onClick={onRetry}
              className="inline-flex items-center justify-center gap-2 rounded-full px-6 h-11 font-semibold text-sm text-black bg-[#1ed760] hover:bg-[#1db954] transition-colors"
            >
              <RotateCcw size={16} aria-hidden="true" /> Try again
            </button>
          )}
          <Link
            to="/"
            className="inline-flex items-center justify-center gap-2 rounded-full px-6 h-11 font-semibold text-sm bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          >
            <Home size={16} aria-hidden="true" /> Back home
          </Link>
          <Link
            to="/contact"
            className="inline-flex items-center justify-center gap-2 rounded-full px-6 h-11 font-semibold text-sm border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
          >
            <Mail size={16} aria-hidden="true" /> Contact support
          </Link>
        </div>
      </div>
    </PublicPageShell>
  )
}
