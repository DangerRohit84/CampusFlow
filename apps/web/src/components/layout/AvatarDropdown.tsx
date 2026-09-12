import { useEffect, useRef, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  User, Settings, LogOut, Shield, ChevronRight, Flame, Github,
} from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { LOGOUT_DEST } from '../../lib/logout'
import { codingProfileAPI } from '../../lib/api'

// lightweight activity generator — same logic as public profile, but only for 1-line summary
function generateActivity(seedStr: string, days = 119) {
  let h = 0
  for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) | 0
  const rand = (n: number) => {
    h = (h * 1664525 + 1013904223) | 0
    return Math.abs(h % 1000) / 1000 + n * 0.0001
  }
  const today = new Date()
  const arr: { date: Date; level: number; count: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const r = rand(i)
    const recencyBoost = i < 14 ? 0.08 : 0
    let level = 0
    if (r > 0.55 - recencyBoost) level = 1
    if (r > 0.77 - recencyBoost) level = 2
    if (r > 0.90 - recencyBoost) level = 3
    if (r > 0.96 - recencyBoost) level = 4
    const m = d.getMonth()
    if ((m === 0 || m === 4) && r < 0.7) level = Math.max(0, level - 1) as number
    const count = level === 0 ? 0 : level === 1 ? 1 + Math.floor(rand(i + 1) * 2) : level === 2 ? 3 + Math.floor(rand(i + 2) * 2) : level === 3 ? 5 + Math.floor(rand(i + 3) * 3) : 8 + Math.floor(rand(i + 4) * 4)
    arr.push({ date: d, level, count })
  }
  return arr
}

