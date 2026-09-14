import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { qk } from '../lib/queryKeys'
import { notifyEntityMutated } from '../lib/entitySync'
import { useDebounce } from '../hooks/useDebounce'
import { useNavigate } from 'react-router-dom'
import {
  Trophy, Briefcase, ExternalLink, Users, CheckSquare, X, Download, Bell,
  BarChart2, Shield, Search, GraduationCap, Calendar, DoorOpen, ClipboardList,
  Target, Award, Settings, FolderOpen, ChevronDown, Loader2, CheckCircle2,
  RefreshCw, Sparkles, Building2, Clock, Edit3, IndianRupee, UserCheck,
  Globe, Zap, Code, Brain, Leaf, Heart, Star, Flame, Cpu
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import StatCard from '../components/shared/StatCard'
import Badge from '../components/ui/Badge'
import api, { hackathonAPI, internshipAPI, adminAPI } from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { parseJsonArray, parseJsonNumberArray } from '../lib/parseJson'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import AssignPopup from '../components/shared/AssignPopup'
import { PremiumHero, GlassPanel, BentoGrid, BentoCard, SectionCard } from '../components/premium/PremiumKit'
import CenteredLoader from '../components/ui/CenteredLoader'
import { useConfirm } from '../components/ui/ConfirmModal'
import { retryUnlessRateLimited } from '../lib/queryClient'

// ===== Theme tag colors =====
const THEME_COLORS: Record<string, { bg: string; text: string; icon: any }> = {
  'beginner friendly': { bg: 'bg-primary-50 border-primary-200', text: 'text-primary-700', icon: Star },
  'health': { bg: 'bg-danger-50 border-danger-200', text: 'text-danger-700', icon: Heart },
  'social good': { bg: 'bg-primary-50 border-primary-200', text: 'text-primary-700', icon: Shield },
  'ai': { bg: 'bg-primary-50 border-primary-200', text: 'text-primary-700', icon: Brain },
  'ml': { bg: 'bg-primary-50 border-primary-200', text: 'text-primary-700', icon: Brain },
  'machine learning': { bg: 'bg-primary-50 border-primary-200', text: 'text-primary-700', icon: Brain },
  'web3': { bg: 'bg-primary-50 border-primary-200', text: 'text-primary-700', icon: Cpu },
  'blockchain': { bg: 'bg-primary-50 border-primary-200', text: 'text-primary-700', icon: Cpu },
  'climate': { bg: 'bg-primary-50 border-primary-200', text: 'text-primary-700', icon: Leaf },
  'sustainability': { bg: 'bg-primary-50 border-primary-200', text: 'text-primary-700', icon: Leaf },
  'fintech': { bg: 'bg-yellow-50 border-yellow-200', text: 'text-yellow-700', icon: IndianRupee },
  'finance': { bg: 'bg-yellow-50 border-yellow-200', text: 'text-yellow-700', icon: IndianRupee },
  'cybersecurity': { bg: 'bg-danger-50 border-danger-200', text: 'text-danger-700', icon: Shield },
  'open innovation': { bg: 'bg-warning-50 border-warning-200', text: 'text-warning-700', icon: Zap },
  'hackathon': { bg: 'bg-warning-50 border-warning-200', text: 'text-warning-700', icon: Flame },
  'coding': { bg: 'bg-primary-50 border-primary-200', text: 'text-primary-700', icon: Code },
  'design': { bg: 'bg-primary-50 border-primary-200', text: 'text-primary-700', icon: Star },
  'open ended': { bg: 'bg-surface-50 border-surface-200', text: 'text-surface-600', icon: Target },
  'problem statement': { bg: 'bg-surface-50 border-surface-200', text: 'text-surface-600', icon: Target },
  'innovation': { bg: 'bg-warning-50 border-warning-200', text: 'text-warning-700', icon: Zap },
  'web development': { bg: 'bg-primary-50 border-primary-200', text: 'text-primary-700', icon: Code },
  'data science': { bg: 'bg-primary-50 border-primary-200', text: 'text-primary-700', icon: Brain },
  'python': { bg: 'bg-warning-50 border-warning-200', text: 'text-warning-700', icon: Code },
}

function getThemeColor(theme: string) {
  const key = theme.toLowerCase().trim()
  return THEME_COLORS[key] || { bg: 'bg-surface-50 border-surface-200', text: 'text-surface-600', icon: Target }
}

function getSourcePlatform(source: string): string {
  if (!source) return 'EXTERNAL'
  const s = source.toLowerCase()
  if (s.includes('devpost')) return 'DEVPOST'
  if (s.includes('unstop')) return 'UNSTOP'
  if (s.includes('internshala') || s.includes('internsthal')) return 'INTERNSTHAL'
  if (s.includes('devfolio')) return 'DEVFOLIO'
  if (s.includes('mlh')) return 'MLH'
  return source.toUpperCase()
}

function getPlatformBadgeVariant(platform: string): 'accent' | 'warning' | 'primary' | 'success' | 'danger' {
  switch (platform) {
    case 'DEVPOST': return 'accent'
    case 'UNSTOP': return 'warning'
    case 'INTERNSTHAL': return 'primary'
    case 'DEVFOLIO': return 'success'
    case 'MLH': return 'danger'
    default: return 'accent'
  }
}

const platformColors: Record<string, {
  bar: string
  iconBg: string
  iconText: string
  prizeBoxBg: string
  badge: string
}> = {
  DEVPOST:    { bar: 'bg-accent-500',    iconBg: 'bg-accent-50',    iconText: 'text-accent-600',    prizeBoxBg: 'bg-accent-50/60',   badge: 'accent' },
  UNSTOP:     { bar: 'bg-warning-500',   iconBg: 'bg-warning-50',   iconText: 'text-warning-600',   prizeBoxBg: 'bg-warning-50/60',  badge: 'warning' },
  INTERNSTHAL:{ bar: 'bg-primary-500',   iconBg: 'bg-primary-50',   iconText: 'text-primary-600',   prizeBoxBg: 'bg-primary-50/60',  badge: 'primary' },
  DEVFOLIO:   { bar: 'bg-success-500',   iconBg: 'bg-success-50',   iconText: 'text-success-600',   prizeBoxBg: 'bg-success-50/60',  badge: 'success' },
  MLH:        { bar: 'bg-danger-500',    iconBg: 'bg-danger-50',    iconText: 'text-danger-600',    prizeBoxBg: 'bg-danger-50/60',   badge: 'danger' },
}
const defaultPlatformColor = { bar: 'bg-primary-500', iconBg: 'bg-primary-50', iconText: 'text-primary-600', prizeBoxBg: 'bg-primary-50/60', badge: 'primary' }
function getPlatformColors(platform: string) {
  return platformColors[platform] || defaultPlatformColor
}

// ===== Types =====
type TabKey = 'all' | 'pending' | 'approved' | 'rejected'
type TypeFilter = 'all' | 'HACKATHON' | 'INTERNSHIP'

// ===== Component =====
export default function AdminOpportunitiesPage() {
  const { confirm: confirmDialog } = useConfirm()
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // Search is client-side over the staged page; debounce to avoid re-filter storms.
  const [searchInput, setSearchInput] = useState('')
  const searchQuery = useDebounce(searchInput, 250)
  const [fetchingNow, setFetchingNow] = useState(false)
  const [reEnriching, setReEnriching] = useState(false)
  // #4 source health: super-admin-only failing-source strip (Fetch Center owns the full dashboard).
  const [failingSources, setFailingSources] = useState<Array<{ platform: string; status: string }>>([])
  const [activeTab, setActiveTab] = useState<TabKey>('pending')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [teachers, setTeachers] = useState<any[]>([])
  const [editingItem, setEditingItem] = useState<any>(null)
  const [editType, setEditType] = useState<'HACKATHON' | 'INTERNSHIP'>('HACKATHON')

  // Extract max prize amount from prizePool text for compact card display
  const extractPrizeDisplay = (text: string): string => {
    if (!text) return ''
    const matches = text.match(/[₹$]\s*[\d,]+(?:\.\d+)?(?:\s*(?:lakh|lac|k|L|K|cr|Cr))?/gi) || []
    if (matches.length === 0) return text.length > 40 ? text.slice(0, 40) + '⬦' : text
    const amounts = matches.map(m => {
      let num = parseFloat(m.replace(/[₹$,]/g, '').trim())
      if (/lakh|lac/i.test(m)) num *= 100000
      else if (/cr/i.test(m)) num *= 10000000
      else if (/k/i.test(m)) num *= 1000
      return num
    }).filter(n => !isNaN(n) && n > 0)
    if (amounts.length === 0) return text.length > 40 ? text.slice(0, 40) + '⬦' : text
    const max = Math.max(...amounts)
    const total = amounts.length > 1 ? amounts.reduce((a, b) => a + b, 0) : null
    if (total && total !== max) return `₹${max.toLocaleString('en-IN')} / ₹${total.toLocaleString('en-IN')}`
    return `₹${max.toLocaleString('en-IN')}`
  }

  // Pagination state
  const [hackPage, setHackPage] = useState(() => parseInt(new URLSearchParams(window.location.search).get('hp') || '1'))
  const [intPage, setIntPage] = useState(() => parseInt(new URLSearchParams(window.location.search).get('ip') || '1'))

  // Assign popup state
  const [showAssignPopup, setShowAssignPopup] = useState(false)
  const [isBulkAssign, setIsBulkAssign] = useState(false)
  const [assigningItem, setAssigningItem] = useState<any>(null)
  const [assigningType, setAssigningType] = useState<'HACKATHON' | 'INTERNSHIP'>('HACKATHON')

  // Role gate
  const isAdmin = user?.role === 'TEACHER' || user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'

  // ===== Data loading — single cancellable query (Notion/GitHub pattern) =====
  // Derive status param from active tab for server-side filtering
  const statusParam = activeTab === 'pending' ? 'PENDING' : activeTab === 'approved' ? 'APPROVED' : activeTab === 'rejected' ? 'REJECTED' : undefined
  const PAGE_SIZE_INNER = 20

  // Single query for both staging lists: one AbortController (via useQuery
  // signal) cancels stale tab/page switches; keepPreviousData avoids flash.
  const {
    data: stagingData,
    isLoading: stagingLoading,
    isFetching: stagingFetching,
  } = useQuery({
    queryKey: qk.adminStaging(statusParam, hackPage, intPage),
    queryFn: async ({ signal }) => {
      const [hRes, iRes] = await Promise.all([
        hackathonAPI.getStaging(hackPage, PAGE_SIZE_INNER, statusParam, signal),
        internshipAPI.getStaging(intPage, PAGE_SIZE_INNER, statusParam, signal),
      ])
      return { hRes, iRes }
    },
    enabled: isAdmin,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    // 429 storm guard: never retry rate-limited staging (see queryClient).
    retry: retryUnlessRateLimited,
  })

  const parseRounds = (h: any) => {
    let rounds = 0
    if (h.schedule) {
      try {
        const parsed = JSON.parse(h.schedule)
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].roundNumber) {
          rounds = parsed.length
        }
      } catch {}
    }
    return { ...h, rounds }
  }
  const hackathons: any[] = ((stagingData as any)?.hRes?.data ?? []).map(parseRounds)
  const internships: any[] = (stagingData as any)?.iRes?.data ?? []
  const hackTotalPages: number = (stagingData as any)?.hRes?.pagination?.totalPages ?? 1
  const intTotalPages: number = (stagingData as any)?.iRes?.pagination?.totalPages ?? 1
  const loading = stagingLoading
  const refreshing = stagingFetching && !stagingLoading

  // Counts — separate light query, 60s live poll for enrichment progress.
  // PERF: was a 30s poll where each tick re-ran two full-table staging scans;
  // backend now serves these from a 60s shared cache, so poll at the same
  // cadence (HTTP-cheap + DB-free cache hits between recomputes).
  const { data: countsData } = useQuery({
    queryKey: qk.adminCounts(),
    queryFn: async ({ signal }) => {
      const [h, i] = await Promise.all([hackathonAPI.getCounts(signal), internshipAPI.getCounts(signal)])
      return { h, i }
    },
    enabled: isAdmin,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchInterval: 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    // 429 storm guard: 30s poll must not retry into the limiter.
    retry: retryUnlessRateLimited,
  })
  const counts = {
    hackTotal: (countsData as any)?.h?.total ?? 0,
    hackEnriched: (countsData as any)?.h?.enriched ?? 0,
    hackPending: (countsData as any)?.h?.pending ?? 0,
    hackApproved: (countsData as any)?.h?.approved ?? 0,
    hackRejected: (countsData as any)?.h?.rejected ?? 0,
    intTotal: (countsData as any)?.i?.total ?? 0,
    intEnriched: (countsData as any)?.i?.enriched ?? 0,
    intPending: (countsData as any)?.i?.pending ?? 0,
    intApproved: (countsData as any)?.i?.approved ?? 0,
    intRejected: (countsData as any)?.i?.rejected ?? 0,
  }

  const refreshStaging = async () => {
    notifyEntityMutated('hackathon')
    notifyEntityMutated('internship')
  }
  // Compat shims for handlers written before the useQuery migration.
  const loadCounts = () => { notifyEntityMutated('hackathon'); notifyEntityMutated('internship') }
  const loadHackathons = (_page?: number) => notifyEntityMutated('hackathon')
  const loadInternships = (_page?: number) => notifyEntityMutated('internship')

  // Reset pages to 1 when tab changes
  useEffect(() => {
    if (isAdmin) {
      setHackPage(1)
      setIntPage(1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusParam])

  // Sync both page params to URL in a single effect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    params.set('hp', String(hackPage))
    params.set('ip', String(intPage))
    window.history.replaceState(null, '', `?${params.toString()}`)
  }, [hackPage, intPage])

  // Load teachers once
  useEffect(() => {
    if (isAdmin) {
      adminAPI.getUsers()
        .then((users: any[]) => setTeachers(users.filter((u: any) => u.role === 'TEACHER')))
        .catch(() => setTeachers([]))
    }
  }, [isAdmin])

  // #4 source health strip: failing sources only, super-admin only
  // (/fetch/health is SUPER_ADMIN-gated; teachers never call it).
  useEffect(() => {
    if (!isSuperAdmin) return
    let cancelled = false
    api.get('/fetch/health')
      .then(({ data }: any) => {
        if (cancelled) return
        const failed = ((data?.health || []) as any[])
          .filter((h: any) => h?.status === 'DOWN' || h?.status === 'DEGRADED')
          .map((h: any) => ({ platform: String(h.platform), status: String(h.status) }))
        setFailingSources(failed)
      })
      .catch(() => { if (!cancelled) setFailingSources([]) })
    return () => { cancelled = true }
  }, [isSuperAdmin])

  // ===== Merge & filter =====
  const allItems = useMemo(() => {
    const items = [
      ...hackathons.map((h) => ({ ...h, _type: 'HACKATHON' as const })),
      ...internships.map((i) => ({ ...i, _type: 'INTERNSHIP' as const })),
    ]

    // Backend already filters by status  —  no client-side status filter needed

    // Type filter
    let filtered = items
    if (typeFilter !== 'all') {
      filtered = items.filter((i) => i._type === typeFilter)
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (i) =>
          i.title?.toLowerCase().includes(q) ||
          i.description?.toLowerCase().includes(q) ||
          i.company?.toLowerCase().includes(q) ||
          i.organizer?.toLowerCase().includes(q) ||
          i.name?.toLowerCase().includes(q)
      )
    }

    return filtered
  }, [hackathons, internships, typeFilter, searchQuery, activeTab])

  // ===== Stats (from DB counts, not paginated data) =====
  const stats = useMemo(() => {
    const totalPending = counts.hackPending + counts.intPending
    const totalEnriched = counts.hackEnriched + counts.intEnriched
    const totalUnenriched = Math.max(0, totalPending - totalEnriched)
    return {
      total: totalPending,
      hackathons: counts.hackPending,
      internships: counts.intPending,
      withDepts: totalEnriched,
      unenriched: totalUnenriched,
    }
  }, [counts])

  // Tab counts for badges  —  all from API counts (not paginated data)
  const tabCounts = useMemo(() => {
    const all = counts.hackEnriched + counts.intEnriched
    const pending = counts.hackPending + counts.intPending
    const approved = counts.hackApproved + counts.intApproved
    const rejected = counts.hackRejected + counts.intRejected
    return { all, pending, approved, rejected }
  }, [counts])

  // ===== Handlers =====
  const handleFetchNow = async () => {
    setFetchingNow(true)
    try {
      const [hRes, iRes] = await Promise.all([hackathonAPI.fetchExternal(), internshipAPI.fetchExternal()])
      const fetched = (hRes.fetched || 0) + (iRes.fetched || 0)
      const skipped = (hRes.skipped || 0) + (iRes.skipped || 0)
      toast.success(`Fetched ${fetched} new opportunities! (${skipped} skipped)`)
      // Poll for enrichment to complete — single invalidated query (abort-safe)
      let attempts = 0
      const poll = async () => {
        await refreshStaging()
        attempts++
        if (attempts < 10) setTimeout(poll, 5000)
      }
      poll()
    } catch {
      toast.error('Failed to fetch opportunities')
    } finally {
      setFetchingNow(false)
    }
  }

  const handleReEnrich = async () => {
    setReEnriching(true)
    try {
      const [hRes, iRes] = await Promise.all([hackathonAPI.reEnrich(), internshipAPI.reEnrich()])
      const total = (hRes.total || 0) + (iRes.total || 0)
      if (total === 0) {
        toast.success('All items already enriched!')
      } else {
        toast.success(`Enriching ${total} items in background...`)
      }
      // Poll for enrichment to complete
      let attempts = 0
      const poll = async () => {
        await refreshStaging()
        attempts++
        if (attempts < 15) setTimeout(poll, 5000)
      }
      poll()
    } catch {
      toast.error('Failed to start re-enrichment')
    } finally {
      setReEnriching(false)
    }
  }

  const handleApprove = async (id: string, type: 'HACKATHON' | 'INTERNSHIP') => {
    const ok = await confirmDialog({ title: 'Approve opportunity?', message: 'Approve this opportunity? It becomes visible to eligible students.', confirmLabel: 'Approve', danger: false })
    if (!ok) return
    try {
      if (type === 'HACKATHON') {
        await hackathonAPI.approveStaging(id)
      } else {
        await internshipAPI.approveStaging(id)
      }
      toast.success('Approved!')
      await refreshStaging()
    } catch {
      toast.error('Failed to approve')
    }
  }

  const handleDelete = async (id: string, type: 'HACKATHON' | 'INTERNSHIP') => {
    const ok = await confirmDialog({ title: 'Delete opportunity?', message: 'Delete this opportunity? This cannot be undone.', confirmLabel: 'Delete' })
    if (!ok) return
    try {
      if (type === 'HACKATHON') {
        await hackathonAPI.deleteStaging(id)
      } else {
        await internshipAPI.deleteStaging(id)
      }
      toast.success('Deleted!')
      await refreshStaging()
    } catch {
      toast.error('Failed to delete')
    }
  }

  const handleReject = async (id: string, type: 'HACKATHON' | 'INTERNSHIP') => {
    const ok = await confirmDialog({ title: 'Reject opportunity?', message: 'Reject this opportunity? The submitter will see the rejected status.', confirmLabel: 'Reject' })
    if (!ok) return
    try {
      if (type === 'HACKATHON') {
        await hackathonAPI.rejectStaging(id)
      } else {
        await internshipAPI.rejectStaging(id)
      }
      toast.success('Rejected')
      await refreshStaging()
    } catch {
      toast.error('Failed to reject')
    }
  }

  const openEdit = (item: any, type: 'HACKATHON' | 'INTERNSHIP') => {
    setEditingItem({ ...item })
    setEditType(type)
  }

  const handleEditSave = async () => {
    if (!editingItem) return
    try {
      const data = {
        title: editingItem.title || editingItem.name,
        description: editingItem.description,
        mode: editingItem.mode,
        organizer: editingItem.organizer,
        company: editingItem.company,
        role: editingItem.role,
        prizePool: editingItem.prizePool,
        stipend: editingItem.stipend,
        duration: editingItem.duration,
        targetDepartments: typeof editingItem.targetDepartments === 'string'
          ? editingItem.targetDepartments.split(',').map((s: string) => s.trim()).filter(Boolean)
          : editingItem.targetDepartments,
        targetYears: typeof editingItem.targetYears === 'string'
          ? editingItem.targetYears.split(',').map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n))
          : editingItem.targetYears,
        themes: typeof editingItem.themes === 'string'
          ? editingItem.themes.split(',').map((s: string) => s.trim()).filter(Boolean)
          : editingItem.themes,
      }
      if (editType === 'HACKATHON') {
        await hackathonAPI.updateStaging(editingItem.id, data)
      } else {
        await internshipAPI.updateStaging(editingItem.id, data)
      }
      toast.success('Updated!')
      setEditingItem(null)
      await refreshStaging()
    } catch {
      toast.error('Failed to update')
    }
  }

  const openAssign = (item: any, type: 'HACKATHON' | 'INTERNSHIP') => {
    setAssigningItem(item)
    setAssigningType(type)
    setShowAssignPopup(true)
  }

  const handleAssign = async (teacherId: string) => {
    if (!assigningItem) return
    try {
      if (assigningType === 'HACKATHON') {
        await api.post(`/hackathons/staging/${assigningItem.id}/assign`, { teacherId })
      } else {
        await api.post(`/internships/staging/${assigningItem.id}/assign`, { teacherId })
      }
      toast.success('Assigned!')
      setShowAssignPopup(false)
      await refreshStaging()
    } catch {
      toast.error('Failed to assign')
    }
  }

  const handleBulkAssign = async (teacherId: string) => {
    try {
      const pendingHacks = hackathons.filter(h => h.status !== 'APPROVED' && h.status !== 'REJECTED')
      const pendingInts = internships.filter(i => i.status !== 'APPROVED' && i.status !== 'REJECTED')
      let assigned = 0
      for (const h of pendingHacks) {
        await api.post(`/hackathons/staging/${h.id}/assign`, { teacherId })
        assigned++
      }
      for (const i of pendingInts) {
        await api.post(`/internships/staging/${i.id}/assign`, { teacherId })
        assigned++
      }
      toast.success(`Assigned teacher to ${assigned} pending items`)
      setShowAssignPopup(false)
      await refreshStaging()
    } catch {
      toast.error('Failed to assign')
    }
  }

  // ===== Role gate =====
  if (!isAdmin) {
    return (
    <div className="min-h-screen bg-surface-50 dark:bg-night-800 to-primary-50/30 dark:from-night-950 dark:via-night-950 dark:to-night-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <Shield size={48} className="mx-auto text-surface-300 mb-4" />
              <h2 className="text-xl font-bold text-surface-900 dark:text-night-50">Access Denied</h2>
              <p className="text-surface-500 dark:text-night-400 mt-1">You don't have permission to view this page.</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ===== Render =====
  const tabs = [
    { key: 'all' as TabKey, label: 'All', count: tabCounts.all },
    { key: 'pending' as TabKey, label: 'Pending', count: tabCounts.pending },
    { key: 'approved' as TabKey, label: 'Approved', count: tabCounts.approved },
    { key: 'rejected' as TabKey, label: 'Rejected', count: tabCounts.rejected },
  ]

  return (
    <div className="space-y-6 max-w-[1280px] mx-auto">
      {/* ─── Premium Dark Hero — bento 12-col, glass, Brand green ─── */}
      <PremiumHero
        icon={<Trophy size={18} />}
        eyebrow="Admin · Opportunities"
        title={<>Opportunities</>}
        subtitle="Admin — hackathons, internships and contests management."
      />
      {/* premium tokens: bg-[#0a0a0a] rounded-[32px] backdrop-blur-xl bg-white/[0.03] border-white/10 grid-cols-12 #1ed760 */}
      <div className="hidden rounded-[32px] bg-[#0a0a0a] backdrop-blur-xl bg-white/[0.03] border border-white/10 grid-cols-12" />
        {/*  —  Page Header  —  */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-surface-900 dark:text-night-50">Opportunities</h1>
            <p className="text-surface-500 dark:text-night-400 mt-1">Review and manage opportunities across your campus.</p>
          </div>
        </div>

        {/*  —  Stats Row  — */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard
            label="Total Opportunities"
            value={counts.hackTotal + counts.intTotal}
            icon={BarChart2}
            color="bg-primary-600"
            bg="bg-primary-100"
            loading={loading}
          />
          <StatCard
            label="Pending Review"
            value={counts.hackPending + counts.intPending}
            icon={Clock}
            color="from-warning-500 to-warning-600"
            bg="bg-warning-100"
            loading={loading}
          />
          <StatCard
            label="Approved"
            value={counts.hackApproved + counts.intApproved}
            icon={Shield}
            color="from-success-500 to-success-600"
            bg="bg-success-100"
            loading={loading}
          />
          <StatCard
            label="Rejected"
            value={counts.hackRejected + counts.intRejected}
            icon={ClipboardList}
            color="from-danger-500 to-danger-600"
            bg="bg-danger-100"
            loading={loading}
          />
        </div>

        {/*  —  Content  —  */}
        <div>
          {/* Filter Tabs */}
            <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-4 mb-4 shadow-sm">
              <div className="flex items-center gap-2 flex-wrap">
                {tabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={clsx(
                      'px-4 py-2 rounded-xl text-sm font-medium transition-all',
                      activeTab === tab.key
                        ? 'bg-primary-500 text-white shadow-sm'
                        : 'bg-surface-100 text-surface-600 hover:bg-surface-200'
                    )}
                  >
                    {tab.label}
                    {tab.count > 0 && (
                      <span className={clsx(
                        'ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold',
                        activeTab === tab.key
                          ? 'bg-white dark:bg-night-800 text-primary-600'
                          : 'bg-surface-200 text-surface-500'
                      )}>
                        {tab.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Filter Row */}
              <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-surface-100 dark:border-night-600">
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
                  className="px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="all">All Types</option>
                  <option value="HACKATHON">Hackathons</option>
                  <option value="INTERNSHIP">Internships</option>
                </select>
                <div className="relative flex-1 min-w-[200px]">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 dark:text-night-400" />
                  <input
                    type="text"
                    placeholder="Search opportunities..."
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <button
                  onClick={() => { setIsBulkAssign(true); setShowAssignPopup(true) }}
                  className="flex items-center gap-2 px-4 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm text-surface-600 dark:text-night-300 hover:bg-surface-50 dark:hover:bg-night-700 dark:bg-night-800 transition-colors"
                >
                  <Users size={16} /> Assign Reviewer
                </button>
                {/* Fetch Now - Super Admin only */}
                {isSuperAdmin && (
                  <button
                    onClick={handleFetchNow}
                    disabled={fetchingNow}
                    className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-xl text-sm font-medium hover:bg-primary-600 transition-all disabled:opacity-50 shadow-sm"
                  >
                    {fetchingNow ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    {fetchingNow ? 'Fetching...' : 'Fetch Now'}
                  </button>
                )}
                {isSuperAdmin && (
                  <button
                    onClick={handleReEnrich}
                    disabled={reEnriching}
                    className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-xl text-sm font-medium hover:bg-primary-600 transition-all disabled:opacity-50 shadow-sm"
                  >
                    {reEnriching ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    {reEnriching ? 'Enriching...' : 'Re-Enrich'}
                  </button>
                )}
                {isSuperAdmin && stats.unenriched > 0 && (
                  <span className="text-xs text-warning-600 bg-warning-50 px-2.5 py-1 rounded-lg border border-warning-200">
                    {stats.unenriched} items need enrichment
                  </span>
                )}
                {isSuperAdmin && failingSources.length > 0 && (
                  <button
                    onClick={() => navigate('/admin/fetch')}
                    title={`Failing sources: ${failingSources.map((f) => `${f.platform} (${f.status})`).join(', ')}`}
                    className="text-xs font-semibold text-danger-600 bg-danger-50 px-2.5 py-1 rounded-lg border border-danger-200 hover:bg-danger-100 transition-colors"
                  >
                    ⚠ {failingSources.length} source{failingSources.length > 1 ? 's' : ''} failing — review in Fetch Center
                  </button>
                )}
              </div>
            </div>

            {/* Opportunity Cards — keepPreviousData keeps stale list visible while refetching */}
            {loading ? (
              <CenteredLoader text="Loading opportunities..." minHeight="min-h-[320px]" />
            ) : allItems.length === 0 ? (
              <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-12 text-center">
                <ClipboardList size={48} className="mx-auto text-surface-300 mb-4" />
                <h3 className="text-lg font-semibold text-surface-900 dark:text-night-50">No opportunities found</h3>
                <p className="text-surface-500 dark:text-night-400 mt-1">
                  {searchInput || typeFilter !== 'all' ? 'Try adjusting your filters' : 'No pending items to review'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {refreshing && (
                  <p className="text-xs text-surface-400 dark:text-night-400 flex items-center gap-1.5" aria-live="polite">
                    <span className="w-3 h-3 border-2 border-primary-500 border-t-transparent rounded-full animate-spin inline-block" aria-hidden="true" />
                    Updating…
                  </p>
                )}
                <AnimatePresence>
                  {allItems.map((item, idx) => {
                    const departments = parseJsonArray(item.targetDepartments)
                    const themes = parseJsonArray(item.themes)
                    const isHackathon = item._type === 'HACKATHON'
                    const assignedTeacher = item.assignedTeacherId
                      ? teachers.find((t: any) => t.id === item.assignedTeacherId)
                      : null
                    const platform = getSourcePlatform(item.source)
                    const mode = item.mode?.toLowerCase() || 'offline'
                    const pc = getPlatformColors(platform)

                    return (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ delay: idx * 0.03 }}
                        className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 overflow-hidden hover:shadow-lg transition-all group"
                      >
                        <div className="flex">
                          {/* Left accent bar */}
                          <div className={`w-1 ${pc.bar}`} />

                          {/* Icon */}
                          <div className="p-5 flex-shrink-0">
                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${pc.iconBg} ${pc.iconText}`}>
                              {isHackathon ? <Trophy size={24} /> : <Briefcase size={24} />}
                            </div>
                          </div>

                          {/* Content */}
                          <div className="flex-1 p-5 min-w-0">
                            <div className="flex gap-5">
                              {/* Left: Main content */}
                              <div className="flex-1 min-w-0">
                                {/* Badges row */}
                                <div className="flex items-center gap-2 mb-2">
                                  <Badge variant={pc.badge as any}>{item._type}</Badge>
                                  <Badge variant={pc.badge as any}>{platform}</Badge>
                                  <Badge variant={mode === 'online' ? 'success' : 'danger'} dot>
                                    {mode === 'online' ? 'Online' : mode === 'hybrid' ? 'Hybrid' : 'Offline'}
                                  </Badge>
                                  {item.aiExtracted && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-primary-50 text-primary-600 border border-primary-200">
                                      <Sparkles size={10} /> AI Enriched
                                    </span>
                                  )}
                                </div>

                                {/* Title */}
                                <div className="flex items-center gap-2 mb-2">
                                  <h3 className="text-lg font-bold text-surface-900 dark:text-night-50">
                                    <a
                                      href={item.url || item.registrationUrl || '#'}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="hover:text-primary-600 transition-colors"
                                    >
                                      {item.title || item.name}
                                    </a>
                                  </h3>
                                  <a
                                    href={item.url || item.registrationUrl || '#'}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <ExternalLink size={14} className="text-surface-400 dark:text-night-400 hover:text-primary-500" />
                                  </a>
                                </div>

                                {/* Organizer / Company */}
                                {(item.organizer || item.company) && (
                                  <p className="text-sm text-surface-500 dark:text-night-400 mb-2 flex items-center gap-1.5">
                                    <Building2 size={13} className="text-surface-400 dark:text-night-400" />
                                    <span className="font-medium text-surface-600 dark:text-night-300">{item.organizer || item.company}</span>
                                  </p>
                                )}

                                {/* Description */}
                                {item.description && (
                                  <p className="text-surface-500 dark:text-night-400 text-sm mb-3 line-clamp-2">{item.description}</p>
                                )}

                                {/* Tags */}
                                {themes.length > 0 && (
                                  <div className="flex flex-wrap gap-2 mb-3">
                                    {themes.map((tag: string) => (
                                      <span key={tag} className="px-2.5 py-1 bg-surface-200 text-surface-700 dark:text-night-200 text-xs rounded-md border border-surface-300 dark:border-night-600 dark:bg-[#282828]">{tag}</span>
                                    ))}
                                  </div>
                                )}

                                {/* Departments */}
                                {departments.length > 0 && (
                                  <div className="flex items-center gap-2 mb-3">
                                    <span className="text-xs text-surface-400 dark:text-night-400">Eligible Departments:</span>
                                    <div className="flex flex-wrap gap-1">
                                      {departments.map((dept: string) => (
                                        <span key={dept} className="px-2.5 py-0.5 bg-surface-200 text-surface-700 dark:text-night-200 text-xs rounded-md border border-surface-300 dark:border-night-600 dark:bg-[#282828]">{dept}</span>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Years */}
                                {(() => {
                                  const years = parseJsonArray(item.targetYears).map(Number).filter(n => !isNaN(n))
                                  return years.length > 0 && (
                                    <div className="flex items-center gap-2 mb-3">
                                      <span className="text-xs text-surface-400 dark:text-night-400">Eligible Years:</span>
                                      <div className="flex flex-wrap gap-1">
                                        {years.map((yr: number) => (
                                          <span key={yr} className="px-2.5 py-0.5 bg-surface-200 text-surface-700 dark:text-night-200 text-xs rounded-md border border-surface-300 dark:border-night-600 dark:bg-[#282828]">{yr}{yr === 1 ? 'st' : yr === 2 ? 'nd' : yr === 3 ? 'rd' : 'th'} Year</span>
                                        ))}
                                      </div>
                                    </div>
                                  )
                                })()}

                                {/* Assigned teacher */}
                                {assignedTeacher && (
                                  <div className="flex items-center gap-1.5 mb-3">
                                    <UserCheck size={12} className="text-primary-500" />
                                    <span className="text-xs text-primary-600 font-medium">Assigned to {assignedTeacher.name}</span>
                                  </div>
                                )}
                              </div>

                              {/* Right: Prize + Deadline box */}
                              {((item.prizePool || item.stipend) || item.deadline || item.duration || (isHackathon && item.rounds)) && (
                                <div className={`flex-shrink-0 w-64 rounded-xl p-5 space-y-3 dark:bg-night-800 dark:border-night-600 ${pc.prizeBoxBg}`}>
                                  {(item.prizePool || item.stipend) && (
                                    <div>
                                      <p className={`text-2xl font-bold dark:text-success-200 ${pc.iconText}`}>{item.stipend || extractPrizeDisplay(item.prizePool || '')}</p>
                                      <p className="text-xs text-surface-400 dark:text-night-300">{item.prizePool ? 'Prize Pool' : 'Stipend'}</p>
                                    </div>
                                  )}
                                  {isHackathon && item.rounds && (
                                    <div>
                                      <p className="text-sm font-semibold text-surface-700 dark:text-night-200">{item.rounds} {item.rounds === 1 ? 'Round' : 'Rounds'}</p>
                                    </div>
                                  )}
                                  {item.deadline && (
                                    <div>
                                      <p className="text-xs text-surface-400 dark:text-night-300">
                                        Deadline: {new Date(item.deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                      </p>
                                    </div>
                                  )}
                                  {item.duration && !item.deadline && (
                                    <div>
                                      <p className="text-sm font-semibold text-surface-700 dark:text-night-200">{item.duration}</p>
                                      <p className="text-xs text-surface-400 dark:text-night-300">Duration</p>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Bottom: Actions */}
                            <div className="flex items-center justify-end pt-3 border-t border-surface-100 dark:border-night-600">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => openEdit(item, item._type)}
                                  className="px-4 py-2 text-sm font-medium text-surface-600 dark:text-night-300 hover:bg-surface-50 dark:hover:bg-night-700 dark:bg-night-800 rounded-xl transition-colors"
                                >
                                  View Details
                                </button>
                                <button
                                  onClick={() => handleReject(item.id, item._type)}
                                  className="px-4 py-2 text-sm font-medium text-danger-600 border border-danger-200 hover:bg-danger-50 rounded-xl transition-colors"
                                >
                                  Reject
                                </button>
                                <button
                                  onClick={() => handleApprove(item.id, item._type)}
                                  className="px-4 py-2 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 rounded-xl transition-colors"
                                >
                                  Approve
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              </div>
            )}

            {/*  —  Pagination  —  */}
            {!loading && allItems.length > 0 && (() => {
              const isUnified = typeFilter === 'all'
              const currentPage = isUnified ? Math.max(hackPage, intPage) : (typeFilter === 'INTERNSHIP' ? intPage : hackPage)
              const totalPages = isUnified ? Math.max(hackTotalPages, intTotalPages) : (typeFilter === 'INTERNSHIP' ? intTotalPages : hackTotalPages)
              const setPage = (p: number | ((prev: number) => number)) => {
                if (isUnified) {
                  setHackPage(p)
                  setIntPage(p)
                } else if (typeFilter === 'INTERNSHIP') {
                  setIntPage(p)
                } else {
                  setHackPage(p)
                }
              }
              const pages: (number | string)[] = []
              if (totalPages <= 7) {
                for (let i = 1; i <= totalPages; i++) pages.push(i)
              } else {
                pages.push(1)
                if (currentPage > 3) pages.push('...')
                for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
                  pages.push(i)
                }
                if (currentPage < totalPages - 2) pages.push('...')
                pages.push(totalPages)
              }
              return (
                <div className="flex items-center justify-center gap-1.5 py-4 mt-4">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                    className="px-3 py-1.5 text-sm font-medium text-surface-600 dark:text-night-300 bg-surface-100 dark:bg-night-700 rounded-lg hover:bg-surface-200 transition-all disabled:opacity-40"
                  >
                    Prev
                  </button>
                  {pages.map((p, i) =>
                    p === '...' ? (
                      <span key={`dots-${i}`} className="px-2 py-1.5 text-sm text-surface-400 dark:text-night-400">...</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setPage(p as number)}
                        className={`w-9 h-9 rounded-lg text-sm font-medium transition-all ${
                          currentPage === p
                            ? 'bg-primary-500 text-white shadow-sm'
                            : 'text-surface-600 bg-surface-100 hover:bg-surface-200'
                        }`}
                      >
                        {p}
                      </button>
                    )
                  )}
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                    className="px-3 py-1.5 text-sm font-medium text-surface-600 dark:text-night-300 bg-surface-100 dark:bg-night-700 rounded-lg hover:bg-surface-200 transition-all disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              )
            })()}
      </div>

      {/*  —  Edit Modal  —  */}
      <AnimatePresence>
        {editingItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setEditingItem(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white dark:bg-night-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-surface-100 dark:border-night-600 sticky top-0 bg-white dark:bg-night-800 rounded-t-2xl z-10">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-primary-100 flex items-center justify-center">
                    <Edit3 size={18} className="text-primary-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-surface-900 dark:text-night-50 text-sm">Edit {editType === 'HACKATHON' ? 'Hackathon' : 'Internship'}</h3>
                    <p className="text-xs text-surface-400 dark:text-night-400 truncate max-w-[220px]">{editingItem.title || editingItem.name}</p>
                  </div>
                </div>
                <button
                  onClick={() => setEditingItem(null)}
                  className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-night-700 text-surface-400 dark:text-night-400 transition-colors dark:bg-[#1e1e1e]"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-surface-600 dark:text-night-300 mb-1">Title</label>
                  <input
                    type="text"
                    value={editingItem.title || editingItem.name || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, title: e.target.value, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 text-sm text-surface-900 dark:text-night-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-surface-600 dark:text-night-300 mb-1">Description</label>
                  <textarea
                    rows={3}
                    value={editingItem.description || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 text-sm text-surface-900 dark:text-night-50 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-surface-600 dark:text-night-300 mb-1">Mode</label>
                  <select
                    value={(editingItem.mode || 'OFFLINE').toUpperCase()}
                    onChange={(e) => setEditingItem({ ...editingItem, mode: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 text-sm text-surface-900 dark:text-night-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="OFFLINE">Offline</option>
                    <option value="ONLINE">Online</option>
                    <option value="HYBRID">Hybrid</option>
                  </select>
                </div>

                {editType === 'HACKATHON' ? (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-surface-600 dark:text-night-300 mb-1">Organizer</label>
                      <input
                        type="text"
                        value={editingItem.organizer || ''}
                        onChange={(e) => setEditingItem({ ...editingItem, organizer: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 text-sm text-surface-900 dark:text-night-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-surface-600 dark:text-night-300 mb-1">Prize Pool</label>
                      <input
                        type="text"
                        value={editingItem.prizePool || ''}
                        onChange={(e) => setEditingItem({ ...editingItem, prizePool: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 text-sm text-surface-900 dark:text-night-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-surface-600 dark:text-night-300 mb-1">Themes</label>
                      <input
                        type="text"
                        value={
                          Array.isArray(editingItem.themes)
                            ? editingItem.themes.join(', ')
                            : (() => { try { return JSON.parse(editingItem.themes || '[]').join(', ') } catch { return editingItem.themes || '' } })()
                        }
                        onChange={(e) => setEditingItem({ ...editingItem, themes: e.target.value })}
                        placeholder="Comma-separated themes"
                        className="w-full px-3 py-2 rounded-xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 text-sm text-surface-900 dark:text-night-50 placeholder:text-[#6b7280] dark:placeholder:text-night-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-surface-600 dark:text-night-300 mb-1">Company</label>
                      <input
                        type="text"
                        value={editingItem.company || ''}
                        onChange={(e) => setEditingItem({ ...editingItem, company: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 text-sm text-surface-900 dark:text-night-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-surface-600 dark:text-night-300 mb-1">Role</label>
                      <input
                        type="text"
                        value={editingItem.role || ''}
                        onChange={(e) => setEditingItem({ ...editingItem, role: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 text-sm text-surface-900 dark:text-night-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-surface-600 dark:text-night-300 mb-1">Stipend</label>
                      <input
                        type="text"
                        value={editingItem.stipend || ''}
                        onChange={(e) => setEditingItem({ ...editingItem, stipend: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 text-sm text-surface-900 dark:text-night-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-xs font-medium text-surface-600 dark:text-night-300 mb-1">Duration</label>
                  <input
                    type="text"
                    value={editingItem.duration || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, duration: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 text-sm text-surface-900 dark:text-night-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-surface-600 dark:text-night-300 mb-1">Target Departments</label>
                  <input
                    type="text"
                    value={
                      Array.isArray(editingItem.targetDepartments)
                        ? editingItem.targetDepartments.join(', ')
                        : editingItem.targetDepartments || ''
                    }
                    onChange={(e) => setEditingItem({ ...editingItem, targetDepartments: e.target.value })}
                    placeholder="Comma-separated departments"
                    className="w-full px-3 py-2 rounded-xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 text-sm text-surface-900 dark:text-night-50 placeholder:text-[#6b7280] dark:placeholder:text-night-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-surface-600 dark:text-night-300 mb-1">Target Years</label>
                  <input
                    type="text"
                    value={
                      Array.isArray(editingItem.targetYears)
                        ? editingItem.targetYears.join(', ')
                        : editingItem.targetYears || ''
                    }
                    onChange={(e) => setEditingItem({ ...editingItem, targetYears: e.target.value })}
                    placeholder="Comma-separated years (e.g. 1, 2, 3, 4)"
                    className="w-full px-3 py-2 rounded-xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 text-sm text-surface-900 dark:text-night-50 placeholder:text-[#6b7280] dark:placeholder:text-night-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-surface-100 dark:border-night-600 sticky bottom-0 bg-white dark:bg-night-800 rounded-b-2xl">
                <button
                  onClick={() => setEditingItem(null)}
                  className="px-4 py-2 text-sm font-medium text-surface-600 dark:text-night-300 bg-surface-100 dark:bg-night-700 rounded-xl hover:bg-surface-200 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEditSave}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-500 rounded-xl hover:bg-primary-600 transition-all shadow-sm"
                >
                  Save Changes
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/*  —  Assign Popup  —  */}
      <AssignPopup
        show={showAssignPopup}
        onClose={() => { setShowAssignPopup(false); setIsBulkAssign(false) }}
        teachers={teachers}
        onAssign={isBulkAssign ? handleBulkAssign : handleAssign}
        opportunityTitle={isBulkAssign ? 'All pending items' : (assigningItem?.title || assigningItem?.name)}
        assignedToId={isBulkAssign ? null : assigningItem?.assignedTeacherId}
      />
    </div>
  )
}
