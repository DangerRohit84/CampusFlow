import { Link } from 'react-router-dom'
import { Compass, Home, LayoutDashboard, LifeBuoy } from 'lucide-react'
import PublicPageShell from '../components/PublicPageShell'
import { Seo } from '../components/Seo'

export default function NotFoundPage() {
  return (
    <PublicPageShell>
      {/* WHY: error pages must never index (docs/seo.md) — explicit noindex even though RouteSeo defaults non-public to noindex. */}
      <Seo title="Page not found" description="This CampusFlow page does not exist. Back to your campus board." noindex canonicalPath="/404" />
      <div className="max-w-[560px] mx-auto text-center py-8">
        <span className="inline-flex items-center gap-2 text-[11px] font-bold tracking-widest uppercase rounded-full px-3.5 py-1.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
          <Compass size={14} aria-hidden="true" /> 404 · Board not found
        </span>
        <h1 className="mt-5 font-semibold tracking-[-0.02em] leading-none text-[56px]" style={{ fontFamily: 'Fraunces, serif' }}>
          Off the map.
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          This hallway doesn&apos;t exist — the link may be old, mistyped, or the board was removed.
          Your timetable and rooms are still pinned where you left them.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/"
            className="inline-flex items-center justify-center gap-2 rounded-full px-6 h-11 font-semibold text-sm text-black bg-[#1ed760] hover:bg-[#1db954] transition-colors"
          >
            <Home size={16} aria-hidden="true" /> Back home
          </Link>
          <Link
            to="/dashboard"
            className="inline-flex items-center justify-center gap-2 rounded-full px-6 h-11 font-semibold text-sm bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          >
            <LayoutDashboard size={16} aria-hidden="true" /> Open board
          </Link>
          <Link
            to="/help"
            className="inline-flex items-center justify-center gap-2 rounded-full px-6 h-11 font-semibold text-sm border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
          >
            <LifeBuoy size={16} aria-hidden="true" /> Get help
          </Link>
        </div>
      </div>
    </PublicPageShell>
  )
}
