import { Link } from 'react-router-dom'
import { Keyboard, MessageCircleQuestion, CalendarDays, FileText, ArrowRight, Mail } from 'lucide-react'
import PublicPageShell from '../components/PublicPageShell'

const GUIDES = [
  { icon: CalendarDays, title: 'Import your timetable', body: 'Schedule → Upload Timetable → paste text or drop a photo. Periods, rooms and faculty parse in ~14 seconds. Edit any period after.' },
  { icon: FileText, title: 'Submit an assignment', body: 'Assignments → open a hub → upload files or paste content. Your status tag (Submitted, Graded, Late) updates live.' },
  { icon: MessageCircleQuestion, title: 'Report a problem', body: 'Signed in? Use the red flag button in the sidebar. Anyone can use the Contact page — college or website scope, tracked to resolution.' },
]

const SHORTCUTS = [
  { keys: 'Ctrl / ⌘ + K', action: 'Open command palette (jump to any board)' },
  { keys: 'Esc', action: 'Close dialogs and palettes' },
  { keys: 'Tab / Shift+Tab', action: 'Move through dialog controls (focus is trapped inside)' },
  { keys: 'Enter / Space', action: 'Open the focused card or activate the focused button' },
]

export default function HelpPage() {
  return (
    <PublicPageShell>
      <div className="max-w-[720px] mx-auto">
        <p className="text-[11px] font-bold tracking-widest uppercase text-zinc-500 dark:text-zinc-400">Support</p>
        <h1 className="mt-2 font-semibold tracking-[-0.02em] text-[32px]" style={{ fontFamily: 'Fraunces, serif' }}>Help & Support</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          Quick guides, keyboard shortcuts, and where to reach a human. Most answers take under a minute.
        </p>

        <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {GUIDES.map((g) => (
            <div key={g.title} className="rounded-[14px] border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-5">
              <span className="w-9 h-9 rounded-xl bg-black dark:bg-white text-white dark:text-black grid place-items-center">
                <g.icon size={16} aria-hidden="true" />
              </span>
              <h2 className="mt-3 font-semibold text-sm">{g.title}</h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400">{g.body}</p>
            </div>
          ))}
        </div>

        <h2 className="mt-10 font-semibold text-[20px] inline-flex items-center gap-2">
          <Keyboard size={18} aria-hidden="true" /> Keyboard shortcuts
        </h2>
        <div className="mt-4 rounded-[14px] overflow-hidden border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between gap-4 px-5 py-3.5">
              <span className="text-sm text-zinc-700 dark:text-zinc-200">{s.action}</span>
              <kbd className="shrink-0 px-2.5 py-1 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs font-mono text-zinc-600 dark:text-zinc-300">{s.keys}</kbd>
            </div>
          ))}
        </div>

        <div className="mt-10 rounded-[14px] bg-[#121212] dark:bg-zinc-900 text-white p-6 sm:p-7 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold text-lg">Still stuck?</h2>
            <p className="mt-1 text-sm text-zinc-300">Send us a note — support, sales or feedback. We reply within 2 business days.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/contact"
              className="inline-flex items-center justify-center gap-2 rounded-full px-5 h-11 font-semibold text-sm text-black bg-[#1ed760] hover:bg-[#1db954] transition-colors"
            >
              Contact us <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <a
              href="mailto:hello@campusflow.dev?subject=CampusFlow%20support"
              className="inline-flex items-center justify-center gap-2 rounded-full px-5 h-11 font-semibold text-sm bg-white/10 hover:bg-white/15 border border-white/15 transition-colors"
            >
              <Mail size={16} aria-hidden="true" /> Email directly
            </a>
          </div>
        </div>
      </div>
    </PublicPageShell>
  )
}
