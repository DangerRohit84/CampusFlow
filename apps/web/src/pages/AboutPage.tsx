import { Link } from 'react-router-dom'
import { GraduationCap, Pin, Users, Lock, ArrowRight } from 'lucide-react'
import PublicPageShell from '../components/PublicPageShell'

const VALUES = [
  { icon: Pin, title: 'Pinned, not forwarded', body: 'Campus runs on forwarded screenshots. We pin the source of truth where everyone already looks — the board.' },
  { icon: Users, title: 'Scoped by default', body: 'Department · year · branch. You see only your board, and colleges control visibility. Privacy is architecture, not a setting.' },
  { icon: Lock, title: 'Calm software', body: 'Due slips instead of chase-downs. Unread badges instead of broadcast noise. Fast, keyboard-friendly, accessible.' },
]

export default function AboutPage() {
  return (
    <PublicPageShell>
      <div className="max-w-[720px] mx-auto">
        <span className="inline-flex items-center gap-2 rounded-full bg-black dark:bg-white text-white dark:text-black px-3.5 py-1.5 text-[11px] font-bold tracking-widest uppercase">
          <GraduationCap size={14} aria-hidden="true" /> Hall 01 · Campus OS
        </span>
        <h1 className="mt-4 font-semibold tracking-[-0.02em] leading-[1.02] text-[36px]" style={{ fontFamily: 'Fraunces, serif' }}>
          The hallway board for your whole campus.
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          CampusFlow started with a simple observation: students check WhatsApp forwards at 9:15 for
          a 9:00 class. Timetables, deadlines, rooms and opportunities scatter across screenshots,
          DMs and notice boards. We built one pinned board — photo in, live board out in 14 seconds —
          now used by 40+ colleges and 12,000+ students.
        </p>

        <div className="mt-8 grid grid-cols-3 gap-3 text-center">
          {[
            { n: '40+', l: 'Colleges' },
            { n: '12k+', l: 'Students' },
            { n: '98%', l: 'Parse accuracy' },
          ].map((s) => (
            <div key={s.l} className="rounded-[14px] border border-zinc-200 dark:border-zinc-800 p-5">
              <p className="font-semibold text-[24px] tracking-tight">{s.n}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{s.l}</p>
            </div>
          ))}
        </div>

        <h2 className="mt-10 font-semibold text-[20px]">What we believe</h2>
        <div className="mt-4 space-y-3">
          {VALUES.map((v) => (
            <div key={v.title} className="flex gap-4 rounded-[14px] border border-zinc-200 dark:border-zinc-800 p-5">
              <span className="w-10 h-10 rounded-xl bg-[#1ed760]/15 text-[#128a3e] dark:text-[#1ed760] grid place-items-center shrink-0">
                <v.icon size={18} aria-hidden="true" />
              </span>
              <div>
                <h3 className="font-semibold text-[15px]">{v.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{v.body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            to="/register"
            className="inline-flex items-center justify-center gap-2 rounded-full px-6 h-11 font-semibold text-sm text-black bg-[#1ed760] hover:bg-[#1db954] transition-colors"
          >
            Start free <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <Link
            to="/contact"
            className="inline-flex items-center justify-center gap-2 rounded-full px-6 h-11 font-semibold text-sm border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
          >
            Talk to us
          </Link>
        </div>
      </div>
    </PublicPageShell>
  )
}
