import { useState, useEffect, useRef, useMemo } from 'react'
import { codingProfileAPI, waitForCodingSync } from '../lib/api'
import { useDepartments } from '../hooks/useDepartments'
import { notifyEntityMutated, useEntitySync } from '../lib/entitySync'
import { useAuthStore } from '../store/authStore'
import { motion, AnimatePresence } from 'framer-motion'
import { Code, Loader2, ExternalLink, RefreshCw, AlertTriangle,
  Trophy, TrendingUp, Target, BarChart3, Medal, ChevronDown, Users, Star, Award, Filter, Github, CheckCircle2, XCircle, Code2, Flame, Share2, ListChecks } from 'lucide-react'
import toast from 'react-hot-toast'
import { PlatformLogo } from '../components/PlatformLogos'
import type { CodingProfile } from '../types/codingProfile'
import { getSyncAgeMs, isPlatformStale, formatSyncAge } from '../types/codingProfile'
import ActivityHeatmap from '../components/coding/ActivityHeatmap'
import ProblemsTab from '../components/coding/ProblemsTab'
import { bucketParticipationsByDay, buildUnifiedHeatmapDays, calcStreaks, sumBreakdown, unifiedActiveByDay, filterUnifiedDaysByYear, getAvailableHeatmapYears, getHeatmapYearOptions, formatHeatmapRangeLabel, parseStoredHeatmapYear, ALL_SOURCES_ON, HEATMAP_RANGE_LAST_6, HEATMAP_YEAR_STORAGE_KEY, type SourceToggles, type ActivitySource } from '../lib/codingStreak'
import { downloadShareCard } from '../components/coding/shareCard'
import { PremiumHero, GlassPanel, BentoGrid, BentoCard, SectionCard } from '../components/premium/PremiumKit'
import CenteredLoader from '../components/ui/CenteredLoader'

interface PlatformStat {
  platform: string
  handle: string
  valid: boolean
  problemsSolved?: number | null
  easySolved?: number | null
  mediumSolved?: number | null
  hardSolved?: number | null
  totalProblems?: number | null
  rating?: number | null
  maxRating?: number | null
  rankTitle?: string | null
  maxRankTitle?: string | null
  globalRank?: number | null
  countryRank?: number | null
  stars?: number | null
  division?: string | null
  score?: number | null
  badges?: number | null
  contestCount?: number | null
}

const platforms = [
  { key: 'leetcodeHandle', label: 'LeetCode', id: 'leetcode', color: '#FFA116', url: 'https://leetcode.com/' },
  { key: 'codeforcesHandle', label: 'Codeforces', id: 'codeforces', color: '#1F8ACB', url: 'https://codeforces.com/profile/' },
  { key: 'codechefHandle', label: 'CodeChef', id: 'codechef', color: '#5B4638', url: 'https://www.codechef.com/users/' },
  { key: 'hackerrankHandle', label: 'HackerRank', id: 'hackerrank', color: '#00EA64', url: 'https://www.hackerrank.com/profile/' },
  { key: 'gfgHandle', label: 'GeeksforGeeks', id: 'gfg', color: '#2F8D46', url: 'https://www.geeksforgeeks.org/user/' },
]