export default function AvatarDropdown() {
  // WHY logout race: whole-store subscribe re-rendered on set() and raced
  // navigate(); selectors keep logout stable + avoid extra renders.
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const initial = user?.name?.charAt(0)?.toUpperCase() || 'A'
  const displayName = user?.name || 'Alex Johnson'
  const displayEmail = user?.email || 'alex@campus.edu'

  // Try real GitHub calendar if user has githubUsername set; else fallback to deterministic hash
  const [githubCalendar, setGithubCalendar] = useState<null | { date: string; count: number; level: number }[]>(null)
  const [calendarSource, setCalendarSource] = useState<'github' | 'deterministic'>('deterministic')

  useEffect(() => {
    let cancelled = false
    // Fetch own GitHub calendar (119 days) — succeeds only if coding profile has githubUsername
    // No auth redirect needed; 404 means no githubUsername — silently keep deterministic.
    codingProfileAPI.getGithubCalendar({ days: 119 } as any)
      .then((cal: any) => {
        if (cancelled) return
        if (Array.isArray(cal) && cal.length) {
          setGithubCalendar(cal)
          setCalendarSource('github')
        }
      })
      .catch(() => {
        // keep deterministic fallback
      })
    return () => { cancelled = true }
  }, [user?.id])

  // 1-line summary only — detailed Level / calendar / coding breakdown lives on /u/:username
  const activity = useMemo(() => {
    if (githubCalendar && githubCalendar.length) {
      return githubCalendar.map((d: { date: string; count: number; level: number }) => ({ date: new Date(d.date), count: d.count, level: d.level }))
    }
    return generateActivity(user?.id || user?.email || 'campusflow', 119)
  }, [user?.id, user?.email, githubCalendar])

  const totalContribs = useMemo(() => activity.reduce((s, a) => s + a.count, 0), [activity])
  const streakInfo = useMemo(() => {
    let curStreak = 0
    for (let i = activity.length - 1; i >= 0; i--) {
      if (activity[i].level > 0) curStreak++
      else break
    }
    return { current: curStreak }
  }, [activity])

  const level = Math.min(25, Math.max(1, Math.floor(totalContribs / 14) + 1))

  // close handlers
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const username = (user as any)?.username || null
  const publicPath = username ? `/u/${username}` : null

  const goProfile = () => {
    setOpen(false)
    if (publicPath) navigate(publicPath)
    else navigate('/coding-profile')
  }
  const goSettings = () => { setOpen(false); navigate('/settings') }

  const isAdmin = user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN' || user?.role === 'TEACHER'

  return (
    <div className="relative">
      {/* Avatar button — circular, only avatar */}
      <button
        ref={btnRef}
        onClick={() => setOpen(v => !v)}
        aria-label="Open profile menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative w-9 h-9 rounded-full bg-primary-600 flex items-center justify-center text-white font-bold text-sm shrink-0 ring-2 ring-white dark:ring-night-800 shadow-sm hover:ring-primary-200 dark:hover:ring-primary-900/30 hover:scale-[1.03] transition-all overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
      >
        {user?.avatarUrl ? (
          <img src={user.avatarUrl} alt={displayName} width={36} height={36} loading="lazy" decoding="async" className="w-full h-full object-cover rounded-full" />
        ) : (
          <span className="tracking-wide">{initial}</span>
        )}
        <span className="absolute -bottom-0 -right-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white dark:border-night-800" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* backdrop for mobile */}
            <div className="fixed inset-0 z-[9998] sm:hidden" onClick={() => setOpen(false)} />

            <motion.div
              ref={panelRef}
              role="menu"
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              className="absolute right-0 top-full mt-3 w-[300px] max-w-[calc(100vw-16px)] rounded-2xl border border-surface-200 dark:border-night-650 bg-white dark:bg-night-800 shadow-e3 z-[9999] overflow-hidden flex flex-col"
            >
              {/* ── Header: avatar + name side by side, clickable → View Profile (LeetCode style) */}
              <button
                onClick={goProfile}
                className="flex items-center gap-3 p-4 hover:bg-surface-50 dark:bg-night-800 dark:hover:bg-night-700/60 text-left transition-colors w-full"
              >
                <div className="w-10 h-10 rounded-full bg-primary-600 flex items-center justify-center text-white font-bold text-[15px] shrink-0 ring-2 ring-primary-100 dark:ring-primary-900/30 overflow-hidden">
                  {user?.avatarUrl ? <img src={user.avatarUrl} alt={displayName} width={40} height={40} loading="lazy" decoding="async" className="w-full h-full object-cover" /> : initial}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[14px] leading-none text-surface-900 dark:text-night-50 truncate">{displayName}</p>
                  <p className="text-xs text-surface-500 dark:text-night-300 truncate mt-1">{displayEmail}</p>
                  {/* 1-line quick stats — light summary only, details on public profile */}
                  <p className="text-[11px] font-medium text-surface-500 dark:text-night-300 mt-1 truncate flex items-center gap-1.5">
                    <span>Lv.{level}</span>
                    <span className="w-1 h-1 rounded-full bg-surface-300 dark:bg-night-500" />
                    <span>{totalContribs} activity</span>
                    <span className="w-1 h-1 rounded-full bg-surface-300 dark:bg-night-500" />
                    <span className={`inline-flex items-center gap-1 ${calendarSource === 'github' ? 'text-emerald-600 dark:text-emerald-300' : 'text-surface-400 dark:text-night-400'}`}>
                      <Github size={10} /> {calendarSource === 'github' ? 'GitHub' : 'Estimated'}
                    </span>
                    {streakInfo.current > 0 && (
                      <>
                        <span className="w-1 h-1 rounded-full bg-surface-300 dark:bg-night-500" />
                        <span className="inline-flex items-center gap-0.5 text-orange-600 dark:text-orange-300">
                          <Flame size={10} className="text-orange-500" /> {streakInfo.current} day streak
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <ChevronRight size={16} className="text-surface-300 shrink-0" />
              </button>

              <div className="h-px bg-surface-100 dark:bg-night-700 mx-2" />

              {/* ── Quick menu — minimal, fast (details live on /u/:username) */}
              <div className="p-2">
                <div className="space-y-1">
                  <button
                    onClick={goProfile}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-50 dark:bg-night-800 dark:hover:bg-night-700/60 text-left group transition-colors"
                  >
                    <span className="w-8 h-8 rounded-lg bg-surface-100 dark:bg-night-700 group-hover:bg-white dark:hover:bg-night-700 dark:group-hover:bg-night-600 border border-surface-200/60 dark:border-night-600 flex items-center justify-center text-surface-600 dark:text-night-200 group-hover:text-primary-600 dark:group-hover:text-success-300 transition-colors shrink-0">
                      <User size={16} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-surface-900 dark:text-night-50 leading-none">View Profile</span>
                      <span className="block text-xs text-surface-500 dark:text-night-300 leading-none mt-1 truncate">
                        {username ? `@${username}` : 'Public profile & activity'}
                      </span>
                    </span>
                    <ChevronRight size={14} className="text-surface-300 group-hover:text-surface-500 dark:text-night-400 transition-colors shrink-0" />
                  </button>

                  <button
                    onClick={goSettings}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-50 dark:bg-night-800 dark:hover:bg-night-700/60 text-left group transition-colors"
                  >
                    <span className="w-8 h-8 rounded-lg bg-surface-100 dark:bg-night-700 group-hover:bg-white dark:hover:bg-night-700 dark:group-hover:bg-night-600 border border-surface-200/60 dark:border-night-600 flex items-center justify-center text-surface-600 dark:text-night-200 group-hover:text-primary-600 dark:group-hover:text-success-300 transition-colors shrink-0">
                      <Settings size={16} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-surface-900 dark:text-night-50 leading-none">Settings</span>
                      <span className="block text-xs text-surface-500 dark:text-night-300 leading-none mt-1">Preferences & account</span>
                    </span>
                    <ChevronRight size={14} className="text-surface-300 group-hover:text-surface-500 dark:text-night-400 transition-colors shrink-0" />
                  </button>

                  {isAdmin && (
                    <button
                      onClick={() => { setOpen(false); navigate('/admin') }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-50 dark:bg-night-800 dark:hover:bg-night-700/60 text-left group transition-colors"
                    >
                      <span className="w-8 h-8 rounded-lg bg-surface-100 dark:bg-night-700 group-hover:bg-white dark:hover:bg-night-700 dark:group-hover:bg-night-600 border border-surface-200/60 dark:border-night-600 flex items-center justify-center text-surface-600 dark:text-night-200 group-hover:text-primary-600 dark:group-hover:text-success-300 transition-colors shrink-0">
                        <Shield size={16} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-surface-900 dark:text-night-50 leading-none">Admin Panel</span>
                        <span className="block text-xs text-surface-500 dark:text-night-300 leading-none mt-1">Manage campus</span>
                      </span>
                      <ChevronRight size={14} className="text-surface-300 group-hover:text-surface-500 dark:text-night-400 transition-colors shrink-0" />
                    </button>
                  )}
                </div>

                <div className="h-px bg-surface-100 dark:bg-night-700 my-2" />

                <button
                  onClick={() => { setOpen(false); logout(); navigate(LOGOUT_DEST, { replace: true }) }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-danger-50 dark:hover:bg-danger-500/10 text-left group transition-colors"
                >
                  <span className="w-8 h-8 rounded-lg bg-danger-50 dark:bg-danger-500/15 border border-danger-100 dark:border-danger-500/20 flex items-center justify-center text-danger-600 dark:text-danger-400 group-hover:bg-danger-100 dark:group-hover:bg-danger-500/20 transition-colors shrink-0">
                    <LogOut size={16} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-danger-600 dark:text-danger-400 leading-none">Sign Out</span>
                    <span className="block text-xs text-surface-500 dark:text-night-300 leading-none mt-1 truncate">{displayEmail}</span>
                  </span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
