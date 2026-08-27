# Layout.tsx

## Overview
Main layout wrapper with sidebar, top nav, and content area. Handles responsive design and dark mode.

## Changes

### 2026-08-06 — Initial Build
- Created with sidebar navigation
- Added responsive mobile menu
- School illustration in sidebar

### 2026-08-13 — Sidebar Restructure
- Sidebar restructured: Overview, CAMPUS (Dashboard, Hackathons, Internships, Leaderboard), Management (Admin Panel, Fetch, Settings)
- Route fixes: `/opportunities` → role-specific, `/admin-panel` → `/admin`
- Removed Framer Motion `layoutId` from nav indicator (caused animation issues)

### 2026-08-13 — UI Redesign
- School illustration SVG replaced with new version
- Sidebar colors: light=`#FEF9F1`, dark=`#0C1218`
- All dark mode classes updated with exact palette

### 2026-08-18 — Dark Mode Fix
- All hardcoded `dark:text-gray-XXX` changed to exact palette values
- Sidebar: `dark:bg-[#0C1218]`, `dark:border-[#202C35]`
- Active nav: `dark:bg-[#10332F]`, `dark:text-[#00A88F]`
- All text colors normalized to palette

## Dependencies
- `src/store/authStore.ts` — Auth state (sidebar visibility)
- `src/components/ThemeToggle.tsx` — Dark mode toggle
- `src/context/ThemeContext.tsx` — Theme context
