# HackathonsPage.tsx

## Overview
Browse and search hackathons with filters and platform tags.

## Changes

### 2026-08-06 — Initial Build
- Created with search, filter tabs, and hackathon cards
- Added platform-based color coding for tags
- Used `api` axios instance for data fetching

### 2026-08-13 — UI Redesign
- Added search bar with debounced input
- Added Export button
- Card redesign with platform colors
- Added near-deadline count badge (red `bg-[#DC2626]`)
- Platform tag colors: Devfolio=green, Devpost=orange, MLH=red, Unstop=purple, Internshala=blue

### 2026-08-18 — Default Tab Fix
- Changed default tab from `'all'` to `'upcoming'`
- HackathonsPage uses `defaultTab="upcoming"` on FilterTabs

## Dependencies
- `src/lib/api.ts` — API client
- `src/components/shared/FilterTabs.tsx` — Tab component
- `src/components/ui/Badge.tsx` — Platform tags
- `src/hooks/useFilteredItems.ts` — Filter logic
