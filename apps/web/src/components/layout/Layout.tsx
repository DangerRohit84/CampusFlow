import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { useAppStore } from '../../store/appStore'
import {
  LayoutDashboard, MessageSquare, BookOpen,
  Bell, Settings, LogOut, Menu, X, GraduationCap,
  ChevronRight, Sparkles, Search, Award, Target, Clock, Trophy,
  ClipboardList, Shield, DoorOpen, Briefcase, CheckSquare,
  Users, BarChart2, FolderOpen, Download, Brain, ListTodo, CalendarDays,
  Medal, UserCheck, Code2
} from 'lucide-react'
import { useState, useEffect } from 'react'
import clsx from 'clsx'
import { motion, AnimatePresence } from 'framer-motion'
import CommandPalette from '../CommandPalette'
import ThemeToggle from '../ThemeToggle'
import toast from 'react-hot-toast'
import { timetableAPI, hackathonAPI, formAPI, roomAPI, internshipAPI, codingContestAPI, codingProfileAPI, notificationAPI } from '../../lib/api'
import { connectSocket, disconnectSocket } from '../../lib/socket'

type NavItem = {
  path: string
  label: string
  icon: any
}

type NavSection = {
  label: string
  items: NavItem[]
}

const navByRole: Record<string, NavSection[]> = {
  STUDENT: [
    {
      label: '',
      items: [
        { path: '/dashboard', label: 'Overview', icon: LayoutDashboard },
      ],
    },
    {
      label: 'ACADEMICS',
      items: [
        { path: '/schedule', label: 'Timetable', icon: Clock },
        { path: '/attendance', label: 'Attendance', icon: UserCheck },
        { path: '/grades', label: 'Grades', icon: Award },
        { path: '/tasks', label: 'Planner', icon: ListTodo },
      ],
    },
    {
      label: 'OPPORTUNITIES',
      items: [
        { path: '/hackathons', label: 'Hackathons', icon: Trophy },
        { path: '/internships', label: 'Internships', icon: Briefcase },
        { path: '/contests', label: 'Contests', icon: Medal },
        { path: '/coding-profile', label: 'Coding Profile', icon: Code2 },
      ],
    },
    {
      label: 'CAMPUS',
      items: [
        { path: '/calendar', label: 'Calendar', icon: CalendarDays },
        { path: '/forms', label: 'Forms', icon: ClipboardList },
        { path: '/rooms', label: 'Rooms', icon: DoorOpen },
      ],
    },
  ],
  TEACHER: [
    {
      label: '',
      items: [
        { path: '/dashboard', label: 'Overview', icon: LayoutDashboard },
      ],
    },
    {
      label: 'CAMPUS',
      items: [
        { path: '/hackathons', label: 'Hackathons', icon: Trophy },
        { path: '/internships', label: 'Internships', icon: Briefcase },
        { path: '/teacher/opportunities', label: 'Opportunities', icon: Target },
        { path: '/contests', label: 'Contests', icon: Medal },
        { path: '/contests/leaderboard', label: 'Leaderboard', icon: BarChart2 },
        { path: '/schedule', label: 'Timetable', icon: Clock },
        { path: '/calendar', label: 'Calendar', icon: CalendarDays },
        { path: '/forms', label: 'Forms', icon: ClipboardList },
        { path: '/rooms', label: 'Rooms', icon: DoorOpen },
      ],
    },
    {
      label: 'Management',
      items: [
        { path: '/admin', label: 'Admin Panel', icon: Shield },
      ],
    },
  ],
  COLLEGE_ADMIN: [
    {
      label: '',
      items: [
        { path: '/dashboard', label: 'Overview', icon: LayoutDashboard },
      ],
    },
    {
      label: 'CAMPUS',
      items: [
        { path: '/hackathons', label: 'Hackathons', icon: Trophy },
        { path: '/internships', label: 'Internships', icon: Briefcase },
        { path: '/admin/opportunities', label: 'Opportunities', icon: Target },
        { path: '/contests', label: 'Contests', icon: Medal },
        { path: '/contests/leaderboard', label: 'Leaderboard', icon: BarChart2 },
        { path: '/forms', label: 'Forms', icon: ClipboardList },
        { path: '/rooms', label: 'Rooms', icon: DoorOpen },
      ],
    },
    {
      label: 'Management',
      items: [
        { path: '/admin', label: 'Admin Panel', icon: Shield },
      ],
    },
  ],
  SUPER_ADMIN: [
    {
      label: '',
      items: [
        { path: '/dashboard', label: 'Overview', icon: LayoutDashboard },
      ],
    },
    {
      label: 'CAMPUS',
      items: [
        { path: '/hackathons', label: 'Hackathons', icon: Trophy },
        { path: '/internships', label: 'Internships', icon: Briefcase },
        { path: '/admin/opportunities', label: 'Opportunities', icon: Target },
        { path: '/contests', label: 'Contests', icon: Medal },
        { path: '/contests/leaderboard', label: 'Leaderboard', icon: BarChart2 },
        { path: '/forms', label: 'Forms', icon: ClipboardList },
        { path: '/rooms', label: 'Rooms', icon: DoorOpen },
      ],
    },
    {
      label: 'Management',
      items: [
        { path: '/admin/fetch', label: 'Fetch Data', icon: Download },
        { path: '/admin/ai-manager', label: 'AI Manager', icon: Brain },
        { path: '/admin', label: 'Admin Panel', icon: Shield },
      ],
    },
  ],
}

