# opportunityAgent.ts

## Overview
Core service for opportunity fetching and AI enrichment. Contains platform scrapers and enrichment logic.

## Changes

### 2026-08-13 — Initial Build
- Created with `fetchFromAllSources()`, `fetchFromPlatform()`
- Added `enrichHackathonStaging()`, `enrichInternshipStaging()`
- Added DuckDuckGo search fallback
- Added `node-cache` 6-hour TTL caching

### 2026-08-18 — Limit-Aware Scraping
- All scrapers accept `limit?` parameter
- `fetchDevfolio(limit?)` — breaks page loop when `all.length >= limit`
- `fetchDevpost(limit?)` — same
- `fetchInternshala(limit?)` — same, also limits detail-page enrichment
- `fetchMLH(limit?)` — breaks regex loop when `opportunities.length >= limit`
- `fetchUnstop(limit?)` — uses `limit` instead of hardcoded `20`

### 2026-08-18 — Platform Scoped Enrich
- `enrichAllPending(source?)` — when source provided, only enriches items from that platform
- Enrichment queries filter by `source` field when scoped

### 2026-08-18 — Auto-Reject Ended
- Before enrichment, auto-rejects items where `deadline < today`
- Skips ended items in enrichment query
- Orders by deadline ascending for near-deadline priority

## Dependencies
- Prisma client
- `src/utils/search.ts` — DuckDuckGo search
- `node-cache` — In-memory caching
