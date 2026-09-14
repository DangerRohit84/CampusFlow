// components/admin/SharedPasswordField.tsx — ONE shared password card (P1 + bulk-pw).
// WHY shared: import modal + set-password modal use the identical card
// (input + Show/Hide + Generate + 4-bar strength + live messages). Single copy
// so strength/meter/copy can never drift. Client checks are format-only hints;
// the server dry-run/confirm is authoritative (ADMIN-SET format-only 8-72 +
// common, HIBP skipped — self-set register/change-password keep HIBP).

import { useMemo, useState } from 'react'
import { Eye, EyeOff, RefreshCw } from 'lucide-react'
import clsx from 'clsx'
import { passwordStrengthScore, validateSharedPasswordLocal, generateSharedPasswordLocal } from './bulkHelpers'

interface Props {
  value: string
  onChange: (v: string) => void
  label?: string
  helper?: string
  autoFocus?: boolean
  disabled?: boolean
}

export default function SharedPasswordField({ value, onChange, label, helper, autoFocus, disabled }: Props) {
  const [show, setShow] = useState(false)
  const { score, checks } = useMemo(() => passwordStrengthScore(value), [value])
  const localErrors = useMemo(() => (value ? validateSharedPasswordLocal(value) : []), [value])

  const bars = [checks.length, checks.mixed, checks.digit, checks.symbol]

  return (
    <div className="rounded-2xl border border-surface-200 dark:border-night-600 p-4 bg-surface-50 dark:bg-night-900">
      <label htmlFor="shared-password-input" className="block text-xs font-bold text-surface-700 dark:text-night-200 mb-1">
        {label ?? 'Password for all rows in this import'}
      </label>
      <p className="text-[11px] text-surface-500 dark:text-night-400 mb-2">
        {helper ?? 'Applies to every row in this file. Not in CSV. Share once securely. Users will be nudged (not forced) to change on first login.'}
      </p>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            id="shared-password-input"
            type={show ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            autoFocus={autoFocus}
            disabled={disabled}
            autoComplete="new-password"
            placeholder="Min 8 characters"
            className="w-full px-3 py-2 pr-10 border border-surface-200 dark:border-night-600 rounded-xl text-sm bg-white dark:bg-night-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Hide password' : 'Show password'}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-lg text-surface-400 hover:text-surface-600 dark:hover:text-night-200"
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <button
          type="button"
          onClick={() => onChange(generateSharedPasswordLocal())}
          disabled={disabled}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-xs font-semibold hover:bg-white dark:hover:bg-night-700 disabled:opacity-50"
        >
          <RefreshCw size={13} /> Generate strong
        </button>
      </div>
      {/* Strength meter (4 bars) */}
      <div className="flex items-center gap-1.5 mt-2" aria-label={`Password strength ${score} of 4`}>
        {bars.map((on, i) => (
          <span
            key={i}
            className={clsx(
              'h-1.5 flex-1 rounded-full',
              on ? (score >= 4 ? 'bg-emerald-500' : score >= 2 ? 'bg-amber-500' : 'bg-danger-400') : 'bg-surface-200 dark:bg-night-600',
            )}
          />
        ))}
        <span className="text-[11px] text-surface-500 dark:text-night-400 ml-1">{score}/4</span>
      </div>
      {value && localErrors.length > 0 && (
        <p className="text-[11px] text-danger-600 mt-1">{localErrors[0]}</p>
      )}
      {value && localErrors.length === 0 && (
        <p className="text-[11px] text-emerald-600 mt-1">Looks strong — server verifies format on validate.</p>
      )}
    </div>
  )
}