const platformColors: Record<string, { bg: string; text: string; border: string }> = {
  leetcode: { bg: 'bg-yellow-50 dark:bg-yellow-500/10', text: 'text-yellow-700 dark:text-yellow-400', border: 'border-yellow-200 dark:border-yellow-500/20' },
  codeforces: { bg: 'bg-blue-50 dark:bg-blue-500/10', text: 'text-blue-700 dark:text-blue-400', border: 'border-blue-200 dark:border-blue-500/20' },
  codechef: { bg: 'bg-amber-50 dark:bg-amber-500/10', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-500/20' },
  hackerrank: { bg: 'bg-green-50 dark:bg-green-500/10', text: 'text-green-700 dark:text-green-400', border: 'border-green-200 dark:border-green-500/20' },
  gfg: { bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-500/20' },
}

const GITHUB_REGEX = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i
function isValidGithubUsername(v: string): boolean {
  return GITHUB_REGEX.test(v.trim())
}

// Sync throttle window (mirrors backend SYNC_THROTTLE_MS = 60s). WHY: the
// Sync button must stay disabled with a live countdown instead of letting
// users hammer the endpoint into a hidden 429.

// Codeforces rating -> color (official palette)
function cfColor(rating: number | null | undefined): string {
  if (!rating) return '#9CA3AF'
  if (rating < 1200) return '#808080'      // Newbie
  if (rating < 1400) return '#00A210'      // Pupil
  if (rating < 1600) return '#03A89E'      // Specialist
  if (rating < 1900) return '#0000FF'      // Expert
  if (rating < 2100) return '#AA00AA'      // Candidate Master
  if (rating < 2300) return '#FF8C00'      // Master
  if (rating < 2400) return '#FF8C00'      // International Master
  return '#FF0000'                          // Grandmaster+
}

// CodeChef stars -> color
function ccStarColor(stars: number): string {
  const colors = ['#666666', '#2E8B57', '#1565C0', '#8E24AA', '#EF6C00']
  return colors[Math.min(Math.max(stars, 1), 5) - 1]
}

const SYNC_COOLDOWN_SEC = 60

// Full trailing window for the unified heatmap (feat-heatmap-year). Matches
// the backend GET /coding-profile/activity ?days= cap (365) so year slices +
// All filter the widest available history client-side (no backend change).
const HEATMAP_FULL_WINDOW_DAYS = 365

function StatBox({ value, label, accent }: { value: React.ReactNode; label: string; accent?: boolean }) {
  return (
    <div className="text-center px-2 py-1.5 rounded-xl bg-white/50 dark:bg-night-850/60">
      <p className={`text-lg font-bold ${accent ? 'text-primary-600 dark:text-success-300' : 'text-surface-900 dark:text-night-50'}`}>{value}</p>
      <p className="text-[10px] text-surface-500 dark:text-night-300 leading-tight mt-0.5">{label}</p>
    </div>
  )
}

// Difficulty bar for LeetCode
function DifficultyBar({ stat }: { stat: PlatformStat }) {
  const items = [
    { label: 'Easy', count: stat.easySolved ?? 0, total: Math.max(stat.easySolved ?? 0, 850), color: '#22C55E' },
    { label: 'Med.', count: stat.mediumSolved ?? 0, total: Math.max(stat.mediumSolved ?? 0, 1750), color: '#F59E0B' },
    { label: 'Hard', count: stat.hardSolved ?? 0, total: Math.max(stat.hardSolved ?? 0, 750), color: '#EF4444' },
  ]
  return (
    <div className="space-y-2">
      {items.map((it) => (
        <div key={it.label}>
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-surface-500 dark:text-night-300">{it.label}</span>
            <span className="font-medium text-surface-700 dark:text-night-200">{it.count}</span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-100 dark:bg-night-600 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, (it.count / it.total) * 100)}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className="h-full rounded-full"
              style={{ backgroundColor: it.color }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function CodingProfilePage() {
  const { user } = useAuthStore()
  const [profile, setProfile] = useState<CodingProfile | null>(null)
  const [handles, setHandles] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [participations, setParticipations] = useState<any[]>([])
  const [leaderboard, setLeaderboard] = useState<any[]>([])
  const [showProfilePrompt, setShowProfilePrompt] = useState(false)
  const [showHandles, setShowHandles] = useState(false)
  const [activeTab, setActiveTab] = useState<'stats' | 'history' | 'leaderboard' | 'problems'>('stats')
  const [historyFilter, setHistoryFilter] = useState('all')
  const [leaderboardPlatform, setLeaderboardPlatform] = useState('all')
  const [leaderboardDept, setLeaderboardDept] = useState('all')
  // PERPAGE-HALF1: shared cached departments (was an uncached mount GET,
  // duplicated across 7 pages). Same array data for the leaderboard filter.
  const { data: departmentsData } = useDepartments()
  const departments: any[] = Array.isArray(departmentsData) ? departmentsData : []
  const [githubError, setGithubError] = useState<string | null>(null)
  const [githubChecking, setGithubChecking] = useState(false)
  const [githubValid, setGithubValid] = useState<boolean | null>(null)
  // Unified heatmap: persisted CodingActivity snapshot + live GitHub days.
  // Best-effort (null until loaded / on any fetch failure — the grid falls
  // back to contests-only so a missing table or offline GitHub never blanks
  // the page). Shape mirrors GET /coding-profile/activity.
  const [activity, setActivity] = useState<{
    stored: { date: string; source: string; count: number }[];
    github: { date: string; count: number; level: number }[];
    githubLive: boolean;
    omitted: string[];
  } | null>(null)
  // Per-source heatmap toggles (Contests/Coding/Git). Persisted locally so
  // the reader's filter survives reloads; intensity + streaks recompute from
  // the enabled set (streaks stay COMBINED by design — see codingStreak.ts).
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
  // years + All). Persisted locally alongside the source toggles; validated
  // against the years actually present once days are built (stale years fall
  // back to the default — see parseStoredHeatmapYear).
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
  const autoSyncRef = useRef(false)
  // PERPAGE-HALF1: generation guards — rapid filter/tab switches and
  // StrictMode double-mount fire overlapping async loads; only the latest
  // generation may commit state (prevents out-of-order paints; these
  // endpoints take no AbortSignal). Same data when current.
  const loadEpoch = useRef(0)
  const leaderboardEpoch = useRef(0)
  // Cooldown remaining (seconds) before Sync may run again. Seeded from the
  // backend 429 retryAfterSec or the last-sync timestamp; ticks every 1s.
  const [cooldownSec, setCooldownSec] = useState(0)
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearCooldownTimer = () => {
    if (cooldownTimerRef.current) {
      clearInterval(cooldownTimerRef.current)
      cooldownTimerRef.current = null
    }
  }

  const startCooldown = (sec: number) => {
    const clamped = Math.max(1, Math.min(SYNC_COOLDOWN_SEC, Math.ceil(sec)))
    clearCooldownTimer()
    setCooldownSec(clamped)
    cooldownTimerRef.current = setInterval(() => {
      setCooldownSec((prev) => {
        if (prev <= 1) {
          if (cooldownTimerRef.current) {
            clearInterval(cooldownTimerRef.current)
            cooldownTimerRef.current = null
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  useEffect(() => { loadData() }, [])

  // Cleanup the 1s ticker on unmount.
  useEffect(() => () => clearCooldownTimer(), [])

  // Seed the countdown from the last-sync timestamp so a refresh inside the
  // 60s window still shows the remaining time instead of a clickable button
  // that would immediately 429.
  useEffect(() => {
    if (!profile?.lastSyncedAt || syncing || cooldownSec > 0) return
    const elapsedSec = Math.floor((Date.now() - new Date(profile.lastSyncedAt).getTime()) / 1000)
    const remaining = SYNC_COOLDOWN_SEC - elapsedSec
    if (remaining > 0 && remaining < SYNC_COOLDOWN_SEC) startCooldown(remaining)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.lastSyncedAt])

  const loadData = async () => {
    const epoch = ++loadEpoch.current
    try {
      // Already parallel (profile + participations in one round) — kept.
      // Activity (CodingActivity snapshot + live GitHub) joins the same
      // round; it is best-effort (catch → null → contests-only grid).
      const [profileData, partData, activityData] = await Promise.all([
        codingProfileAPI.get(),
        codingProfileAPI.getParticipations(),
        // WHY feat-heatmap-year: fetch the backend max trailing window (365)
        // so year slices + All have history to filter client-side. Best-effort
        // (catch → null → contests-only grid) as before.
        codingProfileAPI.getActivity({ days: 365 }).catch(() => null),
      ])
      if (epoch !== loadEpoch.current) return
      setProfile(profileData)
      setActivity(activityData as any)
      setHandles({
        leetcodeHandle: profileData?.leetcodeHandle || '',
        codeforcesHandle: profileData?.codeforcesHandle || '',
        codechefHandle: profileData?.codechefHandle || '',
        hackerrankHandle: profileData?.hackerrankHandle || '',
        gfgHandle: profileData?.gfgHandle || '',
        githubUsername: (profileData as any)?.githubUsername || '',
      })
      // Reset github validation state from loaded profile
      if ((profileData as any)?.githubUsername) {
        setGithubValid(null)
        setGithubError(null)
      }
      setParticipations(partData)
      const count = [
        profileData?.leetcodeHandle,
        profileData?.codeforcesHandle,
        profileData?.codechefHandle,
        profileData?.hackerrankHandle,
        profileData?.gfgHandle,
      ].filter(Boolean).length
      if (count === 0 && !showProfilePrompt) setShowProfilePrompt(true)

      // Auto-sync in background when data is stale (>30 min) and handles exist
      if (count > 0 && !autoSyncRef.current) {
        const last = profileData?.lastSyncedAt ? new Date(profileData.lastSyncedAt).getTime() : 0
        if (Date.now() - last > 30 * 60 * 1000) {
          autoSyncRef.current = true
          codingProfileAPI.sync(true)
            .then((r: any) => {
              // 202 = sync kicked off server-side; refresh once it has likely finished
              if (r && !r.skipped) {
                setTimeout(() => { autoSyncRef.current = false; loadData() }, 20000)
              } else {
                autoSyncRef.current = false
              }
            })
            .catch(() => { autoSyncRef.current = false })
        }
      }
    } catch (err) {
      if (epoch !== loadEpoch.current) return
      console.error(err)
    } finally {
      if (epoch === loadEpoch.current) setLoading(false)
    }
  }

  const loadLeaderboard = async (platform = leaderboardPlatform, deptId = leaderboardDept) => {
    // PERPAGE-HALF1: generation guard — rapid dept/platform switches fired
    // overlapping GETs with last-write-wins races (endpoint takes no
    // AbortSignal). Only the latest filter generation commits.
    const epoch = ++leaderboardEpoch.current
    try {
      const params: { platform?: string; departmentId?: string } = {}
      if (platform !== 'all') params.platform = platform
      if (deptId !== 'all') params.departmentId = deptId
      const data = await codingProfileAPI.getLeaderboard(params)
      if (epoch !== leaderboardEpoch.current) return
      setLeaderboard(data)
    } catch { }
  }

  // STATE-SYNC: external mutations (other tab/device) refresh without reload.
  useEntitySync(['coding-profile', 'contest'], loadData as any)
  // Departments now come from the shared useDepartments() hook above —
  // the old uncached mount useEffect was removed (PERPAGE-HALF1).

  useEffect(() => {
    if (activeTab === 'leaderboard') loadLeaderboard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, leaderboardPlatform, leaderboardDept])

  const handleGithubCheck = async () => {
    const raw = (handles.githubUsername || '').trim()
    if (!raw) {
      setGithubError(null)
      setGithubValid(null)
      return
    }
    if (!isValidGithubUsername(raw)) {
      setGithubError('Invalid GitHub username (1-39 chars, letters/numbers/hyphens, cannot start/end with hyphen)')
      setGithubValid(false)
      return
    }
    setGithubChecking(true)
    setGithubError(null)
    try {
      await codingProfileAPI.getGithubForUsername(raw, { days: 7 } as any)
      setGithubValid(true)
      toast.success(`GitHub @${raw} found`)
    } catch (e: any) {
      const msg = e.response?.data?.error || e.message || 'Not found'
      if (e.response?.status === 404) {
        setGithubError(`GitHub user "@${raw}" not found`)
        setGithubValid(false)
      } else {
        setGithubError(msg)
        setGithubValid(null)
      }
    } finally {
      setGithubChecking(false)
    }
  }

  const handleSave = async () => {
    const githubRaw = (handles.githubUsername || '').trim()
    if (githubRaw && !isValidGithubUsername(githubRaw)) {
      setGithubError('Invalid GitHub username (1-39 chars, letters/numbers/hyphens, cannot start/end with hyphen)')
      toast.error('Fix GitHub username before saving')
      return
    }
    setSaving(true)
    try {
      // sanitize before sending: trim everything
      const payload: Record<string, string> = {}
      for (const [k, v] of Object.entries(handles)) payload[k] = typeof v === 'string' ? v.trim() : v as any
      // ensure githubUsername key matches backend expectation
      if (payload.githubUsername === '') payload.githubUsername = '' as any
      await codingProfileAPI.update(payload)
      toast.success('Profiles saved! Hit Sync to fetch your stats. GitHub activity will update on your public calendar.')
      setGithubValid(githubRaw ? true : null)
      setGithubError(null)
      // Backend clears the per-user sync throttle when handles change, so a
      // stale countdown must not block the immediate re-sync for NEW handles.
      clearCooldownTimer()
      setCooldownSec(0)
      notifyEntityMutated('coding-profile')
      loadData()
    } catch (e: any) {
      const msg = e.response?.data?.error || 'Failed to save'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const handleSync = async () => {
    if (syncing || cooldownSec > 0) return
    const baseline = profile?.lastSyncedAt ? new Date(profile.lastSyncedAt).getTime() : 0
    setSyncing(true)
    try {
      const result = await codingProfileAPI.sync()
      if (result?.skipped) {
        if (result.reason === 'no-handles') {
          // Server refused to start a job because no handles are configured —
          // inform instead of polling until timeout.
          toast(result.message || 'Add at least one coding platform handle first', { icon: 'ℹ️' })
        } else {
          toast.success('Stats are already up to date')
        }
        setSyncing(false)
        return
      }
      // 202: job started — block re-sync for the 60s throttle window.
      startCooldown(SYNC_COOLDOWN_SEC)
    } catch (e: any) {
      const retryAfterSec = e?.response?.data?.retryAfterSec
      if (e?.response?.status === 429 || typeof retryAfterSec === 'number') {
        // WHY: seed the visible countdown from the backend remaining seconds;
        // fall back to the last-sync timestamp when the field is missing.
        const fallbackSec = profile?.lastSyncedAt
          ? Math.max(1, SYNC_COOLDOWN_SEC - Math.floor((Date.now() - new Date(profile.lastSyncedAt).getTime()) / 1000))
          : SYNC_COOLDOWN_SEC
        const secs = typeof retryAfterSec === 'number' && Number.isFinite(retryAfterSec)
          ? Math.max(1, Math.ceil(retryAfterSec))
          : fallbackSec
        startCooldown(secs)
        toast.error(e?.response?.data?.error || `Sync cooling down. Try again in ${secs}s.`)
      } else {
        toast.error(e?.response?.data?.error || 'Sync failed')
      }
      setSyncing(false)
      return
    }
    toast.success('Syncing your profiles...')
    const { completed } = await waitForCodingSync(baseline)
    if (completed) toast.success('Profiles synced!')
    else toast.error('Sync is taking longer than expected')
    loadData()
    setSyncing(false)
  }

  const filledCount = Object.values(handles).filter(Boolean).length

  // Sync staleness (upgrade 2: sync-comparison §4 + fix-sync-upgrades-backend).
  // WHY: backend sets lastSyncError (≤500ch) on TOTAL failure, clears it on
  // success, and does NOT advance lastSyncedAt on total failure — so a stale
  // badge must consider BOTH the error string AND per-platform TTL age
  // (LC/GFG 30m, CF 1h, CC 2h, HR 6h — see types/codingProfile.ts). Previously
  // old stats rendered silently as fresh (stale-cache trust lesson).
  const syncAgeMs = getSyncAgeMs(profile?.lastSyncedAt)
  const syncAgeLabel = profile?.lastSyncedAt ? formatSyncAge(syncAgeMs) : null
  const lastSyncError = (profile?.lastSyncError || '').trim() || null
  // Platforms with linked handles whose data is older than their own TTL.
  const stalePlatforms = platforms
    .filter((p) => (handles[p.key] || '').trim())
    .filter((p) => isPlatformStale(p.id, profile?.lastSyncedAt))
    .map((p) => p.id)
  const isProfileStale = lastSyncError != null || stalePlatforms.length > 0
  const isPlatformCardStale = (platformId: string) =>
    lastSyncError != null || isPlatformStale(platformId, profile?.lastSyncedAt)

  // Parse stored platform stats
  // Order 9: CodingProfile.platformStats is Json? (JSONB array) — Prisma
  // returns an ARRAY, not a string. Legacy rows may still be a JSON string.
  // Mirror publicProfile.ts:221 + codingProfile.ts:180 (Array.isArray first).
  // WHY: JSON.parse(array) throws ("[object Object]" invalid) → catch wiped
  // valid stats → 0 solves / — rating / 0/1 + "Handles saved" banner despite
  // fresh sync (danger_rohit84 live repro).
  let statsMap: Record<string, PlatformStat> = {}
  try {
    const raw: unknown = (profile as any)?.platformStats
    const parsed: PlatformStat[] = Array.isArray(raw)
      ? (raw as PlatformStat[])
      : (typeof raw === 'string' && raw.trim() ? JSON.parse(raw) : [])
    statsMap = Object.fromEntries(parsed.filter(s => s && s.valid).map(s => [s.platform, s]))
  } catch { statsMap = {} }

  // Aggregate numbers
  const totalSolved = Object.values(statsMap).reduce((s, st) => s + (st.problemsSolved || 0), 0)
  const totalContests = participations.length
  const ratedPlatforms = Object.values(statsMap).filter(s => s.rating)
  const bestRating = ratedPlatforms.reduce((max, s) => Math.max(max, s.rating || 0), 0)
  const avgRank = participations.length > 0
    ? Math.round(participations.filter(p => p.rank).reduce((s, p) => s + p.rank, 0) / participations.filter(p => p.rank).length)
    : null

  const filteredParticipations = historyFilter === 'all'
    ? participations
    : participations.filter(p => p.platform === historyFilter)

  // Unified heatmap: contests (participations, authoritative) + coding
  // solves (CodingActivity leetcode/codeforces from sync) + git (live GitHub
  // overlay preferred, stored snapshot fallback). Toggles filter intensity +
  // streaks; raw per-source counts stay honest in tooltips. Streaks are
  // COMBINED across enabled sources by design (documented in codingStreak.ts).
  // CodeChef/HackerRank/GFG have no daily API — omitted, never faked.
  // Year filter (feat-heatmap-year): the page builds the FULL trailing window
  // (backend max 365 days — matches GET /coding-profile/activity ?days= cap)
  // and slices it client-side to Last 6 months (default) / YYYY / All.
  // Breakdown + streaks recompute over the VISIBLE range and stay combined
  // across enabled sources (documented). Year slices show the available
  // trailing history only — never fabricated zeros outside the backend window.
  // Backend change NOT needed: existing ?days= param already serves the rows.
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

  // Task #7: 1200×630 LinkedIn share card — canvas-drawn, client-only.
  // Unified breakdown (contests/solves/commits) rides along when available.
  const handleShare = () => {
    try {
      downloadShareCard(
        {
          name: user?.name || 'Coder',
          username: (user as any)?.username,
          handles: platforms
            .map((p) => ({ label: p.label, value: ((handles[p.key] || '') as string).trim() }))
            .filter((h) => h.value),
          problemsSolved: totalSolved,
          contests: totalContests,
          bestRating: bestRating || null,
          currentStreak: streaks.current,
          longestStreak: streaks.longest,
          dateLabel: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          breakdown: {
            contests: heatmapBreakdown.contests,
            coding: heatmapBreakdown.coding,
            git: heatmapBreakdown.git,
          },
        },
        (user as any)?.username || user?.name,
      )
      toast.success('Share card downloaded — post it on LinkedIn!')
    } catch {
      toast.error('Could not generate the share card')
    }
  }

  if (loading) return (
      <CenteredLoader text="Loading coding profile..." />
    )

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* ─── Premium Dark Hero — bento 12-col, glass, Brand green ─── */}
      <PremiumHero
        icon={<Code2 size={18} />}
        eyebrow="Coding · Profile"
        title={<>Coding Profile</>}
        subtitle="Your competitive journey — ratings, solves and platform links."
      />
      {/* premium tokens: bg-[#0a0a0a] rounded-[32px] backdrop-blur-xl bg-white/[0.03] border-white/10 grid-cols-12 #1ed760 */}
      <div className="hidden rounded-[32px] bg-[#0a0a0a] backdrop-blur-xl bg-white/[0.03] border border-white/10 grid-cols-12" />

      {/* ===== Header ===== */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-primary-600 dark:bg-gradient-to-br dark:from-success-300 dark:to-success-200 flex items-center justify-center text-white dark:text-night-950 font-bold text-xl shadow-lg">
            {user?.name?.charAt(0) || 'S'}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-surface-900 dark:text-night-50">{user?.name}</h1>
            <p className="text-sm text-surface-500 dark:text-night-300">
              {filledCount > 0 ? `${filledCount} platform${filledCount > 1 ? 's' : ''} linked` : 'No platforms linked yet'}
              {profile?.lastSyncedAt && ` ⬢ Last synced ${new Date(profile.lastSyncedAt).toLocaleDateString()}`}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowHandles(!showHandles)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all border bg-white dark:bg-night-700 text-surface-600 dark:text-night-200 border-surface-200 dark:border-night-600 hover:bg-surface-50 dark:hover:bg-night-600"
          >
            <Code size={16} /> Handles {filledCount > 0 && `(${filledCount})`}
            <ChevronDown size={14} className={`transition-transform ${showHandles ? 'rotate-180' : ''}`} />
          </button>
          <button
            onClick={handleShare}
            disabled={filledCount === 0}
            title="Download a 1200×630 PNG card for LinkedIn"
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all border bg-white dark:bg-night-700 text-surface-600 dark:text-night-200 border-surface-200 dark:border-night-600 hover:bg-surface-50 dark:hover:bg-night-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Share2 size={16} /> Share
          </button>
          <button
            onClick={handleSync}
            disabled={syncing || cooldownSec > 0 || filledCount === 0}
            aria-disabled={syncing || cooldownSec > 0 || filledCount === 0}
            title={cooldownSec > 0 && !syncing ? `Sync available in ${cooldownSec}s` : undefined}
            className="flex items-center gap-2.5 px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl shadow-sm hover:shadow-md transition-all text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center shrink-0">
              {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            </span>
            {syncing ? 'Syncing...' : cooldownSec > 0 ? `Sync in ${cooldownSec}s` : 'Sync Stats'}
          </button>
          {/* WHY: button label ticks every 1s; the polite live region announces
              the countdown to AT without adding any ring/border to layout. */}
          <span aria-live="polite" className="sr-only">
            {cooldownSec > 0 && !syncing ? `Sync available in ${cooldownSec} seconds` : ''}
          </span>
        </div>
      </motion.div>

      {/* ===== Sync freshness (upgrade 2) ===== */}
      {/* WHY: surface backend lastSyncError + per-platform TTL age instead of
          silently showing old stats. Single polite live region near Sync Stats
          so AT announces staleness once. Amber border badge only — no ring
          classes (no main-ring regression). Non-interactive (Sync button stays
          the retry action) so 44px targets are untouched. Fresh text uses
          #0a7a3a on light for contrast. */}
      {filledCount > 0 && isProfileStale && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-2 rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-800 dark:text-amber-300"
        >
          <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <p className="break-words">
            {lastSyncError ? (
              <>Stale - last error: {lastSyncError}{syncAgeLabel ? ` • updated ${syncAgeLabel}` : ''} — hit Sync Stats to retry.</>
            ) : (
              <>Stale • updated {syncAgeLabel ?? 'a while ago'} — hit Sync Stats for fresh data.</>
            )}
          </p>
        </div>
      )}
      {filledCount > 0 && !isProfileStale && syncAgeLabel && !lastSyncError && Object.keys(statsMap).length > 0 && (
        <p role="status" aria-live="polite" className="text-xs font-medium text-[#0a7a3a] dark:text-success-300">
          Updated {syncAgeLabel} • stats fresh
        </p>
      )}

      {/* ===== Collapsible Handles Editor ===== */}
      <AnimatePresence>
        {showHandles && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-surface-50 dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 p-6 space-y-5">
              {/* GitHub — powers green activity calendar */}
              <div className="rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-8 h-8 rounded-lg bg-surface-900 dark:bg-night-700 border border-transparent dark:border-night-600 flex items-center justify-center text-white dark:text-night-50 shrink-0">
                    <Github size={16} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-surface-900 dark:text-night-50 text-sm flex items-center gap-2">
                      GitHub — Activity Calendar
                      <span className="text-[10px] leading-none px-2 py-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/20 font-medium">Real contributions</span>
                    </h4>
                    <p className="text-xs text-surface-500 dark:text-night-300 mt-0.5">Link your GitHub to show <span className="font-medium text-surface-700 dark:text-night-200">real</span> green squares on your public profile and in the avatar dropdown. Leave empty to keep the deterministic calendar.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0 relative">
                    <input
                      type="text"
                      value={handles.githubUsername || ''}
                      onChange={(e) => {
                        const v = e.target.value
                        setHandles({ ...handles, githubUsername: v })
                        if (githubError) setGithubError(null)
                        if (githubValid !== null) setGithubValid(null)
                      }}
                      onBlur={() => {
                        const v = (handles.githubUsername || '').trim()
                        if (v && !isValidGithubUsername(v)) {
                          setGithubError('Invalid GitHub username (1-39 chars, letters/numbers/hyphens, cannot start/end with hyphen)')
                        } else {
                          setGithubError(null)
                        }
                      }}
                      placeholder="GitHub username (e.g., torvalds)"
                      className={`w-full px-3 py-2 border rounded-xl text-sm bg-white dark:bg-night-850 text-surface-900 dark:text-night-50 placeholder-surface-400 focus:outline-none focus:ring-2 pr-9 ${
                        githubError ? 'border-red-300 dark:border-red-500/50 focus:ring-red-500/30' : githubValid ? 'border-emerald-300 dark:border-emerald-500/40 focus:ring-emerald-500/30' : 'border-surface-200 dark:border-night-600 focus:ring-primary-500/30'
                      }`}
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
                      {githubChecking ? <Loader2 size={14} className="animate-spin text-surface-400 dark:text-night-400" /> : githubValid ? <CheckCircle2 size={14} className="text-emerald-500" /> : githubError ? <XCircle size={14} className="text-red-500" /> : null}
                    </span>
                  </div>
                  <button
                    onClick={handleGithubCheck}
                    disabled={githubChecking || !(handles.githubUsername || '').trim() || !!githubError}
                    className="px-3 py-2 rounded-xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-700 text-sm font-medium text-surface-700 dark:text-night-200 hover:bg-surface-100 dark:hover:bg-night-600 disabled:opacity-50 shrink-0"
                  >
                    {githubChecking ? 'Checking…' : 'Verify'}
                  </button>
                  {handles.githubUsername?.trim() && !githubError && (
                    <a
                      href={`https://github.com/${handles.githubUsername.trim()}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-500 hover:text-primary-600 dark:text-night-300 shrink-0"
                      title="Open GitHub profile"
                    >
                      <ExternalLink size={14} />
                    </a>
                  )}
                </div>
                {githubError ? (
                  <p className="mt-2 text-xs text-red-600 dark:text-red-400 flex items-center gap-1"><XCircle size={12}/>{githubError}</p>
                ) : githubValid ? (
                  <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><CheckCircle2 size={12}/> GitHub @{handles.githubUsername?.trim()} verified — your calendar will fetch real contributions.</p>
                ) : (
                  <p className="mt-2 text-xs text-surface-500 dark:text-night-300">
                    Your public calendar at <span className="font-mono">/u/{user?.username || 'username'}</span> will use this GitHub’s green squares. See <a href={handles.githubUsername?.trim() ? `https://github.com/${handles.githubUsername.trim()}` : 'https://github.com'} target="_blank" rel="noreferrer" className="text-primary-600 dark:text-success-300 hover:underline">github.com/{handles.githubUsername?.trim() || 'username'}</a>
                  </p>
                )}
              </div>

              <div>
                <h3 className="font-semibold text-surface-900 dark:text-night-50 mb-4">Platform Handles</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {platforms.map((p) => (
                    <div key={p.key} className="flex items-center gap-2">
                      <span className="w-6 flex justify-center shrink-0"><PlatformLogo platform={p.id} size={20} /></span>
                      <input
                        type="text"
                        value={handles[p.key] || ''}
                        onChange={(e) => setHandles({ ...handles, [p.key]: e.target.value })}
                        placeholder={`${p.label} username`}
                        className="flex-1 min-w-0 px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 rounded-xl text-sm text-surface-900 dark:text-night-50 placeholder-surface-400"
                      />
                      {handles[p.key] && (
                        <a href={`${p.url}${handles[p.key]}`} target="_blank" rel="noopener noreferrer"
                          className="p-1.5 text-surface-400 dark:text-night-400 hover:text-primary-500 shrink-0">
                          <ExternalLink size={14} />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <button onClick={handleSave} disabled={saving}
                className="px-5 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl hover:shadow-md transition-all text-sm font-medium disabled:opacity-50 flex items-center gap-2">
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                Save Handles
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== Tabs ===== */}
      <div className="flex gap-1 bg-surface-100 dark:bg-night-800 rounded-xl p-1 w-fit border border-transparent dark:border-night-600">
        {[
          { key: 'stats', label: 'My Stats', icon: BarChart3 },
          { key: 'history', label: 'Contest History', icon: Trophy },
          { key: 'leaderboard', label: 'College Leaderboard', icon: Medal },
          { key: 'problems', label: 'Problems', icon: ListChecks },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
              activeTab === tab.key
                ? 'bg-white dark:bg-night-700 text-primary-600 dark:text-success-300 shadow-sm border-transparent dark:border-night-600'
                : 'text-surface-500 dark:text-night-200 hover:text-surface-700 dark:hover:text-night-50 border-transparent hover:bg-white dark:hover:bg-night-700 hover:border-surface-200 dark:hover:border-night-600'
            }`}
          >
            <tab.icon size={16} /> {tab.label}
          </button>
        ))}
      </div>

      {/* ================= STATS TAB ================= */}
      {activeTab === 'stats' && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Problems Solved', value: totalSolved.toLocaleString(), sub: 'across all platforms', icon: Target, grad: 'from-emerald-400 to-teal-500' },
              { label: 'Contests', value: totalContests, sub: avgRank ? `avg rank #${avgRank}` : 'participated', icon: Trophy, grad: 'from-yellow-400 to-orange-500' },
              { label: 'Best Rating', value: bestRating || '—', sub: bestRating ? cfColor(bestRating) !== '#9CA3AF' ? 'peak performance' : '' : 'sync to update', icon: TrendingUp, grad: 'from-blue-400 to-indigo-500' },
              { label: 'Linked Platforms', value: `${Object.keys(statsMap).length}/${filledCount}`, sub: 'with live data', icon: Code, grad: 'from-purple-400 to-pink-500' },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07 }}
                className="bg-surface-50 dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 p-5"
              >
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${stat.grad} flex items-center justify-center text-white mb-3`}>
                  <stat.icon size={20} />
                </div>
                <p className="text-2xl font-bold text-surface-900 dark:text-night-50">{stat.value}</p>
                <p className="text-xs font-medium text-surface-600 dark:text-night-200">{stat.label}</p>
                {stat.sub && <p className="text-[10px] text-surface-400 dark:text-night-300 mt-0.5">{stat.sub}</p>}
              </motion.div>
            ))}
          </div>

          {/* Streak badges — COMBINED across enabled heatmap sources over the
              visible year range (contests + coding + git). See codingStreak.ts:
              per-source streaks intentionally not shown (one combined story). */}
          {filledCount > 0 && (
            <div className="grid grid-cols-2 gap-4" role="status" aria-label={`Current streak ${streaks.current} days, best streak ${streaks.longest} days`}>
              <div className="bg-surface-50 dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 p-5 flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center text-white shrink-0">
                  <Flame size={20} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-surface-900 dark:text-night-50">
                    {streaks.current} <span className="text-sm font-medium text-surface-500 dark:text-night-300">day{streaks.current === 1 ? '' : 's'}</span>
                  </p>
                  <p className="text-xs font-medium text-surface-600 dark:text-night-200">Current streak</p>
                </div>
              </div>
              <div className="bg-surface-50 dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 p-5 flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-yellow-500 flex items-center justify-center text-white shrink-0">
                  <Trophy size={20} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-surface-900 dark:text-night-50">
                    {streaks.longest} <span className="text-sm font-medium text-surface-500 dark:text-night-300">day{streaks.longest === 1 ? '' : 's'}</span>
                  </p>
                  <p className="text-xs font-medium text-surface-600 dark:text-night-200">
                    Best streak{streaks.totalActiveDays > 0 ? ` · ${streaks.totalActiveDays} active day${streaks.totalActiveDays === 1 ? '' : 's'}` : ''}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 6-month unified heatmap — contests + coding solves + git with
              per-source toggles + year filter (Last 6 months default / YYYY /
              All). Streaks above are combined across the enabled sources over
              the VISIBLE range (documented). CodeChef/HackerRank/GFG have no
              daily API: totals stay in cards, never faked here. */}
          {filledCount > 0 && (
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
          )}

          {/* Per-platform cards */}
          {Object.keys(statsMap).length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* ---- LeetCode ---- */}
              {statsMap.leetcode && (() => {
                const s = statsMap.leetcode
                return (
                  <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                    className="bg-surface-50 dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl bg-white dark:bg-night-850 border border-surface-200/50 dark:border-night-600 flex items-center justify-center">
                          <PlatformLogo platform="leetcode" size={26} />
                        </div>
                        <div>
                          <p className="font-bold text-surface-900 dark:text-night-50">LeetCode{isPlatformCardStale('leetcode') && (<span className="ml-2 inline-flex items-center rounded-full border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300">Stale</span>)}</p>
                          <a href={`https://leetcode.com/u/${s.handle}`} target="_blank" rel="noopener noreferrer" className="text-xs text-surface-400 dark:text-night-400 hover:text-primary-500 flex items-center gap-1">@{s.handle} <ExternalLink size={10} /></a>
                        </div>
                      </div>
                      {s.globalRank != null && (
                        <div className="text-right">
                          <p className="text-xs text-surface-400 dark:text-night-300">Global Rank</p>
                          <p className="font-bold text-surface-900 dark:text-night-50">#{(s.globalRank as number).toLocaleString()}</p>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-3xl font-extrabold text-surface-900 dark:text-night-50">{(s.problemsSolved ?? 0).toLocaleString()}</p>
                        <p className="text-xs text-surface-500 dark:text-night-300">problems solved</p>
                        {s.totalProblems != null && (
                          <p className="text-[10px] text-surface-400 dark:text-night-400 mt-1">
                            {(((s.problemsSolved ?? 0) / s.totalProblems) * 100).toFixed(1)}% of {s.totalProblems.toLocaleString()}
                          </p>
                        )}
                      </div>
                      <DifficultyBar stat={s} />
                    </div>
                  </motion.div>
                )
              })()}

              {/* ---- Codeforces ---- */}
              {statsMap.codeforces && (() => {
                const s = statsMap.codeforces
                const color = cfColor(s.rating)
                return (
                  <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                    className="bg-surface-50 dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl bg-white dark:bg-night-850 border border-surface-200/50 dark:border-night-600 flex items-center justify-center">
                          <PlatformLogo platform="codeforces" size={26} />
                        </div>
                        <div>
                          <p className="font-bold text-surface-900 dark:text-night-50">Codeforces{isPlatformCardStale('codeforces') && (<span className="ml-2 inline-flex items-center rounded-full border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300">Stale</span>)}</p>
                          <a href={`https://codeforces.com/profile/${s.handle}`} target="_blank" rel="noopener noreferrer" className="text-xs text-surface-400 dark:text-night-400 hover:text-primary-500 flex items-center gap-1">@{s.handle} <ExternalLink size={10} /></a>
                        </div>
                      </div>
                      {s.rankTitle && (
                        <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold text-white" style={{ backgroundColor: color }}>
                          {s.rankTitle}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <p className="text-3xl font-extrabold" style={{ color }}>{s.rating ?? '—'}</p>
                        <p className="text-xs text-surface-500 dark:text-night-300">current rating</p>
                      </div>
                      <div>
                        <p className="text-3xl font-extrabold text-surface-300 dark:text-night-600">{s.maxRating ?? '—'}</p>
                        <p className="text-xs text-surface-500 dark:text-night-300">max rating{s.maxRankTitle ? ` (${s.maxRankTitle})` : ''}</p>
                      </div>
                      <div className="space-y-1.5 pt-1">
                        <div className="flex items-baseline gap-1.5">
                          <p className="text-lg font-bold text-surface-900 dark:text-night-50">{(s.problemsSolved ?? 0).toLocaleString()}</p>
                          <span className="text-[10px] text-surface-400 dark:text-night-400">solved</span>
                        </div>
                        <div className="flex items-baseline gap-1.5">
                          <p className="text-lg font-bold text-surface-900 dark:text-night-50">{s.contestCount ?? '—'}</p>
                          <span className="text-[10px] text-surface-400 dark:text-night-400">contests</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )
              })()}

              {/* ---- CodeChef ---- */}
              {statsMap.codechef && (() => {
                const s = statsMap.codechef
                return (
                  <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                    className="bg-surface-50 dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl bg-white dark:bg-night-850 border border-surface-200/50 dark:border-night-600 flex items-center justify-center">
                          <PlatformLogo platform="codechef" size={26} />
                        </div>
                        <div>
                          <p className="font-bold text-surface-900 dark:text-night-50">CodeChef{isPlatformCardStale('codechef') && (<span className="ml-2 inline-flex items-center rounded-full border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300">Stale</span>)}</p>
                          <a href={`https://www.codechef.com/users/${s.handle}`} target="_blank" rel="noopener noreferrer" className="text-xs text-surface-400 dark:text-night-400 hover:text-primary-500 flex items-center gap-1">@{s.handle} <ExternalLink size={10} /></a>
                        </div>
                      </div>
                      {s.stars != null && (
                        <div className="flex items-center gap-1">
                          {Array.from({ length: s.stars }).map((_, i) => (
                            <Star key={i} size={16} fill={ccStarColor(s.stars!)} color={ccStarColor(s.stars!)} />
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <StatBox value={s.rating ?? '—'} label="rating" accent />
                      <StatBox value={(s.problemsSolved ?? 0).toLocaleString()} label="solved" />
                      <StatBox value={s.globalRank ? `#${s.globalRank.toLocaleString()}` : '—'} label="global rank" />
                      <StatBox value={s.division ?? '—'} label="division" />
                    </div>
                  </motion.div>
                )
              })()}

              {/* ---- GFG ---- */}
              {statsMap.gfg && (() => {
                const s = statsMap.gfg
                return (
                  <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                    className="bg-surface-50 dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl bg-white dark:bg-night-850 border border-surface-200/50 dark:border-night-600 flex items-center justify-center">
                          <PlatformLogo platform="gfg" size={26} />
                        </div>
                        <div>
                          <p className="font-bold text-surface-900 dark:text-night-50">GeeksforGeeks{isPlatformCardStale('gfg') && (<span className="ml-2 inline-flex items-center rounded-full border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300">Stale</span>)}</p>
                          <a href={`https://www.geeksforgeeks.org/user/${s.handle}/`} target="_blank" rel="noopener noreferrer" className="text-xs text-surface-400 dark:text-night-400 hover:text-primary-500 flex items-center gap-1">@{s.handle} <ExternalLink size={10} /></a>
                        </div>
                      </div>
                      {s.countryRank != null && s.countryRank > 0 && (
                        <div className="text-right">
                          <p className="text-xs text-surface-400 dark:text-night-300">Institute Rank</p>
                          <p className="font-bold text-surface-900 dark:text-night-50">#{s.countryRank}</p>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <StatBox value={(s.problemsSolved ?? 0).toLocaleString()} label="problems solved" />
                      <StatBox value={(s.score ?? 0).toLocaleString()} label="coding score" accent />
                    </div>
                  </motion.div>
                )
              })()}

              {/* ---- HackerRank ---- */}
              {statsMap.hackerrank && (() => {
                const s = statsMap.hackerrank
                return (
                  <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                    className="bg-surface-50 dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl bg-white dark:bg-night-850 border border-surface-200/50 dark:border-night-600 flex items-center justify-center">
                          <PlatformLogo platform="hackerrank" size={26} />
                        </div>
                        <div>
                          <p className="font-bold text-surface-900 dark:text-night-50">HackerRank{isPlatformCardStale('hackerrank') && (<span className="ml-2 inline-flex items-center rounded-full border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300">Stale</span>)}</p>
                          <a href={`https://www.hackerrank.com/profile/${s.handle}`} target="_blank" rel="noopener noreferrer" className="text-xs text-surface-400 dark:text-night-400 hover:text-primary-500 flex items-center gap-1">@{s.handle} <ExternalLink size={10} /></a>
                        </div>
                      </div>
                      {s.badges != null && (
                        <div className="flex items-center gap-1.5 text-surface-600 dark:text-night-200">
                          <Award size={18} />
                          <span className="text-lg font-bold">{s.badges}</span>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <StatBox value={(s.score ?? 0).toLocaleString()} label="total score" />
                      <StatBox value={s.badges ?? '—'} label="badges earned" accent />
                    </div>
                  </motion.div>
                )
              })()}
            </div>
          ) : filledCount > 0 ? (
            <div className="bg-primary-50 dark:bg-[rgba(0,168,143,0.06)] border border-primary-200 dark:border-[rgba(0,168,143,0.25)] rounded-2xl p-6 text-center">
              <RefreshCw className="mx-auto text-primary-500 dark:text-success-300 mb-2" size={28} />
              {/* Honest empty-stats: never-synced ("Handles saved — sync") vs
                  synced-but-invalid (handle 404 / transient — verify + retry).
                  WHY: prior copy always said "Handles saved — sync" even right
                  after a fresh sync (cooldown + "Updated just now"), hiding
                  invalid-handle/partial-fetch from the user. */}
              <p className="font-semibold text-surface-900 dark:text-night-50">
                {lastSyncError
                  ? `Sync failed — ${lastSyncError}`
                  : profile?.lastSyncedAt
                    ? 'Sync completed but no live data — verify handle then retry'
                    : 'Handles saved  —  sync to load your stats'}
              </p>
              <p className="text-sm text-surface-500 dark:text-night-300 mt-1">
                {profile?.lastSyncedAt && !lastSyncError
                  ? 'The handle returned no valid data (check spelling / privacy). Hit "Sync Stats" to retry.'
                  : 'Click "Sync Stats" above to pull problems solved, ratings and ranks.'}
              </p>
            </div>
          ) : (
            <div className="bg-surface-50 dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 p-12 text-center">
              <Code className="mx-auto text-surface-300 dark:text-night-700 mb-3" size={40} />
              <p className="text-surface-500 dark:text-night-300">Link your handles above to see problem counts, ratings and contest history here.</p>
            </div>
          )}
        </div>
      )}

      {/* ================= HISTORY TAB ================= */}
      {activeTab === 'history' && (
        <div className="space-y-3">
          {/* Platform filter chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-surface-500 dark:text-night-300 mr-1">
              <Filter size={13} /> Filter:
            </span>
            <button
              onClick={() => setHistoryFilter('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                historyFilter === 'all'
                  ? 'bg-primary-500 text-white shadow-md dark:bg-success-300 dark:text-night-950 border-transparent dark:border-success-300'
                  : 'bg-white dark:bg-night-700 text-surface-600 dark:text-night-200 border-surface-200 dark:border-night-600 hover:bg-surface-50 dark:hover:bg-night-600'
              }`}
            >
              All ({participations.length})
            </button>
            {platforms.map((p) => {
              const count = participations.filter(x => x.platform === p.id).length
              if (count === 0) return null
              return (
                <button
                  key={p.id}
                  onClick={() => setHistoryFilter(p.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                    historyFilter === p.id
                      ? 'bg-primary-500 text-white shadow-md dark:bg-success-300 dark:text-night-950 border-transparent dark:border-success-300'
                      : 'bg-white dark:bg-night-700 text-surface-600 dark:text-night-200 border-surface-200 dark:border-night-600 hover:bg-surface-50 dark:hover:bg-night-600'
                  }`}
                >
                  <PlatformLogo platform={p.id} size={12} /> {p.label} ({count})
                </button>
              )
            })}
          </div>

          <div className="bg-surface-50 dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 overflow-hidden">
          {filteredParticipations.length === 0 ? (
            <div className="p-12 text-center">
              <Trophy className="mx-auto text-surface-300 dark:text-night-700 mb-3" size={40} />
              <p className="text-surface-500 dark:text-night-300">No contests found{historyFilter !== 'all' ? ' for this platform' : ' yet. Add handles and hit Sync.'}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-200 dark:border-night-600">
                    <th className="text-left py-3 px-4 text-surface-500 dark:text-night-300 font-medium">Contest</th>
                    <th className="text-left py-3 px-4 text-surface-500 dark:text-night-300 font-medium">Platform</th>
                    <th className="text-center py-3 px-4 text-surface-500 dark:text-night-300 font-medium">Rank</th>
                    <th className="text-center py-3 px-4 text-surface-500 dark:text-night-300 font-medium">Rating</th>
                    <th className="text-center py-3 px-4 text-surface-500 dark:text-night-300 font-medium">Change</th>
                    <th className="text-right py-3 px-4 text-surface-500 dark:text-night-300 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredParticipations.slice(0, 50).map((p) => {
                    const pc = platformColors[p.platform] || { bg: 'bg-surface-50 dark:bg-night-800', text: 'text-surface-700 dark:text-night-300', border: 'border-surface-200 dark:border-night-600' }
                    return (
                      <tr key={p.id} className="border-b border-surface-100 dark:border-night-700 hover:bg-surface-100 dark:hover:bg-night-700 transition-colors dark:bg-[#1e1e1e]">
                        <td className="py-3 px-4">
                          <div className="font-medium text-surface-900 dark:text-night-50">{p.contestName}</div>
                          {p.contestUrl && (
                            <a href={p.contestUrl} target="_blank" rel="noopener noreferrer"
                              className="text-xs text-primary-500 hover:underline flex items-center gap-1">
                              View <ExternalLink size={10} />
                            </a>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${pc.bg} ${pc.text} border ${pc.border}`}>
                            {p.platform}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center font-medium text-surface-900 dark:text-night-50">
                          {p.rank ? `#${p.rank.toLocaleString()}` : '-'}
                        </td>
                        <td className="py-3 px-4 text-center font-semibold" style={{ color: cfColor(p.rating) }}>
                          {p.rating || '-'}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {p.ratingChange != null && p.ratingChange !== 0 ? (
                            <span className={p.ratingChange > 0 ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-red-500 font-medium'}>
                              {p.ratingChange > 0 ? '+' : ''}{p.ratingChange}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="py-3 px-4 text-right text-surface-500 dark:text-night-300">
                          {p.participatedAt ? new Date(p.participatedAt).toLocaleDateString() : '-'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          </div>
        </div>
      )}

      {/* ================= LEADERBOARD TAB ================= */}
      {activeTab === 'leaderboard' && (
        <div className="space-y-3">
          {/* Leaderboard filters */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs font-medium text-surface-500 dark:text-night-300">
              <Filter size={13} /> Filters:
            </span>

            {/* Platform select */}
            <select
              value={leaderboardPlatform}
              onChange={(e) => setLeaderboardPlatform(e.target.value)}
              className="px-3 py-2 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-sm text-surface-700 dark:text-night-200 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            >
              <option value="all">All Platforms</option>
              {platforms.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>

            {/* Department select */}
            <select
              value={leaderboardDept}
              onChange={(e) => setLeaderboardDept(e.target.value)}
              className="px-3 py-2 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-sm text-surface-700 dark:text-night-200 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            >
              <option value="all">All Departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          <div className="bg-surface-50 dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 overflow-hidden">
          {leaderboard.length === 0 ? (
            <div className="p-12 text-center">
              <Users className="mx-auto text-surface-300 dark:text-night-700 mb-3" size={40} />
              <p className="text-surface-500 dark:text-night-300">
                {leaderboardPlatform !== 'all' || leaderboardDept !== 'all'
                  ? 'No entries match the selected filters.'
                  : 'No leaderboard data yet.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-200 dark:border-night-600">
                    <th className="text-left py-3 px-4 text-surface-500 dark:text-night-300 font-medium w-14">#</th>
                    <th className="text-left py-3 px-4 text-surface-500 dark:text-night-300 font-medium">Student</th>
                    <th className="text-left py-3 px-4 text-surface-500 dark:text-night-300 font-medium">Department</th>
                    <th className="text-center py-3 px-4 text-surface-500 dark:text-night-300 font-medium">Contests</th>
                    <th className="text-center py-3 px-4 text-surface-500 dark:text-night-300 font-medium">Best Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.slice(0, 50).map((entry, i) => (
                    <tr key={entry.userId}
                      className={`border-b border-surface-100 dark:border-night-700 hover:bg-surface-100 dark:hover:bg-night-700 transition-colors ${
                        entry.userId === user?.id ? 'bg-primary-50/60 dark:bg-[rgba(0,168,143,0.07)]' : ''
                      }`}>
                      <td className="py-3 px-4">
                        <span className={`font-bold ${
                          i === 0 ? 'text-yellow-500' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-amber-600' : 'text-surface-400'
                        }`}>
                          {i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                            {entry.name?.charAt(0) || '?'}
                          </div>
                          <div>
                            <p className="font-medium text-surface-900 dark:text-night-50">{entry.name}</p>
                            {entry.userId === user?.id && (
                              <span className="text-[10px] text-primary-500 dark:text-success-300 font-medium">You</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-surface-500 dark:text-night-300">{entry.department || '-'}</td>
                      <td className="py-3 px-4 text-center font-medium text-surface-900 dark:text-night-50">{entry.totalContests}</td>
                      <td className="py-3 px-4 text-center font-semibold" style={{ color: cfColor(entry.bestRating) }}>
                        {entry.bestRating || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </div>
        </div>
      )}

      {/* ================= PROBLEMS TAB ================= */}
      {/* Problems-to-Solve MVP: Daily card + Recommended (difficulty-split
          heuristic from the user's real LC easy/med/hard) + Explore filters
          (topic/difficulty, URL-synced) + Solved/Star (localStorage v1).
          ≤2 backend calls per mount (daily + curated list, one round). */}
      {activeTab === 'problems' && (
        <ProblemsTab
          lcStat={
            statsMap.leetcode
              ? {
                  easySolved: statsMap.leetcode.easySolved,
                  mediumSolved: statsMap.leetcode.mediumSolved,
                  hardSolved: statsMap.leetcode.hardSolved,
                }
              : null
          }
        />
      )}

      {/* ===== First-time Prompt Modal ===== */}
      <AnimatePresence>
        {showProfilePrompt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 shadow-2xl max-w-md w-full p-8 text-center"
            >
              <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-warning-100 dark:bg-warning-900/30 flex items-center justify-center">
                <AlertTriangle className="text-warning-600 dark:text-warning-400" size={28} />
              </div>
              <h2 className="text-xl font-bold text-surface-900 dark:text-night-50 mb-2">Add Your Coding Profiles</h2>
              <p className="text-surface-500 dark:text-night-300 text-sm mb-6">
                Link at least one platform to track problems solved, ratings, contest history and compete on the college leaderboard.
              </p>
              <button
                onClick={() => { setShowProfilePrompt(false); setShowHandles(true) }}
                className="px-6 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-medium hover:shadow-md transition-all shadow-sm"
              >
                Add Profiles
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
