import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Calendar, Users, Briefcase, FileText, Clock,
  GraduationCap, DoorOpen, ClipboardList, Bell, Megaphone,
  MapPin, ChevronRight, BookOpen, Trophy
} from 'lucide-react'
import { dashboardAPI, hackathonAPI, roomAPI, formAPI, announcementsAPI, timetableAPI } from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { useQuery } from '@tanstack/react-query'

export default function DashboardPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const firstName = user?.name?.split(' ')[0] || 'Student'
  const now = new Date()
  const todayLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const dayIdx = now.getDay() === 0 ? 6 : now.getDay() - 1

  const { data: dashboardBundle, isLoading: loading } = useQuery({
    queryKey: ['dashboard', dayIdx],
    queryFn: async ({ signal }) => {
      const [dashData, hackData, roomData, formData, annData, sched] = await Promise.all([
        dashboardAPI.get(),
        hackathonAPI.getAll({ signal } as any).catch(()=>[]),
        roomAPI.getAll({ signal } as any).catch(()=>[]),
        formAPI.getAll({ signal } as any).catch(()=>[]),
        announcementsAPI.list(1, 6).catch(()=>({ announcements:[], unreadCount:0 })),
        timetableAPI.getAll().catch(()=>[]),
      ])
      const today = (sched as any[]).filter((s:any)=> s.dayOfWeek===dayIdx).sort((a:any,b:any)=> a.startTime.localeCompare(b.startTime))
      return { dashData, hackData, roomData, formData, annData, today }
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  })
  const data = dashboardBundle?.dashData ?? null
  const hackathons = (dashboardBundle?.hackData as any[]) ?? []
  const rooms = (dashboardBundle?.roomData as any[]) ?? []
  const forms = (dashboardBundle?.formData as any[]) ?? []
  const announcements = (dashboardBundle?.annData?.announcements as any[]) ?? []
  const unreadCount = dashboardBundle?.annData?.unreadCount ?? 0
  const todayClasses = dashboardBundle?.today ?? []

  const upcomingHackathons = hackathons.filter((h:any)=> h.startDate && new Date(h.startDate) > new Date()).sort((a:any,b:any)=> new Date(a.startDate).getTime()-new Date(b.startDate).getTime()).slice(0,3)
  const periodLabels = ['I','II','III','IV','V','VI','VII','VIII']

  const stats = user?.role==='STUDENT' ? [
    { label:'CGPA', value: data?.cgpa ?? '—', sub: 'Current Standing', icon: GraduationCap, color: 'text-primary-600 dark:text-sky-400', bg: 'bg-primary-50 dark:bg-sky-950/30 border-primary-200 dark:border-sky-800/50' },
    { label:'Pending Tasks', value: data?.pendingAssignments ?? 0, sub: `${data?.upcomingDeadlines ?? 0} due soon`, icon: ClipboardList, color: 'text-slate-700 dark:text-zinc-300', bg: 'bg-surface-50 dark:bg-zinc-900 border-surface-200 dark:border-zinc-700' },
    { label:'Notifications', value: data?.unreadNotifications ?? unreadCount, sub: 'Unread alerts', icon: Bell, color: 'text-success-600 dark:text-emerald-400', bg: 'bg-success-50 dark:bg-emerald-950/30 border-success-200 dark:border-emerald-800/50' },
  ] : [
    { label:'Students', value: data?.totalStudents ?? data?.totalUsers ?? 0, icon: GraduationCap, color: 'text-primary-600 dark:text-sky-400', bg: 'bg-primary-50 dark:bg-sky-950/30 border-primary-200 dark:border-sky-800/50' },
    { label:'Faculty', value: data?.totalTeachers ?? 0, icon: Users, color: 'text-success-600 dark:text-emerald-400', bg: 'bg-success-50 dark:bg-emerald-950/30 border-success-200 dark:border-emerald-800/50' },
    { label:'Events', value: hackathons.length, icon: Calendar, color: 'text-brass-500 dark:text-amber-400', bg: 'bg-warning-50 dark:bg-amber-950/30 border-warning-200 dark:border-amber-800/50' },
    { label:'Rooms', value: rooms.length, icon: DoorOpen, color: 'text-success-600 dark:text-emerald-400', bg: 'bg-success-50 dark:bg-emerald-950/30 border-success-200 dark:border-emerald-800/50' },
  ]

  return (
    <div className="space-y-6">
      {/* Header — registrar line */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold tracking-widest uppercase text-surface-400 dark:text-night-400">Campus Flow · {todayLabel}</p>
          <h1 className="font-display text-[30px] leading-none font-extrabold text-slate-800 dark:text-night-50 mt-1">
            Good morning, <span className="text-primary-600 dark:text-sky-400">{firstName}</span>
          </h1>
          <p className="text-sm text-surface-500 dark:text-night-400 mt-1.5">Here&apos;s your day on the board.</p>
        </div>
        <button onClick={()=>navigate('/announcements')} className="inline-flex items-center gap-2 min-h-[44px] px-4 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-xl text-sm font-semibold hover:bg-surface-50 dark:hover:bg-night-700 transition-colors shadow-sm">
          <Megaphone size={16} className="text-primary-600 dark:text-primary-400" /> Announcements
          {unreadCount>0 && <span className="ml-1 min-w-[20px] h-5 px-1.5 bg-danger-500 text-white rounded-full text-xs font-bold inline-flex items-center justify-center">{unreadCount>99?'99+':unreadCount}</span>}
        </button>
      </div>

      {/* My Day Today Strip — brass #B5A268 • blue #2563EB • emerald #059669 — 5% subtle washes */}
      <div className="paper overflow-hidden shadow-sm">
        <div className="h-[3px] bg-gradient-to-r from-brass-500 via-primary-600 to-success-600" />
        <div className="px-5 py-4 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-primary-700 dark:text-sky-300 border border-primary-200 dark:border-sky-800/60 rounded-full px-3 py-1.5 bg-primary-50 dark:bg-sky-950/30">
            <Clock size={12} /> My Day — Today
          </span>
          <span className="text-sm text-surface-500 dark:text-night-400 hidden sm:inline">·</span>
          <span className="text-sm font-medium text-surface-700 dark:text-night-200">{todayLabel}</span>
          <span className="ml-auto inline-flex items-center gap-2 text-xs font-semibold text-surface-600 dark:text-night-300">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> {todayClasses.length} periods today
          </span>
        </div>

        {/* Timetable grid — campus-native */}
        <div className="px-5 pb-5">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {Array.from({length:4}).map((_,i)=><div key={i} className="h-28 rounded-[14px] bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-600 animate-pulse" />)}
            </div>
          ) : todayClasses.length===0 ? (
            <div className="rounded-[14px] border border-dashed border-surface-300 dark:border-night-600 bg-surface-50 dark:bg-night-800 p-8 text-center">
              <div className="w-12 h-12 rounded-xl bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 flex items-center justify-center mx-auto">
                <BookOpen size={20} className="text-surface-400 dark:text-night-400" />
              </div>
              <p className="mt-3 font-semibold text-surface-700 dark:text-night-200">No periods today</p>
              <p className="text-sm text-surface-500 dark:text-night-400">Enjoy the open day — or view your complete weekly timetable.</p>
              <button onClick={()=>navigate('/schedule')} className="mt-4 inline-flex items-center gap-1.5 min-h-[44px] px-5 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 shadow-sm transition-colors">Open Timetable <ChevronRight size={16}/></button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {todayClasses.slice(0,8).map((c:any, idx:number)=>(
                <div key={c.id} className="due-slip due-slip--blue p-4 hover:shadow-e2 transition-all">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold tracking-widest uppercase text-primary-600 dark:text-sky-300">Period {periodLabels[idx] ?? idx+1}</span>
                    <span className="text-xs font-medium text-surface-500 dark:text-night-400 font-mono">{c.startTime} — {c.endTime}</span>
                  </div>
                  <p className="mt-2 font-bold text-slate-800 dark:text-night-50 leading-tight line-clamp-2">{c.title}</p>
                  <p className="mt-1 text-xs text-surface-500 dark:text-night-400 inline-flex items-center gap-1.5">
                    {c.location && <><MapPin size={12}/> {c.location}</>}
                    {c.teacher && <span className="truncate">· {c.teacher}</span>}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* quick stats row under timetable */}
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {stats.map((s, idx)=>(
              <div key={s.label} className={`paper p-4 hover-lift ${idx===0?'card-accent--blue': idx===1?'card-accent--neutral': idx===2?'card-accent--emerald':'card-accent--brass'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold tracking-widest uppercase text-surface-500 dark:text-night-400">{s.label}</span>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center border ${(s as any).bg}`}>
                    <s.icon size={15} className={(s as any).color} />
                  </div>
                </div>
                <p className="mt-2 font-display text-2xl font-extrabold text-slate-800 dark:text-night-50">{s.value}</p>
                { (s as any).sub && <p className="text-xs text-surface-500 dark:text-night-400 mt-0.5">{(s as any).sub}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pinned Announcements + Up Next */}
      <div className="campus-grid">
        <div className="col-span-12 lg:col-span-7">
          <div className="notice-board shadow-sm">
            <div className="notice-head">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-warning-50 dark:bg-amber-950/30 border border-warning-200 dark:border-amber-800/50 flex items-center justify-center">
                  <Megaphone size={16} className="text-brass-700 dark:text-amber-400"/>
                </div>
                <div>
                  <p className="font-bold text-slate-800 dark:text-night-50 leading-none">Pinned Notices</p>
                  <p className="text-xs text-surface-500 dark:text-night-400 mt-0.5">Brass wash 5% • #B5A268 · icon/label matched</p>
                </div>
              </div>
              <button onClick={()=>navigate('/announcements')} className="text-sm font-semibold text-primary-600 dark:text-sky-400 hover:text-primary-700 inline-flex items-center gap-1">View all <ChevronRight size={14}/></button>
            </div>
            {announcements.length===0 ? (
              <div className="p-8 text-center">
                <Megaphone size={28} className="mx-auto text-surface-300 dark:text-night-500" />
                <p className="mt-2 text-sm font-medium text-surface-500 dark:text-night-400">No pinned notices</p>
                <p className="text-xs text-surface-400 dark:text-night-400">Announcements will be pinned here when posted.</p>
              </div>
            ) : (
              <div className="p-4 space-y-2.5">
                {announcements.slice(0,4).map((ann:any)=>(
                  <button key={ann.id} onClick={()=>navigate('/announcements')} className="w-full text-left flex items-start gap-3 p-3.5 rounded-xl border border-surface-200 dark:border-night-600 bg-surface-50/50 hover:bg-white dark:hover:bg-night-700 dark:bg-night-800/80 transition-all hover:shadow-sm">
                    <span className="w-2 h-2 rounded-full bg-brass-500 mt-2 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-800 dark:text-night-50 truncate text-sm">{ann.title}</p>
                      <p className="text-xs text-surface-500 dark:text-night-400 mt-0.5">{ann.creator?.name} · {new Date(ann.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</p>
                    </div>
                    <ChevronRight size={16} className="text-surface-300 dark:text-night-500 shrink-0 mt-1" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="col-span-12 lg:col-span-5">
          <div className="paper p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="font-bold text-slate-800 dark:text-night-50">Up Next & Opportunities</p>
              <button onClick={()=>navigate('/hackathons')} className="text-xs font-semibold text-primary-600 dark:text-primary-400 hover:text-primary-700">View events →</button>
            </div>
            <div className="mt-4 space-y-2.5">
              {upcomingHackathons.length===0 ? (
                <p className="text-sm text-surface-400 dark:text-night-400 py-6 text-center border border-dashed border-surface-200 dark:border-night-600 rounded-xl">No upcoming events</p>
              ) : upcomingHackathons.map((h:any)=>(
                <div key={h.id} className="flex items-center gap-3 p-3 rounded-xl bg-surface-50/60 dark:bg-night-800 border border-surface-200 dark:border-night-600 hover:border-surface-300 transition-colors">
                  <span className="w-2 h-2 rounded-full bg-brass-500 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-surface-900 dark:text-night-50 text-sm truncate">{h.title}</p>
                    <p className="text-xs text-surface-500 dark:text-night-400 mt-0.5">{new Date(h.startDate).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</p>
                  </div>
                  <span className="text-xs font-bold text-warning-700 dark:text-warning-400 bg-warning-50 dark:bg-warning-900/40 border border-warning-200 dark:border-warning-800/40 px-2 py-0.5 rounded-full">{Math.max(0, Math.ceil((new Date(h.startDate).getTime()-Date.now())/86400000))}d left</span>
                </div>
              ))}
            </div>

            {/* quick actions — domain tinted: brass / blue / emerald / sky */}
            <div className="mt-5">
              <p className="text-xs font-bold tracking-widest uppercase text-surface-400 dark:text-night-400">Quick Actions</p>
              <div className="mt-3 grid grid-cols-1 gap-2">
                 {[
                  {label:'Browse Hackathons', sub:'Find events & team ups • brass #B5A268', action:()=>navigate('/hackathons'), icon: Trophy, color:'text-brass-700 dark:text-amber-300', bg:'bg-warning-50 dark:bg-amber-950/30 border-warning-200 dark:border-amber-800/50'},
                  {label:'Browse Internships', sub:'Explore live openings • blue #2563EB', action:()=>navigate('/internships'), icon: Briefcase, color:'text-primary-700 dark:text-sky-300', bg:'bg-primary-50 dark:bg-sky-950/30 border-primary-200 dark:border-sky-800/50'},
                  {label:'Study Rooms & Lockers', sub:'Group channels & chat • emerald #059669', action:()=>navigate('/rooms'), icon: DoorOpen, color:'text-success-700 dark:text-emerald-300', bg:'bg-success-50 dark:bg-emerald-950/30 border-success-200 dark:border-emerald-800/50'},
                  {label:'My Timetable', sub:'Weekly period matrix • neutral', action:()=>navigate('/schedule'), icon: Clock, color:'text-slate-700 dark:text-zinc-300', bg:'bg-surface-50 dark:bg-zinc-900 border-surface-200 dark:border-zinc-700'},
                ].slice(0, user?.role==='STUDENT' ? 4 : 3).map(a=>(
                  <button key={a.label} onClick={a.action} className="flex items-center gap-3 p-3 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 hover:bg-surface-50 dark:hover:bg-night-700 text-left transition-all hover:shadow-sm">
                    <span className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${a.bg}`}>
                      <a.icon size={16} className={a.color} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-slate-800 dark:text-night-50">{a.label}</span>
                      <span className="block text-xs text-surface-500 dark:text-night-400">{a.sub}</span>
                    </span>
                    <ChevronRight size={14} className="text-surface-300 dark:text-night-500" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Forms needing attention — due slips */}
      {forms.length>0 && (
          <div className="paper p-5 shadow-sm section--forms">
           <div className="flex items-center gap-2">
             <ClipboardList size={16} className="text-slate-700 dark:text-night-400" />
             <p className="font-bold text-slate-800 dark:text-night-50">Forms needing attention</p>
             <span className="ml-auto text-xs font-semibold bg-surface-50 text-slate-700 border border-surface-200 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-700 rounded-full px-2.5 py-1">{forms.length} open</span>
           </div>
           <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
             {forms.slice(0,3).map((f:any)=>(
               <button key={f.id} onClick={()=>navigate(`/forms/${f.id}`)} className="due-slip due-slip--neutral p-4 text-left hover:shadow-e2 transition-all">
                 <p className="font-semibold text-slate-800 dark:text-night-50 line-clamp-1">{f.title}</p>
                 <p className="text-xs text-surface-500 dark:text-night-400 mt-1 line-clamp-2">{f.description || 'No description'}</p>
                 <p className="text-xs font-mono text-surface-400 dark:text-night-400 mt-3">{f.expiresAt ? `Due ${new Date(f.expiresAt).toLocaleDateString()}` : 'No due date'}</p>
               </button>
             ))}
           </div>
         </div>
      )}
    </div>
  )
}
