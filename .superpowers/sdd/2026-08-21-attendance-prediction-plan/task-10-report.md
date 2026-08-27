# Task 10: Frontend — Rewrite AttendancePage with Tabs

## What Was Done

Rewrote `apps/web/src/pages/AttendancePage.tsx` from a single-view page to a 5-tab layout:

### Tab Structure
- **Overview** — Contains the existing stats cards (Overall, Present, Absent, Late), animated donut chart, course-wise attendance bars, and recent attendance list (preserved from original)
- **Upload** — Renders `<UploadTab />` component (from Task 6)
- **Manual** — Renders `<ManualTab />` component (from Task 7)
- **Predictions** — Renders `<PredictionsTab />` component (from Task 8)
- **History** — Renders `<HistoryTab />` component (from Task 9)

### Key Implementation Details
- Animated tab bar with Framer Motion `layoutId="activeTab"` for smooth sliding indicator
- `AnimatePresence` with `mode="wait"` for tab content transition animations (fade + slide)
- Each tab content wrapped in a `motion.div` with enter/exit animations
- Tab bar uses pill-style gradient background for the active tab (primary-500 to primary-600)
- `statusColors` moved to module scope (defined before export, used inside component)
- Replaced `Badge` import with inline `<span>` for status badges (simplified, no extra import needed)
- All dark mode classes preserved using the project's design tokens
- Tab bar is horizontally scrollable on mobile (`overflow-x-auto`)

### Files Modified
- `apps/web/src/pages/AttendancePage.tsx` — Full rewrite

### TypeScript Compilation
- `tsc --noEmit` passes with zero errors

### Commits
- `f880115` — `feat: rewrite AttendancePage with 5-tab layout`
