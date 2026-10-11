// lib/chatFocus.ts — shared chat-input focus helper (SRP extract).
// WHY: ChatPage disabled its input while sending (disabled={isTyping}),
// which drops DOM focus + dismisses the mobile keyboard; with no ref and
// no focus() restore the user had to click again before the next ask.
// focusChatInput() restores focus with preventScroll (no layout shift /
// no scroll jump on mobile) and fails safe (returns false, never throws)
// so send/finally paths can call it unconditionally.
type Focusable = { focus?: (...args: never[]) => void }

export function focusChatInput(el: unknown): boolean {
  if (!el || typeof (el as Focusable).focus !== 'function') return false
  const target = el as { focus: (opts?: { preventScroll?: boolean }) => void }
  try {
    target.focus({ preventScroll: true })
    return true
  } catch {
    // Older browsers throw on options arg — retry without args.
    try {
      ;(target as { focus: () => void }).focus()
      return true
    } catch {
      return false
    }
  }
}
