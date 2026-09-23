import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { useAppStore } from '../../store/appStore'
import {
  LayoutDashboard, Bell, Settings, LogOut, Menu, X,
  Sparkles, Search, Award, Target, Clock, Trophy,
  ClipboardList, Shield, DoorOpen, Briefcase, GraduationCap,
  Users, BarChart2, FolderOpen, Download, Brain, ListTodo, CalendarDays,
  Medal, UserCheck, Code2, FileText, Globe, Building2, ArrowLeft, Flag, AlertTriangle, CircleHelp
} from 'lucide-react'
import BrandLogo from '../BrandLogo'
import { useState, useEffect, useRef, useMemo } from 'react'
import clsx from 'clsx'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { qk } from '../../lib/queryKeys'
import CommandPalette from '../CommandPalette'
import ThemeToggle from '../ThemeToggle'
import AvatarDropdown from './AvatarDropdown'
import UsernameSetupModal from '../UsernameSetupModal'
import PasswordNudgeBanner from '../admin/PasswordNudgeBanner'
import ReportModal from '../ReportModal'
import toast from 'react-hot-toast'
import { hackathonAPI, formAPI, roomAPI, internshipAPI, codingContestAPI, notificationAPI, assignmentHubAPI, authAPI } from '../../lib/api'
import { connectSocket, disconnectSocket } from '../../lib/socket'
import { ALL_BRIDGED_SOCKET_EVENTS, bridgeSocketEvent } from '../../lib/entitySync'
import { useSuperAdminCollegeStore, getSuperAdminCollegeId } from '../../store/superAdminCollegeStore'
import { LOGOUT_DEST } from '../../lib/logout'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import {
  countAssignmentUrgent,
  countLiveContests,
  countNearDeadline,
  formatBadgeCount,
  getSidebarBadgeLabel,
} from './sidebarUrgency'

type NavItem = { path: string; label: string; icon: any }
type NavSection = { label: string; items: NavItem[] }

