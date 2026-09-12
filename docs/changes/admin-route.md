# admin.ts (Backend Route)

## Overview
Admin routes for user and college management.

## Changes

### 2026-08-06 — Initial Build
- Created with user CRUD operations
- Added SUPER_ADMIN access control

### 2026-08-13 — College Support
- All routes now support `?collegeId=` query param
- SUPER_ADMIN can manage all colleges
- COLLEGE_ADMIN can only manage their college

## Dependencies
- Prisma client
- `src/middleware/auth.ts` — Auth middleware
