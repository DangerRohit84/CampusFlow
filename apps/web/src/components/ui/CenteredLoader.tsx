import { Loader2 } from 'lucide-react'

interface CenteredLoaderProps {
  /** Text displayed below spinner. Defaults to "Loading..." */
  text?: string
  /** When true, uses min-h-screen to center on full viewport (for standalone pages). Defaults to false -> min-h-[60vh] */
  fullScreen?: boolean
  /** Override min-height class, e.g. "min-h-[45vh]" or "min-h-screen". If provided, takes precedence over fullScreen. */
  minHeight?: string
  className?: string
}

/**
 * Unified loading indicator for all pages.
 * - Same spinner size (w-8 h-8), color (text-primary-500), animation (animate-spin)
 * - Centered vertically & horizontally with consistent text
 * - Single source of truth — do not duplicate spinner markup across pages.
 */
export default function CenteredLoader({
  text = 'Loading...',
  fullScreen = false,
  minHeight,
  className = '',
}: CenteredLoaderProps) {
  const heightClass = minHeight ?? (fullScreen ? 'min-h-screen' : 'min-h-[60vh]')
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={text}
      className={`flex flex-col items-center justify-center ${heightClass} w-full px-4 py-12 ${className}`}
    >
      <Loader2 className="w-8 h-8 animate-spin text-primary-500" aria-hidden="true" />
      <p className="mt-3 text-sm font-medium text-surface-500 dark:text-night-400">{text}</p>
    </div>
  )
}

// Named export for convenience
export { CenteredLoader }
