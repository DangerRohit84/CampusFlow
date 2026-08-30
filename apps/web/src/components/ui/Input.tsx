import clsx from 'clsx'
import { forwardRef } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  icon?: React.ReactNode
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, icon, type, ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false)
    const isPassword = type === 'password'

    return (
      <div className="space-y-1.5">
        {label && (
          <label className="block text-sm font-semibold text-surface-700 dark:text-night-200">
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
            type={isPassword && showPassword ? 'text' : type}
            className={clsx(
              'w-full bg-white dark:bg-night-850 border border-surface-200 dark:border-night-600 rounded-xl text-surface-900 dark:text-night-50 placeholder:text-surface-400 dark:placeholder:text-night-400',
              'focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-500/20',
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
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600 dark:hover:text-night-200 dark:text-night-300 transition-colors"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          )}
        </div>
        {error && <p className="text-sm text-danger-600">{error}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'
export default Input
