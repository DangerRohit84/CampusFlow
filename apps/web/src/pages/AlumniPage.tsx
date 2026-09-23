// pages/AlumniPage.tsx — alumni directory + mentorship inboxes + admin verify queue.
// WHY Phase 2: directory is server-paged + college-scoped (server authoritative;
// client keys caches by scope via useCollegeScope). List cards are ALWAYS
// masked (backend masks; frontend never unmasks — see lib/alumniGuards).
// Detail unmasks only on an ACCEPTED link. Inboxes surface chatSessionId as an
// existing-chat deep link. ReportModal is reused for directory issues.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import {
  AlertTriangle, Building2, CheckCircle2, Clock, ExternalLink, Flag, GraduationCap,
  Inbox, MessageCircle, Search, ShieldCheck, Users, XCircle,
} from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { alumniAPI, type AlumniProfileCard, type MentorshipRequest } from '../lib/api/resources/alumni'
import { qk } from '../lib/queryKeys'
import { useCollegeScope } from '../hooks/useCollegeScope'
import { useDebounce } from '../hooks/useDebounce'
import { notifyEntityMutated } from '../lib/entitySync'
import { getAlumniChatLink, isSlaBreachedClient, mentorshipPermissions } from '../lib/alumniGuards'
import AlumniCard from '../components/alumni/AlumniCard'
import RequestMentorModal from '../components/alumni/RequestMentorModal'
import AlumniQueue from '../components/admin/AlumniQueue'
import PageHeader from '../components/shared/PageHeader'
import FilterTabs from '../components/shared/FilterTabs'
import EmptyState from '../components/shared/EmptyState'
import Pagination from '../components/shared/Pagination'
import CenteredLoader from '../components/ui/CenteredLoader'
import ReportModal from '../components/ReportModal'

const PAGE_SIZE = 12
const INBOX_SIZE = 10

type DirectoryTab = 'directory' | 'requests' | 'verify'

function axiosMessage(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { error?: string } } }
  return err?.response?.data?.error || fallback
}

function statusPill(status: string): string {
  switch (status) {
    case 'ACCEPTED': return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/20'
    case 'DECLINED':
    case 'CANCELLED':
    case 'EXPIRED': return 'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700'
    default: return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/20'
  }
}

