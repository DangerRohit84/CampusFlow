import { useEffect, useState, useMemo, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  AtSign, MapPin, Calendar, Trophy, Briefcase, Code2, Flame,
  Award, BarChart3, ExternalLink, ArrowLeft, Copy, Check, Share2, Star, Target, Medal, GraduationCap, Building2, Users, TrendingUp, Layers, Github, Globe
} from 'lucide-react'
import { publicProfileAPI } from '../lib/api'
import { Seo } from '../components/Seo'
import { useAuthStore } from '../store/authStore'
import { PlatformLogo } from '../components/PlatformLogos'
import ActivityHeatmap from '../components/coding/ActivityHeatmap'
import { bucketParticipationsByDay, buildUnifiedHeatmapDays, calcStreaks, sumBreakdown, unifiedActiveByDay, filterUnifiedDaysByYear, getAvailableHeatmapYears, getHeatmapYearOptions, formatHeatmapRangeLabel, parseStoredHeatmapYear, ALL_SOURCES_ON, HEATMAP_RANGE_LAST_6, HEATMAP_YEAR_STORAGE_KEY, type SourceToggles, type ActivitySource } from '../lib/codingStreak'
import toast from 'react-hot-toast'
import CenteredLoader from '../components/ui/CenteredLoader'


// Full trailing window for the unified heatmap (feat-public-heatmap). Matches
// CodingProfilePage HEATMAP_FULL_WINDOW_DAYS + backend GET /u/:username/activity
// ?days= cap (365) so year slices + All filter the widest available history
// client-side (no extra backend round-trips).
const HEATMAP_FULL_WINDOW_DAYS = 365

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
  const [retryTick, setRetryTick] = useState(0)
  // Epoch guard (same pattern as HackathonDetailPage, PERPAGE-HALF2): rapid
  // /u/:a → /u/:b switches must never let slow A's response overwrite B.
  const loadSeq = useRef(0)
  // Unified heatmap: persisted CodingActivity snapshot + live GitHub for the
  // VIEWED user (GET /u/:username/activity). Best-effort (null until loaded /
  // on any fetch failure — the grid falls back to contests-only so a missing
  // table or offline GitHub never blanks the page). Shape mirrors the private
  // GET /coding-profile/activity so the merge below stays verbatim.
  // Privacy: public handles only — no edit/sync buttons on this page.
  const [activity, setActivity] = useState<{
    stored: { date: string; source: string; count: number }[];
    github: { date: string; count: number; level: number }[];
    githubLive: boolean;
    omitted: string[];
  } | null>(null)
  // Per-source heatmap toggles (Contests/Coding/Git). Same storage key as
  // CodingProfilePage so the reader's filter survives reloads across pages;
  // intensity + streaks recompute from the enabled set (streaks stay COMBINED
  // by design — see codingStreak.ts).
  const [toggles, setToggles] = useState<SourceToggles>(() => {
    try {
      const raw = localStorage.getItem('cf-heatmap-toggles')
      if (raw) {
        const p = JSON.parse(raw) as Partial<SourceToggles>
        return {
          contests: p.contests ?? ALL_SOURCES_ON.contests,
          coding: p.coding ?? ALL_SOURCES_ON.coding,
          git: p.git ?? ALL_SOURCES_ON.git,
        }
      }
    } catch { /* corrupted storage — fall through to defaults */ }
    return { ...ALL_SOURCES_ON }
  })
  const handleToggleSource = (s: ActivitySource) => {
    setToggles((prev) => {
      const next = { ...prev, [s]: !prev[s] }
      try { localStorage.setItem('cf-heatmap-toggles', JSON.stringify(next)) } catch { /* private-mode — toggles still work in-memory */ }
      return next
    })
  }
  // Year filter for the activity heatmap (Last 6 months default + calendar
  // years + All). Same storage key as CodingProfilePage; validated against
  // the years actually present once days are built (stale years fall back to
  // the default — see parseStoredHeatmapYear).
  const [heatmapYear, setHeatmapYear] = useState<string>(() => {
    try {
      const raw = localStorage.getItem(HEATMAP_YEAR_STORAGE_KEY)
      if (typeof raw === 'string' && raw) return raw
    } catch { /* corrupted storage — fall through to default */ }
    return HEATMAP_RANGE_LAST_6
  })
  const handleYearChange = (v: string) => {
    setHeatmapYear(v)
    try { localStorage.setItem(HEATMAP_YEAR_STORAGE_KEY, v) } catch { /* private-mode — filter still works in-memory */ }
  }

  useEffect(() => {
    if (!username) return
    const seq = ++loadSeq.current
    setLoading(true); setErr(null)
    // Profile + activity join the same round (activity best-effort:
    // catch → null → contests-only grid, same as CodingProfilePage).
    Promise.all([
      publicProfileAPI.get(username),
      // WHY feat-public-heatmap: fetch the backend max trailing window (365)
      // so year slices + All have history to filter client-side.
      publicProfileAPI.getActivity(username, { days: HEATMAP_FULL_WINDOW_DAYS }).catch(() => null),
    ]).then(([d, a]) => {
      if (seq !== loadSeq.current) return
      setData(d); setActivity(a as any); setLoading(false)
    }).catch((e: any) => {
      if (seq !== loadSeq.current) return
      setErr(e.response?.data?.error || 'Profile not found')
      setLoading(false)
    })
  }, [username, retryTick])

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

  // Unified heatmap: contests (participations, authoritative) + coding
  // solves (CodingActivity leetcode/codeforces from sync) + git (live GitHub
  // overlay preferred, stored snapshot fallback). Toggles filter intensity +
  // streaks; raw per-source counts stay honest in tooltips. Streaks are
  // COMBINED across enabled sources by design (documented in codingStreak.ts).
  // CodeChef/HackerRank/GFG have no daily API — omitted, never faked.
  // Year filter: the page builds the FULL trailing window (backend max 365
  // days — matches GET /u/:username/activity ?days= cap) and slices it
  // client-side to Last 6 months (default) / YYYY / All. Breakdown + streaks
  // recompute over the VISIBLE range and stay combined across enabled sources
  // (documented). Year slices show the available trailing history only —
  // never fabricated zeros outside the backend window.
  // Same merge as CodingProfilePage (shared helpers — no duplication).
  const participations: any[] = data?.participations ?? []
  const contestsByDay = useMemo(() => bucketParticipationsByDay(participations), [participations])
  const codingByDay = useMemo(() => {
    const out: Record<string, number> = {}
    for (const r of activity?.stored ?? []) {
      if (r.source !== 'leetcode' && r.source !== 'codeforces') continue
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue
      const n = Math.floor(Number(r.count))
      if (!Number.isFinite(n) || n <= 0) continue
      out[r.date] = (out[r.date] ?? 0) + n
    }
    return out
  }, [activity])
  const gitByDay = useMemo(() => {
    const out: Record<string, number> = {}
    // Live overlay wins when the backend served it (fresher than last sync).
    const live = activity?.github ?? []
    if (activity?.githubLive && live.length > 0) {
      for (const d of live) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) continue
        const n = Math.floor(Number(d.count))
        if (!Number.isFinite(n) || n <= 0) continue
        out[d.date] = n
      }
      return out
    }
    // Fallback: stored github snapshot from the last sync.
    for (const r of activity?.stored ?? []) {
      if (r.source !== 'github') continue
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue
      const n = Math.floor(Number(r.count))
      if (!Number.isFinite(n) || n <= 0) continue
      out[r.date] = (out[r.date] ?? 0) + n
    }
    return out
  }, [activity])
  const fullHeatmapDays = useMemo(
    () => buildUnifiedHeatmapDays(
      { contests: contestsByDay, coding: codingByDay, git: gitByDay },
      { toggles, windowDays: HEATMAP_FULL_WINDOW_DAYS },
    ),
    [contestsByDay, codingByDay, gitByDay, toggles],
  )
  const availableHeatmapYears = useMemo(() => getAvailableHeatmapYears(fullHeatmapDays), [fullHeatmapDays])
  const heatmapYearOptions = useMemo(() => getHeatmapYearOptions(fullHeatmapDays), [fullHeatmapDays])
  // Validated selection: stale persisted years (data window shrank) fall back
  // to the Last 6 months default; the dropdown always receives a valid value.
  const activeHeatmapYear = parseStoredHeatmapYear(heatmapYear, availableHeatmapYears)
  const heatmapRangeLabel = formatHeatmapRangeLabel(activeHeatmapYear)
  const heatmapDays = useMemo(
    () => filterUnifiedDaysByYear(fullHeatmapDays, activeHeatmapYear),
    [fullHeatmapDays, activeHeatmapYear],
  )
  const heatmapBreakdown = useMemo(() => sumBreakdown(heatmapDays), [heatmapDays])
  const streaks = useMemo(() => calcStreaks(unifiedActiveByDay(heatmapDays)), [heatmapDays])

  const platformStats: any[] = data?.codingProfile?.platformStats || []
  const statsMap: Record<string, any> = {}
  for (const s of platformStats) statsMap[s.platform] = s

  if (loading) return (
    <><Seo title={username ? `@${username}` : 'Profile'} noindex />
    <CenteredLoader fullScreen text={`Loading @${username}...`} /></>
  )
  if (err || !data) return (
    <><Seo title="Profile not found" noindex />
    <div className="max-w-3xl mx-auto px-4 py-12">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm font-medium text-surface-600 hover:text-surface-900 dark:text-night-50 mb-6"><ArrowLeft size={16}/> Back</button>
      <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] shadow-sm p-8 text-center" role="alert">
        <AtSign size={32} className="mx-auto text-surface-300" />
        <h2 className="mt-3 text-xl font-bold text-surface-900 dark:text-night-50">@{username} not found</h2>
        <p className="text-sm text-surface-500 dark:text-night-400 mt-1">{err || 'This profile does not exist.'}</p>
        <div className="mt-6 flex justify-center gap-2">
          <button onClick={() => setRetryTick((t) => t + 1)} className="inline-flex items-center gap-2 px-5 py-2.5 bg-surface-900 dark:bg-white text-white dark:text-surface-900 rounded-xl font-semibold text-sm">Retry</button>
          <Link to="/dashboard" className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-xl font-semibold text-sm">Go to dashboard</Link>
        </div>
      </div>
    </div>
    </>
  )

  const u = data.user
  const stats = data.stats
  const totalContribs = stats?.totalContribs ?? 0
  // WHY feat-public-heatmap: streaks come from the SAME unified calc as
  // CodingProfilePage (combined across enabled sources over the VISIBLE year
  // range) — not the backend deterministic-calendar streaks. The backend
  // stats.curStreak/bestStreak describe the legacy github-or-fake calendar;
  // the heatmap + Stats tiles below use `streaks` so public and private pages
  // tell one story. totalContribs stays backend (stable last-year tile).
  const curStreak = streaks.current
  const bestStreak = streaks.longest
  // WHY: index public profiles for recruiter discovery, but noindex private/
  // restricted ones (backend `visibility`/`isPrivate` when present) — RouteSeo
  // skips /u/* so this tag is the single robots source here.
  const profileName = u?.name || username || 'Profile'
  const isPrivateProfile =
    (data as any)?.visibility === 'PRIVATE' ||
    (data as any)?.isPrivate === true ||
    u?.visibility === 'PRIVATE' ||
    (u as any)?.isPrivate === true ||
    (u as any)?.isPublic === false

  return (
    <>
    <Seo
      title={`@${u?.username || username} · ${profileName}`}
      description={`${profileName}${u?.collegeName ? ` · ${u.collegeName}` : ''} — coding profile, ratings and portfolio on CampusFlow.`}
      noindex={isPrivateProfile}
      canonicalPath={`/u/${u?.username || username}`}
    />
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
                {u.avatar ? <img src={u.avatar} alt={u.name} width={80} height={80} loading="lazy" decoding="async" className="w-full h-full object-cover" /> : (u.name?.charAt(0) || '?')}
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
          {/* unified activity heatmap — SAME component + helpers as
              CodingProfilePage (contests + coding solves + git, per-source
              toggles + year filter, combined streaks). Read-only here:
              public handles only, no edit/sync buttons by design. */}
          <ActivityHeatmap
            days={heatmapDays}
            currentStreak={streaks.current}
            longestStreak={streaks.longest}
            toggles={toggles}
            onToggle={handleToggleSource}
            breakdown={heatmapBreakdown}
            yearValue={activeHeatmapYear}
            yearOptions={heatmapYearOptions}
            onYearChange={handleYearChange}
            rangeLabel={heatmapRangeLabel}
          />

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
    </>
  )
}
