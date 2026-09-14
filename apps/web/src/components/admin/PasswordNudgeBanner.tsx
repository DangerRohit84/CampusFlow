// components/admin/PasswordNudgeBanner.tsx — §10 dismissible nudge (NO forced block).
// WHY: shared passwords (import batches + bulk set/reset) have an indefinite
// reuse window by user decision. All routes stay accessible; this banner on
// authed pages drives voluntary rotation. Dismiss persists per-user in
// localStorage (V1, no BE ack). Shown when login/me flags mustChangePassword
// OR passwordNudge are true.

import { useEffect, useState } from 'react'
import { KeyRound, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface Props {
  userId: string | null | undefined
  mustChangePassword?: boolean
  passwordNudge?: boolean
}

function dismissedKey(userId: string): string {
  return `nudgeDismissed:${userId}`
}

export function isNudgeDismissed(userId: string | null | undefined): boolean {
  if (!userId) return true
  try {
    return localStorage.getItem(dismissedKey(userId)) === '1'
  } catch {
    return false
  }
}

export default function PasswordNudgeBanner({ userId, mustChangePassword, passwordNudge }: Props) {
  const navigate = useNavigate()
  const [dismissed, setDismissed] = useState(() => isNudgeDismissed(userId))

  useEffect(() => {
    setDismissed(isNudgeDismissed(userId))
  }, [userId, mustChangePassword, passwordNudge])

  if (!userId || (!mustChangePassword && !passwordNudge) || dismissed) return null

  const dismiss = () => {
    try {
      localStorage.setItem(dismissedKey(userId), '1')
    } catch {}
    setDismissed(true)
  }

  return (
    <div
      role="status"
      className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-sm"
    >
      <KeyRound size={16} className="shrink-0 text-amber-600 dark:text-amber-300" />
      <p className="flex-1 text-amber-800 dark:text-amber-200 text-xs sm:text-sm">
        You&apos;re using a shared password. Consider changing it for privacy.
      </p>
      <button
        onClick={() => navigate('/settings')}
        className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
      >
        Change password
      </button>
      <button
        onClick={dismiss}
        aria-label="Dismiss password nudge"
        className="shrink-0 p-1.5 rounded-lg text-amber-600 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20"
      >
        <X size={14} />
      </button>
    </div>
  )
}
