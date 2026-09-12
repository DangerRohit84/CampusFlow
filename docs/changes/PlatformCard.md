# PlatformCard.tsx

## Overview
Card component for a single platform in the Fetch page. Shows platform name, counts, limit dropdown, and fetch/re-enrich buttons.

## Changes

### 2026-08-13 — Initial Build
- Created with platform info display
- Added limit dropdown (0=All, 1,2,5,10,15,20,50)
- Fetch and Re-enrich buttons
- Badge shows "Complete" when pending=0, "X pending" otherwise

### 2026-08-18 — Re-enrich Platform Scoped
- Re-enrich now passes `?source=<platform>&limit=<limit>` to enrich endpoint
- Only enriches items from that specific platform
- Uses `api` axios instance (was using raw `fetch`)

## Dependencies
- `src/lib/api.ts` — API client
- Backend `/api/fetch/:platform` — Fetch endpoint
- Backend `/api/fetch/hackathons/enrich` — Enrich endpoint
- Backend `/api/fetch/internships/enrich` — Enrich endpoint
