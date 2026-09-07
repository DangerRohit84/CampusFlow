import { useEffect, useState, useMemo } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  AtSign, MapPin, Calendar, Trophy, Briefcase, Code2, Flame,
  Award, BarChart3, ExternalLink, ArrowLeft, Copy, Check, Share2, Star, Target, Medal, GraduationCap, Building2, Users, TrendingUp, Layers, Github, Globe
} from 'lucide-react'
import { publicProfileAPI } from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { PlatformLogo } from '../components/PlatformLogos'
import toast from 'react-hot-toast'
import CenteredLoader from '../components/ui/CenteredLoader'


const GREEN_LEVELS = [
  { bg: '#EBF5EC', darkBg: '#161B22' },
  { bg: '#ACD5B1', darkBg: '#0E4429' },
  { bg: '#7BC47F', darkBg: '#006D32' },
  { bg: '#4FA652', darkBg: '#26A641' },
  { bg: '#2D6A4F', darkBg: '#39D353' },
]
function levelColor(level: number, isDark?: boolean) {
  const l = Math.max(0, Math.min(4, level))
  return isDark ? GREEN_LEVELS[l].darkBg : GREEN_LEVELS[l].bg
}
function cfColor(rating: number | null | undefined): string {
  if (!rating) return '#9CA3AF'
  if (rating < 1200) return '#808080'
  if (rating < 1400) return '#00A210'
  if (rating < 1600) return '#03A89E'
  if (rating < 1900) return '#0000FF'
  if (rating < 2100) return '#AA00AA'
  if (rating < 2300) return '#FF8C00'
  if (rating < 2400) return '#FF8C00'
  return '#FF0000'
}

