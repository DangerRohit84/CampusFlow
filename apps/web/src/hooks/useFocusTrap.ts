import { useEffect } from 'react'
import type { RefObject } from 'react'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Traps keyboard focus inside `containerRef` while `active` is true.
 * WHY: WCAG 2.4.3 + audit F24 — modal focus must not escape to the page
 * behind the dialog, and focus must return to the trigger on close.
 * - Focuses the first focusable element (or the container) on open.
 * - Wraps Tab / Shift+Tab at the first/last focusable.
 * - Restores focus to the previously focused element on cleanup.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement>, active: boolean) {
  useEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    const getFocusable = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
      )

    if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1')
    const initial = getFocusable()[0] ?? container
    initial.focus({ preventScroll: true })

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = getFocusable()
      if (items.length === 0) {
        e.preventDefault()
        container.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (!container.hasAttribute('data-keep-tabindex')) container.removeAttribute('tabindex')
      previouslyFocused?.focus?.({ preventScroll: true })
    }
  }, [active, containerRef])
}