const navByRole: Record<string, NavSection[]> = {
  // §7 FINAL: deadlines first within kept sections (no folding).
  STUDENT: [
    { label: '', items: [{ path: '/dashboard', label: 'Overview', icon: LayoutDashboard }] },
    { label: 'ACADEMICS', items: [
      { path: '/assignments', label: 'Assignments', icon: FileText },
      { path: '/tasks', label: 'Planner', icon: ListTodo },
      { path: '/schedule', label: 'Timetable', icon: Clock },
      { path: '/attendance', label: 'Attendance', icon: UserCheck },
      { path: '/grades', label: 'Grades', icon: Award },
    ]},
    { label: 'OPPORTUNITIES', items: [
      { path: '/hackathons', label: 'Hackathons', icon: Trophy },
      { path: '/contests', label: 'Contests', icon: Medal },
      { path: '/internships', label: 'Internships', icon: Briefcase },
      { path: '/coding-profile', label: 'Coding Profile', icon: Code2 },
    ]},
    { label: 'CAMPUS', items: [
      { path: '/forms', label: 'Forms', icon: ClipboardList },
      { path: '/rooms', label: 'Rooms', icon: DoorOpen },
      { path: '/alumni', label: 'Alumni', icon: GraduationCap },
      { path: '/calendar', label: 'Calendar', icon: CalendarDays },
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
      { path: '/contests', label: 'Contests', icon: Medal },
      { path: '/internships', label: 'Internships', icon: Briefcase },
      { path: '/forms', label: 'Forms', icon: ClipboardList },
      { path: '/rooms', label: 'Rooms', icon: DoorOpen },
      { path: '/alumni', label: 'Alumni', icon: GraduationCap },
      { path: '/teacher/opportunities', label: 'Opportunities', icon: Target },
      { path: '/contests/leaderboard', label: 'Leaderboard', icon: BarChart2 },
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
      { path: '/contests', label: 'Contests', icon: Medal },
      { path: '/internships', label: 'Internships', icon: Briefcase },
      { path: '/forms', label: 'Forms', icon: ClipboardList },
      { path: '/rooms', label: 'Rooms', icon: DoorOpen },
      { path: '/alumni', label: 'Alumni', icon: GraduationCap },
      { path: '/admin/opportunities', label: 'Opportunities', icon: Target },
      { path: '/contests/leaderboard', label: 'Leaderboard', icon: BarChart2 },
    ]},
    { label: 'CAREER', items: [
      { path: '/resume-studio', label: 'Resume Studio', icon: FileText },
      { path: '/portfolio-studio', label: 'Portfolio Studio', icon: Globe },
    ]},
    { label: 'Management', items: [{ path: '/admin', label: 'Admin Panel', icon: Shield }, { path: '/reports', label: 'Reports', icon: Flag }] },
  ],
  SUPER_ADMIN: [
    { label: '', items: [
      { path: '/superadmin', label: 'Superadmin Overview', icon: BarChart2 },
      { path: '/superadmin/colleges', label: 'Colleges', icon: Building2 },
      { path: '/superadmin/reports', label: 'Reports', icon: Flag },
      { path: '/admin/fetch', label: 'Fetch Data', icon: Download },
      { path: '/admin/ai-manager', label: 'AI Manager', icon: Brain },
    ]},
  ],
  // Scoped view when SUPER_ADMIN drills into a tenant — mirrors COLLEGE_ADMIN full sidebar
  // Sidebar all like remaining based on it plan — full tenant UI scoped to collegeId
  SUPER_ADMIN_SCOPED: [
    { label: '', items: [{ path: '/dashboard', label: 'Overview', icon: LayoutDashboard }] },
    { label: 'ACADEMICS', items: [
      { path: '/assignments', label: 'Assignments', icon: FileText },
      { path: '/tasks', label: 'Planner', icon: ListTodo },
      { path: '/schedule', label: 'Timetable', icon: Clock },
      { path: '/calendar', label: 'Calendar', icon: CalendarDays },
    ]},
    { label: 'CAMPUS', items: [
      { path: '/hackathons', label: 'Hackathons', icon: Trophy },
      { path: '/contests', label: 'Contests', icon: Medal },
      { path: '/internships', label: 'Internships', icon: Briefcase },
      { path: '/forms', label: 'Forms', icon: ClipboardList },
      { path: '/rooms', label: 'Rooms', icon: DoorOpen },
      { path: '/alumni', label: 'Alumni', icon: GraduationCap },
      { path: '/admin/opportunities', label: 'Opportunities', icon: Target },
      { path: '/contests/leaderboard', label: 'Leaderboard', icon: BarChart2 },
    ]},
    { label: 'CAREER', items: [
      { path: '/resume-studio', label: 'Resume Studio', icon: FileText },
      { path: '/portfolio-studio', label: 'Portfolio Studio', icon: Globe },
    ]},
    { label: 'Management', items: [{ path: '/admin', label: 'Admin Panel', icon: Shield }, { path: '/reports', label: 'Reports', icon: Flag }] },
  ],
}

