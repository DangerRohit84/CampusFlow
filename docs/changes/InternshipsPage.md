# InternshipsPage.tsx

## Overview
Browse and search internships with filters and platform tags.

## Changes

### 2026-08-06 — Initial Build
- Created with search, filter tabs, and internship cards
- Added platform-based color coding for tags

### 2026-08-13 — UI Redesign
- Full page redesign matching HackathonsPage style
- Added search bar, Export button
- Card redesign with platform colors
- Added near-deadline count badge

### 2026-08-18 — Default Tab Fix
- Changed default tab from `'all'` to `'upcoming'`

## Dependencies
- `src/lib/api.ts` — API client
- `src/components/shared/FilterTabs.tsx` — Tab component
- `src/components/ui/Badge.tsx` — Platform tags
- `src/hooks/useFilteredItems.ts` — Filter logic
