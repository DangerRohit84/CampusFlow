// components/admin/AlumniQueue.tsx — verification triage queue (admin-only).
// WHY: GET /api/alumni/pending returns RAW contact for same-college triage by
// design (security audit: documented, not a leak — admins already see
// user.email in the same select). Rows overdue 24h+ highlight red so admins
// meet the verification SLA. Table on desktop, stacked cards on mobile.
import { AlertTriangle, BadgeCheck, Building2, GraduationCap } from 'lucide-react'
import clsx from 'clsx'
import EmptyState from '../shared/EmptyState'
import Pagination from '../shared/Pagination'
import type { AlumniProfileCard, AlumniPagination } from '../../lib/api/resources/alumni'
import { isVerificationOverdueClient } from '../../lib/alumniGuards'

interface Props {
  items: AlumniProfileCard[]
  pagination: AlumniPagination
  page: number
  onPageChange: (p: number) => void
  onVerify: (profile: AlumniProfileCard, verified: boolean) => void
  verifyingId: string | null
  loading?: boolean
}

function ageLabel(createdAt: string): string {
  const d = new Date(createdAt)
  if (Number.isNaN(d.getTime())) return '—'
  const hrs = Math.floor((Date.now() - d.getTime()) / 3_600_000)
  if (hrs < 1) return 'just now'
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export default function AlumniQueue({ items, pagination, page, onPageChange, onVerify, verifyingId, loading }: Props) {
  const totalPages = Math.max(1, pagination.pages || 1)

  if (!loading && items.length === 0) {
    return (
      <EmptyState
        icon={BadgeCheck}
        title="Verification queue is clear"
        description="Every alumni profile has been verified — new signups will appear here."
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto rounded-[20px] border border-surface-200 dark:border-[#282828] bg-white dark:bg-[#121212]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-100 dark:border-white/10 text-left">
              <th scope="col" className="py-3 px-4 text-[11px] font-black uppercase tracking-widest text-surface-500 dark:text-night-400">Alumni</th>
              <th scope="col" className="py-3 px-4 text-[11px] font-black uppercase tracking-widest text-surface-500 dark:text-night-400">Details</th>
              <th scope="col" className="py-3 px-4 text-[11px] font-black uppercase tracking-widest text-surface-500 dark:text-night-400">Contact (triage)</th>
              <th scope="col" className="py-3 px-4 text-[11px] font-black uppercase tracking-widest text-surface-500 dark:text-night-400">Waiting</th>
              <th scope="col" className="py-3 px-4 text-[11px] font-black uppercase tracking-widest text-surface-500 dark:text-night-400 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => {
              const overdue = isVerificationOverdueClient(p)
              const busy = verifyingId === p.userId
              return (
                <tr
                  key={p.id}
                  className={clsx(
                    'border-b border-surface-50 dark:border-white/5 last:border-0 transition-colors',
                    overdue ? 'bg-danger-50/60 dark:bg-danger-500/[0.06]' : 'hover:bg-surface-50 dark:hover:bg-white/[0.03]',
                  )}
                >
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-black flex items-center justify-center text-sm font-black shrink-0" aria-hidden="true">
                        {(p.user?.name || 'A').charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-surface-900 dark:text-white text-sm leading-tight flex items-center gap-1.5">
                          <span className="truncate">{p.user?.name || 'Alumni'}</span>
                          {overdue && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-danger-500 text-white text-[10px] font-black shrink-0">
                              <AlertTriangle size={10} aria-hidden="true" /> Overdue
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-surface-500 dark:text-night-400 truncate">{p.user?.email || p.userId}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <p className="text-sm font-semibold text-surface-800 dark:text-night-100 flex items-center gap-1.5">
                      <Building2 size={12} aria-hidden="true" /> {[p.roleTitle, p.company].filter(Boolean).join(' · ') || '—'}
                    </p>
                    <p className="text-xs text-surface-500 dark:text-night-400 flex items-center gap-1.5 mt-0.5">
                      <GraduationCap size={12} aria-hidden="true" /> {p.graduationYear ? `Class of ${p.graduationYear}` : 'Year —'}{p.degree ? ` · ${p.degree}` : ''}
                    </p>
                  </td>
                  <td className="py-3 px-4">
                    <p className="text-sm text-surface-700 dark:text-night-200">{p.contactEmail || '—'}</p>
                    <p className="text-xs text-surface-500 dark:text-night-400">{p.contactPhone || ''}</p>
                  </td>
                  <td className="py-3 px-4">
                    <span className={clsx('text-xs font-bold', overdue ? 'text-danger-600 dark:text-danger-400' : 'text-surface-500 dark:text-night-400')}>
                      {ageLabel(p.createdAt)}{overdue ? ' · 24h SLA breached' : ''}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => onVerify(p, true)}
                      disabled={busy}
                      className="min-h-[44px] px-4 inline-flex items-center justify-center rounded-xl bg-primary-500 text-black text-sm font-black hover:bg-[#1ed760] disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                      aria-label={`Verify ${(p.user?.name || 'alumni').trim() || 'alumni'}`}
                    >
                      {busy ? 'Verifying…' : 'Verify'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {items.map((p) => {
          const overdue = isVerificationOverdueClient(p)
          const busy = verifyingId === p.userId
          return (
            <div
              key={p.id}
              className={clsx(
                'rounded-[20px] border p-4 bg-white dark:bg-[#121212]',
                overdue
                  ? 'border-danger-300 dark:border-danger-500/40 ring-1 ring-danger-500/20'
                  : 'border-surface-200 dark:border-[#282828]',
              )}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-black flex items-center justify-center font-black shrink-0" aria-hidden="true">
                  {(p.user?.name || 'A').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-surface-900 dark:text-white text-sm truncate">{p.user?.name || 'Alumni'}</p>
                  <p className="text-xs text-surface-500 dark:text-night-400 truncate">{[p.roleTitle, p.company].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                {overdue && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-danger-500 text-white text-[10px] font-black shrink-0">
                    <AlertTriangle size={10} aria-hidden="true" /> Overdue
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs text-surface-500 dark:text-night-400">
                {p.user?.email || ''} · waiting {ageLabel(p.createdAt)}
                {overdue ? ' · 24h SLA breached' : ''}
              </p>
              <button
                onClick={() => onVerify(p, true)}
                disabled={busy}
                className="mt-3 w-full min-h-[44px] inline-flex items-center justify-center rounded-xl bg-primary-500 text-black text-sm font-black hover:bg-[#1ed760] disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                aria-label={`Verify ${(p.user?.name || 'alumni').trim() || 'alumni'}`}
              >
                {busy ? 'Verifying…' : 'Verify profile'}
              </button>
            </div>
          )
        })}
      </div>

      <Pagination page={page} totalPages={totalPages} onChange={onPageChange} />
    </div>
  )
}
