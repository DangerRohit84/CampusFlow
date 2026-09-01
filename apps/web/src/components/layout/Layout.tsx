import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { useAppStore } from '../../store/appStore'
import {
  LayoutDashboard, Bell, Settings, LogOut, Menu, X, GraduationCap,
  Sparkles, Search, Award, Target, Clock, Trophy,
  ClipboardList, Shield, DoorOpen, Briefcase, CheckSquare,
  Users, BarChart2, FolderOpen, Download, Brain, ListTodo, CalendarDays,
  Medal, UserCheck, Code2, FileText, Globe
} from 'lucide-react'
import { useState, useEffect } from 'react'
import clsx from 'clsx'
import CommandPalette from '../CommandPalette'
import ThemeToggle from '../ThemeToggle'
import AvatarDropdown from './AvatarDropdown'
import UsernameSetupModal from '../UsernameSetupModal'
import toast from 'react-hot-toast'
import { timetableAPI, hackathonAPI, formAPI, roomAPI, internshipAPI, codingContestAPI, notificationAPI, assignmentHubAPI, authAPI } from '../../lib/api'
import { connectSocket, disconnectSocket } from '../../lib/socket'

type NavItem = { path: string; label: string; icon: any }
type NavSection = { label: string; items: NavItem[] }

const navByRole: Record<string, NavSection[]> = {
  STUDENT: [
    { label: '', items: [{ path: '/dashboard', label: 'Overview', icon: LayoutDashboard }] },
    { label: 'ACADEMICS', items: [
      { path: '/schedule', label: 'Timetable', icon: Clock },
      { path: '/attendance', label: 'Attendance', icon: UserCheck },
      { path: '/grades', label: 'Grades', icon: Award },
      { path: '/assignments', label: 'Assignments', icon: FileText },
      { path: '/tasks', label: 'Planner', icon: ListTodo },
    ]},
    { label: 'OPPORTUNITIES', items: [
      { path: '/hackathons', label: 'Hackathons', icon: Trophy },
      { path: '/internships', label: 'Internships', icon: Briefcase },
      { path: '/contests', label: 'Contests', icon: Medal },
      { path: '/coding-profile', label: 'Coding Profile', icon: Code2 },
    ]},
    { label: 'CAMPUS', items: [
      { path: '/calendar', label: 'Calendar', icon: CalendarDays },
      { path: '/forms', label: 'Forms', icon: ClipboardList },
      { path: '/rooms', label: 'Rooms', icon: DoorOpen },
    ]},
    { label: 'CAREER', items: [
      { path: '/resume-studio', label: 'Resume Studio', icon: FileText },
      { path: '/portfolio-studio', label: 'Portfolio Studio', icon: Globe },
    ]},
  ],
  TEACHER: [
    { label: '', items: [{ path: '/dashboard', label: 'Overview', icon: LayoutDashboard }] },
    { label: 'ACADEMICS', items: [
      { path: '/assignments', label: 'Assignments', icon: FileText },
      { path: '/tasks', label: 'Planner', icon: ListTodo },
      { path: '/schedule', label: 'Timetable', icon: Clock },
      { path: '/calendar', label: 'Calendar', icon: CalendarDays },
    ]},
    { label: 'CAMPUS', items: [
      { path: '/hackathons', label: 'Hackathons', icon: Trophy },
      { path: '/internships', label: 'Internships', icon: Briefcase },
      { path: '/teacher/opportunities', label: 'Opportunities', icon: Target },
      { path: '/contests', label: 'Contests', icon: Medal },
      { path: '/contests/leaderboard', label: 'Leaderboard', icon: BarChart2 },
      { path: '/forms', label: 'Forms', icon: ClipboardList },
      { path: '/rooms', label: 'Rooms', icon: DoorOpen },
    ]},
    { label: 'CAREER', items: [
      { path: '/resume-studio', label: 'Resume Studio', icon: FileText },
      { path: '/portfolio-studio', label: 'Portfolio Studio', icon: Globe },
    ]},
    { label: 'Management', items: [{ path: '/admin', label: 'Admin Panel', icon: Shield }] },
  ],
  COLLEGE_ADMIN: [
    { label: '', items: [{ path: '/dashboard', label: 'Overview', icon: LayoutDashboard }] },
    { label: 'ACADEMICS', items: [
      { path: '/assignments', label: 'Assignments', icon: FileText },
      { path: '/tasks', label: 'Planner', icon: ListTodo },
      { path: '/schedule', label: 'Timetable', icon: Clock },
      { path: '/calendar', label: 'Calendar', icon: CalendarDays },
    ]},
    { label: 'CAMPUS', items: [
      { path: '/hackathons', label: 'Hackathons', icon: Trophy },
      { path: '/internships', label: 'Internships', icon: Briefcase },
      { path: '/admin/opportunities', label: 'Opportunities', icon: Target },
      { path: '/contests', label: 'Contests', icon: Medal },
      { path: '/contests/leaderboard', label: 'Leaderboard', icon: BarChart2 },
      { path: '/forms', label: 'Forms', icon: ClipboardList },
      { path: '/rooms', label: 'Rooms', icon: DoorOpen },
    ]},
    { label: 'CAREER', items: [
      { path: '/resume-studio', label: 'Resume Studio', icon: FileText },
      { path: '/portfolio-studio', label: 'Portfolio Studio', icon: Globe },
    ]},
    { label: 'Management', items: [{ path: '/admin', label: 'Admin Panel', icon: Shield }] },
  ],
  SUPER_ADMIN: [
    { label: '', items: [{ path: '/dashboard', label: 'Overview', icon: LayoutDashboard }] },
    { label: 'ACADEMICS', items: [
      { path: '/assignments', label: 'Assignments', icon: FileText },
      { path: '/tasks', label: 'Planner', icon: ListTodo },
      { path: '/schedule', label: 'Timetable', icon: Clock },
      { path: '/calendar', label: 'Calendar', icon: CalendarDays },
    ]},
    { label: 'CAMPUS', items: [
      { path: '/hackathons', label: 'Hackathons', icon: Trophy },
      { path: '/internships', label: 'Internships', icon: Briefcase },
      { path: '/admin/opportunities', label: 'Opportunities', icon: Target },
      { path: '/contests', label: 'Contests', icon: Medal },
      { path: '/contests/leaderboard', label: 'Leaderboard', icon: BarChart2 },
      { path: '/forms', label: 'Forms', icon: ClipboardList },
      { path: '/rooms', label: 'Rooms', icon: DoorOpen },
    ]},
    { label: 'CAREER', items: [
      { path: '/resume-studio', label: 'Resume Studio', icon: FileText },
      { path: '/portfolio-studio', label: 'Portfolio Studio', icon: Globe },
    ]},
    { label: 'Management', items: [
      { path: '/admin/fetch', label: 'Fetch Data', icon: Download },
      { path: '/admin/ai-manager', label: 'AI Manager', icon: Brain },
      { path: '/admin', label: 'Admin Panel', icon: Shield },
    ]},
  ],
}

