# AdminPage.tsx

## Overview
Admin panel with college selection (for super admin), department management, and user management.

## Changes

### 2026-08-06 — Initial Build
- Created with department/user management
- Added SUPER_ADMIN college selection flow

### 2026-08-13 — Permission Fix
- SUPER_ADMIN permission mismatch fixed
- All admin/departments routes now support `?collegeId=` query param
- `authorize()` middleware created in `src/middleware/auth.ts`

### 2026-08-13 — UI Redesign
- Added dark mode support
- Restructured with college-selection flow for super admin

## Dependencies
- `src/lib/api.ts` — API client
- `src/components/ui/Modal.tsx` — Edit modals
- Backend `/api/admin/users` — User management
- Backend `/api/departments` — Department management
