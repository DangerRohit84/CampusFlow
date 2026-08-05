import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import {
  LayoutDashboard, Calendar, MessageSquare, BookOpen,
  Bell, Settings, LogOut, Menu, X, GraduationCap,
  ChevronRight, Sparkles, Search, BarChart3, Award, Target, Clock, Trophy,
  ClipboardList, Shield
} from 'lucide-react'
import { useState, useEffect } from 'react'
import clsx from 'clsx'
import { motion, AnimatePresence } from 'framer-motion'
import CommandPalette from '../CommandPalette'
import { timetableAPI, hackathonAPI, formAPI } from '../../lib/api'

const navByRole: Record<string, any[]> = {
  STUDENT: [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/schedule', label: 'Planner', icon: Calendar },
    { path: '/hackathons', label: 'Hackathons', icon: Trophy },
    { path: '/forms', label: 'Forms', icon: ClipboardList },
    { path: '/chat', label: 'AI Assistant', icon: MessageSquare },
    { path: '/assignments', label: 'Assignments', icon: BookOpen },
    { path: '/grades', label: 'Grades', icon: Award },
    { path: '/attendance', label: 'Attendance', icon: Target },
    { path: '/insights', label: 'AI Insights', icon: BarChart3 },
    { path: '/settings', label: 'Settings', icon: Settings },
  ],
  TEACHER: [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/schedule', label: 'Planner', icon: Calendar },
    { path: '/hackathons', label: 'Hackathons', icon: Trophy },
    { path: '/forms', label: 'Forms', icon: ClipboardList },
    { path: '/chat', label: 'AI Assistant', icon: MessageSquare },
    { path: '/settings', label: 'Settings', icon: Settings },
  ],
  COLLEGE_ADMIN: [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/admin', label: 'Admin Panel', icon: Shield },
    { path: '/hackathons', label: 'Hackathons', icon: Trophy },
    { path: '/forms', label: 'Forms', icon: ClipboardList },
    { path: '/settings', label: 'Settings', icon: Settings },
  ],
  SUPER_ADMIN: [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/admin', label: 'Admin Panel', icon: Shield },
    { path: '/hackathons', label: 'Hackathons', icon: Trophy },
    { path: '/forms', label: 'Forms', icon: ClipboardList },
    { path: '/settings', label: 'Settings', icon: Settings },
  ],
}

