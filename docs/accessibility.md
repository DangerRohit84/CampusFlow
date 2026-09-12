# Accessibility Checklist — CampusFlow

> Status: production-ready pass (2026-09-09 UX sweep). Baseline A11y 6.2/10 FAIL closed. This checklist is the gate for F24/W5. Not a VPAT — a working checklist with file pointers.

## WCAG 2.2 AA — verified this sweep

- [x] **Contrast AA (C1)** — `#1ed760` restricted to large/dark surfaces only; body/small text uses `#0a7a3a` (5.9:1) / `#007A67` fallback (`index.css` contrast enforcement remaps `text-primary-500/600/700` light to `#0a7a3a`, dark keeps `#1ed760`). `badge-primary/accent` use `#0a7a3a` on `#e8f8ee`; `Button` primary is black-on-green; `LoginPage` forgot link is `#0a7a3a`/`#1ed760`; placeholder `#6b7280` (4.6:1). Axe-conscious review, no white-on-green small text.
- [x] **One H1 per page** — 14 pages now have a single H1 (`sr-only` allowed): AssignmentDetail, Assignments (via AssignmentHub), CodingContests, Dashboard, Forms, HackathonDetail, InternshipDetail, Reports, RoomDetail, Settings, StudentRoomDetail, SuperAdminCollegeView, SuperAdminReports (via ReportsPage), TeacherAssigned. Landing keeps `motion.h1`. `RouteFocus` targets `main`/`h1`.
- [x] **44px targets (2.5.8)** — FilterTabs `min-h-36→44`, Pagination `w-9/h-9→44` + Prev/Next `min-h-44`, undoToast Undo `44px`, ThemeToggle `44px`, Remember-me label `44px`, EmptyState action documented as 44px Button, AnnouncementCard edit/delete `44px`.
- [x] **Pagination a11y** — `nav aria-label`, `aria-current=page`, `aria-disabled`, ellipsis `aria-hidden`.
- [x] **Reduced motion (2.3.3)** — `MotionConfig reducedMotion=user` globally + `useReducedMotion` guards (Chat, Calendar, Announcements; Login already had it). CSS `prefers-reduced-motion` kills `lampSwing`/transitions + `scroll-behavior:auto`.
- [x] **Labels (3.3.2)** — Admin raw inputs → `Input label`, HackathonDetail/AssignmentDetail/Chat searches → `label sr-only + aria-label`, placeholder `#6b7280`.
- [x] **EmptyState** — Icon `aria-hidden`, `h3→h2` + `role=status`, action 44px Button doc.
- [x] **Focus not obscured (2.4.11)** — `scroll-padding-top:64px`, CookieConsent `z-9000` bottom-anchored (no header overlap), CommandPalette `useFocusTrap` + restore, CookieConsent non-modal (no trap, reviewed).
- [x] **ThemeToggle** — visible `title` tooltip + `sr-only` label, `aria-pressed` announces state, 44px + keyboard/scroll fallback (header flow, Enter/Space works without drag).
- [x] **Icons/text** — Login GitHub `Eye→Github` + Google `G→Chrome` (correct glyphs), AnnouncementCard unread dot + `Unread` badge text, Help footer uses shared `PublicPageShell` order, Remember-me 44px hit.

## P0 (must-fix before public/pilot)

- [ ] **Focus trap + ESC + restore in every modal** — `CommandPalette.tsx`, `CreateAnnouncementModal.tsx`, `ReportModal.tsx`, `UsernameSetupModal.tsx`, room/form dialogs. Use `focus-trap-react`, `aria-modal="true"`, return focus to trigger on close. Test: Tab cycles inside, ESC closes, focus returns.
- [ ] **Form labels** — every `input/select/textarea` has `<label htmlFor>` or `aria-label`. Grep: `apps/web/src/pages/*.tsx` + `components/**/*.tsx`. No placeholder-only inputs.
- [ ] **Contrast AA** — palette `#00A88F` on white fails AA for small text. Fix: darken to `#007A67` for text or restrict teal to large/bold + dark-bg only. Verify with axe + Lighthouse.
- [ ] **No hover-only affordances** — opportunity cards (`PlatformCard`), room rows: hover reveals must also be visible on focus/tap. Add `:focus-visible` styles + always-visible overflow menu on touch.
- [ ] **Replace native `confirm()`** — custom `Dialog` (role `alertdialog`, `aria-describedby`, focus trap). Grep `confirm(` in `apps/web/src`.
- [ ] **404 / 403 / 500 routes** — add `*` 404, `403` (with `requestId` + support link), `500` nested boundaries. `ErrorBoundary.tsx` must render generic message in prod (no `error.message`), log via `logger` hook. See `docs/seo.md` smoke paths.

## P1 (this sprint)

- [ ] **Toaster a11y** — `App.tsx:92-98` `Toaster`: add `duration: 4000`, `aria-live="polite"`, use `handleApiError` → `toUserMessage()` codes (no raw `Failed` strings x64).
- [ ] **Skip link + landmarks** — `skip to main` link, `<main>` with focus move on route change (replace `querySelector('main')` hack with router `useEffect` + `ref`).
- [ ] **Keyboard for palette + toggles** — `CommandPalette` arrow-nav + Enter/Esc, `ThemeToggle` is a real `<button aria-pressed>`.
- [ ] **Focus-visible** — global `:focus-visible` outline (2px, offset 2px); never remove outline without replacement.
- [ ] **Reduced motion** — `prefers-reduced-motion` disables Framer Motion exits/parallax on `LandingPage`.

## Verification (how to prove)

```bash
# web a11y smoke (manual until Playwright axe lands)
npm run dev -w @campusflow/web
# 1. Keyboard-only: Tab through login → dashboard → hack detail → form submit (no traps, all reachable)
# 2. Screen reader: NVDA/VoiceOver reads labels + modal roles + toast live regions
# 3. axe: run axe DevTools on 10 smoke paths (docs/seo.md) — 0 critical
# 4. Lighthouse a11y ≥ 90 on /, /login, /hackathons
```

## File Pointers

| Area | Files |
|---|---|
| Modals | `components/CommandPalette.tsx`, `CreateAnnouncementModal.tsx`, `ReportModal.tsx`, `UsernameSetupModal.tsx` |
| Boundary/toast | `components/ErrorBoundary.tsx`, `App.tsx:92-98` |
| Theme | `context/ThemeContext.tsx`, `components/ThemeToggle.tsx` |
| Cards/forms | `components/PlatformCard.tsx`, `components/fetch/*`, `pages/FormDetailPage.tsx`, `pages/FormsPage.tsx` |
