# AdminOpportunitiesPage.tsx

## Overview
Admin page for reviewing hackathon and internship staging items. Approve/reject/assign opportunities.

## Changes

### 2026-08-06 — Initial Build
- Created with dual-column layout (hackathons + internships)
- Added approve/reject buttons
- Added batch operations

### 2026-08-13 — UI Redesign
- Single-column admin review layout
- Platform-based card colors (Devfolio=green, Devpost=orange, etc.)
- Tags/departments use gray styling (`bg-surface-200`, `text-surface-700`)
- Prize box redesigned with platform colors
- Added near-deadline badge (`bg-[#DC2626]`)

### 2026-08-18 — Status Filter Fix
- Default tab changed to `'pending'`
- Backend `PENDING` filter fixed for hackathons: `{ in: ['DRAFT', 'PENDING'] }`
- Backend `PENDING` filter fixed for internships: `{ in: ['DRAFT', 'PENDING', 'ACTIVE'] }`
- Removed redundant client-side status filter from `allItems` memo
- Fixed `totalUnenriched` negative number: `Math.max(0, ...)`
- Tab badge counts fixed to use enriched counts
- `tabCounts.all` = `hackEnriched + intEnriched`
- Added `statusParam` state for URL sync
- Data loading restructured with status change reloads

### 2026-08-18 — Type Fixes
- `rounds === '1'` type mismatch fixed (string vs number)
- Mode dropdown case mismatch fixed
- Loading race condition fixed (guard against stale data)
- Edit modal type fixes for date fields

### 2026-08-18 — Assign Fix
- Bulk/individual assign now uses `api` axios instance (was using raw `fetch`)

## Dependencies
- `src/lib/api.ts` — `getStaging()`, `approveStaging()`, `rejectStaging()`, `assignOpportunity()`
- `src/components/ui/Modal.tsx` — Edit modal
- `src/components/ui/Badge.tsx` — Status badges
- `src/components/shared/FilterTabs.tsx` — Tab navigation
- `src/hooks/useFilteredItems.ts` — Filter logic
- `src/lib/parseJson.ts` — `parseJsonArray()` for JSON string fields
