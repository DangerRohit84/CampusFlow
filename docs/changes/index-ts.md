# index.ts (Backend)

## Overview
Express server entry point with route setup, cron jobs, and middleware.

## Changes

### 2026-08-06 — Initial Build
- Created with Express server setup
- Added CORS, JSON parsing, error handling
- Added all route imports

### 2026-08-13 — Cron Jobs
- Added hackathon fetch cron (daily)
- Added internship fetch cron (daily)
- Added coding contest fetch cron
- Added auto-enrichment after fetch (sequential with delay)

### 2026-08-18 — Cleanup Cron
- Added weekly cleanup cron (Sunday 3 AM)
- Deletes rejected staging items older than 30 days

## Dependencies
- All route files
- Prisma client
- node-cron
