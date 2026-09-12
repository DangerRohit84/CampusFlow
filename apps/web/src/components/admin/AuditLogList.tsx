// components/admin/AuditLogList.tsx — #11 SuperAdmin audit-log UI with filters.
// WHY: admin mutations were invisible after the fact. Lists AuditLog rows
// (actor, action, entity, college, time) with server-side filters + paging.
// Reuses the shared Pagination component; empty-state when pre-migration.

import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { ShieldCheck, Search, Loader2 } from 'lucide-react'
import { auditAPI } from '../../lib/api/resources/admin'
import { qk } from '../../lib/queryKeys'
import Pagination from '../shared/Pagination'

const ACTIONS = ['', 'USER_CREATE', 'USER_UPDATE', 'USER_DELETE', 'USER_BULK_CREATE', 'USER_BULK_DRY_RUN', 'COLLEGE_REGISTER', 'COLLEGE_APPROVE', 'COLLEGE_REJECT', 'COLLEGE_DELETE', 'AI_QUOTA_UPDATE']

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function AuditLogList({ collegeId }: { collegeId?: string }) {
  const [action, setAction] = useState('')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)

  const query = useQuery({
    queryKey: qk.auditLogs({ collegeId, action, search: debounced, page }),
    queryFn: ({ signal }) => auditAPI.list({
      collegeId: collegeId || undefined,
      action: action || undefined,
      search: debounced || undefined,
      page,
      limit: 15,
      signal,
    }),
    staleTime: 15 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  })

  const data = query.data?.data ?? []
  const pagination = query.data?.pagination

  const onSearch = (v: string) => {
    setSearch(v)
    setPage(1)
    window.clearTimeout((onSearch as unknown as { t?: number }).t)
    ;(onSearch as unknown as { t?: number }).t = window.setTimeout(() => setDebounced(v.trim()), 400)
  }

  return (
    <div className="rounded-[20px] bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 shadow-soft overflow-hidden">
      <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-surface-100 dark:border-night-700">
        <h3 className="font-bold text-slate-900 dark:text-white inline-flex items-center gap-2 text-sm">
          <span className="w-7 h-7 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-black flex items-center justify-center"><ShieldCheck size={14} /></span>
          Audit log
          {pagination && <span className="text-xs font-medium text-surface-400">· {pagination.total} events</span>}
        </h3>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-400" />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="actor email, action, id…"
              aria-label="Search audit log"
              className="pl-8 pr-3 h-9 w-[200px] bg-surface-50 dark:bg-night-900 border border-surface-200 dark:border-night-600 rounded-xl text-xs focus:outline-none focus:border-primary-300 dark:text-white placeholder:text-[#6b7280]"
            />
          </div>
          <select
            value={action}
            onChange={(e) => { setAction(e.target.value); setPage(1) }}
            aria-label="Filter by action"
            className="h-9 px-3 bg-surface-50 dark:bg-night-900 border border-surface-200 dark:border-night-600 rounded-xl text-xs font-medium dark:text-white"
          >
            {ACTIONS.map((a) => <option key={a} value={a}>{a || 'All actions'}</option>)}
          </select>
        </div>
      </div>

      {query.isLoading ? (
        <div className="py-10 flex justify-center"><Loader2 size={18} className="animate-spin text-surface-400" /></div>
      ) : data.length === 0 ? (
        <p className="py-10 text-center text-sm text-surface-500 dark:text-night-400">No audit events yet — admin actions will appear here.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-surface-100 dark:border-night-700 bg-surface-50/60 dark:bg-night-900/40">
                <th className="text-left py-2.5 px-4 font-bold uppercase tracking-widest text-[10px] text-surface-400">When</th>
                <th className="text-left py-2.5 px-3 font-bold uppercase tracking-widest text-[10px] text-surface-400">Actor</th>
                <th className="text-left py-2.5 px-3 font-bold uppercase tracking-widest text-[10px] text-surface-400">Action</th>
                <th className="text-left py-2.5 px-3 font-bold uppercase tracking-widest text-[10px] text-surface-400">Entity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-50 dark:divide-night-800">
              {data.map((e) => (
                <tr key={e.id} className="hover:bg-surface-50 dark:hover:bg-night-700/30">
                  <td className="py-2.5 px-4 whitespace-nowrap text-surface-500" title={new Date(e.createdAt).toLocaleString()}>{timeAgo(e.createdAt)}</td>
                  <td className="py-2.5 px-3">
                    <p className="font-semibold text-slate-800 dark:text-night-100 truncate max-w-[180px]">{e.actorEmail || e.actorId?.slice(0, 8) || '—'}</p>
                    {e.actorRole && <p className="text-[10px] text-surface-400">{e.actorRole}</p>}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="inline-flex px-2 py-0.5 rounded-full bg-surface-100 dark:bg-night-700 border border-surface-200 dark:border-night-600 font-mono font-bold text-[10px]">{e.action}</span>
                  </td>
                  <td className="py-2.5 px-3 text-surface-500">
                    {[e.entityType, e.entityId?.slice(0, 8)].filter(Boolean).join(' · ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && pagination.pages > 1 && (
        <div className="px-4 py-3 border-t border-surface-100 dark:border-night-700">
          <Pagination page={pagination.page} totalPages={pagination.pages} onChange={setPage} scroll={false} />
        </div>
      )}
    </div>
  )
}
