# internships.ts (Backend Route)

## Overview
Internship CRUD and staging management routes.

## Changes

### 2026-08-06 — Initial Build
- Created with CRUD operations
- Added staging endpoints

### 2026-08-13 — PENDING Filter Fix
- Backend `PENDING` filter: `{ in: ['DRAFT', 'PENDING', 'ACTIVE'] }`
- Internships saved with `status: 'ACTIVE'` by fetch, so `ACTIVE` must be included in pending filter
- Previously only queried `DRAFT`/`PENDING`, missing `ACTIVE` items

### 2026-08-18 — Enrich Platform Scoped
- Added `?source=<platform>&limit=<limit>` query params to enrich endpoint

### 2026-08-18 — Auto-Reject Ended
- Same as hackathons: auto-rejects ended items, near-deadline priority

## Dependencies
- Prisma client
- `src/services/opportunityAgent.ts` — Enrichment functions
- `src/middleware/auth.ts` — Auth middleware
