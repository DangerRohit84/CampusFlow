// components/admin/BulkDeleteModal.tsx — P3 high-risk confirm (transactional).
// WHY separate modal: mass-delete blast radius demands type-to-confirm
// (`DELETE N`) + sample list + explicit irreversibility copy. Single delete
// keeps the existing confirmDialog (AdminPage upgrades its copy separately).
// Partial-failure report panel (Deleted S, failed F + per-email errors, max 50).

import { useState } from 'react'
import toast from 'react-hot-toast'
import { Loader2, Trash2 } from 'lucide-react'
import { adminAPI } from '../../lib/api/resources/admin'
import { confirmMatches, sampleEmails } from './bulkHelpers'

interface Props {
  open: boolean
  onClose: () => void
  collegeId: string | null
  roleLabel: string
  users: Array<{ id: string; email?: string }>
  onDeleted: () => void
}

export default function BulkDeleteModal({ open, onClose, collegeId, roleLabel, users, onDeleted }: Props) {
  const [confirm, setConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [result, setResult] = useState<{ success: number; failed: number; errors: string[]; partial: boolean } | null>(null)

  if (!open) return null

  const n = users.length
  const { sample, more } = sampleEmails(users)
  const canDelete = confirmMatches(confirm, 'DELETE', n) && !deleting

  const reset = () => {
    setConfirm('')
    setResult(null)
  }

  const handleDelete = async () => {
    if (!canDelete) return
    setDeleting(true)
    try {
      const res = await adminAPI.bulkDeleteUsers(users.map((u) => u.id), confirm, collegeId ?? undefined)
      setResult(res)
      if (res.success > 0) {
        toast.success(`Deleted ${res.success} ${roleLabel}`)
        onDeleted()
      }
      if (res.failed > 0) toast.error(`${res.failed} failed — see report`)
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Bulk delete failed')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-night-800 rounded-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Delete ${n} ${roleLabel}`}
      >
        <h2 className="text-lg font-bold text-surface-900 dark:text-night-50 flex items-center gap-2">
          <Trash2 size={18} className="text-danger-500" /> Delete {n} {roleLabel}?
        </h2>
        <ul className="mt-2 text-xs font-mono text-surface-600 dark:text-night-300 space-y-0.5">
          {sample.map((e) => <li key={e} className="truncate">• {e}</li>)}
        </ul>
        {more > 0 && <p className="text-[11px] text-surface-400">+{more} more</p>}
        <p className="text-xs text-danger-600 font-medium mt-2">
          This cannot be undone. Users lose access immediately.
        </p>

        <label htmlFor="bulk-delete-confirm" className="block text-xs font-semibold text-surface-600 dark:text-night-300 mt-3 mb-1.5">
          Type <code className="font-mono font-bold">DELETE {n}</code> to confirm
        </label>
        <input
          id="bulk-delete-confirm"
          type="text"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={`DELETE ${n}`}
          autoComplete="off"
          className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-danger-500/20 focus:border-danger-400"
        />

        {result && (
          <div className="mt-3 rounded-xl border border-surface-200 dark:border-night-600 p-3 text-sm">
            <p className="font-semibold text-surface-900 dark:text-night-50">
              Deleted {result.success}, failed {result.failed}
            </p>
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
              onClick={handleDelete}
              disabled={!canDelete}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-danger-600 hover:bg-danger-700 text-white rounded-xl font-medium disabled:opacity-50"
            >
              {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
