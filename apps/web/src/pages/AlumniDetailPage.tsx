// pages/AlumniDetailPage.tsx — single alumni profile, masked until ACCEPTED.
// WHY: backend GET /api/alumni/:userId gates contact via hasAcceptedLink
// (ACCEPTED row or owner, fail-closed). This page renders ONLY what the server
// returned — masked contact shows the locked panel + request CTA, raw contact
// shows mailto/tel links. Bio renders as plain text (no dangerouslySetInnerHTML
// — security F2). Exact chat deep link comes from the caller's ACCEPTED inbox
// row (chatSessionId); otherwise the unlocked panel links to /chat.
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  AlertTriangle, ArrowLeft, BadgeCheck, Briefcase, Building2, CalendarDays,
  ExternalLink, Flag, GraduationCap, Link2, Lock, Mail, MapPin, MessageCircle, Phone, TrendingUp,
} from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { alumniAPI } from '../lib/api/resources/alumni'
import { qk } from '../lib/queryKeys'
import { useCollegeScope } from '../hooks/useCollegeScope'
import { useEntitySync } from '../lib/entitySync'
import {
  canSeeContact, canViewAlumniProfile, decodeRouteId, formatResponseRate, getAlumniChatLink, isContactMasked,
  responseRateVariant, safeExternalHref,
} from '../lib/alumniGuards'
import CenteredLoader from '../components/ui/CenteredLoader'
import Badge from '../components/ui/Badge'
import RequestMentorModal from '../components/alumni/RequestMentorModal'
import ReportModal from '../components/ReportModal'

function axiosStatus(e: unknown): number | undefined {
  return (e as { response?: { status?: number } })?.response?.status
}

function axiosMessage(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { error?: string } } }
  return err?.response?.data?.error || fallback
}