export default function Layout() {
  // WHY logout race: whole-store destructure re-rendered on set() and raced
  // navigate(); selectors keep logout stable. Token falsy effect below
  // disconnects socket as backup — primary disconnect is sync in logout().
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const token = useAuthStore((s) => s.token)
  const updateUser = useAuthStore((s) => s.updateUser)
  const { sidebarOpen, setSidebarOpen } = useAppStore()
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpenLocal] = useState(false)
  // SUPER_ADMIN scoped college context — drives tenant sidebar when inside a college
  const { selectedCollegeId, selectedCollegeName, clear: clearSuperCollege } = useSuperAdminCollegeStore()
  const superScopedMatch = location.pathname.match(/^\/superadmin\/colleges\/([^\/]+)/)
  const urlScopedId = superScopedMatch ? superScopedMatch[1] : null
  const searchCollegeId = new URLSearchParams(location.search).get('collegeId')
  const effectiveCollegeId = urlScopedId || selectedCollegeId || searchCollegeId
  const effectiveCollegeName = selectedCollegeName || (urlScopedId ? urlScopedId : null)
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const tenantRoutePrefixes = ['/dashboard','/assignments','/tasks','/schedule','/calendar','/hackathons','/internships','/contests','/forms','/rooms','/alumni','/admin','/resume-studio','/portfolio-studio','/announcements','/notifications','/settings','/search','/chat','/superadmin/colleges/','/reports','/superadmin/reports']
  const isOnTenantRoute = tenantRoutePrefixes.some(p => location.pathname === p || location.pathname.startsWith(p + '/'))
  const isSuperScoped = isSuperAdmin && ( !!urlScopedId || (!!effectiveCollegeId && isOnTenantRoute && !['/superadmin','/superadmin/colleges','/superadmin/reports','/admin/fetch','/admin/ai-manager'].includes(location.pathname)) )
  // Keep legacy localStorage keys in sync for api interceptor when scoped via URL or query
  useEffect(() => {
    if (isSuperAdmin && urlScopedId && urlScopedId !== selectedCollegeId) {
      useSuperAdminCollegeStore.getState().setSelectedCollege(urlScopedId, selectedCollegeName || urlScopedId)
      try { localStorage.setItem('superadmin_selectedCollegeId', urlScopedId) } catch {}
    }
    if (isSuperAdmin && searchCollegeId && searchCollegeId !== selectedCollegeId && !urlScopedId) {
      useSuperAdminCollegeStore.getState().setSelectedCollege(searchCollegeId, selectedCollegeName || searchCollegeId)
      try { localStorage.setItem('superadmin_selectedCollegeId', searchCollegeId) } catch {}
    }
  }, [isSuperAdmin, urlScopedId, searchCollegeId, selectedCollegeId, selectedCollegeName])
  const [showUsernameModal, setShowUsernameModal] = useState(false)
  // PERPAGE-MISSED: urgency badges were 4 uncached getAll() mount effects
  // (hackathon/form/internship/contest) + a duplicate of every page-level RQ
  // list (Layout + page = 2× GETs per entity on first load, StrictMode 2×).
  // Now shared RQ keys with staleTime (same qk.* keys + college scope as the
  // pages, so Layout + Hackathons/Forms/Internships/Contests pages share ONE
  // cache entry — RQ dedupes simultaneous same-key mounts to 1 GET).
  // staleTime mirrors the pages (hack/forms/intern 3min, contests 60s live).
  // Socket singleton + bridge below untouched.
  const badgeCollegeScope = (user as any)?.collegeId || effectiveCollegeId || undefined
  // PERF: skip urgency badges on the pure super-admin overview (sidebar there
  // shows no badged items — /superadmin, /superadmin/colleges, /reports,
  // /admin/fetch, /admin/ai-manager). Was 4 full-list GETs per superadmin
  // load on top of the dashboard + KPI fan-out. Scoped tenant views keep them.
  const badgesEnabled = !!user && (!isSuperAdmin || isSuperScoped)
  // WHY cookie-only: HttpOnly session may have user but null token. Gate badges
  // on user (not token-only) so cookie-only still fetches; token stays for socket auth.
  const { data: badgeHackathons } = useQuery({
    queryKey: qk.hackathons('', badgeCollegeScope),
    queryFn: ({ signal }) => hackathonAPI.getAll({ signal } as any),
    staleTime: 3 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: badgesEnabled,
  })
  const { data: badgeForms } = useQuery({
    queryKey: qk.forms(badgeCollegeScope),
    queryFn: ({ signal }) => formAPI.getAll({ signal } as any),
    staleTime: 3 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: badgesEnabled,
  })
  const { data: badgeInternships } = useQuery({
    queryKey: qk.internships('', badgeCollegeScope),
    queryFn: ({ signal }) => internshipAPI.getAll({ signal } as any),
    staleTime: 3 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: badgesEnabled,
  })
  const { data: badgeContests } = useQuery({
    queryKey: qk.contests('ALL', badgeCollegeScope),
    queryFn: ({ signal }) => codingContestAPI.getAll({ signal } as any),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: badgesEnabled,
  })
  const nearDeadlineCount = useMemo(() => {
    // WHY shared helper: single resolveDate/isBadgeable/isNear per entity
    // (F4 startTime||startDate, F5 expiresAt||deadline, F6 ACTIVE filter).
    // Single red pill only (§7) — no overdue split, 0 = hidden, cap 99+.
    const hacks = Array.isArray(badgeHackathons) ? badgeHackathons : []
    const forms = Array.isArray(badgeForms) ? badgeForms : []
    const interns = Array.isArray(badgeInternships) ? badgeInternships : []
    const contests = Array.isArray(badgeContests) ? badgeContests : []
    return {
      hackathons: countNearDeadline(hacks, 'hackathon'),
      forms: countNearDeadline(forms, 'form'),
      internships: countNearDeadline(interns, 'internship'),
      contests: countLiveContests(contests),
    }
  }, [badgeHackathons, badgeForms, badgeInternships, badgeContests])
  // Assignments urgent badge: overdue + due within 3 days (for students: only if not yet submitted)
  const [assignmentUrgent, setAssignmentUrgent] = useState({ count: 0, hasOverdue: false })
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [roomUnreadCount, setRoomUnreadCount] = useState(0)
  // WHY: mobile drawer is a modal dialog (WCAG 2.4.3) — trap focus, ESC to close, lock body scroll.
  const mobileDrawerRef = useRef<HTMLElement>(null)
  useFocusTrap(mobileDrawerRef, mobileOpen)
  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpenLocal(false)
    }
    document.addEventListener('keydown', onKey, true)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prevOverflow
    }
  }, [mobileOpen])

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
    // WHY cookie-only: gate on user (not token-only) — HttpOnly session has
    // user with null token, authAPI.me() works via cookies.
    if (!user) return
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
    // WHY cookie-only: gate on user (not token-only) so cookie session still loads counts.
    if (!user) return
    if (location.pathname === '/notifications') { setUnreadCount(0); return }
    notificationAPI.getUnreadCount().then((c: number) => setUnreadCount(c)).catch(()=>{})
  }, [token, user?.id, location.pathname])

  useEffect(() => {
    // WHY cookie-only: gate on user (not token-only) so cookie session still loads counts.
    if (!user) return
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
  }, [token, user?.id, location.pathname])

  useEffect(() => {
    // WHY cookie-only: gate socket on user (not token-only) — token may be null
    // while HttpOnly cookies carry the session. connectSocket accepts null.
    if (!user) {
      disconnectSocket()
      return
    }
    const socket = connectSocket(token)
    // If already connected (e.g., after fast navigation with fixed singleton), ensure server knows us
    if (socket.connected) {
      socket.emit('auth:join')
    }
    const onConnect = () => socket.emit('auth:join')
    socket.on('connect', onConnect)
    // WHY: no emoji in toasts (WCAG + cross-platform) — Lucide Bell keeps iconography consistent.
    const onNotification = (n:any) => { setUnreadCount(p=>p+1); toast(n.title||'New Notification',{icon: <Bell size={16} aria-hidden="true" />,duration:3000}) }
    socket.on('notification:new', onNotification)
    const onRoomMessage = (msg:any) => {
      if (!msg?.roomId) return
      if (msg.senderId === user?.id) return
      // Use window.location instead of closure-captured location.pathname to avoid
      // needing `location.pathname` in deps (which would recreate socket on every navigation -> leak).
      const currentPath = window.location.pathname
      const isOnRoomRoute = currentPath.includes(`/rooms/${msg.roomId}`)
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
    // Cross-client realtime bridge (SINGLE PLACE): every backend broadcast
    // becomes a window CustomEvent + RQ invalidation via the canonical
    // `bridgeSocketEvent` (entitySync.ts). Single source of truth — no
    // per-page socket wiring drift, no dead keys, full related-key fan-out
    // (dashboard/counts/search) matching same-tab `notifyEntityMutated`.
    const bridgedHandlers: Array<{ ev: string; fn: (p: any) => void }> = []
    for (const sev of ALL_BRIDGED_SOCKET_EVENTS) {
      const fn = (payload: any) => {
        try { bridgeSocketEvent(sev, payload ?? {}) } catch {}
      }
      socket.on(sev, fn)
      bridgedHandlers.push({ ev: sev, fn })
    }
    return () => {
      socket.off('connect', onConnect)
      socket.off('notification:new', onNotification)
      socket.off('room:message:new', onRoomMessage)
      bridgedHandlers.forEach(({ ev, fn }) => socket.off(ev, fn))
      // Do NOT disconnect here — socket is a global singleton tied to auth session, not route.
      // Disconnecting on every location change causes rapid connect/disconnect and orphaned "connecting" sockets.
      // Cleanup is only listeners; actual disconnect happens when token becomes falsy (logout) or Layout unmounts.
    }
  }, [token, user?.id])

  // Badge counts now derive from the shared RQ queries above (useMemo) —
  // the old 4× uncached mount useEffect was removed (PERPAGE-MISSED).

  // Assignments: due soon (≤3 days) + overdue — for STUDENT hide already-submitted.
  // PERPAGE-MISSED: was refetching getHubs on EVERY pathname change
  // (dep location.pathname) + 60s interval + focus listener, duplicating the
  // AssignmentHubPage RQ fetch (same endpoint, page owns the list). Now:
  // no pathname dep (mount/auth only), 5min interval, skip while the hubs
  // page is active (page owns freshness there), focus revalidates at most
  // 1×/60s. assignment:mutated still refreshes immediately (entity-driven).
  // Socket singleton + bridge above untouched.
  useEffect(() => {
    // WHY cookie-only: gate on user (not token-only) so cookie session still loads urgency.
    if (!user) return
    // PERF: pure super-admin overview shows no assignment badge — skip the
    // getHubs urgency fetch there (scoped tenant views keep it).
    if (isSuperAdmin && !isSuperScoped) return
    let cancelled = false
    let lastFetchAt = 0
    const FOCUS_MIN_GAP_MS = 60 * 1000
    const isOnHubsPage = () => window.location.pathname.startsWith('/assignments')
    const fetchUrgency = async () => {
      // Hubs page active → skip (page-level RQ owns the data; badge refreshes
      // on return via focus/mutated). Urgency-only scope, not a full list sync.
      if (isOnHubsPage()) return
      lastFetchAt = Date.now()
      try {
        const res: any = await assignmentHubAPI.getHubs({ page: 1, limit: 50 })
        if (cancelled) return
        const hubs: any[] = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : []
        // WHY shared helper: overdue + due ≤3d, students minus submitted (§7).
        const urgency = countAssignmentUrgent(hubs, { isStudent: user?.role === 'STUDENT' })
        if (!cancelled) setAssignmentUrgent(urgency)
      } catch {
        // keep previous value on failure
      }
    }
    fetchUrgency()
    const onMutated = () => fetchUrgency()
    const onFocus = () => {
      if (Date.now() - lastFetchAt < FOCUS_MIN_GAP_MS) return
      fetchUrgency()
    }
    window.addEventListener('assignment:mutated', onMutated)
    window.addEventListener('focus', onFocus)
    const interval = window.setInterval(fetchUrgency, 5 * 60 * 1000)
    return () => {
      cancelled = true
      window.removeEventListener('assignment:mutated', onMutated)
      window.removeEventListener('focus', onFocus)
      window.clearInterval(interval)
    }
    // isSuperScoped in deps: entering/leaving a tenant view must (re)start or
    // stop the urgency fetch (early return above skips pure overview).
  }, [token, user?.role, user?.id, isSuperAdmin, isSuperScoped])

  const getBadgeCount = (path:string) => {
    if (path === '/assignments') return assignmentUrgent.count
    if (path === '/rooms') return roomUnreadCount
    if (path === '/hackathons') return nearDeadlineCount.hackathons
    if (path === '/forms') return nearDeadlineCount.forms
    if (path === '/internships') return nearDeadlineCount.internships
    if (path === '/contests') return nearDeadlineCount.contests
    return 0
  }

  const SidebarContent = ({ forceExpanded = false }: { forceExpanded?: boolean } = {}) => {
    // WHY F11: mobile drawer must never inherit the collapsed rail —
    // force the expanded list layout inside the dialog.
    const expanded = forceExpanded || sidebarOpen
    return (
    <div className="flex flex-col h-full max-h-screen">
      {/* Logo — brand kit v1.0 lockup (primary on light, reversed on dark #121212, 38px desktop / 32px mobile + 4px wrapper clearspace). Collapsed rail uses C-icon only per guide (<32px rule). */}
      <div className="px-3 py-2 flex items-center gap-2 border-b border-surface-200 dark:border-night-600/70 shrink-0">
        {expanded ? (
          <BrandLogo variant="auto" height={38} />
        ) : (
          <span className="w-8 h-8 rounded-lg bg-white dark:bg-white flex items-center justify-center shrink-0 p-[4px]" title="CampusFlow">
            <BrandLogo variant="icon" height={24} alt="CampusFlow" />
          </span>
        )}
        {expanded && (
          <div>
            <p className="text-[10px] font-semibold tracking-widest uppercase text-surface-500 dark:text-night-300">Hall 01 · Campus OS</p>
          </div>
        )}
      </div>

      {/* Scoped banner — when SUPER_ADMIN inside a college */}
      {isSuperScoped && expanded && (
        <div className="mx-2 mt-1.5 p-2 rounded-xl bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold tracking-widest uppercase text-primary-600 dark:text-primary-300">Viewing College</p>
            <p className="text-xs font-semibold text-surface-900 dark:text-night-50 truncate">{effectiveCollegeName || effectiveCollegeId || 'College'}</p>
            <p className="text-[10px] font-mono text-surface-500 dark:text-night-400 truncate">{effectiveCollegeId}</p>
          </div>
          <button
            onClick={() => { clearSuperCollege(); try{ localStorage.removeItem('superadmin_selectedCollegeId'); localStorage.removeItem('superadmin_selectedCollegeName'); localStorage.removeItem('campusflow-superadmin-college'); }catch{}; navigate('/superadmin/colleges') }}
            className="shrink-0 w-7 h-7 rounded-lg bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 flex items-center justify-center text-surface-500 hover:text-primary-600 hover:border-primary-300 transition-colors dark:text-zinc-400"
            title="Exit college view"
          >
            <ArrowLeft size={14} />
          </button>
        </div>
      )}
      {isSuperScoped && !expanded && (
        <div className="mx-2 mt-1.5 flex justify-center">
          <button
            onClick={() => { clearSuperCollege(); try{ localStorage.removeItem('superadmin_selectedCollegeId'); localStorage.removeItem('superadmin_selectedCollegeName'); localStorage.removeItem('campusflow-superadmin-college'); }catch{}; navigate('/superadmin/colleges') }}
            className="w-8 h-8 rounded-xl bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 flex items-center justify-center text-primary-600"
            title="Exit college view"
          >
            <ArrowLeft size={14} />
          </button>
        </div>
      )}

      {/* Nav — flex-1 overflow-auto, chrome-trimmed spacing (§7: no folding, scrolls) */}
      <nav className="flex-1 px-2 py-1.5 overflow-y-auto min-h-0" aria-label="Primary">
        {(isSuperScoped ? navByRole['SUPER_ADMIN_SCOPED'] : (navByRole[user?.role || 'STUDENT'] || navByRole.STUDENT)).map((section)=>(
           <div key={section.label || 'top'} className="mb-2">
             {expanded && section.label && (
                <p className="px-2 pt-1.5 pb-0.5 mb-0.5 text-[8.5px] font-bold uppercase tracking-widest text-surface-500 dark:text-night-300">
                 {section.label}
               </p>
             )}
             {!expanded && section.label && <div className="h-px bg-surface-200 mx-2 mb-1.5 dark:bg-[#282828]" />}
             <div className="space-y-0.5">
              {section.items.map((item)=>{
                const isActive = location.pathname===item.path
                const Icon=item.icon
                // WHY §7: all 6 pills through one counter + one label fn —
                // single red pill, 0 = hidden, 99+ cap, tooltip+aria on every pill.
                const badgeCount=getBadgeCount(item.path)
                const showBadge=badgeCount>0
                const title=showBadge ? getSidebarBadgeLabel(item.path, badgeCount) : item.label
                const badgeText=formatBadgeCount(badgeCount)
                return (
                  <button
                    key={item.path}
                    onClick={()=>navigate(item.path)}
                    title={title}
                    aria-label={title}
                    aria-current={isActive ? 'page' : undefined}
                    className={clsx(
                      // WHY: WCAG 2.5.8 — 44px rail targets; focus-visible ring for keyboard.
                      'w-full flex items-center gap-2 rounded-lg font-medium transition-colors duration-150 relative text-left text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
                      expanded ? 'px-2.5 min-h-[44px] py-2' : 'justify-center px-0 min-h-[44px] min-w-[44px]',
                      isActive ? 'sidebar-link-active' : 'sidebar-link'
                    )}
                  >
                    {isActive && <span className="locker-stripe" aria-hidden="true" />}
                    <span className="relative inline-flex">
                      <Icon size={16} aria-hidden="true" className={clsx(isActive ? 'text-primary-700 dark:text-primary-300' : 'text-surface-500')} />
                      {!expanded && showBadge && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-3.5 px-1 bg-danger-500 text-white rounded-full text-[9px] font-bold flex items-center justify-center leading-none border-2 border-white">{badgeText}</span>
                      )}
                    </span>
                    {expanded && <span className="flex-1 text-left text-[12px]">{item.label}</span>}
                    {expanded && showBadge && <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 bg-danger-500 text-white rounded-full text-[9px] font-bold">{badgeText}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Assistant — single 44px row (§7 Phase 1b: card → one row, saves ~60px) */}
      {expanded && (
        <div className="px-2 pb-1.5 shrink-0">
          <button
            onClick={()=>navigate('/chat')}
            title="Ask Campus Assistant"
            aria-label="Ask Campus Assistant"
            className="w-full min-h-[44px] px-2.5 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white text-white rounded-lg text-[12px] font-semibold inline-flex items-center justify-center gap-1.5 transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            <Sparkles size={14} aria-hidden="true" /> Ask Assistant
          </button>
        </div>
      )}

      {/* User — chrome-trimmed padding */}
      <div className="px-2 py-1.5 border-t border-surface-200 dark:border-night-600 shrink-0">
        <div className={clsx('flex items-center gap-2', !expanded && 'justify-center')}>
          <div className="w-7 h-7 rounded-lg bg-primary-600 flex items-center justify-center text-white font-bold text-[11px] shrink-0">
            {user?.name?.charAt(0) || 'S'}
          </div>
          {expanded && (
            <>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-surface-900 dark:text-night-50 truncate">{user?.name || 'Student'}</p>
                <p className="text-[11px] text-surface-500 dark:text-night-300 truncate">{user?.email || 'student@campus.edu'}</p>
              </div>
              <button onClick={()=>setReportOpen(true)} className="w-11 h-11 inline-flex items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 border border-red-200 dark:border-red-500/20 transition-colors" title="Report issue">
                <AlertTriangle size={16} />
              </button>
              <button onClick={()=>{logout(); navigate(LOGOUT_DEST, { replace: true })}} className="w-11 h-11 inline-flex items-center justify-center rounded-xl text-surface-400 dark:text-night-400 hover:text-danger-600 hover:bg-danger-50 transition-colors" title="Sign out">
                <LogOut size={16} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
    )
  }

  return (
    <div className="flex h-screen bg-surface-50 dark:bg-night-800 overflow-hidden isolate">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-full focus:bg-zinc-900 focus:text-white dark:focus:bg-white dark:focus:text-black focus:text-sm focus:font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
      >
        Skip to main content
      </a>
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
              className="w-11 h-11 inline-flex items-center justify-center rounded-xl text-surface-500 dark:text-night-400 hover:bg-surface-100 dark:hover:bg-night-700 transition-colors shrink-0 dark:bg-[#1e1e1e]"
              aria-label="Toggle navigation"
            >
              {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            {/* search — real button opening the palette (WCAG: labelled control, not fake readOnly input) */}
            <div className="relative hidden sm:block">
              <button
                type="button"
                onClick={() => setShowCommandPalette(true)}
                aria-label="Search — press Control K"
                className="w-[280px] xl:w-[360px] pl-10 pr-4 min-h-[44px] inline-flex items-center gap-2 bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-xl text-sm text-surface-500 dark:text-night-400 hover:border-surface-300 dark:hover:border-night-500 hover:bg-white dark:hover:bg-night-700 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
              >
                <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 dark:text-night-400" />
                <span className="pl-0 truncate">Search courses, rooms…</span>
                <kbd aria-hidden="true" className="ml-auto shrink-0 rounded-md border border-surface-200 dark:border-night-600 bg-white dark:bg-night-900 px-1.5 py-0.5 text-[11px] font-mono text-surface-500 dark:text-night-300">⌘K</kbd>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button className="relative w-11 h-11 inline-flex items-center justify-center rounded-xl text-surface-500 dark:text-night-400 hover:bg-surface-100 dark:hover:bg-night-700 transition-colors dark:bg-[#1e1e1e]" onClick={()=>navigate('/notifications')} aria-label="Notifications">
              <Bell size={18} aria-hidden="true" />
              {unreadCount>0 && <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 bg-danger-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center border-2 border-white dark:border-night-800">{unreadCount>99?'99+':unreadCount}</span>}
            </button>
            {/* Help — same header slot on every authed page (consistent position, 44px, labelled) */}
            <button onClick={()=>navigate('/help')} aria-label="Help and support" title="Help and support" className="w-11 h-11 inline-flex items-center justify-center rounded-xl text-surface-500 dark:text-night-400 hover:bg-surface-100 dark:hover:bg-night-700 transition-colors dark:bg-[#1e1e1e]">
              <CircleHelp size={18} aria-hidden="true" />
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
        {/* WHY: programmatic route-change focus target (RouteFocus) must never show a visible ring — tabindex=-1 + outline-none only. Visible rings stay on interactive elements. */}
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto outline-none focus:outline-none focus-visible:outline-none">
          <div className="campus-shell py-6">
            {/* §10 dismissible shared-password nudge (all authed pages, no forced block). */}
            <div className="mb-4">
              <PasswordNudgeBanner
                userId={(user as any)?.id}
                mustChangePassword={(user as any)?.mustChangePassword}
                passwordNudge={(user as any)?.passwordNudge}
              />
            </div>
            <div className="animate-slideUp">
              <Outlet />
            </div>
          </div>
        </main>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40 lg:hidden backdrop-blur-sm" onClick={()=>setMobileOpenLocal(false)} aria-hidden="true" />
          <aside
            ref={mobileDrawerRef as any}
            role="dialog"
            aria-modal="true"
            aria-label="Site navigation"
            className="fixed inset-y-0 left-0 w-[280px] bg-surface-50 dark:bg-night-850 z-50 lg:hidden shadow-e3 animate-slideUp locker-rail overflow-hidden flex flex-col"
          >
            <button onClick={()=>setMobileOpenLocal(false)} aria-label="Close navigation" className="absolute top-3 right-3 w-11 h-11 inline-flex items-center justify-center rounded-xl text-surface-500 dark:text-night-400 hover:bg-surface-100 dark:hover:bg-night-700 dark:bg-[#1e1e1e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"><X size={20} aria-hidden="true" /></button>
            {/* WHY F11: drawer always expanded — never inherits collapsed rail. */}
            <SidebarContent forceExpanded />
          </aside>
        </>
      )}

      <ReportModal open={reportOpen} onClose={()=>setReportOpen(false)} />
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
