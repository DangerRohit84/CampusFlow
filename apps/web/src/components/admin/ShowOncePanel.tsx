// components/admin/ShowOncePanel.tsx — single show-once secret panel.
// WHY shared: import + set/reset results all display exactly ONE secret
// (FE-held value for shared-set/import, server-once sharedTempPassword for
// reset). Masked by default, hold-to-reveal semantics via toggle + 10s
// auto-remask, Copy+toast, auto-cleared on modal close (caller owns state).

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Copy, Eye, EyeOff } from 'lucide-react'

interface Props {
  secret: string
  title?: string
  note?: string
}

export default function ShowOncePanel({ secret, title, note }: Props) {
  const [revealed, setRevealed] = useState(false)

  // 10s auto-remask (shoulder-surfing mitigation).
  useEffect(() => {
    if (!revealed) return
    const t = setTimeout(() => setRevealed(false), 10_000)
    return () => clearTimeout(t)
  }, [revealed])

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(secret)
      toast.success('Copied — share via a secure channel')
    } catch {
      toast.error('Copy failed — reveal and copy manually')
    }
  }

  return (
    <div className="mt-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-2.5">
      <p className="text-xs font-bold text-amber-800 dark:text-amber-200">
        {title ?? 'Shared password (show once)'}
      </p>
      <div className="mt-1.5 flex items-center gap-2">
        <code className="flex-1 px-2 py-1.5 rounded-md bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 text-sm font-mono truncate">
          {revealed ? secret : '••••••••••••'}
        </code>
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          aria-label={revealed ? 'Hide password' : 'Reveal password'}
          className="shrink-0 px-2 py-1.5 rounded-md border border-surface-200 dark:border-night-600 text-[11px] font-semibold hover:bg-white dark:hover:bg-night-700 inline-flex items-center gap-1"
        >
          {revealed ? <EyeOff size={12} /> : <Eye size={12} />} {revealed ? 'Hide' : 'Reveal'}
        </button>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 px-2 py-1.5 rounded-md border border-surface-200 dark:border-night-600 text-[11px] font-semibold hover:bg-white dark:hover:bg-night-700 inline-flex items-center gap-1"
        >
          <Copy size={12} /> Copy
        </button>
      </div>
      <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">
        {note ?? 'Closing hides it forever. Users will be nudged (not forced) to change.'}
      </p>
    </div>
  )
}
