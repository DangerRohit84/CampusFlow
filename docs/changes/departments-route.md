# departments.ts (Backend Route)

## Overview
Department CRUD routes with college scoping.

## Changes

### 2026-08-06 — Initial Build
- Created with CRUD operations

### 2026-08-13 — College Support
- All routes support `?collegeId=` query param
- SUPER_ADMIN access enabled

## Dependencies
- Prisma client
- `src/middleware/auth.ts` — Auth middleware
