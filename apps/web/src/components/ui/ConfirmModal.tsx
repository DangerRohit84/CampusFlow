import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AlertTriangle } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'

export interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** Red destructive styling (default true). Set false for approve-style confirms. */
  danger?: boolean
}

type Resolver = (value: boolean) => void

const ConfirmContext = createContext<{ confirm: (opts: ConfirmOptions) => Promise<boolean> } | null>(
  null,
)

/**
 * Promise-based accessible confirm. Replaces native `confirm()`.
 * WHY: native confirm() is unstyled, blocks assistive tech, and has no
 * ARIA semantics (audit F24). Usage:
 *   const { confirm } = useConfirm()
 *   const ok = await confirm({ message: 'Delete this task?' })
 *   if (!ok) return
 */
export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within <ConfirmProvider>')
  return ctx
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<(ConfirmOptions & { id: number }) | null>(null)
  const resolverRef = useRef<Resolver | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolverRef.current = resolve
        setPending({
          title: 'Are you sure?',
          confirmLabel: 'Confirm',
          cancelLabel: 'Cancel',
          danger: true,
          ...opts,
          id: Date.now(),
        })
      }),
    [],
  )

  useFocusTrap(dialogRef, pending !== null)

  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        resolverRef.current?.(false)
        resolverRef.current = null
        setPending(null)
      }
    }
    document.addEventListener('keydown', onKey, true)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = ''
    }
  }, [pending])

  const settle = (value: boolean) => {
    resolverRef.current?.(value)
    resolverRef.current = null
    setPending(null)
  }

  const danger = pending?.danger !== false

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {pending && (
        <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => settle(false)}
            aria-hidden="true"
          />
          <div
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby="confirm-dialog-desc"
            className="relative bg-white dark:bg-night-800 rounded-[14px] shadow-e3 w-full max-w-sm overflow-hidden border border-surface-200 dark:border-night-600 animate-slideUp"
          >
            <div className="p-5">
              <div className="flex items-start gap-3">
                <span
                  className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                    danger
                      ? 'bg-danger-50 text-danger-600 dark:bg-danger-500/10 dark:text-danger-400'
                      : 'bg-primary-50 text-primary-700 dark:bg-primary-500/10 dark:text-primary-300'
                  }`}
                  aria-hidden="true"
                >
                  <AlertTriangle size={20} />
                </span>
                <div className="min-w-0">
                  <h2 id="confirm-dialog-title" className="text-base font-bold text-surface-900 dark:text-night-50 font-display">
                    {pending.title}
                  </h2>
                  <p id="confirm-dialog-desc" className="mt-1 text-sm text-surface-500 dark:text-night-400 leading-relaxed">
                    {pending.message}
                  </p>
                </div>
              </div>
              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  onClick={() => settle(false)}
                  className="px-5 h-11 rounded-xl bg-white dark:bg-night-700 border border-surface-200 dark:border-night-600 text-surface-700 dark:text-night-200 text-sm font-semibold hover:bg-surface-50 dark:hover:bg-night-600 transition-colors"
                >
                  {pending.cancelLabel}
                </button>
                <button
                  onClick={() => settle(true)}
                  className={`px-5 h-11 rounded-xl text-sm font-bold transition-colors ${
                    danger
                      ? 'bg-danger-500 hover:bg-danger-600 text-white'
                      : 'bg-primary-600 hover:bg-primary-700 text-white'
                  }`}
                >
                  {pending.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}
