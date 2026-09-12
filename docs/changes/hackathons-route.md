# hackathons.ts (Backend Route)

## Overview
Hackathon CRUD and staging management routes.

## Changes

### 2026-08-06 — Initial Build
- Created with CRUD operations
- Added staging endpoints

### 2026-08-13 — PENDING Filter Fix
- Backend `PENDING` filter: `{ in: ['DRAFT', 'PENDING'] }`
- Previously only queried `DRAFT`, missing items saved with `PENDING` status

### 2026-08-18 — Enrich Platform Scoped
- Added `?source=<platform>&limit=<limit>` query params to enrich endpoint
- Filters enrichment to specific platform's items only

### 2026-08-18 — Auto-Reject Ended
- Enrichment auto-rejects items where `deadline < today`
- Sets `status: 'REJECTED'` for ended items
- Skips ended items in enrichment query
- Orders by deadline ascending (near-deadline first)

## Dependencies
- Prisma client
- `src/services/opportunityAgent.ts` — Enrichment functions
- `src/middleware/auth.ts` — Auth middleware
