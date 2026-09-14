// components/admin/BulkPasswordModal.tsx — bulk password set/reset (Option A).
// WHY one modal, two modes: shared-set (admin types/generates, same card as P1
// import) + shared-reset (backend auto-generates, returned once). One code path,
// §10 nudge-only (no forced block): copy says "nudged (not forced)".
// Guards: self stripped with explicit warn (never fails the batch), RESET N
// confirm (N = post-dedupe non-self count), 100/call cap + 429 surfacing.
// Show-once: FE-held value for set, server-once sharedTempPassword for reset.

import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Loader2, KeyRound } from 'lucide-react'
import { adminAPI } from '../../lib/api/resources/admin'
import SharedPasswordField from './SharedPasswordField'
import ShowOncePanel from './ShowOncePanel'
import { confirmMatches, sampleEmails, validateSharedPasswordLocal } from './bulkHelpers'

interface Props {
  open: boolean
  mode: 'shared-set' | 'shared-reset'
  onClose: () => void
  collegeId: string | null
  users: Array<{ id: string; email?: string; role?: string }>
  selfId?: string
  onReset: () => void
}

export default function BulkPasswordModal({ open, mode, onClose, collegeId, users, selfId, onReset }: Props) {
  const [sharedPassword, setSharedPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [working, setWorking] = useState(false)
  const [result, setResult] = useState<{
    success: number; failed: number; skippedSelf: number; partial: boolean; errors: string[];
    nudgeEnabled: boolean; sharedTempPassword?: string;
  } | null>(null)

  const nonSelf = useMemo(() => users.filter((u) => u.id !== selfId), [users, selfId])
  const skippedSelf = users.length - nonSelf.length
  const n = nonSelf.length

  if (!open) return null

  const { sample, more } = sampleEmails(nonSelf)
  const localPwErrors = mode === 'shared-set' ? validateSharedPasswordLocal(sharedPassword) : []
  const canSubmit =
    n > 0 && n <= 100 && confirmMatches(confirm, 'RESET', n) && (mode === 'shared-reset' || localPwErrors.length === 0) && !working

  const reset = () => {
    setSharedPassword('')
    setConfirm('')
    setResult(null)
  }

  const handleSubmit = async () => {
    if (!canSubmit) return
    setWorking(true)
    try {
      const res = await adminAPI.bulkPassword({
        ids: nonSelf.map((u) => u.id),
        mode,
        ...(mode === 'shared-set' ? { sharedPassword } : { autoGenerate: true }),
        confirm,
        ...(collegeId ? { collegeId } : {}),
      })
      setResult(res)
      if (res.success > 0) {
        toast.success(`Updated ${res.success} password${res.success === 1 ? '' : 's'}`)
        onReset()
      }
      if (res.skippedSelf > 0) toast(`Skipped yourself (${res.skippedSelf}).`, { icon: '⚠️' })
      if (res.failed > 0) toast.error(`${res.failed} failed — see report`)
    } catch (e: any) {
      const msg = e?.response?.data?.error || 'Password reset failed'
      toast.error(e?.response?.status === 429 ? `${msg} (rate limited — retry shortly)` : msg)
    } finally {
      setWorking(false)
    }
  }

  // Show-once secret: FE-held for set, server-once for reset. Never both.
  const showOnceSecret = result
    ? mode === 'shared-reset'
      ? (result.sharedTempPassword ?? null)
      : sharedPassword || null
    : null

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-night-800 rounded-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={mode === 'shared-set' ? `Set shared password for ${n} users` : `Reset passwords for ${n} users`}
      >
        <h2 className="text-lg font-bold text-surface-900 dark:text-night-50 flex items-center gap-2">
          <KeyRound size={18} className="text-primary-500" />
          {mode === 'shared-set' ? `Set shared password for ${n} users?` : `Generate one random password for ${n} users?`}
        </h2>
        <ul className="mt-2 text-xs font-mono text-surface-600 dark:text-night-300 space-y-0.5">
          {sample.map((e) => <li key={e} className="truncate">• {e}</li>)}
        </ul>
        {more > 0 && <p className="text-[11px] text-surface-400">+{more} more</p>}

        {mode === 'shared-set' ? (
          <div className="mt-3">
            <SharedPasswordField
              value={sharedPassword}
              onChange={setSharedPassword}
              label={`Shared password for all ${n} users`}
              helper="Applies to all selected. Users will be nudged (not forced) to change. Closing hides it forever."
            />
          </div>
        ) : (
          <p className="text-xs text-surface-500 dark:text-night-400 mt-2">
            One strong password is generated for all {n} users. Users will be nudged (not forced) to change. Closing hides it forever.
          </p>
        )}
        {skippedSelf > 0 && (
          <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1.5">⚠️ Skipped yourself ({skippedSelf}).</p>
        )}

        <label htmlFor="bulk-pw-confirm" className="block text-xs font-semibold text-surface-600 dark:text-night-300 mt-3 mb-1.5">
          Type <code className="font-mono font-bold">RESET {n}</code> to confirm
        </label>
        <input
          id="bulk-pw-confirm"
          type="text"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={`RESET ${n}`}
          autoComplete="off"
          className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
        />

        {result && (
          <div className="mt-3 rounded-xl border border-surface-200 dark:border-night-600 p-3 text-sm">
            <p className="font-semibold text-surface-900 dark:text-night-50">
              Updated {result.success}, failed {result.failed}{result.skippedSelf > 0 ? `, skipped yourself (${result.skippedSelf})` : ''}
            </p>
            {showOnceSecret && result.success > 0 && <ShowOncePanel secret={showOnceSecret} />}
            {result.errors.length > 0 && (
              <ul className="mt-1 max-h-32 overflow-y-auto text-xs text-danger-600 list-disc pl-4">
                {result.errors.slice(0, 50).map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </div>
        )}

        <div className="flex gap-2 mt-5">
          <button onClick={() => { reset(); onClose() }} className="flex-1 px-4 py-2 bg-surface-100 dark:bg-night-700 text-surface-700 dark:text-night-200 rounded-xl font-medium">
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-medium disabled:opacity-50"
            >
              {working ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
              {working ? 'Working…' : mode === 'shared-set' ? 'Set password' : `Generate & Reset ${n}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
