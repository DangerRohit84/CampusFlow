import { useNavigate } from 'react-router-dom'
import {
  Calendar, Users, Briefcase, FileText, Clock,
  GraduationCap, DoorOpen, ClipboardList, Bell, Megaphone,
  MapPin, ChevronRight, BookOpen, Trophy, Sparkles, Zap
} from 'lucide-react'
import { dashboardAPI, hackathonAPI, roomAPI, formAPI, announcementsAPI, timetableAPI } from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { qk } from '../lib/queryKeys'
import { useCollegeScope } from '../hooks/useCollegeScope'
import { useEntitySync } from '../lib/entitySync'
import { motion } from 'framer-motion'
import { PremiumHero, GlassPanel, BentoGrid, SectionCard } from '../components/premium/PremiumKit'
import CenteredLoader from '../components/ui/CenteredLoader'

export default function DashboardPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const firstName = user?.name?.split(' ')[0] || 'Student'
  const now = new Date()
  const todayLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const dayIdx = now.getDay() === 0 ? 6 : now.getDay() - 1

  // STATE-SYNC: reactive college scope — super-admin college switches change
  // the key (new scope → fresh fetch) instead of showing the old college's
  // cached bundle until refresh. qk.dashboard keeps prefix ['dashboard'] so
  // notifyEntityMutated(['dashboard']) still busts every day/scope variant.
  const collegeScope = useCollegeScope()

  // Single cancellable bundle: ONE AbortSignal threads into EVERY sub-fetch
  // (React Query aborts the whole bundle on day/scope switch). Previously
  // dashboardAPI.get + announcements + timetable ignored the signal, so a slow
  // bundle could resolve after navigation and paint a stale dashboard.
  const { data: dashboardBundle, isLoading: loading, isError, error, refetch } = useQuery({
    queryKey: qk.dashboard(dayIdx, (user as any)?.collegeId || collegeScope),
    queryFn: async ({ signal }) => {
      const [dashData, hackData, roomData, formData, annData, sched] = await Promise.all([
        dashboardAPI.get(signal),
        hackathonAPI.getAll({ signal } as any).catch(()=>[]),
        roomAPI.getAll({ signal } as any).catch(()=>[]),
        formAPI.getAll({ signal } as any).catch(()=>[]),
        announcementsAPI.list(1, 6, undefined, signal).catch(()=>({ announcements:[], unreadCount:0 })),
        timetableAPI.getAll({ signal }).catch(()=>[]),
      ])
      const today = (sched as any[]).filter((s:any)=> s.dayOfWeek===dayIdx).sort((a:any,b:any)=> a.startTime.localeCompare(b.startTime))
      return { dashData, hackData, roomData, formData, annData, today }
    },
    // SG cloud-dev: each API query 500-1000ms NORMAL (India→SG 70-90ms RTT+TLS+pgbouncer);
    // staleTime 2min (>> 30s minimum for dashboard lists) avoids refetch storms on
    // tab focus/nav. Backend dashboard is single GROUP BY aggregations (no N+1 fallback).
    // TAB-NOREFRESH: keepPreviousData shows the cached bundle instantly on day/scope
    // switch (no full loader flash); refetchOnWindowFocus false (inherits global)
    // so switching browser tabs never reloads the dashboard — RQ revalidates in
    // background only after staleTime, cancelled via signal on rapid switches.
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
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

  // STATE-SYNC: one canonical subscription — every entity feeding the bundle
  // (announcements/assignments/forms/rooms/hackathons/internships/schedules/
  // contests/attendance/grades) refreshes via notifyEntityMutated + the Layout
  // socket bridge. No hand-rolled socket/window lists (they drifted: missing
  // tasks/timetable/search fan-out, dead keys, double-notify).
  useEntitySync(
    ['announcement', 'assignment', 'form', 'room', 'hackathon', 'internship', 'schedule', 'task', 'contest', 'attendance', 'grade'],
    async () => {},
  )

  const stats = user?.role==='STUDENT' ? [
    { label:'CGPA', value: data?.cgpa ?? '—', sub: 'Current Standing', icon: GraduationCap },
    { label:'Pending Tasks', value: data?.pendingAssignments ?? 0, sub: `${data?.upcomingDeadlines ?? 0} due soon`, icon: ClipboardList },
    { label:'Notifications', value: data?.unreadNotifications ?? unreadCount, sub: 'Unread alerts', icon: Bell },
    { label:'Periods Today', value: todayClasses.length, sub: todayLabel.split(',')[0], icon: Clock },
  ] : [
    { label:'Students', value: data?.totalStudents ?? data?.totalUsers ?? 0, sub: 'Enrolled', icon: GraduationCap },
    { label:'Faculty', value: data?.totalTeachers ?? 0, sub: 'Active', icon: Users },
    { label:'Events', value: hackathons.length, sub: 'Hackathons', icon: Calendar },
    { label:'Rooms', value: rooms.length, sub: 'Study spaces', icon: DoorOpen },
  ]

  return (
    <div className="space-y-6 max-w-[1280px] mx-auto">
      {/* WHY: one H1 per page (was 0, fails 1.3.1). Visually hidden would also pass, but PremiumHero is decorative — sr-only H1 keeps RouteFocus targeting. */}
      <h1 className="sr-only">Dashboard — Overview for {firstName}</h1>
      {isError && !dashboardBundle ? (
        <div className="rounded-[20px] border border-danger-200 bg-danger-50 p-6 text-center" role="alert">
          <p className="font-semibold text-surface-900">Couldn&apos;t load your overview</p>
          <p className="text-sm text-surface-500 mt-1">{(error as any)?.response?.data?.error || 'Check your connection and try again.'}</p>
          <button onClick={() => refetch()} className="mt-4 inline-flex items-center gap-1.5 min-h-[44px] px-5 bg-[#0a0a0a] dark:bg-white text-white dark:text-black rounded-full text-sm font-bold">Retry</button>
        </div>
      ) : null}
      {isError && dashboardBundle ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-center justify-between gap-3" role="alert">
          <span>Showing cached overview — refresh failed.</span>
          <button onClick={() => refetch()} className="font-bold underline underline-offset-4 shrink-0">Retry</button>
        </div>
      ) : null}
      <PremiumHero
        eyebrow={`Campus Flow · ${todayLabel}`}
        icon={<Sparkles size={16} className="text-black dark:text-black" />}
        title={<>Good morning, <span className="text-primary-500">{firstName}</span></>}
        subtitle="Here's your day on the board — periods, notices and opportunities in one place."
        actions={
          <>
            <button onClick={()=>navigate('/announcements')} className="inline-flex items-center gap-2 px-5 h-11 rounded-full bg-white dark:bg-white text-black dark:text-black text-[13px] font-black hover:bg-zinc-100 dark:hover:bg-zinc-100 transition-colors shadow-lg">
              <Megaphone size={14} className="text-primary-600 dark:text-primary-600"/> Announcements
              {unreadCount>0 && <span className="ml-1 min-w-[20px] h-5 px-1.5 bg-[#ff4b5c] dark:bg-[#ff4b5c] text-white dark:text-white rounded-full text-xs font-black inline-flex items-center justify-center">{unreadCount>99?'99+':unreadCount}</span>}
            </button>
            <button onClick={()=>navigate('/schedule')} className="inline-flex items-center gap-2 px-5 h-11 rounded-full bg-white/10 dark:bg-white/10 backdrop-blur-md border border-white/15 dark:border-white/15 text-white dark:text-white text-[13px] font-bold hover:bg-white/15 dark:hover:bg-white/15 transition-colors">
              <Calendar size={14}/> View timetable <ChevronRight size={14} className="opacity-60"/>
            </button>
            <span className="hidden sm:inline-flex items-center gap-2 px-4 h-11 rounded-full bg-white/10 dark:bg-white/10 backdrop-blur-md border border-white/15 dark:border-white/15 text-white dark:text-white text-[13px] font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"/> {todayClasses.length} periods today
            </span>
          </>
        }
        stats={
          <GlassPanel className="p-4">
            <p className="text-[10px] font-black tracking-[0.12em] uppercase text-white/80 dark:text-white/80">Today · {todayLabel.split(',')[0]}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-white dark:bg-white p-3 border border-white/20 dark:border-white/20">
                <p className="text-[10px] font-black tracking-widest uppercase text-black/60 dark:text-black/60">Periods</p>
                <p className="mt-1 font-display text-[22px] font-[800] leading-none text-black dark:text-black">{todayClasses.length}</p>
                <p className="mt-1 text-[11px] font-semibold text-black/70 dark:text-black/70">{todayClasses.length? 'Scheduled' : 'Open day'}</p>
              </div>
              <div className="rounded-2xl bg-primary-500 dark:bg-primary-500 p-3 text-black dark:text-black border border-primary-500/20 dark:border-primary-500/20">
                <p className="text-[10px] font-black tracking-widest uppercase text-black/60 dark:text-black/60">Notices</p>
                <p className="mt-1 font-display text-[22px] font-[800] leading-none text-black dark:text-black">{announcements.length}</p>
                <p className="mt-1 text-[11px] font-bold text-black/70 dark:text-black/70">{unreadCount} unread</p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 text-[11px] font-medium text-white/75 dark:text-white/75">
              <Clock size={12} className="text-primary-400 dark:text-primary-400"/> Updated just now
              <span className="w-1 h-1 rounded-full bg-white/30 dark:bg-white/30"/> <Zap size={12} className="text-primary-400 dark:text-primary-400"/> Live
            </div>
          </GlassPanel>
        }
      />
      <div className="hidden rounded-[32px] bg-[#0a0a0a] backdrop-blur-xl bg-white/[0.03] border border-white/10 grid-cols-12" />

      <motion.div initial="hidden" animate="show" variants={{ hidden:{}, show:{ transition:{ staggerChildren:0.06, delayChildren:0.12 } } }} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((s, i)=> (
          <motion.div key={s.label} variants={{ hidden:{opacity:0,y:12}, show:{opacity:1,y:0, transition:{ delay:0.08+i*0.06, duration:0.4, ease:[0.22,1,0.36,1] as any } } }}>
            <div className="group relative overflow-hidden rounded-[20px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] p-4 hover:shadow-[0_12px_32px_rgba(0,0,0,0.08)] hover:border-surface-300 dark:hover:border-[#3a3a3a] transition-all">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black tracking-[0.12em] uppercase text-surface-500 dark:text-night-300">{s.label}</p>
                  <p className="mt-1 font-display text-[22px] font-[800] tracking-[-0.02em] leading-none text-[#0a0a0a] dark:text-white">{s.value}</p>
                  <p className="mt-1 text-[11px] font-semibold text-surface-500 dark:text-night-400">{s.sub}</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center shadow-sm">
                  <s.icon size={18} />
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </motion.div>

      <SectionCard
        title="My Day — Today"
        subtitle={`${todayLabel} · ${todayClasses.length} periods`}
        icon={<Clock size={16}/>}
        action={<span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500 text-black dark:text-black text-[11px] font-black tracking-widest uppercase"><span className="w-1.5 h-1.5 rounded-full bg-black dark:bg-black animate-pulse"/> Live</span>}
      >
        {loading ? (
          <CenteredLoader text="Loading today's schedule..." minHeight="min-h-[160px]" />
        ) : todayClasses.length===0 ? (
          <div className="rounded-[20px] border border-dashed border-surface-300 dark:border-[#282828] bg-surface-50 dark:bg-[#0a0a0a]/50 p-8 text-center">
            <div className="w-12 h-12 rounded-xl bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] flex items-center justify-center mx-auto">
              <BookOpen size={20} className="text-surface-400 dark:text-night-400" />
            </div>
            <p className="mt-3 font-semibold text-surface-700 dark:text-night-200">No periods today</p>
            <p className="text-sm text-surface-500 dark:text-night-400">Enjoy the open day — or view your complete weekly timetable.</p>
            <button onClick={()=>navigate('/schedule')} className="mt-4 inline-flex items-center gap-1.5 min-h-[44px] px-5 bg-[#0a0a0a] dark:bg-white text-white dark:text-black rounded-full text-sm font-bold hover:bg-black dark:hover:bg-zinc-100 transition-colors">Open Timetable <ChevronRight size={16}/></button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {todayClasses.slice(0,8).map((c:any, idx:number)=>(
              <motion.div key={c.id} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{ delay: idx*0.04 }} className="rounded-[20px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] p-4 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] hover:border-primary-500/20 transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black tracking-widest uppercase text-primary-600">Period {periodLabels[idx] ?? idx+1}</span>
                  <span className="text-xs font-mono font-medium text-surface-500 dark:text-night-400">{c.startTime} — {c.endTime}</span>
                </div>
                <p className="mt-2 font-bold text-[#0a0a0a] dark:text-white leading-tight line-clamp-2">{c.title}</p>
                <p className="mt-1 text-xs text-surface-500 dark:text-night-400 inline-flex items-center gap-1.5">
                  {c.location && <><MapPin size={12}/> {c.location}</>}
                  {c.teacher && <span className="truncate">· {c.teacher}</span>}
                </p>
              </motion.div>
            ))}
          </div>
        )}
      </SectionCard>

      <BentoGrid>
        <div className="col-span-12 lg:col-span-7">
          <SectionCard
            title="Pinned Notices"
            subtitle="Curated notices"
            icon={<Megaphone size={16}/>}
            action={<button onClick={()=>navigate('/announcements')} className="text-sm font-bold text-primary-600 hover:text-primary-700 inline-flex items-center gap-1">View all <ChevronRight size={14}/></button>}
          >
            {announcements.length===0 ? (
              <div className="p-8 text-center rounded-[20px] bg-surface-50 dark:bg-[#0a0a0a] border border-dashed border-surface-200 dark:border-[#282828]">
                <Megaphone size={28} className="mx-auto text-surface-300 dark:text-night-500" />
                <p className="mt-2 text-sm font-semibold text-surface-500 dark:text-night-400">No pinned notices</p>
                <p className="text-xs text-surface-500 dark:text-night-300">Announcements will be pinned here when posted.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {announcements.slice(0,4).map((ann:any, i:number)=>(
                  <motion.button key={ann.id} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{ delay: i*0.05 }} onClick={()=>navigate('/announcements')} className="w-full text-left flex items-start gap-3 p-3.5 rounded-[16px] border border-surface-200 dark:border-[#282828] bg-surface-50/50 dark:bg-[#0a0a0a]/50 hover:bg-white dark:hover:bg-[#121212] hover:border-surface-300 dark:hover:border-[#3a3a3a] hover:shadow-sm transition-all">
                    <span className="w-2 h-2 rounded-full bg-primary-500 mt-2 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-[#0a0a0a] dark:text-white truncate text-sm">{ann.title}</p>
                      <p className="text-xs text-surface-500 dark:text-night-400 mt-0.5">{ann.creator?.name} · {new Date(ann.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</p>
                    </div>
                    <ChevronRight size={16} className="text-surface-300 dark:text-night-500 shrink-0 mt-1" />
                  </motion.button>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        <div className="col-span-12 lg:col-span-5 space-y-6">
          <SectionCard title="Up Next" subtitle="Opportunities" icon={<Trophy size={16}/>} action={<button onClick={()=>navigate('/hackathons')} className="text-xs font-bold text-primary-600 hover:text-primary-700">View events →</button>}>
            <div className="space-y-2.5">
              {upcomingHackathons.length===0 ? (
                <p className="text-sm text-surface-500 dark:text-night-300 py-6 text-center border border-dashed border-surface-200 dark:border-[#282828] rounded-[16px]">No upcoming events</p>
              ) : upcomingHackathons.map((h:any)=>(
                <div key={h.id} className="flex items-center gap-3 p-3 rounded-[16px] bg-surface-50/60 dark:bg-[#0a0a0a] border border-surface-200 dark:border-[#282828] hover:border-primary-500/15 transition-colors">
                  <span className="w-2 h-2 rounded-full bg-primary-500 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-[#0a0a0a] dark:text-white text-sm truncate">{h.title}</p>
                    <p className="text-xs text-surface-500 dark:text-night-400 mt-0.5">{new Date(h.startDate).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</p>
                  </div>
                  <span className="text-xs font-black text-black bg-primary-500 px-2.5 py-1 rounded-full dark:text-white">{Math.max(0, Math.ceil((new Date(h.startDate).getTime()-Date.now())/86400000))}d</span>
                </div>
              ))}
            </div>

            <div className="mt-6">
              <p className="text-xs font-black tracking-widest uppercase text-surface-500 dark:text-night-300">Quick Actions</p>
              <div className="mt-3 grid grid-cols-1 gap-2">
                {[
                  {label:'Browse Hackathons', sub:'Find events & team ups', action:()=>navigate('/hackathons'), icon: Trophy},
                  {label:'Browse Internships', sub:'Explore live openings', action:()=>navigate('/internships'), icon: Briefcase},
                  {label:'Study Rooms', sub:'Group channels & chat', action:()=>navigate('/rooms'), icon: DoorOpen},
                  {label:'My Timetable', sub:'Weekly period matrix', action:()=>navigate('/schedule'), icon: Clock},
                ].slice(0, user?.role==='STUDENT' ? 4 : 3).map(a=>(
                  <button key={a.label} onClick={a.action} className="flex items-center gap-3 p-3 rounded-[16px] border border-surface-200 dark:border-[#282828] bg-white dark:bg-[#121212] hover:bg-surface-50 dark:hover:bg-[#1a1a1a] text-left transition-all hover:shadow-sm group">
                    <span className="w-9 h-9 rounded-xl bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center shrink-0 group-hover:bg-primary-500 group-hover:text-black transition-colors">
                      <a.icon size={16} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-bold text-[#0a0a0a] dark:text-white">{a.label}</span>
                      <span className="block text-xs text-surface-500 dark:text-night-400">{a.sub}</span>
                    </span>
                    <ChevronRight size={14} className="text-surface-300 dark:text-night-500 group-hover:text-[#0a0a0a] dark:group-hover:text-white transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          </SectionCard>
        </div>

        {forms.length>0 && (
          <div className="col-span-12">
            <SectionCard title="Forms needing attention" subtitle={`${forms.length} open`} icon={<ClipboardList size={16}/>} action={<span className="text-xs font-black bg-[#0a0a0a] dark:bg-white text-white dark:text-black px-3 py-1.5 rounded-full">{forms.length} open</span>}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {forms.slice(0,3).map((f:any, i:number)=>(
                  <motion.button key={f.id} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{ delay: 0.2+i*0.06 }} onClick={()=>navigate(`/forms/${f.id}`)} className="rounded-[20px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] p-4 text-left hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] hover:border-primary-500/20 hover:-translate-y-0.5 transition-all">
                    <p className="font-bold text-[#0a0a0a] dark:text-white line-clamp-1">{f.title}</p>
                    <p className="text-xs text-surface-500 dark:text-night-400 mt-1 line-clamp-2">{f.description || 'No description'}</p>
                    <p className="text-xs font-mono font-medium text-surface-400 dark:text-night-400 mt-3 inline-flex items-center gap-1"><Calendar size={12}/>{f.expiresAt ? `Due ${new Date(f.expiresAt).toLocaleDateString()}` : 'No due date'}</p>
                  </motion.button>
                ))}
              </div>
            </SectionCard>
          </div>
        )}
      </BentoGrid>
    </div>
  )
}
