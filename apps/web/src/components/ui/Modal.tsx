import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import clsx from 'clsx'
import { useFocusTrap } from '../../hooks/useFocusTrap'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
}

export default function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  // WHY: focus must stay inside the dialog while open and return to the
  // trigger on close (WCAG 2.4.3, audit F24).
  useFocusTrap(dialogRef, open)

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (open) {
      document.addEventListener('keydown', handleEsc)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleEsc)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        ref={overlayRef}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-slideUp"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={clsx(
          'relative bg-white dark:bg-night-800 rounded-[14px] shadow-e3 w-full overflow-hidden animate-slideUp border border-surface-200 dark:border-night-600',
          { 'max-w-sm': size === 'sm', 'max-w-md': size === 'md', 'max-w-lg': size === 'lg' }
        )}
      >
        <div className="flex items-center justify-between p-5 pb-4 border-b border-surface-200 dark:border-night-600">
          <h2 id={titleId} className="text-base font-bold text-surface-900 dark:text-night-50 font-display">{title}</h2>
          <button onClick={onClose} aria-label="Close dialog" className="w-11 h-11 inline-flex items-center justify-center rounded-xl text-surface-400 hover:text-surface-600 dark:text-night-300 hover:bg-surface-100 dark:hover:bg-night-700 transition-colors dark:bg-[#1e1e1e]">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="p-5 max-h-[70vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}
