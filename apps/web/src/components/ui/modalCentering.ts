import { useAppStore } from '../../store/appStore'

/**
 * Content-area centering offset for the persistent desktop sidebar.
 * WHY: centered overlays use `fixed inset-0` (viewport-anchored, no portal
 * into main), so plain flex centering lands on the viewport center. With
 * Layout.tsx sidebar w-[280px] expanded / w-[72px] collapsed (lg+ only),
 * viewport-center is 140px / 36px left of the content-area center. Adding
 * lg-only padding-left = sidebarWidth + 16px (p-4 gutter) shifts the flex
 * centering to the content area while the absolute backdrop still covers
 * the full viewport (sidebar stays dimmed, focus trap intact). Mobile
 * (<lg) sidebar is an overlay drawer, so no offset — plain viewport center.
 * Single source of truth for all 23 centered overlays (37 fixed inset-0
 * flex overlays); Modal.tsx re-exports for backward compat.
 */
export function getModalCenteringClass(sidebarOpen: boolean): string {
  return sidebarOpen ? 'lg:pl-[296px]' : 'lg:pl-[88px]'
}

/**
 * lg-only padding transition so the 104px expanded/collapsed jump animates
 * with the sidebar instead of snapping. Kept separate from the pl class so
 * call sites stay `clsx(base + transition, centeringClass)` like Modal.tsx.
 */
export const MODAL_CENTERING_TRANSITION = 'lg:transition-[padding-left] lg:duration-200'

/**
 * Subscribe to the same store Layout.tsx toggles and return the current
 * lg-only offset class. WHY hook (not direct store read): one import per
 * overlay, no duplicated selector, lg-only semantics preserved.
 */
export function useModalCenteringClass(): string {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  return getModalCenteringClass(sidebarOpen)
}
