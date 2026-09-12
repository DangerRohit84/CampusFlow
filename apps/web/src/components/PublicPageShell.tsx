import { Link } from 'react-router-dom'
import { GraduationCap } from 'lucide-react'
import type { ReactNode } from 'react'

const FOOT_LINKS = [
  { to: '/about', label: 'About' },
  { to: '/help', label: 'Help' },
  { to: '/contact', label: 'Contact' },
  { to: '/privacy', label: 'Privacy' },
  { to: '/terms', label: 'Terms' },
]

/**
 * Minimal public chrome for legal/support/error pages (no app sidebar).
 * Keeps header/footer identical on every public page — same links as Landing footer.
 */
export default function PublicPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-black text-[#121212] dark:text-white antialiased">
      <a
        href="#public-main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-full focus:bg-black focus:text-white dark:focus:bg-white dark:focus:text-black focus:text-sm focus:font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 backdrop-blur-2xl bg-white/70 dark:bg-black/60 border-b border-zinc-200/60 dark:border-zinc-800/60">
        <div className="max-w-[980px] mx-auto px-6 h-11 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2.5 shrink-0" aria-label="CampusFlow home">
            <span className="w-7 h-7 rounded-lg bg-black dark:bg-white flex items-center justify-center">
              <GraduationCap className="w-4 h-4 text-white dark:text-black" aria-hidden="true" />
            </span>
            <span className="font-display font-semibold tracking-tight text-[15px] leading-none">
              CampusFlow
            </span>
          </Link>
          <nav className="flex items-center gap-1 text-[12px] font-medium text-zinc-600 dark:text-zinc-300" aria-label="Public">
            <Link to="/about" className="px-3 py-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors">About</Link>
            <Link to="/help" className="px-3 py-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors">Help</Link>
            <Link to="/contact" className="px-3 py-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors">Contact</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="hidden sm:inline-flex items-center justify-center rounded-full text-[12px] font-semibold px-4 h-8 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            >
              Log in
            </Link>
            <Link
              to="/register"
              className="inline-flex items-center justify-center rounded-full text-[12px] font-semibold px-4 h-8 text-black bg-[#1ed760] hover:bg-[#1db954] transition-colors"
            >
              Get started
            </Link>
          </div>
        </div>
      </header>

      {/* WHY: programmatic route-change focus target (RouteFocus) must never show a visible ring — tabindex=-1 + outline-none only. Visible rings stay on interactive elements. */}
      <main id="public-main" tabIndex={-1} className="flex-1 outline-none focus:outline-none focus-visible:outline-none">
        <div className="max-w-[980px] mx-auto px-6 py-10 lg:py-14">{children}</div>
      </main>

      <footer className="border-t border-zinc-200 dark:border-zinc-800">
        <div className="max-w-[980px] mx-auto px-6 py-8 flex flex-wrap items-center justify-between gap-4">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">© 2026 CampusFlow · Built for the quad.</p>
          <nav className="flex flex-wrap items-center gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-300" aria-label="Footer">
            {FOOT_LINKS.map((l) => (
              <Link key={l.to} to={l.to} className="px-3 py-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors min-h-[44px] inline-flex items-center">
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  )
}