export default function PublicProfilePage() {
  const { username } = useParams<{ username: string }>()
  const navigate = useNavigate()
  const viewer = useAuthStore(s => s.user)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!username) return
    setLoading(true); setErr(null)
    publicProfileAPI.get(username).then(d => { setData(d); setLoading(false) }).catch((e: any) => {
      setErr(e.response?.data?.error || 'Profile not found')
      setLoading(false)
    })
  }, [username])

  const isOwn = viewer && data?.user && (viewer.id === data.user.id || (viewer.username && viewer.username.toLowerCase() === String(username).toLowerCase()))
  const portfolioUrl: string | null = (data?.user as any)?.portfolioUrl || null
  const isPortyPortfolio = portfolioUrl ? portfolioUrl.includes('porty-eight.vercel.app') : false

  const handleCopy = async () => {
    const link = `${window.location.origin}/u/${username}`
    try { await navigator.clipboard.writeText(link); setCopied(true); toast.success('Link copied'); setTimeout(()=>setCopied(false),1800)} catch {}
  }
  const handleCopyPortfolio = async () => {
    if (!portfolioUrl) return
    try { await navigator.clipboard.writeText(portfolioUrl); toast.success('Portfolio link copied')} catch {}
  }

  const calendar = data?.calendar as { date: string; count: number; level: number }[] | undefined
  const weeks = useMemo(() => {
    if (!calendar) return []
    const ws: typeof calendar[] = []
    for (let i = 0; i < calendar.length; i += 7) ws.push(calendar.slice(i, i+7))
    return ws
  }, [calendar])

  const monthLabels = useMemo(() => {
    if (!weeks.length) return []
    const labels: { label: string; col: number }[] = []
    let lastM = -1
    weeks.forEach((w, ci) => {
      const first = w[0]
      if (!first) return
      const m = new Date(first.date).getMonth()
      if (m !== lastM) { labels.push({ label: new Date(first.date).toLocaleDateString('en-US', { month: 'short' }), col: ci }); lastM = m }
    })
    return labels.slice(0, 8)
  }, [weeks])

  const platformStats: any[] = data?.codingProfile?.platformStats || []
  const statsMap: Record<string, any> = {}
  for (const s of platformStats) statsMap[s.platform] = s

  if (loading) return (
    <CenteredLoader fullScreen text={`Loading @${username}...`} />
  )
  if (err || !data) return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm font-medium text-surface-600 hover:text-surface-900 dark:text-night-50 mb-6"><ArrowLeft size={16}/> Back</button>
      <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] shadow-sm p-8 text-center">
        <AtSign size={32} className="mx-auto text-surface-300" />
        <h2 className="mt-3 text-xl font-bold text-surface-900 dark:text-night-50">@{username} not found</h2>
        <p className="text-sm text-surface-500 dark:text-night-400 mt-1">{err || 'This profile does not exist.'}</p>
        <Link to="/dashboard" className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-xl font-semibold text-sm">Go to dashboard</Link>
      </div>
    </div>
  )

  const u = data.user
  const stats = data.stats
  const totalContribs = stats?.totalContribs ?? 0
  const curStreak = stats?.curStreak ?? 0
  const bestStreak = stats?.bestStreak ?? 0

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* top bar */}
      <div className="flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-sm font-medium text-surface-700 dark:text-night-200 hover:bg-surface-50 dark:hover:bg-night-700">
          <ArrowLeft size={16}/> Back
        </button>
        <div className="flex items-center gap-2">
          <button onClick={handleCopy} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-sm font-medium hover:bg-surface-50 dark:hover:bg-night-700">
            {copied ? <Check size={16} className="text-emerald-500"/> : <Copy size={16}/>} {copied ? 'Copied' : 'Copy link'}
          </button>
          <button onClick={handleCopy} className="w-9 h-9 inline-flex items-center justify-center rounded-xl bg-surface-900 dark:bg-white text-white dark:text-surface-900 dark:text-night-50">
            <Share2 size={16}/>
          </button>
        </div>
      </div>

      {/* header card — leetcode + github style */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-white dark:bg-night-800 rounded-[18px] border border-surface-200 dark:border-night-650 overflow-hidden shadow-sm">
        <div className="h-2 bg-gradient-to-r from-primary-600 via-emerald-500 to-brass-400" />
        <div className="p-6 md:p-7">
          <div className="flex flex-col md:flex-row gap-6">
            <div className="flex gap-4 flex-1 min-w-0">
              <div className="w-20 h-20 rounded-2xl bg-primary-600 dark:bg-success-300 flex items-center justify-center text-white font-bold text-2xl shrink-0 overflow-hidden">
                {u.avatar ? <img src={u.avatar} alt={u.name} className="w-full h-full object-cover" /> : (u.name?.charAt(0) || '?')}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold text-surface-900 dark:text-night-50">{u.name}</h1>
                  {isOwn && <span className="px-2 py-0.5 rounded-full bg-primary-50 dark:bg-success-300/15 text-primary-700 dark:text-success-300 text-xs font-bold border border-primary-100 dark:border-success-300/20">You</span>}
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-100 dark:bg-night-700 text-surface-600 dark:text-night-300 text-xs font-medium border border-surface-200 dark:border-night-600">
                    <Building2 size={12}/> {u.college?.name || u.collegeName || 'CampusFlow'}
                  </span>
                </div>
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-mono text-surface-500 dark:text-night-300">
                  <AtSign size={14} className="text-surface-400 dark:text-night-400"/> {u.username}
                  <span className="text-surface-300">·</span>
                  <span className="text-surface-600 dark:text-night-200 font-semibold">{u.role}</span>
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-surface-500 dark:text-night-300">
                  {u.department?.name || u.departmentName ? <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-surface-50 dark:bg-night-700 border border-surface-200 dark:border-night-600"><GraduationCap size={12}/> {u.department?.name || u.departmentName}</span> : null}
                  {u.incomingYear ? <span className="inline-flex items-center gap-1"><Calendar size={12}/> Class of {u.outgoingYear || (u.incomingYear+4)}</span> : null}
                  {u.createdAt ? <span className="inline-flex items-center gap-1"><Calendar size={12}/> Joined {new Date(u.createdAt).toLocaleDateString('en-US',{month:'short', year:'numeric'})}</span> : null}
                  {portfolioUrl ? (
                    <a href={portfolioUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-500/20 hover:bg-sky-100 dark:hover:bg-sky-500/15 font-medium">
                      <Globe size={12}/> Portfolio <ExternalLink size={10}/>
                    </a>
                  ) : null}
                  {data?.codingProfile?.githubUsername ? (
                    <a href={`https://github.com/${data.codingProfile.githubUsername}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-surface-900 dark:bg-white text-white dark:text-surface-900 dark:text-night-50 border border-transparent hover:opacity-90">
                      <Github size={12}/> {data.codingProfile.githubUsername}
                    </a>
                  ) : isOwn ? (
                    <Link to="/coding-profile" className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/20 hover:bg-emerald-100">
                      <Github size={12}/> Link GitHub
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex flex-col items-start md:items-end gap-3 shrink-0">
              <div className="flex flex-wrap gap-2">
                {[
                  { k:'Problems', v: stats.totalSolved ?? 0, icon: Target, color: 'text-emerald-600' },
                  { k:'Contests', v: stats.contestsParticipated ?? 0, icon: Trophy, color: 'text-amber-600' },
                  { k:'Hackathons', v: stats.hackathonsApplied ?? 0, icon: Medal, color: 'text-blue-600' },
                  { k:'Internships', v: stats.internshipsApplied ?? 0, icon: Briefcase, color: 'text-purple-600' },
                ].map(s => (
                  <div key={s.k} className="min-w-[84px] text-center px-3 py-2 rounded-xl bg-surface-50 dark:bg-night-700/60 border border-surface-200 dark:border-night-600">
                    <p className="text-lg font-extrabold text-surface-900 dark:text-night-50 leading-none flex items-center justify-center gap-1"><s.icon size={12} className={s.color}/> {s.v}</p>
                    <p className="text-[10px] font-bold tracking-widest uppercase text-surface-500 dark:text-night-300 mt-1">{s.k}</p>
                  </div>
                ))}
              </div>
              {isOwn && (
                <Link to="/coding-profile" className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 dark:text-success-300 hover:underline">Edit coding profile <ExternalLink size={12}/></Link>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Portfolio showcase — any website, not just Porty */}
      {portfolioUrl ? (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`rounded-[18px] border p-5 shadow-sm ${isPortyPortfolio ? 'bg-white dark:bg-night-800 border-surface-200 dark:border-night-650' : 'bg-sky-50/70 dark:bg-sky-500/[0.06] border-sky-200 dark:border-sky-500/20'}`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0 ${isPortyPortfolio ? 'bg-emerald-600' : 'bg-sky-600'}`}>
                <Globe size={18}/>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-surface-900 dark:text-night-50 inline-flex items-center gap-2">Portfolio <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-bold tracking-wide ${isPortyPortfolio ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/20' : 'bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-500/20'}`}>{isPortyPortfolio ? 'Porty' : 'External'}</span></p>
                <a href={portfolioUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary-600 dark:text-success-300 hover:underline break-all inline-flex items-center gap-1">
                  <span className="break-all">{portfolioUrl}</span> <ExternalLink size={12} className="shrink-0"/>
                </a>
                <p className="text-xs text-surface-500 dark:text-night-300 mt-1">Showcased on this public profile — visible to everyone.</p>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={handleCopyPortfolio} className="px-3 py-2 rounded-xl bg-surface-900 dark:bg-white text-white dark:text-surface-900 text-xs font-semibold inline-flex items-center gap-1.5 hover:opacity-90">
                <Copy size={12}/> Copy
              </button>
              <a href={portfolioUrl} target="_blank" rel="noopener noreferrer" className="px-3 py-2 rounded-xl bg-white dark:bg-night-700 border border-surface-200 dark:border-night-600 text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-surface-50">
                <ExternalLink size={12}/> Open
              </a>
            </div>
          </div>
        </motion.div>
      ) : isOwn ? (
        <div className="rounded-[18px] border border-dashed border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800/50 p-5 text-center">
          <Globe size={20} className="mx-auto text-surface-400" />
          <p className="mt-2 text-sm font-semibold text-surface-900 dark:text-night-50">No portfolio linked yet</p>
          <p className="text-xs text-surface-500 dark:text-night-300 mt-1">Link any site — <span className="font-mono">https://your-portfolio.com</span>, <span className="font-mono">https://rohit.dev</span> — and it’ll appear here for recruiters.</p>
          <Link to="/portfolio-studio" className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-xs font-semibold">
            <Globe size={12}/> Add portfolio link
          </Link>
        </div>
      ) : null}

      {/* main grid */}
      <div className="grid grid-cols-12 gap-6">
        {/* left 8 */}
        <div className="col-span-12 lg:col-span-8 space-y-6">
          {/* contributions calendar */}
          <div className="bg-white dark:bg-night-800 rounded-[18px] border border-surface-200 dark:border-night-650 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-surface-900 dark:text-night-50 inline-flex items-center gap-2"><BarChart3 size={16} className="text-primary-600 dark:text-success-300"/> Activity
                {data?.calendarSource === 'github' ? (
                  <span className="inline-flex items-center gap-1 text-[10px] leading-none px-2 py-1 rounded-full bg-surface-900 dark:bg-white text-white dark:text-surface-900 dark:text-night-50 border"><Github size={10}/> GitHub-synced</span>
                ) : (
                  <span className="text-[10px] leading-none px-2 py-1 rounded-full bg-surface-100 dark:bg-night-700 text-surface-500 dark:text-night-300 border border-surface-200 dark:border-night-600">Estimated</span>
                )}
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-surface-500 dark:text-night-300">{totalContribs} contributions in last year</span>
                {data?.codingProfile?.githubUsername && (
                  <a href={`https://github.com/${data.codingProfile.githubUsername}`} target="_blank" rel="noopener noreferrer" className="hidden sm:inline-flex items-center gap-1 text-xs text-primary-600 dark:text-success-300 hover:underline"><Github size={12}/> @{data.codingProfile.githubUsername} <ExternalLink size={10}/></a>
                )}
              </div>
            </div>
            {/* month labels */}
            <div className="flex gap-[3px] mb-1 ml-[2px] text-[9px] font-medium text-surface-400 dark:text-night-300 select-none overflow-hidden">
              {monthLabels.map((m, i) => (
                <span key={i} style={{ marginLeft: i===0 ? 0 : `${(m.col - (monthLabels[i-1]?.col ?? 0) -1)*13}px`}} className="shrink-0">{m.label}</span>
              ))}
            </div>
            <div className="flex gap-[3px] overflow-x-auto pb-2">
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-[3px] shrink-0">
                  {week.map((day, di) => {
                    const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
                    const bg = levelColor(day.level, isDark)
                    const borderClass = day.level===0 ? (isDark ? 'border-night-700' : 'border-surface-200') : 'border-transparent'
                    return <div key={di} title={`${day.count} on ${day.date}`} className={`w-[11px] h-[11px] rounded-[3px] border ${borderClass} hover:brightness-110 hover:scale-[1.08] transition-all cursor-pointer`}
                      style={{ background: bg }} />
                  })}
                  {week.length < 7 && Array.from({ length: 7 - week.length }).map((_,k)=><div key={`p-${k}`} className="w-[11px] h-[11px]" />)}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-3 text-xs text-surface-500 dark:text-night-300">
              <span className="inline-flex items-center gap-1.5"><Flame size={12} className="text-orange-500"/> {curStreak} day streak · Best {bestStreak} days</span>
              <span className="flex items-center gap-1">Less <span className="flex gap-1 ml-1">{[0,1,2,3,4].map(l=> { const isD = typeof document !== 'undefined' && document.documentElement.classList.contains('dark'); return <span key={l} className={`w-[11px] h-[11px] rounded-[3px] border ${l===0 ? (isD ? 'border-night-700' : 'border-surface-200') : 'border-transparent'}`} style={{ background: levelColor(l, isD) }}/>})}</span> More</span>
            </div>
          </div>

          {/* coding analysis — leetcode + github combined */}
          <div className="bg-white dark:bg-night-800 rounded-[18px] border border-surface-200 dark:border-night-650 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-surface-900 dark:text-night-50 inline-flex items-center gap-2"><Code2 size={16} className="text-primary-600 dark:text-success-300"/> Coding Analysis</h2>
              <span className="text-xs text-surface-500 dark:text-night-300">{platformStats.length} platforms linked</span>
            </div>
            {platformStats.length===0 ? (
              <div className="text-center py-8 border border-dashed border-surface-200 dark:border-night-600 rounded-xl bg-surface-50 dark:bg-night-850/50">
                <Code2 size={28} className="mx-auto text-surface-300" />
                <p className="mt-2 text-sm text-surface-600 dark:text-night-200 font-medium">No coding platforms linked yet</p>
                <p className="text-xs text-surface-500 dark:text-night-300 mt-1">Problems, ratings and contest history will appear here.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* totals */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl bg-surface-50 dark:bg-night-700/50 border border-surface-200 dark:border-night-600 p-3 text-center">
                    <p className="text-xl font-extrabold text-surface-900 dark:text-night-50">{stats.totalSolved?.toLocaleString?.() ?? stats.totalSolved}</p>
                    <p className="text-[10px] font-bold tracking-widest uppercase text-surface-500 dark:text-night-300">Solved</p>
                  </div>
                  <div className="rounded-xl bg-surface-50 dark:bg-night-700/50 border border-surface-200 dark:border-night-600 p-3 text-center">
                    <p className="text-xl font-extrabold" style={{ color: cfColor(data.codingProfile?.bestRating) }}>{data.codingProfile?.bestRating ?? '—'}</p>
                    <p className="text-[10px] font-bold tracking-widest uppercase text-surface-500 dark:text-night-300">Best Rating</p>
                  </div>
                  <div className="rounded-xl bg-surface-50 dark:bg-night-700/50 border border-surface-200 dark:border-night-600 p-3 text-center">
                    <p className="text-xl font-extrabold text-surface-900 dark:text-night-50">{stats.contestsParticipated}</p>
                    <p className="text-[10px] font-bold tracking-widest uppercase text-surface-500 dark:text-night-300">Contests</p>
                  </div>
                </div>

                {/* per platform cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {platformStats.map((s:any) => {
                    const lc = s.platform === 'leetcode'
                    const cf = s.platform === 'codeforces'
                    return (
                      <div key={s.platform} className="rounded-xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-850/50 p-4">
                        <div className="flex items-center justify-between mb-3">
                          <span className="inline-flex items-center gap-2 font-bold text-surface-900 dark:text-night-50 text-sm">
                            <PlatformLogo platform={s.platform} size={18}/> {s.platform}
                          </span>
                          <a href={s.handle ? `https://${s.platform==='leetcode'?'leetcode.com/u/'+s.handle: s.platform==='codeforces'?'codeforces.com/profile/'+s.handle: s.platform==='codechef'?'codechef.com/users/'+s.handle: s.platform==='gfg'?'geeksforgeeks.org/user/'+s.handle+'/':'hackerrank.com/profile/'+s.handle}` : '#'} target="_blank" rel="noreferrer" className="text-xs text-primary-600 dark:text-success-300 hover:underline inline-flex items-center gap-1">@{s.handle} <ExternalLink size={10}/></a>
                        </div>
                        <div className="space-y-2 text-xs">
                          <div className="flex justify-between"><span className="text-surface-500 dark:text-night-300">Solved</span><span className="font-bold text-surface-900 dark:text-night-50">{s.problemsSolved ?? 0}{s.totalProblems ? ` / ${s.totalProblems}`:''}</span></div>
                          {s.rating != null && <div className="flex justify-between"><span className="text-surface-500 dark:text-night-400">Rating</span><span className="font-bold" style={{ color: cf ? cfColor(s.rating) : undefined }}>{s.rating} {s.rankTitle ? `(${s.rankTitle})`:''}</span></div>}
                          {s.maxRating != null && <div className="flex justify-between"><span className="text-surface-500 dark:text-night-400">Max</span><span className="font-medium">{s.maxRating} {s.maxRankTitle?`(${s.maxRankTitle})`:''}</span></div>}
                          {s.globalRank != null && <div className="flex justify-between"><span className="text-surface-500 dark:text-night-400">Global rank</span><span className="font-medium">#{s.globalRank?.toLocaleString?.()}</span></div>}
                          {s.easySolved != null && (
                            <div className="pt-2 space-y-1">
                              {[
                                { k:'Easy', v:s.easySolved, c:'#22C55E', tot:850 },
                                { k:'Med.', v:s.mediumSolved, c:'#F59E0B', tot:1750 },
                                { k:'Hard', v:s.hardSolved, c:'#EF4444', tot:750 },
                              ].map(r=>(
                                <div key={r.k} className="flex items-center gap-2">
                                  <span className="text-[10px] w-8 text-surface-500 dark:text-night-400">{r.k}</span>
                                  <div className="flex-1 h-1.5 rounded-full bg-surface-200 dark:bg-night-600 overflow-hidden"><div className="h-full rounded-full" style={{ width:`${Math.min(100,(r.v/r.tot)*100)}%`, background:r.c }}/></div>
                                  <span className="text-[11px] font-bold w-6 text-right">{r.v}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* hackathons & internships timeline */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-night-800 rounded-[18px] border border-surface-200 dark:border-night-650 p-5">
              <h3 className="font-bold text-surface-900 dark:text-night-50 inline-flex items-center gap-2 mb-3"><Trophy size={14} className="text-amber-500"/> Hackathons · {stats.hackathonsApplied}</h3>
              {data.hackathonRegs.length===0 ? <p className="text-sm text-surface-500 dark:text-night-400 py-6 text-center border border-dashed rounded-xl">No hackathons yet</p> :
                <div className="space-y-2 max-h-[300px] overflow-auto pr-1">
                  {data.hackathonRegs.slice(0,20).map((r:any)=>(
                    <div key={r.id} className="flex items-start gap-3 p-3 rounded-xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-850/50">
                      <span className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/15 flex items-center justify-center text-amber-600 shrink-0"><Trophy size={14}/></span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-surface-900 dark:text-night-50 truncate">{r.hackathon?.title || 'Hackathon'}</p>
                        <p className="text-xs text-surface-500 dark:text-night-300">{r.status}{r.winPosition ? ` · ${r.winPosition}`:''} · {new Date(r.createdAt).toLocaleDateString()}</p>
                      </div>
                    </div>
                  ))}
                </div>}
            </div>
            <div className="bg-white dark:bg-night-800 rounded-[18px] border border-surface-200 dark:border-night-650 p-5">
              <h3 className="font-bold text-surface-900 dark:text-night-50 inline-flex items-center gap-2 mb-3"><Briefcase size={14} className="text-blue-500"/> Internships · {stats.internshipsApplied}</h3>
              {data.internshipRegs.length===0 ? <p className="text-sm text-surface-500 dark:text-night-400 py-6 text-center border border-dashed rounded-xl">No internships yet</p> :
                <div className="space-y-2 max-h-[300px] overflow-auto pr-1">
                  {data.internshipRegs.slice(0,20).map((r:any)=>(
                    <div key={r.id} className="flex items-start gap-3 p-3 rounded-xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-850/50">
                      <span className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/15 flex items-center justify-center text-blue-600 shrink-0"><Briefcase size={14}/></span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-surface-900 dark:text-night-50 truncate">{r.internship?.title || r.internship?.company || 'Internship'}</p>
                        <p className="text-xs text-surface-500 dark:text-night-300">{r.internship?.company || ''} · {r.status} · {new Date(r.createdAt).toLocaleDateString()}</p>
                      </div>
                    </div>
                  ))}
                </div>}
            </div>
          </div>
        </div>

        {/* right 4 — stats + participations */}
        <div className="col-span-12 lg:col-span-4 space-y-6">
          <div className="bg-white dark:bg-night-800 rounded-[18px] border border-surface-200 dark:border-night-650 p-5">
            <h3 className="font-bold text-surface-900 dark:text-night-50 mb-3 inline-flex items-center gap-2"><Layers size={14}/> Stats</h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label:'Solved', value: stats.totalSolved, icon: Target },
                { label:'Contests', value: stats.contestsParticipated, icon: TrendingUp },
                { label:'Streak', value:`${curStreak}d`, icon: Flame },
                { label:'Best', value:`${bestStreak}d`, icon: Award },
                { label:'Internships', value: stats.internshipsApplied, icon: Briefcase },
                { label:'Hackathons', value: stats.hackathonsApplied, icon: Trophy },
                { label:'Wins', value: stats.hackathonsWon, icon: Medal },
                { label:'Contribs', value: totalContribs, icon: BarChart3 },
              ].map(s=>(
                <div key={s.label} className="rounded-xl bg-surface-50 dark:bg-night-700/50 border border-surface-200 dark:border-night-600 p-3 text-center">
                  <s.icon size={14} className="mx-auto text-surface-400 dark:text-night-400" />
                  <p className="text-base font-extrabold text-surface-900 dark:text-night-50 mt-1">{s.value}</p>
                  <p className="text-[10px] font-bold tracking-widest uppercase text-surface-500 dark:text-night-300">{s.label}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 p-3 rounded-xl bg-primary-50 dark:bg-success-300/10 border border-primary-100 dark:border-success-300/20">
              <p className="text-xs font-bold text-surface-700 dark:text-night-200 inline-flex items-center gap-1"><Star size={12} className="text-brass-500"/> {u.name} on CampusFlow</p>
              <p className="text-xs text-surface-500 dark:text-night-300 mt-1">Share your coding profile and activity with friends and recruiters.</p>
            </div>
          </div>

          {/* contest participations */}
          <div className="bg-white dark:bg-night-800 rounded-[18px] border border-surface-200 dark:border-night-650 p-5">
            <h3 className="font-bold text-surface-900 dark:text-night-50 mb-3 inline-flex items-center gap-2"><Users size={14}/> Contest History</h3>
            {data.participations.length===0 ? <p className="text-sm text-surface-500 dark:text-night-400 py-6 text-center border border-dashed rounded-xl">No contests yet</p> :
              <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
                {data.participations.slice(0,30).map((p:any)=>(
                  <div key={p.id} className="p-3 rounded-xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-850/50">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-white dark:bg-night-700 border flex items-center justify-center shrink-0"><PlatformLogo platform={p.platform} size={14}/></span>
                      <p className="text-sm font-semibold text-surface-900 dark:text-night-50 truncate flex-1">{p.contestName}</p>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                      <span className="px-1.5 py-0.5 rounded-full bg-white dark:bg-night-700 border text-surface-600 dark:text-night-300 capitalize">{p.platform}</span>
                      {p.rank ? <span className="px-1.5 py-0.5 rounded-full bg-surface-900 dark:bg-white text-white dark:text-surface-900 dark:text-night-50 font-bold">#{p.rank.toLocaleString()}</span> : null}
                      {p.rating ? <span className="px-1.5 py-0.5 rounded-full border font-semibold" style={{ color: cfColor(p.rating), borderColor: cfColor(p.rating)+ '40' }}>{p.rating}</span> : null}
                      {p.ratingChange ? <span className={`px-1.5 py-0.5 rounded-full font-bold ${p.ratingChange>0?'bg-emerald-50 text-emerald-600 border-emerald-200':'bg-red-50 text-red-600 border-red-200'} border`}>{p.ratingChange>0?'+':''}{p.ratingChange}</span> : null}
                    </div>
                    {p.contestUrl ? <a href={p.contestUrl} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs text-primary-600 dark:text-success-300 hover:underline">View <ExternalLink size={10}/></a> : null}
                    <p className="text-[11px] text-surface-400 dark:text-night-400 mt-1">{p.participatedAt ? new Date(p.participatedAt).toLocaleDateString() : ''}</p>
                  </div>
                ))}
              </div>}
          </div>
        </div>
      </div>
    </div>
  )
}
