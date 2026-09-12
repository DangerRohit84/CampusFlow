import clsx from 'clsx'
import { forwardRef } from 'react'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'brass' | 'accent' | 'emerald' | 'rose'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: React.ReactNode
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, icon, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading ? true : undefined}
        aria-disabled={disabled || loading ? true : undefined}
        className={clsx(
          'inline-flex items-center justify-center font-semibold rounded-xl transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
          {
            'bg-primary-500 text-black hover:bg-primary-600 active:bg-primary-700 dark:bg-primary-500 dark:text-black dark:hover:bg-primary-400 dark:active:bg-primary-600': variant === 'primary' || variant === 'brass' || variant === 'accent',
            'bg-white dark:bg-night-800 border border-surface-200 dark:border-[#282828] text-slate-800 dark:text-white hover:bg-surface-50 dark:hover:bg-[#1f1f1f] hover:border-surface-300 dark:hover:border-[#3a3a3a]': variant === 'secondary',
            'text-slate-800 dark:text-[#b3b3b3] hover:bg-surface-100 dark:hover:bg-[#1f1f1f] hover:text-slate-800 dark:hover:text-white': variant === 'ghost',
            'bg-danger-500 text-white hover:bg-danger-600 dark:bg-danger-500 dark:hover:bg-danger-600': variant === 'danger' || variant === 'rose',
            'bg-success-500 text-black hover:bg-success-600 dark:bg-success-500 dark:text-black dark:hover:bg-success-400': variant === 'emerald',
          },
          {
            'px-3 min-h-[36px] text-xs gap-1.5': size === 'sm',
            'px-5 min-h-[44px] text-sm gap-2': size === 'md',
            'px-7 min-h-[48px] text-sm gap-2.5': size === 'lg',
          },
          className
        )}
        {...props}
      >
        {loading ? (
          <>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="sr-only">Loading</span>
          </>
        ) : icon ? icon : null}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
export default Button