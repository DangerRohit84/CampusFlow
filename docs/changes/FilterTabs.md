# FilterTabs.tsx

## Overview
Shared tab component for filtering lists by status/category.

## Changes

### 2026-08-06 — Initial Build
- Created with tab navigation and active state indicator

### 2026-08-13 — Badge Fix
- Active badge color: `bg-white text-primary-600` (was inverted)

### 2026-08-18 — Default Tab Support
- Added `defaultTab` prop support
- Used by AdminOpportunitiesPage, HackathonsPage, InternshipsPage

## Dependencies
- `src/hooks/useFilteredItems.ts` — Filter logic
