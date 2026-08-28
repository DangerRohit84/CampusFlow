import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { useAppStore } from '../../store/appStore'
import {
  LayoutDashboard, Bell, Settings, LogOut, Menu, X, GraduationCap,
  Sparkles, Search, Award, Target, Clock, Trophy,
  ClipboardList, Shield, DoorOpen, Briefcase, CheckSquare,
  Users, BarChart2, FolderOpen, Download, Brain, ListTodo, CalendarDays,
  Medal, UserCheck, Code2
} from 'lucide-react'
import { useState, useEffect } from 'react'
import clsx from 'clsx'
import CommandPalette from '../CommandPalette'
import ThemeToggle from '../ThemeToggle'
import toast from 'react-hot-toast'
import { timetableAPI, hackathonAPI, formAPI, roomAPI, internshipAPI, codingContestAPI, notificationAPI } from '../../lib/api'
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
  ],
  TEACHER: [
    { label: '', items: [{ path: '/dashboard', label: 'Overview', icon: LayoutDashboard }] },
    { label: 'CAMPUS', items: [
      { path: '/hackathons', label: 'Hackathons', icon: Trophy },
      { path: '/internships', label: 'Internships', icon: Briefcase },
      { path: '/teacher/opportunities', label: 'Opportunities', icon: Target },
      { path: '/contests', label: 'Contests', icon: Medal },
      { path: '/contests/leaderboard', label: 'Leaderboard', icon: BarChart2 },
      { path: '/schedule', label: 'Timetable', icon: Clock },
      { path: '/calendar', label: 'Calendar', icon: CalendarDays },
      { path: '/forms', label: 'Forms', icon: ClipboardList },
      { path: '/rooms', label: 'Rooms', icon: DoorOpen },
    ]},
    { label: 'Management', items: [{ path: '/admin', label: 'Admin Panel', icon: Shield }] },
  ],
  COLLEGE_ADMIN: [
    { label: '', items: [{ path: '/dashboard', label: 'Overview', icon: LayoutDashboard }] },
    { label: 'CAMPUS', items: [
      { path: '/hackathons', label: 'Hackathons', icon: Trophy },
      { path: '/internships', label: 'Internships', icon: Briefcase },
      { path: '/admin/opportunities', label: 'Opportunities', icon: Target },
      { path: '/contests', label: 'Contests', icon: Medal },
      { path: '/contests/leaderboard', label: 'Leaderboard', icon: BarChart2 },
      { path: '/forms', label: 'Forms', icon: ClipboardList },
      { path: '/rooms', label: 'Rooms', icon: DoorOpen },
    ]},
    { label: 'Management', items: [{ path: '/admin', label: 'Admin Panel', icon: Shield }] },
  ],
  SUPER_ADMIN: [
    { label: '', items: [{ path: '/dashboard', label: 'Overview', icon: LayoutDashboard }] },
    { label: 'CAMPUS', items: [
      { path: '/hackathons', label: 'Hackathons', icon: Trophy },
      { path: '/internships', label: 'Internships', icon: Briefcase },
      { path: '/admin/opportunities', label: 'Opportunities', icon: Target },
      { path: '/contests', label: 'Contests', icon: Medal },
      { path: '/contests/leaderboard', label: 'Leaderboard', icon: BarChart2 },
      { path: '/forms', label: 'Forms', icon: ClipboardList },
      { path: '/rooms', label: 'Rooms', icon: DoorOpen },
    ]},
    { label: 'Management', items: [
      { path: '/admin/fetch', label: 'Fetch Data', icon: Download },
      { path: '/admin/ai-manager', label: 'AI Manager', icon: Brain },
      { path: '/admin', label: 'Admin Panel', icon: Shield },
    ]},
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
      <div className="px-4 py-5 flex items-center gap-3 border-b border-surface-200/70">
        <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center shrink-0">
          <GraduationCap className="w-6 h-6 text-white" />
        </div>
        {sidebarOpen && (
          <div>
            <span className="text-[15px] font-bold tracking-tight text-surface-900 font-display">CampusFlow</span>
            <p className="text-[10px] font-semibold tracking-widest uppercase text-surface-400">Hall 01 · Campus OS</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 overflow-y-auto">
        {(navByRole[user?.role || 'STUDENT'] || navByRole.STUDENT).map((section)=>(
          <div key={section.label} className="mb-5">
            {sidebarOpen && section.label && (
              <p className="px-3 mb-2 text-[10px] font-bold uppercase tracking-widest text-surface-400">
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
                return (
                  <button
                    key={item.path}
                    onClick={()=>navigate(item.path)}
                    title={isRooms && roomUnreadCount>0 ? `Rooms (${roomUnreadCount>99?'99+':roomUnreadCount} unread)`: item.label}
                    className={clsx(
                      'w-full flex items-center gap-3 rounded-xl font-medium transition-colors duration-150 relative text-left',
                      sidebarOpen ? 'px-3 min-h-[44px]' : 'justify-center px-0 min-h-[44px]',
                      isActive ? 'sidebar-link-active' : 'sidebar-link'
                    )}
                  >
                    {isActive && <span className="locker-stripe" />}
                    <span className="relative inline-flex">
                      <Icon size={18} className={clsx(isActive && 'text-primary-600')} />
                      {!sidebarOpen && showRoomsBadge && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 bg-danger-500 text-white rounded-full text-[9px] font-bold flex items-center justify-center leading-none border-2 border-white">{roomUnreadCount>99?'99+':roomUnreadCount}</span>
                      )}
                      {!sidebarOpen && nearCount>0 && !showRoomsBadge && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 bg-danger-500 text-white rounded-full text-[9px] font-bold flex items-center justify-center leading-none border-2 border-white">{nearCount>99?'99+':nearCount}</span>
                      )}
                    </span>
                    {sidebarOpen && <span className="flex-1 text-left">{item.label}</span>}
                    {sidebarOpen && nearCount>0 && <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-danger-500 text-white rounded-full text-[10px] font-bold">{nearCount}</span>}
                    {sidebarOpen && showRoomsBadge && <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-danger-500 text-white rounded-full text-[10px] font-bold">{roomUnreadCount>99?'99+':roomUnreadCount}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Locker bottom — registrar card */}
      {sidebarOpen && (
        <div className="px-3 pb-3">
          <div className="rounded-xl border border-brass-400/30 bg-brass-50 p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-1.5 h-1.5 rounded-full bg-brass-400" />
              <span className="text-xs font-bold tracking-wide uppercase text-surface-700">Registrar Desk</span>
            </div>
            <p className="text-[11px] leading-relaxed text-surface-500">Questions? Visit the desk or ask the assistant.</p>
            <button onClick={()=>navigate('/chat')} className="mt-3 w-full min-h-[36px] px-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5">
              <Sparkles size={14} /> Ask Assistant
            </button>
          </div>
        </div>
      )}

      {/* User */}
      <div className="px-3 py-3 border-t border-surface-200">
        <div className={clsx('flex items-center gap-3', !sidebarOpen && 'justify-center')}>
          <div className="w-9 h-9 rounded-xl bg-primary-600 flex items-center justify-center text-white font-bold text-xs shrink-0">
            {user?.name?.charAt(0) || 'S'}
          </div>
          {sidebarOpen && (
            <>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold text-surface-900 truncate">{user?.name || 'Student'}</p>
                  <CheckSquare size={12} className="text-primary-600 shrink-0" />
                </div>
                <p className="text-[11px] text-surface-400 truncate">{user?.email || 'student@campus.edu'}</p>
              </div>
              <button onClick={()=>{logout(); navigate('/login')}} className="w-11 h-11 inline-flex items-center justify-center rounded-xl text-surface-400 hover:text-danger-600 hover:bg-danger-50 transition-colors" title="Sign out">
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
      {/* Desktop Sidebar — 280 / 72 hallway locker */}
      <aside className={clsx(
        'hidden lg:flex flex-col shrink-0 locker-rail transition-all duration-200 overflow-hidden',
        sidebarOpen ? 'w-[280px]' : 'w-[72px]'
      )}>
        <SidebarContent />
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden bg-surface-50">
        {/* Header — paper bar, flat, 44px controls */}
        <header className="h-16 border-b border-surface-200 bg-white flex items-center justify-between px-4 lg:px-6 shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={()=> window.innerWidth>=1024 ? setSidebarOpen(!sidebarOpen) : setMobileOpenLocal(true)}
              className="w-11 h-11 inline-flex items-center justify-center rounded-xl text-surface-500 hover:bg-surface-100 transition-colors shrink-0"
              aria-label="Toggle navigation"
            >
              {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            {/* search — card look */}
            <div className="relative hidden sm:block">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
              <input
                type="text"
                placeholder="Search courses, rooms…  ⌘K"
                className="w-[280px] xl:w-[360px] pl-10 pr-4 min-h-[44px] bg-surface-50 border border-surface-200 rounded-xl text-sm text-surface-900 placeholder:text-surface-400 focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-500/15 transition-colors"
                readOnly
                onClick={()=> document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',metaKey:true}))}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button className="relative w-11 h-11 inline-flex items-center justify-center rounded-xl text-surface-500 hover:bg-surface-100 transition-colors" onClick={()=>navigate('/notifications')} aria-label="Notifications">
              <Bell size={18} />
              {unreadCount>0 && <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 bg-danger-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center border-2 border-white">{unreadCount>99?'99+':unreadCount}</span>}
            </button>
            <div className="hidden sm:block w-px h-6 bg-surface-200" />
            <button onClick={()=>navigate('/settings')} className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-xl hover:bg-surface-50 transition-colors">
              <div className="w-8 h-8 rounded-xl bg-primary-600 flex items-center justify-center text-white font-bold text-xs">
                {user?.name?.charAt(0) || 'A'}
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-sm font-semibold leading-none text-surface-900">{user?.name || 'Admin'}</p>
                <p className="text-[10px] tracking-wide uppercase font-semibold text-surface-400">{user?.role?.replace('_',' ') || 'Super Admin'}</p>
              </div>
            </button>
          </div>
        </header>

        {/* hanging lamp — moved left to avoid covering announcement count badge (right side) */}
        <div className="relative h-0 pointer-events-none">
          <div className="absolute right-16 lg:right-24 top-0 z-10 pointer-events-auto">
            <ThemeToggle />
          </div>
        </div>

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
          <aside className="fixed inset-y-0 left-0 w-[280px] bg-[#F5F1E8] z-50 lg:hidden shadow-e3 animate-slideUp locker-rail overflow-hidden flex flex-col">
            <button onClick={()=>setMobileOpenLocal(false)} className="absolute top-3 right-3 w-11 h-11 inline-flex items-center justify-center rounded-xl text-surface-500 hover:bg-surface-100"><X size={20} /></button>
            <SidebarContent />
          </aside>
        </>
      )}

      <CommandPalette open={showCommandPalette} onClose={()=>setShowCommandPalette(false)} />
    </div>
  )
}