export default function Layout() {
  const { user, logout, token } = useAuthStore()
  const { sidebarOpen, setSidebarOpen } = useAppStore()
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpenLocal] = useState(false)
  const [nearDeadlineCount, setNearDeadlineCount] = useState({ hackathons: 0, forms: 0, internships: 0, contests: 0 })
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [roomUnreadCount, setRoomUnreadCount] = useState(0)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowCommandPalette(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    setMobileOpenLocal(false)
  }, [location.pathname])

  // Fetch unread notification count on mount
  useEffect(() => {
    if (!token) return

    // On the notifications page, reset the badge and skip refetching  — 
    // a resolved fetch would otherwise overwrite the reset with a stale count.
    if (location.pathname === '/notifications') {
      setUnreadCount(0)
      return
    }

    notificationAPI.getUnreadCount()
      .then((count: number) => setUnreadCount(count))
      .catch(() => {})
  }, [token, location.pathname])

  // Room unread: fetch + socket live updates
  useEffect(() => {
    if (!token) return
    let cancelled = false
    const refresh = async () => {
      try {
        const map = await roomAPI.getUnreadCounts()
        if (cancelled) return
        const total = Object.values(map as Record<string, number>).reduce((a: number, b: any) => a + (Number(b) || 0), 0)
        setRoomUnreadCount(total)
      } catch {
        // fallback to getAll which now includes unreadCount
        try {
          const rooms = await roomAPI.getAll()
          if (cancelled) return
          const total = (rooms as any[]).reduce((sum: number, r: any) => sum + (Number(r.unreadCount) || 0), 0)
          setRoomUnreadCount(total)
        } catch {}
      }
    }
    refresh()
    // refetch on route change (clears badge after visiting room)
    // also listen for custom event dispatched by RoomChatPanel after markRead
    const onRoomRead = () => refresh()
    window.addEventListener('room:read', onRoomRead)
    // also refresh when pathname changes (handled via dependency below)
    return () => {
      cancelled = true
      window.removeEventListener('room:read', onRoomRead)
    }
  }, [token, location.pathname])

  // Socket.IO: connect, listen for live notifications + room messages
  useEffect(() => {
    if (!token) return

    const socket = connectSocket(token)

    // Join the user's room after connection
    const onConnect = () => {
      socket.emit('auth:join')
    }
    socket.on('connect', onConnect)

    // Listen for new notifications
    const onNotification = (notification: any) => {
      setUnreadCount((prev) => prev + 1)
      toast(notification.title || 'New Notification', {
        icon: '🔔',
        duration: 4000,
      })
    }
    socket.on('notification:new', onNotification)

    // Room unread: live increment; if user is currently inside that room chat, mark read immediately
    const onRoomMessage = (message: any) => {
      if (!message?.roomId) return
      if (message.senderId === user?.id) return
      // if currently viewing that room's chat tab, clear immediately (optimistic) and mark read in background
      const isOnRoomRoute = location.pathname.includes(`/rooms/${message.roomId}`)
      // heuristic: if chat tab is open we clear; otherwise increment
      // We refetch counts for accuracy; increment is optimistic fallback if fetch fails
      if (isOnRoomRoute) {
        roomAPI.markRead(message.roomId).catch(() => {})
        // keep badge at 0 for this room until next fetch; trigger refresh
        roomAPI.getUnreadCounts().then((map: any) => {
          const total = Object.values(map as Record<string, number>).reduce((a: number, b: any) => a + (Number(b) || 0), 0)
          setRoomUnreadCount(total)
        }).catch(() => {})
        return
      }
      setRoomUnreadCount((prev) => prev + 1)
      // also refetch to reconcile (debounced via setTimeout to avoid race)
      setTimeout(() => {
        roomAPI.getUnreadCounts().then((map: any) => {
          const total = Object.values(map as Record<string, number>).reduce((a: number, b: any) => a + (Number(b) || 0), 0)
          setRoomUnreadCount(total)
        }).catch(() => {})
      }, 400)
    }
    socket.on('room:message:new', onRoomMessage)

    return () => {
      socket.off('connect', onConnect)
      socket.off('notification:new', onNotification)
      socket.off('room:message:new', onRoomMessage)
      disconnectSocket()
    }
  }, [token, user?.id, location.pathname])

  useEffect(() => {
    const isNear = (dateStr: string) => {
      if (!dateStr) return false
      const diff = new Date(dateStr).getTime() - Date.now()
      return diff > 0 && diff < 3 * 24 * 60 * 60 * 1000
    }
    hackathonAPI.getAll().then((data: any) => {
      const count = data.filter((h: any) => isNear(h.deadline)).length
      setNearDeadlineCount((prev) => ({ ...prev, hackathons: count }))
    }).catch(() => {})
    formAPI.getAll().then((data: any) => {
      const count = data.filter((f: any) => isNear(f.expiresAt)).length
      setNearDeadlineCount((prev) => ({ ...prev, forms: count }))
    }).catch(() => {})
    internshipAPI.getAll().then((data: any) => {
      const count = data.filter((i: any) => i.status === 'ACTIVE' && i.deadline && isNear(i.deadline)).length
      setNearDeadlineCount((prev) => ({ ...prev, internships: count }))
    }).catch(() => {})
    codingContestAPI.getAll().then((data: any) => {
      const now = Date.now()
      const count = data.filter((c: any) => {
        const start = new Date(c.startDate).getTime()
        const end = start + (c.duration || 180) * 60000
        return now >= start && now <= end
      }).length
      setNearDeadlineCount((prev) => ({ ...prev, contests: count }))
    }).catch(() => {})
  }, [])

  const getNearCount = (path: string) => {
    if (path === '/hackathons') return nearDeadlineCount.hackathons
    if (path === '/forms') return nearDeadlineCount.forms
    if (path === '/internships') return nearDeadlineCount.internships
    if (path === '/contests') return nearDeadlineCount.contests
    return 0
  }

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="p-5 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-500 flex items-center justify-center shadow-glow">
          <GraduationCap className="w-6 h-6 text-white" />
        </div>
        {sidebarOpen && (
          <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>
            <span className="text-lg font-bold text-primary-600 dark:text-[#00A88F]">CampusFlow</span>
            <p className="text-[10px] text-surface-400 dark:text-night-300 font-medium">AI Campus OS</p>
          </motion.div>
        )}
      </div>

      {/* Nav Sections */}
      <nav className="flex-1 px-3 mt-2 overflow-y-auto">
        {(navByRole[user?.role || 'STUDENT'] || navByRole.STUDENT).map((section) => (
          <div key={section.label} className="mb-4">
            {/* Section Label */}
            {sidebarOpen && section.label && (
              <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-surface-400 dark:text-night-300">
                {section.label}
              </p>
            )}

            {/* Section Items */}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = location.pathname === item.path
                const Icon = item.icon
                const nearCount = getNearCount(item.path)
                const isRooms = item.path === '/rooms'
                const showRoomsBadge = isRooms && roomUnreadCount > 0

                return (
                  <button
                    key={item.path}
                    onClick={() => navigate(item.path)}
                    title={isRooms && roomUnreadCount > 0 ? `Rooms (${roomUnreadCount > 99 ? '99+' : roomUnreadCount} unread)` : item.label}
                    className={clsx(
                      'w-full flex items-center gap-3 rounded-lg font-medium transition-all duration-200 group relative',
                      sidebarOpen ? 'px-3 py-2' : 'justify-center px-0 py-2.5',
                      isActive
                        ? 'bg-primary-50 dark:bg-[rgba(0,112,96,0.15)] text-primary-700 dark:text-[#00A88F]'
                        : 'text-surface-600 dark:text-night-200 hover:bg-surface-100 dark:hover:bg-night-700 hover:text-surface-900 dark:hover:text-night-50'
                    )}
                  >
                    {/* Active indicator - left accent bar */}
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-gradient-to-b from-primary-500 to-primary-500 rounded-r-full" />
                    )}

                    <span className="relative inline-flex">
                      <Icon size={18} className={clsx(isActive && 'text-primary-600')} />
                      {!sidebarOpen && showRoomsBadge && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 bg-red-500 text-white rounded-full text-[9px] font-bold flex items-center justify-center leading-none border border-white dark:border-night-800">
                          {roomUnreadCount > 99 ? '99+' : roomUnreadCount}
                        </span>
                      )}
                      {!sidebarOpen && nearCount > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 bg-[#DC2626] text-white rounded-full text-[9px] font-bold flex items-center justify-center leading-none border border-white dark:border-night-800">
                          {nearCount > 99 ? '99+' : nearCount}
                        </span>
                      )}
                    </span>

                    {sidebarOpen && (
                      <span className="flex-1 text-left text-[13px]">{item.label}</span>
                    )}

                    {sidebarOpen && nearCount > 0 && (
                      <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-[#DC2626] text-white rounded-full text-[10px] font-bold">{nearCount}</span>
                    )}
                    {sidebarOpen && showRoomsBadge && (
                      <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-red-500 text-white rounded-full text-[10px] font-bold">
                        {roomUnreadCount > 99 ? '99+' : roomUnreadCount}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* CampusFlow AI Card */}
      {sidebarOpen && (
          <div className="px-3 mb-3 shrink-0">
          <div className="p-4 bg-[#FEF3E3] dark:bg-night-700 rounded-xl">
            <div className="flex items-center gap-2 mb-1.5">
              <Sparkles size={16} className="text-amber-500" />
              <span className="text-sm font-bold text-primary-700 dark:text-[#00A88F]">CampusFlow AI</span>
            </div>
            <p className="text-[11px] text-surface-600 dark:text-night-200 mb-3 leading-relaxed">
              Your intelligent assistant for campus operations
            </p>
            <button
              onClick={() => navigate('/chat')}
              className="w-full px-3 py-2 bg-primary-500 hover:bg-primary-600 rounded-lg text-sm font-medium transition-all flex items-center justify-between text-white"
            >
              <span>Ask AI Assistant</span>
              <span className="text-lg">→</span>
            </button>
          </div>
        </div>
      )}

      {/* College Illustration */}
      {sidebarOpen && (
        <div className="px-0 mt-auto shrink-0">
          <img src="/school-illustration.svg" alt="Campus" className="w-full h-auto object-contain" />
        </div>
      )}

      {/* User Profile & Logout */}
      <div className="px-3 mt-auto pb-3 pt-2 border-t border-surface-100 dark:border-night-600">
        <div className={clsx('flex items-center gap-3', !sidebarOpen && 'justify-center')}>
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-400 to-primary-400 flex items-center justify-center text-white font-bold text-xs shadow-md shrink-0">
            {user?.name?.charAt(0) || 'S'}
          </div>
          {sidebarOpen && (
            <>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold text-surface-900 dark:text-night-50 truncate">{user?.name || 'Student'}</p>
                  <CheckSquare size={12} className="text-primary-500 shrink-0" />
                </div>
                <p className="text-[10px] text-surface-400 dark:text-night-300 truncate">{user?.email || 'student@campus.edu'}</p>
              </div>
              <button
                onClick={() => { logout(); navigate('/login') }}
                className="p-1.5 rounded-lg text-surface-400 hover:text-danger-500 hover:bg-danger-50 transition-colors"
                title="Logout"
              >
                <LogOut size={16} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex h-screen bg-surface-50 dark:bg-night-950 overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className={clsx(
        'hidden lg:flex flex-col border-r border-surface-200 dark:border-night-600 bg-surface-100 dark:bg-night-800 transition-all duration-300 overflow-hidden',
        sidebarOpen ? 'w-64' : 'w-[72px]'
      )}>
        <SidebarContent />
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-night-950">
        {/* Top Header */}
        <header className="h-16 border-b border-surface-200 dark:border-night-600 bg-white/80 dark:bg-night-800/80 backdrop-blur-xl flex items-center justify-between px-4 lg:px-6 shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => window.innerWidth >= 1024 ? setSidebarOpen(!sidebarOpen) : setMobileOpenLocal(true)}
              className="p-2 rounded-xl text-surface-500 hover:bg-surface-100 transition-colors shrink-0"
            >
              {sidebarOpen && window.innerWidth >= 1024 ? <X size={18} /> : <Menu size={18} />}
            </button>
            <div className="relative hidden sm:block">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
              <input type="text" placeholder="Search... (⌘K)" className="w-full pl-10 pr-4 py-2 bg-surface-50 dark:bg-night-950 border border-surface-200 dark:border-night-600 rounded-xl text-sm text-surface-900 dark:text-night-50 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all" readOnly onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))} />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="w-px h-6 bg-surface-200 hidden sm:block" />
            <button className="relative p-2 rounded-xl text-surface-500 hover:bg-surface-100 transition-colors" onClick={() => navigate('/notifications')}>
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-danger-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center">{unreadCount > 99 ? '99+' : unreadCount}</span>
              )}
            </button>
            <div className="w-px h-6 bg-surface-200 hidden sm:block" />
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/settings')}>
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-xs shadow-md">
                {user?.name?.charAt(0) || 'A'}
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-semibold text-surface-900 dark:text-night-50 leading-tight">{user?.name || 'Admin'}</p>
                <p className="text-[10px] text-surface-400 dark:text-night-300">{user?.role?.replace('_', ' ') || 'Super Admin'}</p>
              </div>
            </div>
          </div>
        </header>

        {/* Hanging Lamp from navbar border line */}
        <div className="relative h-0">
          <div className="absolute right-24 top-0 z-10">
            <ThemeToggle />
          </div>
        </div>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40 lg:hidden"
              onClick={() => setMobileOpenLocal(false)}
            />
            <motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: 'spring', damping: 25, stiffness: 300 }} className="fixed inset-y-0 left-0 w-72 bg-surface-100 dark:bg-night-800 z-50 lg:hidden shadow-2xl">
              <button onClick={() => setMobileOpenLocal(false)} className="absolute top-4 right-4 p-2 rounded-lg text-surface-400 hover:bg-surface-100"><X size={20} /></button>
              <SidebarContent />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Command Palette */}
      <CommandPalette open={showCommandPalette} onClose={() => setShowCommandPalette(false)} />
    </div>
  )
}
