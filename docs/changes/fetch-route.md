# fetch.ts (Backend Route)

## Overview
Fetch API routes for scraping external platforms and enriching staging items.

## Changes

### 2026-08-13 — Initial Build
- Created with `POST /all`, `POST /:platform`, `POST /hackathons/enrich`, `POST /internships/enrich`
- Added `enrichAllPending()` helper — loops through pending items in batches of 5

### 2026-08-18 — Fetch Stats Bug Fix
- `fetch.ts:55` — internship enriched count now checks `targetDepartments: { not: '[]' }`
- Previously counted all non-empty descriptions as enriched

### 2026-08-18 — Platform Scoped Enrich
- `POST /hackathons/enrich` and `/internships/enrich` accept `?source=<platform>&limit=<limit>`
- When source is provided, only enriches items from that platform
- `enrichAllPending(source?)` accepts optional source parameter

### 2026-08-18 — Auto-Reject Ended
- Before enriching, runs `updateMany` to set `status: 'REJECTED'` for items where `deadline < today`
- Enrichment query filters: `OR [{ deadline: null }, { deadline: { gte: today } }]`
- Orders by `[{ deadline: 'asc' }, { createdAt: 'desc' }]` for near-deadline priority

### 2026-08-18 — Cleanup Endpoint
- Added `POST /cleanup` — deletes rejected staging items older than 30 days

### 2026-08-18 — Cron Integration
- Enrichment now loops until no pending items remain
- Sequential enrichment with delay between items

## Dependencies
- `src/services/opportunityAgent.ts` — Fetch and enrich functions
- Prisma client
- node-cron
