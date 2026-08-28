import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Calendar, Users, Briefcase, FileText, Clock,
  GraduationCap, DoorOpen, ClipboardList, Bell, Megaphone,
  MapPin, ChevronRight, BookOpen
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
    { label:'CGPA', value: data?.cgpa ?? '—', sub: 'Current', icon: GraduationCap },
    { label:'Pending Tasks', value: data?.pendingAssignments ?? 0, sub: `${data?.upcomingDeadlines ?? 0} due soon`, icon: ClipboardList },
    { label:'Notifications', value: data?.unreadNotifications ?? unreadCount, sub: 'Unread', icon: Bell },
  ] : [
    { label:'Students', value: data?.totalStudents ?? data?.totalUsers ?? 0, icon: GraduationCap },
    { label:'Faculty', value: data?.totalTeachers ?? 0, icon: Users },
    { label:'Events', value: hackathons.length, icon: Calendar },
    { label:'Rooms', value: rooms.length, icon: DoorOpen },
  ]

  return (
    <div className="space-y-6">
      {/* Header — registrar line */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold tracking-widest uppercase text-surface-400">Hall 01 · {todayLabel}</p>
          <h1 className="font-display text-[30px] leading-none font-extrabold text-surface-900 mt-1">
            Good morning, <span className="text-primary-600">{firstName}</span>
          </h1>
          <p className="text-sm text-surface-500 mt-1.5">Here&apos;s your day on the board.</p>
        </div>
        <button onClick={()=>navigate('/announcements')} className="inline-flex items-center gap-2 min-h-[44px] px-4 bg-white border border-surface-200 rounded-xl text-sm font-semibold hover:bg-surface-50 transition-colors">
          <Megaphone size={16} className="text-primary-600" /> Announcements
          {unreadCount>0 && <span className="ml-1 min-w-[20px] h-5 px-1.5 bg-danger-500 text-white rounded-full text-xs font-bold inline-flex items-center justify-center">{unreadCount>99?'99+':unreadCount}</span>}
        </button>
      </div>

      {/* My Day Today Strip */}
      <div className="paper overflow-hidden">
        <div className="h-[3px] bg-brass-400" />
        <div className="px-5 py-4 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-surface-600 border border-surface-200 rounded-full px-3 py-1.5 bg-surface-50">
            <Clock size={12} /> My Day — Today
          </span>
          <span className="text-sm text-surface-500 hidden sm:inline">·</span>
          <span className="text-sm font-medium text-surface-700">{todayLabel}</span>
          <span className="ml-auto inline-flex items-center gap-2 text-xs font-semibold text-surface-600">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> {todayClasses.length} periods today
          </span>
        </div>

        {/* Timetable grid — campus-native */}
        <div className="px-5 pb-5">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {Array.from({length:4}).map((_,i)=><div key={i} className="h-28 rounded-[14px] bg-surface-50 border border-surface-200 animate-pulse" />)}
            </div>
          ) : todayClasses.length===0 ? (
            <div className="rounded-[14px] border border-dashed border-surface-300 bg-surface-50 p-8 text-center">
              <div className="w-12 h-12 rounded-xl bg-white border border-surface-200 flex items-center justify-center mx-auto">
                <BookOpen size={20} className="text-surface-400" />
              </div>
              <p className="mt-3 font-semibold text-surface-700">No periods today</p>
              <p className="text-sm text-surface-500">Enjoy the open quad — or add your timetable.</p>
              <button onClick={()=>navigate('/schedule')} className="mt-4 inline-flex items-center gap-1.5 min-h-[44px] px-5 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700">Open Timetable <ChevronRight size={16}/></button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {todayClasses.slice(0,8).map((c:any, idx:number)=>(
                <div key={c.id} className="due-slip p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold tracking-widest uppercase text-surface-400">Period {periodLabels[idx] ?? idx+1}</span>
                    <span className="text-xs font-medium text-surface-500 font-mono">{c.startTime} — {c.endTime}</span>
                  </div>
                  <p className="mt-2 font-bold text-surface-900 leading-tight line-clamp-2">{c.title}</p>
                  <p className="mt-1 text-xs text-surface-500 inline-flex items-center gap-1.5">
                    {c.location && <><MapPin size={12}/> {c.location}</>}
                    {c.teacher && <span className="truncate">· {c.teacher}</span>}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* quick stats row under timetable */}
          <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
            {stats.map(s=>(
              <div key={s.label} className="stat-card">
                <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest uppercase text-surface-400">
                  <s.icon size={12} /> {s.label}
                </div>
                <p className="mt-2 font-display text-2xl font-extrabold text-surface-900">{s.value}</p>
                { (s as any).sub && <p className="text-xs text-surface-500">{(s as any).sub}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pinned Announcements + Up Next */}
      <div className="campus-grid">
        <div className="col-span-12 lg:col-span-7">
          <div className="notice-board">
            <div className="notice-head">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-brass-400 flex items-center justify-center"><Megaphone size={16} className="text-surface-900"/></div>
                <div>
                  <p className="font-bold text-surface-900 leading-none">Pinned Notices</p>
                  <p className="text-xs text-surface-500">From the registrar</p>
                </div>
              </div>
              <button onClick={()=>navigate('/announcements')} className="text-sm font-semibold text-primary-600 hover:text-primary-700 inline-flex items-center gap-1">View all <ChevronRight size={14}/></button>
            </div>
            {announcements.length===0 ? (
              <div className="p-8 text-center">
                <Megaphone size={28} className="mx-auto text-surface-300" />
                <p className="mt-2 text-sm font-medium text-surface-500">No pinned notices</p>
                <p className="text-xs text-surface-400">Announcements will be pinned here when posted.</p>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                {announcements.slice(0,4).map((ann:any)=>(
                  <button key={ann.id} onClick={()=>navigate('/announcements')} className="w-full text-left flex items-start gap-3 p-3 rounded-xl border border-surface-200 bg-surface-50 hover:bg-white transition-colors">
                    <span className="w-2 h-2 rounded-full bg-brass-400 mt-2 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-surface-900 truncate">{ann.title}</p>
                      <p className="text-xs text-surface-500">{ann.creator?.name} · {new Date(ann.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</p>
                    </div>
                    <ChevronRight size={16} className="text-surface-300 shrink-0 mt-1" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="col-span-12 lg:col-span-5">
          <div className="paper p-5">
            <div className="flex items-center justify-between">
              <p className="font-bold text-surface-900">Up Next</p>
              <button onClick={()=>navigate('/hackathons')} className="text-xs font-semibold text-primary-600 hover:text-primary-700">View events →</button>
            </div>
            <div className="mt-4 space-y-3">
              {upcomingHackathons.length===0 ? (
                <p className="text-sm text-surface-400 py-6 text-center border border-dashed border-surface-200 rounded-xl">No upcoming events</p>
              ) : upcomingHackathons.map((h:any)=>(
                <div key={h.id} className="flex items-center gap-3 p-3 rounded-xl bg-surface-50 border border-surface-200">
                  <span className="w-2 h-2 rounded-full bg-primary-600 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-surface-900 text-sm truncate">{h.title}</p>
                    <p className="text-xs text-surface-500">{new Date(h.startDate).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</p>
                  </div>
                  <span className="text-xs text-surface-400">{Math.max(0, Math.ceil((new Date(h.startDate).getTime()-Date.now())/86400000))}d</span>
                </div>
              ))}
            </div>

            {/* quick actions — flat, paper */}
            <div className="mt-5">
              <p className="text-xs font-bold tracking-widest uppercase text-surface-400">Quick Actions</p>
              <div className="mt-3 grid grid-cols-1 gap-2">
                {[
                  {label:'Browse Hackathons', sub:'Find events', action:()=>navigate('/hackathons')},
                  {label:'Browse Internships', sub:'Explore roles', action:()=>navigate('/internships')},
                  {label:'Open Rooms', sub:'Your lockers', action:()=>navigate('/rooms')},
                  {label:'My Timetable', sub:'Period grid', action:()=>navigate('/schedule')},
                ].slice(0, user?.role==='STUDENT' ? 4 : 3).map(a=>(
                  <button key={a.label} onClick={a.action} className="flex items-center gap-3 p-3 rounded-xl border border-surface-200 bg-white hover:bg-surface-50 text-left transition-colors">
                    <span className="w-9 h-9 rounded-xl bg-primary-50 border border-primary-100 flex items-center justify-center shrink-0">
                      <FileText size={16} className="text-primary-600" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-surface-900">{a.label}</span>
                      <span className="block text-xs text-surface-500">{a.sub}</span>
                    </span>
                    <ChevronRight size={14} className="text-surface-300" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Forms needing attention — due slips */}
      {forms.length>0 && (
        <div className="paper p-5">
          <div className="flex items-center gap-2">
            <ClipboardList size={16} className="text-surface-500" />
            <p className="font-bold text-surface-900">Forms needing attention</p>
            <span className="ml-auto text-xs font-semibold bg-warning-50 text-warning-600 border border-warning-100 rounded-full px-2.5 py-1">{forms.length} open</span>
          </div>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            {forms.slice(0,3).map((f:any)=>(
              <button key={f.id} onClick={()=>navigate(`/forms/${f.id}`)} className="due-slip p-4 text-left hover:shadow-e2 transition-shadow">
                <p className="font-semibold text-surface-900 line-clamp-1">{f.title}</p>
                <p className="text-xs text-surface-500 mt-1 line-clamp-2">{f.description || 'No description'}</p>
                <p className="text-xs font-mono text-surface-400 mt-3">{f.expiresAt ? `Due ${new Date(f.expiresAt).toLocaleDateString()}` : 'No due date'}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
