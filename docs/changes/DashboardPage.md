# DashboardPage.tsx

## Overview
Main dashboard showing stats, role-adaptive UI, and quick actions.

## Changes

### 2026-08-06 — Initial Build
- Created with role-adaptive layout (student/faculty/admin)
- Added stat cards (Students, Faculty, Events, Active Rooms)
- Used `api` axios instance for data fetching
- Added SVG dashboard illustration with dark mode wrapper

### 2026-08-13 — UI Redesign
- Stats colors: Students=green, Faculty=blue, Events=orange, Active Rooms=red
- Status badge colors differentiated: Upcoming=`bg-primary-600`, Ongoing=`bg-warning-600`, Ended=`bg-gray-700`
- Added dark mode support with `dark:` classes

### 2026-08-18 — Dark Mode Fix
- Added `className="dark:hidden"` to SVG illustration for light mode only
- Added `className="hidden dark:block"` to dark mode SVG variant
- Prevents flash of white SVG on dark background

## Dependencies
- `src/lib/api.ts` — API client
- `src/store/authStore.ts` — Auth state
- `src/components/shared/StatCard.tsx` — Stat card component
- `src/components/ui/Badge.tsx` — Status badges
