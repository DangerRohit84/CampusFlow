import clsx from 'clsx'
import { forwardRef, useId } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  /** Helper text announced to screen readers via aria-describedby. */
  hint?: string
  icon?: React.ReactNode
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, icon, type, id, ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false)
    const isPassword = type === 'password'
    // WHY: every input needs a programmatic label + describedby so AT users
    // hear the label, hint and error (audit F24). Auto-id keeps htmlFor/id paired.
    const autoId = useId()
    const inputId = id || `input-${autoId.replace(/:/g, '')}`
    const errorId = `${inputId}-error`
    const hintId = `${inputId}-hint`
    const describedBy = [error ? errorId : null, hint ? hintId : null, props['aria-describedby'] || null]
      .filter(Boolean)
      .join(' ') || undefined

    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-semibold text-surface-700 dark:text-night-200">
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400 dark:text-night-400">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            type={isPassword && showPassword ? 'text' : type}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={clsx(
              // WHY: placeholder #6b7280 keeps 4.6:1 on white (WCAG AA); surface-400 #9ca3af fails at 2.8:1.
              'w-full bg-white dark:bg-night-850 border border-surface-200 dark:border-night-600 rounded-xl text-surface-900 dark:text-night-50 placeholder:text-[#6b7280] dark:placeholder:text-night-400',
              'focus:outline-none focus-visible:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-500/20 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
              'transition-colors duration-150 text-sm min-h-[44px]',
              {
                'px-4': !icon,
                'pl-11 pr-4': icon,
                'pr-11': isPassword,
                'border-danger-300 focus:border-danger-400 focus:ring-danger-500/20': error,
              },
              className
            )}
            {...props}
          />
          {isPassword && (
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-surface-400 hover:text-surface-600 dark:hover:text-night-200 dark:text-night-300 transition-colors"
            >
              {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </button>
          )}
        </div>
        {hint && !error && <p id={hintId} className="text-xs text-surface-500 dark:text-night-300">{hint}</p>}
        {error && <p id={errorId} role="alert" className="text-sm text-danger-600">{error}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'
export default Input
