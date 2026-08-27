# api.ts (Frontend)

## Overview
Axios API client instance with base URL configuration and auth token injection.

## Changes

### 2026-08-06 — Initial Build
- Created with axios instance
- Base URL: `http://localhost:4000/api`
- Auth token from localStorage

### 2026-08-18 — Staging API Methods
- Added `getStaging(type, status?)` — accepts optional status param
- Added `approveStaging(type, id)`
- Added `rejectStaging(type, id)`
- Added `assignOpportunity(type, id, deptIds)`
- Exported as default (was named export `api`)

## Dependencies
- None (utility module)