export default function AlumniDetailPage() {
  const { id } = useParams<{ id: string }>()
  // S2: malformed % (e.g. /alumni/%%%) must not crash render — fall back to raw id.
  const userId = decodeRouteId(id || '')
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const collegeScope = useCollegeScope()
  const [requestOpen, setRequestOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  const detailQuery = useQuery({
    queryKey: qk.alumniDetail(userId, collegeScope),
    queryFn: ({ signal }) => alumniAPI.getOne(userId, signal),
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    enabled: !!user && !!userId,
  })
  useEntitySync('alumni', () => detailQuery.refetch())

  const profile = detailQuery.data ?? null
  const masked = profile ? isContactMasked(profile) : true
  const unlocked = profile ? canSeeContact(profile) : false

  // Exact chat thread for an ACCEPTED link (inbox row carries chatSessionId).
  // L2: server-filtered by alumniUserId (one row beats 50 scanned rows) with
  // /chat fallback when the inbox is empty / thread not yet created.
  const mineQuery = useQuery({
    queryKey: qk.alumniMine('all', 1, collegeScope),
    queryFn: ({ signal }) => alumniAPI.mine({ box: 'all', alumniUserId: userId, page: 1, limit: 10, signal }),
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    enabled: !!user && !!profile && unlocked && !!userId,
  })
  const acceptedRow = (mineQuery.data?.data ?? []).find(
    (r) => r.alumniUserId === userId && r.status === 'ACCEPTED' && r.chatSessionId,
  )
  const chatLink = getAlumniChatLink(acceptedRow?.chatSessionId) ?? '/chat'

  if (detailQuery.isLoading) return <CenteredLoader text="Loading alumni profile…" />

  if (detailQuery.isError) {
    const status = axiosStatus(detailQuery.error)
    const is403 = status === 403
    const is404 = status === 404
    return (
      <div className="max-w-[720px] mx-auto">
        <button
          onClick={() => navigate('/alumni')}
          className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-700 dark:text-night-200 text-sm font-bold hover:bg-surface-50 dark:hover:bg-night-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          <ArrowLeft size={15} aria-hidden="true" /> Back to directory
        </button>
        <div
          className="mt-4 rounded-[24px] border border-surface-200 dark:border-[#282828] bg-white dark:bg-[#121212] px-6 py-12 text-center"
          role="alert"
        >
          <AlertTriangle size={28} className="mx-auto text-amber-500" aria-hidden="true" />
          <h1 className="mt-3 font-display text-xl font-[800] text-surface-900 dark:text-white">
            {is404 ? 'Alumni profile not found' : is403 ? 'Not available for your college' : 'Could not load profile'}
          </h1>
          <p className="mt-1.5 text-sm text-surface-500 dark:text-night-400">
            {is404
              ? 'This alumni may not have created a profile yet.'
              : is403
                ? 'Cross-college profiles are hidden — mentorship stays inside your college.'
                : axiosMessage(detailQuery.error, 'Please try again.')}
          </p>
          <button
            onClick={() => detailQuery.refetch()}
            className="mt-5 min-h-[44px] px-6 inline-flex items-center justify-center rounded-full bg-zinc-900 dark:bg-white text-white dark:text-black text-sm font-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!profile) return null

  const viewer = { id: user?.id, role: user?.role, collegeId: (user as { collegeId?: string | null })?.collegeId ?? null }
  if (!canViewAlumniProfile(viewer, profile)) {
    return (
      <div className="max-w-[720px] mx-auto">
        <button
          onClick={() => navigate('/alumni')}
          className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-700 dark:text-night-200 text-sm font-bold hover:bg-surface-50 dark:hover:bg-night-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          <ArrowLeft size={15} aria-hidden="true" /> Back to directory
        </button>
        <div className="mt-4 rounded-[24px] border border-surface-200 dark:border-[#282828] bg-white dark:bg-[#121212] px-6 py-12 text-center" role="alert">
          <Lock size={28} className="mx-auto text-surface-400" aria-hidden="true" />
          <h1 className="mt-3 font-display text-xl font-[800] text-surface-900 dark:text-white">Not available for your college</h1>
          <p className="mt-1.5 text-sm text-surface-500 dark:text-night-400">Cross-college profiles stay hidden — mentorship stays inside your college.</p>
        </div>
      </div>
    )
  }

  const name = (profile.user?.name || '').trim() || 'Alumni mentor'
  const available = profile.isAvailableForMentorship !== false
  const skills = Array.isArray(profile.skills) ? profile.skills.filter(Boolean) : []
  const rateLabel = formatResponseRate(profile.responseRate)

  const extLinks = [
    profile.linkedinUrl ? { label: 'LinkedIn', href: safeExternalHref(profile.linkedinUrl) } : null,
    profile.githubUrl ? { label: 'GitHub', href: safeExternalHref(profile.githubUrl) } : null,
    profile.portfolioUrl ? { label: 'Portfolio', href: safeExternalHref(profile.portfolioUrl) } : null,
  ].filter((l): l is { label: string; href: string } => !!l && !!l.href)

  return (
    <div className="space-y-6 max-w-[960px] mx-auto">
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate('/alumni')}
          className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-700 dark:text-night-200 text-sm font-bold hover:bg-surface-50 dark:hover:bg-night-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          <ArrowLeft size={15} aria-hidden="true" /> Directory
        </button>
        <span className="flex-1" />
        <button
          onClick={() => setReportOpen(true)}
          className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-600 dark:text-night-200 text-sm font-bold hover:bg-surface-50 dark:hover:bg-night-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          <Flag size={14} aria-hidden="true" /> Report
        </button>
      </div>

      <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] shadow-sm overflow-hidden">
        <div className="h-[3px] bg-emerald-500" />
        <div className="px-5 sm:px-7 py-6">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4">
            <div aria-hidden="true" className="w-16 h-16 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-black flex items-center justify-center text-2xl font-black shrink-0">
              {name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-2xl font-[800] tracking-[-0.02em] text-surface-900 dark:text-white leading-tight flex items-center gap-2">
                <span className="truncate">{name}</span>
                {profile.isVerified && (
                  <span title="Verified alumni" aria-label="Verified alumni">
                    <BadgeCheck size={19} className="text-primary-600 dark:text-primary-400 shrink-0" aria-hidden="true" />
                  </span>
                )}
              </h1>
              <p className="mt-1 text-sm font-semibold text-surface-600 dark:text-night-300 flex items-center gap-1.5 flex-wrap">
                <Briefcase size={13} aria-hidden="true" />
                {[profile.roleTitle, profile.company].filter(Boolean).join(' · ') || 'Alumni'}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-surface-500 dark:text-night-400">
                {profile.location && <span className="inline-flex items-center gap-1"><MapPin size={12} aria-hidden="true" /> {profile.location}</span>}
                {profile.graduationYear != null && <span className="inline-flex items-center gap-1"><GraduationCap size={12} aria-hidden="true" /> Class of {profile.graduationYear}</span>}
                {profile.degree && <span className="inline-flex items-center gap-1"><Building2 size={12} aria-hidden="true" /> {profile.degree}{profile.department ? ` · ${profile.department}` : ''}</span>}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge variant={responseRateVariant(profile.responseRate)}>
                  <TrendingUp size={12} aria-hidden="true" /> {rateLabel === 'New' ? 'New mentor' : `${rateLabel} response`}
                </Badge>
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-black border ${available ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/20' : 'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700'}`}>
                  {available ? 'Open to mentorship' : 'Not available right now'}
                </span>
                <span className="inline-flex items-center gap-1 text-[12px] text-surface-500 dark:text-night-400">
                  <CalendarDays size={12} aria-hidden="true" /> {profile.totalRequests} request{profile.totalRequests === 1 ? '' : 's'}
                  {typeof profile.avgResponseHours === 'number' ? ` · ~${profile.avgResponseHours}h avg response` : ''}
                </span>
              </div>
            </div>
          </div>

          {skills.length > 0 && (
            <div className="mt-5">
              <h2 className="text-[11px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400">Skills</h2>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {skills.map((s) => (
                  <span key={s} className="px-2.5 py-1.5 rounded-full bg-surface-50 dark:bg-white/[0.06] border border-surface-200 dark:border-white/10 text-xs font-semibold text-surface-700 dark:text-night-200">{s}</span>
                ))}
              </div>
            </div>
          )}

          {profile.bio && (
            <div className="mt-5">
              <h2 className="text-[11px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400">About</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-surface-700 dark:text-night-200 whitespace-pre-line">{profile.bio}</p>
            </div>
          )}

          {extLinks.length > 0 && (
            <div className="mt-5">
              <h2 className="text-[11px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400">Links</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {extLinks.map((l) => (
                  <a
                    key={l.label}
                    href={l.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-700 dark:text-night-200 text-sm font-bold hover:bg-surface-50 dark:hover:bg-night-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                  >
                    <Link2 size={13} aria-hidden="true" /> {l.label} <ExternalLink size={12} aria-hidden="true" />
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 rounded-[20px] border border-surface-200 dark:border-white/10 p-5 bg-surface-50/60 dark:bg-white/[0.03]">
            <h2 className="text-[11px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400">Contact</h2>
            {masked ? (
              <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-3">
                <p className="flex-1 text-sm font-medium text-surface-600 dark:text-night-300 flex items-start gap-2">
                  <Lock size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
                  Hidden until your request is accepted — send a request below and you will be notified.
                </p>
                <button
                  onClick={() => setRequestOpen(true)}
                  disabled={!available}
                  className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-5 rounded-xl bg-primary-500 text-black text-sm font-black hover:bg-[#1ed760] disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 shrink-0"
                >
                  <MessageCircle size={15} aria-hidden="true" /> Request mentorship
                </button>
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                {profile.contactEmail && (
                  <a href={`mailto:${profile.contactEmail}`} className="flex items-center gap-2.5 text-sm font-bold text-surface-900 dark:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded">
                    <Mail size={15} aria-hidden="true" /> {profile.contactEmail}
                  </a>
                )}
                {profile.contactPhone && (
                  <a href={`tel:${profile.contactPhone.replace(/\s+/g, '')}`} className="flex items-center gap-2.5 text-sm font-bold text-surface-900 dark:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded">
                    <Phone size={15} aria-hidden="true" /> {profile.contactPhone}
                  </a>
                )}
                <div className="pt-1 flex flex-wrap gap-2">
                  <button
                    onClick={() => navigate(chatLink)}
                    className="min-h-[44px] inline-flex items-center gap-1.5 px-5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-black text-sm font-black hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                  >
                    <ExternalLink size={14} aria-hidden="true" /> Open chat
                  </button>
                  <button
                    onClick={() => setRequestOpen(true)}
                    disabled={!available}
                    className="min-h-[44px] inline-flex items-center gap-1.5 px-5 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-700 dark:text-night-200 text-sm font-bold hover:bg-surface-50 dark:hover:bg-night-700 disabled:opacity-40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                  >
                    <MessageCircle size={15} aria-hidden="true" /> New request
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <RequestMentorModal
        open={requestOpen}
        alumni={profile}
        onClose={() => setRequestOpen(false)}
        onCreated={() => {
          toast.success('Request sent — track it under Alumni → My requests')
          void detailQuery.refetch()
        }}
      />
      <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} />
    </div>
  )
}
