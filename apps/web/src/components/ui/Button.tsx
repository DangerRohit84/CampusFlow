import clsx from 'clsx'
import { forwardRef } from 'react'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'brass'
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
        className={clsx(
          'inline-flex items-center justify-center font-semibold rounded-xl transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed',
          {
            'bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800': variant === 'primary',
            'bg-white border border-surface-200 text-surface-700 hover:bg-surface-50': variant === 'secondary',
            'text-surface-600 hover:bg-surface-100 hover:text-surface-900': variant === 'ghost',
            'bg-danger-500 text-white hover:bg-danger-600': variant === 'danger',
            'bg-brass-400 text-surface-900 hover:bg-brass-500': variant === 'brass',
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
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : icon ? icon : null}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
export default Button