export default function Layout() {
  const { user, logout } = useAuthStore()
  const location = useLocation()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [todayClasses, setTodayClasses] = useState<any[]>([])
  const [currentTime, setCurrentTime] = useState(new Date())
  const [nearDeadlineCount, setNearDeadlineCount] = useState({ hackathons: 0, forms: 0 })

  // Load today's classes
  useEffect(() => {
    timetableAPI.getToday().then(setTodayClasses).catch(() => {})
  }, [])

  // Update clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  // Refresh classes when navigating
  useEffect(() => {
    timetableAPI.getToday().then(setTodayClasses).catch(() => {})
  }, [location.pathname])

  // Fetch near-deadline counts for hackathons & forms
  useEffect(() => {
    const isNear = (dateStr: string) => {
      if (!dateStr) return false
      const diff = new Date(dateStr).getTime() - Date.now()
      return diff > 0 && diff <= 3 * 24 * 60 * 60 * 1000
    }
    hackathonAPI.getAll().then((data) => {
      const count = data.filter((h: any) => isNear(h.deadline)).length
      setNearDeadlineCount((prev) => ({ ...prev, hackathons: count }))
    }).catch(() => {})
    formAPI.getAll().then((data) => {
      const count = data.filter((f: any) => isNear(f.expiresAt)).length
      setNearDeadlineCount((prev) => ({ ...prev, forms: count }))
    }).catch(() => {})
  }, [location.pathname])

  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  const handleLogout = () => { logout(); navigate('/login') }

  const formatTime = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    const hour = h > 12 ? h - 12 : h
    return `${hour}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
  }

  const now = currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="p-5 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center shadow-glow">
          <GraduationCap className="w-6 h-6 text-white" />
        </div>
        {sidebarOpen && (
          <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>
            <span className="text-lg font-bold gradient-text">CampusFlow</span>
            <p className="text-[10px] text-surface-400 font-medium">AI Campus OS</p>
          </motion.div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 space-y-1 mt-1">
        {(navByRole[user?.role || 'STUDENT'] || navByRole.STUDENT).map((item) => {
          const isActive = location.pathname === item.path
          const Icon = item.icon
          const nearCount = item.path === '/hackathons' ? nearDeadlineCount.hackathons
            : item.path === '/forms' ? nearDeadlineCount.forms : 0
          return (
            <button key={item.path} onClick={() => navigate(item.path)}
              className={clsx('w-full flex items-center gap-3 px-4 py-2.5 rounded-xl font-medium transition-all duration-200 group relative',
                isActive ? 'bg-gradient-to-r from-primary-50 to-accent-50 text-primary-700 shadow-sm' : 'text-surface-500 hover:bg-surface-100 hover:text-surface-900'
              )}>
              {isActive && <motion.div layoutId="activeTab" className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-gradient-to-b from-primary-500 to-accent-500 rounded-r-full" />}
              <Icon size={18} className={isActive ? 'text-primary-600' : 'text-surface-400 group-hover:text-surface-600'} />
              {sidebarOpen && <span className="flex-1 text-left text-sm">{item.label}</span>}
              {sidebarOpen && nearCount > 0 && (
                <span className="px-1.5 py-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[18px] text-center">{nearCount}</span>
              )}
              {sidebarOpen && item.badge && !nearCount && <span className="px-1.5 py-0.5 bg-gradient-to-r from-primary-500 to-accent-500 text-white text-[9px] font-bold rounded-full">{item.badge}</span>}
            </button>
          )
        })}
      </nav>

      {/* Today's Classes Widget */}
      {sidebarOpen && (
        <div className="px-3 mb-3">
          <div className="p-4 bg-gradient-to-br from-surface-50 to-primary-50 rounded-2xl border border-surface-100">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-primary-600" />
                <span className="text-xs font-bold text-surface-700 uppercase tracking-wider">Today's Classes</span>
              </div>
              <span className="text-[10px] font-mono text-primary-600 font-semibold">{now}</span>
            </div>

            {todayClasses.length === 0 ? (
              <p className="text-xs text-surface-400 text-center py-2">No classes today</p>
            ) : (
              <div className="space-y-2">
                {todayClasses.slice(0, 4).map((cls: any) => {
                  const isPast = cls.endTime <= currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
                  return (
                    <div key={cls.id} className={clsx('flex items-center gap-2 p-2 rounded-lg transition-all', isPast ? 'opacity-40' : 'bg-white/80')}>
                      <div className="w-1 h-8 rounded-full shrink-0" style={{ backgroundColor: cls.color || '#5c7cfa' }} />
                      <div className="flex-1 min-w-0">
                        <p className={clsx('text-xs font-semibold truncate', isPast ? 'text-surface-400 line-through' : 'text-surface-900')}>{cls.title}</p>
                        <p className="text-[10px] text-surface-400">{formatTime(cls.startTime)} · {cls.location}</p>
                        {cls.teacher && <p className="text-[10px] text-surface-400 truncate">{/^(Prof|Dr|Mr|Mrs|Ms|Sir|Ma'am)\./i.test(cls.teacher) ? '' : 'Prof. '}{cls.teacher}</p>}
                      </div>
                    </div>
                  )
                })}
                {todayClasses.length > 4 && (
                  <p className="text-[10px] text-surface-400 text-center">+{todayClasses.length - 4} more</p>
                )}
              </div>
            )}

            <button onClick={() => navigate('/schedule')} className="w-full mt-2 text-[10px] font-semibold text-primary-600 hover:text-primary-700 flex items-center justify-center gap-1">
              View full schedule <ChevronRight size={10} />
            </button>
          </div>
        </div>
      )}

      {/* User */}
      <div className="p-3 border-t border-surface-100">
        <div className={clsx('flex items-center gap-3', !sidebarOpen && 'justify-center')}>
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-400 to-accent-400 flex items-center justify-center text-white font-bold text-xs shadow-md">
            {user?.name?.charAt(0) || 'S'}
          </div>
          {sidebarOpen && (
            <>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-surface-900 truncate">{user?.name || 'Student'}</p>
                <p className="text-[10px] text-surface-400 truncate">{user?.email || 'student@campus.edu'}</p>
              </div>
              <button onClick={handleLogout} className="p-1.5 rounded-lg text-surface-400 hover:text-red-500 hover:bg-red-50 transition-all" title="Logout">
                <LogOut size={16} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex h-screen bg-surface-50 overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className={clsx('hidden lg:flex flex-col border-r border-surface-100 bg-white transition-all duration-300', sidebarOpen ? 'w-64' : 'w-[68px]')}>
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
            <motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: 'spring', damping: 25, stiffness: 300 }} className="fixed inset-y-0 left-0 w-72 bg-white z-50 lg:hidden shadow-2xl">
              <button onClick={() => setMobileOpen(false)} className="absolute top-4 right-4 p-2 rounded-lg text-surface-400 hover:bg-surface-100"><X size={20} /></button>
              <SidebarContent />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Bar */}
        <header className="h-14 border-b border-surface-100 bg-white/80 backdrop-blur-xl flex items-center px-4 lg:px-6 gap-4 shrink-0 z-30">
          <button onClick={() => window.innerWidth >= 1024 ? setSidebarOpen(!sidebarOpen) : setMobileOpen(true)} className="p-2 rounded-xl text-surface-500 hover:bg-surface-100 transition-colors">
            {sidebarOpen && window.innerWidth >= 1024 ? <X size={18} /> : <Menu size={18} />}
          </button>

          <div className="flex-1 max-w-md relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" size={16} />
            <input type="text" placeholder="Search... (⌘K)" className="w-full pl-10 pr-4 py-2 bg-surface-50 border border-surface-200 rounded-xl text-sm text-surface-900 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all" readOnly onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))} />
          </div>

          <div className="flex items-center gap-2">
            <button className="relative p-2 rounded-xl text-surface-500 hover:bg-surface-100 transition-colors" onClick={() => navigate('/notifications')}>
              <Bell size={18} />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
            </button>
            <div className="hidden sm:flex items-center gap-2 pl-2 ml-2 border-l border-surface-200">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary-400 to-accent-400 flex items-center justify-center text-white font-bold text-[10px]">{user?.name?.charAt(0) || 'S'}</div>
              <span className="text-sm font-medium text-surface-700 hidden md:block">{user?.name?.split(' ')[0]}</span>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div key={location.pathname} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="p-4 lg:p-8 max-w-7xl mx-auto w-full">
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}