export default function Layout() {
  const { user, logout, token, updateUser } = useAuthStore()
  const { sidebarOpen, setSidebarOpen } = useAppStore()
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpenLocal] = useState(false)
  const [showUsernameModal, setShowUsernameModal] = useState(false)
  const [nearDeadlineCount, setNearDeadlineCount] = useState({ hackathons: 0, forms: 0, internships: 0, contests: 0 })
  // Assignments urgent badge: overdue + due within 3 days (for students: only if not yet submitted)
  const [assignmentUrgent, setAssignmentUrgent] = useState({ count: 0, hasOverdue: false })
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [roomUnreadCount, setRoomUnreadCount] = useState(0)

  // username setup flow: STUDENT mandatory, TEACHER/COLLEGE_ADMIN/SUPER optional with 7-day snooze.
  // WHY: students need /u/:username for portfolio sharing (mandatory); staff/admins can optionally set later. Skipping remembers dismissal for 7 days so not asked every time.
  const USERNAME_SKIP_TTL_MS = 7 * 24 * 60 * 60 * 1000
  const isStudent = user?.role === 'STUDENT'
  const getUsernameSkipKey = (uid: string) => `campusflow:username-skip:${uid}`
  const hasSkippedRecently = (uid: string): boolean => {
    try {
      const raw = localStorage.getItem(getUsernameSkipKey(uid))
      if (!raw) return false
      const ts = Number(raw)
      if (!ts || Number.isNaN(ts)) return false
      return Date.now() - ts < USERNAME_SKIP_TTL_MS
    } catch { return false }
  }

  useEffect(() => {
    if (!token || !user) return
    const uname = (user as any)?.username
    if (uname) {
      // username exists — ensure modal is closed
      setShowUsernameModal(false)
      return
    }
    // For non-students: respect 7-day snooze — don't nag every load
    if (!isStudent && hasSkippedRecently(user.id)) {
      setShowUsernameModal(false)
      return
    }
    let cancelled = false
    const check = async () => {
      try {
        const me = await authAPI.me().catch(() => null)
        if (cancelled) return
        const remoteHasUsername = !!(me as any)?.username
        const localHasUsername = !!(user as any)?.username
        const hasUsername = remoteHasUsername || localHasUsername
        if (hasUsername) {
          const newU = (me as any)?.username
          if (newU && newU !== (user as any)?.username) updateUser({ username: newU } as any)
          setShowUsernameModal(false)
          return
        }
        // still no username
        if (!isStudent && hasSkippedRecently(user.id)) {
          setShowUsernameModal(false)
          return
        }
        setShowUsernameModal(true)
      } catch {
        // on error, fallback to local state; still respect snooze for non-students
        if (!cancelled && !(user as any)?.username) {
          if (!isStudent && hasSkippedRecently(user.id)) setShowUsernameModal(false)
          else setShowUsernameModal(true)
        }
      }
    }
    // slight delay so page loads first, like a welcome prompt
    const t = setTimeout(check, 900)
    return () => { cancelled = true; clearTimeout(t) }
  }, [token, user, updateUser, isStudent])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setShowCommandPalette(true) }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => { setMobileOpenLocal(false) }, [location.pathname])

  useEffect(() => {
    if (!token) return
    if (location.pathname === '/notifications') { setUnreadCount(0); return }
    notificationAPI.getUnreadCount().then((c: number) => setUnreadCount(c)).catch(()=>{})
  }, [token, location.pathname])

  useEffect(() => {
    if (!token) return
    let cancelled=false
    const refresh = async () => {
      try {
        const map = await roomAPI.getUnreadCounts()
        if (cancelled) return
        const total = Object.values(map as Record<string, number>).reduce((a:number,b:any)=>a+(Number(b)||0),0)
        setRoomUnreadCount(total)
      } catch {
        try {
          const rooms = await roomAPI.getAll()
          if (cancelled) return
          const total=(rooms as any[]).reduce((s:number,r:any)=>s+(Number(r.unreadCount)||0),0)
          setRoomUnreadCount(total)
        } catch {}
      }
    }
    refresh()
    const onRoomRead = () => refresh()
    window.addEventListener('room:read', onRoomRead)
    return () => { cancelled=true; window.removeEventListener('room:read', onRoomRead) }
  }, [token, location.pathname])

  useEffect(() => {
    if (!token) return
    const socket = connectSocket(token)
    const onConnect = () => socket.emit('auth:join')
    socket.on('connect', onConnect)
    const onNotification = (n:any) => { setUnreadCount(p=>p+1); toast(n.title||'New Notification',{icon:'📌',duration:3000}) }
    socket.on('notification:new', onNotification)
    const onRoomMessage = (msg:any) => {
      if (!msg?.roomId) return
      if (msg.senderId === user?.id) return
      const isOnRoomRoute = location.pathname.includes(`/rooms/${msg.roomId}`)
      if (isOnRoomRoute) {
        roomAPI.markRead(msg.roomId).catch(()=>{})
        roomAPI.getUnreadCounts().then((map:any)=>{
          const total=Object.values(map as Record<string,number>).reduce((a:number,b:any)=>a+(Number(b)||0),0)
          setRoomUnreadCount(total)
        }).catch(()=>{})
        return
      }
      setRoomUnreadCount(prev=>prev+1)
      setTimeout(()=>{ roomAPI.getUnreadCounts().then((map:any)=>{
        const total=Object.values(map as Record<string,number>).reduce((a:number,b:any)=>a+(Number(b)||0),0)
        setRoomUnreadCount(total)
      }).catch(()=>{}) },400)
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
    const isNear = (dateStr:string) => {
      if(!dateStr) return false
      const diff=new Date(dateStr).getTime()-Date.now()
      return diff>0 && diff<3*24*60*60*1000
    }
    hackathonAPI.getAll().then((data:any)=> setNearDeadlineCount(prev=>({...prev,hackathons:data.filter((h:any)=>isNear(h.deadline)).length}))).catch(()=>{})
    formAPI.getAll().then((data:any)=> setNearDeadlineCount(prev=>({...prev,forms:data.filter((f:any)=>isNear(f.expiresAt)).length}))).catch(()=>{})
    internshipAPI.getAll().then((data:any)=> setNearDeadlineCount(prev=>({...prev,internships:data.filter((i:any)=>i.status==='ACTIVE'&&i.deadline&&isNear(i.deadline)).length}))).catch(()=>{})
    codingContestAPI.getAll().then((data:any)=>{
      const now=Date.now()
      const c=data.filter((cc:any)=>{ const s=new Date(cc.startDate).getTime(); const e=s+(cc.duration||180)*60000; return now>=s&&now<=e }).length
      setNearDeadlineCount(prev=>({...prev,contests:c}))
    }).catch(()=>{})
  }, [])

  // Assignments: due soon (≤3 days) + overdue — for STUDENT hide already-submitted
  useEffect(() => {
    if (!token) return
    let cancelled = false
    const threeDays = 3 * 24 * 60 * 60 * 1000
    const fetchUrgency = async () => {
      try {
        const res: any = await assignmentHubAPI.getHubs({ page: 1, limit: 50 })
        if (cancelled) return
        const hubs: any[] = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : []
        const now = Date.now()
        const isStudent = user?.role === 'STUDENT'
        let overdue = 0
        let dueSoon = 0
        for (const h of hubs) {
          if (!h?.dueDate) continue
          const due = new Date(h.dueDate).getTime()
          if (Number.isNaN(due)) continue
          const diff = due - now
          const isOverdue = diff < 0
          const isDueSoon = diff >= 0 && diff < threeDays
          if (!isOverdue && !isDueSoon) continue
          // Students: don't badge assignments already submitted (mySubmission present)
          if (isStudent && h.mySubmission) continue
          if (isOverdue) overdue++
          else dueSoon++
        }
        if (!cancelled) setAssignmentUrgent({ count: overdue + dueSoon, hasOverdue: overdue > 0 })
      } catch {
        // keep previous value on failure
      }
    }
    fetchUrgency()
    const onMutated = () => fetchUrgency()
    window.addEventListener('assignment:mutated', onMutated)
    window.addEventListener('focus', onMutated)
    const interval = window.setInterval(fetchUrgency, 60_000)
    return () => {
      cancelled = true
      window.removeEventListener('assignment:mutated', onMutated)
      window.removeEventListener('focus', onMutated)
      window.clearInterval(interval)
    }
  }, [token, user?.role, user?.id, location.pathname])

  const getNearCount = (path:string) => {
    if(path==='/hackathons') return nearDeadlineCount.hackathons
    if(path==='/forms') return nearDeadlineCount.forms
    if(path==='/internships') return nearDeadlineCount.internships
    if(path==='/contests') return nearDeadlineCount.contests
    return 0
  }

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo — hallway plate */}
      <div className="px-4 py-5 flex items-center gap-3 border-b border-surface-200 dark:border-night-600/70">
        <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center shrink-0">
          <GraduationCap className="w-6 h-6 text-white" />
        </div>
        {sidebarOpen && (
          <div>
            <span className="text-[15px] font-bold tracking-tight text-surface-900 dark:text-night-50 font-display">CampusFlow</span>
            <p className="text-[10px] font-semibold tracking-widest uppercase text-surface-400 dark:text-night-400">Hall 01 · Campus OS</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 overflow-y-auto">
        {(navByRole[user?.role || 'STUDENT'] || navByRole.STUDENT).map((section)=>(
          <div key={section.label} className="mb-5">
            {sidebarOpen && section.label && (
              <p className="px-3 mb-2 text-[10px] font-bold uppercase tracking-widest text-surface-400 dark:text-night-400">
                {section.label}
              </p>
            )}
            {!sidebarOpen && section.label && <div className="h-px bg-surface-200 mx-2 mb-3" />}
            <div className="space-y-1">
              {section.items.map((item)=>{
                const isActive = location.pathname===item.path
                const Icon=item.icon
                const nearCount=getNearCount(item.path)
                const isRooms=item.path==='/rooms'
                const showRoomsBadge=isRooms && roomUnreadCount>0
                const isAssignments=item.path==='/assignments'
                const assignmentCount=assignmentUrgent.count
                const showAssignmentBadge=isAssignments && assignmentCount>0
                const assignmentTone=assignmentUrgent.hasOverdue ? 'bg-danger-500' : 'bg-amber-500'
                const assignmentTitle = isAssignments && showAssignmentBadge
                  ? `Assignments — ${assignmentCount} ${assignmentUrgent.hasOverdue ? 'overdue' : 'due soon'}`
                  : item.label
                const title = isRooms && roomUnreadCount>0 ? `Rooms (${roomUnreadCount>99?'99+':roomUnreadCount} unread)` : assignmentTitle
                return (
                  <button
                    key={item.path}
                    onClick={()=>navigate(item.path)}
                    title={title}
                    className={clsx(
                      'w-full flex items-center gap-3 rounded-xl font-medium transition-colors duration-150 relative text-left',
                      sidebarOpen ? 'px-3 min-h-[44px]' : 'justify-center px-0 min-h-[44px]',
                      isActive ? 'sidebar-link-active' : 'sidebar-link'
                    )}
                  >
                    {isActive && <span className="locker-stripe" />}
                    <span className="relative inline-flex">
                      <Icon size={18} className={clsx(isActive ? 'text-primary-700 dark:text-primary-300' : 'text-surface-500')} />
                      {!sidebarOpen && showRoomsBadge && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 bg-danger-500 text-white rounded-full text-[9px] font-bold flex items-center justify-center leading-none border-2 border-white">{roomUnreadCount>99?'99+':roomUnreadCount}</span>
                      )}
                      {!sidebarOpen && showAssignmentBadge && (
                        <span className={clsx('absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 text-white rounded-full text-[9px] font-bold flex items-center justify-center leading-none border-2 border-white', assignmentTone)}>{assignmentCount>99?'99+':assignmentCount}</span>
                      )}
                      {!sidebarOpen && !showRoomsBadge && !showAssignmentBadge && nearCount>0 && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 bg-danger-500 text-white rounded-full text-[9px] font-bold flex items-center justify-center leading-none border-2 border-white">{nearCount>99?'99+':nearCount}</span>
                      )}
                    </span>
                    {sidebarOpen && <span className="flex-1 text-left">{item.label}</span>}
                    {sidebarOpen && showAssignmentBadge && <span className={clsx('inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-white rounded-full text-[10px] font-bold', assignmentTone)}>{assignmentCount>99?'99+':assignmentCount}</span>}
                    {sidebarOpen && !showAssignmentBadge && nearCount>0 && <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-danger-500 text-white rounded-full text-[10px] font-bold">{nearCount}</span>}
                    {sidebarOpen && showRoomsBadge && <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-danger-500 text-white rounded-full text-[10px] font-bold">{roomUnreadCount>99?'99+':roomUnreadCount}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Locker bottom — assistant card */}
      {sidebarOpen && (
        <div className="px-3 pb-3">
          <div className="rounded-xl border border-surface-200 dark:border-night-650 bg-surface-100/70 dark:bg-night-800/80 p-3.5 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-bold tracking-wide uppercase text-surface-800 dark:text-night-200">Campus Assistant</span>
            </div>
            <p className="text-[11px] leading-relaxed text-surface-500 dark:text-night-400">Instant answers for courses, exams, schedules, and campus life.</p>
            <button onClick={()=>navigate('/chat')} className="mt-3 w-full min-h-[36px] px-3 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white text-white rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors shadow-sm">
              <Sparkles size={14} /> Ask Assistant
            </button>
          </div>
        </div>
      )}

      {/* User */}
      <div className="px-3 py-3 border-t border-surface-200 dark:border-night-600">
        <div className={clsx('flex items-center gap-3', !sidebarOpen && 'justify-center')}>
          <div className="w-9 h-9 rounded-xl bg-primary-600 flex items-center justify-center text-white font-bold text-xs shrink-0">
            {user?.name?.charAt(0) || 'S'}
          </div>
          {sidebarOpen && (
            <>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold text-surface-900 dark:text-night-50 truncate">{user?.name || 'Student'}</p>
                  <CheckSquare size={12} className="text-primary-600 shrink-0" />
                </div>
                <p className="text-[11px] text-surface-400 dark:text-night-400 truncate">{user?.email || 'student@campus.edu'}</p>
              </div>
              <button onClick={()=>{logout(); navigate('/login')}} className="w-11 h-11 inline-flex items-center justify-center rounded-xl text-surface-400 dark:text-night-400 hover:text-danger-600 hover:bg-danger-50 transition-colors" title="Sign out">
                <LogOut size={16} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex h-screen bg-surface-50 dark:bg-night-800 overflow-hidden isolate">
      {/* Desktop Sidebar — 280 / 72 hallway locker — keep z lower than portals (portals use 9998-10000) */}
      <aside className={clsx(
        'hidden lg:flex flex-col shrink-0 locker-rail transition-[width] duration-200 overflow-hidden relative z-10',
        sidebarOpen ? 'w-[280px]' : 'w-[72px]'
      )} style={{ transform: 'none', filter: 'none', contain: 'none' }}>
        <SidebarContent />
      </aside>

      {/* Main — isolate so animate-slideUp transform doesn't become containing block for portaled fixed */}
      <div className="flex-1 flex flex-col overflow-hidden bg-surface-50 dark:bg-night-800 relative z-0 isolate">
        {/* Header — paper bar, flat, 44px controls — hanging bulb attached to nav bar right side */}
        <header className="h-16 border-b border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 flex items-center justify-between px-4 lg:px-6 shrink-0 relative overflow-visible">
          <div className="flex items-center gap-3">
            <button
              onClick={()=> window.innerWidth>=1024 ? setSidebarOpen(!sidebarOpen) : setMobileOpenLocal(true)}
              className="w-11 h-11 inline-flex items-center justify-center rounded-xl text-surface-500 dark:text-night-400 hover:bg-surface-100 dark:hover:bg-night-700 transition-colors shrink-0"
              aria-label="Toggle navigation"
            >
              {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            {/* search — card look */}
            <div className="relative hidden sm:block">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 dark:text-night-400" />
              <input
                type="text"
                placeholder="Search courses, rooms…  ⌘K"
                className="w-[280px] xl:w-[360px] pl-10 pr-4 min-h-[44px] bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-xl text-sm text-surface-900 dark:text-night-50 placeholder:text-surface-400 dark:placeholder:text-night-400 focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-500/15 transition-colors"
                readOnly
                onClick={()=> document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',metaKey:true}))}
              />
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button className="relative w-11 h-11 inline-flex items-center justify-center rounded-xl text-surface-500 dark:text-night-400 hover:bg-surface-100 dark:hover:bg-night-700 transition-colors" onClick={()=>navigate('/notifications')} aria-label="Notifications">
              <Bell size={18} />
              {unreadCount>0 && <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 bg-danger-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center border-2 border-white dark:border-night-800">{unreadCount>99?'99+':unreadCount}</span>}
            </button>
            <div className="hidden sm:block w-px h-6 bg-surface-200 dark:bg-night-650" />
            {/* avatar only — circular (spec) */}
            <AvatarDropdown />
          </div>

          {/* hanging bulb — hanging from bottom edge of nav (top-full), free unlimited drag */}
          <div className="absolute right-16 lg:right-24 top-full z-50 pointer-events-auto">
            <ThemeToggle />
          </div>
        </header>

        {/* Page content — 12-col 1280 container */}
        <main className="flex-1 overflow-y-auto">
          <div className="campus-shell py-6">
            <div className="animate-slideUp">
              <Outlet />
            </div>
          </div>
        </main>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40 lg:hidden backdrop-blur-sm" onClick={()=>setMobileOpenLocal(false)} />
          <aside className="fixed inset-y-0 left-0 w-[280px] bg-surface-50 dark:bg-night-850 z-50 lg:hidden shadow-e3 animate-slideUp locker-rail overflow-hidden flex flex-col">
            <button onClick={()=>setMobileOpenLocal(false)} className="absolute top-3 right-3 w-11 h-11 inline-flex items-center justify-center rounded-xl text-surface-500 dark:text-night-400 hover:bg-surface-100 dark:hover:bg-night-700"><X size={20} /></button>
            <SidebarContent />
          </aside>
        </>
      )}

      <CommandPalette open={showCommandPalette} onClose={()=>setShowCommandPalette(false)} />
      <UsernameSetupModal
        open={showUsernameModal}
        force={isStudent}
        onClose={() => {
          // Student mandatory guard: only allow close if username actually exists
          // Teacher/admin optional: allow dismiss and remember snooze for 7 days
          const fresh = (useAuthStore.getState().user as any)?.username
          const local = (user as any)?.username
          const hasUsername = !!(fresh || local)
          if (isStudent && !hasUsername) {
            toast.error('Please save a username to continue')
            return
          }
          if (!isStudent && !hasUsername && user?.id) {
            try { localStorage.setItem(getUsernameSkipKey(user.id), String(Date.now())) } catch {}
          }
          setShowUsernameModal(false)
        }}
        onSkip={() => {
          // Teacher/admin skip: remember dismissal for 7 days so don't ask every time
          if (user?.id) {
            try { localStorage.setItem(getUsernameSkipKey(user.id), String(Date.now())) } catch {}
          }
          setShowUsernameModal(false)
        }}
      />
    </div>
  )
}
