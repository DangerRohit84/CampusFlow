# FetchPage.tsx

## Overview
Super admin page for fetching opportunities from external platforms. Shows per-platform stats, limits, and controls.

## Changes

### 2026-08-13 — Initial Build
- Created with FetchStats row and PlatformCard grid
- Used `api` axios instance
- Static platform constants: Devfolio, Devpost, MLH, Unstop, Internshala
- API fills in platform counts on mount

### 2026-08-18 — Architecture Decisions
- Kept as single page (not in sidebar per-college)
- Platform limits saved to DB via `/api/fetch/settings/all`
- `node-cache` installed for 6-hour in-memory caching
- Frontend uses static constants, backend fills counts

## Dependencies
- `src/components/fetch/PlatformCard.tsx` — Platform control card
- `src/components/fetch/FetchStats.tsx` — Stats summary row
- `src/lib/api.ts` — API client
