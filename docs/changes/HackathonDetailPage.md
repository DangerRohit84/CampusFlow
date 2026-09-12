# HackathonDetailPage.tsx

## Overview
Detailed view of a single hackathon with prizes, timeline, and apply button.

## Changes

### 2026-08-06 — Initial Build
- Created with hero gradient, prize section, timeline
- Applied Framer Motion animations

### 2026-08-13 — UI Redesign
- Hero gradient changed to primary green (`#007060`)
- Added `extractAmounts()` parser for concise prize display
- Prize Card redesigned with platform colors
- Near-deadline badge added

### 2026-08-18 — Dark Mode
- Added dark mode gradient wrapper
- Dark mode text colors normalized

## Dependencies
- `src/lib/api.ts` — API client
- `src/components/ui/Badge.tsx` — Platform tags
- `src/components/ui/Button.tsx` — Action buttons
