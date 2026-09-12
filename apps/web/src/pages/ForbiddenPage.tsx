import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ShieldAlert, ArrowLeft, LayoutDashboard, Mail } from 'lucide-react'
import PublicPageShell from '../components/PublicPageShell'

function newRequestId(): string {
  try {
    const c = globalThis.crypto as Crypto | undefined
    if (c && 'randomUUID' in c && typeof c.randomUUID === 'function') return c.randomUUID()
  } catch { /* fall through to fallback */ }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export default function ForbiddenPage() {
  const navigate = useNavigate()
  const requestId = useMemo(() => newRequestId(), [])

  return (
    <PublicPageShell>
      <div className="max-w-[560px] mx-auto text-center py-8">
        <span className="inline-flex items-center gap-2 text-[11px] font-bold tracking-widest uppercase rounded-full px-3.5 py-1.5 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-300">
          <ShieldAlert size={14} aria-hidden="true" /> 403 · Access denied
        </span>
        <h1 className="mt-5 font-semibold tracking-[-0.02em] leading-none text-[40px]" style={{ fontFamily: 'Fraunces, serif' }}>
          This door is locked for you.
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          Your account doesn&apos;t have access to this page — it may belong to a different role
          (student, teacher, admin) or a college you&apos;re not part of. If you think this is a
          mistake, contact support with the request ID below.
        </p>
        <p className="mt-3 text-xs font-mono text-zinc-500 dark:text-zinc-400" aria-label="Request ID">
          Request ID: {requestId}
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center justify-center gap-2 rounded-full px-6 h-11 font-semibold text-sm text-black bg-[#1ed760] hover:bg-[#1db954] transition-colors"
          >
            <ArrowLeft size={16} aria-hidden="true" /> Go back
          </button>
          <Link
            to="/dashboard"
            className="inline-flex items-center justify-center gap-2 rounded-full px-6 h-11 font-semibold text-sm bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          >
            <LayoutDashboard size={16} aria-hidden="true" /> My board
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