export default function AlumniPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const collegeScope = useCollegeScope()
  const role = user?.role
  const isAdmin = role === 'COLLEGE_ADMIN' || role === 'SUPER_ADMIN'
  const viewerId = user?.id

  const [tab, setTab] = useState<DirectoryTab>('directory')
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 300)
  const [company, setCompany] = useState('')
  const debouncedCompany = useDebounce(company, 300)
  const [gradYear, setGradYear] = useState('')
  const [verifiedFilter, setVerifiedFilter] = useState<'all' | 'verified' | 'unverified'>('all')
  const [availableFilter, setAvailableFilter] = useState<'all' | 'open' | 'busy'>('all')
  const [page, setPage] = useState(1)
  const [box, setBox] = useState<'all' | 'sent' | 'received'>('all')
  const [inboxPage, setInboxPage] = useState(1)
  const [queuePage, setQueuePage] = useState(1)
  const [requestFor, setRequestFor] = useState<AlumniProfileCard | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [actingId, setActingId] = useState<string | null>(null)
  const [verifyingId, setVerifyingId] = useState<string | null>(null)

  const filtersKey = useMemo(
    () => `${debouncedCompany}|${gradYear}|${verifiedFilter}|${availableFilter}|${page}`,
    [debouncedCompany, gradYear, verifiedFilter, availableFilter, page],
  )
  const gradYearNum = gradYear.trim() ? parseInt(gradYear.trim(), 10) : NaN

  const directoryQuery = useQuery({
    queryKey: qk.alumni(debouncedSearch, collegeScope, filtersKey),
    queryFn: ({ signal }) =>
      alumniAPI.list({
        search: debouncedSearch.trim() || undefined,
        company: debouncedCompany.trim() || undefined,
        graduationYear: Number.isFinite(gradYearNum) ? gradYearNum : undefined,
        verified: verifiedFilter === 'all' ? undefined : verifiedFilter === 'verified',
        available: availableFilter === 'all' ? undefined : availableFilter === 'open',
        page,
        limit: PAGE_SIZE,
        signal,
      }),
    staleTime: 3 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    enabled: !!user && tab === 'directory',
  })

  const inboxQuery = useQuery({
    queryKey: qk.alumniMine(box, inboxPage, collegeScope),
    queryFn: ({ signal }) => alumniAPI.mine({ box, page: inboxPage, limit: INBOX_SIZE, signal }),
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    enabled: !!user && tab === 'requests',
  })

  const pendingQuery = useQuery({
    queryKey: qk.alumniPending(queuePage, collegeScope),
    queryFn: ({ signal }) => alumniAPI.pending({ page: queuePage, limit: PAGE_SIZE, signal }),
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    enabled: !!user && tab === 'verify' && isAdmin,
  })

  const directory = directoryQuery.data?.data ?? []
  const dirPagination = directoryQuery.data?.pagination
  const dirPages = Math.max(1, dirPagination?.pages || 1)

  const inbox = inboxQuery.data?.data ?? []
  const inboxPagination = inboxQuery.data?.pagination
  const inboxPages = Math.max(1, inboxPagination?.pages || 1)

  const resetDirectoryPage = () => setPage(1)

  const handleRespond = async (row: MentorshipRequest, action: 'ACCEPT' | 'DECLINE' | 'CANCEL') => {
    setActingId(row.id)
    try {
      const updated = await alumniAPI.respond(row.id, action)
      if (action === 'ACCEPT') {
        toast.success('Request accepted — chat thread is ready')
      } else if (action === 'DECLINE') {
        toast.success('Request declined')
      } else {
        toast.success('Request cancelled')
      }
      notifyEntityMutated('alumni')
      void inboxQuery.refetch()
      void directoryQuery.refetch()
      const chatLink = getAlumniChatLink(updated?.chatSessionId)
      if (action === 'ACCEPT' && chatLink) {
        navigate(chatLink)
      }
    } catch (e) {
      toast.error(axiosMessage(e, 'Failed to update request'))
    } finally {
      setActingId(null)
    }
  }

  const handleVerify = async (profile: AlumniProfileCard, verified: boolean) => {
    setVerifyingId(profile.userId)
    try {
      await alumniAPI.verify(profile.userId, verified)
      toast.success(verified ? 'Alumni verified — now discoverable' : 'Verification removed')
      notifyEntityMutated('alumni')
      void pendingQuery.refetch()
      void directoryQuery.refetch()
    } catch (e) {
      toast.error(axiosMessage(e, 'Failed to verify alumni'))
    } finally {
      setVerifyingId(null)
    }
  }

  const tabs = useMemo(() => {
    const base = [
      { key: 'directory', label: 'Directory', icon: Users },
      { key: 'requests', label: 'My requests', icon: Inbox },
    ]
    if (isAdmin) base.push({ key: 'verify', label: 'Verification', icon: ShieldCheck })
    return base
  }, [isAdmin])

  return (
    <div className="space-y-6 max-w-[1280px] mx-auto">
      <PageHeader
        title="Alumni Network"
        subtitle="Verified mentors from your college — contact unlocks after they accept"
        icon={<GraduationCap size={18} aria-hidden="true" />}
        accent="emerald"
        action={
          <button
            onClick={() => setReportOpen(true)}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-600 dark:text-night-200 text-sm font-bold hover:bg-surface-50 dark:hover:bg-night-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            <Flag size={14} aria-hidden="true" /> Report issue
          </button>
        }
      />

      {!collegeScope && role !== 'SUPER_ADMIN' && (
        <div className="rounded-[20px] border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 px-5 py-4 flex items-start gap-3" role="note">
          <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Your account is not linked to a college yet — the directory will be empty until an admin links you. Contact your college admin.
          </p>
        </div>
      )}

      <FilterTabs
        accent="emerald"
        tabs={tabs}
        activeTab={tab}
        onTabChange={(key) => setTab(key as DirectoryTab)}
      />

      {tab === 'directory' && (
        <section aria-label="Alumni directory" className="space-y-4">
          <div className="rounded-[20px] border border-surface-200 dark:border-[#282828] bg-white dark:bg-[#121212] p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="relative">
                <label htmlFor="alumni-search" className="sr-only">Search alumni</label>
                <Search size={15} aria-hidden="true" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400" />
                <input
                  id="alumni-search"
                  type="search"
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); resetDirectoryPage() }}
                  placeholder="Search company, role, skills…"
                  className="w-full pl-10 pr-4 min-h-[44px] bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-xl text-sm placeholder:text-[#6b7280] focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-500/15 dark:text-night-100"
                />
              </div>
              <div className="relative">
                <label htmlFor="alumni-company" className="sr-only">Filter by company</label>
                <Building2 size={15} aria-hidden="true" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400" />
                <input
                  id="alumni-company"
                  type="text"
                  value={company}
                  onChange={(e) => { setCompany(e.target.value); resetDirectoryPage() }}
                  placeholder="Company…"
                  className="w-full pl-10 pr-4 min-h-[44px] bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-xl text-sm placeholder:text-[#6b7280] focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-500/15 dark:text-night-100"
                />
              </div>
              <div>
                <label htmlFor="alumni-gradyear" className="sr-only">Filter by graduation year</label>
                <input
                  id="alumni-gradyear"
                  type="number"
                  inputMode="numeric"
                  min={1950}
                  max={2100}
                  value={gradYear}
                  onChange={(e) => { setGradYear(e.target.value); resetDirectoryPage() }}
                  placeholder="Graduation year…"
                  className="w-full px-4 min-h-[44px] bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-xl text-sm placeholder:text-[#6b7280] focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-500/15 dark:text-night-100"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="sr-only" htmlFor="alumni-verified">Verified filter</label>
                <select
                  id="alumni-verified"
                  value={verifiedFilter}
                  onChange={(e) => { setVerifiedFilter(e.target.value as typeof verifiedFilter); resetDirectoryPage() }}
                  className="min-h-[44px] px-3 bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-xl text-sm font-semibold text-surface-700 dark:text-night-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  <option value="all">All</option>
                  <option value="verified">Verified</option>
                  <option value="unverified">Unverified</option>
                </select>
                <label className="sr-only" htmlFor="alumni-available">Availability filter</label>
                <select
                  id="alumni-available"
                  value={availableFilter}
                  onChange={(e) => { setAvailableFilter(e.target.value as typeof availableFilter); resetDirectoryPage() }}
                  className="min-h-[44px] px-3 bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-xl text-sm font-semibold text-surface-700 dark:text-night-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  <option value="all">Any status</option>
                  <option value="open">Open</option>
                  <option value="busy">Busy</option>
                </select>
              </div>
            </div>
          </div>

          {directoryQuery.isLoading ? (
            <CenteredLoader text="Loading alumni…" />
          ) : directoryQuery.isError ? (
            <div className="rounded-[20px] border border-danger-200 dark:border-danger-500/20 bg-danger-50 dark:bg-danger-500/10 px-5 py-8 text-center" role="alert">
              <AlertTriangle size={20} className="mx-auto text-danger-500" aria-hidden="true" />
              <h2 className="mt-2 font-bold text-surface-900 dark:text-white">Could not load the directory</h2>
              <p className="mt-1 text-sm text-surface-600 dark:text-night-300">{axiosMessage(directoryQuery.error, 'Please try again.')}</p>
              <button
                onClick={() => directoryQuery.refetch()}
                className="mt-4 min-h-[44px] px-5 inline-flex items-center justify-center rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-black text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
              >
                Retry
              </button>
            </div>
          ) : directory.length === 0 ? (
            <EmptyState
              icon={GraduationCap}
              title="No alumni found"
              description={debouncedSearch || debouncedCompany || gradYear ? 'Try clearing search or filters.' : 'No alumni profiles in your college yet — check back soon.'}
            />
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {directory.map((p) => (
                  <AlumniCard key={p.id} profile={p} onRequest={setRequestFor} />
                ))}
              </div>
              <Pagination page={page} totalPages={dirPages} onChange={setPage} />
            </>
          )}
        </section>
      )}

      {tab === 'requests' && (
        <section aria-label="Mentorship requests" className="space-y-4">
          <FilterTabs
            accent="emerald"
            tabs={[
              { key: 'all', label: 'All', icon: Inbox },
              { key: 'sent', label: 'Sent', icon: MessageCircle },
              { key: 'received', label: 'Received', icon: Users },
            ]}
            activeTab={box}
            onTabChange={(key) => { setBox(key as typeof box); setInboxPage(1) }}
          />

          {inboxQuery.isLoading ? (
            <CenteredLoader text="Loading requests…" />
          ) : inboxQuery.isError ? (
            <div className="rounded-[20px] border border-danger-200 dark:border-danger-500/20 bg-danger-50 dark:bg-danger-500/10 px-5 py-8 text-center" role="alert">
              <AlertTriangle size={20} className="mx-auto text-danger-500" aria-hidden="true" />
              <h2 className="mt-2 font-bold text-surface-900 dark:text-white">Could not load requests</h2>
              <p className="mt-1 text-sm text-surface-600 dark:text-night-300">{axiosMessage(inboxQuery.error, 'Please try again.')}</p>
              <button
                onClick={() => inboxQuery.refetch()}
                className="mt-4 min-h-[44px] px-5 inline-flex items-center justify-center rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-black text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
              >
                Retry
              </button>
            </div>
          ) : inbox.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={box === 'sent' ? 'No requests sent yet' : box === 'received' ? 'No requests received yet' : 'No mentorship requests yet'}
              description="Open the directory, pick a mentor, and send your first request."
              action={
                <button
                  onClick={() => setTab('directory')}
                  className="min-h-[44px] inline-flex items-center px-5 rounded-xl bg-primary-500 text-black text-sm font-black hover:bg-[#1ed760] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                >
                  Browse alumni
                </button>
              }
            />
          ) : (
            <>
              <ul className="space-y-3">
                {inbox.map((row) => {
                  const perms = mentorshipPermissions(viewerId, row, role)
                  const breached = isSlaBreachedClient(row)
                  const chatLink = getAlumniChatLink(row.chatSessionId)
                  const busy = actingId === row.id
                  const isPending = row.status === 'PENDING'
                  return (
                    <li
                      key={row.id}
                      className={clsx(
                        'rounded-[20px] border bg-white dark:bg-[#121212] p-4 sm:p-5',
                        breached
                          ? 'border-danger-300 dark:border-danger-500/40 ring-1 ring-danger-500/20'
                          : 'border-surface-200 dark:border-[#282828]',
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={clsx('inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-black border', statusPill(row.status))}>
                          {row.status}
                        </span>
                        {row.topic && (
                          <span className="px-2.5 py-1 rounded-full bg-surface-50 dark:bg-white/[0.06] border border-surface-200 dark:border-white/10 text-[11px] font-bold text-surface-600 dark:text-night-300">
                            {row.topic}
                          </span>
                        )}
                        {breached && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-danger-500 text-white text-[11px] font-black">
                            <Clock size={11} aria-hidden="true" /> Overdue 3d SLA
                          </span>
                        )}
                        <span className="ml-auto text-[11px] font-medium text-surface-400 dark:text-night-400">
                          {new Date(row.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      </div>
                      {row.message && (
                        <p className="mt-2.5 text-sm text-surface-600 dark:text-night-300 leading-relaxed whitespace-pre-line">{row.message}</p>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {isPending && perms.canAcceptDecline && (
                          <>
                            <button
                              onClick={() => handleRespond(row, 'ACCEPT')}
                              disabled={busy}
                              className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-xl bg-primary-500 text-black text-sm font-black hover:bg-[#1ed760] disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                            >
                              <CheckCircle2 size={14} aria-hidden="true" /> {busy ? 'Working…' : 'Accept'}
                            </button>
                            <button
                              onClick={() => handleRespond(row, 'DECLINE')}
                              disabled={busy}
                              className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-700 dark:text-night-200 text-sm font-bold hover:bg-surface-50 dark:hover:bg-night-700 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                            >
                              <XCircle size={14} aria-hidden="true" /> Decline
                            </button>
                          </>
                        )}
                        {isPending && !perms.canAcceptDecline && perms.canCancel && (
                          <button
                            onClick={() => handleRespond(row, 'CANCEL')}
                            disabled={busy}
                            className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-700 dark:text-night-200 text-sm font-bold hover:bg-surface-50 dark:hover:bg-night-700 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                          >
                            <XCircle size={14} aria-hidden="true" /> {busy ? 'Cancelling…' : 'Cancel request'}
                          </button>
                        )}
                        {row.status === 'ACCEPTED' && chatLink && (
                          <button
                            onClick={() => navigate(chatLink)}
                            className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-black text-sm font-black hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                          >
                            <ExternalLink size={14} aria-hidden="true" /> Open chat
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
              <Pagination page={inboxPage} totalPages={inboxPages} onChange={setInboxPage} />
            </>
          )}
        </section>
      )}

      {tab === 'verify' && isAdmin && (
        <section aria-label="Alumni verification queue" className="space-y-4">
          <div className="rounded-[20px] border border-surface-200 dark:border-[#282828] bg-white dark:bg-[#121212] px-5 py-4 flex items-start gap-3" role="note">
            <ShieldCheck size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm font-medium text-surface-600 dark:text-night-300">
              Same-college triage — contact is visible here so you can verify identity. The public directory stays masked until a request is accepted.
            </p>
          </div>
          {pendingQuery.isLoading ? (
            <CenteredLoader text="Loading verification queue…" />
          ) : pendingQuery.isError ? (
            <div className="rounded-[20px] border border-danger-200 dark:border-danger-500/20 bg-danger-50 dark:bg-danger-500/10 px-5 py-8 text-center" role="alert">
              <AlertTriangle size={20} className="mx-auto text-danger-500" aria-hidden="true" />
              <h2 className="mt-2 font-bold text-surface-900 dark:text-white">Could not load the queue</h2>
              <p className="mt-1 text-sm text-surface-600 dark:text-night-300">{axiosMessage(pendingQuery.error, 'Please try again.')}</p>
              <button
                onClick={() => pendingQuery.refetch()}
                className="mt-4 min-h-[44px] px-5 inline-flex items-center justify-center rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-black text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
              >
                Retry
              </button>
            </div>
          ) : (
            <AlumniQueue
              items={pendingQuery.data?.data ?? []}
              pagination={pendingQuery.data?.pagination ?? { page: 1, limit: PAGE_SIZE, total: 0, pages: 0 }}
              page={queuePage}
              onPageChange={setQueuePage}
              onVerify={handleVerify}
              verifyingId={verifyingId}
            />
          )}
        </section>
      )}

      <RequestMentorModal
        open={!!requestFor}
        alumni={requestFor}
        onClose={() => setRequestFor(null)}
        onCreated={() => {
          void directoryQuery.refetch()
          setTab('requests')
          setBox('sent')
          setInboxPage(1)
          void inboxQuery.refetch()
        }}
      />
      <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} />
    </div>
  )
}
